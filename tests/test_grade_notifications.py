import os
import smtplib
import unittest
from unittest.mock import patch

from app import database
from app.mailer import send_grade_notification
from tests import test_activity_details as fixtures


class GradeNotificationTests(unittest.TestCase):
    setUp = fixtures.ActivityDetailsTests.setUp
    tearDown = fixtures.ActivityDetailsTests.tearDown
    save = fixtures.ActivityDetailsTests.save
    headers = fixtures.ActivityDetailsTests.headers

    def notification(self):
        return send_grade_notification({"id": 1, "user_name": "Test", "email": "student@example.invalid"}, 95, "Review")

    def test_missing_smtp_is_not_reported_or_logged_as_sent(self):
        with patch.dict(os.environ, {"SMTP_HOST": "", "SMTP_USER": "", "SMTP_PASSWORD": ""}):
            result = self.notification()
        self.assertFalse(result["success"])
        with database.get_db() as conn:
            self.assertEqual(conn.execute("SELECT status FROM system_email_logs").fetchone()[0], "failed")

    def test_smtp_success_works_without_writing_to_the_deployment_filesystem(self):
        with patch.dict(os.environ, {"SMTP_HOST": "smtp.example.invalid", "SMTP_USER": "sender@example.invalid", "SMTP_PASSWORD": "test", "SMTP_PORT": "587"}), patch("app.mailer.smtplib.SMTP") as smtp, patch("builtins.open", side_effect=PermissionError("read-only filesystem")):
            result = self.notification()
        self.assertTrue(result["success"])
        smtp.return_value.__enter__.return_value.sendmail.assert_called_once()
        with database.get_db() as conn:
            self.assertEqual(conn.execute("SELECT status FROM system_email_logs").fetchone()[0], "success")

    def test_smtp_failure_is_reported_and_logged_as_failed(self):
        with patch.dict(os.environ, {"SMTP_HOST": "smtp.example.invalid", "SMTP_USER": "sender@example.invalid", "SMTP_PASSWORD": "test"}), patch("app.mailer.smtplib.SMTP", side_effect=smtplib.SMTPException("unavailable")):
            result = self.notification()
        self.assertFalse(result["success"])
        with database.get_db() as conn:
            self.assertEqual(conn.execute("SELECT status FROM system_email_logs").fetchone()[0], "failed")

    def test_saved_grade_is_reported_separately_from_failed_notification(self):
        worksheet_id = self.save()
        with patch("app.main.send_grade_notification", return_value={"success": False, "recipient": "test@example.invalid", "subject": "Review", "error": "SMTP unavailable"}):
            response = self.client.put(f"/api/admin/worksheets/{worksheet_id}/grade", headers=self.admin, json={"score": 95, "comment": "Review"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["email_sent"])
        self.assertIn("SMTP unavailable", response.json()["email_warning"])
        saved = self.client.get(f"/api/worksheets/{worksheet_id}", headers=self.admin).json()
        self.assertEqual((saved["score"], saved["teacher_comment"], saved["status"]), (95, "Review", "reviewed"))

