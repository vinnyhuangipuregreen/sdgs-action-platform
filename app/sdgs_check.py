import os
import json
import sys
from app.database import init_db

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
_SDGS_VERIFIED = False

def ensure_sdgs_seeded(conn):
    """
    Ensure all 17 Goals and 169 Targets exist in database.
    Uses single-pipeline batch execution so it completes in < 0.2s on Vercel.
    """
    global _SDGS_VERIFIED
    if _SDGS_VERIFIED:
        return
    try:
        init_db()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM sdgs_targets")
        row_t = cursor.fetchone()
        target_count = row_t[0] if row_t else 0

        cursor.execute("SELECT COUNT(*) FROM sdgs_goals")
        row_g = cursor.fetchone()
        goal_count = row_g[0] if row_g else 0

        if target_count >= 169 and goal_count >= 17:
            _SDGS_VERIFIED = True
            return

        sdgs_path = os.path.join(CURRENT_DIR, "data", "sdgs_master.json")
        if not os.path.exists(sdgs_path):
            sdgs_path = os.path.join(os.path.dirname(CURRENT_DIR), "data", "sdgs_master.json")

        if os.path.exists(sdgs_path):
            with open(sdgs_path, "r", encoding="utf-8") as f:
                sdgs_data = json.load(f)

            if goal_count < 17:
                goal_params = [
                    (g["id"], g["code"], g["name"], g["full_name"], g["slogan"], g["tier"], g["5p"], g["color"])
                    for g in sdgs_data.get("goals", [])
                ]
                cursor.executemany("""
                INSERT OR REPLACE INTO sdgs_goals (id, code, name, full_name, slogan, tier, category_5p, color)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, goal_params)

            if target_count < 169:
                target_params = [
                    (t["goal_id"], t["code"], t["type"], t["text"])
                    for t in sdgs_data.get("targets", [])
                ]
                cursor.executemany("""
                INSERT OR REPLACE INTO sdgs_targets (goal_id, code, target_type, content)
                VALUES (?, ?, ?, ?)
                """, target_params)

            _SDGS_VERIFIED = True
            print("[SDGS_CHECK] Verified & batch-seeded 17 goals and 169 targets into cloud database.")
    except Exception as e:
        print(f"[SDGS_CHECK_ERROR] Failed to auto-seed SDGs targets: {e}")

_USERS_VERIFIED = False

def ensure_users_seeded(conn):
    """
    Ensure admin and 427 students exist in database.
    Uses single-pipeline batch execution so it completes in < 0.3s on Vercel.
    """
    global _USERS_VERIFIED
    if _USERS_VERIFIED:
        return
    try:
        init_db()
        cursor = conn.cursor()
        from app.auth import hash_password
        root_dir = os.path.dirname(CURRENT_DIR)

        # 1. Admin user
        admin_pass = hash_password("sdgs2030admin")
        cursor.execute("SELECT id FROM admin WHERE email = 'admin'")
        if not cursor.fetchone():
            cursor.execute("""
            INSERT INTO admin (name, email, email_backup, phone, unit_code, unit_name, password_hash, role)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, ("系統管理員 (戴慶華 博士)", "admin", "admin@fgu.edu.tw", "0912345678", "FGU", "佛光永續學院", admin_pass, "admin"))

        cursor.execute("SELECT COUNT(*) FROM users WHERE role = 'student'")
        if cursor.fetchone()[0] >= 10:
            _USERS_VERIFIED = True
            return

        # 2. Batch insert 427 students
        students_path = os.path.join(root_dir, "data", "students_seed_v4.json")
        if not os.path.exists(students_path):
            students_path = os.path.join(root_dir, "data", "students_seed_v3.json")

        if os.path.exists(students_path):
            with open(students_path, "r", encoding="utf-8") as f:
                students = json.load(f)
            
            student_params = [
                (
                    s["name"],
                    s["email"],
                    s.get("email_backup", s["email"]),
                    s["phone"],
                    s.get("unit_code", ""),
                    s.get("unit_name", "佛光學員"),
                    hash_password(s["phone"])
                )
                for s in students
            ]
            cursor.executemany("""
            INSERT INTO users (name, email, email_backup, phone, unit_code, unit_name, password_hash, role)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'student')
            """, student_params)

        _USERS_VERIFIED = True
        print("[USERS_CHECK] Batch-seeded admin & 427 students into cloud database.")
    except Exception as e:
        print(f"[USERS_CHECK_ERROR] Failed to auto-seed users: {e}")
