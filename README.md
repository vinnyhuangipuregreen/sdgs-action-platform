# SDGs 與氣候行動—連動分析與星際修復師互動學習平台

本專案依據 **佛光永續學院 × 佛光大學應用科技與設計學院** 戴慶華博士之授課教材設計，將「SDGs與氣候行動—連動分析練習單」全面數位化，整合 17 項 SDGs 與 169 項細項目標速查系統、預載 427 位學員帳號權限、年輕人瘋迷之「SDG 連鎖修復師：星際永續 Roguelike」卡牌挑戰遊戲、保衛英雄榜，並配備專業後台審閱與管理系統。

---

## 🌟 核心特色功能

1. **連動分析練習單完整 CRUD**：
   - 姓名與分會單位自動帶入，中心行動可依主題分類與關鍵字搜尋，並保留舊版 A–D 紀錄。
   - 放射型連動分析（作用機制、可觀察變化，至少 3 條線）。
   - 善意拉扯檢查（可能傷到誰、什麼情況、如何降低影響）。
   - 聊天室提交代碼一鍵生成與複製。
   - 課後進階因果鏈推導、自我檢核 4 關、我的連動承諾宣言。
   - 支援隨時儲存草稿、歷史紀錄清單查詢、線上修改與刪除。
2. **SDGs 17 目標 × 169 細項智慧速查**：
   - 婚禮蛋糕模型導覽（生物圈、社會、經濟、頂端夥伴）。
   - 5P 架構導覽（人、地球、繁榮、和平、夥伴）。
   - 即時關鍵字全文模糊檢索。
   - 目標卡片展開 169 項細項（區分成果目標 vs 執行方法），一鍵引用至練習單。
3. **427 位學員專屬帳號與身分驗證**：
   - 預載名單內 427 位學員，預設登入密碼為手機號碼（補齊 10 碼，如 `0920111111`）。
   - 提供 1-Click 快速測試切換選單（可快速以管理員或李O立等學員身分登入）。
4. **青年瘋迷遊戲：SDG 連鎖修復師（星際永續 Roguelike）**：
   - 融合卡牌構建、婚禮蛋糕跨層級 Combo（最高 2.5 倍乘數）、目標共鳴加成。
   - 10 秒倒數「善意拉扯危機事件」，挑選正確防禦配套化解危機加分。
   - 自動結算星際榮譽頭銜，一鍵登錄保衛英雄榜。
5. **專業後台管理儀表板**：
   - 統計看板（提交數、覆蓋率、最高分）。
   - Chart.js 雷達圖（17 項 SDGs 被選取次數分佈）、圓餅圖（中心行動比例）。
   - 學員練習單線上批閱（輸入評分與講評回饋）、一鍵批次匯出 CSV。
   - 427 位學員名單管理（搜尋、重設密碼、修改、刪除）。
   - 「儀錶板」右側的「分類」頁籤：管理員與講師可搜尋、新增、修改、刪除中心行動，並匯入／匯出 XLSX 名單。
   - 分類名單第一張工作表須包含 A1「主題類別」、B1「活動內容」，每列一項活動；匯入只新增缺少項目，重複略過，無效檔案整份不寫入。
   - 分類儲存在 Turso／SQLite，首次建立時載入 `data/action_catalog.json`，之後不重新補回已刪除項目；既有學習單保留原類別與活動名稱。

分類 API 測試使用獨立暫存 SQLite，不會連線正式 Turso：

```bash
pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

---

## 🚀 本地快速啟動

### 1. 安裝環境與套件
```bash
# 建議使用 Python 3.10+
pip install -r requirements.txt
```

### 2. 初始化資料庫與種子資料
```bash
# 自動建立資料庫並匯入 17 目標、169 細項、427 位學員名單與示範資料
python seed_db.py
```

### 3. 啟動 Web 服務
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
開啟瀏覽器前往：`http://localhost:8000` 即可使用！  
API 自動化文件（Swagger UI）：`http://localhost:8000/docs`

---

## 🔑 預設登入帳號密碼

管理員與講師帳號儲存在獨立的 `admin` 資料表，學員帳號儲存在 `student`。
舊的 `users` 表會自動改名為 `student`，保留全部學員欄位、編號、密碼及練習單、遊戲紀錄的關聯。
管理帳號 ID 會在此次更新整理為從 1 起的連續編號，並同步調整管理帳號的練習單、遊戲紀錄與自動遞增起點；改號帳號須重新登入。此整理只執行一次，之後刪除帳號不會重編其他帳號。
舊的 `staff_accounts` 表會自動改名為 `admin`；此次更新只清理一次，保留 #1 `admin` 與 #429 `vinnyhuang.ipuregreen@gmail.com`，不刪除學員、練習單或遊戲紀錄。
首次啟動新版時會自動搬移既有管理帳號，保留編號、密碼雜湊與建立時間，並標記其練習單與遊戲紀錄的帳號類別。搬移可重複執行，Turso 使用單一交易，失敗時回復整批搬移。
後台管理帳號使用 `/api/admin/staff`，學員帳號使用 `/api/admin/students`；管理後台登入會指定 `account_type: "staff"`。

| 角色 | 帳號 (Email 或 手機) | 登入密碼 | 說明 |
| :--- | :--- | :--- | :--- |
| **系統管理員** | `admin@fgu.edu.tw` | `admin888` | 戴慶華 博士 (具備後台全部權限) |
| **教學助教** | `teacher@fgu.edu.tw` | `teacher888` | 佛光教學助教 (具備批閱與後台權限) |
| **學員 (範例 1)** | `test001@gmail.com` 或 `0920111111` | `0920111111` | 學員：李O立 (已附示範練習單與戰績) |
| **學員 (範例 2)** | `test003@gmail.com` 或 `0920111111` | `0920111111` | 學員：釋O綺 |
| **學員 (範例 3)** | `test108@gmail.com` 或 `0920111111` | `0920111111` | 學員：黃O筠 |
| **其餘 427 位學員** | Excel 名單內之 Email 或手機 | 其手機號碼 | 均可直接登入 |

*前台登入畫面右上角亦提供「快速示範身分切換 (1-Click Switch)」選單，方便展示評測。*

---

## 🌐 上傳至 GitHub 與部署到 Render 指南

### 步驟一：推送到 GitHub 儲存庫
1. 在 GitHub 上建立一個新的公開或私有儲存庫（Repository），例如 `sdgs-action-platform`。
2. 在本專案根目錄執行：
```bash
git init
git add .
git commit -m "feat: release SDGs and Climate Action Platform v1.0"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/sdgs-action-platform.git
git push -u origin main
```

### 步驟二：連動到 Render 雲端平台
1. 登入 [Render.com](https://render.com)（可用 GitHub 帳號快速登入）。
2. 點擊右上角 **New +**，選擇 **Blueprint**（最推薦，將自動讀取專案內的 `render.yaml`）：
   - 連接剛剛推送的 GitHub 儲存庫。
   - Render 會自動偵測 `render.yaml`，並配置好：
     - **Build Command**: `pip install -r requirements.txt && python seed_db.py`
     - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
     - **Region**: Singapore
   - 點擊 **Apply**，等待 2~3 分鐘即可自動建置完成！
3. 若選擇手動建立 **Web Service**：
   - Name: `sdgs-platform`
   - Runtime: `Python 3`
   - Build Command: `pip install -r requirements.txt && python seed_db.py`
   - Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - 點擊 **Create Web Service** 即可部署上線！
4. 部署完成後，Render 會發布一組公開 HTTPS 網址（例如 `https://sdgs-platform.onrender.com`），任何學員均可隨時連線上網填寫練習單與進行連鎖遊戲！

---

## 📁 專案目錄結構

```
sdgs_app/
├── app/
│   ├── __init__.py          # 模組載入器
│   ├── auth.py              # 密碼雜湊與 Session Token 簽署
│   ├── database.py          # SQLite 連線與資料表 Schema
│   ├── main.py              # FastAPI 核心應用程式與 28 個 REST APIs
│   ├── static/              # 前端靜態資源
│   │   ├── css/style.css    # 客製化響應式樣式與卡牌動畫
│   │   └── js/app.js        # 前端交互核心 (SPA/CRUD/Game/Admin/Chart.js)
│   └── templates/
│       └── index.html       # 整合式響應式現代化單頁 UI
├── data/
│   ├── sdgs_master.json     # 17 目標與 169 細項正式語料庫
│   └── students_seed.json   # 427 位學員種子資料庫
├── seed_db.py               # 資料庫一鍵建置與種子初始化程式
├── render.yaml              # Render 雲端宣告式部署設定檔
├── Dockerfile               # 容器化建置設定檔
├── Procfile                 # 雲端行程啟動命令
├── requirements.txt         # Python 依賴清單
├── runtime.txt              # Python 執行環境版本
├── .env.example             # 環境變數設定範本
├── .gitignore               # Git 忽略清單
└── README.md                # 專案說明與操作手冊
```
