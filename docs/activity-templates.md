# 活動規劃與成果範本

來源為使用者提供的 `uploadfile/category.xlsx`，`template!A1:K31`：30 筆活動、4 個規劃示範、5 個成果指引。原始 Excel 保持不變；可部署的來源快照為 `data/activity_templates.json`。

資料庫初始化時，新增 `action_catalog.template_data`，按「主題類別＋活動內容」精確比對後一次匯入。`system_settings.activity_templates_v1` 防止重新啟動覆蓋後台維護內容。原有自訂活動與分類不會刪除。

後台「分類」的修改表單可編輯全部九個範本欄位。分類 XLSX 匯出另含 `template` 工作表；匯入附帶此工作表時會更新對應範本，只有兩欄的舊格式仍可使用。

主題類別獨立保存於 `action_topics`，可先建立尚無活動的類別；既有及匯入活動的類別會自動登錄。後台透過 `/api/admin/topics` 維護，改名會在同一筆資料庫操作內更新對應活動，既有學習單的文字快照不變。刪除僅允許沒有對應活動的類別，後端以條件式刪除再次檢核。

新增、修改活動分類時，主題類別使用完整下拉選單；活動內容及九個範本欄位皆必填，前後端均拒絕空白內容。後台「匯出名單」旁的「下載範例」透過受管理權限保護的 `/api/admin/categories/sample.xlsx` 下載 Git 內原樣保存的 `uploadfile/category.xlsx`。

`worksheets.activity_details` 保存階段、活動名稱、規劃四欄及成果五欄。前四欄必填；成果欄不預填實際值，指引僅作 placeholder。數量可空白或填 0 以上整數。切換階段不清除已填內容；更換活動不覆寫已自行改寫的示範。

只保存 `activity_details` 規劃與成果資料；後台檢視及 Word／CSV 的摘要均即時計算。依使用者要求，資料庫移除舊 `activity_description` 欄位，並清除 JSON 內的 `legacy_description`，不保留舊說明。舊練習單的其他分析資料不變，若尚未填寫新規劃欄位，儲存時須先補齊。

來源 `template!E3` 原值為 `s`，忠實保留，可由後台修改。來源第四個示範欄實際標題為「4. 預計參與對象（示範）」，對應前台第四個必填欄位。

驗證：`python -m unittest discover -s tests`、`node --test tests/*.cjs`；本機瀏覽器驗證分類提示、範本帶入、階段切換、空白指引、0 人數、草稿儲存與重新載入。
