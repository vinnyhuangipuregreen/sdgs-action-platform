"""Academic-year registry, annual enrollment and module provisioning."""
import re
import json
import os
import requests
from fastapi import Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator
from app.database import get_db, init_db
from app.accounts import get_accounts_db
from app.auth import create_access_token, decode_access_token
from app.year_scope import current_year_id, initialize_scope, table_name, MODULE_TABLES
from starlette.concurrency import run_in_threadpool

MODULES = {
    "matching": "https://sdgs-matching-game.vercel.app",
    "attendance": "https://sdgs-attendance-record.vercel.app",
}
ROSTER_FIELDS = ("name", "email_backup", "phone", "unit_code", "unit_name")
_REGISTRY_READY = set()


def ensure_registry():
    init_db()
    from app import database
    key=(str(database.DB_PATH),os.getenv('TURSO_DATABASE_URL'),os.getenv('ROLE_DATABASE_URL'),os.getenv('ROLE_DATABASE_PATH'))
    if key in _REGISTRY_READY:
        return
    with get_db(unscoped=True) as conn:
        cursor = conn.cursor()
        cursor.execute("""CREATE TABLE IF NOT EXISTS academic_years (
            id INTEGER PRIMARY KEY, year INTEGER NOT NULL,
            start_month TEXT NOT NULL, end_month TEXT NOT NULL,
            source_id INTEGER, status TEXT NOT NULL DEFAULT 'initializing')""")
        cursor.execute("CREATE TABLE IF NOT EXISTS academic_enrollments (year_id INTEGER NOT NULL, student_id INTEGER NOT NULL, PRIMARY KEY(year_id,student_id))")
        cursor.execute("PRAGMA table_info(academic_enrollments)")
        if "profile_json" not in {row["name"] for row in cursor.fetchall()}:
            cursor.execute("ALTER TABLE academic_enrollments ADD COLUMN profile_json TEXT NOT NULL DEFAULT '{}'")
        cursor.execute("INSERT OR IGNORE INTO academic_years VALUES (1,2026,'202609','202706',NULL,'active')")
        cursor.execute("CREATE TABLE IF NOT EXISTS academic_migrations (name TEXT PRIMARY KEY)")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS academic_year_active_name ON academic_years(year) WHERE status<>'deleted'")
        cursor.execute("SELECT name FROM academic_migrations WHERE name='enroll_2026'")
        if not cursor.fetchone():
            with get_accounts_db() as accounts:
                students = accounts.cursor().execute("SELECT * FROM student").fetchall()
            snapshots=[(student['id'],json.dumps({field:student[field] for field in ROSTER_FIELDS},ensure_ascii=False)) for student in students]
            cursor.executemany("INSERT OR IGNORE INTO academic_enrollments (year_id,student_id,profile_json) VALUES (1,?,?)",snapshots)
            cursor.execute("INSERT INTO academic_migrations VALUES ('enroll_2026')")
    _REGISTRY_READY.add(key)


def get_year(year_id, active=True):
    ensure_registry()
    with get_db(unscoped=True) as conn:
        row = conn.cursor().execute("SELECT * FROM academic_years WHERE id=?", (year_id,)).fetchone()
    if not row or (active and row["status"] != "active"):
        raise HTTPException(404, "找不到可使用的學年度")
    return dict(row)


def enrolled(year_id, student_id):
    with get_db(unscoped=True) as conn:
        return conn.cursor().execute("SELECT 1 FROM academic_enrollments WHERE year_id=? AND student_id=?", (year_id, student_id)).fetchone() is not None


def enroll(year_id, student_id, profile=None):
    with get_db(unscoped=True) as conn:
        snapshot = json.dumps({field:profile.get(field,"") for field in ROSTER_FIELDS},ensure_ascii=False) if profile else '{}'
        conn.cursor().execute("INSERT INTO academic_enrollments (year_id,student_id,profile_json) VALUES (?,?,?) ON CONFLICT(year_id,student_id) DO UPDATE SET profile_json=excluded.profile_json", (year_id, student_id,snapshot))


def annual_profile(profile, year_id):
    with get_db(unscoped=True) as conn:
        row=conn.cursor().execute("SELECT profile_json FROM academic_enrollments WHERE year_id=? AND student_id=?", (year_id,profile["id"])).fetchone()
    return {**profile, **(json.loads(row[0]) if row else {})}


def annual_profiles(profiles, year_id):
    with get_db(unscoped=True) as conn:
        rows=conn.cursor().execute("SELECT student_id,profile_json FROM academic_enrollments WHERE year_id=?", (year_id,)).fetchall()
    snapshots={row[0]:json.loads(row[1]) for row in rows}
    return [{**profile,**snapshots.get(profile["id"],{})} for profile in profiles]


def enrollment_filter():
    ids = ','.join(str(int(value)) for value in student_ids()) or 'NULL'
    return f"id IN ({ids})"


def student_ids():
    with get_db(unscoped=True) as conn:
        return [row[0] for row in conn.cursor().execute("SELECT student_id FROM academic_enrollments WHERE year_id=?", (current_year_id.get(),)).fetchall()]


class YearWrite(BaseModel):
    year: int = Field(ge=2026, le=2050)
    start_month: str = Field(pattern=r"^20\d{2}(0[1-9]|1[0-2])$")
    end_month: str = Field(pattern=r"^20\d{2}(0[1-9]|1[0-2])$")
    source_id: int | None = None

    @model_validator(mode="after")
    def ordered(self):
        if self.end_month < self.start_month:
            raise ValueError("期間結束月份不可早於開始月份")
        return self


def module_call(module, method, path, token, body=None):
    try:
        response = requests.request(method, MODULES[module] + path,
            headers={"Authorization": "Bearer " + ("platform:" if module == "matching" else "") + token},
            json=body, timeout=(5, 30), allow_redirects=False)
        if response.status_code != 200:
            raise ValueError("module rejected request")
        data=response.json()
        if method == 'POST' and (not isinstance(data,dict) or data.get('success') is not True):
            raise ValueError('module initialization incomplete')
        if method == 'GET' and (not isinstance(data,dict) or not data or any(type(count) is not int or count<0 for count in data.values())):
            raise ValueError('module dependency counts unavailable')
        return data
    except (requests.RequestException, ValueError) as error:
        raise HTTPException(503, f"{module} 學年度資料暫時無法確認，請稍後重試") from error


def install_years(app, require_admin, require_user):
    @app.middleware("http")
    async def year_context(request: Request, call_next):
        if not request.url.path.startswith(("/api/", "/attendance-admin/")):
            return await call_next(request)
        token = request.headers.get("authorization", "").removeprefix("Bearer ") or request.query_params.get("token", "")
        if not token and request.url.path.startswith("/attendance-admin/"):
            token = request.cookies.get("attendance_admin_session", "")
        payload = decode_access_token(token) if token else None
        try:
            hint = request.headers.get("x-academic-year", request.query_params.get("academic_year_id"))
            requested = int(hint or "1")
            year_id = int(payload.get("academic_year_id", 1)) if payload else requested
            if payload and hint is not None and requested != year_id:
                raise HTTPException(403, "請先切換學年度，不能跨年度存取資料")
            if year_id != 1:
                await run_in_threadpool(get_year,year_id)
            context = current_year_id.set(year_id)
            try:
                return await call_next(request)
            finally:
                current_year_id.reset(context)
        except HTTPException as error:
            return JSONResponse({"detail": error.detail}, status_code=error.status_code)
        except ValueError:
            return JSONResponse({"detail": "學年度參數無效"}, status_code=400)

    @app.get("/api/academic-years")
    def years():
        ensure_registry()
        with get_db(unscoped=True) as conn:
            return [dict(row) for row in conn.cursor().execute("SELECT * FROM academic_years WHERE status='active' ORDER BY year DESC").fetchall()]

    @app.get("/api/admin/academic-years")
    def admin_years(search: str = "", user=Depends(require_admin)):
        ensure_registry()
        with get_db(unscoped=True) as conn:
            return [dict(row) for row in conn.cursor().execute("SELECT * FROM academic_years WHERE status<>'deleted' AND CAST(year AS TEXT) LIKE ? ORDER BY year DESC", (f"%{search}%",)).fetchall()]

    @app.post("/api/auth/academic-year/{year_id}")
    def switch_year(year_id: int, user=Depends(require_user)):
        year = get_year(year_id)
        if user["role"] == "student" and not enrolled(year_id, user["user_id"]):
            raise HTTPException(403, "您尚未報名此學年度，請聯絡管理員")
        profile = {**user["profile"], "academic_year_id": year_id, "session_id": user["session_id"]}
        if user['role']=='student':
            profile=annual_profile(profile,year_id)
        import time
        return {"token": create_access_token(profile, max(1, user["exp"] - int(time.time()))), "academic_year": year}

    @app.post("/api/admin/academic-years")
    def create_year(item: YearWrite, request: Request, user=Depends(require_admin)):
        ensure_registry()
        with get_db(unscoped=True) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM academic_years WHERE year=? AND status<>'deleted'", (item.year,))
            existing = cursor.fetchone()
            if existing and existing["status"] == "active":
                raise HTTPException(409, "此學年度已存在")
            source = get_year(item.source_id or current_year_id.get())
            if existing:
                year_id = existing["id"]
                source = get_year(existing["source_id"])
            else:
                cursor.execute("""INSERT INTO academic_years (id,year,start_month,end_month,source_id)
                    SELECT COALESCE(MAX(id),0)+1,?,?,?,? FROM academic_years RETURNING id""",
                    (item.year,item.start_month,item.end_month,source["id"]))
                year_id = cursor.fetchone()[0]
            initialize_scope(conn, year_id, source["id"])
        token = request.headers["authorization"].removeprefix("Bearer ")
        for module in MODULES:
            module_call(module, "POST", "/api/admin/academic-years/initialize", token,
                        {"id": year_id, "source_id": source["id"]})
        with get_db(unscoped=True) as conn:
            conn.cursor().execute("UPDATE academic_years SET status='active' WHERE id=?", (year_id,))
        return get_year(year_id)

    @app.put("/api/admin/academic-years/{year_id}")
    def edit_year(year_id: int, item: YearWrite, user=Depends(require_admin)):
        get_year(year_id)
        with get_db(unscoped=True) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM academic_years WHERE year=? AND id<>? AND status<>'deleted'", (item.year, year_id))
            if cursor.fetchone():
                raise HTTPException(409, "此學年度已存在")
            cursor.execute("UPDATE academic_years SET year=?,start_month=?,end_month=? WHERE id=?", (item.year,item.start_month,item.end_month,year_id))
        return get_year(year_id)

    @app.delete("/api/admin/academic-years/{year_id}")
    def delete_year(year_id: int, request: Request, user=Depends(require_admin)):
        year = get_year(year_id)
        counts = {}
        labels = {"worksheets": "[連動分析練習單]練習單紀錄", "sdgs_goals": "[連動分析練習單]SDGs目標資料",
                  "sdgs_targets": "[連動分析練習單]SDGs細項資料", "game_scores": "[連動分析練習單]保衛英雄榜資料",
                  "action_topics": "主題類別", "action_catalog": "活動分類", "system_email_logs": "通知紀錄"}
        with get_db(unscoped=True) as conn:
            for name, label in labels.items():
                counts[label] = conn.cursor().execute(f"SELECT COUNT(*) FROM {table_name(name,year_id)}").fetchone()[0]
            counts["學員報名名冊"] = conn.cursor().execute("SELECT COUNT(*) FROM academic_enrollments WHERE year_id=?", (year_id,)).fetchone()[0]
        token = request.headers["authorization"].removeprefix("Bearer ")
        for module in MODULES:
            counts.update(module_call(module, "GET", f"/api/admin/academic-years/{year_id}/dependencies", token))
        related = []
        for label,count in counts.items():
            if count > 0:
                if label.startswith('[') and ']' in label:
                    module,record=label.split(']',1)
                    related.append(f"●{module}]已有{count}筆[{record}]")
                else:
                    related.append(f"●[管理資料]已有{count}筆[{label}]")
        if related:
            raise HTTPException(409, f"[{year['year']}]學年度資料不可刪除：\n" + "\n".join(related))
        # Keep the ID reserved and the tables intact so stale tabs can never reuse it.
        with get_db(unscoped=True) as conn:
            conn.cursor().execute("UPDATE academic_years SET status='deleted' WHERE id=?", (year_id,))
        return {"success": True}
