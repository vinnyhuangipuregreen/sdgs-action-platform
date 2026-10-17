import os
import tempfile
import unittest
from unittest.mock import patch

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
