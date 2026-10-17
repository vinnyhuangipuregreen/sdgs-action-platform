import json
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
from app.auth import create_access_token
from app.main import app


class MatchingBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        database.DB_PATH = os.path.join(self.temp.name, "bridge.db")
        database._DB_INITIALIZED = False
        database.init_db()
        with database.get_db() as conn:
            conn.execute("INSERT INTO admin (id,name,email,phone,password_hash,role) VALUES (1,'Test','admin','1','test','admin')")
        self.client = TestClient(app)
        self.token = create_access_token({"id": 1, "name": "Test", "email": "admin", "role": "admin"})
        self.headers = {"Authorization": "Bearer " + self.token}

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def test_requires_management_permission_and_limits_destination(self):
        self.assertEqual(self.client.get("/api/matching-admin/stats").status_code, 401)
        student = create_access_token({"id": 1, "name": "Student", "email": "student", "role": "student"})
        self.assertEqual(self.client.get("/api/matching-admin/stats", headers={"Authorization": "Bearer " + student}).status_code, 403)
        with patch("app.matching_bridge.requests.request") as upstream:
            self.assertEqual(self.client.get("/api/matching-admin/https://other.invalid", headers=self.headers).status_code, 404)
            upstream.assert_not_called()

    def test_forwards_verified_identity_filters_and_csv_without_copying_accounts(self):
        response = SimpleNamespace(status_code=200, content=b"id,score\n1,100\n", headers={"Content-Type": "text/csv", "Content-Disposition": "attachment; filename=records.csv"})
        with patch("app.matching_bridge.requests.request", return_value=response) as upstream:
            result = self.client.get("/api/matching-admin/export/csv?mode=standard", headers=self.headers)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.content, response.content)
        self.assertIn("records.csv", result.headers["content-disposition"])
        self.assertEqual(upstream.call_args.args[1], "https://sdgs-matching-game.vercel.app/api/admin/export/csv")
        self.assertEqual(upstream.call_args.kwargs["headers"]["Authorization"], "Bearer platform:" + self.token)
        self.assertEqual(upstream.call_args.kwargs["params"], [("mode", "standard")])

    def test_target_updates_keep_original_payload_and_upstream_errors(self):
        response = SimpleNamespace(status_code=400, content=b'{"detail":"invalid"}', headers={"Content-Type": "application/json"})
        payload = {"description": "測試", "is_active": False}
        with patch("app.matching_bridge.requests.request", return_value=response) as upstream:
            result = self.client.put("/api/matching-admin/targets/10", headers=self.headers, json=payload)
        self.assertEqual(result.status_code, 400)
        self.assertEqual(json.loads(upstream.call_args.kwargs["data"]), payload)

    def test_homepage_and_admin_program_preserve_functional_elements(self):
        html = self.client.get("/").text
        for element in ("tabPane_home", "tabPane_worksheet", "tabPane_carbon", "tabPane_food", "matchingAdminFrame", "studentPageInfo"):
            self.assertIn(f'id="{element}"', html)
        admin = self.client.get("/matching-admin").text
        for element in ("records-tbody", "targets-tbody", "settings-form", "kpi-challengers"):
            self.assertIn(f'id="{element}"', admin)
