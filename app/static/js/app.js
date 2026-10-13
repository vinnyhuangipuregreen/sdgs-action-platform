// SDGs and Climate Action Platform - Comprehensive Frontend Core v2.0
const API_BASE = "/api";

const state = {
  user: null,
  token: localStorage.getItem("sdgs_token") || null,
  goals: [],
  targets: [],
  currentWorksheetId: null,
  worksheetsList: [],
  activeTab: "worksheet",
  
  // Game 1: Memory Match State
  memoryGame: {
    active: false,
    cards: [],
    flipped: [],
    matchedPairs: 0,
    totalPairs: 6,
    score: 0,
    combo: 0,
    maxCombo: 0,
    timer: null,
    timeLeft: 60
  },

  // Game 2: Combo Blast State
  comboGame: {
    active: false,
    grid: [],
    rows: 5,
    cols: 5,
    movesLeft: 15,
    score: 0,
    combo: 0,
    maxCombo: 0,
    risksSolved: 0,
    colors: ["#0284c7", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6"]
  },

  // Selected students for batch actions
  selectedStudentIds: new Set()
};

// ==============================================================================
// 1. Core Initialization
// ==============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  initUIEvents();
  await checkAuth();
  await loadSDGsData();
});

function initUIEvents() {
  // Navigation tabs
  document.querySelectorAll("[data-nav-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-nav-tab");
      if (tab === "admin") {
        handleAdminAccess();
        return;
      }
      switchTab(tab);
    });
  });

  // Login form submit
  const loginForm = document.getElementById("loginForm");
  if (loginForm) loginForm.addEventListener("submit", handleLogin);

  const adminLoginForm = document.getElementById("adminLoginForm");
  if (adminLoginForm) adminLoginForm.addEventListener("submit", handleAdminLogin);

  // Logout button
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

  // Worksheet events
  initWorksheetEvents();

  // Search input in SDGs lookup
  const sdgSearchInput = document.getElementById("sdgSearchInput");
  if (sdgSearchInput) sdgSearchInput.addEventListener("input", filterSDGsDisplay);
}

function handleAdminAccess() {
  if (state.user && ['admin', 'teacher'].includes(state.user.role)) {
    switchTab("admin");
  } else {
    // Show admin login modal with default credentials prefilled/hinted
    const modal = document.getElementById("adminLoginModal");
    if (modal) {
      modal.classList.remove("hidden");
      document.getElementById("adminAccount").value = "admin";
      document.getElementById("adminPassword").value = "sdgs2030admin";
    }
  }
}

function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll(".tab-pane").forEach(el => el.classList.add("hidden"));
  document.querySelectorAll("[data-nav-tab]").forEach(el => {
    el.classList.remove("text-emerald-700", "bg-emerald-50", "border-b-2", "border-emerald-600");
    el.classList.add("text-slate-600");
  });

  const targetPane = document.getElementById(`tabPane_${tabId}`);
  const targetTabBtn = document.querySelector(`[data-nav-tab="${tabId}"]`);

  if (targetPane) targetPane.classList.remove("hidden");
  if (targetTabBtn) {
    targetTabBtn.classList.add("text-emerald-700", "bg-emerald-50", "border-b-2", "border-emerald-600");
    targetTabBtn.classList.remove("text-slate-600");
  }

  if (tabId === "leaderboard") loadLeaderboard();
  if (tabId === "admin") loadAdminDashboard();
  if (tabId === "memory_game" && !state.memoryGame.active) initNewMemoryGame();
  if (tabId === "combo_game" && !state.comboGame.active) initNewComboBlastGame();
}

// ==============================================================================
// 2. Auth Module
// ==============================================================================
async function checkAuth() {
  if (!state.token) {
    showLoginModal(true);
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    if (res.ok) {
      state.user = await res.json();
      updateUserUI();
      showLoginModal(false);
      loadMyWorksheets();
    } else {
      handleLogout();
    }
  } catch (err) {
    handleLogout();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const account = document.getElementById("loginAccount").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  const errorEl = document.getElementById("loginError");
  errorEl.classList.add("hidden");

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, password })
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.detail || "登入失敗，請確認帳號密碼";
      errorEl.classList.remove("hidden");
      return;
    }
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("sdgs_token", data.token);
    showLoginModal(false);
    updateUserUI();
    showToast(`歡迎回來，${data.user.name}！`, "success");
    loadMyWorksheets();
  } catch (err) {
    errorEl.textContent = "連線異常，請稍後再試";
    errorEl.classList.remove("hidden");
  }
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const account = document.getElementById("adminAccount").value.trim();
  const password = document.getElementById("adminPassword").value.trim();
  const errEl = document.getElementById("adminLoginError");
  errEl.classList.add("hidden");

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, password })
    });
    const data = await res.json();
    if (!res.ok || !['admin', 'teacher'].includes(data.user.role)) {
      errEl.textContent = data.detail || "管理員驗證失敗，需要管理權限";
      errEl.classList.remove("hidden");
      return;
    }
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("sdgs_token", data.token);
    document.getElementById("adminLoginModal").classList.add("hidden");
    updateUserUI();
    showToast(`管理員登入成功，歡迎 ${data.user.name}！`, "success");
    switchTab("admin");
  } catch (err) {
    errEl.textContent = "連線異常，請重試";
    errEl.classList.remove("hidden");
  }
}

function handleLogout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("sdgs_token");
  showLoginModal(true);
  updateUserUI();
  switchTab("worksheet");
}

function showLoginModal(show) {
  const modal = document.getElementById("loginModal");
  if (modal) {
    if (show) modal.classList.remove("hidden");
    else modal.classList.add("hidden");
  }
}

function updateUserUI() {
  const userNameEl = document.getElementById("currentUserName");
  const userRoleEl = document.getElementById("currentUserRole");

  if (state.user) {
    if (userNameEl) userNameEl.textContent = state.user.name;
    if (userRoleEl) {
      userRoleEl.textContent = state.user.role === 'admin' ? '系統管理員' : (state.user.role === 'teacher' ? '授課講師/助教' : '學員');
      userRoleEl.className = state.user.role === 'admin' 
        ? "text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-semibold"
        : "text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold";
    }
    const formName = document.getElementById("ws_userName");
    const formUnit = document.getElementById("ws_unitName");
    if (formName) formName.value = state.user.name;
    if (formUnit && !formUnit.value) formUnit.value = state.user.unit_name || "佛光學員";
  }
}

// ==============================================================================
// 3. SDGs Reference & Smart Quote Module (Requirement 1 Implementation)
// ==============================================================================
async function loadSDGsData() {
  try {
    const [resGoals, resTargets] = await Promise.all([
      fetch(`${API_BASE}/sdgs/goals`),
      fetch(`${API_BASE}/sdgs/targets`)
    ]);
    if (resGoals.ok && resTargets.ok) {
      state.goals = await resGoals.json();
      state.targets = await resTargets.json();
      renderSDGsDirectory();
      populateSDGSelectors();
    }
  } catch (err) {
    console.error("Failed to load SDGs data", err);
  }
}

function renderSDGsDirectory(filterTier = "all", filter5P = "all", keyword = "") {
  const container = document.getElementById("sdgsGridContainer");
  if (!container) return;
  container.innerHTML = "";

  const kw = keyword.toLowerCase().trim();

  state.goals.forEach(goal => {
    if (filterTier !== "all" && goal.tier !== filterTier) return;
    if (filter5P !== "all" && !goal.category_5p.includes(filter5P)) return;

    const goalTargets = state.targets.filter(t => t.goal_id === goal.id);
    const goalMatch = goal.name.toLowerCase().includes(kw) || goal.slogan.toLowerCase().includes(kw) || goal.full_name.toLowerCase().includes(kw);
    const matchingTargets = kw ? goalTargets.filter(t => t.content.toLowerCase().includes(kw) || t.code.toLowerCase().includes(kw)) : goalTargets;

    if (kw && !goalMatch && matchingTargets.length === 0) return;

    const card = document.createElement("div");
    card.className = "bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow";
    card.innerHTML = `
      <div class="p-4 text-white flex justify-between items-center" style="background-color: ${goal.color}">
        <div>
          <span class="text-xs font-bold uppercase tracking-wider bg-black/20 px-2 py-0.5 rounded-full">${goal.code}</span>
          <h3 class="text-lg font-black mt-1">${goal.name}</h3>
        </div>
        <div class="text-right">
          <span class="text-xs font-medium bg-white/20 px-2 py-1 rounded-md block">${goal.tier}</span>
          <span class="text-[11px] opacity-90">${goal.category_5p}</span>
        </div>
      </div>
      <div class="p-4">
        <p class="text-sm font-semibold text-slate-700 italic border-l-4 pl-2 mb-2" style="border-color: ${goal.color}">
          「${goal.slogan}」
        </p>
        <p class="text-xs text-slate-500 mb-3 line-clamp-2">${goal.full_name}</p>
        
        <div class="flex justify-between items-center text-xs text-slate-400 mb-2">
          <span>共 ${goalTargets.length} 項具體承諾細項</span>
          <button type="button" class="text-emerald-600 hover:text-emerald-800 font-semibold" onclick="toggleGoalTargets(${goal.id})">
            展開細項 <span id="arrow_${goal.id}">▼</span>
          </button>
        </div>

        <div id="targetsBox_${goal.id}" class="hidden space-y-2 mt-3 pt-3 border-t border-slate-100 max-h-60 overflow-y-auto pr-1">
          ${matchingTargets.map(t => {
            const escapedContent = t.content.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const quoteText = `${t.code}：${escapedContent}`;
            return `
            <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-200/60 text-xs">
              <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-slate-800">${t.code}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded ${t.target_type === '成果目標' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}">${t.target_type}</span>
              </div>
              <p class="text-slate-600 text-[11px] leading-relaxed mb-2">${t.content}</p>
              <button type="button" class="w-full py-1 text-center bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 rounded font-medium text-[11px] transition-colors"
                onclick="quoteTargetToWorksheet('${goal.code} ${goal.name}', '${quoteText}')">
                📌 引用至連動分析練習單
              </button>
            </div>
          `;}).join("")}
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

window.toggleGoalTargets = function(goalId) {
  const box = document.getElementById(`targetsBox_${goalId}`);
  const arrow = document.getElementById(`arrow_${goalId}`);
  if (box) {
    box.classList.toggle("hidden");
    arrow.textContent = box.classList.contains("hidden") ? "▼" : "▲";
  }
};

/**
 * Requirement 1: Smart Quote Target Algorithm
 */
window.quoteTargetToWorksheet = function(goalText, targetText) {
  const radialRows = document.querySelectorAll(".radial-line-row");
  const normGoal = goalText.split(" ")[0].trim(); // e.g. "SDG 14"
  const normMech = targetText.trim();

  // 1. Check for duplicates (both Goal and Mechanism matching)
  for (let idx = 0; idx < radialRows.length; idx++) {
    const r = radialRows[idx];
    const rGoal = r.querySelector(".radial-goal-select")?.value || "";
    const rMech = r.querySelector(".radial-mech-input")?.value.trim() || "";
    const lineNumber = idx + 1;

    if (rGoal.includes(normGoal) && (rMech === normMech || rMech.includes(normMech.substring(0, 30)))) {
      switchTab("worksheet");
      r.scrollIntoView({ behavior: 'smooth', block: 'center' });
      r.classList.add("ring-2", "ring-amber-500");
      setTimeout(() => r.classList.remove("ring-2", "ring-amber-500"), 3000);
      alert(`您已經設定相同的資料在[連動線#${lineNumber}]中`);
      return;
    }
  }

  // 2. Check for empty/unselected slot
  let targetRow = null;
  let targetIndex = -1;
  for (let idx = 0; idx < radialRows.length; idx++) {
    const r = radialRows[idx];
    const rGoal = r.querySelector(".radial-goal-select")?.value || "";
    if (!rGoal) {
      targetRow = r;
      targetIndex = idx + 1;
      break;
    }
  }

  // 3. If no empty slot and no duplicates, automatically add new line
  if (!targetRow) {
    addRadialLineRow();
    const updatedRows = document.querySelectorAll(".radial-line-row");
    targetRow = updatedRows[updatedRows.length - 1];
    targetIndex = updatedRows.length;
  }

  // Populate goal and mechanism
  const goalSelect = targetRow.querySelector(".radial-goal-select");
  const mechInput = targetRow.querySelector(".radial-mech-input");

  for (let opt of goalSelect.options) {
    if (opt.value.includes(normGoal) || opt.textContent.includes(normGoal)) {
      goalSelect.value = opt.value;
      break;
    }
  }
  if (mechInput) mechInput.value = normMech;

  updateChatTextSnippet();
  switchTab("worksheet");
  targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  targetRow.classList.add("ring-2", "ring-emerald-500");
  setTimeout(() => targetRow.classList.remove("ring-2", "ring-emerald-500"), 2500);
  showToast(`已成功將「${normGoal}」設定至[連動線#${targetIndex}]！`, "success");
};

function filterSDGsDisplay() {
  const tierFilter = document.querySelector(".tier-filter-btn.active")?.getAttribute("data-tier") || "all";
  const kw = document.getElementById("sdgSearchInput")?.value || "";
  renderSDGsDirectory(tierFilter, "all", kw);
}

window.setTierFilter = function(tier, btn) {
  document.querySelectorAll(".tier-filter-btn").forEach(b => b.classList.remove("active", "bg-emerald-600", "text-white"));
  btn.classList.add("active", "bg-emerald-600", "text-white");
  filterSDGsDisplay();
};

// ==============================================================================
// 4. Worksheet Module (CRUD & Linkage Analysis)
// ==============================================================================
function initWorksheetEvents() {
  document.querySelectorAll("input[name='center_action']").forEach(radio => {
    radio.addEventListener("change", (e) => {
      const customBox = document.getElementById("centerCustomBox");
      if (e.target.value === "D") customBox.classList.remove("hidden");
      else customBox.classList.add("hidden");
      updateChatTextSnippet();
    });
  });

  const customInput = document.getElementById("ws_centerCustom");
  if (customInput) customInput.addEventListener("input", updateChatTextSnippet);

  const addLineBtn = document.getElementById("addRadialLineBtn");
  if (addLineBtn) addLineBtn.addEventListener("click", () => addRadialLineRow());

  const addTradeoffBtn = document.getElementById("addTradeoffBtn");
  if (addTradeoffBtn) addTradeoffBtn.addEventListener("click", () => addTradeoffRow());

  const saveDraftBtn = document.getElementById("saveDraftBtn");
  if (saveDraftBtn) saveDraftBtn.addEventListener("click", () => saveWorksheet("draft"));

  const submitWorksheetBtn = document.getElementById("submitWorksheetBtn");
  if (submitWorksheetBtn) submitWorksheetBtn.addEventListener("click", () => saveWorksheet("submitted"));

  const viewMyWorksheetsBtn = document.getElementById("viewMyWorksheetsBtn");
  if (viewMyWorksheetsBtn) viewMyWorksheetsBtn.addEventListener("click", openMyWorksheetsModal);

  const copyChatBtn = document.getElementById("copyChatSnippetBtn");
  if (copyChatBtn) {
    copyChatBtn.addEventListener("click", () => {
      const txt = document.getElementById("ws_chatSnippet")?.value;
      if (txt) {
        navigator.clipboard.writeText(txt).then(() => {
          showToast("已成功複製聊天室格式字串！", "success");
        });
      }
    });
  }

  renderDefaultWorksheetRows();
}

function populateSDGSelectors() {
  document.querySelectorAll(".radial-goal-select").forEach(sel => {
    const curVal = sel.value;
    sel.innerHTML = '<option value="">-- 請選擇連動的 SDGs 目標 --</option>';
    state.goals.forEach(g => {
      const opt = document.createElement("option");
      opt.value = `${g.code} ${g.name}`;
      opt.textContent = `${g.code} ${g.name} (${g.tier})`;
      sel.appendChild(opt);
    });
    if (curVal) sel.value = curVal;
  });
}

function renderDefaultWorksheetRows() {
  const container = document.getElementById("radialLinesContainer");
  if (!container || container.children.length > 0) return;
  container.innerHTML = "";
  for (let i = 0; i < 3; i++) addRadialLineRow();
  const toContainer = document.getElementById("tradeoffContainer");
  if (toContainer && toContainer.children.length === 0) addTradeoffRow();
}

function addRadialLineRow(data = null) {
  const container = document.getElementById("radialLinesContainer");
  if (!container) return;
  const count = container.children.length + 1;
  const row = document.createElement("div");
  row.className = "radial-line-row bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 relative";
  row.innerHTML = `
    <div class="flex justify-between items-center">
      <span class="text-xs font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">連動線 #${count}</span>
      ${count > 3 ? `<button type="button" class="text-red-500 hover:text-red-700 text-xs font-semibold" onclick="this.closest('.radial-line-row').remove(); updateChatTextSnippet();">✕ 刪除此線</button>` : ''}
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">連動目標 (SDG)</label>
        <select class="radial-goal-select w-full text-xs rounded-lg border-slate-300 focus:ring-emerald-500 focus:border-emerald-500 p-2 bg-white">
          <option value="">-- 請選擇連動的 SDGs 目標 --</option>
          ${state.goals.map(g => `<option value="${g.code} ${g.name}">${g.code} ${g.name} (${g.tier})</option>`).join("")}
        </select>
      </div>
      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">怎麼影響？(作用機制機制說明)</label>
        <textarea class="radial-mech-input w-full text-xs rounded-lg border-slate-300 focus:ring-emerald-500 focus:border-emerald-500 p-2" rows="2" placeholder="例：種植台灣原生種，恢復潮間帶生態棲地..."></textarea>
      </div>
      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">我怎麼看得出來？(可觀察的變化)</label>
        <textarea class="radial-obs-input w-full text-xs rounded-lg border-slate-300 focus:ring-emerald-500 focus:border-emerald-500 p-2" rows="2" placeholder="例：水鳥數量明顯回流覓食、塑膠碎屑減少..."></textarea>
      </div>
    </div>
  `;

  container.appendChild(row);

  const sel = row.querySelector(".radial-goal-select");
  const mech = row.querySelector(".radial-mech-input");
  sel.addEventListener("change", updateChatTextSnippet);
  mech.addEventListener("input", updateChatTextSnippet);

  if (data) {
    sel.value = data.goal || "";
    mech.value = data.mechanism || "";
    row.querySelector(".radial-obs-input").value = data.observable || "";
  }
}

function addTradeoffRow(data = null) {
  const container = document.getElementById("tradeoffContainer");
  if (!container) return;
  const count = container.children.length + 1;
  const row = document.createElement("div");
  row.className = "tradeoff-row bg-amber-50/60 p-4 rounded-xl border border-amber-200/80 space-y-3 relative";
  row.innerHTML = `
    <div class="flex justify-between items-center">
      <span class="text-xs font-bold px-2 py-0.5 rounded bg-amber-200 text-amber-900">拉扯檢查 #${count}</span>
      ${count > 1 ? `<button type="button" class="text-red-500 hover:text-red-700 text-xs font-semibold" onclick="this.closest('.tradeoff-row').remove(); updateChatTextSnippet();">✕ 刪除</button>` : ''}
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">可能傷到誰／什麼？</label>
        <input type="text" class="tradeoff-who w-full text-xs rounded-lg border-slate-300 p-2" placeholder="例：周邊沙丘植被、被清出的垃圾..."/>
      </div>
      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">在什麼情況下會發生？</label>
        <input type="text" class="tradeoff-sit w-full text-xs rounded-lg border-slate-300 p-2" placeholder="例：志工未注意隨意踩踏、清運不及..."/>
      </div>
      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">我會怎麼降低影響？</label>
        <input type="text" class="tradeoff-how w-full text-xs rounded-lg border-slate-300 p-2" placeholder="例：規劃指定步道動線，協調垃圾車即時載運..."/>
      </div>
    </div>
  `;
  container.appendChild(row);

  const who = row.querySelector(".tradeoff-who");
  who.addEventListener("input", updateChatTextSnippet);

  if (data) {
    who.value = data.who || "";
    row.querySelector(".tradeoff-sit").value = data.situation || "";
    row.querySelector(".tradeoff-how").value = data.how || "";
  }
}

function updateChatTextSnippet() {
  const selectedActionRadio = document.querySelector("input[name='center_action']:checked");
  const actionCode = selectedActionRadio ? selectedActionRadio.value : "A";
  
  let actionName = "淨灘";
  if (actionCode === "A") actionName = "淨灘";
  if (actionCode === "B") actionName = "二手衣物交換";
  if (actionCode === "C") actionName = "改用太陽能";
  if (actionCode === "D") {
    actionName = document.getElementById("ws_centerCustom")?.value.trim() || "自選佛光活動";
  }

  const goals = [];
  document.querySelectorAll(".radial-goal-select").forEach(sel => {
    if (sel.value) {
      const match = sel.value.match(/SDG\s*(\d+)/i);
      if (match) goals.push(match[1]);
    }
  });
  const goalsStr = goals.length > 0 ? goals.join("、") : "14、12、3";
  const firstRisk = document.querySelector(".tradeoff-who")?.value.trim() || "清出的垃圾未妥善處置造成二次污染";

  const chatSnippet = `${actionCode}｜${actionName}｜${goalsStr}｜風險：${firstRisk}`;
  const outEl = document.getElementById("ws_chatSnippet");
  if (outEl) outEl.value = chatSnippet;
}

async function saveWorksheet(status = "submitted") {
  if (!state.user) {
    showToast("請先登入後再進行提交！", "warning");
    showLoginModal(true);
    return;
  }

  const unitName = document.getElementById("ws_unitName")?.value.trim() || "佛光學員";
  const actionRadio = document.querySelector("input[name='center_action']:checked");
  if (!actionRadio) {
    showToast("請選擇一個中心行動！", "error");
    return;
  }
  const centerAction = actionRadio.value;
  const centerCustom = centerAction === "D" ? document.getElementById("ws_centerCustom")?.value.trim() : "";

  const radialData = [];
  document.querySelectorAll(".radial-line-row").forEach(row => {
    const goal = row.querySelector(".radial-goal-select")?.value;
    const mechanism = row.querySelector(".radial-mech-input")?.value.trim();
    const observable = row.querySelector(".radial-obs-input")?.value.trim();
    if (goal || mechanism || observable) {
      radialData.push({ goal, mechanism, observable });
    }
  });

  if (status === "submitted" && radialData.length < 3) {
    showToast("放射型分析至少需要填寫 3 條連動線！", "error");
    return;
  }

  const tradeoffData = [];
  document.querySelectorAll(".tradeoff-row").forEach(row => {
    const who = row.querySelector(".tradeoff-who")?.value.trim();
    const situation = row.querySelector(".tradeoff-sit")?.value.trim();
    const how = row.querySelector(".tradeoff-how")?.value.trim();
    if (who || situation || how) {
      tradeoffData.push({ who, situation, how });
    }
  });

  const causalData = {
    start: document.getElementById("ws_causalA")?.value.trim() || "",
    start_cond: document.getElementById("ws_causalACond")?.value.trim() || "",
    mid: document.getElementById("ws_causalB")?.value.trim() || "",
    mid_cond: document.getElementById("ws_causalBCond")?.value.trim() || "",
    result: document.getElementById("ws_causalC")?.value.trim() || "",
    result_cond: document.getElementById("ws_causalCCond")?.value.trim() || ""
  };

  const selfChecks = [
    document.getElementById("ws_check1")?.checked || false,
    document.getElementById("ws_check2")?.checked || false,
    document.getElementById("ws_check3")?.checked || false,
    document.getElementById("ws_check4")?.checked || false
  ];

  const commitment = {
    start_action: document.getElementById("ws_commitStart")?.value.trim() || "",
    target_1: document.getElementById("ws_commitT1")?.value.trim() || "",
    target_2: document.getElementById("ws_commitT2")?.value.trim() || "",
    risk_aware: document.getElementById("ws_commitRisk")?.value.trim() || "",
    metric: document.getElementById("ws_commitMetric")?.value.trim() || ""
  };

  const chatText = document.getElementById("ws_chatSnippet")?.value.trim() || "";

  const payload = {
    unit_name: unitName,
    center_action: centerAction,
    center_custom: centerCustom,
    radial_data: radialData,
    tradeoff_data: tradeoffData,
    chat_text: chatText,
    causal_data: causalData,
    self_checks: selfChecks,
    commitment: commitment,
    status: status
  };

  try {
    let url = `${API_BASE}/worksheets`;
    let method = "POST";
    if (state.currentWorksheetId) {
      url = `${API_BASE}/worksheets/${state.currentWorksheetId}`;
      method = "PUT";
    }

    const res = await fetch(url, {
      method: method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.detail || "儲存失敗，請重試", "error");
      return;
    }

    if (method === "POST" && data.id) state.currentWorksheetId = data.id;

    showToast(status === "submitted" ? "🎉 練習單已正式提交成功！" : "💾 草稿已成功儲存！", "success");
    loadMyWorksheets();
  } catch (err) {
    showToast("網路異常，無法儲存練習單", "error");
  }
}

async function loadMyWorksheets() {
  if (!state.token) return;
  try {
    const res = await fetch(`${API_BASE}/worksheets`, {
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    if (res.ok) {
      state.worksheetsList = await res.json();
      renderMyWorksheetsBadge();
    }
  } catch (err) {
    console.error("Failed to load worksheets", err);
  }
}

function renderMyWorksheetsBadge() {
  const badge = document.getElementById("myWorksheetsCountBadge");
  if (badge) badge.textContent = state.worksheetsList.length;
}

function openMyWorksheetsModal() {
  const modal = document.getElementById("myWorksheetsModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  
  const listContainer = document.getElementById("myWorksheetsList");
  if (!listContainer) return;
  listContainer.innerHTML = "";

  if (state.worksheetsList.length === 0) {
    listContainer.innerHTML = `<div class="p-8 text-center text-slate-400">目前尚無練習單紀錄，請立即填寫第一份！</div>`;
    return;
  }

  state.worksheetsList.forEach(ws => {
    const card = document.createElement("div");
    card.className = "bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-3";
    const statusLabel = ws.status === 'reviewed' ? '已批閱' : (ws.status === 'submitted' ? '已送出' : '草稿');
    const statusColor = ws.status === 'reviewed' ? 'bg-purple-100 text-purple-800' : (ws.status === 'submitted' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700');

    card.innerHTML = `
      <div>
        <div class="flex items-center gap-2 mb-1">
          <span class="text-xs px-2 py-0.5 rounded font-bold ${statusColor}">${statusLabel}</span>
          <h4 class="font-bold text-slate-800 text-sm">行動：${ws.center_action} (${ws.center_custom || '標準活動'})</h4>
          <span class="text-xs text-slate-400">${new Date(ws.updated_at).toLocaleString('zh-TW')}</span>
        </div>
        <p class="text-xs text-slate-600 font-mono bg-slate-50 p-1.5 rounded">${ws.chat_text}</p>
        ${ws.score ? `<div class="mt-2 text-xs font-bold text-purple-700">評分：${ws.score} 分 ｜ 講師講評：${ws.teacher_comment || '無'}</div>` : ''}
      </div>
      <div class="flex items-center gap-2">
        <a href="${API_BASE}/worksheets/${ws.id}/export-docx" target="_blank" class="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-semibold">
          📄 下載Word
        </a>
        <button class="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-semibold" onclick="loadWorksheetToForm(${ws.id})">
          編輯載入
        </button>
        <button class="px-3 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg text-xs font-semibold" onclick="deleteWorksheetConfirm(${ws.id})">
          刪除
        </button>
      </div>
    `;
    listContainer.appendChild(card);
  });
}

window.loadWorksheetToForm = function(wsId) {
  const ws = state.worksheetsList.find(w => w.id === wsId);
  if (!ws) return;
  state.currentWorksheetId = ws.id;

  const unitEl = document.getElementById("ws_unitName");
  if (unitEl) unitEl.value = ws.unit_name || "";

  const radio = document.querySelector(`input[name='center_action'][value='${ws.center_action}']`);
  if (radio) {
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
  }
  if (ws.center_action === "D") {
    const custEl = document.getElementById("ws_centerCustom");
    if (custEl) custEl.value = ws.center_custom || "";
  }

  const radialContainer = document.getElementById("radialLinesContainer");
  if (radialContainer) {
    radialContainer.innerHTML = "";
    if (Array.isArray(ws.radial_data)) {
      ws.radial_data.forEach(line => addRadialLineRow(line));
    }
  }

  const tradeoffContainer = document.getElementById("tradeoffContainer");
  if (tradeoffContainer) {
    tradeoffContainer.innerHTML = "";
    if (Array.isArray(ws.tradeoff_data)) {
      ws.tradeoff_data.forEach(to => addTradeoffRow(to));
    }
  }

  if (ws.causal_data) {
    document.getElementById("ws_causalA").value = ws.causal_data.start || "";
    document.getElementById("ws_causalACond").value = ws.causal_data.start_cond || "";
    document.getElementById("ws_causalB").value = ws.causal_data.mid || "";
    document.getElementById("ws_causalBCond").value = ws.causal_data.mid_cond || "";
    document.getElementById("ws_causalC").value = ws.causal_data.result || "";
    document.getElementById("ws_causalCCond").value = ws.causal_data.result_cond || "";
  }

  if (Array.isArray(ws.self_checks)) {
    document.getElementById("ws_check1").checked = !!ws.self_checks[0];
    document.getElementById("ws_check2").checked = !!ws.self_checks[1];
    document.getElementById("ws_check3").checked = !!ws.self_checks[2];
    document.getElementById("ws_check4").checked = !!ws.self_checks[3];
  }

  if (ws.commitment) {
    document.getElementById("ws_commitStart").value = ws.commitment.start_action || "";
    document.getElementById("ws_commitT1").value = ws.commitment.target_1 || "";
    document.getElementById("ws_commitT2").value = ws.commitment.target_2 || "";
    document.getElementById("ws_commitRisk").value = ws.commitment.risk_aware || "";
    document.getElementById("ws_commitMetric").value = ws.commitment.metric || "";
  }

  updateChatTextSnippet();
  document.getElementById("myWorksheetsModal").classList.add("hidden");
  showToast(`已載入練習單 #${ws.id}，您可以進行修改後重新提交！`, "success");
};

window.deleteWorksheetConfirm = async function(wsId) {
  if (!confirm("確定要刪除此練習單嗎？此操作無法復原。")) return;
  try {
    const res = await fetch(`${API_BASE}/worksheets/${wsId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    if (res.ok) {
      showToast("練習單已成功刪除！", "success");
      if (state.currentWorksheetId === wsId) state.currentWorksheetId = null;
      await loadMyWorksheets();
      openMyWorksheetsModal();
    }
  } catch (err) {
    showToast("刪除失敗", "error");
  }
};

window.createNewWorksheet = function() {
  state.currentWorksheetId = null;
  document.getElementById("ws_unitName").value = state.user?.unit_name || "佛光學員";
  const radA = document.querySelector("input[name='center_action'][value='A']");
  if (radA) { radA.checked = true; radA.dispatchEvent(new Event("change")); }
  document.getElementById("ws_centerCustom").value = "";
  
  const rc = document.getElementById("radialLinesContainer");
  if (rc) { rc.innerHTML = ""; for(let i=0; i<3; i++) addRadialLineRow(); }
  const tc = document.getElementById("tradeoffContainer");
  if (tc) { tc.innerHTML = ""; addTradeoffRow(); }

  ["ws_causalA", "ws_causalACond", "ws_causalB", "ws_causalBCond", "ws_causalC", "ws_causalCCond", "ws_commitStart", "ws_commitT1", "ws_commitT2", "ws_commitRisk", "ws_commitMetric"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  ["ws_check1", "ws_check2", "ws_check3", "ws_check4"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  updateChatTextSnippet();
  showToast("已重置為新練習單！", "info");
};

// ==============================================================================
// 5. Game 1: 【SDG 永續翻牌大考驗 (Eco-Memory Match)】(Left Game)
// ==============================================================================
async function initNewMemoryGame() {
  const mg = state.memoryGame;
  mg.active = true;
  mg.matchedPairs = 0;
  mg.score = 0;
  mg.combo = 0;
  mg.maxCombo = 0;
  mg.flipped = [];
  mg.timeLeft = 60;
  clearInterval(mg.timer);

  document.getElementById("memoryIntroCard").classList.add("hidden");
  document.getElementById("memoryMainScreen").classList.remove("hidden");
  document.getElementById("memoryGameOverScreen").classList.add("hidden");

  // Fetch 6 pairs (12 cards)
  try {
    const res = await fetch(`${API_BASE}/game/memory-cards`);
    if (res.ok) {
      const data = await res.json();
      mg.cards = data.cards;
      renderMemoryBoard();
      startMemoryTimer();
    }
  } catch (err) {
    showToast("無法載入翻牌卡片，請重試", "error");
  }
}

function renderMemoryBoard() {
  const container = document.getElementById("memoryGridContainer");
  if (!container) return;
  container.innerHTML = "";

  updateMemoryStatsUI();

  state.memoryGame.cards.forEach((card, idx) => {
    const el = document.createElement("div");
    el.className = "memory-card w-full h-28 sm:h-32 bg-slate-800 rounded-2xl cursor-pointer p-3 flex flex-col justify-center items-center text-center border-2 border-slate-700 shadow-md hover:border-emerald-400 select-none transition-all transform hover:scale-105";
    el.setAttribute("data-index", idx);
    el.innerHTML = `
      <div class="card-back text-2xl font-black text-slate-500">🌏<span class="block text-[11px] text-slate-400 mt-1">SDG配對</span></div>
      <div class="card-front hidden flex flex-col justify-center items-center w-full h-full">
        <span class="text-xl mb-1">${card.icon}</span>
        <div class="text-xs font-bold text-white line-clamp-2 px-1">${card.title}</div>
        <span class="text-[10px] mt-1 px-1.5 py-0.2 rounded bg-black/40 text-emerald-300">${card.desc}</span>
      </div>
    `;

    el.addEventListener("click", () => handleMemoryCardClick(idx, el));
    container.appendChild(el);
  });
}

function handleMemoryCardClick(idx, cardEl) {
  const mg = state.memoryGame;
  if (!mg.active || mg.flipped.length >= 2) return;
  if (cardEl.classList.contains("matched") || cardEl.classList.contains("is-flipped")) return;

  // Flip card
  cardEl.classList.add("is-flipped", "border-emerald-400", "bg-slate-900");
  cardEl.querySelector(".card-back").classList.add("hidden");
  cardEl.querySelector(".card-front").classList.remove("hidden");
  cardEl.style.backgroundColor = mg.cards[idx].color + "22";

  mg.flipped.push({ idx, el: cardEl, card: mg.cards[idx] });

  if (mg.flipped.length === 2) {
    const [c1, c2] = mg.flipped;
    if (c1.card.pair_id === c2.card.pair_id) {
      // Match success!
      mg.combo += 1;
      if (mg.combo > mg.maxCombo) mg.maxCombo = mg.combo;
      mg.matchedPairs += 1;
      mg.score += 500 + (mg.combo * 200);

      c1.el.classList.add("matched", "ring-2", "ring-emerald-400");
      c2.el.classList.add("matched", "ring-2", "ring-emerald-400");
      showToast(`🎯 配對成功！連擊 +${mg.combo}`, "success");
      mg.flipped = [];
      updateMemoryStatsUI();

      if (mg.matchedPairs === mg.totalPairs) {
        endMemoryGame(true);
      }
    } else {
      // Mismatch
      mg.combo = 0;
      updateMemoryStatsUI();
      setTimeout(() => {
        c1.el.classList.remove("is-flipped", "border-emerald-400", "bg-slate-900");
        c1.el.style.backgroundColor = "";
        c1.el.querySelector(".card-back").classList.remove("hidden");
        c1.el.querySelector(".card-front").classList.add("hidden");

        c2.el.classList.remove("is-flipped", "border-emerald-400", "bg-slate-900");
        c2.el.style.backgroundColor = "";
        c2.el.querySelector(".card-back").classList.remove("hidden");
        c2.el.querySelector(".card-front").classList.add("hidden");
        mg.flipped = [];
      }, 900);
    }
  }
}

function startMemoryTimer() {
  const mg = state.memoryGame;
  clearInterval(mg.timer);
  mg.timer = setInterval(() => {
    mg.timeLeft -= 1;
    updateMemoryStatsUI();
    if (mg.timeLeft <= 0) {
      clearInterval(mg.timer);
      endMemoryGame(false);
    }
  }, 1000);
}

function updateMemoryStatsUI() {
  const mg = state.memoryGame;
  document.getElementById("memoryScoreVal").textContent = mg.score.toLocaleString();
  document.getElementById("memoryComboVal").textContent = `${mg.combo}x`;
  document.getElementById("memoryMatchedVal").textContent = `${mg.matchedPairs}/${mg.totalPairs}`;
  document.getElementById("memoryTimerVal").textContent = `${mg.timeLeft}s`;
}

function endMemoryGame(isWin) {
  const mg = state.memoryGame;
  mg.active = false;
  clearInterval(mg.timer);

  if (isWin) {
    mg.score += (mg.timeLeft * 50); // Time bonus
  }

  document.getElementById("memoryMainScreen").classList.add("hidden");
  document.getElementById("memoryGameOverScreen").classList.remove("hidden");

  document.getElementById("finalMemoryScore").textContent = mg.score.toLocaleString();
  document.getElementById("finalMemoryCombo").textContent = `${mg.maxCombo}x`;
  document.getElementById("finalMemoryTime").textContent = `${60 - mg.timeLeft} 秒`;

  let title = "🌱 永續記憶見習生";
  if (mg.score >= 5000) title = "⚡ 永續超能連動大師";
  else if (mg.score >= 3500) title = "🌿 永續敏銳觀察者";
  else if (mg.score >= 2000) title = "🎯 永續行動先鋒";

  document.getElementById("finalMemoryTitle").textContent = title;

  document.getElementById("submitMemoryLeaderboardBtn").onclick = () => {
    submitGameScoreToBackend(mg.score, mg.maxCombo, 100, mg.matchedPairs, title, "memory_match");
  };
}

// ==============================================================================
// 6. Game 2: 【SDG 永續連鎖消消樂 (Eco-Combo Blast)】(Right Game - Rebuilt)
// ==============================================================================
const COMBO_BLAST_ICONS = ["🌊", "🌳", "☀️", "🥗", "👕", "🤝"];

function initNewComboBlastGame() {
  const cg = state.comboGame;
  cg.active = true;
  cg.movesLeft = 15;
  cg.score = 0;
  cg.combo = 0;
  cg.maxCombo = 0;
  cg.risksSolved = 0;

  document.getElementById("comboIntroCard").classList.add("hidden");
  document.getElementById("comboMainScreen").classList.remove("hidden");
  document.getElementById("comboGameOverScreen").classList.add("hidden");

  buildComboBlastGrid();
  updateComboBlastStatsUI();
}

function buildComboBlastGrid() {
  const cg = state.comboGame;
  cg.grid = [];
  for (let r = 0; r < cg.rows; r++) {
    const row = [];
    for (let c = 0; c < cg.cols; c++) {
      row.push(Math.floor(Math.random() * cg.colors.length));
    }
    cg.grid.push(row);
  }
  renderComboBlastGrid();
}

function renderComboBlastGrid() {
  const container = document.getElementById("comboGridContainer");
  if (!container) return;
  container.innerHTML = "";

  const cg = state.comboGame;
  for (let r = 0; r < cg.rows; r++) {
    for (let c = 0; c < cg.cols; c++) {
      const val = cg.grid[r][c];
      const btn = document.createElement("button");
      btn.className = "w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex flex-col items-center justify-center text-xl sm:text-2xl shadow-md transform hover:scale-105 transition-all active:scale-95 border-2 border-white/20";
      btn.style.backgroundColor = cg.colors[val];
      btn.textContent = COMBO_BLAST_ICONS[val];
      btn.onclick = () => handleGemClick(r, c);
      container.appendChild(btn);
    }
  }
}

function handleGemClick(r, c) {
  const cg = state.comboGame;
  if (!cg.active || cg.movesLeft <= 0) return;

  const targetColor = cg.grid[r][c];
  if (targetColor === null) return;

  // Find connected gems using flood-fill
  const visited = Array.from({ length: cg.rows }, () => Array(cg.cols).fill(false));
  const connected = [];

  function dfs(row, col) {
    if (row < 0 || row >= cg.rows || col < 0 || col >= cg.cols) return;
    if (visited[row][col] || cg.grid[row][col] !== targetColor) return;
    visited[row][col] = true;
    connected.push([row, col]);
    dfs(row + 1, col);
    dfs(row - 1, col);
    dfs(row, col + 1);
    dfs(row, col - 1);
  }

  dfs(r, c);

  if (connected.length < 2) {
    showToast("至少需 2 個相鄰連動方塊才能消除！", "info");
    return;
  }

  // Deduct 1 move
  cg.movesLeft -= 1;
  cg.combo += 1;
  if (cg.combo > cg.maxCombo) cg.maxCombo = cg.combo;

  // Calculate blast points
  const points = (connected.length * 150) * cg.combo;
  cg.score += points;

  // Remove gems
  connected.forEach(([row, col]) => {
    cg.grid[row][col] = null;
  });

  // Gravity fall
  applyGravityAndRefill();
  renderComboBlastGrid();
  updateComboBlastStatsUI();

  showToast(`💥 連鎖引爆 ${connected.length} 顆方塊！獲得 +${points} 分！`, "success");

  if (cg.movesLeft <= 0) {
    endComboBlastGame();
  }
}

function applyGravityAndRefill() {
  const cg = state.comboGame;
  for (let c = 0; c < cg.cols; c++) {
    // Drop downwards
    let emptyRow = cg.rows - 1;
    for (let r = cg.rows - 1; r >= 0; r--) {
      if (cg.grid[r][c] !== null) {
        cg.grid[emptyRow][c] = cg.grid[r][c];
        if (emptyRow !== r) cg.grid[r][c] = null;
        emptyRow--;
      }
    }
    // Refill from top
    for (let r = emptyRow; r >= 0; r--) {
      cg.grid[r][c] = Math.floor(Math.random() * cg.colors.length);
    }
  }
}

function updateComboBlastStatsUI() {
  const cg = state.comboGame;
  document.getElementById("comboScoreVal").textContent = cg.score.toLocaleString();
  document.getElementById("comboStreakVal").textContent = `${cg.combo}x`;
  document.getElementById("comboMovesVal").textContent = cg.movesLeft;
}

function endComboBlastGame() {
  const cg = state.comboGame;
  cg.active = false;

  document.getElementById("comboMainScreen").classList.add("hidden");
  document.getElementById("comboGameOverScreen").classList.remove("hidden");

  document.getElementById("finalComboScore").textContent = cg.score.toLocaleString();
  document.getElementById("finalComboStreak").textContent = `${cg.maxCombo}x`;

  let title = "🌱 永續消消樂新手";
  if (cg.score >= 12000) title = "🌌 宇宙級永續守護神";
  else if (cg.score >= 8000) title = "🌟 傳奇星際消消大師";
  else if (cg.score >= 5000) title = "⚡ 永續連鎖爆破手";

  document.getElementById("finalComboTitle").textContent = title;

  document.getElementById("submitComboLeaderboardBtn").onclick = () => {
    submitGameScoreToBackend(cg.score, cg.maxCombo, 100, 5, title, "combo_blast");
  };
}

async function submitGameScoreToBackend(score, combo, health, solved, title, gameType) {
  if (!state.token) {
    showToast("請先登入後方可登錄天梯排行榜！", "warning");
    showLoginModal(true);
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/game/submit-score`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`
      },
      body: JSON.stringify({
        score: score,
        max_combo: combo,
        earth_health: health,
        risks_solved: solved,
        title_earned: title,
        game_type: gameType
      })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || "成績已登錄！", "success");
      switchTab("leaderboard");
    }
  } catch (err) {
    showToast("登錄失敗，請重試", "error");
  }
}

// ==============================================================================
// 7. Leaderboard Module
// ==============================================================================
async function loadLeaderboard(typeFilter = "") {
  const container = document.getElementById("leaderboardTableBody");
  if (!container) return;
  container.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400">排行榜載入中...</td></tr>';

  try {
    const url = typeFilter ? `${API_BASE}/game/leaderboard?game_type=${typeFilter}` : `${API_BASE}/game/leaderboard`;
    const res = await fetch(url, {
      headers: state.token ? { "Authorization": `Bearer ${state.token}` } : {}
    });
    if (res.ok) {
      const data = await res.json();
      renderLeaderboardTable(data.leaderboard, data.my_best);
    }
  } catch (err) {
    container.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-red-400">無法讀取排行榜</td></tr>';
  }
}

function renderLeaderboardTable(list, myBest) {
  const container = document.getElementById("leaderboardTableBody");
  if (!container) return;
  container.innerHTML = "";

  if (myBest) {
    const myRow = document.getElementById("myLeaderboardCard");
    if (myRow) {
      myRow.classList.remove("hidden");
      document.getElementById("myBestRank").textContent = `第 ${myBest.rank} 名`;
      document.getElementById("myBestScore").textContent = myBest.score.toLocaleString();
      document.getElementById("myBestCombo").textContent = `${myBest.max_combo} 連擊`;
      document.getElementById("myBestTitle").textContent = myBest.title_earned;
    }
  }

  if (list.length === 0) {
    container.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400">目前尚無戰績，成為第一位上榜者吧！</td></tr>';
    return;
  }

  list.forEach((item, idx) => {
    const rank = idx + 1;
    let badge = `<span class="font-bold text-slate-500">${rank}</span>`;
    if (rank === 1) badge = '<span class="text-xl">🥇</span>';
    if (rank === 2) badge = '<span class="text-xl">🥈</span>';
    if (rank === 3) badge = '<span class="text-xl">🥉</span>';

    const gameName = item.game_type === "memory_match" ? "翻牌對對碰" : "連鎖消消樂";

    const tr = document.createElement("tr");
    tr.className = `border-b border-slate-100 hover:bg-slate-50 transition-colors ${state.user && item.user_id === state.user.id ? 'bg-emerald-50/60 font-semibold' : ''}`;
    tr.innerHTML = `
      <td class="p-3 text-center">${badge}</td>
      <td class="p-3 font-bold text-slate-800">${item.user_name}</td>
      <td class="p-3 text-center"><span class="text-xs px-2 py-0.5 rounded-full ${item.game_type === 'memory_match' ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800'} font-bold">${gameName}</span></td>
      <td class="p-3 text-right font-mono font-bold text-emerald-600">${item.score.toLocaleString()}</td>
      <td class="p-3 text-center font-mono text-slate-600">${item.max_combo}x</td>
      <td class="p-3 text-center"><span class="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">${item.title_earned}</span></td>
      <td class="p-3 text-right text-xs text-slate-400">${new Date(item.played_at).toLocaleDateString('zh-TW')}</td>
    `;
    container.appendChild(tr);
  });
}

// ==============================================================================
// 8. Admin Dashboard & Review Module (Requirements 6 & 7 Implementation)
// ==============================================================================
let chartRadar = null;
let chartPie = null;

async function loadAdminDashboard() {
  if (!state.token || !state.user || !['admin', 'teacher'].includes(state.user.role)) return;

  try {
    const resStats = await fetch(`${API_BASE}/admin/stats`, {
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    if (resStats.ok) {
      const stats = await resStats.json();
      renderAdminStats(stats);
      renderAdminCharts(stats);
    }

    loadAdminWorksheets();
    loadAdminStudents();
  } catch (err) {
    console.error("Admin dashboard load failed", err);
  }
}

function renderAdminStats(s) {
  document.getElementById("adminStatStudents").textContent = s.total_students;
  document.getElementById("adminStatWorksheets").textContent = s.total_worksheets;
  document.getElementById("adminStatGames").textContent = s.total_games;
  document.getElementById("adminStatMaxScore").textContent = s.max_game_score.toLocaleString();
}

function renderAdminCharts(stats) {
  const ctxRadar = document.getElementById("adminRadarChart")?.getContext("2d");
  if (ctxRadar) {
    if (chartRadar) chartRadar.destroy();
    const labels = state.goals.map(g => `${g.code}`);
    const dataVals = state.goals.map(g => stats.sdg_frequency[g.id] || 0);

    chartRadar = new Chart(ctxRadar, {
      type: "radar",
      data: {
        labels: labels,
        datasets: [{
          label: "被連動選取頻次",
          data: dataVals,
          backgroundColor: "rgba(16, 185, 129, 0.2)",
          borderColor: "#10b981",
          pointBackgroundColor: "#10b981",
          pointBorderColor: "#fff"
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { r: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  const ctxPie = document.getElementById("adminPieChart")?.getContext("2d");
  if (ctxPie) {
    if (chartPie) chartPie.destroy();
    const counts = stats.center_action_distribution || {};
    chartPie = new Chart(ctxPie, {
      type: "doughnut",
      data: {
        labels: ["A. 淨灘", "B. 二手衣交換", "C. 太陽能", "D. 自選佛光活動"],
        datasets: [{
          data: [counts["A"] || 0, counts["B"] || 0, counts["C"] || 0, counts["D"] || 0],
          backgroundColor: ["#0284c7", "#f59e0b", "#10b981", "#8b5cf6"]
        }]
      },
      options: { responsive: true, plugins: { legend: { position: "bottom" } } }
    });
  }
}

async function loadAdminWorksheets() {
  const container = document.getElementById("adminWorksheetsTableBody");
  if (!container) return;
  container.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">載入練習單清單...</td></tr>';

  try {
    const res = await fetch(`${API_BASE}/worksheets?limit=100`, {
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    if (res.ok) {
      const list = await res.json();
      container.innerHTML = "";
      if (list.length === 0) {
        container.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">目前尚無學員提交練習單</td></tr>';
        return;
      }
      list.forEach(w => {
        const tr = document.createElement("tr");
        tr.className = "border-b border-slate-100 hover:bg-slate-50 text-xs";
        tr.innerHTML = `
          <td class="p-3 font-bold text-slate-700">#${w.id}</td>
          <td class="p-3 font-semibold text-slate-800">${w.user_name}</td>
          <td class="p-3 text-slate-500">${w.unit_name}</td>
          <td class="p-3 font-medium text-slate-700">${w.center_action} (${w.center_custom || '標準'})</td>
          <td class="p-3"><span class="px-2 py-0.5 rounded font-bold ${w.status === 'reviewed' ? 'bg-purple-100 text-purple-800' : 'bg-emerald-100 text-emerald-800'}">${w.status}</span></td>
          <td class="p-3 font-bold text-purple-700">${w.score ? w.score + '分' : '未評分'}</td>
          <td class="p-3 text-right space-x-1">
            <button class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-semibold text-xs" onclick="viewWorksheetDetailModal(${w.id})">詳情</button>
            <a href="${API_BASE}/worksheets/${w.id}/export-docx" target="_blank" class="inline-block px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded font-semibold text-xs">Word匯出</a>
            <button class="px-2.5 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded font-semibold text-xs" onclick="openGradeModal(${w.id}, '${w.user_name}', ${w.score || 0}, '${(w.teacher_comment || '').replace(/'/g, "\\'")}')">批閱評分</button>
          </td>
        `;
        container.appendChild(tr);
      });
    }
  } catch (err) {
    container.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-red-400">載入失敗</td></tr>';
  }
}

/**
 * Requirement 6: Full Worksheet Details View Modal
 */
window.viewWorksheetDetailModal = async function(id) {
  try {
    const res = await fetch(`${API_BASE}/worksheets/${id}`, {
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    if (!res.ok) return;
    const ws = await res.json();

    const modal = document.getElementById("worksheetDetailModal");
    if (!modal) return;
    modal.classList.remove("hidden");

    document.getElementById("detailModalHeader").textContent = `學員：${ws.user_name} ｜ 分會單位：${ws.unit_name} (練習單 #${ws.id})`;
    document.getElementById("detailDownloadDocxBtn").href = `${API_BASE}/worksheets/${ws.id}/export-docx`;

    // Radial lines HTML
    const radialHtml = (ws.radial_data || []).map((r, i) => `
      <tr class="border-b border-slate-100">
        <td class="p-2 font-bold text-emerald-800">#${i+1} ${r.goal || ''}</td>
        <td class="p-2 text-slate-700">${r.mechanism || ''}</td>
        <td class="p-2 text-slate-600">${r.observable || ''}</td>
      </tr>
    `).join("");

    // Tradeoff lines HTML
    const tradeoffHtml = (ws.tradeoff_data || []).map((t, i) => `
      <tr class="border-b border-slate-100">
        <td class="p-2 font-bold text-amber-900">${t.who || ''}</td>
        <td class="p-2 text-slate-700">${t.situation || ''}</td>
        <td class="p-2 text-slate-600">${t.how || ''}</td>
      </tr>
    `).join("");

    const causal = ws.causal_data || {};
    const commit = ws.commitment || {};

    document.getElementById("detailModalBody").innerHTML = `
      <div class="space-y-4 text-xs">
        <div class="bg-slate-50 p-3 rounded-xl border border-slate-200">
          <span class="font-bold text-slate-500">中心行動：</span>
          <span class="font-black text-slate-900 text-sm ml-2">${ws.center_action} (${ws.center_custom || '標準行動'})</span>
          <span class="ml-4 font-mono text-teal-800 font-bold bg-teal-50 px-2 py-0.5 rounded border border-teal-200">${ws.chat_text}</span>
        </div>

        <div>
          <h4 class="font-extrabold text-slate-800 mb-2">放射型連動分析（機制與變化）：</h4>
          <table class="w-full text-left bg-white border border-slate-200 rounded-lg overflow-hidden">
            <thead class="bg-emerald-50 text-emerald-900 font-bold">
              <tr><th class="p-2">連動目標</th><th class="p-2">作用機制</th><th class="p-2">可觀察變化</th></tr>
            </thead>
            <tbody>${radialHtml || '<tr><td colspan="3" class="p-3 text-center text-slate-400">無連動資料</td></tr>'}</tbody>
          </table>
        </div>

        <div>
          <h4 class="font-extrabold text-amber-900 mb-2">善意拉扯檢核（負面影響與對策）：</h4>
          <table class="w-full text-left bg-white border border-slate-200 rounded-lg overflow-hidden">
            <thead class="bg-amber-50 text-amber-900 font-bold">
              <tr><th class="p-2">可能傷到誰/什麼</th><th class="p-2">發生情況</th><th class="p-2">降低影響對策</th></tr>
            </thead>
            <tbody>${tradeoffHtml || '<tr><td colspan="3" class="p-3 text-center text-slate-400">無拉扯檢核</td></tr>'}</tbody>
          </table>
        </div>

        <div class="bg-indigo-50/50 p-3 rounded-xl border border-indigo-100">
          <h4 class="font-bold text-indigo-900 mb-1">課後進階因果鏈：</h4>
          <p><strong>起點：</strong>${causal.start || '無'}（條件：${causal.start_cond || '無'}） ➔ <strong>中介：</strong>${causal.mid || '無'}（條件：${causal.mid_cond || '無'}） ➔ <strong>結果：</strong>${causal.result || '無'}（條件：${causal.result_cond || '無'}）</p>
        </div>

        <div class="bg-emerald-50/50 p-3 rounded-xl border border-emerald-200">
          <h4 class="font-bold text-emerald-900 mb-1">連動承諾宣言：</h4>
          <p>「我願意從 <u>${commit.start_action || ''}</u> 開始，希望促進 <u>${commit.target_1 || ''}</u> 與 <u>${commit.target_2 || ''}</u>，也會留意 <u>${commit.risk_aware || ''}</u> 的風險。一個月後，我會用 <u>${commit.metric || ''}</u> 來確認自己有沒有做到。」</p>
        </div>

        ${ws.score ? `
        <div class="bg-purple-50 p-3 rounded-xl border border-purple-200">
          <div class="font-bold text-purple-900">審定成績：${ws.score} 分</div>
          <div class="text-slate-700 mt-1">講師講評：${ws.teacher_comment || '無'}</div>
        </div>` : '<div class="text-slate-400 italic">目前尚未評分</div>'}
      </div>
    `;
  } catch (err) {
    showToast("無法載入練習單詳情", "error");
  }
};

window.openGradeModal = function(id, name, curScore, curComment) {
  const modal = document.getElementById("gradeModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  document.getElementById("gradeModalTargetName").textContent = `學員：${name} (練習單 #${id})`;
  document.getElementById("gradeScoreInput").value = curScore || "";
  document.getElementById("gradeCommentInput").value = curComment || "";
  document.getElementById("gradeSubmitBtn").onclick = () => submitGrade(id);
};

/**
 * Requirement 6: Submit Grade & Send Email Notification
 */
async function submitGrade(id) {
  const score = parseInt(document.getElementById("gradeScoreInput").value, 10);
  const comment = document.getElementById("gradeCommentInput").value.trim();
  if (isNaN(score) || score < 0 || score > 100) {
    showToast("請輸入 0 ~ 100 之有效分數！", "error");
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/admin/worksheets/${id}/grade`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`
      },
      body: JSON.stringify({ score, comment })
    });
    const d = await res.json();
    if (res.ok) {
      document.getElementById("gradeModal").classList.add("hidden");
      showToast(`✓ 批閱完成！已記錄 ${score} 分，並發送指導通知信至 ${d.email_target}！`, "success");
      loadAdminWorksheets();
    }
  } catch (err) {
    showToast("批閱失敗", "error");
  }
}

// ==============================================================================
// 9. Student Management (Requirement 7: Edit, Batch Delete & Batch Import)
// ==============================================================================
async function loadAdminStudents(search = "") {
  const container = document.getElementById("adminStudentsTableBody");
  if (!container) return;
  container.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">載入學員名單...</td></tr>';
  state.selectedStudentIds.clear();
  updateSelectedCountUI();

  try {
    const url = search ? `${API_BASE}/admin/students?search=${encodeURIComponent(search)}&limit=200` : `${API_BASE}/admin/students?limit=100`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      container.innerHTML = "";
      data.items.forEach(s => {
        const tr = document.createElement("tr");
        tr.className = "border-b border-slate-100 hover:bg-slate-50 text-xs";
        tr.innerHTML = `
          <td class="p-3 text-center">
            ${s.role !== 'admin' ? `<input type="checkbox" class="student-cb rounded text-emerald-600" value="${s.id}" onchange="handleStudentSelectChange(${s.id}, this.checked)">` : ''}
          </td>
          <td class="p-3 font-mono text-slate-500">#${s.id}</td>
          <td class="p-3 font-bold text-slate-800">${s.name}</td>
          <td class="p-3 text-slate-600">${s.email}</td>
          <td class="p-3 text-slate-600 font-mono">${s.phone}</td>
          <td class="p-3 text-slate-500">${s.unit_name || '佛光學員'}</td>
          <td class="p-3 text-right">
            <button class="px-2.5 py-1 bg-amber-50 text-amber-800 hover:bg-amber-100 rounded font-semibold text-[11px]" 
              onclick="openEditStudentModal(${s.id}, '${s.name}', '${s.email}', '${s.phone}', '${s.unit_name || '佛光學員'}', '${s.role}')">
              修改
            </button>
          </td>
        `;
        container.appendChild(tr);
      });
    }
  } catch (err) {
    container.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-red-400">無法讀取名單</td></tr>';
  }
}

window.handleStudentSelectChange = function(id, isChecked) {
  if (isChecked) state.selectedStudentIds.add(id);
  else state.selectedStudentIds.delete(id);
  updateSelectedCountUI();
};

window.toggleSelectAllStudents = function(masterCb) {
  document.querySelectorAll(".student-cb").forEach(cb => {
    cb.checked = masterCb.checked;
    const sid = parseInt(cb.value, 10);
    if (masterCb.checked) state.selectedStudentIds.add(sid);
    else state.selectedStudentIds.delete(sid);
  });
  updateSelectedCountUI();
};

function updateSelectedCountUI() {
  const countEl = document.getElementById("selectedStudentCount");
  if (countEl) countEl.textContent = state.selectedStudentIds.size;
  const btn = document.getElementById("batchDeleteBtn");
  if (btn) btn.disabled = state.selectedStudentIds.size === 0;
}

window.openEditStudentModal = function(id, name, email, phone, unit, role) {
  const modal = document.getElementById("editStudentModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  document.getElementById("editStudentId").value = id;
  document.getElementById("editStudentName").value = name;
  document.getElementById("editStudentEmail").value = email;
  document.getElementById("editStudentPhone").value = phone;
  document.getElementById("editStudentUnit").value = unit;
  document.getElementById("editStudentPassword").value = "";
};

window.saveStudentEdit = async function() {
  const id = document.getElementById("editStudentId").value;
  const name = document.getElementById("editStudentName").value.trim();
  const email = document.getElementById("editStudentEmail").value.trim();
  const phone = document.getElementById("editStudentPhone").value.trim();
  const unit_name = document.getElementById("editStudentUnit").value.trim();
  const password = document.getElementById("editStudentPassword").value.trim();

  if (!name || !email) {
    showToast("姓名與 Email 為必填欄位", "error");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/students/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`
      },
      body: JSON.stringify({ name, email, phone, unit_name, password })
    });
    const d = await res.json();
    if (res.ok) {
      showToast(d.message || "學員資料更新成功！", "success");
      document.getElementById("editStudentModal").classList.add("hidden");
      loadAdminStudents();
    }
  } catch (err) {
    showToast("更新失敗", "error");
  }
};

window.executeBatchDeleteStudents = async function() {
  const ids = Array.from(state.selectedStudentIds);
  if (ids.length === 0) return;
  if (!confirm(`確定要批次刪除選取的 ${ids.length} 位學員嗎？此操作將同時刪除這些學員的練習單與紀錄。`)) return;

  try {
    const res = await fetch(`${API_BASE}/admin/students/batch-delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`
      },
      body: JSON.stringify({ ids })
    });
    const d = await res.json();
    if (res.ok) {
      showToast(d.message || "批次刪除成功！", "success");
      loadAdminStudents();
    }
  } catch (err) {
    showToast("批次刪除失敗", "error");
  }
};

window.openBatchImportModal = function() {
  document.getElementById("batchImportModal")?.classList.remove("hidden");
};

window.executeBatchImport = async function() {
  const textVal = document.getElementById("importTextarea").value.trim();
  const fileInput = document.getElementById("importFileInput");

  let parsedStudents = [];

  // Parse text area lines (Format: 姓名, Email, 電話, 分會單位)
  if (textVal) {
    const lines = textVal.split("\n");
    for (let line of lines) {
      const parts = line.split(",").map(p => p.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        parsedStudents.push({
          name: parts[0],
          email: parts[1],
          phone: parts[2] || "0920111111",
          unit_name: parts[3] || "佛光學員"
        });
      }
    }
  }

  // Parse file if selected
  if (fileInput.files.length > 0) {
    const file = fileInput.files[0];
    const text = await file.text();
    const rows = text.split("\n");
    for (let r of rows) {
      const parts = r.split(",").map(p => p.trim());
      if (parts.length >= 2 && parts[0] && parts[1] && parts[0] !== "學員姓名" && parts[0] !== "姓名") {
        parsedStudents.push({
          name: parts[0],
          email: parts[1],
          phone: parts[2] || "0920111111",
          unit_name: parts[3] || "佛光學員"
        });
      }
    }
  }

  if (parsedStudents.length === 0) {
    showToast("未偵測到有效的名冊資料，請確認格式（姓名, Email, 電話, 單位）", "error");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/students/batch-import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`
      },
      body: JSON.stringify({ students: parsedStudents })
    });
    const d = await res.json();
    if (res.ok) {
      showToast(d.message || "批次匯入完成！", "success");
      document.getElementById("batchImportModal").classList.add("hidden");
      document.getElementById("importTextarea").value = "";
      fileInput.value = "";
      loadAdminStudents();
    }
  } catch (err) {
    showToast("匯入失敗", "error");
  }
};

window.exportWorksheetsCSV = function() {
  if (!state.token) return;
  window.open(`${API_BASE}/admin/export/csv`, "_blank");
};

// ==============================================================================
// 10. Utilities & Toast Notifications
// ==============================================================================
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  const bgClass = type === "success" ? "bg-emerald-600 text-white" : (type === "error" ? "bg-red-600 text-white" : (type === "warning" ? "bg-amber-600 text-white" : "bg-slate-800 text-white"));

  toast.className = `${bgClass} px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-semibold transition-all transform duration-300 opacity-0 translate-y-2 pointer-events-auto`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : (type === 'error' ? '✕' : 'ℹ')}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.classList.remove("opacity-0", "translate-y-2"), 10);
  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-y-2");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
