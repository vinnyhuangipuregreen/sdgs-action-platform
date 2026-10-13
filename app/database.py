import sqlite3
import os
from contextlib import contextmanager

def get_db_path():
    db_env = os.environ.get("DATABASE_PATH")
    if db_env:
        return db_env
    # Check if local repo directory supports sqlite locking
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
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            email_backup TEXT,
            phone TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'student',
            unit_name TEXT DEFAULT '佛光學員',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        """)
        
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
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS sdgs_targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            goal_id INTEGER NOT NULL,
            code TEXT NOT NULL UNIQUE,
            target_type TEXT NOT NULL,
            content TEXT NOT NULL,
            FOREIGN KEY (goal_id) REFERENCES sdgs_goals(id) ON DELETE CASCADE
        );
        """)
        
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
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        """)
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS game_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            user_name TEXT NOT NULL,
            score INTEGER NOT NULL,
            max_combo INTEGER NOT NULL,
            earth_health INTEGER NOT NULL,
            risks_solved INTEGER NOT NULL DEFAULT 0,
            title_earned TEXT NOT NULL,
            played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        """)
        
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_worksheets_user ON worksheets(user_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_game_scores_score ON game_scores(score DESC);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_targets_goal ON sdgs_targets(goal_id);")
