# 全站 UI 統一改版（20261019_ui1280）

以原首頁識別與主視覺為最高依據；維持既有表單、事件、API、資料欄位、權限及運算。

## 修改前差異

| 模組 | 原容器 | 原問題 |
| --- | --- | --- |
| 首頁／練習單／後台 | Main 1440px、Header 1488px | 左右邊界與內距不同 |
| 配對挑戰賽 | Header 1200px、歡迎卡片 1040px | 無帳號區、獨立導覽及裝飾色條 |
| 課程登錄 | max-w-4xl（896px）、calc(100% - 32px) | 課程內容過窄、導覽換列 |
| 試算表 | max-w-7xl、獨立 Header | 缺少系統導覽、分欄比例不同 |

## 共用規範與維護

主站 `app/static/css/design-system.css` 是設計變數及版型的唯一來源。`python scripts/sync_ui.py` 同步到配對賽、課程與 React 試算表；`--check` 驗證三份副本完全相同。這些專案沒有共同建置工具，因此採共用 CSS 與 HTML/Jinja/React 外殼，而不引入額外框架或套件。

PageContainer：`.ds-container`（現有 `.platform-main` 同規格）；1280px 包含內距、水平置中，桌機與平板 24px、手機 16px。Header、Navbar、Footer 使用同一組變數。手機導覽局部水平捲動，不將整頁撐寬。遊戲畫布、對話框與表格內層尺寸保留。

PageHeader：`.page-header`；ContentCard：`.content-card`；SectionTitle：`.section-title`；PrimaryButton／SecondaryButton：`.primary-button`／`.secondary-button`；StatusBadge：`.status-badge`；FormField：`.form-field`；FilterTabs：`.filter-tabs`；DataTable：`.data-table`／`.table-scroll`。既有控制項透過同一組變數及樣式統一，無須替換事件處理。

配對賽與試算表使用主站來源的唯讀帳號 iframe，只在主站來源讀取既有 session 並顯示 `/api/auth/me` 結果，不傳送 token 到其他網域。登入按鈕導回主站既有登入／切換帳號操作。課程系統顯示既有伺服器驗證的 SSO 身分。瀏覽器封鎖跨站儲存時帳號區會顯示訪客，原登入流程仍維持原樣。

試算表 React 原始碼只調整呈現及品牌色；公式、資料、滑桿、計時器、完成狀態及 LINE 複製函式保留。三欄使用 30:45:25，小於 1200px 改兩欄、小於 900px 單欄；表格保留局部捲動與手機卡片。

## 圖像

首頁保留原 `hero.png`；配對頁沿用同一插圖。課程橫幅新資產：`sdgs-attendance-record/static/images/course-community.png`，使用內建 imagegen 產生。提示：寬幅 3:1、薄荷綠、柔和立體插畫、臺灣永續校園與臺北地景，左側留白供 HTML 文字，右側並列橘衣法師、拿書男生及拿書女生；無文字、無 Logo、無介面。

## 驗收

七種視窗：1920×1080、1440×900、1366×768、1280×800、1024×768、768×1024、390×844。以本機隔離測試資料登入學員與管理員，保留每頁修改前後相同尺寸截圖、DOM 邊界與整頁 scrollWidth/clientWidth 量測。正式站另驗證新資產版本與公開頁面；不以正式學員資料提交測試簽到或練習單。
