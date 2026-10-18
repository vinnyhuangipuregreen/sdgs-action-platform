import io
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch
from urllib.parse import unquote
from docx import Document
from tests import test_causal_worksheets as fixtures


class WorksheetDownloadTests(unittest.TestCase):
    setUp = fixtures.CausalWorksheetTests.setUp
    tearDown = fixtures.CausalWorksheetTests.tearDown
    save = fixtures.CausalWorksheetTests.save

    def test_history_doc_has_download_timestamp_and_word_compatible_content(self):
        worksheet_id, _ = self.save({"chains": self.chains})
        with fixtures.database.get_db() as conn:
            conn.execute("UPDATE worksheets SET user_name=? WHERE id=?", ("李O立", worksheet_id))
        with patch("app.main.datetime") as clock:
            clock.now.return_value = datetime(2026, 10, 19, 2, 21, 33, tzinfo=timezone(timedelta(hours=8)))
            response = self.client.get(f"/api/worksheets/{worksheet_id}/export-docx?format=doc", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertIn("連動分析練習單_李O立_20261019022133.doc", unquote(response.headers["content-disposition"]))
        self.assertEqual(response.headers["content-type"], "application/msword")
        self.assertTrue(response.content.startswith(b"{\\rtf1"))
        self.assertIn(b"\\trowd", response.content)
        for chain in self.chains:
            self.assertIn(chain["measurement"].encode(), response.content)

    def test_docx_export_keeps_its_real_format(self):
        worksheet_id, _ = self.save({"chains": self.chains})
        response = self.client.get(f"/api/worksheets/{worksheet_id}/export-docx", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"PK"))
        self.assertTrue(Document(io.BytesIO(response.content)).tables)

    def test_doc_download_requires_the_original_authorization(self):
        worksheet_id, _ = self.save({"chains": self.chains})
        response = self.client.get(f"/api/worksheets/{worksheet_id}/export-docx?format=doc")
        self.assertIn(response.status_code, (401, 403))
