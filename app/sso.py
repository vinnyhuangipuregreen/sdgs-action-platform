"""Single-use PKCE tickets for the course module; access tokens never enter URLs."""
import hashlib
import base64
import secrets
import time
from pathlib import Path
from fastapi import Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from app.accounts import get_accounts_db
from app.auth import create_access_token, get_account_type

CALLBACK = "https://sdgs-attendance-record.vercel.app/auth/sso/callback"


class TicketRequest(BaseModel):
    client_id: str
    redirect_uri: str
    code_challenge: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")


class ExchangeRequest(BaseModel):
    code: str = Field(min_length=40, max_length=128)
    code_verifier: str = Field(pattern=r"^[A-Za-z0-9._~-]{43,128}$")
    client_id: str
    redirect_uri: str


def validate_client(request):
    if request.client_id != "attendance" or request.redirect_uri != CALLBACK:
        raise HTTPException(400, "不支援的登入目的地")


def profile(user_id, account_type):
    table = "admin" if account_type == "staff" else "student"
    with get_accounts_db() as connection:
        cursor = connection.cursor()
        cursor.execute(f"SELECT id,name,email,email_backup,phone,unit_code,unit_name,role FROM {table} WHERE id=?", (user_id,))
        row = cursor.fetchone()
    if not row:
        raise HTTPException(401, "帳號不存在或已被移除")
    return dict(row)


def install_sso(app, require_user):
    @app.get("/sso/authorize", response_class=HTMLResponse)
    def authorize_page():
        return HTMLResponse((Path(__file__).parent / "templates/index.html").read_text(encoding="utf-8"),
                            headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})

    @app.post("/api/auth/logout")
    def revoke_session(user=Depends(require_user)):
        with get_accounts_db() as connection:
            cursor = connection.cursor()
            cursor.execute("DELETE FROM sso_revoked_sessions WHERE expires_at<=?", (int(time.time()),))
            cursor.execute("INSERT OR REPLACE INTO sso_revoked_sessions VALUES (?,?)", (user["session_id"], user["exp"]))
        return {"success": True}

    @app.get("/api/auth/sso/roster")
    def roster(user=Depends(require_user)):
        if user["role"] not in ("admin", "teacher"):
            raise HTTPException(403, "需要管理權限")
        with get_accounts_db() as connection:
            cursor = connection.cursor()
            cursor.execute("SELECT id,name,email,email_backup,phone,unit_code,unit_name,role,'student' AS account_type FROM student ORDER BY id")
            return [dict(row) for row in cursor.fetchall()]

    @app.post("/api/auth/sso/ticket")
    def issue_ticket(request: TicketRequest, user=Depends(require_user)):
        validate_client(request)
        code = secrets.token_urlsafe(32)
        now = int(time.time())
        with get_accounts_db() as connection:
            cursor = connection.cursor()
            ensure_ticket_table(cursor)
            cursor.execute("DELETE FROM sso_tickets WHERE expires_at <= ?", (now,))
            cursor.execute("INSERT INTO sso_tickets VALUES (?,?,?,?,?,?,?,?)", (
                hashlib.sha256(code.encode()).hexdigest(), request.code_challenge, user["user_id"],
                get_account_type(user), user["email"], now + 60, user["session_id"], user["exp"]))
        return {"code": code}

    @app.post("/api/auth/sso/exchange")
    def exchange_ticket(request: ExchangeRequest):
        validate_client(request)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(request.code_verifier.encode()).digest()).decode().rstrip("=")
        with get_accounts_db() as connection:
            cursor = connection.cursor()
            ensure_ticket_table(cursor)
            cursor.execute("""DELETE FROM sso_tickets WHERE code_hash=? AND challenge=? AND expires_at>?
                RETURNING user_id, account_type, email, session_id, session_expires""", (
                hashlib.sha256(request.code.encode()).hexdigest(), challenge, int(time.time())))
            ticket = cursor.fetchone()
        if not ticket:
            raise HTTPException(401, "登入授權已失效，請重新開始登入")
        account = profile(ticket["user_id"], ticket["account_type"])
        if account["email"] != ticket["email"]:
            raise HTTPException(401, "帳號已變更，請重新登入")
        if ticket["session_expires"] <= int(time.time()) or session_revoked(ticket["session_id"]):
            raise HTTPException(401, "系統已登出，請重新登入")
        return {"access_token": create_access_token({**account, "session_id": ticket["session_id"]}, expires_in=ticket["session_expires"] - int(time.time())), "user": {**account, "account_type": ticket["account_type"]}}


def session_revoked(session_id):
    with get_accounts_db() as connection:
        cursor = connection.cursor()
        cursor.execute("CREATE TABLE IF NOT EXISTS sso_revoked_sessions (session_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)")
        cursor.execute("SELECT 1 FROM sso_revoked_sessions WHERE session_id=? AND expires_at>?", (session_id, int(time.time())))
        return cursor.fetchone() is not None


def ensure_ticket_table(cursor):
    cursor.execute("""CREATE TABLE IF NOT EXISTS sso_tickets (
        code_hash TEXT PRIMARY KEY, challenge TEXT NOT NULL, user_id INTEGER NOT NULL,
        account_type TEXT NOT NULL, email TEXT NOT NULL, expires_at INTEGER NOT NULL, session_id TEXT NOT NULL, session_expires INTEGER NOT NULL)""")
