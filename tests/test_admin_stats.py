import os
import json
import tempfile
import unittest
from unittest.mock import patch
from contextlib import contextmanager

os.environ["DATABASE_PATH"] = ":memory:"
os.environ.pop("TURSO_DATABASE_URL", None)
os.environ.pop("TURSO_AUTH_TOKEN", None)

from fastapi.testclient import TestClient
from app import database
from app.auth import create_access_token
from app.main import app


class AdminStatsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        database.DB_PATH = os.path.join(self.temp.name, "stats.db")
        database._DB_INITIALIZED = False
        database.init_db()
        with database.get_db() as conn:
            conn.cursor().execute("INSERT INTO admin (id,name,email,phone,password_hash,role) VALUES (1,'Test','test@example.invalid','000','test','admin')")
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer " + create_access_token({"id": 1, "name": "Test", "email": "test@example.invalid", "role": "admin"})}

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def stats(self):
        with patch("app.main.ensure_users_seeded"), patch("app.main.ensure_sdgs_seeded"):
            response = self.client.get("/api/admin/stats", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_empty_counts_and_draft_submission_review_transitions(self):
        stats = self.stats()
        self.assertEqual(stats["draft_worksheets"], 0)
        self.assertEqual(stats["submitted_worksheets"] + stats["reviewed_worksheets"], 0)
        with database.get_db() as conn:
            conn.cursor().executemany("""INSERT INTO worksheets
                (user_id,user_name,unit_name,center_action,radial_data,tradeoff_data,chat_text,self_checks,commitment,status)
                VALUES (1,'Test','Test','Test','[]','[]','','[]','{}',?)""",
                [(status,) for status in ("draft", "draft", "submitted", "reviewed")])
        stats = self.stats()
        self.assertEqual(stats["draft_worksheets"], 2)
        self.assertEqual(stats["submitted_worksheets"], 1)
        self.assertEqual(stats["reviewed_worksheets"], 1)
        self.assertEqual(stats["total_worksheets"], 4)
        for status in ("submitted", "reviewed"):
            with database.get_db() as conn:
                conn.cursor().execute("UPDATE worksheets SET status = ? WHERE id = 1", (status,))
            stats = self.stats()
            self.assertEqual(stats["draft_worksheets"], 1)
            self.assertEqual(stats["submitted_worksheets"] + stats["reviewed_worksheets"], 3)

    def test_formal_distribution_works_with_sqlite_and_turso_rows(self):
        with database.get_db() as conn:
            conn.executemany("""INSERT INTO worksheets
                (user_id,user_name,unit_name,center_action,radial_data,tradeoff_data,chat_text,self_checks,commitment,status)
                VALUES (1,'Test','Test',?,'[]','[]','','[]','{}',?)""",
                [(category, status) for category, status in (
                    ("文化教育", "submitted"), ("文化教育", "submitted"), ("文化教育", "reviewed"),
                    ("慈善弘揚", "submitted"), ("慈善弘揚", "submitted"), ("慈善弘揚", "reviewed"),
                    ("聯誼交流", "draft"))])

            conn.execute("UPDATE worksheets SET radial_data=? WHERE status='submitted'", (json.dumps([{"goal":"SDG 1 消除貧窮"},{"goal":"SDG 4 優質教育"},{"goal":"SDG 13 氣候行動"}]),))
            conn.execute("UPDATE worksheets SET radial_data=? WHERE status='reviewed'", (json.dumps([{"goal":"SDG 4 優質教育"},{"goal":"SDG 13 氣候行動"},{"goal":"SDG 17 夥伴關係"}]),))
            conn.execute("UPDATE worksheets SET radial_data=? WHERE status='draft'", (json.dumps([{"goal":"SDG 2 終結飢餓"}]),))

        class CloudCursor:
            def __init__(self, cursor):
                self.cursor = cursor
            def execute(self, sql, params=()):
                self.cursor.execute(sql, params)
                return self
            def convert(self, row):
                return database.TursoRow([col[0] for col in self.cursor.description], list(row)) if row is not None else None
            def fetchone(self):
                return self.convert(self.cursor.fetchone())
            def fetchall(self):
                return [self.convert(row) for row in self.cursor.fetchall()]

        class CloudConnection:
            def __init__(self, connection):
                self.connection = connection
            def cursor(self):
                return CloudCursor(self.connection.cursor())

        @contextmanager
        def cloud_db():
            with database.get_db() as conn:
                yield CloudConnection(conn)

        for backend in (database.get_db, cloud_db):
            with self.subTest(backend=backend.__name__), patch("app.main.get_db", backend):
                stats = self.stats()
                self.assertEqual(stats["center_action_distribution"], {"文化教育": 3, "慈善弘揚": 3})
                self.assertEqual(sum(stats["center_action_distribution"].values()), stats["submitted_worksheets"] + stats["reviewed_worksheets"])
                self.assertEqual(stats["draft_worksheets"], 1)
                self.assertEqual(stats["sdg_frequency"], {str(i): {1:4,4:6,13:6,17:2}.get(i,0) for i in range(1,18)})
                self.assertEqual(sum(stats["sdg_frequency"].values()), 18)
