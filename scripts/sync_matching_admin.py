"""Reuse the matching game's admin program, retaining its API/data semantics."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent
GAME = ROOT.parent / "sdgs-matching-game"


def sync():
    html = (GAME / "static/admin.html").read_text(encoding="utf-8")
    html = html.replace('class="sdgs-shell"', 'class="sdgs-shell matching-embedded"')
    html = html.replace('/static/css/style.css', '/static/css/matching-base.css')
    html = html.replace('/static/js/admin.js', '/static/js/matching-admin.js?v=20261017_design')
    html = html.replace('</body>', '''<script>
AdminApp.init = function() {
  this.token = localStorage.getItem("sdgs_token");
  this.bindEvents();
  if (this.token) this.showApp(); else this.handleLogout();
};
AdminApp.handleLogout = function() {
  window.parent.postMessage({type: "sdgs-admin-expired"}, location.origin);
};
</script></body>''')
    (ROOT / "app/templates/matching-admin.html").write_text(html, encoding="utf-8")
    js = (GAME / "static/js/admin.js").read_text(encoding="utf-8")
    js = js.replace('/api/admin/', '/api/matching-admin/').replace('/api/game/goals', '/api/matching-admin/goals')
    js = js.replace('#2563eb', '#15803d').replace('#3730a3', '#166534')
    (ROOT / "app/static/js/matching-admin.js").write_text(js, encoding="utf-8")
    shutil.copy2(GAME / "static/css/style.css", ROOT / "app/static/css/matching-base.css")
    shutil.copy2(ROOT / "app/static/css/design-system.css", GAME / "static/css/design-system.css")


if __name__ == "__main__":
    sync()
