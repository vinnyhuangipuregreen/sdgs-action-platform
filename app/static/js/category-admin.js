let adminCategoryItems = [];
let editingCategoryId = null;
let adminTopicItems = [];
let editingTopicId = null;

async function categoryRequest(path = "", options = {}, resource = "categories") {
  const response = await fetch(`${API_BASE}/admin/${resource}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${state.token}`, ...options.headers },
    cache: "no-store"
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : result.detail?.[0]?.msg || "分類資料格式不正確或權限不足");
  return result;
}

async function loadAdminCategories() {
  const status = document.getElementById("categoryAdminStatus");
  status.textContent = "分類項目載入中…";
  try {
    [adminCategoryItems, adminTopicItems] = await Promise.all([categoryRequest(), categoryRequest("", {}, "topics")]);
    renderAdminTopics();
    populateTopicSelect(document.getElementById("categoryNameInput").value);
    renderAdminCategories();
    return true;
  } catch (error) {
    document.getElementById("adminCategoriesTableBody").replaceChildren();
    status.textContent = `${error.message}，請按「重新整理」重試。`;
    return false;
  }
}

function populateTopicSelect(selected = "") {
  const select = document.getElementById("categoryNameInput");
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "請選擇主題類別";
  select.appendChild(placeholder);
  adminTopicItems.forEach(topic => {
    const option = document.createElement("option");
    option.value = topic.name;
    option.textContent = topic.name;
    select.appendChild(option);
  });
  select.value = selected;
}

function openTopicEditor(topic = null) {
  editingTopicId = topic?.id ?? null;
  document.getElementById("topicNameInput").value = topic?.name || "";
  document.getElementById("topicNameInput").setCustomValidity("");
  document.getElementById("topicEditor").classList.remove("hidden");
  document.getElementById("topicNameInput").focus();
}

function closeTopicEditor() {
  editingTopicId = null;
  document.getElementById("topicEditor").reset();
  document.getElementById("topicEditor").classList.add("hidden");
}

function renderAdminTopics() {
  const body = document.getElementById("adminTopicsTableBody");
  body.replaceChildren();
  adminTopicItems.forEach(topic => {
    const row = body.insertRow();
    row.className = "border-b border-slate-100";
    [topic.name, topic.activity_count].forEach(value => {
      const cell = row.insertCell();
      cell.className = "p-3";
      cell.textContent = value;
    });
    const actions = row.insertCell();
    actions.className = "p-3 whitespace-nowrap";
    ["修改", "刪除"].forEach(label => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.className = `px-3 py-2 mr-2 rounded-lg border font-bold ${label === "修改" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`;
      button.setAttribute("aria-label", `${label}主題類別 ${topic.name}`);
      button.addEventListener("click", async () => {
        if (label === "修改") return openTopicEditor(topic);
        const status = document.getElementById("topicAdminStatus");
        status.textContent = "";
        if (topic.activity_count > 0) {
          status.textContent = `該[主題分類]已經有${topic.activity_count}筆對應的[活動內容]，不可刪除！`;
          showToast(status.textContent, "error");
          return;
        }
        if (!(await confirmCategoryDelete({category: "主題類別", name: topic.name}))) return;
        button.disabled = true;
        try {
          await categoryRequest(`/${topic.id}`, {method: "DELETE"}, "topics");
          if (editingTopicId === topic.id) closeTopicEditor();
          await refreshCategoryViews();
          showToast("主題類別已刪除", "success");
        } catch (error) {
          status.textContent = error.message;
          showToast(error.message, "error");
          button.disabled = false;
        }
      });
      actions.appendChild(button);
    });
  });
}

function validateCategoryForm(form) {
  form.querySelectorAll("[required]").forEach(input => {
    input.setCustomValidity(input.value.trim() ? "" : `請填寫：${input.labels[0].textContent}`);
  });
  return form.reportValidity();
}

function renderAdminCategories() {
  const terms = document.getElementById("adminCategorySearch").value.normalize("NFKC").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const items = adminCategoryItems.filter(item => {
    const text = `${item.category} ${item.name}`.normalize("NFKC").toLowerCase();
    return terms.every(term => text.includes(term));
  });
  const categoryCount = new Set(adminCategoryItems.map(item => item.category)).size;
  document.getElementById("categoryAdminStatus").textContent = `共 ${categoryCount} 類、${adminCategoryItems.length} 項活動，符合搜尋 ${items.length} 項`;
  const body = document.getElementById("adminCategoriesTableBody");
  body.replaceChildren();
  if (!items.length) {
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 3;
    cell.className = "p-8 text-center text-slate-500";
    cell.textContent = adminCategoryItems.length ? "找不到符合的分類項目，請調整搜尋條件。" : "尚無分類項目，請新增分類或匯入名單。";
  }
  items.forEach(item => {
    const row = body.insertRow();
    row.className = "border-b border-slate-100 hover:bg-slate-50";
    const category = row.insertCell();
    category.className = "p-3 font-bold text-purple-800 whitespace-nowrap";
    category.textContent = item.category;
    const name = row.insertCell();
    name.className = "p-3 min-w-[180px] break-words";
    name.textContent = item.name;
    const actions = row.insertCell();
    actions.className = "p-3 whitespace-nowrap";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "text-purple-700 font-bold px-2 py-1 hover:bg-purple-50 rounded";
    edit.textContent = "修改";
    edit.setAttribute("aria-label", `修改 ${item.name}`);
    edit.addEventListener("click", () => openCategoryEditor(item));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-red-600 font-bold px-2 py-1 hover:bg-red-50 rounded";
    remove.textContent = "刪除";
    remove.setAttribute("aria-label", `刪除 ${item.name}`);
    remove.addEventListener("click", async () => {
      if (!(await confirmCategoryDelete(item))) return;
      remove.disabled = true;
      try {
        await categoryRequest(`/${item.id}`, { method: "DELETE" });
        if (editingCategoryId === item.id) closeCategoryEditor();
        await refreshCategoryViews();
        showToast("分類項目已刪除", "success");
      } catch (error) {
        showToast(error.message, "error");
        remove.disabled = false;
      }
    });
    actions.append(edit, remove);
  });
}

function openCategoryEditor(item = null) {
  editingCategoryId = item?.id ?? null;
  document.getElementById("categoryEditorTitle").textContent = item ? "修改分類" : "新增分類";
  populateTopicSelect(item?.category || "");
  document.getElementById("categoryNameInput").setCustomValidity("");
  document.getElementById("categoryActionInput").value = item?.name || "";
  document.getElementById("categoryActionInput").setCustomValidity("");
  const fields = document.getElementById("categoryTemplateFields");
  fields.replaceChildren();
  Object.entries({...activityPlanFields, ...activityResultFields}).forEach(([field, label]) => {
    const wrapper = document.createElement("div");
    const title = document.createElement("label");
    title.htmlFor = `categoryTemplate_${field}`;
    title.className = "block text-xs font-bold text-slate-700 mb-2";
    title.textContent = `${label}（${field in activityPlanFields ? '示範' : '填寫指引'}）（必填）`;
    const input = document.createElement("textarea");
    input.id = title.htmlFor;
    input.rows = 3;
    input.required = true;
    input.className = "w-full text-sm border border-slate-300 rounded-xl px-3 py-2.5";
    input.value = item?.template?.[field] || "";
    wrapper.append(title, input);
    fields.appendChild(wrapper);
  });
  document.getElementById("categoryEditor").classList.remove("hidden");
  document.getElementById("categoryNameInput").focus();
}

function closeCategoryEditor() {
  editingCategoryId = null;
  document.getElementById("categoryEditor").reset();
  document.getElementById("categoryEditor").classList.add("hidden");
}

function confirmCategoryDelete(item) {
  const dialog = document.getElementById("categoryDeleteDialog");
  document.getElementById("categoryDeleteName").textContent = `${item.category}／${item.name}`;
  dialog.returnValue = "";
  return new Promise(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "delete"), { once: true });
    dialog.showModal();
  });
}

async function refreshCategoryViews() {
  const adminLoaded = await loadAdminCategories();
  const pickerLoaded = await loadCenterActions();
  if (!adminLoaded || !pickerLoaded) showToast("資料已儲存，但清單重新載入失敗，請重新整理頁面", "warning");
}

function initCategoryAdminEvents() {
  document.getElementById("addTopicBtn").addEventListener("click", () => openTopicEditor());
  document.getElementById("cancelTopicBtn").addEventListener("click", closeTopicEditor);
  ["categoryEditor", "topicEditor"].forEach(id => {
    document.getElementById(id).addEventListener("input", event => event.target.setCustomValidity(""));
  });
  document.getElementById("topicEditor").addEventListener("submit", async event => {
    event.preventDefault();
    if (!validateCategoryForm(event.currentTarget)) return;
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    const oldName = adminTopicItems.find(topic => topic.id === editingTopicId)?.name;
    const name = document.getElementById("topicNameInput").value.trim();
    try {
      await categoryRequest(editingTopicId === null ? "" : `/${editingTopicId}`, {
        method: editingTopicId === null ? "POST" : "PUT",
        headers: {"Content-Type": "application/json"}, body: JSON.stringify({name})
      }, "topics");
      if (oldName && document.getElementById("categoryNameInput").value === oldName) {
        const option = document.getElementById("categoryNameInput").selectedOptions[0];
        option.value = name;
        option.textContent = name;
      }
      closeTopicEditor();
      await refreshCategoryViews();
      showToast("主題類別已儲存", "success");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById("adminCategorySearch").addEventListener("input", renderAdminCategories);
  document.getElementById("addCategoryBtn").addEventListener("click", () => openCategoryEditor());
  document.getElementById("cancelCategoryBtn").addEventListener("click", closeCategoryEditor);
  document.getElementById("refreshCategoriesBtn").addEventListener("click", refreshCategoryViews);
  document.getElementById("categoryEditor").addEventListener("submit", async event => {
    event.preventDefault();
    if (!validateCategoryForm(event.currentTarget)) return;
    const button = document.getElementById("saveCategoryBtn");
    button.disabled = true;
    try {
      await categoryRequest(editingCategoryId === null ? "" : `/${editingCategoryId}`, {
        method: editingCategoryId === null ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: document.getElementById("categoryNameInput").value.trim(),
          name: document.getElementById("categoryActionInput").value.trim(),
          template: Object.fromEntries(Object.keys({...activityPlanFields, ...activityResultFields}).map(field =>
            [field, document.getElementById(`categoryTemplate_${field}`).value.trim()]))
        })
      });
      closeCategoryEditor();
      await refreshCategoryViews();
      showToast("分類項目已儲存", "success");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  const fileInput = document.getElementById("categoryImportFile");
  const importButton = document.getElementById("importCategoriesBtn");
  importButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    importButton.disabled = true;
    document.getElementById("categoryAdminStatus").textContent = "正在驗證與匯入名單…";
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await categoryRequest("/import", { method: "POST", body: form });
      await refreshCategoryViews();
      const message = `匯入完成：新增 ${result.imported_count} 筆，略過重複 ${result.skipped_count} 筆。`;
      document.getElementById("categoryAdminStatus").textContent += ` ${message}`;
      showToast(message, "success");
    } catch (error) {
      document.getElementById("categoryAdminStatus").textContent = `匯入失敗：${error.message}，未寫入本次資料。`;
      showToast(error.message, "error");
    } finally {
      fileInput.value = "";
      importButton.disabled = false;
    }
  });
  async function downloadCategories(event, path, filename) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const response = await fetch(`${API_BASE}/admin/categories/${path}`, {
        headers: { Authorization: `Bearer ${state.token}` }, cache: "no-store"
      });
      if (!response.ok) throw new Error("下載失敗，請確認管理權限後重試");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("檔案已下載", "success");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }
  document.getElementById("exportCategoriesBtn").addEventListener("click", event => downloadCategories(event, "export.xlsx", "分類名單.xlsx"));
  document.getElementById("downloadCategorySampleBtn").addEventListener("click", event => downloadCategories(event, "sample.xlsx", "category.xlsx"));
}
