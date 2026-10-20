import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import database
from app.auth import create_access_token
from app.main import app


class AttendanceBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        database.DB_PATH = os.path.join(self.temp.name, "course-bridge.db")
        database._DB_INITIALIZED = False
        database.init_db()
        with database.get_db() as conn:
            conn.execute("INSERT INTO admin (id,name,email,phone,password_hash,role) VALUES (1,'Admin','admin','1','test','admin')")
            conn.execute("INSERT INTO student (id,name,email,phone,password_hash,role) VALUES (1,'Student','student','1','test','student')")
        self.client = TestClient(app)
        self.token = create_access_token({"id": 1, "name": "Admin", "email": "admin", "role": "admin"})
        self.headers = {"Authorization": "Bearer " + self.token}

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def start(self):
        response = SimpleNamespace(status_code=200, content=b'<html><div id="panel-courses">Original course tools</div></html>', headers={"Content-Type": "text/html"})
        with patch("app.attendance_bridge.requests.request", return_value=response):
            result = self.client.get("/api/attendance-admin/view", headers=self.headers)
        self.assertEqual(result.status_code, 200)
        self.assertIn("Original course tools", result.text)
        self.assertIn("HttpOnly", result.headers["set-cookie"])
        self.assertIn("SameSite=strict", result.headers["set-cookie"])
        self.assertIn("Path=/attendance-admin", result.headers["set-cookie"])

    def test_guests_and_students_cannot_open_course_management(self):
        self.assertEqual(self.client.get("/attendance-admin/admin").status_code, 401)
        student = create_access_token({"id": 1, "name": "Student", "email": "student", "role": "student"})
        self.assertEqual(self.client.get("/api/attendance-admin/view", headers={"Authorization": "Bearer " + student}).status_code, 403)

    def test_embedded_navigation_fetches_and_styles_stay_in_the_authenticated_gateway(self):
        self.start()
        html = b'''<a href="/admin/courses/1/attendance">Attendance</a><link href="/static/css/attendance.css"><script>fetch(`/api/admin/courses/${id}`); location.reload()</script>'''
        response = SimpleNamespace(status_code=200, content=html, headers={"Content-Type": "text/html; charset=utf-8"})
        with patch("app.attendance_bridge.requests.request", return_value=response) as upstream:
            result = self.client.get("/attendance-admin/admin")
        self.assertEqual(result.status_code, 200)
        self.assertIn('href="/attendance-admin/admin/courses/1/attendance"', result.text)
        self.assertIn('href="/attendance-admin/static/css/attendance.css"', result.text)
        self.assertIn('fetch(`/attendance-admin/api/admin/courses/${id}`)', result.text)
        self.assertIn("location.replace('/attendance-admin/admin')", result.text)
        self.assertEqual(upstream.call_args.args[1], "https://sdgs-attendance-record.vercel.app/admin")
        self.assertEqual(upstream.call_args.kwargs["headers"]["Authorization"], "Bearer " + self.token)
        self.assertNotIn(self.token, result.text)
        self.assertEqual(result.headers["cache-control"], "no-store")

    def test_import_keeps_the_multipart_body_and_blocks_cross_site_writes(self):
        self.start()
        with patch("app.attendance_bridge.requests.request") as upstream:
            self.assertEqual(self.client.post("/attendance-admin/api/admin/courses/import", headers={"Origin": "https://other.invalid"}).status_code, 403)
            upstream.assert_not_called()
        response = SimpleNamespace(status_code=200, content=b'{"success":true}', headers={"Content-Type": "application/json"})
        with patch("app.attendance_bridge.requests.request", return_value=response) as upstream:
            result = self.client.post("/attendance-admin/api/admin/courses/import", headers={"Origin": "http://testserver"}, files={"file": ("courses.xlsx", b"spreadsheet-bytes")})
        self.assertEqual(result.status_code, 200)
        self.assertIn(b"spreadsheet-bytes", upstream.call_args.kwargs["data"])
        self.assertIn("multipart/form-data; boundary=", upstream.call_args.kwargs["headers"]["Content-Type"])

    def test_only_existing_course_routes_are_proxied_and_downloads_are_preserved(self):
        self.start()
        with patch("app.attendance_bridge.requests.request") as upstream:
            self.assertEqual(self.client.get("/attendance-admin/api/admin/students").status_code, 404)
            self.assertEqual(self.client.get("/attendance-admin/https://other.invalid").status_code, 404)
            upstream.assert_not_called()
        response = SimpleNamespace(status_code=200, content=b"xlsx-data", headers={"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=courses.xlsx"})
        with patch("app.attendance_bridge.requests.request", return_value=response):
            result = self.client.get("/attendance-admin/api/admin/courses/sample-excel")
        self.assertEqual(result.content, b"xlsx-data")
        self.assertIn("courses.xlsx", result.headers["content-disposition"])

    def test_shared_logout_invalidates_an_already_open_course_frame(self):
        self.start()
        self.assertEqual(self.client.post("/api/auth/logout", headers=self.headers).status_code, 200)
        with patch("app.attendance_bridge.requests.request") as upstream:
            self.assertEqual(self.client.get("/attendance-admin/admin").status_code, 401)
            upstream.assert_not_called()

    def test_attendance_export_preserves_filters_filename_and_spreadsheet_bytes(self):
        self.start()
        disposition = "attachment; filename*=UTF-8''1_course_20261020123456.xlsx"
        response = SimpleNamespace(status_code=200, content=b"xlsx-data", headers={"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": disposition})
        with patch("app.attendance_bridge.requests.request", return_value=response) as upstream:
            result = self.client.get("/attendance-admin/api/admin/courses/1/attendance/export?name=Test&status=SIGNED_IN")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.content, b"xlsx-data")
        self.assertEqual(result.headers["content-disposition"], disposition)
        self.assertEqual(upstream.call_args.kwargs["params"], [("name", "Test"), ("status", "SIGNED_IN")])

    def test_leave_export_passes_authenticated_filters_and_keeps_the_download(self):
        self.start()
        disposition = "attachment; filename*=UTF-8''1_course_leave_20261020123456.xlsx"
        response = SimpleNamespace(status_code=200, content=b"leave-xlsx-data", headers={"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": disposition})
        with patch("app.attendance_bridge.requests.request", return_value=response) as upstream:
            result = self.client.get("/attendance-admin/api/admin/courses/1/leaves/export?name=Test&email=makeup&phone=0912")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.content, b"leave-xlsx-data")
        self.assertEqual(result.headers["content-disposition"], disposition)
        self.assertEqual(upstream.call_args.kwargs["params"], [("name", "Test"), ("email", "makeup"), ("phone", "0912")])

    def test_makeup_export_passes_authenticated_filters_and_keeps_the_download(self):
        self.start()
        disposition = "attachment; filename*=UTF-8''1_course_makeup_20261020123456.xlsx"
        response = SimpleNamespace(status_code=200, content=b"makeup-xlsx-data", headers={"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": disposition})
        with patch("app.attendance_bridge.requests.request", return_value=response) as upstream:
            result = self.client.get("/attendance-admin/api/admin/courses/1/pathdemy/export?name=Test&email=makeup&phone=0912&start_date=2026-09-01&end_date=2026-09-30")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.content, b"makeup-xlsx-data")
        self.assertEqual(result.headers["content-disposition"], disposition)
        self.assertEqual(upstream.call_args.kwargs["params"], [("name", "Test"), ("email", "makeup"), ("phone", "0912"), ("start_date", "2026-09-01"), ("end_date", "2026-09-30")])
