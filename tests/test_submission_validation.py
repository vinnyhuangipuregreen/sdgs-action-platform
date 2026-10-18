import os
import tempfile
import unittest

os.environ["DATABASE_PATH"] = ":memory:"
os.environ.pop("TURSO_DATABASE_URL", None)
os.environ.pop("TURSO_AUTH_TOKEN", None)

from fastapi.testclient import TestClient
from app import database
from app.auth import create_access_token
from app.main import app


def complete_payload():
    return {
        "unit_name": "Test", "center_action": "環保", "activity_details": {field:"已填寫" for field in ("purpose","process","features","audience")},
        "radial_data": [{"goal": "SDG 13", "mechanism": "減少排放", "observable": "用電量下降"} for _ in range(3)],
        "tradeoff_data": [{"who": "植被", "situation": "踩踏", "how": "規劃步道"}],
        "causal_data": {"chains": [{field: "已填寫" for field in
            ("start", "start_cond", "mid", "mid_cond", "result", "result_cond", "impact", "measurement")}]},
        "self_checks": [True] * 4,
        "commitment": {field: "已填寫" for field in
            ("start_action", "target_1", "target_2", "risk_aware", "metric")},
        "status": "submitted",
    }


class SubmissionValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        database.DB_PATH = os.path.join(self.temp.name, "validation.db")
        database._DB_INITIALIZED = False
        database.init_db()
        with database.get_db() as conn:
            conn.cursor().execute("INSERT INTO student (id,name,email,phone,password_hash,role) VALUES (1,'Test','test@example.invalid','000','test','student')")
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer " + create_access_token({"id": 1, "name": "Test", "email": "test@example.invalid", "role": "student"})}

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def test_complete_create_and_update_succeed(self):
        payload = complete_payload()
        response = self.client.post("/api/worksheets", headers=self.headers, json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        response = self.client.put(f"/api/worksheets/{response.json()['id']}", headers=self.headers, json=payload)
        self.assertEqual(response.status_code, 200, response.text)

    def test_incomplete_submissions_rejected_without_changing_draft(self):
        draft = {**complete_payload(), "status": "draft"}
        worksheet_id = self.client.post("/api/worksheets", headers=self.headers, json=draft).json()["id"]
        cases = []
        for section in ("radial_data", "tradeoff_data"):
            payload = complete_payload()
            payload[section] = []
            cases.append(payload)
            for field in complete_payload()[section][0]:
                payload = complete_payload()
                payload[section][0][field] = " \n\t "
                cases.append(payload)
        for field in complete_payload()["causal_data"]["chains"][0]:
            payload = complete_payload()
            payload["causal_data"]["chains"][0][field] = " "
            cases.append(payload)
        for causal in (None, {}, {"chains": []}, {"chains": [None]}):
            payload = complete_payload()
            payload["causal_data"] = causal
            cases.append(payload)
        for checks in ([], [True] * 3, [True] * 5, *[[i != missing for i in range(4)] for missing in range(4)]):
            payload = complete_payload()
            payload["self_checks"] = checks
            cases.append(payload)
        for field in complete_payload()["commitment"]:
            payload = complete_payload()
            payload["commitment"][field] = " "
            cases.append(payload)
        for i, payload in enumerate(cases):
            with self.subTest(case=i):
                for method, url in ((self.client.post, "/api/worksheets"), (self.client.put, f"/api/worksheets/{worksheet_id}")):
                    response = method(url, headers=self.headers, json=payload)
                    self.assertEqual(response.status_code, 400, response.text)
                    self.assertIsInstance(response.json()["detail"], str)
        saved = self.client.get(f"/api/worksheets/{worksheet_id}", headers=self.headers).json()
        self.assertEqual(saved["status"], "draft")
        self.assertEqual(len(self.client.get("/api/worksheets?mine=true", headers=self.headers).json()), 1)

    def test_incomplete_drafts_still_save(self):
        payload = complete_payload()
        payload.update(status="draft", radial_data=[], tradeoff_data=[], causal_data=None, self_checks=[], commitment={})
        response = self.client.post("/api/worksheets", headers=self.headers, json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        response = self.client.put(f"/api/worksheets/{response.json()['id']}", headers=self.headers, json=payload)
        self.assertEqual(response.status_code, 200, response.text)
