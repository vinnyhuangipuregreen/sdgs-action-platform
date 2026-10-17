# BLIA SDGs 社會影響力系統

共用樣式位於 `app/static/css/design-system.css`，配對賽使用相同檔案。`scripts/sync_matching_admin.py` 從相鄰的 `sdgs-matching-game` 專案同步管理畫面、管理 JavaScript、基礎樣式與共用設計系統；修改配對賽後台時請重新執行並檢查 diff。

主色為 #16A34A、#0EA5A4、#3B82F6、#65A30D；白字按鈕使用較深的 #15803D、#0F766E、#1D4ED8、#4D7C0F。主要文字 #1F2937，背景 #F8FAFC。原有 SDGs 目標色保留。主要文字、次要文字、錯誤提示與模組按鈕的文字對比以測試確認至少 4.5:1。支援鍵盤焦點、跳至內容與減少動畫設定。

首頁提供四個模組；NSP 與臘八粥未接入功能，以停用按鈕及「尚未開放」標記呈現。現有速查表、地球保衛戰與英雄榜保留於延伸學習工具。

## 統一管理登入

- 管理員及講師使用主平台 `admin` 表登入，學員維持原有權限。
- 統一後台內的配對賽畫面沿用原管理程式，經受保護的 `/api/matching-admin/*` 介面轉接至配對賽。
- 轉接僅允許原有統計、紀錄、指標、參數與 CSV 功能。遊戲資料留在原資料庫，不搬移帳號或複製密碼。
- 配對賽收到 `platform:` 認證時，向主平台 `/api/auth/me` 驗證有效帳號及角色；原生管理 API 與原有 session 驗證仍保留。驗證服務不可用時拒絕存取。
- 兩個專案需一併發布，先發布配對賽的登入相容功能，再發布主平台。測試不得對正式站新增遊戲紀錄、改參數或刪資料。

## 插圖與提示詞

使用內建 imagegen 工具生成；無使用 CLI 或外部 API key。圖片存放於 `app/static/images/`，原始圖片亦保留於 Codex 的 generated_images 目錄。插圖為裝飾與學習情境，不代表真實研究人員肖像。

共用風格提示：friendly refined 3D clay illustration, premium academic sustainability educational portal, soft rounded forms, soft daylight, dimensional materials, airy pale mint-white background; sustainable green #16A34A, turquoise #0EA5A4, blue #3B82F6, grass #65A30D. No UI, no buttons, no labels, no watermark.

- `hero.png`：Wide panoramic 3:1 hero illustration. A small inclusive group of Taiwanese adult educators and two students beside a large blue-green globe, native trees, wind turbines and a contemporary campus. Subjects center/right; softly fading pale mint negative space on the left for HTML headings. Uploaded website mockup is a style and subject reference only. No text or numbers.
- `matching.png`：Landscape 3:2. A polished gold trophy holding a circular multicolored SDGs-inspired wheel, a white study checklist and fresh green leaves. Green module accents #16A34A. No human characters or text.
- `worksheet.png`：Landscape 3:2. An academic research report with blue bars, a magnifying glass, a small globe and a sprouting leaf. Blue module accents #3B82F6. No human characters or text.
- `carbon.png`：Landscape 3:2. A turquoise carbon cloud marked only CO₂, trees, rising data bars and a calculator. Turquoise accents #0EA5A4. No other text or human characters.
- `food.png`：Landscape 3:2. A bowl of steaming red-bean and mixed-grain porridge surrounded by beans, pumpkin, peanuts and leaves. Grass green accents #65A30D. No text or human characters.

## 響應式排版

桌機首頁為四欄；800px 以下為兩欄、三欄導覽；520px 以下改為單欄卡片、兩欄導覽與直式因果分析，每格仍顯示對應題目。手機頁首隨頁捲動，避免佔住內容。輸入欄位採 16px 字體，主要按鈕至少 44px 高；彈窗高度依可視區限制並可內部捲動。後台寬表格保留表格內橫向捲動。已檢查 320、390、768、1440px 的首頁及練習單；配對賽同步使用同一份樣式。
