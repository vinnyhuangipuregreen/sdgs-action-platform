import csv
import io
import os
import tempfile
import unittest

os.environ["DATABASE_PATH"] = ":memory:"
os.environ.pop("TURSO_DATABASE_URL", None)
os.environ.pop("TURSO_AUTH_TOKEN", None)

from docx import Document
from fastapi.testclient import TestClient
from app import database
from app.auth import create_access_token
from app.main import app


class ActivityDescriptionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        database.DB_PATH = os.path.join(self.temp.name, "worksheets.db")
        database._DB_INITIALIZED = False
        database.init_db()
        with database.get_db() as conn:
            conn.cursor().execute("INSERT INTO users (id,name,email,phone,password_hash,role) VALUES (1,'Test','test@example.invalid','000','test','student')")
        self.client = TestClient(app)
        self.student = self.headers("student")
        self.admin = self.headers("admin")
        self.payload = {"unit_name": "Test", "center_action": "環保", "center_custom": "淨灘", "activity_description": "親子共同參與淨灘", "radial_data": [], "tradeoff_data": [], "self_checks": [], "commitment": {}, "status": "draft"}

    def headers(self, role):
        token = create_access_token({"id": 1, "name": "Test", "email": "test@example.invalid", "role": role})
        return {"Authorization": "Bearer " + token}

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def save(self):
        response = self.client.post("/api/worksheets", headers=self.student, json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["id"]

    def test_student_save_reload_update_and_admin_exports(self):
        description = "活動目的：守護海洋\n參與對象：親子\n<script>保留原文</script>"
        self.payload["activity_description"] = description
        worksheet_id = self.save()
        url = f"/api/worksheets/{worksheet_id}"
        self.assertEqual(self.client.get(url, headers=self.student).json()["activity_description"], description)
        self.payload["activity_description"] += "\n進行方式：分類清理海岸"
        self.payload["status"] = "submitted"
        response = self.client.put(url, headers=self.student, json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        description = self.payload["activity_description"]
        self.assertEqual(self.client.get(url, headers=self.admin).json()["activity_description"], description)
        self.assertEqual(self.client.get("/api/worksheets?mine=true", headers=self.student).json()[0]["activity_description"], description)
        self.assertEqual(self.client.get("/api/worksheets", headers=self.admin).json()[0]["activity_description"], description)
        exported = self.client.get("/api/admin/export/csv", headers=self.admin)
        rows = list(csv.DictReader(io.StringIO(exported.content.decode("utf-8-sig").lstrip("\ufeff"))))
        self.assertEqual(rows[0]["活動簡介及說明"], description)
        exported = self.client.get(url + "/export-docx", headers=self.admin)
        self.assertEqual(exported.status_code, 200)
        document = Document(io.BytesIO(exported.content))
        self.assertIn(description, [paragraph.text for paragraph in document.paragraphs])
        self.payload["activity_description"] = ""
        self.assertEqual(self.client.put(url, headers=self.student, json=self.payload).status_code, 422)
        self.assertEqual(self.client.get(url, headers=self.student).json()["activity_description"], description)

    def test_description_is_required_for_create_and_update(self):
        worksheet_id = self.save()
        for status in ("draft", "submitted"):
            for description in (None, "", " \n\t "):
                payload = {**self.payload, "status": status}
                if description is None:
                    payload.pop("activity_description")
                else:
                    payload["activity_description"] = description
                with self.subTest(status=status, description=description):
                    self.assertEqual(self.client.post("/api/worksheets", headers=self.student, json=payload).status_code, 422)
                    self.assertEqual(self.client.put(f"/api/worksheets/{worksheet_id}", headers=self.student, json=payload).status_code, 422)

    def test_existing_database_migration_keeps_records_and_is_repeatable(self):
        worksheet_id = self.save()
        with database.get_db() as conn:
            conn.cursor().execute("ALTER TABLE worksheets DROP COLUMN activity_description")
        for _ in range(2):
            database._DB_INITIALIZED = False
            database.init_db()
        loaded = self.client.get(f"/api/worksheets/{worksheet_id}", headers=self.student).json()
        self.assertEqual(loaded["center_custom"], "淨灘")
        self.assertEqual(loaded["activity_description"], "")
