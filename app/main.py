import os
import json
import csv
import io
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, Depends, HTTPException, Header, Query, Response, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.database import get_db, init_db
from app.auth import hash_password, verify_password, create_access_token, decode_access_token

app = FastAPI(
    title="SDGs 與氣候行動連動分析與互動學習平台",
    description="佛光永續學院 × 佛光大學應用科技與設計學院 專案平台",
    version="1.0.0"
)

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

# Helper: Get current user from Authorization header or cookie
def get_current_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    if not authorization:
        return None
    token = authorization
    if token.startswith("Bearer "):
        token = token[7:]
    payload = decode_access_token(token)
    return payload

def require_user(current_user: Optional[dict] = Depends(get_current_user)) -> dict:
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="請先登入系統")
    return current_user

def require_admin(current_user: dict = Depends(require_user)) -> dict:
    if current_user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="權限不足，需要教師或管理員權限")
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
    return "<h1>SDGs Platform Backend Ready. Please build templates/index.html</h1>"

# ==============================================================================
# 2. Authentication APIs
# ==============================================================================
class LoginRequest(BaseModel):
    account: str # email or phone
    password: str

@app.post("/api/auth/login")
def login(req: LoginRequest):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE email = ? OR phone = ?", (req.account.strip(), req.account.strip()))
        user = cursor.fetchone()
        
        if not user:
            raise HTTPException(status_code=400, detail="找不到此帳號，請確認 Email 或電話")
        
        user_dict = dict(user)
        # Check password or default phone
        if not verify_password(req.password, user_dict["password_hash"]):
            # Also allow fallback if password matches plain phone
            if req.password.strip() != user_dict["phone"]:
                raise HTTPException(status_code=400, detail="密碼錯誤，請重新輸入（預設密碼為手機號碼）")
        
        token = create_access_token(user_dict)
        return {
            "success": True,
            "token": token,
            "user": {
                "id": user_dict["id"],
                "name": user_dict["name"],
                "email": user_dict["email"],
                "role": user_dict["role"],
                "unit_name": user_dict["unit_name"],
                "phone": user_dict["phone"]
            }
        }

@app.get("/api/auth/me")
def get_me(user: dict = Depends(require_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, email, email_backup, phone, role, unit_name FROM users WHERE id = ?", (user["user_id"],))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="使用者不存在")
        return dict(row)

@app.get("/api/auth/quick-list")
def get_quick_demo_accounts():
    """Provides a list of accounts for instant 1-click test login in demo mode"""
    with get_db() as conn:
        cursor = conn.cursor()
        # Admin, Teacher, and 8 diverse students
        cursor.execute("""
        SELECT id, name, email, role, phone, unit_name FROM users 
        WHERE email IN ('admin@fgu.edu.tw', 'teacher@fgu.edu.tw', 'test001@gmail.com', 'test002@gmail.com', 'test003@gmail.com', 'test108@gmail.com', 'test200@gmail.com', 'test427@gmail.com')
        ORDER BY role DESC, id ASC
        """)
        rows = [dict(r) for r in cursor.fetchall()]
        return rows

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
        # Search goals
        cursor.execute("SELECT * FROM sdgs_goals WHERE name LIKE ? OR full_name LIKE ? OR slogan LIKE ?", (term, term, term))
        matching_goals = [dict(r) for r in cursor.fetchall()]
        
        # Search targets
        cursor.execute("""
        SELECT t.*, g.name as goal_name, g.color as goal_color 
        FROM sdgs_targets t
        JOIN sdgs_goals g ON t.goal_id = g.id
        WHERE t.content LIKE ? OR t.code LIKE ?
        LIMIT 30
        """, (term, term))
        matching_targets = [dict(r) for r in cursor.fetchall()]
        
        return {
            "query": q,
            "goals": matching_goals,
            "targets": matching_targets
        }

# ==============================================================================
# 4. Worksheets CRUD APIs
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
        
        # Parse JSON fields
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
        cursor.execute("SELECT * FROM worksheets WHERE id = ?", (worksheet_id,))
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
# 5. Interactive Game & Leaderboard APIs
# ==============================================================================
# Action cards deck tailored for youth SDG combo strategies
GAME_ACTION_CARDS = [
    {
        "id": "c1",
        "name": "🌊 守護蔚藍：國際淨灘與海廢監測",
        "sdg_primary": 14,
        "sdg_linked": [12, 3],
        "tier": "生物圈",
        "power": 850,
        "desc": "清除潮間帶塑膠微粒，ICC分類回饋源頭減量",
        "risk_prompt": "清運海廢未妥善分流，恐轉移至掩埋場造成二次污染"
    },
    {
        "id": "c2",
        "name": "☀️ 佛光綠能：道場屋頂微電網",
        "sdg_primary": 7,
        "sdg_linked": [13, 11],
        "tier": "社會",
        "power": 900,
        "desc": "建置自發自用屋頂太陽能板，兼具社區防災電力",
        "risk_prompt": "高溫與電網調度挑戰，設備生命週期汰換回收機制需健全"
    },
    {
        "id": "c3",
        "name": "👕 潮流永續：社區二手衣物美學市集",
        "sdg_primary": 12,
        "sdg_linked": [1, 10],
        "tier": "經濟",
        "power": 800,
        "desc": "青年升級改造舊衣，延長衣物週期並支持弱勢家庭",
        "risk_prompt": "低品質廢棄衣物堆積過剩，反成社區負擔"
    },
    {
        "id": "c4",
        "name": "🥗 蔬食A計畫：惜食共餐零廢棄食堂",
        "sdg_primary": 2,
        "sdg_linked": [12, 13],
        "tier": "社會",
        "power": 880,
        "desc": "搶救格外品蔬果，長幼共餐促進低碳飲食轉型",
        "risk_prompt": "食材保鮮與食安管理條件要求嚴苛"
    },
    {
        "id": "c5",
        "name": "🌳 鬱鬱蔥蔥：原生樹種森林復育",
        "sdg_primary": 15,
        "sdg_linked": [13, 6],
        "tier": "生物圈",
        "power": 950,
        "desc": "依地質多樣性種植台灣原生樹木，涵養水源並鞏固碳匯",
        "risk_prompt": "前期苗木存活率照護需要持續三年灌溉人力"
    },
    {
        "id": "c6",
        "name": "🚲 淨零漫遊：校園微交通與共享單車",
        "sdg_primary": 11,
        "sdg_linked": [3, 9],
        "tier": "社會",
        "power": 750,
        "desc": "布建校園無障礙慢行綠廊，減少機車碳排促進健康",
        "risk_prompt": "尖峰調度不及與人車爭道動線安全"
    },
    {
        "id": "c7",
        "name": "💻 數位向善：銀髮數位平權陪伴計畫",
        "sdg_primary": 10,
        "sdg_linked": [4, 8],
        "tier": "經濟",
        "power": 820,
        "desc": "大學生一對一指導長輩使用防詐防假與智慧醫療",
        "risk_prompt": "教學進度落差需耐心理論與客製化講義"
    },
    {
        "id": "c8",
        "name": "🤝 跨界星雲：國際永續青年高峰聯盟",
        "sdg_primary": 17,
        "sdg_linked": [16, 4],
        "tier": "頂端",
        "power": 1100,
        "desc": "串聯海內外青年團體，推動跨文化倡議與綠色行動倡議",
        "risk_prompt": "跨國專案管理溝通耗時，需要標準作業規範"
    }
]

CRISIS_EVENTS = [
    {
        "id": "cr1",
        "title": "⚠️ 善意拉扯危機：海廢垃圾清運瓶頸！",
        "desc": "淨灘志工熱情清出數噸垃圾，但地方垃圾車班次不足，堆置海岸恐遭大雨沖回海中！",
        "correct_strategy": "快速協調環保局緊急增派專車，並啟動志工細部材質分類打包",
        "options": [
            "快速協調環保局緊急增派專車，並啟動志工細部材質分類打包",
            "就地掩埋在沙灘深處以節省運費",
            "任由海風吹拂等待下週再行處理"
        ]
    },
    {
        "id": "cr2",
        "title": "⚠️ 善意拉扯危機：太陽能施工鄰損與生態抗議！",
        "desc": "屋頂與斜坡安裝光電板，周邊居民擔心眩光，且施工擾動周邊鳥類繁殖巢！",
        "correct_strategy": "採用抗眩光啞光塗層板材，並避開繁殖季節調整施工時段",
        "options": [
            "採用抗眩光啞光塗層板材，並避開繁殖季節調整施工時段",
            "架設更高金屬圍籬阻擋居民視線",
            "無視陳情加快夜間趕工安裝"
        ]
    },
    {
        "id": "cr3",
        "title": "⚠️ 善意拉扯危機：二手衣物捐贈塞爆在地市場！",
        "desc": "二手衣募集中湧入大量破損劣質衣物，志工分類不勝負荷，衝擊在地小型裁縫店！",
        "correct_strategy": "設立嚴格募集品質準則，並聘請在地裁縫師開設改衣工作坊創造雙贏",
        "options": [
            "設立嚴格募集品質準則，並聘請在地裁縫師開設改衣工作坊創造雙贏",
            "將所有衣物全數打包丟入焚化爐",
            "直接堆置在公園供民眾自行翻找"
        ]
    }
]

@app.get("/api/game/cards")
def get_game_cards():
    import random
    # Return 4 randomized action cards and 1 optional crisis
    cards = random.sample(GAME_ACTION_CARDS, 4)
    crisis = random.choice(CRISIS_EVENTS)
    return {
        "cards": cards,
        "crisis": crisis
    }

class GameScoreSubmit(BaseModel):
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
        INSERT INTO game_scores (user_id, user_name, score, max_combo, earth_health, risks_solved, title_earned)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            user["user_id"],
            user["name"],
            req.score,
            req.max_combo,
            req.earth_health,
            req.risks_solved,
            req.title_earned
        ))
        
        # Calculate rank
        cursor.execute("SELECT COUNT(*) FROM game_scores WHERE score > ?", (req.score,))
        rank = cursor.fetchone()[0] + 1
        return {
            "success": True,
            "rank": rank,
            "score": req.score,
            "title": req.title_earned,
            "message": f"成績已成功登錄！目前全校天梯排名：第 {rank} 名！"
        }

@app.get("/api/game/leaderboard")
def get_leaderboard(user: Optional[dict] = Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        # Top 30 scores
        cursor.execute("""
        SELECT id, user_id, user_name, score, max_combo, earth_health, risks_solved, title_earned, played_at
        FROM game_scores
        ORDER BY score DESC, max_combo DESC, played_at ASC
        LIMIT 30
        """)
        top_list = [dict(r) for r in cursor.fetchall()]
        
        user_best = None
        if user:
            cursor.execute("""
            SELECT * FROM game_scores 
            WHERE user_id = ? 
            ORDER BY score DESC LIMIT 1
            """, (user["user_id"],))
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
# 6. Admin & Teacher Management APIs
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
        
        # Center action distribution
        cursor.execute("SELECT center_action, COUNT(*) FROM worksheets GROUP BY center_action")
        center_counts = dict(cursor.fetchall())
        
        # Popular SDGs in radial data
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

@app.get("/api/admin/students")
def get_admin_students(
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    user: dict = Depends(require_admin)
):
    with get_db() as conn:
        cursor = conn.cursor()
        query = "SELECT id, name, email, email_backup, phone, role, unit_name, created_at FROM users WHERE 1=1"
        params = []
        if search:
            s = f"%{search.strip()}%"
            query += " AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)"
            params.extend([s, s, s])
            
        # Count total
        cursor.execute(f"SELECT COUNT(*) FROM ({query})", params)
        total = cursor.fetchone()[0]
        
        query += " ORDER BY id ASC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        cursor.execute(query, params)
        students = [dict(r) for r in cursor.fetchall()]
        return {"total": total, "items": students}

class StudentCreate(BaseModel):
    name: str
    email: str
    phone: str
    unit_name: Optional[str] = "佛光學員"
    role: Optional[str] = "student"
    password: Optional[str] = None

@app.post("/api/admin/students")
def create_student(req: StudentCreate, user: dict = Depends(require_admin)):
    with get_db() as conn:
        cursor = conn.cursor()
        # Check duplicate
        cursor.execute("SELECT id FROM users WHERE email = ?", (req.email,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="該 Email 已註冊")
            
        p_hash = hash_password(req.password or req.phone)
        cursor.execute("""
        INSERT INTO users (name, email, phone, password_hash, role, unit_name)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (req.name, req.email, req.phone, p_hash, req.role or "student", req.unit_name or "佛光學員"))
        return {"success": True, "id": cursor.lastrowid, "message": f"學員 {req.name} 新增成功！"}

@app.put("/api/admin/students/{student_id}")
def update_student(student_id: int, req: StudentCreate, user: dict = Depends(require_admin)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        UPDATE users SET
            name = ?, email = ?, phone = ?, unit_name = ?, role = ?
        WHERE id = ?
        """, (req.name, req.email, req.phone, req.unit_name or "佛光學員", req.role or "student", student_id))
        return {"success": True, "message": "學員資料更新成功！"}

@app.delete("/api/admin/students/{student_id}")
def delete_student(student_id: int, user: dict = Depends(require_admin)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM users WHERE id = ?", (student_id,))
        return {"success": True, "message": "學員資料已成功刪除！"}

@app.put("/api/admin/students/{student_id}/reset-password")
def reset_student_password(student_id: int, user: dict = Depends(require_admin)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT phone FROM users WHERE id = ?", (student_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到學員")
        p_hash = hash_password(row["phone"])
        cursor.execute("UPDATE users SET password_hash = ? WHERE id = ?", (p_hash, student_id))
        return {"success": True, "message": f"密碼已重設為手機號碼（{row['phone']}）"}

class GradeSubmit(BaseModel):
    score: int
    comment: str

@app.put("/api/admin/worksheets/{worksheet_id}/grade")
def grade_worksheet(worksheet_id: int, req: GradeSubmit, user: dict = Depends(require_admin)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        UPDATE worksheets SET
            score = ?,
            teacher_comment = ?,
            status = 'reviewed',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """, (req.score, req.comment, worksheet_id))
        return {"success": True, "message": "批閱成績與評語已送出！"}

@app.get("/api/admin/export/csv")
def export_all_worksheets_csv(user: dict = Depends(require_admin)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT w.*, u.email, u.phone 
        FROM worksheets w
        JOIN users u ON w.user_id = u.id
        ORDER BY w.id ASC
        """)
        rows = [dict(r) for r in cursor.fetchall()]
        
        output = io.StringIO()
        # UTF-8 BOM for Excel compatibility
        output.write('\ufeff')
        writer = csv.writer(output)
        writer.writerow([
            "練習單ID", "學員姓名", "Email", "聯絡電話", "分會單位",
            "中心行動", "自選活動名稱", "聊天室格式文字", "狀態", "成績", "講師講評",
            "提交時間", "放射連動資料", "拉扯分析資料"
        ])
        
        for r in rows:
            writer.writerow([
                r["id"], r["user_name"], r["email"], r["phone"], r["unit_name"],
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
