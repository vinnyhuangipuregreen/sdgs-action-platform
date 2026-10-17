import re
import unittest
from fastapi.testclient import TestClient
from app.main import app


class LabaToolHostingTests(unittest.TestCase):
    def test_compiled_original_calculator_and_its_assets_are_served(self):
        with TestClient(app) as client:
            page = client.get("/tools/laba")
            self.assertEqual(page.status_code, 200)
            self.assertIn("臘八粥食材試算表", page.text)
            self.assertIn('href="/#food"', page.text)
            assets = re.findall(r'(?:src|href)="(/static/tools/laba/assets/[^"]+)"', page.text)
            self.assertEqual(len(assets), 2)
            for asset in assets:
                response = client.get(asset)
                self.assertEqual(response.status_code, 200)
                if asset.endswith(".css"):
                    self.assertNotIn("@tailwind", response.text)
