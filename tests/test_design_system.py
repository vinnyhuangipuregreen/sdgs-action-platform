import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def luminance(color):
    rgb = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
    rgb = [value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4 for value in rgb]
    return sum(value * weight for value, weight in zip(rgb, (.2126, .7152, .0722)))


class DesignSystemTests(unittest.TestCase):
    def test_common_text_and_module_button_colors_have_aa_contrast(self):
        css = (ROOT / "app/static/css/design-system.css").read_text(encoding="utf-8")
        colors = dict(re.findall(r"--ds-([\w-]+):\s*(#[0-9a-f]{6})", css))
        for foreground, background in [(colors[name], "#ffffff") for name in ("green-ink", "teal-ink", "blue-ink", "grass-ink", "muted", "error")]:
            light, dark = sorted((luminance(foreground), luminance(background)), reverse=True)
            self.assertGreaterEqual((light + .05) / (dark + .05), 4.5, foreground)
        self.assertIn("prefers-reduced-motion", css)
        self.assertIn(":focus-visible", css)

    def test_unconnected_modules_are_disabled_and_assets_exist(self):
        html = (ROOT / "app/templates/index.html").read_text(encoding="utf-8")
        self.assertEqual(html.count('class="ds-button module-enter" disabled>尚未開放'), 1)
        for filename in ("hero", "matching", "worksheet", "carbon", "toolbox", "food", "wishing"):
            self.assertTrue((ROOT / f"app/static/images/{filename}.png").is_file())

    def test_primary_navigation_has_the_requested_eight_items_in_order(self):
        html = (ROOT / "app/templates/index.html").read_text(encoding="utf-8")
        nav = html.split('aria-label="主要功能"', 1)[1].split("</nav>", 1)[0]
        labels = re.findall(r'</span>([^<]+)</(?:a|button)>', nav)
        self.assertEqual(labels, ["首頁", "課程登錄", "NSP數位學習", "SDGs配對挑戰賽", "連動分析練習單", "活動碳足跡盤查表", "智慧工具箱", "管理後台"])
        self.assertIn('id="adminSubPane_attendance"', html)
