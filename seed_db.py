import os
import json
import sqlite3
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, CURRENT_DIR)

from app.database import get_db, init_db, DB_PATH
from app.auth import hash_password

def seed():
    print(f"Initializing database at: {DB_PATH}")
    init_db()
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. Seed SDGs Goals & Targets
        sdgs_path = os.path.join(CURRENT_DIR, "data", "sdgs_master.json")
        if os.path.exists(sdgs_path):
            with open(sdgs_path, "r", encoding="utf-8") as f:
                sdgs_data = json.load(f)
            
            cursor.execute("SELECT COUNT(*) FROM sdgs_goals")
            if cursor.fetchone()[0] == 0:
                print("Seeding 17 SDGs Goals...")
                for g in sdgs_data["goals"]:
                    cursor.execute("""
                    INSERT INTO sdgs_goals (id, code, name, full_name, slogan, tier, category_5p, color)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (g["id"], g["code"], g["name"], g["full_name"], g["slogan"], g["tier"], g["5p"], g["color"]))
                
                print("Seeding 169 SDGs Targets...")
                for t in sdgs_data["targets"]:
                    cursor.execute("""
                    INSERT INTO sdgs_targets (goal_id, code, target_type, content)
                    VALUES (?, ?, ?, ?)
                    """, (t["goal_id"], t["code"], t["type"], t["text"]))
                print("SDGs goals and targets seeded successfully!")

        # 2. Seed Admin user (admin / sdgs2030admin)
        admin_pass = hash_password("sdgs2030admin")
        cursor.execute("SELECT id FROM admin WHERE email = 'admin'")
        admin_row = cursor.fetchone()
        if not admin_row:
            cursor.execute("""
            INSERT INTO admin (name, email, email_backup, phone, unit_code, unit_name, password_hash, role)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, ("系統管理員 (戴慶華 博士)", "admin", "admin@fgu.edu.tw", "0912345678", "FGU", "佛光永續學院", admin_pass, "admin"))
            print("Admin user created: admin / sdgs2030admin")
        else:
            cursor.execute("UPDATE admin SET password_hash = ?, role = 'admin' WHERE id = ?", (admin_pass, admin_row[0]))

        # 3. Seed Students (427 students with test001@gmail.com ~ test427@gmail.com and full 6 columns)
        students_path = os.path.join(CURRENT_DIR, "data", "students_seed_v4.json")
        if not os.path.exists(students_path):
            students_path = os.path.join(CURRENT_DIR, "data", "students_seed_v3.json")
            
        if os.path.exists(students_path):
            with open(students_path, "r", encoding="utf-8") as f:
                students = json.load(f)
            
            # Reset student records to ensure latest official list is loaded
            cursor.execute("DELETE FROM student WHERE role = 'student'")
            print(f"Seeding {len(students)} students with latest schema (test001@gmail.com ~ test427@gmail.com)...")
            for s in students:
                p_hash = hash_password(s["phone"])
                cursor.execute("""
                INSERT INTO student (name, email, email_backup, phone, unit_code, unit_name, password_hash, role)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'student')
                """, (s["name"], s["email"], s.get("email_backup", s["email"]), s["phone"], s.get("unit_code", ""), s.get("unit_name", "佛光學員"), p_hash))
            print(f"All {len(students)} students seeded successfully!")

        # 4. Seed sample worksheet
        cursor.execute("SELECT COUNT(*) FROM worksheets")
        if cursor.fetchone()[0] == 0:
            cursor.execute("SELECT id, name, unit_name, unit_code, email FROM student WHERE role = 'student' LIMIT 1")
            s1 = cursor.fetchone()
            if s1:
                radial1 = json.dumps([
                    {
                        "goal": "SDG 14 永續海洋與保育",
                        "mechanism": "清除海灘與潮間帶的廢棄塑膠垃圾，阻止塑膠裂解成微塑膠進入海洋食物鏈",
                        "observable": "海岸線可見塑膠垃圾大幅減少，潮間帶底棲生物與寄居蟹重新聚集活動"
                    },
                    {
                        "goal": "SDG 12 責任消費與生產",
                        "mechanism": "透過淨灘垃圾分類統計(ICC國際淨灘分類法)，回饋至源頭減量宣導，促使民眾減少使用一次性塑膠袋",
                        "observable": "參與學員自備環保水杯與購物袋比例提高至90%以上"
                    },
                    {
                        "goal": "SDG 3 健康與福祉",
                        "mechanism": "青年與長者戶外淨灘健走促進身心健康，並降低民眾赤腳踩到碎玻璃或針頭的受傷風險",
                        "observable": "活動後學員活力充沛，沙灘遊憩安全滿意度顯著提升"
                    }
                ], ensure_ascii=False)
                
                tradeoff1 = json.dumps([
                    {
                        "who": "海岸沙丘植被、清運清潔隊員",
                        "situation": "大量淨灘志工未注意腳下踩踏脆弱沙丘植被，且清出的海量海廢集中在路邊未及時運走造成二次髒亂",
                        "how": "規劃指定進出木棧道路線，並預先協調地方環保局垃圾車當日即時清運並落實妥善資源回收分流"
                    }
                ], ensure_ascii=False)
                
                causal1 = json.dumps({
                    "start": "發起社區青年假日海灘淨灘行動",
                    "start_cond": "事前與環保局合作規劃回收動線與提供安全裝備",
                    "mid": "清運海廢500公斤並進行ICC海廢監測數據分析",
                    "mid_cond": "志工經專業分類訓練且清運車輛如期載運",
                    "result": "海洋生物誤食塑膠風險顯著降低，社區減塑意識深化",
                    "result_cond": "在地居民與店家持續配合減塑不復發"
                }, ensure_ascii=False)
                
                cursor.execute("""
                INSERT INTO worksheets (user_id, user_name, unit_name, center_action, center_custom, radial_data, tradeoff_data, chat_text, causal_data, self_checks, commitment, status, score, teacher_comment)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    s1["id"], s1["name"], s1["unit_name"], "A", "一次淨灘",
                    radial1, tradeoff1,
                    "A｜一次淨灘｜14、12、3｜風險：清出的垃圾未妥善處置造成二次污染與沙丘踩踏",
                    causal1, json.dumps([True, True, True, True]),
                    json.dumps({
                        "start_action": "每週日帶領佛光青年淨灘並推動生活減塑",
                        "target_1": "SDG 14 永續海洋",
                        "target_2": "SDG 12 責任消費",
                        "risk_aware": "淨灘踩踏脆弱沙丘生態與垃圾未即時清運",
                        "metric": "自己與分會青年每月自備環保餐具率達100%及沙灘ICC海廢監測表"
                    }, ensure_ascii=False),
                    "reviewed", 98,
                    "分析非常透徹！作用機制具備具體生物化學與環境邏輯，拉扯檢查提出配套防護，堪稱模範練習單！"
                ))

    print("Database seeding completed successfully!")

if __name__ == "__main__":
    seed()
