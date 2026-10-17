import os
import json
import sqlite3
import requests
from contextlib import contextmanager
from typing import Optional, List, Dict, Any

# ==============================================================================
# Turso / LibSQL HTTP Client for Remote Permanent SQLite Cloud Database
# Supports Single & Batch Pipeline Execution for High-Speed Serverless Queries
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

    def _encode_args(self, params: tuple):
        args = []
        for p in params:
            if p is None:
                args.append({"type": "null"})
            elif isinstance(p, bool):
                args.append({"type": "integer", "value": "1" if p else "0"})
            elif isinstance(p, int):
                args.append({"type": "integer", "value": str(p)})
            elif isinstance(p, float):
                args.append({"type": "float", "value": p})
            elif isinstance(p, bytes):
                import base64
                args.append({"type": "blob", "base64": base64.b64encode(p).decode()})
            else:
                args.append({"type": "text", "value": str(p)})
        return args

    def execute(self, sql: str, params: tuple = ()):
        args = self._encode_args(params)
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
            timeout=15
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

    def executemany(self, sql: str, seq_of_params: list):
        """
        Execute multiple statements in a SINGLE HTTP pipeline request (up to 250 per batch)
        so seeding 427 students or 169 targets takes < 0.3 seconds on Vercel!
        """
        if not seq_of_params:
            return self
        
        chunk_size = 200
        for i in range(0, len(seq_of_params), chunk_size):
            chunk = seq_of_params[i:i + chunk_size]
            reqs = []
            for params in chunk:
                args = self._encode_args(params)
                stmt = {"sql": sql}
                if args:
                    stmt["args"] = args
                reqs.append({"type": "execute", "stmt": stmt})
            reqs.append({"type": "close"})

            res = requests.post(
                f"{self.client.base_url}/v2/pipeline",
                headers={
                    "Authorization": f"Bearer {self.client.auth_token}",
                    "Content-Type": "application/json"
                },
                json={"requests": reqs},
                timeout=20
            )
            if not res.ok:
                raise Exception(f"Turso Batch HTTP error {res.status_code}: {res.text}")
            for result in res.json().get("results", []):
                if result.get("type") == "error":
                    raise Exception(f"SQL error: {result.get('error', {}).get('message')}")
        return self

    def execute_batch(self, statements: list):
        """
        Execute a list of (sql, params) tuples in a single HTTP pipeline call.
        """
        if not statements:
            return self
        reqs = []
        for item in statements:
            if isinstance(item, str):
                reqs.append({"type": "execute", "stmt": {"sql": item}})
            else:
                sql, params = item
                args = self._encode_args(params)
                stmt = {"sql": sql}
                if args:
                    stmt["args"] = args
                reqs.append({"type": "execute", "stmt": stmt})
        reqs.append({"type": "close"})

        res = requests.post(
            f"{self.client.base_url}/v2/pipeline",
            headers={
                "Authorization": f"Bearer {self.client.auth_token}",
                "Content-Type": "application/json"
            },
            json={"requests": reqs},
            timeout=20
        )
        if not res.ok:
            raise Exception(f"Turso Batch HTTP error {res.status_code}: {res.text}")
        for result in res.json().get("results", []):
            if result.get("type") == "error":
                raise Exception(f"SQL error: {result.get('error', {}).get('message')}")
        return self

    def execute_transaction(self, statements):
        steps = [{"stmt": {"sql": "BEGIN IMMEDIATE"}}]
        for sql in [*statements, "COMMIT"]:
            steps.append({"condition": {"type": "ok", "step": len(steps) - 1}, "stmt": {"sql": sql}})
        steps.append({"condition": {"type": "and", "conds": [
            {"type": "ok", "step": 0},
            {"type": "not", "cond": {"type": "ok", "step": len(steps) - 1}}
        ]}, "stmt": {"sql": "ROLLBACK"}})
        response = requests.post(
            f"{self.client.base_url}/v2/pipeline",
            headers={"Authorization": f"Bearer {self.client.auth_token}", "Content-Type": "application/json"},
            json={"requests": [{"type": "batch", "batch": {"steps": steps}}, {"type": "close"}]},
            timeout=30,
        )
        response.raise_for_status()
        result = response.json()["results"][0]
        if result.get("type") == "error":
            raise RuntimeError(result["error"]["message"])
        for error in result["response"]["result"]["step_errors"]:
            if error:
                raise RuntimeError(error["message"])

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
        base_url = base_url.strip()
        auth_token = auth_token.strip()
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
    url = os.environ.get("TURSO_DATABASE_URL", "").strip()
    token = os.environ.get("TURSO_AUTH_TOKEN", "").strip()
    return bool(url and token)

def get_db_path():
    db_env = os.environ.get("DATABASE_PATH")
    if db_env:
        return db_env
    # On Vercel or read-only filesystems, always fall back to /tmp/sdgs.db
    if os.environ.get("VERCEL"):
        return "/tmp/sdgs.db"
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
        url = os.environ.get("TURSO_DATABASE_URL", "").strip()
        token = os.environ.get("TURSO_AUTH_TOKEN", "").strip()
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

_DB_INITIALIZED = False

def init_db():
    global _DB_INITIALIZED
    if _DB_INITIALIZED:
        return
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('staff_accounts', 'admin')")
        account_tables = {row["name"] for row in cursor.fetchall()}
        if "staff_accounts" in account_tables:
            if "admin" in account_tables:
                raise RuntimeError("Both staff_accounts and admin exist; refusing to overwrite account data")
            cursor.execute("ALTER TABLE staff_accounts RENAME TO admin")

        ddl_statements = [
            """CREATE TABLE IF NOT EXISTS action_catalog (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                name TEXT NOT NULL,
                UNIQUE(category, name)
            );""",
            """CREATE TABLE IF NOT EXISTS users (
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
            );""",
            """CREATE TABLE IF NOT EXISTS admin (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                email_backup TEXT,
                phone TEXT NOT NULL,
                unit_code TEXT DEFAULT '',
                unit_name TEXT DEFAULT '佛光永續學院',
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'teacher')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );""",
            """CREATE TABLE IF NOT EXISTS sdgs_goals (
                id INTEGER PRIMARY KEY,
                code TEXT NOT NULL,
                name TEXT NOT NULL,
                full_name TEXT NOT NULL,
                slogan TEXT NOT NULL,
                tier TEXT NOT NULL,
                category_5p TEXT NOT NULL,
                color TEXT NOT NULL
            );""",
            """CREATE TABLE IF NOT EXISTS sdgs_targets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                goal_id INTEGER NOT NULL,
                code TEXT NOT NULL UNIQUE,
                target_type TEXT NOT NULL,
                content TEXT NOT NULL
            );""",
            """CREATE TABLE IF NOT EXISTS worksheets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                user_name TEXT NOT NULL,
                unit_name TEXT NOT NULL,
                center_action TEXT NOT NULL,
                center_custom TEXT,
                activity_description TEXT NOT NULL DEFAULT '',
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
            );""",
            """CREATE TABLE IF NOT EXISTS game_scores (
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
            );""",
            """CREATE TABLE IF NOT EXISTS system_email_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                worksheet_id INTEGER,
                recipient TEXT NOT NULL,
                student_name TEXT NOT NULL,
                subject TEXT NOT NULL,
                score INTEGER,
                comment TEXT,
                status TEXT NOT NULL,
                sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );""",
            """CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );""",
            "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);",
            "CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);",
            "CREATE INDEX IF NOT EXISTS idx_worksheets_user ON worksheets(user_id);",
            "CREATE INDEX IF NOT EXISTS idx_game_scores_score ON game_scores(score DESC);",
            "CREATE INDEX IF NOT EXISTS idx_targets_goal ON sdgs_targets(goal_id);"
        ]
        for k, v in DEFAULT_GAME_SETTINGS.items():
            ddl_statements.append((
                "INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)",
                (f"game_{k}", str(v))
            ))

        if hasattr(cursor, "execute_batch"):
            cursor.execute_batch(ddl_statements)
        else:
            for item in ddl_statements:
                if isinstance(item, str):
                    cursor.execute(item)
                else:
                    cursor.execute(item[0], item[1])
        cursor.execute("PRAGMA table_info(worksheets)")
        if "activity_description" not in {row["name"] for row in cursor.fetchall()}:
            cursor.execute("ALTER TABLE worksheets ADD COLUMN activity_description TEXT NOT NULL DEFAULT ''")
        for table in ("worksheets", "game_scores"):
            cursor.execute(f"PRAGMA table_info({table})")
            if "account_type" not in {row["name"] for row in cursor.fetchall()}:
                cursor.execute(f"ALTER TABLE {table} ADD COLUMN account_type TEXT NOT NULL DEFAULT 'student'")
        migrate_staff_accounts(cursor)
        retain_requested_admin_accounts(cursor)
        cursor.execute("""CREATE VIEW IF NOT EXISTS account_profiles AS
            SELECT id, name, email, email_backup, phone, unit_code, unit_name, role, created_at, 'student' AS account_type FROM users
            UNION ALL
            SELECT id, name, email, email_backup, phone, unit_code, unit_name, role, created_at, 'staff' AS account_type FROM admin
        """)
        cursor.execute("SELECT value FROM system_settings WHERE key = 'action_catalog_initialized'")
        if not cursor.fetchone():
            catalog_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "action_catalog.json")
            with open(catalog_path, encoding="utf-8") as source:
                catalog = json.load(source)
            cursor.execute("""
                INSERT OR IGNORE INTO action_catalog (category, name)
                SELECT json_extract(value, '$.category'), json_extract(value, '$.name') FROM json_each(?)
                WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE key = 'action_catalog_initialized')
            """, (json.dumps(catalog, ensure_ascii=False),))
            cursor.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('action_catalog_initialized', '1')")
        _DB_INITIALIZED = True

def migrate_staff_accounts(cursor):
    pending = "NOT EXISTS (SELECT 1 FROM system_settings WHERE key = 'staff_accounts_separated_v1')"
    columns = "id, name, email, email_backup, phone, unit_code, unit_name, password_hash, role, created_at"
    statements = [
        f"INSERT INTO admin ({columns}) SELECT {columns} FROM users WHERE role IN ('admin', 'teacher') AND {pending}",
        *[f"UPDATE {table} SET account_type = 'staff' WHERE user_id IN (SELECT id FROM users WHERE role IN ('admin', 'teacher')) AND {pending}"
          for table in ("worksheets", "game_scores")],
        f"DELETE FROM users WHERE role IN ('admin', 'teacher') AND {pending}",
        "INSERT OR IGNORE INTO system_settings (key, value) VALUES ('staff_accounts_separated_v1', '1')",
    ]
    if hasattr(cursor, "execute_transaction"):
        cursor.execute_transaction(statements)
    else:
        for sql in statements:
            cursor.execute(sql)

def retain_requested_admin_accounts(cursor):
    statements = [
        """DELETE FROM admin
           WHERE NOT ((id = 1 AND email = 'admin') OR
                      (id = 429 AND email = 'vinnyhuang.ipuregreen@gmail.com'))
           AND NOT EXISTS (SELECT 1 FROM system_settings WHERE key = 'admin_table_retained_accounts_v1')""",
        "INSERT OR IGNORE INTO system_settings (key, value) VALUES ('admin_table_retained_accounts_v1', '1')",
    ]
    if hasattr(cursor, "execute_transaction"):
        cursor.execute_transaction(statements)
    else:
        for sql in statements:
            cursor.execute(sql)

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
