# 集中帳號與單一登入

`admin` 與 `student` 由 `sdgs-action-platform` 移至 Turso `sdgs-role-permission`，保留 ID、密碼雜湊、角色、欄位、索引及 sqlite_sequence。主平台使用 `ROLE_DATABASE_URL`、`ROLE_AUTH_TOKEN`，活動資料仍使用原 `TURSO_DATABASE_URL`。未設定獨立帳號庫的本機測試維持 SQLite。正式切換後，初始化不會在活動庫重新建立帳號表或從舊 users 重建。

遷移腳本 `scripts/migrate_role_accounts.py` 從指定憑證檔讀取兩端連線，不在程式碼包含 Token。`snapshot` 備份；`copy` 暫停來源兩張帳號表的寫入並一次交易複製；比對完整資料、DDL、索引與序號；確認網站成功後才以 `finalize` 刪除來源兩張表及 account_profiles view。活動、練習紀錄與其他資料表不搬移。若中止，`unfreeze` 可恢復來源帳號寫入。備份保存在使用者本機 AppData 的 BLIA/backups，未提交 Git。

跨庫練習單、DOCX、CSV、批閱通知改以帳號類型及原 ID 查詢中央名冊，無跨庫 SQL JOIN。

課程單一登入使用短效、一次性、指定回呼的 PKCE 授權碼，Token 不放在網址。課程 HttpOnly / Secure cookie 僅保存簽章工作階段，身分及權限向主平台驗證；不再接受課程舊帳號 cookie 或獨立密碼登入。重複登入同一平台帳號不要求再輸入密碼。主平台登出會撤銷共用 session，課程重新驗證後同樣失效。

課程使用 platform_key（帳號類型加中央 ID）對應課程學員 ID；唯一 Email 對應的舊課程紀錄保留原 ID，避免碰撞。課程資料仍存放在 sdgs-attendance-record。
