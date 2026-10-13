"""
Google Cloud Firestore Standalone Sync Script
佛光永續學院 × 佛光大學 ｜ SDGs 平台 Cloud Firestore 一鍵資料同步工具
"""
import os
import sys
import json
import sqlite3

def sync_to_firestore():
    print("==================================================")
    print("🔥 SDGs 平台 Cloud Firestore 資料同步作業開始")
    print("==================================================")

    # 1. 檢查 google-cloud-firestore 套件
    try:
        from google.cloud import firestore
    except ImportError:
        print("\n❌ 錯誤：尚未安裝 google-cloud-firestore 套件！")
        print("請在終端機先執行以下指令安裝：")
        print("pip install google-cloud-firestore")
        return False

    # 2. 取得憑證與專案 ID
    project_id = os.environ.get("FIRESTORE_PROJECT_ID", "dgs-action-platform")
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    
    if not cred_path:
        local_sa = os.path.join(os.path.dirname(os.path.abspath(__file__)), "service-account.json")
        if os.path.exists(local_sa):
            cred_path = local_sa
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = local_sa

    if not cred_path or not os.path.exists(cred_path):
        print(f"\n❌ 錯誤：找不到金鑰檔案 service-account.json！")
        print("請確認已將從 Google Cloud 下載的金鑰 JSON 檔重新命名為 service-account.json 並放在當前目錄。")
        return False

    print(f"✓ 專案 ID：{project_id}")
    print(f"✓ 金鑰檔案：{cred_path}")

    # 3. 連線至 Firestore
    try:
        db = firestore.Client.from_service_account_json(cred_path, project=project_id)
        print("✓ 成功連線至 Cloud Firestore！\n")
    except Exception as e:
        print(f"\n❌ 連線至 Firestore 失敗：{e}")
        return False

    # 4. 同步 427 位學員名冊
    current_dir = os.path.dirname(os.path.abspath(__file__))
    students_path = os.path.join(current_dir, "data", "students_seed_v3.json")
    if not os.path.exists(students_path):
        students_path = os.path.join(current_dir, "data", "students_seed.json")

    if os.path.exists(students_path):
        with open(students_path, "r", encoding="utf-8") as f:
            students = json.load(f)
        print(f"📦 正在同步 {len(students)} 位學員資料至 Firestore 'users' 集合...")
        
        batch = db.batch()
        for idx, s in enumerate(students, start=1):
            doc_ref = db.collection("users").document(str(idx))
            data = {
                "id": idx,
                "name": s["name"],
                "email": s["email"],
                "email_backup": s.get("email_backup", ""),
                "phone": s["phone"],
                "unit_code": s.get("unit_code", ""),
                "unit_name": s.get("unit_name", "佛光學員"),
                "role": "student"
            }
            batch.set(doc_ref, data)
            if idx % 400 == 0:
                batch.commit()
                batch = db.batch()
        batch.commit()
        print(f"  ✓ 已成功寫入 {len(students)} 筆學員資料！")

    # 5. 同步 SDGs 17 目標與 169 細項
    sdgs_path = os.path.join(current_dir, "data", "sdgs_master.json")
    if os.path.exists(sdgs_path):
        with open(sdgs_path, "r", encoding="utf-8") as f:
            sdgs_data = json.load(f)
        
        # 17 目標
        print("📦 正在同步 17 項 SDGs 目標至 'sdgs_goals' 集合...")
        for g in sdgs_data.get("goals", []):
            db.collection("sdgs_goals").document(str(g["id"])).set(g)
        print("  ✓ 已成功寫入 17 項 SDGs 核心目標！")

        # 169 細項
        targets = sdgs_data.get("targets", [])
        print(f"📦 正在同步 {len(targets)} 項細項目標至 'sdgs_targets' 集合...")
        batch = db.batch()
        for idx, t in enumerate(targets, start=1):
            doc_ref = db.collection("sdgs_targets").document(t["code"])
            batch.set(doc_ref, t)
            if idx % 400 == 0:
                batch.commit()
                batch = db.batch()
        batch.commit()
        print(f"  ✓ 已成功寫入 {len(targets)} 項具體承諾細項！")

    print("\n==================================================")
    print("🎉 恭喜！Cloud Firestore 雲端資料庫已全部同步建置完成！")
    print("==================================================")
    return True

if __name__ == "__main__":
    sync_to_firestore()
