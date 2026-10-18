import base64
import hashlib
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from contextlib import closing
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import database
from app.accounts import get_accounts_db
from app.auth import hash_password
from app.main import app
from app.sso import CALLBACK


class IdentitySsoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        database.DB_PATH = str(Path(self.temp.name) / "activities.db")
        database._DB_INITIALIZED = False
        database.init_db()
        # Copy the existing schema into an independent test identity database.
        self.role_path = str(Path(self.temp.name) / "roles.db")
        with database.get_db() as source, closing(sqlite3.connect(self.role_path)) as destination:
            for name in ("admin", "student"):
                destination.execute(source.execute("SELECT sql FROM sqlite_master WHERE name=?", (name,)).fetchone()[0])
            destination.execute("INSERT INTO student (id,name,email,phone,password_hash,role) VALUES (7,'Student','student@test.invalid','0900',?,'student')", (hash_password("pw"),))
            destination.execute("INSERT INTO admin (id,name,email,phone,password_hash,role) VALUES (3,'Admin','admin@test.invalid','0901',?,'admin')", (hash_password("pw"),))
            destination.commit()
            source.execute("DROP VIEW account_profiles")
            source.execute("DROP TABLE admin")
            source.execute("DROP TABLE student")
        self.env = patch.dict(os.environ, {"ROLE_DATABASE_PATH": self.role_path, "ROLE_DATABASE_URL": "", "ROLE_AUTH_TOKEN": ""})
        self.env.start()
        database._DB_INITIALIZED = False
        database.init_db()
        self.client = TestClient(app)
        result = self.client.post("/api/auth/login", json={"account":"student@test.invalid", "password":"pw"})
        self.assertEqual(result.status_code,200,result.text)
        self.token = result.json()["token"]
        self.headers = {"Authorization":"Bearer " + self.token}
        self.verifier = "a" * 64
        self.challenge = base64.urlsafe_b64encode(hashlib.sha256(self.verifier.encode()).digest()).decode().rstrip("=")
        self.request = {"client_id":"attendance", "redirect_uri":CALLBACK, "code_challenge":self.challenge}

    def tearDown(self):
        self.client.close()
        self.env.stop()
        self.temp.cleanup()

    def ticket(self):
        response=self.client.post("/api/auth/sso/ticket",headers=self.headers,json=self.request)
        self.assertEqual(response.status_code,200,response.text)
        return response.json()["code"]

    def test_authorization_uses_the_normal_platform_interface(self):
        response = self.client.get("/sso/authorize")
        self.assertEqual(response.status_code, 200)
        self.assertIn('id="loginModal"', response.text)
        self.assertNotIn("正在驗證系統登入", response.text)
        self.assertIn("no-store", response.headers["cache-control"])

    def test_course_student_entry_rejects_staff_sessions(self):
        admin = self.client.post("/api/auth/login", json={"account":"admin@test.invalid", "password":"pw", "account_type":"staff"}).json()["token"]
        request = {**self.request, "account_type":"student"}
        self.assertEqual(self.client.post("/api/auth/sso/ticket", headers={"Authorization":"Bearer " + admin}, json=request).status_code,403)
        self.assertEqual(self.client.post("/api/auth/sso/ticket", headers=self.headers, json=request).status_code,200)
        self.assertEqual(self.client.post("/api/auth/login",json={"account":"admin@test.invalid","password":"pw","account_type":"student"}).status_code,400)

    def exchange(self,code,verifier=None):
        return self.client.post("/api/auth/sso/exchange",json={"client_id":"attendance","redirect_uri":CALLBACK,"code":code,"code_verifier":verifier or self.verifier})

    def test_account_login_and_crud_use_only_the_identity_database(self):
        with database.get_db() as conn:
            self.assertEqual(conn.execute("SELECT name FROM sqlite_master WHERE name IN ('admin','student')").fetchall(),[])
        self.assertEqual(self.client.get("/api/auth/me",headers=self.headers).json()["id"],7)
        admin=self.client.post("/api/auth/login",json={"account":"admin@test.invalid","password":"pw","account_type":"staff"}).json()["token"]
        result=self.client.get("/api/admin/students",headers={"Authorization":"Bearer "+admin})
        self.assertEqual(result.json()["total"],1)
        response=self.client.post("/api/admin/students",headers={"Authorization":"Bearer "+admin},json={"name":"New student","email":"new@test.invalid","phone":"0902"})
        self.assertEqual(response.status_code,200,response.text)
        with get_accounts_db() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM student").fetchone()[0],2)

    def test_pkce_codes_are_single_use_and_preserve_the_account_identity(self):
        code=self.ticket()
        self.assertEqual(self.exchange(code,"b"*64).status_code,401)
        result=self.exchange(code)
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()["user"]["id"],7)
        self.assertEqual(result.json()["user"]["account_type"],"student")
        self.assertEqual(self.exchange(code).status_code,401)

    def test_expired_codes_deleted_accounts_and_untrusted_callbacks_are_rejected(self):
        bad={**self.request,"redirect_uri":"https://attacker.invalid/callback"}
        self.assertEqual(self.client.post("/api/auth/sso/ticket",headers=self.headers,json=bad).status_code,400)
        code=self.ticket()
        with get_accounts_db() as conn:
            conn.execute("UPDATE sso_tickets SET expires_at=0")
        self.assertEqual(self.exchange(code).status_code,401)
        code=self.ticket()
        with get_accounts_db() as conn:
            conn.execute("DELETE FROM student WHERE id=7")
        self.assertEqual(self.exchange(code).status_code,401)
        self.assertEqual(self.client.get("/api/auth/me",headers=self.headers).status_code,401)

    def test_signout_revokes_the_shared_session_including_exchanged_tokens(self):
        issued=self.exchange(self.ticket()).json()["access_token"]
        self.assertEqual(self.client.post("/api/auth/logout",headers=self.headers).status_code,200)
        self.assertEqual(self.client.get("/api/auth/me",headers={"Authorization":"Bearer "+issued}).status_code,401)

    def test_student_cannot_read_the_central_roster(self):
        self.assertEqual(self.client.get("/api/auth/sso/roster",headers=self.headers).status_code,403)
        self.assertEqual(self.client.get("/api/auth/sso/roster?include_profile=true",headers=self.headers).status_code,403)

    def test_course_context_combines_verified_staff_profile_and_current_roster(self):
        admin = self.client.post("/api/auth/login",json={"account":"admin@test.invalid","password":"pw","account_type":"staff"}).json()["token"]
        headers = {"Authorization":"Bearer " + admin}
        roster = self.client.get("/api/auth/sso/roster",headers=headers).json()
        context = self.client.get("/api/auth/sso/roster?include_profile=true",headers=headers).json()
        self.assertEqual(context["students"], roster)
        self.assertEqual(context["user"]["account_type"], "staff")
        self.assertEqual(context["user"]["id"], 3)
        self.assertNotIn("password_hash", context["user"])

    def test_historical_records_survive_missing_accounts_without_breaking_exports(self):
        admin=self.client.post("/api/auth/login",json={"account":"admin@test.invalid","password":"pw","account_type":"staff"}).json()["token"]
        headers={"Authorization":"Bearer "+admin}
        with database.get_db() as conn:
            conn.execute("""INSERT INTO worksheets (id,user_id,user_name,unit_name,center_action,radial_data,tradeoff_data,chat_text,self_checks,commitment)
                VALUES (12,999,'Historical student','Unit','Action','[]','[]','','[]','{}')""")
        response=self.client.get("/api/admin/export/csv",headers=headers)
        self.assertEqual(response.status_code,200,response.text)
        self.assertIn("Historical student",response.text)
        with patch("app.main.send_grade_notification") as mail:
            self.assertEqual(self.client.put("/api/admin/worksheets/12/grade",headers=headers,json={"score":90,"comment":"Review"}).status_code,404)
            mail.assert_not_called()
