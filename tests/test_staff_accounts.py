import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ["DATABASE_PATH"] = ":memory:"
os.environ.pop("TURSO_DATABASE_URL", None)
os.environ.pop("TURSO_AUTH_TOKEN", None)

from fastapi.testclient import TestClient
from app import database
from app.auth import create_access_token, hash_password
from app.main import app


class StaffAccountsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        database.DB_PATH = os.path.join(self.temp.name, "accounts.db")
        database._DB_INITIALIZED = False
        database.init_db()
        self.password_hash = hash_password("test-password")
        with database.get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM system_settings WHERE key = 'staff_accounts_separated_v1'")
            for account_id, name, role in ((1, "Student", "student"), (20, "Admin", "admin"), (21, "Teacher", "teacher")):
                cursor.execute("INSERT INTO users (id,name,email,phone,password_hash,role) VALUES (?,?,?,?,?,?)",
                    (account_id, name, "admin" if role == "admin" else name + "@example.invalid", "000", self.password_hash, role))
                cursor.execute("""INSERT INTO worksheets
                    (user_id,user_name,unit_name,center_action,radial_data,tradeoff_data,chat_text,self_checks,commitment)
                    VALUES (?,?,'Test','Test','[]','[]','','[]','{}')""", (account_id, name))
                cursor.execute("""INSERT INTO game_scores (user_id,user_name,score,max_combo,earth_health,risks_solved,title_earned)
                    VALUES (?,?,?,1,100,1,'Test')""", (account_id, name, account_id * 100))
        database._DB_INITIALIZED = False
        database.init_db()
        self.client = TestClient(app)
        self.seed_patch = patch("app.main.ensure_users_seeded")
        self.seed_patch.start()
        self.admin = self.headers(20, "Admin", "admin")
        self.student = self.headers(1, "Student", "student")

    def tearDown(self):
        self.seed_patch.stop()
        self.client.close()
        self.temp.cleanup()

    def headers(self, account_id, name, role):
        return {"Authorization": "Bearer " + create_access_token({"id": account_id, "name": name, "email": name + "@example.invalid", "role": role})}

    def test_migration_preserves_passwords_records_and_is_repeatable(self):
        for _ in range(2):
            database._DB_INITIALIZED = False
            database.init_db()
        with database.get_db() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM users").fetchone()[0], 1)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM admin").fetchone()[0], 2)
            staff = conn.execute("SELECT * FROM admin WHERE id = 20").fetchone()
            self.assertEqual(staff["password_hash"], self.password_hash)
            for table in ("worksheets", "game_scores"):
                self.assertEqual(conn.execute(f"SELECT COUNT(*) FROM {table} WHERE account_type = 'staff'").fetchone()[0], 2)
                self.assertEqual(conn.execute(f"SELECT COUNT(*) FROM {table} WHERE account_type = 'student'").fetchone()[0], 1)
        self.assertEqual(self.client.get("/api/worksheets/2", headers=self.admin).json()["user_email"], "admin")
        self.assertEqual(self.client.get("/api/worksheets/2/export-docx", headers=self.admin).status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me", headers=self.admin).json()["name"], "Admin")

    def test_rename_retains_only_requested_accounts_and_preserves_other_data(self):
        removed_token = self.headers(500, "Other", "admin")
        with database.get_db() as conn:
            conn.execute("DELETE FROM admin")
            for account_id, email in ((1, "admin"), (429, "vinnyhuang.ipuregreen@gmail.com"), (500, "other@example.invalid"), (501, "admin")):
                conn.execute("""INSERT INTO admin (id,name,email,phone,password_hash,role,created_at)
                    VALUES (?, ?, ?, '555', ?, 'admin', '2026-01-01 00:00:00')""", (account_id, email, email, self.password_hash))
            conn.execute("DELETE FROM system_settings WHERE key = 'admin_table_retained_accounts_v1'")
            conn.execute("ALTER TABLE admin RENAME TO staff_accounts")
        for _ in range(2):
            database._DB_INITIALIZED = False
            database.init_db()
        with database.get_db() as conn:
            rows = conn.execute("SELECT id,email,password_hash,created_at FROM admin ORDER BY id").fetchall()
            self.assertEqual([(row["id"], row["email"]) for row in rows], [(1, "admin"), (429, "vinnyhuang.ipuregreen@gmail.com")])
            self.assertTrue(all(row["password_hash"] == self.password_hash and row["created_at"] == "2026-01-01 00:00:00" for row in rows))
            self.assertIsNone(conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='staff_accounts'").fetchone())
            self.assertEqual(conn.execute("SELECT email FROM account_profiles WHERE id=429 AND account_type='staff'").fetchone()[0], "vinnyhuang.ipuregreen@gmail.com")
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM users").fetchone()[0], 1)
            for table in ("worksheets", "game_scores"):
                self.assertEqual(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 3)
        response = self.client.post("/api/auth/login", json={"account": "admin", "password": "test-password", "account_type": "staff"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get("/api/admin/staff", headers=removed_token).status_code, 401)
        self.assertEqual(self.client.get("/api/auth/me", headers=removed_token).status_code, 401)

    def test_login_uses_separate_tables_and_changed_staff_password_is_respected(self):
        for account, source, expected in (("admin", "staff", "admin"), ("Teacher@example.invalid", "staff", "teacher"), ("Student@example.invalid", "student", "student")):
            response = self.client.post("/api/auth/login", json={"account": account, "password": "test-password", "account_type": source})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["user"]["role"], expected)
            self.assertEqual(response.json()["user"]["account_type"], source)
        for account, source in (("admin", "student"), ("Student@example.invalid", "staff")):
            self.assertEqual(self.client.post("/api/auth/login", json={"account": account, "password": "test-password", "account_type": source}).status_code, 400)
        self.assertEqual(self.client.post("/api/auth/login", json={"account": "admin", "password": "sdgs2030admin"}).status_code, 400)

    def test_turso_migration_is_atomic_and_rolls_back_on_failure(self):
        # Execute the actual Hrana batch steps on SQLite, including their conditions.
        conn = database.get_db_connection()
        conn.execute("DELETE FROM admin")
        conn.execute("DELETE FROM system_settings WHERE key = 'staff_accounts_separated_v1'")
        conn.execute("INSERT INTO users (id,name,email,phone,password_hash,role) VALUES (30,'Legacy','legacy@example.invalid','1',?,'teacher')", (self.password_hash,))
        conn.execute("INSERT INTO game_scores (user_id,user_name,score,max_combo,earth_health,title_earned) VALUES (30,'Legacy',1,1,100,'Test')")
        conn.execute("CREATE TRIGGER block_staff_move BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'migration test failure'); END")
        conn.commit()

        def post(url, headers, json, timeout):
            steps = json["requests"][0]["batch"]["steps"]
            success, errors = [], []

            def condition(cond):
                if cond["type"] == "ok":
                    return success[cond["step"]]
                if cond["type"] == "not":
                    return not condition(cond["cond"])
                return all(condition(item) for item in cond["conds"])

            for step in steps:
                ok, error = False, None
                if "condition" not in step or condition(step["condition"]):
                    try:
                        conn.execute(step["stmt"]["sql"])
                        ok = True
                    except Exception as exc:
                        error = {"message": str(exc)}
                success.append(ok)
                errors.append(error)
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"results": [{"type": "ok", "response": {"result": {"step_errors": errors}}}]})

        cursor = database.TursoCursor(SimpleNamespace(base_url="https://test.invalid", auth_token="test"))
        try:
            with patch("app.database.requests.post", side_effect=post):
                with self.assertRaisesRegex(RuntimeError, "migration test failure"):
                    database.migrate_staff_accounts(cursor)
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM admin").fetchone()[0], 0)
                self.assertEqual(conn.execute("SELECT account_type FROM game_scores WHERE user_id = 30").fetchone()[0], "student")
                self.assertIsNone(conn.execute("SELECT value FROM system_settings WHERE key = 'staff_accounts_separated_v1'").fetchone())
                conn.execute("DROP TRIGGER block_staff_move")
                database.migrate_staff_accounts(cursor)
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM admin WHERE id = 30").fetchone()[0], 1)
                self.assertEqual(conn.execute("SELECT account_type FROM game_scores WHERE user_id = 30").fetchone()[0], "staff")
        finally:
            conn.close()

    def test_equal_ids_do_not_share_worksheets_or_game_records(self):
        with database.get_db() as conn:
            conn.execute("INSERT INTO users (id,name,email,phone,password_hash) VALUES (20,'Different student','different@example.invalid','001',?)", (self.password_hash,))
        other = self.headers(20, "Different student", "student")
        self.assertEqual(self.client.get("/api/auth/me", headers=other).json()["name"], "Different student")
        self.assertEqual(self.client.get("/api/worksheets?mine=true", headers=other).json(), [])
        for suffix in ("", "/export-docx"):
            self.assertEqual(self.client.get("/api/worksheets/2" + suffix, headers=other).status_code, 403)
        self.assertEqual(self.client.delete("/api/worksheets/2", headers=other).status_code, 403)
        self.assertIsNone(self.client.get("/api/game/leaderboard", headers=other).json()["my_best"])
        self.assertEqual(self.client.get("/api/game/leaderboard", headers=self.admin).json()["my_best"]["score"], 2000)
        own = self.client.get("/api/worksheets?mine=true", headers=self.admin).json()
        self.assertEqual([row["user_name"] for row in own], ["Admin"])

    def test_staff_crud_import_export_stays_out_of_students(self):
        payload = {"name": "New staff", "email": "new@example.invalid", "phone": "555", "role": "teacher", "password": "test-password"}
        response = self.client.post("/api/admin/staff", headers=self.admin, json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        account_id = response.json()["id"]
        response = self.client.put(f"/api/admin/staff/{account_id}", headers=self.admin, json={**payload, "name": "Updated"})
        self.assertEqual(response.status_code, 200, response.text)
        imported = self.client.post("/api/admin/staff/batch-import", headers=self.admin, json={"students": [{"name": "Imported", "email": "imported@example.invalid", "role": "admin"}]})
        self.assertEqual(imported.json()["imported_count"], 1)
        students = self.client.get("/api/admin/students", headers=self.admin).json()["items"]
        self.assertEqual([row["name"] for row in students], ["Student"])
        self.assertIn("Updated", self.client.get("/api/admin/staff/export-csv", headers=self.admin).text)
        self.assertNotIn("Updated", self.client.get("/api/admin/students/export-csv", headers=self.admin).text)
        self.assertEqual(self.client.delete(f"/api/admin/students/{account_id}", headers=self.admin).status_code, 200)
        self.assertIn(account_id, [row["id"] for row in self.client.get("/api/admin/staff", headers=self.admin).json()["items"]])
        self.assertEqual(self.client.post("/api/admin/staff/batch-delete", headers=self.admin, json={"ids": [account_id]}).json()["deleted_count"], 1)
        self.assertEqual(self.client.delete("/api/admin/staff/20", headers=self.admin).status_code, 400)
        self.assertEqual(self.client.post("/api/admin/staff/batch-delete", headers=self.admin, json={"ids": [20, 21]}).status_code, 400)

    def test_roles_cannot_be_moved_between_tables_via_crud_or_import(self):
        payload = {"name": "Test", "email": "x@example.invalid", "phone": "1"}
        for source, role, account_id in (("students", "admin", 1), ("staff", "student", 20)):
            for method, endpoint in ((self.client.post, f"/api/admin/{source}"), (self.client.put, f"/api/admin/{source}/{account_id}")):
                self.assertEqual(method(endpoint, headers=self.admin, json={**payload, "role": role}).status_code, 422)
            response = self.client.post(f"/api/admin/{source}/batch-import", headers=self.admin, json={"students": [{**payload, "role": role}]})
            self.assertEqual(response.status_code, 400)
        for method, endpoint, body in (("GET", "/api/admin/staff", None), ("POST", "/api/admin/staff", payload), ("PUT", "/api/admin/staff/21", payload), ("DELETE", "/api/admin/staff/21", None), ("POST", "/api/admin/staff/batch-delete", {"ids": [21]}), ("POST", "/api/admin/staff/batch-import", {"students": [payload]}), ("GET", "/api/admin/staff/export-csv", None)):
            self.assertEqual(self.client.request(method, endpoint, headers=self.student, json=body).status_code, 403)
