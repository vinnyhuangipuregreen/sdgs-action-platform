"""Synchronize presentation assets across the existing HTML, Jinja and Vite apps."""
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parents[1]
VERSION = "20261019_ui1280"
ORIGIN = "https://sdgs-action-platform.vercel.app"
NAV = [("home", "⌂", "首頁", ORIGIN + "/#home"),
       ("nsp", "📚", "NSP數位學習", ORIGIN + "/#nsp"),
       ("matching", "🏆", "SDGs配對挑戰賽", "https://sdgs-matching-game.vercel.app/"),
       ("worksheet", "▤", "連動分析練習單", ORIGIN + "/#worksheet"),
       ("carbon", "🌿", "活動碳足跡盤查表", ORIGIN + "/#carbon"),
       ("food", "🧰", "智慧工具箱", ORIGIN + "/#food"),
       ("admin", "⚙", "管理後台", ORIGIN + "/#admin")]


def header(active, account):
    links = ''.join(f'<a href="{url}"' + (' aria-current="page"' if module == active else '') + f'><span aria-hidden="true">{icon}</span>{label}</a>' for module, icon, label, url in NAV)
    return f'''<header class="platform-header" data-ui-version="{VERSION}"><div class="platform-header-inner"><a class="platform-brand" href="{ORIGIN}/"><img class="brand-globe brand-logo" src="https://sdgs-action-platform.vercel.app/static/images/ipuregreen.png" alt="iPure Green" width="58" height="58"><span><strong>佛光永續學院</strong><small>實踐永續 × 連動分析 × 行動改變 × 共創未來</small></span></a><div class="platform-account">{account}</div></div><nav class="platform-nav" aria-label="主要功能"><div class="platform-nav-inner">{links}</div></nav></header>'''


def outputs():
    css = (ROOT / 'app/static/css/design-system.css').read_bytes()
    iframe = f'<iframe class="ui-account-frame" src="{ORIGIN}/static/ui/account.html?v={VERSION}" title="目前帳號與登入"></iframe>'
    account = '''{% set profile = request.state.sso_student or request.state.sso_admin %}<span class="account-avatar" aria-hidden="true">🌱</span><div><div id="currentUserName">{{ profile.name if profile else '未登入' }}</div><div id="currentUserRole">{{ '學員' if request.state.sso_student else ('系統管理員' if profile else '訪客模式') }}</div></div><a class="ds-button ds-button-secondary" href="https://sdgs-action-platform.vercel.app/?ui=login">登入／切換帳號</a>'''
    return {
        ROOT.parent / 'sdgs-matching-game/static/css/design-system.css': css,
        ROOT.parent / 'sdgs-matching-game/app/year_scope.py': (ROOT / 'app/year_scope.py').read_bytes(),
        ROOT.parent / 'sdgs-matching-game/static/js/academic-year.js': (ROOT / 'app/static/ui/module-year.js').read_bytes(),
        ROOT.parent / 'sdgs-attendance-record/static/css/design-system.css': css,
        ROOT.parent / 'sdgs-laba-calculator/src/design-system.css': css,
        ROOT.parent / 'sdgs-laba-calculator/src/ui/platform-header.html': header('food', iframe).encode(),
        ROOT.parent / 'sdgs-attendance-record/templates/platform-nav.html': ('{% if request.headers.get("x-platform-embedded") != "1" %}\n' + header('attendance', account).replace('</a><div class="platform-account">', '</a>{% if request.state.academic_year %}<span class="academic-year-badge">學年度：{{ request.state.academic_year.year }}<br>{{ request.state.academic_year.start_month }}–{{ request.state.academic_year.end_month }}</span>{% endif %}<div class="platform-account">',1) + '\n{% endif %}\n').encode(),
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    for path, content in outputs().items():
        if args.check:
            assert path.read_bytes() == content, f'UI asset out of sync: {path}'
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
    print('Shared UI assets match ' + VERSION)
