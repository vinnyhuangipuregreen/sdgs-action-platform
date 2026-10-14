import sys
import os
import json
import csv
import io
import random
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, Depends, HTTPException, Header, Query, Response, status, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.database import get_db, init_db, get_game_settings, set_game_settings, DEFAULT_GAME_SETTINGS
from app.auth import hash_password, verify_password, create_access_token, decode_access_token
from app.docx_exporter import create_worksheet_docx
from app.mailer import send_grade_notification

app = FastAPI(
    title="SDGs 與氣候行動連動分析與智慧學習平台",
    description="佛光永續學院 × 佛光大學應用科技與設計學院 專案平台 v3.0",
    version="3.0.0"
)


@app.on_event("startup")
def on_startup():
    init_db()
    try:
        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT COUNT(*) FROM users")
            count = c.fetchone()[0]
            if count == 0:
                print("[STARTUP] Users table empty, auto-seeding database...")
                root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                if root_dir not in sys.path:
                    sys.path.insert(0, root_dir)
                import importlib.util
                seed_path = os.path.join(root_dir, "seed_db.py")
                if os.path.exists(seed_path):
                    spec = importlib.util.spec_from_file_location("seed_db", seed_path)
                    s_mod = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(s_mod)
                    s_mod.seed()
                    print("[STARTUP] Auto-seeding completed successfully!")
    except Exception as e:
        print("[STARTUP] Auto-seed check error:", e)

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
    return payload

def require_user(current_user: Optional[dict] = Depends(get_current_user)) -> dict:
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="請先登入系統")
    return current_user

def require_admin(current_user: dict = Depends(require_user)) -> dict:
    if current_user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="權限不足，需要管理員權限")
    return current_user

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

@app.post("/api/auth/login")
def login(req: LoginRequest):
    with get_db() as conn:
        cursor = conn.cursor()
        acc = req.account.strip()
        pwd = req.password.strip()

        # 1. Admin login
        if acc in ["admin", "admin@fgu.edu.tw"] and pwd == "sdgs2030admin":
            cursor.execute("SELECT * FROM users WHERE role = 'admin' LIMIT 1")
            u = cursor.fetchone()
            if u:
                u_dict = dict(u)
                token = create_access_token(u_dict)
                return {
                    "success": True,
                    "token": token,
                    "user": {
                        "id": u_dict["id"],
                        "name": u_dict["name"],
                        "email": u_dict["email"],
                        "role": "admin",
                        "unit_code": u_dict.get("unit_code", "FGU"),
                        "unit_name": u_dict.get("unit_name", "佛光永續學院"),
                        "phone": u_dict["phone"]
                    }
                }

        # 2. If specific student_id provided
        if req.student_id:
            cursor.execute("SELECT * FROM users WHERE id = ?", (req.student_id,))
            user = cursor.fetchone()
            if not user:
                raise HTTPException(status_code=400, detail="找不到指定的學員身分")
            user_dict = dict(user)
            if not verify_password(pwd, user_dict["password_hash"]) and pwd != user_dict["phone"]:
                raise HTTPException(status_code=400, detail="密碼錯誤，請重新輸入")
            token = create_access_token(user_dict)
            return {
                "success": True,
                "token": token,
                "user": {
                    "id": user_dict["id"],
                    "name": user_dict["name"],
                    "email": user_dict["email"],
                    "role": user_dict["role"],
                    "unit_code": user_dict.get("unit_code", ""),
                    "unit_name": user_dict.get("unit_name", "佛光學員"),
                    "phone": user_dict["phone"]
                }
            }

        # 3. Search matching users by email or phone
        cursor.execute("SELECT * FROM users WHERE email = ? OR phone = ?", (acc, acc))
        matching_users = [dict(r) for r in cursor.fetchall()]
        
        if not matching_users:
            raise HTTPException(status_code=400, detail="找不到此帳號，請確認 Email 或電話")
        
        # Verify passwords for matching users
        valid_users = []
        for u in matching_users:
            if verify_password(pwd, u["password_hash"]) or pwd == u["phone"]:
                valid_users.append(u)
                
        if not valid_users:
            raise HTTPException(status_code=400, detail="密碼錯誤，請重新輸入（預設密碼為手機號碼）")

        # If multiple users share the same account (e.g. testing with shared email)
        if len(valid_users) > 1:
            return {
                "success": True,
                "multiple_matches": True,
                "students": [
                    {
                        "id": u["id"],
                        "name": u["name"],
                        "unit_code": u.get("unit_code", ""),
                        "unit_name": u.get("unit_name", "")
                    }
                    for u in valid_users
                ]
            }

        # Single match - log in directly
        user_dict = valid_users[0]
        token = create_access_token(user_dict)
        return {
            "success": True,
            "token": token,
            "user": {
                "id": user_dict["id"],
                "name": user_dict["name"],
                "email": user_dict["email"],
                "role": user_dict["role"],
                "unit_code": user_dict.get("unit_code", ""),
                "unit_name": user_dict.get("unit_name", "佛光學員"),
                "phone": user_dict["phone"]
            }
        }

@app.get("/api/auth/me")
def get_me(user: dict = Depends(require_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, email, email_backup, phone, unit_code, unit_name, role FROM users WHERE id = ?", (user["user_id"],))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="使用者不存在")
        return dict(row)

# ==============================================================================
# 3. SDGs Reference APIs
# ==============================================================================
@app.get("/api/sdgs/goals")
def get_sdgs_goals():
    with get_db() as conn:
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
    radial_data: List[Dict[str, Any]]
    tradeoff_data: List[Dict[str, Any]]
    chat_text: str
    causal_data: Optional[Dict[str, Any]] = None
    self_checks: List[bool]
    commitment: Dict[str, Any]
    status: Optional[str] = "submitted"

@app.get("/api/worksheets")
def list_worksheets(
    user: dict = Depends(require_user),
    status_filter: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0
):
    with get_db() as conn:
        cursor = conn.cursor()
        is_staff = user.get("role") in ["admin", "teacher"]
        
        query = "SELECT * FROM worksheets WHERE 1=1"
        params = []
        
        if not is_staff:
            query += " AND user_id = ?"
            params.append(user["user_id"])
        
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
            for field in ["radial_data", "tradeoff_data", "causal_data", "self_checks", "commitment"]:
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
        SELECT w.*, u.email as user_email, u.email_backup, u.unit_code 
        FROM worksheets w
        JOIN users u ON w.user_id = u.id
        WHERE w.id = ?
        """, (worksheet_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到該練習單")
        
        w = dict(row)
        if user.get("role") not in ["admin", "teacher"] and w["user_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="無權存取他人練習單")
            
        for field in ["radial_data", "tradeoff_data", "causal_data", "self_checks", "commitment"]:
            if w[field]:
                try:
                    w[field] = json.loads(w[field])
                except:
                    pass
        return w

@app.get("/api/worksheets/{worksheet_id}/export-docx")
def export_worksheet_docx(worksheet_id: int, user: dict = Depends(require_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT w.*, u.email as user_email, u.unit_code 
        FROM worksheets w
        JOIN users u ON w.user_id = u.id
        WHERE w.id = ?
        """, (worksheet_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到該練習單")
        
        w = dict(row)
        if user.get("role") not in ["admin", "teacher"] and w["user_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="無權存取他人練習單")
            
        for field in ["radial_data", "tradeoff_data", "causal_data", "self_checks", "commitment"]:
            if w[field]:
                try:
                    w[field] = json.loads(w[field])
                except:
                    pass
                    
        docx_stream = create_worksheet_docx(w)
        filename = f"SDGs_Worksheet_{w['user_name']}_{w['id']}.docx"
        
        import urllib.parse
        encoded_filename = urllib.parse.quote(filename)
        
        return StreamingResponse(
            docx_stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
            }
        )

@app.post("/api/worksheets")
def create_worksheet(data: WorksheetSchema, user: dict = Depends(require_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO worksheets (
            user_id, user_name, unit_name, center_action, center_custom,
            radial_data, tradeoff_data, chat_text, causal_data,
            self_checks, commitment, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user["user_id"],
            user["name"],
            data.unit_name.strip() or "佛光學員",
            data.center_action,
            data.center_custom,
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
        cursor.execute("SELECT user_id, status FROM worksheets WHERE id = ?", (worksheet_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到該練習單")
        
        if user.get("role") not in ["admin", "teacher"] and row["user_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="無權限修改他人練習單")
            
        cursor.execute("""
        UPDATE worksheets SET
            unit_name = ?,
            center_action = ?,
            center_custom = ?,
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
        cursor.execute("SELECT user_id FROM worksheets WHERE id = ?", (worksheet_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到該練習單")
        
        if user.get("role") not in ["admin", "teacher"] and row["user_id"] != user["user_id"]:
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
        INSERT INTO game_scores (user_id, user_name, game_type, score, max_combo, earth_health, risks_solved, title_earned)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user["user_id"],
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
        query = "SELECT id, user_id, user_name, game_type, score, max_combo, earth_health, risks_solved, title_earned, played_at FROM game_scores WHERE 1=1"
        params = []
        if game_type:
            query += " AND game_type = ?"
            params.append(game_type)
        query += " ORDER BY score DESC, max_combo DESC, played_at ASC LIMIT 30"
        
        cursor.execute(query, params)
        top_list = [dict(r) for r in cursor.fetchall()]
        
        user_best = None
        if user:
            u_query = "SELECT * FROM game_scores WHERE user_id = ?"
            u_params = [user["user_id"]]
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
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM users WHERE role = 'student'")
        total_students = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM worksheets")
        total_worksheets = cursor.fetchone()[0]
        
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
        
        cursor.execute("SELECT center_action, COUNT(*) FROM worksheets GROUP BY center_action")
        center_counts = dict(cursor.fetchall())
        
        cursor.execute("SELECT radial_data FROM worksheets")
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
            "submitted_worksheets": submitted_worksheets,
            "reviewed_worksheets": reviewed_worksheets,
            "total_games": total_games,
            "avg_game_score": avg_score,
            "max_game_score": max_score,
            "center_action_distribution": center_counts,
            "sdg_frequency": sdg_counts
        }

# --- Student CRUD ---
@app.get("/api/admin/students")
def get_admin_students(
    search: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    user: dict = Depends(require_admin)
):
    with get_db() as conn:
        cursor = conn.cursor()
        query = "SELECT id, name, email, email_backup, phone, unit_code, unit_name, role, created_at FROM users WHERE 1=1"
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

class StudentSaveSchema(BaseModel):
    name: str
    email: str
    email_backup: Optional[str] = ""
    phone: str
    unit_code: Optional[str] = ""
    unit_name: Optional[str] = "佛光學員"
    role: Optional[str] = "student"
    password: Optional[str] = None

@app.post("/api/admin/students")
def create_student(req: StudentSaveSchema, user: dict = Depends(require_admin)):
    with get_db() as conn:
        cursor = conn.cursor()
        p_hash = hash_password(req.password or req.phone)
        cursor.execute("""
        INSERT INTO users (name, email, email_backup, phone, unit_code, unit_name, password_hash, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (req.name.strip(), req.email.strip(), req.email_backup or "", req.phone.strip(), req.unit_code or "", req.unit_name or "佛光學員", p_hash, req.role or "student"))
        new_id = cursor.lastrowid
        return {"success": True, "id": new_id, "message": f"學員 {req.name} 已成功新增！"}

@app.put("/api/admin/students/{student_id}")
def update_student(student_id: int, req: StudentSaveSchema, user: dict = Depends(require_admin)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE id = ?", (student_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="找不到該學員")

        if req.password and req.password.strip():
            p_hash = hash_password(req.password.strip())
            cursor.execute("""
            UPDATE users SET
                name = ?, email = ?, email_backup = ?, phone = ?, unit_code = ?, unit_name = ?, role = ?, password_hash = ?
            WHERE id = ?
            """, (req.name.strip(), req.email.strip(), req.email_backup or "", req.phone.strip(), req.unit_code or "", req.unit_name or "佛光學員", req.role or "student", p_hash, student_id))
        else:
            cursor.execute("""
            UPDATE users SET
                name = ?, email = ?, email_backup = ?, phone = ?, unit_code = ?, unit_name = ?, role = ?
            WHERE id = ?
            """, (req.name.strip(), req.email.strip(), req.email_backup or "", req.phone.strip(), req.unit_code or "", req.unit_name or "佛光學員", req.role or "student", student_id))
        return {"success": True, "message": f"學員 {req.name} 資料已成功更新！"}

@app.delete("/api/admin/students/{student_id}")
def delete_single_student(student_id: int, user: dict = Depends(require_admin)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM users WHERE id = ? AND role != 'admin'", (student_id,))
        return {"success": True, "message": "學員資料已成功刪除！"}

class BatchDeleteRequest(BaseModel):
    ids: List[int]

@app.post("/api/admin/students/batch-delete")
def batch_delete_students(req: BatchDeleteRequest, user: dict = Depends(require_admin)):
    if not req.ids:
        raise HTTPException(status_code=400, detail="未選取任何學員")
    with get_db() as conn:
        cursor = conn.cursor()
        placeholders = ",".join("?" for _ in req.ids)
        cursor.execute(f"DELETE FROM users WHERE id IN ({placeholders}) AND role != 'admin'", req.ids)
        deleted_count = cursor.rowcount
        return {"success": True, "deleted_count": deleted_count, "message": f"已成功批次刪除 {deleted_count} 位學員！"}

class BatchImportRequest(BaseModel):
    students: List[Dict[str, str]]

@app.post("/api/admin/students/batch-import")
def batch_import_students(req: BatchImportRequest, user: dict = Depends(require_admin)):
    if not req.students:
        raise HTTPException(status_code=400, detail="匯入名單為空")
    
    with get_db() as conn:
        cursor = conn.cursor()
        imported = 0
        skipped = 0
        for s in req.students:
            name = s.get("name", "").strip()
            email = s.get("email", "").strip()
            email_backup = s.get("email_backup", "").strip()
            phone = s.get("phone", "").strip()
            unit_code = s.get("unit_code", "").strip()
            unit_name = s.get("unit_name", "").strip() or "佛光學員"
            
            if not name or not email:
                skipped += 1
                continue
                
            p_hash = hash_password(phone or "0920111111")
            cursor.execute("""
            INSERT INTO users (name, email, email_backup, phone, unit_code, unit_name, password_hash, role)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'student')
            """, (name, email, email_backup, phone, unit_code, unit_name, p_hash))
            imported += 1
            
        return {
            "success": True,
            "imported_count": imported,
            "skipped_count": skipped,
            "message": f"匯入完成！成功新增 {imported} 位學員，跳過無效 {skipped} 筆。"
        }

@app.get("/api/admin/students/export-csv")
def export_students_csv(user: dict = Depends(require_admin)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT name, email, email_backup, phone, unit_code, unit_name 
        FROM users 
        WHERE role = 'student'
        ORDER BY id ASC
        """)
        rows = cursor.fetchall()
        
        output = io.StringIO()
        output.write('\ufeff') # UTF-8 BOM
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

# --- Grading with Email Send to Student ---
class GradeSubmit(BaseModel):
    score: int
    comment: str

@app.put("/api/admin/worksheets/{worksheet_id}/grade")
def grade_worksheet(worksheet_id: int, req: GradeSubmit, user: dict = Depends(require_admin)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT w.*, u.email as student_email, u.email_backup 
        FROM worksheets w
        JOIN users u ON w.user_id = u.id
        WHERE w.id = ?
        """, (worksheet_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到該練習單")
            
        ws = dict(row)
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
        SELECT w.*, u.email, u.phone, u.unit_code 
        FROM worksheets w
        JOIN users u ON w.user_id = u.id
        ORDER BY w.id ASC
        """)
        rows = [dict(r) for r in cursor.fetchall()]
        
        output = io.StringIO()
        output.write('\ufeff')
        writer = csv.writer(output)
        writer.writerow([
            "練習單ID", "學員姓名", "Email", "聯絡電話", "分會編號", "分會單位",
            "中心行動", "自選活動名稱", "聊天室格式文字", "狀態", "成績", "講師講評",
            "提交時間", "放射連動資料", "拉扯分析資料"
        ])
        
        for r in rows:
            writer.writerow([
                r["id"], r["user_name"], r["email"], r["phone"], r.get("unit_code", ""), r["unit_name"],
                r["center_action"], r["center_custom"] or "", r["chat_text"],
                r["status"], r["score"] or "", r["teacher_comment"] or "",
                r["created_at"], r["radial_data"], r["tradeoff_data"]
            ])
            
        output.seek(0)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode('utf-8-sig')),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=SDGs_Worksheets_Export.csv"}
        )
