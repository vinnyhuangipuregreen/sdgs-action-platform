"""Dedicated identity database; activity records stay in the module database."""
import os
import sqlite3
from contextlib import contextmanager
from app.database import get_db, TursoConnection


def accounts_separated():
    configured = bool(os.getenv("ROLE_DATABASE_URL") or os.getenv("ROLE_AUTH_TOKEN") or os.getenv("ROLE_DATABASE_PATH"))
    if os.getenv("VERCEL") and not configured:
        raise RuntimeError("雲端部署必須設定獨立帳號資料庫，禁止在活動庫重建帳號表")
    return configured


@contextmanager
def get_accounts_db():
    if not accounts_separated():
        with get_db() as connection:
            yield connection
        return
    url, token = os.getenv("ROLE_DATABASE_URL", "").strip(), os.getenv("ROLE_AUTH_TOKEN", "").strip()
    if bool(url) != bool(token):
        raise RuntimeError("請同時設定 ROLE_DATABASE_URL 與 ROLE_AUTH_TOKEN")
    if url:
        if url != "libsql://sdgs-role-permission-vinnyhuangipuregreen.aws-ap-northeast-1.turso.io":
            raise RuntimeError("帳號資料必須使用 sdgs-role-permission")
        connection = TursoConnection(url, token)
    else:
        connection = sqlite3.connect(os.environ["ROLE_DATABASE_PATH"], check_same_thread=False)
        connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def account_profiles():
    with get_accounts_db() as connection:
        cursor = connection.cursor()
        cursor.execute("""SELECT id, email, email_backup, phone, unit_code, 'student' AS account_type FROM student
            UNION ALL SELECT id, email, email_backup, phone, unit_code, 'staff' AS account_type FROM admin""")
        return {(row["account_type"], row["id"]): dict(row) for row in cursor.fetchall()}


def enrich_worksheets(rows, email_alias="email"):
    profiles = account_profiles()
    for row in rows:
        profile = profiles.get((row["account_type"], row["user_id"]))
        row.update({email_alias: profile["email"] if profile else "", **{key: profile[key] if profile else "" for key in ("email_backup", "phone", "unit_code")}})
    return rows
