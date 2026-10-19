import sys
import os
import json
import csv
import io
import random
import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any, Literal
from fastapi import FastAPI, Depends, HTTPException, Header, Query, Response, status, UploadFile, File, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, model_validator
from app.activity_details import ActivityDetails, activity_text

from app.database import get_db, init_db, get_game_settings, set_game_settings, DEFAULT_GAME_SETTINGS
from app.auth import hash_password, verify_password, create_access_token, decode_access_token, get_account_type
from app.docx_exporter import create_worksheet_docx, create_worksheet_doc
from app.mailer import send_grade_notification
from app.sdgs_check import ensure_sdgs_seeded, ensure_users_seeded
from app.action_catalog import CategoryWrite, TopicItem, list_topics, save_topic, delete_topic, list_actions, save_action, delete_action, read_import, import_actions, export_actions
from app.matching_bridge import proxy_matching_request
from app.accounts import get_accounts_db, enrich_worksheets
from app.sso import install_sso
from app.attendance_bridge import install_attendance_admin

app = FastAPI(
    title="SDGs 與氣候行動連動分析與智慧學習平台",
    description="佛光永續學院 × 佛光大學應用科技與設計學院 專案平台 v3.0",
    version="3.0.0"
)


@app.on_event("startup")
def on_startup():
    try:
        init_db()
    except Exception as e:
        print("[STARTUP] init_db deferred:", e)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")

if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

def get_current_user(
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None)
) -> Optional[dict]:
    raw_token = None
    if authorization:
        raw_token = authorization
        if raw_token.startswith("Bearer "):
            raw_token = raw_token[7:]
    elif token:
        raw_token = token
        
    if not raw_token:
        return None
    payload = decode_access_token(raw_token)
    if payload:
        from app.sso import session_revoked
        payload["session_id"] = payload.get("session_id") or hashlib.sha256(raw_token.encode()).hexdigest()
        if session_revoked(payload["session_id"]):
            return None
        table = "admin" if get_account_type(payload) == "staff" else "student"
        with get_accounts_db() as conn:
            cursor = conn.cursor()
            cursor.execute(f"SELECT id, name, email, email_backup, phone, unit_code, unit_name, role FROM {table} WHERE id = ?", (payload["user_id"],))
            account = cursor.fetchone()
            if not account or account["email"] != payload.get("email"):
                return None
            payload["role"] = account["role"]
            payload["profile"] = dict(account)
    return payload

def require_user(current_user: Optional[dict] = Depends(get_current_user)) -> dict:
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="請先登入系統")
    return current_user

def require_admin(current_user: dict = Depends(require_user)) -> dict:
    if current_user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="權限不足，需要管理員權限")
    return current_user


install_attendance_admin(app, require_admin, get_current_user)


@app.api_route("/api/matching-admin/{path:path}", methods=["GET", "PUT", "DELETE"])
async def matching_admin_api(path: str, request: Request, user: dict = Depends(require_admin)):
    return await run_in_threadpool(proxy_matching_request, request, path, await request.body())


@app.get("/matching-admin", response_class=HTMLResponse)
def matching_admin_page():
    with open(os.path.join(TEMPLATES_DIR, "matching-admin.html"), encoding="utf-8") as source:
        return source.read()


@app.get("/tools/laba", response_class=HTMLResponse)
def laba_calculator_page():
    with open(os.path.join(STATIC_DIR, "tools", "laba", "index.html"), encoding="utf-8") as source:
        html = source.read()
    return html


@app.get("/api/center-actions")
def get_center_actions():
    return list_actions()


@app.get("/api/admin/categories")
def get_categories(search: str = "", user: dict = Depends(require_admin)):
    return list_actions(search)


@app.get("/api/admin/topics")
def get_topics(user: dict = Depends(require_admin)):
    return list_topics()


@app.post("/api/admin/topics")
def create_topic(item: TopicItem, user: dict = Depends(require_admin)):
    return save_topic(item)


@app.put("/api/admin/topics/{topic_id}")
def update_topic(topic_id: int, item: TopicItem, user: dict = Depends(require_admin)):
    return save_topic(item, topic_id)


@app.delete("/api/admin/topics/{topic_id}")
def remove_topic(topic_id: int, user: dict = Depends(require_admin)):
    delete_topic(topic_id)
    return {"success": True}


@app.get("/api/admin/categories/sample.xlsx")
def download_category_sample(user: dict = Depends(require_admin)):
    return FileResponse(os.path.join(BASE_DIR, "..", "uploadfile", "category.xlsx"),
                        filename="category.xlsx", media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.post("/api/admin/categories")
def create_category(item: CategoryWrite, user: dict = Depends(require_admin)):
    return save_action(item)


@app.put("/api/admin/categories/{item_id}")
def update_category(item_id: int, item: CategoryWrite, user: dict = Depends(require_admin)):
    return save_action(item, item_id)


@app.delete("/api/admin/categories/{item_id}")
def remove_category(item_id: int, user: dict = Depends(require_admin)):
    delete_action(item_id)
    return {"success": True}


@app.post("/api/admin/categories/import")
def import_categories(file: UploadFile = File(...), user: dict = Depends(require_admin)):
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(400, "請選擇 XLSX 檔案")
    items = read_import(file.file.read(2 * 1024 * 1024 + 1))
    return import_actions(items)


@app.get("/api/admin/categories/export.xlsx")
def export_categories(user: dict = Depends(require_admin)):
    return StreamingResponse(
        export_actions(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=action_categories.xlsx"}
    )

# ==============================================================================
# 1. Frontend Entry
# ==============================================================================
@app.get("/", response_class=HTMLResponse)
def serve_index():
    index_path = os.path.join(TEMPLATES_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>SDGs Platform Backend Ready.</h1>"

# ==============================================================================
# 2. Authentication APIs
# ==============================================================================
class LoginRequest(BaseModel):
    account: str # email, phone, or 'admin'
    password: str
    student_id: Optional[int] = None # For disambiguation when multiple students share email
    account_type: Optional[Literal["student", "staff"]] = None

@app.post("/api/auth/login")
def login(req: LoginRequest):
    with get_accounts_db() as conn:
        ensure_users_seeded(conn)
        cursor = conn.cursor()
        acc = req.account.strip()
        pwd = req.password.strip()
        account_type = req.account_type or ("staff" if acc in ("admin", "admin@fgu.edu.tw") else "student")
        table = "admin" if account_type == "staff" else "student"
        if req.student_id:
            cursor.execute(f"SELECT * FROM {table} WHERE id = ? AND (email = ? OR phone = ?)", (req.student_id, acc, acc))
        else:
            if account_type == "staff" and acc == "admin@fgu.edu.tw":
                acc = "admin"
            cursor.execute(f"SELECT * FROM {table} WHERE email = ? OR phone = ?", (acc, acc))
        matches = [dict(row) for row in cursor.fetchall()]
        valid = [row for row in matches if verify_password(pwd, row["password_hash"]) or
                 (account_type == "student" and pwd == row["phone"])]
        if not valid:
            raise HTTPException(status_code=400, detail="帳號或密碼錯誤，請重新輸入")
        if len(valid) > 1:
            return {"success": True, "multiple_matches": True, "students": [
                {key: row[key] for key in ("id", "name", "unit_code", "unit_name")} for row in valid
            ]}
        row = valid[0]
        return {"success": True, "token": create_access_token(row), "user": {
            **{key: row[key] for key in ("id", "name", "email", "role", "unit_code", "unit_name", "phone")},
            "account_type": account_type,
        }}

@app.get("/api/auth/me")
def get_me(user: dict = Depends(require_user)):
    return {**user["profile"], "account_type": get_account_type(user)}

# ==============================================================================
# 3. SDGs Reference APIs
# ==============================================================================
@app.get("/api/sdgs/goals")
def get_sdgs_goals():
    with get_db() as conn:
        ensure_sdgs_seeded(conn)
        cursor = conn.cursor()
        cursor.execute("""
        SELECT g.*, COUNT(t.id) as target_count 
        FROM sdgs_goals g
        LEFT JOIN sdgs_targets t ON g.id = t.goal_id
        GROUP BY g.id
        ORDER BY g.id ASC
        """)
        goals = [dict(r) for r in cursor.fetchall()]
        return goals

@app.get("/api/sdgs/targets")
def get_sdgs_targets(goal_id: Optional[int] = None, target_type: Optional[str] = None):
    with get_db() as conn:
        ensure_sdgs_seeded(conn)
        cursor = conn.cursor()
        query = "SELECT * FROM sdgs_targets WHERE 1=1"
        params = []
        if goal_id:
            query += " AND goal_id = ?"
            params.append(goal_id)
        if target_type:
            query += " AND target_type = ?"
            params.append(target_type)
        query += " ORDER BY goal_id ASC, code ASC"
        cursor.execute(query, params)
        targets = [dict(r) for r in cursor.fetchall()]
        return targets

@app.get("/api/sdgs/search")
def search_sdgs(q: str = Query(..., min_length=1)):
    with get_db() as conn:
        cursor = conn.cursor()
        term = f"%{q.strip()}%"
        cursor.execute("SELECT * FROM sdgs_goals WHERE name LIKE ? OR full_name LIKE ? OR slogan LIKE ?", (term, term, term))
        matching_goals = [dict(r) for r in cursor.fetchall()]
        
        cursor.execute("""
        SELECT t.*, g.name as goal_name, g.color as goal_color 
        FROM sdgs_targets t
        JOIN sdgs_goals g ON t.goal_id = g.id
        WHERE t.content LIKE ? OR t.code LIKE ?
        LIMIT 40
        """, (term, term))
        matching_targets = [dict(r) for r in cursor.fetchall()]
        
        return {
            "query": q,
            "goals": matching_goals,
            "targets": matching_targets
        }

# ==============================================================================
# 4. Worksheets CRUD & DOCX Export APIs
# ==============================================================================
class WorksheetSchema(BaseModel):
    unit_name: str
    center_action: str
    center_custom: Optional[str] = ""
    activity_details: ActivityDetails
    radial_data: List[Dict[str, Any]]
    tradeoff_data: List[Dict[str, Any]]
    chat_text: str = ""
    causal_data: Optional[Dict[str, Any]] = None
    self_checks: List[bool]
    commitment: Dict[str, Any]
    status: Optional[str] = "submitted"

    @model_validator(mode="after")
    def require_activity_category(self):
        if not self.center_action.strip():
            raise ValueError("請先選擇：活動分類。")
        return self

def validate_worksheet_submission(data: WorksheetSchema):
    if (data.status or "submitted") != "submitted":
        return

    def complete(row, fields):
        return isinstance(row, dict) and all(isinstance(row.get(field), str) and row[field].strip() for field in fields)

    if sum(complete(row, ("goal", "mechanism", "observable")) for row in data.radial_data) < 3:
        raise HTTPException(status_code=400, detail="三、放射型分析：請完整填寫至少 3 條連動線，每條的三個欄位都要填寫！")
    if not any(complete(row, ("who", "situation", "how")) for row in data.tradeoff_data):
        raise HTTPException(status_code=400, detail="四、拉扯檢查：請完整填寫至少 1 條拉扯檢查，每條的三個欄位都要填寫！")
    chains = (data.causal_data or {}).get("chains", [])
    if not isinstance(chains, list) or not any(complete(row, ("start", "start_cond", "mid", "mid_cond", "result", "result_cond", "impact", "measurement")) for row in chains):
        raise HTTPException(status_code=400, detail="五、因果型分析：請完整填寫至少 1 條因果鏈，A～D 階段的八個欄位都要填寫！")
    if len(data.self_checks) != 4 or not all(data.self_checks):
        raise HTTPException(status_code=400, detail="六、自我檢核：請勾選確認全部 4 個項目！")
    if not complete(data.commitment, ("start_action", "target_1", "target_2", "risk_aware", "metric")):
        raise HTTPException(status_code=400, detail="七、我的連動承諾宣言：請填寫全部 5 個欄位！")

@app.get("/api/worksheets")
def list_worksheets(
    user: dict = Depends(require_user),
    status_filter: Optional[str] = None,
    search: Optional[str] = None,
    mine: Optional[bool] = False,
    limit: int = 50,
    offset: int = 0
):
    with get_db() as conn:
        cursor = conn.cursor()
        is_staff = user.get("role") in ["admin", "teacher"]
        
        query = "SELECT * FROM worksheets WHERE 1=1"
        params = []
        
        if mine or not is_staff:
            query += " AND user_id = ? AND account_type = ?"
            params.extend([user["user_id"], get_account_type(user)])
        
        if status_filter:
            query += " AND status = ?"
            params.append(status_filter)
            
        if search:
            query += " AND (user_name LIKE ? OR unit_name LIKE ? OR center_action LIKE ?)"
            s = f"%{search}%"
            params.extend([s, s, s])
            
        query += " ORDER BY updated_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        
        cursor.execute(query, params)
        rows = [dict(r) for r in cursor.fetchall()]
        
        for r in rows:
            for field in ["radial_data", "tradeoff_data", "causal_data", "self_checks", "commitment", "activity_details"]:
                if r[field]:
                    try:
                        r[field] = json.loads(r[field])
                    except:
                        pass
        return rows

@app.get("/api/worksheets/{worksheet_id}")
def get_worksheet(worksheet_id: int, user: dict = Depends(require_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT w.*
        FROM worksheets w
        WHERE w.id = ?
        """, (worksheet_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到該練習單")
        
        w = enrich_worksheets([dict(row)], "user_email")[0]
        if user.get("role") not in ["admin", "teacher"] and (w["user_id"] != user["user_id"] or w["account_type"] != get_account_type(user)):
            raise HTTPException(status_code=403, detail="無權存取他人練習單")
            
        for field in ["radial_data", "tradeoff_data", "causal_data", "self_checks", "commitment", "activity_details"]:
            if w[field]:
                try:
                    w[field] = json.loads(w[field])
                except:
                    pass
        return w

@app.get("/api/worksheets/{worksheet_id}/export-docx")
def export_worksheet_docx(worksheet_id: int, user: dict = Depends(require_user), file_format: Literal["docx", "doc"] = Query("docx", alias="format")):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT w.*
        FROM worksheets w
        WHERE w.id = ?
        """, (worksheet_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到該練習單")
        
        w = enrich_worksheets([dict(row)], "user_email")[0]
        if user.get("role") not in ["admin", "teacher"] and (w["user_id"] != user["user_id"] or w["account_type"] != get_account_type(user)):
            raise HTTPException(status_code=403, detail="無權存取他人練習單")
            
        for field in ["radial_data", "tradeoff_data", "causal_data", "self_checks", "commitment", "activity_details"]:
            if w[field]:
                try:
                    w[field] = json.loads(w[field])
                except:
                    pass
                    
        document_stream = create_worksheet_doc(w) if file_format == "doc" else create_worksheet_docx(w)
        student_name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', w.get("user_name") or "學員").strip(" .")[:80] or "學員"
        downloaded_at = datetime.now(timezone(timedelta(hours=8))).strftime("%Y%m%d%H%M%S")
        filename = f"連動分析練習單_{student_name}_{downloaded_at}.{file_format}"
        
        import urllib.parse
        encoded_filename = urllib.parse.quote(filename)
        
        return StreamingResponse(
            document_stream,
            media_type="application/msword" if file_format == "doc" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
            }
        )

@app.post("/api/worksheets")
def create_worksheet(data: WorksheetSchema, user: dict = Depends(require_user)):
    validate_worksheet_submission(data)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO worksheets (
            user_id, account_type, user_name, unit_name, center_action, center_custom, activity_details,
            radial_data, tradeoff_data, chat_text, causal_data,
            self_checks, commitment, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user["user_id"],
            get_account_type(user),
            user["name"],
            data.unit_name.strip() or "佛光學員",
            data.center_action,
            data.center_custom,
            data.activity_details.model_dump_json() if data.activity_details else None,
            json.dumps(data.radial_data, ensure_ascii=False),
            json.dumps(data.tradeoff_data, ensure_ascii=False),
            data.chat_text,
            json.dumps(data.causal_data, ensure_ascii=False) if data.causal_data else None,
            json.dumps(data.self_checks),
            json.dumps(data.commitment, ensure_ascii=False),
            data.status or "submitted"
        ))
        new_id = cursor.lastrowid
        return {"success": True, "id": new_id, "message": "練習單已成功儲存！"}

@app.put("/api/worksheets/{worksheet_id}")
def update_worksheet(worksheet_id: int, data: WorksheetSchema, user: dict = Depends(require_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT user_id, account_type, status FROM worksheets WHERE id = ?", (worksheet_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到該練習單")
        
        if user.get("role") not in ["admin", "teacher"] and (row["user_id"] != user["user_id"] or row["account_type"] != get_account_type(user)):
            raise HTTPException(status_code=403, detail="無權限修改他人練習單")

        validate_worksheet_submission(data)
        cursor.execute("""
        UPDATE worksheets SET
            unit_name = ?,
            center_action = ?,
            center_custom = ?,
            activity_details = ?,
            radial_data = ?,
            tradeoff_data = ?,
            chat_text = ?,
            causal_data = ?,
            self_checks = ?,
            commitment = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """, (
            data.unit_name.strip() or "佛光學員",
            data.center_action,
            data.center_custom,
            data.activity_details.model_dump_json() if data.activity_details else None,
            json.dumps(data.radial_data, ensure_ascii=False),
            json.dumps(data.tradeoff_data, ensure_ascii=False),
            data.chat_text,
            json.dumps(data.causal_data, ensure_ascii=False) if data.causal_data else None,
            json.dumps(data.self_checks),
            json.dumps(data.commitment, ensure_ascii=False),
            data.status or "submitted",
            worksheet_id
        ))
        return {"success": True, "message": "練習單已成功更新！"}

@app.delete("/api/worksheets/{worksheet_id}")
def delete_worksheet(worksheet_id: int, user: dict = Depends(require_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT user_id, account_type FROM worksheets WHERE id = ?", (worksheet_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到該練習單")
        
        if user.get("role") not in ["admin", "teacher"] and (row["user_id"] != user["user_id"] or row["account_type"] != get_account_type(user)):
            raise HTTPException(status_code=403, detail="無權限刪除他人練習單")
            
        cursor.execute("DELETE FROM worksheets WHERE id = ?", (worksheet_id,))
        return {"success": True, "message": "練習單已成功刪除！"}

# ==============================================================================
# 5. Dual Games & Leaderboard APIs
# ==============================================================================
MEMORY_MATCH_POOL = [
    {
        "pair_id": 1,
        "goal_code": "SDG 14",
        "goal_name": "永續海洋與保育",
        "icon": "🌊",
        "color": "#0A97D9",
        "action": "ICC 國際淨灘與微塑膠監測源頭減量"
    },
    {
        "pair_id": 2,
        "goal_code": "SDG 7",
        "goal_name": "可負擔的永續能源",
        "icon": "☀️",
        "color": "#FCC30B",
        "action": "道場與社區屋頂太陽能微電網建置"
    },
    {
        "pair_id": 3,
        "goal_code": "SDG 12",
        "goal_name": "責任消費與生產",
        "icon": "👕",
        "color": "#BF8B2E",
        "action": "社區二手衣物美學市集與舊衣升級改造"
    },
    {
        "pair_id": 4,
        "goal_code": "SDG 2",
        "goal_name": "終結飢餓與格外品",
        "icon": "🥗",
        "color": "#DDA63A",
        "action": "惜食共餐格外品料理，長幼共融低碳飲食"
    },
    {
        "pair_id": 5,
        "goal_code": "SDG 15",
        "goal_name": "陸域生態保護",
        "icon": "🌳",
        "color": "#56C02B",
        "action": "種植台灣原生樹種，涵養水土與生態多樣性"
    },
    {
        "pair_id": 6,
        "goal_code": "SDG 11",
        "goal_name": "永續城鄉與社區",
        "icon": "🚲",
        "color": "#FD9D24",
        "action": "校園無障礙綠色走廊與公共運輸微交通"
    },
    {
        "pair_id": 7,
        "goal_code": "SDG 13",
        "goal_name": "氣候行動與防災",
        "icon": "⚡",
        "color": "#3F7E44",
        "action": "氣候變遷早期預警與社區耐災韌性演練"
    },
    {
        "pair_id": 8,
        "goal_code": "SDG 17",
        "goal_name": "全球夥伴關係",
        "icon": "🤝",
        "color": "#19486A",
        "action": "跨界青年高峰聯盟，串聯國際永續行動"
    }
]

@app.get("/api/game/memory-cards")
def get_memory_cards():
    selected_pairs = random.sample(MEMORY_MATCH_POOL, 6)
    cards = []
    for p in selected_pairs:
        cards.append({
            "card_id": f"g_{p['pair_id']}",
            "pair_id": p["pair_id"],
            "card_type": "goal",
            "title": f"{p['goal_code']} {p['goal_name']}",
            "desc": "核心目標",
            "icon": p["icon"],
            "color": p["color"]
        })
        cards.append({
            "card_id": f"a_{p['pair_id']}",
            "pair_id": p["pair_id"],
            "card_type": "action",
            "title": p["action"],
            "desc": f"對應 {p['goal_code']}",
            "icon": "⚡",
            "color": p["color"]
        })
    random.shuffle(cards)
    return {"cards": cards}

class GameSettingsModel(BaseModel):
    game_duration: Optional[int] = 45
    card_speed_ms: Optional[int] = 1000
    monster_pts: Optional[int] = 100
    guardian_penalty: Optional[int] = 150
    bonus_pts: Optional[int] = 500
    initial_lives: Optional[int] = 3

@app.get("/api/game/settings")
def get_game_settings_api():
    """取得《SDGs 地球保衛戰》遊戲參數與難度設定（秒數、卡片閃過速度、分數）"""
    with get_db() as conn:
        return get_game_settings(conn)

@app.put("/api/admin/game/settings")
def update_game_settings_api(req: GameSettingsModel, user: dict = Depends(require_admin)):
    """管理員修改《SDGs 地球保衛戰》遊戲參數與計分規則"""
    data = req.dict(exclude_unset=True)
    with get_db() as conn:
        updated = set_game_settings(conn, data)
    return {
        "success": True,
        "message": "《SDGs 地球保衛戰》遊戲參數與難度設定已成功更新！",
        "settings": updated
    }

class GameScoreSubmit(BaseModel):
    game_type: Optional[str] = "earth_defense"
    score: int
    max_combo: int
    earth_health: int
    risks_solved: int
    title_earned: str

@app.post("/api/game/submit-score")
def submit_game_score(req: GameScoreSubmit, user: dict = Depends(require_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO game_scores (user_id, account_type, user_name, game_type, score, max_combo, earth_health, risks_solved, title_earned)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user["user_id"],
            get_account_type(user),
            user["name"],
            req.game_type or "earth_defense",
            req.score,
            req.max_combo,
            req.earth_health,
            req.risks_solved,
            req.title_earned
        ))
        
        cursor.execute("SELECT COUNT(*) FROM game_scores WHERE score > ?", (req.score,))
        rank = cursor.fetchone()[0] + 1
        return {
            "success": True,
            "rank": rank,
            "score": req.score,
            "title": req.title_earned,
            "message": f"成績已成功登錄！目前保衛英雄榜排名：第 {rank} 名！"
        }

@app.get("/api/game/leaderboard")
def get_leaderboard(game_type: Optional[str] = None, user: Optional[dict] = Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        query = "SELECT id, user_id, account_type, user_name, game_type, score, max_combo, earth_health, risks_solved, title_earned, played_at FROM game_scores WHERE 1=1"
        params = []
        if game_type:
            query += " AND game_type = ?"
            params.append(game_type)
        query += " ORDER BY score DESC, max_combo DESC, played_at ASC LIMIT 30"
        
        cursor.execute(query, params)
        top_list = [dict(r) for r in cursor.fetchall()]
        
        user_best = None
        if user:
            u_query = "SELECT * FROM game_scores WHERE user_id = ? AND account_type = ?"
            u_params = [user["user_id"], get_account_type(user)]
            if game_type:
                u_query += " AND game_type = ?"
                u_params.append(game_type)
            u_query += " ORDER BY score DESC LIMIT 1"
            cursor.execute(u_query, u_params)
            best_row = cursor.fetchone()
            if best_row:
                user_best = dict(best_row)
                cursor.execute("SELECT COUNT(*) FROM game_scores WHERE score > ?", (user_best["score"],))
                user_best["rank"] = cursor.fetchone()[0] + 1
                
        return {
            "leaderboard": top_list,
            "my_best": user_best
        }

# ==============================================================================
# 6. Admin Management APIs (Worksheet Grading & Student Full CRUD/Import/Export)
# ==============================================================================
@app.get("/api/admin/stats")
def get_admin_stats(user: dict = Depends(require_admin)):
    with get_db() as conn:
        ensure_users_seeded(conn)
        ensure_sdgs_seeded(conn)
        cursor = conn.cursor()
        with get_accounts_db() as accounts:
            account_cursor = accounts.cursor()
            account_cursor.execute("SELECT COUNT(*) FROM student WHERE role = 'student'")
            total_students = account_cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM worksheets")
        total_worksheets = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM worksheets WHERE status = 'draft'")
        draft_worksheets = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM worksheets WHERE status = 'submitted'")
        submitted_worksheets = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM worksheets WHERE status = 'reviewed'")
        reviewed_worksheets = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM game_scores")
        total_games = cursor.fetchone()[0]
        
        cursor.execute("SELECT AVG(score), MAX(score) FROM game_scores")
        score_stats = cursor.fetchone()
        avg_score = int(score_stats[0] or 0)
        max_score = int(score_stats[1] or 0)
        
        cursor.execute("SELECT center_action, COUNT(*) AS worksheet_count FROM worksheets WHERE status IN ('submitted', 'reviewed') GROUP BY center_action")
        center_counts = {row["center_action"]: row["worksheet_count"] for row in cursor.fetchall()}
        
        cursor.execute("SELECT radial_data FROM worksheets WHERE status IN ('submitted', 'reviewed')")
        all_radial = cursor.fetchall()
        sdg_counts = {i: 0 for i in range(1, 18)}
        import re
        for row in all_radial:
            try:
                items = json.loads(row[0])
                for it in items:
                    g_text = it.get("goal", "")
                    m = re.search(r"(\d+)", g_text)
                    if m:
                        gid = int(m.group(1))
                        if 1 <= gid <= 17:
                            sdg_counts[gid] += 1
            except:
                pass
                
        return {
            "total_students": total_students,
            "total_worksheets": total_worksheets,
            "draft_worksheets": draft_worksheets,
            "submitted_worksheets": submitted_worksheets,
            "reviewed_worksheets": reviewed_worksheets,
            "total_games": total_games,
            "avg_game_score": avg_score,
            "max_game_score": max_score,
            "center_action_distribution": center_counts,
            "sdg_frequency": sdg_counts
        }

# --- Student & Staff/Admin CRUD ---
@app.get("/api/admin/students")
def get_admin_students(
    search: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    user: dict = Depends(require_admin)
):
    with get_accounts_db() as conn:
        ensure_users_seeded(conn)
        cursor = conn.cursor()
        query = "SELECT id, name, email, email_backup, phone, unit_code, unit_name, role, created_at FROM student WHERE role = 'student'"
        params = []
        if search:
            s = f"%{search.strip()}%"
            query += " AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR unit_code LIKE ? OR unit_name LIKE ?)"
            params.extend([s, s, s, s, s])
            
        cursor.execute(f"SELECT COUNT(*) FROM ({query})", params)
        total = cursor.fetchone()[0]
        
        query += " ORDER BY id ASC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        cursor.execute(query, params)
        students = [dict(r) for r in cursor.fetchall()]
        return {"total": total, "items": students}

@app.get("/api/admin/staff")
def get_admin_staff(
    search: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    user: dict = Depends(require_admin)
):
    with get_accounts_db() as conn:
        ensure_users_seeded(conn)
        cursor = conn.cursor()
        query = "SELECT id, name, email, email_backup, phone, unit_code, unit_name, role, created_at FROM admin WHERE role IN ('admin', 'teacher')"
        params = []
        if search:
            s = f"%{search.strip()}%"
            query += " AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR unit_code LIKE ? OR unit_name LIKE ?)"
            params.extend([s, s, s, s, s])
            
        cursor.execute(f"SELECT COUNT(*) FROM ({query})", params)
        total = cursor.fetchone()[0]
        
        query += " ORDER BY id ASC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        cursor.execute(query, params)
        staff = [dict(r) for r in cursor.fetchall()]
        return {"total": total, "items": staff}

class StudentSaveSchema(BaseModel):
    name: str
    email: str
    email_backup: Optional[str] = ""
    phone: str
    unit_code: Optional[str] = ""
    unit_name: Optional[str] = "佛光學員"
    role: Literal["student"] = "student"
    password: Optional[str] = None

class StaffSaveSchema(StudentSaveSchema):
    role: Literal["admin", "teacher"] = "admin"


def save_account(req, table, account_id=None):
    with get_accounts_db() as conn:
        cursor = conn.cursor()
        if account_id is not None:
            cursor.execute(f"SELECT email FROM {table} WHERE id = ?", (account_id,))
            existing = cursor.fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="找不到該帳號")
            if table == "admin" and existing["email"] == "admin" and (req.email.strip() != "admin" or req.role != "admin"):
                raise HTTPException(status_code=400, detail="預設最高管理員不可變更登入帳號或角色")
        values = (req.name.strip(), req.email.strip(), req.email_backup or "", req.phone.strip(), req.unit_code or "", req.unit_name or "佛光學員", req.role)
        if account_id is None:
            cursor.execute(f"""INSERT INTO {table} (name, email, email_backup, phone, unit_code, unit_name, role, password_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""", (*values, hash_password(req.password or req.phone or "sdgs2030admin")))
            account_id = cursor.lastrowid
        else:
            password_sql = ", password_hash = ?" if req.password and req.password.strip() else ""
            if password_sql:
                values += (hash_password(req.password.strip()),)
            cursor.execute(f"""UPDATE {table} SET name = ?, email = ?, email_backup = ?, phone = ?, unit_code = ?, unit_name = ?, role = ?{password_sql}
                WHERE id = ?""", (*values, account_id))
        return {"success": True, "id": account_id, "message": f"帳號 {req.name} 已成功儲存！"}

@app.post("/api/admin/students")
def create_student(req: StudentSaveSchema, user: dict = Depends(require_admin)):
    return save_account(req, "student")

@app.post("/api/admin/staff")
def create_staff(req: StaffSaveSchema, user: dict = Depends(require_admin)):
    return save_account(req, "admin")

@app.put("/api/admin/students/{student_id}")
def update_student(student_id: int, req: StudentSaveSchema, user: dict = Depends(require_admin)):
    return save_account(req, "student", student_id)

@app.put("/api/admin/staff/{staff_id}")
def update_staff(staff_id: int, req: StaffSaveSchema, user: dict = Depends(require_admin)):
    return save_account(req, "admin", staff_id)


def delete_accounts(ids, table):
    if not ids:
        raise HTTPException(status_code=400, detail="未選取任何名單")
    with get_accounts_db() as conn:
        cursor = conn.cursor()
        placeholders = ",".join("?" for _ in ids)
        if table == "admin":
            cursor.execute(f"SELECT id FROM admin WHERE id IN ({placeholders}) AND email = 'admin'", ids)
            if cursor.fetchone():
                raise HTTPException(status_code=400, detail="預設最高系統管理員帳號不可刪除，但可修改資料與密碼")
        cursor.execute(f"DELETE FROM {table} WHERE id IN ({placeholders})", ids)
        return {"success": True, "deleted_count": cursor.rowcount, "message": "帳號資料已成功刪除！"}

@app.delete("/api/admin/students/{student_id}")
def delete_single_student(student_id: int, user: dict = Depends(require_admin)):
    return delete_accounts([student_id], "student")

@app.delete("/api/admin/staff/{staff_id}")
def delete_single_staff(staff_id: int, user: dict = Depends(require_admin)):
    return delete_accounts([staff_id], "admin")

class BatchDeleteRequest(BaseModel):
    ids: List[int]

@app.post("/api/admin/students/batch-delete")
def batch_delete_students(req: BatchDeleteRequest, user: dict = Depends(require_admin)):
    return delete_accounts(req.ids, "student")

@app.post("/api/admin/staff/batch-delete")
def batch_delete_staff(req: BatchDeleteRequest, user: dict = Depends(require_admin)):
    return delete_accounts(req.ids, "admin")

class BatchImportRequest(BaseModel):
    students: List[Dict[str, str]]
    default_role: Optional[str] = "student"


def import_accounts(req, table):
    if not req.students:
        raise HTTPException(status_code=400, detail="匯入名單為空")
    staff = table == "admin"
    allowed = ("admin", "teacher") if staff else ("student",)
    params = []
    for row in req.students:
        role = row.get("role", "admin" if staff else "student").strip()
        role = {"系統管理員": "admin", "授課講師/助教": "teacher"}.get(role, role)
        if role not in allowed:
            raise HTTPException(status_code=400, detail="管理帳號與學員名單必須分開匯入，請確認角色與匯入區域")
        name, email = row.get("name", "").strip(), row.get("email", "").strip()
        if not name or not email:
            continue
        phone = row.get("phone", "").strip()
        params.append((name, email, row.get("email_backup", ""), phone, row.get("unit_code", ""), row.get("unit_name", "") or ("佛光永續學院" if staff else "佛光學員"), hash_password(phone or "0920111111"), role))
    with get_accounts_db() as conn:
        conn.cursor().executemany(f"""INSERT INTO {table} (name, email, email_backup, phone, unit_code, unit_name, password_hash, role)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""", params)
    return {"success": True, "imported_count": len(params), "skipped_count": len(req.students) - len(params), "message": f"匯入完成！成功新增 {len(params)} 筆帳號。"}

@app.post("/api/admin/students/batch-import")
def batch_import_students(req: BatchImportRequest, user: dict = Depends(require_admin)):
    return import_accounts(req, "student")

@app.post("/api/admin/staff/batch-import")
def batch_import_staff(req: BatchImportRequest, user: dict = Depends(require_admin)):
    return import_accounts(req, "admin")

@app.get("/api/admin/students/export-csv")
def export_students_csv(user: dict = Depends(require_admin)):
    with get_accounts_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT name, email, email_backup, phone, unit_code, unit_name 
        FROM student
        WHERE role = 'student'
        ORDER BY id ASC
        """)
        rows = cursor.fetchall()
        
        output = io.StringIO()
        output.write('﻿') # UTF-8 BOM
        writer = csv.writer(output)
        writer.writerow(["學員姓名", "Email（帳號）", "Email（補課平台）", "聯絡電話（密碼）", "分會/分團/童軍團（編號）", "所屬分會/分團/童軍團（完整名稱）"])
        
        for r in rows:
            writer.writerow([r[0], r[1], r[2] or "", r[3], r[4] or "", r[5] or ""])
            
        output.seek(0)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode('utf-8-sig')),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=student_list_export.csv"}
        )

@app.get("/api/admin/staff/export-csv")
def export_staff_csv(user: dict = Depends(require_admin)):
    with get_accounts_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT name, email, email_backup, phone, unit_code, unit_name, role 
        FROM admin
        WHERE role IN ('admin', 'teacher')
        ORDER BY id ASC
        """)
        rows = cursor.fetchall()
        
        output = io.StringIO()
        output.write('﻿') # UTF-8 BOM
        writer = csv.writer(output)
        writer.writerow(["姓名", "登入帳號/Email", "備用Email", "聯絡電話", "單位代碼", "所屬單位名稱", "角色權限"])
        
        for r in rows:
            role_label = "系統管理員" if r[6] == "admin" else "授課講師/助教"
            writer.writerow([r[0], r[1], r[2] or "", r[3], r[4] or "", r[5] or "", role_label])
            
        output.seek(0)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode('utf-8-sig')),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=admin_staff_export.csv"}
        )

# --- Grading with Email Send to Student ---
class GradeSubmit(BaseModel):
    score: int
    comment: str

@app.put("/api/admin/worksheets/{worksheet_id}/grade")
def grade_worksheet(worksheet_id: int, req: GradeSubmit, user: dict = Depends(require_admin)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT w.*
        FROM worksheets w
        WHERE w.id = ?
        """, (worksheet_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到該練習單")
            
        ws = enrich_worksheets([dict(row)], "student_email")[0]
        if not ws.get("student_email"):
            raise HTTPException(404, "此歷史練習單的帳號已不存在，無法寄發批閱通知")
        cursor.execute("""
        UPDATE worksheets SET
            score = ?,
            teacher_comment = ?,
            status = 'reviewed',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """, (req.score, req.comment, worksheet_id))
        
    # Send email notification directly to student's email outside DB transaction
    ws["email"] = ws.get("student_email")
    email_res = send_grade_notification(ws, req.score, req.comment)
    
    return {
        "success": True,
        "message": f"批閱完成！已記錄成績 {req.score} 分，並已成功發送指導講評通知信至學員信箱 ({email_res['recipient']})！",
        "email_sent": True,
        "email_target": email_res["recipient"],
        "subject": email_res["subject"]
    }

@app.get("/api/admin/export/csv")
def export_all_worksheets_csv(user: dict = Depends(require_admin)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT w.*
        FROM worksheets w
        ORDER BY w.id ASC
        """)
        rows = enrich_worksheets([dict(r) for r in cursor.fetchall()])
        
        output = io.StringIO()
        output.write('\ufeff')
        writer = csv.writer(output)
        writer.writerow([
            "練習單ID", "學員姓名", "Email", "聯絡電話", "分會編號", "分會單位",
            "中心行動", "自選活動名稱", "活動規劃與成果", "狀態", "成績", "講師講評",
            "提交時間", "放射連動資料", "拉扯分析資料", "因果型分析資料", "活動規劃與成果資料", "活動開始日期", "活動結束日期"
        ])
        
        for r in rows:
            details = json.loads(r["activity_details"]) if r["activity_details"] else {}
            writer.writerow([
                r["id"], r["user_name"], r["email"], r["phone"], r.get("unit_code", ""), r["unit_name"],
                r["center_action"], r["center_custom"] or "", activity_text(r["activity_details"]),
                r["status"], r["score"] or "", r["teacher_comment"] or "",
                r["created_at"], r["radial_data"], r["tradeoff_data"], r["causal_data"], r["activity_details"] or "",
                details.get("start_date", ""), details.get("end_date", "")
            ])
            
        output.seek(0)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode('utf-8-sig')),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=SDGs_Worksheets_Export.csv"}
        )

install_sso(app, require_user)
