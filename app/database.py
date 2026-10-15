import os
import json
import sqlite3
import requests
from contextlib import contextmanager
from typing import Optional, List, Dict, Any

# ==============================================================================
# Turso / LibSQL HTTP Client for Remote Permanent SQLite Cloud Database
# ==============================================================================
class TursoRow(dict):
    """
    Emulates sqlite3.Row: supports both dictionary key access ('email')
    and numerical index access (row[0], row[1]), plus dict(row) conversion.
    """
    def __init__(self, cols: list, values: list):
        super().__init__(zip(cols, values))
        self._cols = cols
        self._values = values

    def __getitem__(self, item):
        if isinstance(item, int):
            return self._values[item]
        return super().__getitem__(item)

    def keys(self):
        return self._cols

    def values(self):
        return self._values


class TursoCursor:
    def __init__(self, client):
        self.client = client
        self._results = []
        self._idx = 0
        self.rowcount = 0
        self.lastrowid = None

    def execute(self, sql: str, params: tuple = ()):
        args = []
        for p in params:
            if p is None:
                args.append({"type": "null"})
            elif isinstance(p, int):
                args.append({"type": "integer", "value": str(p)})
            elif isinstance(p, float):
                args.append({"type": "float", "value": p})
            elif isinstance(p, bytes):
                import base64
                args.append({"type": "blob", "base64": base64.b64encode(p).decode()})
            else:
                args.append({"type": "text", "value": str(p)})

        stmt = {"sql": sql}
        if args:
            stmt["args"] = args

        payload = {
            "requests": [
                {"type": "execute", "stmt": stmt},
                {"type": "close"}
            ]
        }

        res = requests.post(
            f"{self.client.base_url}/v2/pipeline",
            headers={
                "Authorization": f"Bearer {self.client.auth_token}",
                "Content-Type": "application/json"
            },
            json=payload,
            timeout=10
        )
        if not res.ok:
            raise Exception(f"Turso HTTP error {res.status_code}: {res.text}")

        data = res.json()
        exec_res = data["results"][0]
        if exec_res.get("type") == "error":
            raise Exception(f"SQL error: {exec_res.get('error', {}).get('message')}")

        result_data = exec_res.get("response", {}).get("result", {})
        self.rowcount = result_data.get("affected_row_count", 0)
        self.lastrowid = result_data.get("last_insert_rowid")

        cols = [c["name"] for c in result_data.get("cols", [])]
        raw_rows = result_data.get("rows", [])
        
        parsed_rows = []
        for row in raw_rows:
            row_vals = []
            for cell in row:
                val = cell.get("value")
                c_type = cell.get("type")
                if c_type == "null":
                    row_vals.append(None)
                elif c_type == "integer":
                    row_vals.append(int(val) if val is not None else None)
                elif c_type == "float":
                    row_vals.append(float(val) if val is not None else None)
                else:
                    row_vals.append(val)
            parsed_rows.append(TursoRow(cols, row_vals))

        self._results = parsed_rows
        self._idx = 0
        return self

    def fetchone(self):
        if self._idx < len(self._results):
            r = self._results[self._idx]
            self._idx += 1
            return r
        return None

    def fetchall(self):
        res = self._results[self._idx:]
        self._idx = len(self._results)
        return res


class TursoConnection:
    def __init__(self, base_url: str, auth_token: str):
        # Convert libsql:// to https://
        if base_url.startswith("libsql://"):
            base_url = "https://" + base_url[len("libsql://"):]
        elif base_url.startswith("http://"):
            base_url = "https://" + base_url[len("http://"):]
        self.base_url = base_url.rstrip("/")
        self.auth_token = auth_token

    def cursor(self):
        return TursoCursor(self)

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass

# ==============================================================================
# Database Configuration & Dual-Mode Routing
# ==============================================================================
def is_turso_configured() -> bool:
    url = os.environ.get("TURSO_DATABASE_URL")
    token = os.environ.get("TURSO_AUTH_TOKEN")
    return bool(url and token)

def get_db_path():
    db_env = os.environ.get("DATABASE_PATH")
    if db_env:
        return db_env
    local_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    local_path = os.path.join(local_dir, "sdgs.db")
    try:
        c = sqlite3.connect(local_path)
        c.execute("CREATE TABLE IF NOT EXISTS _fs_test (id INT)")
        c.execute("DROP TABLE _fs_test")
        c.close()
        return local_path
    except Exception:
        return "/tmp/sdgs.db"

DB_PATH = get_db_path()

def get_db_connection():
    if is_turso_configured():
        url = os.environ.get("TURSO_DATABASE_URL")
        token = os.environ.get("TURSO_AUTH_TOKEN")
        return TursoConnection(url, token)
    
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

@contextmanager
def get_db():
    conn = get_db_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Users table with unit_code and unit_name
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            email_backup TEXT,
            phone TEXT NOT NULL,
            unit_code TEXT DEFAULT '',
            unit_name TEXT DEFAULT '佛光學員',
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'student',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        """)
        
        # SDGs Goals table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS sdgs_goals (
            id INTEGER PRIMARY KEY,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            full_name TEXT NOT NULL,
            slogan TEXT NOT NULL,
            tier TEXT NOT NULL,
            category_5p TEXT NOT NULL,
            color TEXT NOT NULL
        );
        """)
        
        # SDGs Targets table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS sdgs_targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            goal_id INTEGER NOT NULL,
            code TEXT NOT NULL UNIQUE,
            target_type TEXT NOT NULL,
            content TEXT NOT NULL
        );
        """)
        
        # Worksheets table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS worksheets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            user_name TEXT NOT NULL,
            unit_name TEXT NOT NULL,
            center_action TEXT NOT NULL,
            center_custom TEXT,
            radial_data TEXT NOT NULL,
            tradeoff_data TEXT NOT NULL,
            chat_text TEXT NOT NULL,
            causal_data TEXT,
            self_checks TEXT NOT NULL,
            commitment TEXT NOT NULL,
            status TEXT DEFAULT 'submitted',
            score INTEGER,
            teacher_comment TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        """)
        
        # Game Scores table with game_type
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS game_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            user_name TEXT NOT NULL,
            game_type TEXT NOT NULL DEFAULT 'combo_blast',
            score INTEGER NOT NULL,
            max_combo INTEGER NOT NULL,
            earth_health INTEGER NOT NULL,
            risks_solved INTEGER NOT NULL DEFAULT 0,
            title_earned TEXT NOT NULL,
            played_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # Email Logs table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS system_email_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            worksheet_id INTEGER,
            recipient TEXT NOT NULL,
            student_name TEXT NOT NULL,
            subject TEXT NOT NULL,
            score INTEGER,
            comment TEXT,
            status TEXT NOT NULL,
            sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # System Settings table for game configuration
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """)

        # Seed default game settings if not present
        for k, v in DEFAULT_GAME_SETTINGS.items():
            cursor.execute("""
            INSERT OR IGNORE INTO system_settings (key, value)
            VALUES (?, ?)
            """, (f"game_{k}", str(v)))
        
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_worksheets_user ON worksheets(user_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_game_scores_score ON game_scores(score DESC);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_targets_goal ON sdgs_targets(goal_id);")

# Default Game Settings for 《SDGs 地球保衛戰》
DEFAULT_GAME_SETTINGS = {
    "game_duration": 45,        # 遊戲倒數總秒數 (秒)
    "card_speed_ms": 1000,      # 每張卡片閃過速度 (毫秒，1000ms = 1秒)
    "monster_pts": 100,         # 擊退危機破壞怪得分
    "guardian_penalty": 150,    # 誤打永續守護精靈扣分 (同時扣 1 顆心)
    "bonus_pts": 500,           # 彩虹永續金星 FEVER 得分
    "initial_lives": 3          # 起始生命愛心數
}

def get_game_settings(conn) -> dict:
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM system_settings WHERE key LIKE 'game_%'")
    rows = cursor.fetchall()
    settings = dict(DEFAULT_GAME_SETTINGS)
    for r in rows:
        key = r["key"].replace("game_", "", 1)
        val = r["value"]
        if key in settings:
            try:
                settings[key] = int(val)
            except (ValueError, TypeError):
                settings[key] = val
    return settings

def set_game_settings(conn, settings: dict) -> dict:
    cursor = conn.cursor()
    for key, val in settings.items():
        db_key = f"game_{key}"
        cursor.execute("""
        INSERT INTO system_settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """, (db_key, str(val)))
    return get_game_settings(conn)
