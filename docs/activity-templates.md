# 活動規劃與成果範本

來源為使用者提供的 `uploadfile/category.xlsx`，`template!A1:K31`：30 筆活動、4 個規劃示範、5 個成果指引。原始 Excel 保持不變；可部署的來源快照為 `data/activity_templates.json`。

資料庫初始化時，新增 `action_catalog.template_data`，按「主題類別＋活動內容」精確比對後一次匯入。`system_settings.activity_templates_v1` 防止重新啟動覆蓋後台維護內容。原有自訂活動與分類不會刪除。

後台「分類」的修改表單可編輯全部九個範本欄位。分類 XLSX 匯出另含 `template` 工作表；匯入附帶此工作表時會更新對應範本，只有兩欄的舊格式仍可使用。

`worksheets.activity_details` 保存階段、活動名稱、規劃四欄及成果五欄。前四欄必填；成果欄不預填實際值，指引僅作 placeholder。數量可空白或填 0 以上整數。切換階段不清除已填內容；更換活動不覆寫已自行改寫的示範。

既有 `activity_description` 保留，相容舊練習單。新表單另產生含欄位名稱的摘要，供後台檢視及 Word／CSV 匯出；CSV 亦包含完整結構化資料。舊資料轉為新格式時保留原說明，不猜測拆分。

來源 `template!E3` 原值為 `s`，忠實保留，可由後台修改。來源第四個示範欄實際標題為「4. 預計參與對象（示範）」，對應前台第四個必填欄位。

驗證：`python -m unittest discover -s tests`、`node --test tests/*.cjs`；本機瀏覽器驗證分類提示、範本帶入、階段切換、空白指引、0 人數、草稿儲存與重新載入。
