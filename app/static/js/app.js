// SDGs and Climate Action Platform - Comprehensive Frontend Core
const API_BASE = "/api";

// App State
const state = {
  user: null,
  token: localStorage.getItem("sdgs_token") || null,
  goals: [],
  targets: [],
  currentWorksheetId: null,
  worksheetsList: [],
  activeTab: "worksheet",
  
  // Game State
  game: {
    active: false,
    round: 1,
    maxRounds: 5,
    score: 0,
    combo: 0,
    maxCombo: 0,
    earthHealth: 30,
    risksSolved: 0,
    hand: [],
    selectedCards: [],
    currentCrisis: null,
    crisisTimer: null,
    crisisTimeLeft: 10
  }
};

// ==============================================================================
// 1. Core Initialization & Routing
// ==============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  initUIEvents();
  await loadQuickAccounts();
  await checkAuth();
  await loadSDGsData();
});

function initUIEvents() {
  // Navigation tabs
  document.querySelectorAll("[data-nav-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-nav-tab");
      switchTab(tab);
    });
  });

  // Login form submit
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
  }

  // Logout button
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", handleLogout);
  }

  // Quick Account selector
  const quickSelect = document.getElementById("quickAccountSelect");
  if (quickSelect) {
    quickSelect.addEventListener("change", handleQuickAccountSelect);
  }

  // Worksheet events
  initWorksheetEvents();

  // Search input in SDGs lookup
  const sdgSearchInput = document.getElementById("sdgSearchInput");
  if (sdgSearchInput) {
    sdgSearchInput.addEventListener("input", filterSDGsDisplay);
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

  // Tab specific refreshes
  if (tabId === "leaderboard") loadLeaderboard();
  if (tabId === "admin") loadAdminDashboard();
  if (tabId === "game" && !state.game.active) initNewGame();
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
      // Auto load user's last worksheet
      loadMyWorksheets();
    } else {
      handleLogout();
    }
  } catch (err) {
    console.error("Auth check failed:", err);
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

function handleLogout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("sdgs_token");
  showLoginModal(true);
  updateUserUI();
}

async function loadQuickAccounts() {
  try {
    const res = await fetch(`${API_BASE}/auth/quick-list`);
    if (res.ok) {
      const list = await res.json();
      const select = document.getElementById("quickAccountSelect");
      if (!select) return;
      select.innerHTML = '<option value="">-- 快速示範身分切換 (1-Click Switch) --</option>';
      list.forEach(u => {
        const opt = document.createElement("option");
        opt.value = JSON.stringify(u);
        const roleBadge = u.role === 'admin' ? '[講師/系統管理員]' : (u.role === 'teacher' ? '[助教]' : '[學員]');
        opt.textContent = `${roleBadge} ${u.name} (${u.email})`;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.warn("Failed to load quick accounts", err);
  }
}

async function handleQuickAccountSelect(e) {
  const val = e.target.value;
  if (!val) return;
  const user = JSON.parse(val);
  document.getElementById("loginAccount").value = user.email;
  // If admin/teacher, auto populate their passwords
  if (user.role === 'admin') {
    document.getElementById("loginPassword").value = "admin888";
  } else if (user.role === 'teacher') {
    document.getElementById("loginPassword").value = "teacher888";
  } else {
    document.getElementById("loginPassword").value = user.phone;
  }
  // Auto submit
  document.getElementById("loginForm").dispatchEvent(new Event("submit"));
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
  const adminNavTab = document.getElementById("navTabAdmin");

  if (state.user) {
    if (userNameEl) userNameEl.textContent = state.user.name;
    if (userRoleEl) {
      userRoleEl.textContent = state.user.role === 'admin' ? '系統管理員' : (state.user.role === 'teacher' ? '授課講師/助教' : '學員');
      userRoleEl.className = state.user.role === 'admin' 
        ? "text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-semibold"
        : "text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold";
    }
    // Show admin tab only for staff
    if (adminNavTab) {
      if (['admin', 'teacher'].includes(state.user.role)) {
        adminNavTab.classList.remove("hidden");
      } else {
        adminNavTab.classList.add("hidden");
      }
    }
    // Auto fill worksheet name & unit
    const formName = document.getElementById("ws_userName");
    const formUnit = document.getElementById("ws_unitName");
    if (formName) formName.value = state.user.name;
    if (formUnit && !formUnit.value) formUnit.value = state.user.unit_name || "佛光學員";
  }
}

// ==============================================================================
// 3. SDGs Reference & Search Module
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
    // Check tier / 5P filter
    if (filterTier !== "all" && goal.tier !== filterTier) return;
    if (filter5P !== "all" && !goal.category_5p.includes(filter5P)) return;

    // Filter targets under this goal
    const goalTargets = state.targets.filter(t => t.goal_id === goal.id);
    
    // Check keyword search match
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
          ${matchingTargets.map(t => `
            <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-200/60 text-xs">
              <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-slate-800">${t.code}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded ${t.target_type === '成果目標' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}">${t.target_type}</span>
              </div>
              <p class="text-slate-600 text-[11px] leading-relaxed mb-2">${t.content}</p>
              <button type="button" class="w-full py-1 text-center bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 rounded font-medium text-[11px] transition-colors"
                onclick="quoteTargetToWorksheet('${goal.code} ${goal.name}', '${t.code}: ${t.content.replace(/'/g, "\\'")}')">
                📌 引用至連動分析練習單
              </button>
            </div>
          `).join("")}
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

window.quoteTargetToWorksheet = function(goalText, targetText) {
  switchTab("worksheet");
  // Find first empty radial line or add a new one
  const radialRows = document.querySelectorAll(".radial-line-row");
  let targetRow = null;
  for (let r of radialRows) {
    const goalSelect = r.querySelector(".radial-goal-select");
    if (!goalSelect.value) {
      targetRow = r;
      break;
    }
  }
  if (!targetRow) {
    addRadialLineRow();
    const rows = document.querySelectorAll(".radial-line-row");
    targetRow = rows[rows.length - 1];
  }
  
  const goalSelect = targetRow.querySelector(".radial-goal-select");
  const mechInput = targetRow.querySelector(".radial-mech-input");
  
  // Set goal select option
  for (let opt of goalSelect.options) {
    if (opt.textContent.includes(goalText.split(" ")[0])) {
      goalSelect.value = opt.value;
      break;
    }
  }
  if (mechInput && !mechInput.value) {
    mechInput.value = `呼應細項 ${targetText.substring(0, 80)}...`;
  }
  updateChatTextSnippet();
  showToast(`已引用「${goalText}」至練習單！`, "success");
  targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

function filterSDGsDisplay() {
  const tierFilter = document.querySelector(".tier-filter-btn.active")?.getAttribute("data-tier") || "all";
  const pFilter = document.querySelector(".p-filter-btn.active")?.getAttribute("data-5p") || "all";
  const kw = document.getElementById("sdgSearchInput")?.value || "";
  renderSDGsDirectory(tierFilter, pFilter, kw);
}

window.setTierFilter = function(tier, btn) {
  document.querySelectorAll(".tier-filter-btn").forEach(b => b.classList.remove("active", "bg-emerald-600", "text-white"));
  btn.classList.add("active", "bg-emerald-600", "text-white");
  filterSDGsDisplay();
};

window.setPFilter = function(pVal, btn) {
  document.querySelectorAll(".p-filter-btn").forEach(b => b.classList.remove("active", "bg-sky-600", "text-white"));
  btn.classList.add("active", "bg-sky-600", "text-white");
  filterSDGsDisplay();
};

// ==============================================================================
// 4. Worksheet Module (CRUD & Linkage Analysis)
// ==============================================================================
function initWorksheetEvents() {
  // Center action radio changes
  document.querySelectorAll("input[name='center_action']").forEach(radio => {
    radio.addEventListener("change", (e) => {
      const customBox = document.getElementById("centerCustomBox");
      if (e.target.value === "D") {
        customBox.classList.remove("hidden");
      } else {
        customBox.classList.add("hidden");
      }
      updateChatTextSnippet();
    });
  });

  const customInput = document.getElementById("ws_centerCustom");
  if (customInput) customInput.addEventListener("input", updateChatTextSnippet);

  // Add line buttons
  const addLineBtn = document.getElementById("addRadialLineBtn");
  if (addLineBtn) addLineBtn.addEventListener("click", () => addRadialLineRow());

  const addTradeoffBtn = document.getElementById("addTradeoffBtn");
  if (addTradeoffBtn) addTradeoffBtn.addEventListener("click", () => addTradeoffRow());

  // Form submit (Draft & Publish)
  const saveDraftBtn = document.getElementById("saveDraftBtn");
  if (saveDraftBtn) saveDraftBtn.addEventListener("click", () => saveWorksheet("draft"));

  const submitWorksheetBtn = document.getElementById("submitWorksheetBtn");
  if (submitWorksheetBtn) submitWorksheetBtn.addEventListener("click", () => saveWorksheet("submitted"));

  const viewMyWorksheetsBtn = document.getElementById("viewMyWorksheetsBtn");
  if (viewMyWorksheetsBtn) viewMyWorksheetsBtn.addEventListener("click", openMyWorksheetsModal);

  // Chat snippet copy button
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

  // Pre-seed default 3 radial lines and 1 tradeoff row
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
  for (let i = 0; i < 3; i++) {
    addRadialLineRow();
  }
  const toContainer = document.getElementById("tradeoffContainer");
  if (toContainer && toContainer.children.length === 0) {
    addTradeoffRow();
  }
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

  // Linked SDGs numbers
  const goals = [];
  document.querySelectorAll(".radial-goal-select").forEach(sel => {
    if (sel.value) {
      const match = sel.value.match(/SDG\s*(\d+)/i);
      if (match) goals.push(match[1]);
    }
  });
  const goalsStr = goals.length > 0 ? goals.join("、") : "14、12、3";

  // First risk
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

  // Collect radial data
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

  // Collect tradeoff data
  const tradeoffData = [];
  document.querySelectorAll(".tradeoff-row").forEach(row => {
    const who = row.querySelector(".tradeoff-who")?.value.trim();
    const situation = row.querySelector(".tradeoff-sit")?.value.trim();
    const how = row.querySelector(".tradeoff-how")?.value.trim();
    if (who || situation || how) {
      tradeoffData.push({ who, situation, how });
    }
  });

  // Collect causal data
  const causalData = {
    start: document.getElementById("ws_causalA")?.value.trim() || "",
    start_cond: document.getElementById("ws_causalACond")?.value.trim() || "",
    mid: document.getElementById("ws_causalB")?.value.trim() || "",
    mid_cond: document.getElementById("ws_causalBCond")?.value.trim() || "",
    result: document.getElementById("ws_causalC")?.value.trim() || "",
    result_cond: document.getElementById("ws_causalCCond")?.value.trim() || ""
  };

  // Collect self-checks
  const selfChecks = [
    document.getElementById("ws_check1")?.checked || false,
    document.getElementById("ws_check2")?.checked || false,
    document.getElementById("ws_check3")?.checked || false,
    document.getElementById("ws_check4")?.checked || false
  ];

  // Collect commitment
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

    if (method === "POST" && data.id) {
      state.currentWorksheetId = data.id;
    }

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
  if (badge) {
    badge.textContent = state.worksheetsList.length;
  }
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

  // Populate fields
  const unitEl = document.getElementById("ws_unitName");
  if (unitEl) unitEl.value = ws.unit_name || "";

  // Radio
  const radio = document.querySelector(`input[name='center_action'][value='${ws.center_action}']`);
  if (radio) {
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
  }
  if (ws.center_action === "D") {
    const custEl = document.getElementById("ws_centerCustom");
    if (custEl) custEl.value = ws.center_custom || "";
  }

  // Radial lines
  const radialContainer = document.getElementById("radialLinesContainer");
  if (radialContainer) {
    radialContainer.innerHTML = "";
    if (Array.isArray(ws.radial_data)) {
      ws.radial_data.forEach(line => addRadialLineRow(line));
    }
  }

  // Tradeoff lines
  const tradeoffContainer = document.getElementById("tradeoffContainer");
  if (tradeoffContainer) {
    tradeoffContainer.innerHTML = "";
    if (Array.isArray(ws.tradeoff_data)) {
      ws.tradeoff_data.forEach(to => addTradeoffRow(to));
    }
  }

  // Causal
  if (ws.causal_data) {
    document.getElementById("ws_causalA").value = ws.causal_data.start || "";
    document.getElementById("ws_causalACond").value = ws.causal_data.start_cond || "";
    document.getElementById("ws_causalB").value = ws.causal_data.mid || "";
    document.getElementById("ws_causalBCond").value = ws.causal_data.mid_cond || "";
    document.getElementById("ws_causalC").value = ws.causal_data.result || "";
    document.getElementById("ws_causalCCond").value = ws.causal_data.result_cond || "";
  }

  // Self checks
  if (Array.isArray(ws.self_checks)) {
    document.getElementById("ws_check1").checked = !!ws.self_checks[0];
    document.getElementById("ws_check2").checked = !!ws.self_checks[1];
    document.getElementById("ws_check3").checked = !!ws.self_checks[2];
    document.getElementById("ws_check4").checked = !!ws.self_checks[3];
  }

  // Commitment
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
      if (state.currentWorksheetId === wsId) {
        state.currentWorksheetId = null;
      }
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
// 5. Interactive Game: SDG Roguelike Combo
// ==============================================================================
function initNewGame() {
  state.game.active = true;
  state.game.round = 1;
  state.game.score = 0;
  state.game.combo = 0;
  state.game.maxCombo = 0;
  state.game.earthHealth = 35;
  state.game.risksSolved = 0;
  state.game.selectedCards = [];

  document.getElementById("gameIntroCard").classList.add("hidden");
  document.getElementById("gameMainScreen").classList.remove("hidden");
  document.getElementById("gameOverScreen").classList.add("hidden");

  dealGameRound();
}

async function dealGameRound() {
  updateGameStatsUI();
  state.game.selectedCards = [];

  try {
    const res = await fetch(`${API_BASE}/game/cards`);
    if (res.ok) {
      const data = await res.json();
      state.game.hand = data.cards;
      state.game.currentCrisis = data.crisis;
      renderGameHand();
    }
  } catch (err) {
    console.error("Deal cards failed", err);
  }
}

function renderGameHand() {
  const container = document.getElementById("gameHandContainer");
  if (!container) return;
  container.innerHTML = "";

  state.game.hand.forEach((card, idx) => {
    const el = document.createElement("div");
    el.className = "game-card bg-slate-800 text-white rounded-2xl p-4 border border-slate-700 cursor-pointer flex flex-col justify-between shadow-lg hover:border-emerald-500 transition-all select-none";
    el.innerHTML = `
      <div>
        <div class="flex justify-between items-center mb-2">
          <span class="text-xs px-2 py-0.5 rounded-full font-bold ${getTierBadgeColor(card.tier)}">${card.tier}</span>
          <span class="text-xs font-mono font-bold text-emerald-400">⚡ ${card.power} 點</span>
        </div>
        <h4 class="font-bold text-sm text-slate-100 mb-1">${card.name}</h4>
        <p class="text-xs text-slate-300 leading-relaxed mb-3">${card.desc}</p>
      </div>
      <div>
        <div class="flex flex-wrap gap-1 mb-2">
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">主目標: SDG ${card.sdg_primary}</span>
          ${card.sdg_linked.map(s => `<span class="text-[10px] px-1 py-0.5 rounded bg-slate-900 text-slate-400">連動 SDG ${s}</span>`).join("")}
        </div>
        <div class="text-[10px] text-amber-300 bg-amber-950/40 p-1.5 rounded border border-amber-900/60 flex items-center gap-1">
          <span>⚠️ 潛在拉扯代價：</span>${card.risk_prompt.substring(0, 22)}...
        </div>
      </div>
    `;

    el.addEventListener("click", () => toggleCardSelection(card, el));
    container.appendChild(el);
  });

  const playBtn = document.getElementById("playCardsBtn");
  if (playBtn) playBtn.disabled = true;
}

function getTierBadgeColor(tier) {
  if (tier === "生物圈") return "bg-sky-500/20 text-sky-300 border border-sky-500/40";
  if (tier === "社會") return "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40";
  if (tier === "經濟") return "bg-amber-500/20 text-amber-300 border border-amber-500/40";
  return "bg-purple-500/20 text-purple-300 border border-purple-500/40";
}

function toggleCardSelection(card, cardEl) {
  const index = state.game.selectedCards.findIndex(c => c.id === card.id);
  if (index > -1) {
    state.game.selectedCards.splice(index, 1);
    cardEl.classList.remove("selected", "ring-2", "ring-emerald-400");
  } else {
    if (state.game.selectedCards.length >= 3) {
      showToast("每回合最多選擇 3 張卡牌打出！", "info");
      return;
    }
    state.game.selectedCards.push(card);
    cardEl.classList.add("selected", "ring-2", "ring-emerald-400");
  }

  const playBtn = document.getElementById("playCardsBtn");
  if (playBtn) {
    playBtn.disabled = state.game.selectedCards.length < 2;
    playBtn.textContent = state.game.selectedCards.length < 2 
      ? `請至少挑選 2 張卡牌 (${state.game.selectedCards.length}/3)` 
      : `🚀 啟動連擊 (${state.game.selectedCards.length} 張出牌)`;
  }
}

window.executeTurnPlay = function() {
  if (state.game.selectedCards.length < 2) return;

  // Calculate synergies
  const selected = state.game.selectedCards;
  const tiers = new Set(selected.map(c => c.tier));
  
  // Wedding cake multipliers
  let tierMultiplier = 1.0;
  if (tiers.size === 2) tierMultiplier = 1.5;
  if (tiers.size >= 3) tierMultiplier = 2.5;

  let basePower = selected.reduce((sum, c) => sum + c.power, 0);

  // Target resonance bonus
  const allSdgIds = new Set();
  selected.forEach(c => {
    allSdgIds.add(c.sdg_primary);
    c.sdg_linked.forEach(s => allSdgIds.add(s));
  });

  let synergyBonus = 0;
  if (allSdgIds.has(14) && allSdgIds.has(12)) synergyBonus += 1500;
  if (allSdgIds.has(7) && allSdgIds.has(13)) synergyBonus += 1500;
  if (allSdgIds.has(2) && allSdgIds.has(12)) synergyBonus += 1200;

  state.game.combo += 1;
  if (state.game.combo > state.game.maxCombo) {
    state.game.maxCombo = state.game.combo;
  }

  const turnScore = Math.round((basePower * (1 + state.game.combo * 0.2)) * tierMultiplier) + synergyBonus;
  state.game.score += turnScore;
  state.game.earthHealth = Math.min(100, state.game.earthHealth + 15);

  // 40% Chance of triggering Trade-off Crisis
  const triggerCrisis = Math.random() < 0.45;
  if (triggerCrisis && state.game.currentCrisis) {
    showCrisisModal(state.game.currentCrisis);
  } else {
    finishTurn();
  }
};

function showCrisisModal(crisis) {
  const modal = document.getElementById("crisisModal");
  if (!modal) return;
  modal.classList.remove("hidden");

  document.getElementById("crisisTitle").textContent = crisis.title;
  document.getElementById("crisisDesc").textContent = crisis.desc;

  const optContainer = document.getElementById("crisisOptionsContainer");
  optContainer.innerHTML = "";

  crisis.options.forEach((optText, i) => {
    const btn = document.createElement("button");
    btn.className = "w-full text-left p-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium border border-slate-700 hover:border-amber-500 transition-colors";
    btn.textContent = `${i + 1}. ${optText}`;
    btn.onclick = () => resolveCrisisChoice(optText === crisis.correct_strategy);
    optContainer.appendChild(btn);
  });

  // 10s Timer
  state.game.crisisTimeLeft = 10;
  const timerBar = document.getElementById("crisisTimerBar");
  clearInterval(state.game.crisisTimer);
  state.game.crisisTimer = setInterval(() => {
    state.game.crisisTimeLeft -= 1;
    if (timerBar) {
      timerBar.style.width = `${(state.game.crisisTimeLeft / 10) * 100}%`;
    }
    if (state.game.crisisTimeLeft <= 0) {
      clearInterval(state.game.crisisTimer);
      resolveCrisisChoice(false);
    }
  }, 1000);
}

function resolveCrisisChoice(isCorrect) {
  clearInterval(state.game.crisisTimer);
  document.getElementById("crisisModal").classList.add("hidden");

  if (isCorrect) {
    state.game.risksSolved += 1;
    state.game.score += 2000;
    showToast("🛡️ 危機化解成功！獲得配套防護加成 +2,000 分！", "success");
  } else {
    state.game.earthHealth = Math.max(10, state.game.earthHealth - 15);
    showToast("💥 善意拉扯失控造成副作用！地球健康度 -15%", "error");
  }
  finishTurn();
}

function finishTurn() {
  updateGameStatsUI();
  if (state.game.round >= state.game.maxRounds) {
    endGame();
  } else {
    state.game.round += 1;
    dealGameRound();
  }
}

function updateGameStatsUI() {
  document.getElementById("gameScoreVal").textContent = state.game.score.toLocaleString();
  document.getElementById("gameComboVal").textContent = `${state.game.combo}x`;
  document.getElementById("gameRoundVal").textContent = `${state.game.round}/${state.game.maxRounds}`;
  
  const hpBar = document.getElementById("gameHealthBar");
  const hpText = document.getElementById("gameHealthVal");
  if (hpBar) hpBar.style.width = `${state.game.earthHealth}%`;
  if (hpText) hpText.textContent = `${state.game.earthHealth}%`;
}

function endGame() {
  state.game.active = false;
  document.getElementById("gameMainScreen").classList.add("hidden");
  document.getElementById("gameOverScreen").classList.remove("hidden");

  document.getElementById("finalScoreVal").textContent = state.game.score.toLocaleString();
  document.getElementById("finalMaxComboVal").textContent = `${state.game.maxCombo} 連擊`;
  document.getElementById("finalHealthVal").textContent = `${state.game.earthHealth}%`;
  document.getElementById("finalRisksSolvedVal").textContent = `${state.game.risksSolved} 次`;

  // Determine Title
  let title = "🌱 永續見習修復師";
  if (state.game.score >= 12000) title = "🌌 宇宙級永續守護神";
  else if (state.game.score >= 10000) title = "🌟 傳奇星際修復大師";
  else if (state.game.score >= 8000) title = "🌿 卓越生態協調者";
  else if (state.game.score >= 6000) title = "⚡ 永續連鎖先鋒";

  document.getElementById("finalTitleVal").textContent = title;
  
  const submitBtn = document.getElementById("submitScoreLeaderboardBtn");
  if (submitBtn) {
    submitBtn.onclick = () => submitGameScoreToBackend(title);
  }
}

async function submitGameScoreToBackend(title) {
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
        score: state.game.score,
        max_combo: state.game.maxCombo,
        earth_health: state.game.earthHealth,
        risks_solved: state.game.risksSolved,
        title_earned: title
      })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || "成績登錄成功！", "success");
      switchTab("leaderboard");
    }
  } catch (err) {
    showToast("登錄失敗，請重試", "error");
  }
}

// ==============================================================================
// 6. Leaderboard Module
// ==============================================================================
async function loadLeaderboard() {
  const container = document.getElementById("leaderboardTableBody");
  if (!container) return;
  container.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400">排行榜載入中...</td></tr>';

  try {
    const res = await fetch(`${API_BASE}/game/leaderboard`, {
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

    const tr = document.createElement("tr");
    tr.className = `border-b border-slate-100 hover:bg-slate-50 transition-colors ${state.user && item.user_id === state.user.id ? 'bg-emerald-50/60 font-semibold' : ''}`;
    tr.innerHTML = `
      <td class="p-3 text-center">${badge}</td>
      <td class="p-3 font-bold text-slate-800">${item.user_name}</td>
      <td class="p-3 text-right font-mono font-bold text-emerald-600">${item.score.toLocaleString()}</td>
      <td class="p-3 text-center font-mono text-slate-600">${item.max_combo}x</td>
      <td class="p-3 text-center"><span class="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">${item.title_earned}</span></td>
      <td class="p-3 text-right text-xs text-slate-400">${new Date(item.played_at).toLocaleDateString('zh-TW')}</td>
    `;
    container.appendChild(tr);
  });
}

// ==============================================================================
// 7. Admin Dashboard & Management Module
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
  // Chart 1: Radar for 17 SDGs
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
        scales: {
          r: {
            beginAtZero: true,
            ticks: { precision: 0 }
          }
        }
      }
    });
  }

  // Chart 2: Doughnut for Center Actions
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
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom" } }
      }
    });
  }
}

async function loadAdminWorksheets() {
  const container = document.getElementById("adminWorksheetsTableBody");
  if (!container) return;
  container.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">載入練習單清單...</td></tr>';

  try {
    const res = await fetch(`${API_BASE}/worksheets?limit=50`, {
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
          <td class="p-3 text-right">
            <button class="px-2 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded font-semibold mr-1" onclick="openGradeModal(${w.id}, '${w.user_name}', ${w.score || 0}, '${(w.teacher_comment || '').replace(/'/g, "\\'")}')">批閱評分</button>
            <button class="px-2 py-1 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded font-semibold" onclick="viewWorksheetDetail(${w.id})">詳情</button>
          </td>
        `;
        container.appendChild(tr);
      });
    }
  } catch (err) {
    container.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-red-400">載入失敗</td></tr>';
  }
}

window.openGradeModal = function(id, name, curScore, curComment) {
  const modal = document.getElementById("gradeModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  document.getElementById("gradeModalTargetName").textContent = `學員：${name} (練習單 #${id})`;
  document.getElementById("gradeScoreInput").value = curScore || "";
  document.getElementById("gradeCommentInput").value = curComment || "";
  document.getElementById("gradeSubmitBtn").onclick = () => submitGrade(id);
};

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
    if (res.ok) {
      showToast("批閱完成！已成功記錄成績與講評", "success");
      document.getElementById("gradeModal").classList.add("hidden");
      loadAdminWorksheets();
    }
  } catch (err) {
    showToast("批閱失敗", "error");
  }
}

async function loadAdminStudents(search = "") {
  const container = document.getElementById("adminStudentsTableBody");
  if (!container) return;
  container.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400">載入學員名單...</td></tr>';

  try {
    const url = search ? `${API_BASE}/admin/students?search=${encodeURIComponent(search)}&limit=100` : `${API_BASE}/admin/students?limit=50`;
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
          <td class="p-3 font-mono text-slate-500">#${s.id}</td>
          <td class="p-3 font-bold text-slate-800">${s.name}</td>
          <td class="p-3 text-slate-600">${s.email}</td>
          <td class="p-3 text-slate-600 font-mono">${s.phone}</td>
          <td class="p-3 text-slate-500">${s.unit_name || '佛光學員'}</td>
          <td class="p-3 text-right">
            <button class="px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded font-semibold text-[11px] mr-1" onclick="resetStudentPassword(${s.id}, '${s.name}')">重設密碼</button>
            <button class="px-2 py-1 bg-red-50 text-red-700 hover:bg-red-100 rounded font-semibold text-[11px]" onclick="deleteStudent(${s.id}, '${s.name}')">刪除</button>
          </td>
        `;
        container.appendChild(tr);
      });
    }
  } catch (err) {
    container.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-red-400">無法讀取名單</td></tr>';
  }
}

window.resetStudentPassword = async function(id, name) {
  if (!confirm(`確定要重設 ${name} 的登入密碼為手機號碼嗎？`)) return;
  try {
    const res = await fetch(`${API_BASE}/admin/students/${id}/reset-password`, {
      method: "PUT",
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    const d = await res.json();
    if (res.ok) showToast(d.message || "密碼已重設", "success");
  } catch (err) {
    showToast("重設失敗", "error");
  }
};

window.deleteStudent = async function(id, name) {
  if (!confirm(`確定要刪除學員 ${name} 嗎？此操作將同時刪除該學員的練習單。`)) return;
  try {
    const res = await fetch(`${API_BASE}/admin/students/${id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    if (res.ok) {
      showToast(`學員 ${name} 已刪除`, "success");
      loadAdminStudents();
    }
  } catch (err) {
    showToast("刪除失敗", "error");
  }
};

window.exportWorksheetsCSV = function() {
  if (!state.token) return;
  window.open(`${API_BASE}/admin/export/csv`, "_blank");
};

// ==============================================================================
// 8. Utilities & Toast Notifications
// ==============================================================================
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  const bgClass = type === "success" ? "bg-emerald-600 text-white" : (type === "error" ? "bg-red-600 text-white" : (type === "warning" ? "bg-amber-600 text-white" : "bg-slate-800 text-white"));

  toast.className = `${bgClass} px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-semibold transition-all transform duration-300 opacity-0 translate-y-2`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : (type === 'error' ? '✕' : 'ℹ')}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove("opacity-0", "translate-y-2");
  }, 10);

  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-y-2");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
