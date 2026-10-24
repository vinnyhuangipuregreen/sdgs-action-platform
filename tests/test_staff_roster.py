import io
import unittest
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote
from unittest.mock import patch
from openpyxl import load_workbook
from app.accounts import get_accounts_db
from app.auth import verify_password
from app.student_roster import STAFF_HEADERS
from tests.test_student_roster import workbook_bytes
from tests import test_staff_accounts as fixtures


class StaffRosterTests(unittest.TestCase):
    setUp = fixtures.StaffAccountsTests.setUp
    tearDown = fixtures.StaffAccountsTests.tearDown
    headers = fixtures.StaffAccountsTests.headers

    values = ["管理員", "new-admin@example.invalid", "backup@example.invalid", "00123456", "0012", "綠色公益基金會", "系統管理員"]

    def upload(self, content, filename="admins.xlsx", headers=None):
        return self.client.post("/api/admin/staff/import-xlsx", headers=headers or self.admin,
            files={"file": (filename, content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})

    def test_seven_fields_export_and_login_password_preserve_original_values(self):
        result = self.upload(workbook_bytes([self.values], STAFF_HEADERS))
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["imported_count"], 1)
        with get_accounts_db() as conn:
            row = conn.execute("SELECT * FROM admin WHERE email=?", (self.values[1],)).fetchone()
            self.assertTrue(verify_password(self.values[3], row["password_hash"]))
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM student WHERE email=?", (self.values[1],)).fetchone()[0], 0)
        with patch("app.main.datetime") as clock:
            clock.now.return_value = datetime(2026, 10, 24, 9, 5, 6, tzinfo=timezone(timedelta(hours=8)))
            result = self.client.get("/api/admin/staff/export-xlsx", headers=self.admin)
            self.assertEqual(clock.now.call_args.args[0].utcoffset(None), timedelta(hours=8))
        self.assertEqual(result.status_code, 200)
        self.assertIn("管理員_20261024090506.xlsx", unquote(result.headers["content-disposition"]))
        self.assertIn("spreadsheetml.sheet", result.headers["content-type"])
        sheet = load_workbook(io.BytesIO(result.content)).active
        self.assertEqual(tuple(c.value for c in sheet[1]), STAFF_HEADERS)
        imported = next(row for row in sheet if row[1].value == self.values[1])
        self.assertEqual([c.value for c in imported], self.values)
        self.assertTrue(all(c.data_type == "s" and c.number_format == "@" for c in imported))

    def test_bad_files_and_invalid_rows_never_partially_import(self):
        invalid = [*self.values[:4], "", *self.values[5:]]
        cases = [(b"bad file", "admins.xlsx"), (workbook_bytes([self.values], STAFF_HEADERS), "admins.csv"),
                 (workbook_bytes([self.values], ("wrong",)), "admins.xlsx"),
                 (workbook_bytes([self.values, invalid], STAFF_HEADERS), "admins.xlsx"),
                 (workbook_bytes([["=1+1", *self.values[1:]]], STAFF_HEADERS), "admins.xlsx"),
                 (workbook_bytes([[*self.values[:6], "student"]], STAFF_HEADERS), "admins.xlsx")]
        with get_accounts_db() as conn:
            before = conn.execute("SELECT COUNT(*) FROM admin").fetchone()[0]
        for content, filename in cases:
            self.assertEqual(self.upload(content, filename).status_code, 400)
            with get_accounts_db() as conn:
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM admin").fetchone()[0], before)

    def test_pasted_rows_require_units_and_role_and_students_cannot_access_files(self):
        row = dict(zip(("name", "email", "email_backup", "phone", "unit_code", "unit_name", "role"), self.values))
        for field in ("name", "email", "phone", "unit_code", "unit_name", "role"):
            result = self.client.post("/api/admin/staff/batch-import", headers=self.admin, json={"students": [{**row, field: ""}]})
            self.assertEqual(result.status_code, 400)
        self.assertEqual(self.client.post("/api/admin/staff/batch-import", headers=self.admin, json={"students": [row]}).status_code, 200)
        self.assertEqual(self.upload(workbook_bytes([self.values], STAFF_HEADERS), headers=self.student).status_code, 403)
        self.assertEqual(self.client.get("/api/admin/staff/export-xlsx", headers=self.student).status_code, 403)
