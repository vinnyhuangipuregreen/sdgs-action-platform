// SDGs and Climate Action Platform - Frontend Core v4.0 (Earth Defense Battle)
const API_BASE = "/api";

const state = {
  user: null,
  token: localStorage.getItem("sdgs_token") || null,
  goals: [],
  targets: [],
  currentWorksheetId: null,
  worksheetsList: [],
  activeTab: "worksheet",
  
  // Game: 《SDGs 地球保衛戰》(Whac-A-Mole Style)
  earthDefense: {
    active: false,
    score: 0,
    combo: 0,
    maxCombo: 0,
    monstersHit: 0,
    lives: 3,
    timeLeft: 45,
    timer: null,
    spawnInterval: null,
    activeMoleTimeout: null,
    currentActiveHole: null,
    holesState: Array(9).fill(null), // null or target object
    feverTime: false,
    feverTimer: null
  },

  // Game Settings managed from backend
  gameSettings: {
    game_duration: 45,
    card_speed_ms: 1000,
    monster_pts: 100,
    guardian_penalty: 150,
    bonus_pts: 500,
    initial_lives: 3
  },

  selectedStudentIds: new Set()
};

// Character datasets for 《SDGs 地球保衛戰》
const DEFENSE_CHARACTERS = {
  monsters: [
    { type: "monster", icon: "🛢️", name: "碳排煙囪怪", tag: "SDG 13 氣候危機", pts: 100, color: "#374151" },
    { type: "monster", icon: "🥤", name: "萬年塑膠怪", tag: "SDG 14 海洋垃圾", pts: 100, color: "#0284c7" },
    { type: "monster", icon: "🪓", name: "濫伐推土怪", tag: "SDG 15 森林浩劫", pts: 100, color: "#b45309" },
    { type: "monster", icon: "🏭", name: "毒毒廢水怪", tag: "SDG 6 水源污染", pts: 100, color: "#7c3aed" },
    { type: "monster", icon: "🗑️", name: "浪費剩食怪", tag: "SDG 12 資源浪費", pts: 100, color: "#ea580c" }
  ],
  guardians: [
    { type: "guardian", icon: "🐢", name: "海龜保育寶寶", tag: "保護海洋！不要打", pts: -150, color: "#10b981" },
    { type: "guardian", icon: "🌱", name: "原生小樹苗", tag: "保護陸域！不要打", pts: -150, color: "#22c55e" },
    { type: "guardian", icon: "☀️", name: "太陽能小萌陽", tag: "潔淨能源！不要打", pts: -150, color: "#facc15" },
    { type: "guardian", icon: "💧", name: "純淨水滴精靈", tag: "珍貴水源！不要打", pts: -150, color: "#38bdf8" }
  ],
  bonus: { type: "bonus", icon: "⭐", name: "彩虹永續金星", tag: "FEVER 全場淨化！", pts: 500, color: "#ec4899" }
};

// ==============================================================================

// Game Settings Management (Client & Admin)
async function loadGameSettings() {
  try {
    const res = await fetch(`${API_BASE}/game/settings`);
    if (res.ok) {
      const data = await res.json();
      state.gameSettings = { ...state.gameSettings, ...data };
      updateDefenseRuleTexts();
    }
  } catch (err) {
    console.warn("無法取得遊戲參數，使用預設值", err);
  }
}

function updateDefenseRuleTexts() {
  const s = state.gameSettings;
  const durEl = document.getElementById("defenseRuleDurationText");
  if (durEl) durEl.textContent = s.game_duration;

  const spdEl = document.getElementById("defenseRuleSpeedText");
  if (spdEl) {
    const sec = s.card_speed_ms / 1000;
    spdEl.textContent = (sec % 1 === 0) ? sec.toFixed(0) : sec.toFixed(1);
  }

  const monEl = document.getElementById("defenseRuleMonsterPts");
  if (monEl) monEl.textContent = s.monster_pts;

  const guaEl = document.getElementById("defenseRuleGuardianPts");
  if (guaEl) guaEl.textContent = s.guardian_penalty;

  const bonEl = document.getElementById("defenseRuleBonusPts");
  if (bonEl) bonEl.textContent = s.bonus_pts;

  const timerEl = document.getElementById("defenseTimerVal");
  if (timerEl && !state.earthDefense.active) timerEl.textContent = `${s.game_duration}s`;
}

// 1. Core Initialization
// ==============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  initUIEvents();
  await checkAuth();
  await loadSDGsData();
  await loadGameSettings();
});

function initUIEvents() {
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

  const loginForm = document.getElementById("loginForm");
  if (loginForm) loginForm.addEventListener("submit", handleLogin);

  const adminLoginForm = document.getElementById("adminLoginForm");
  if (adminLoginForm) adminLoginForm.addEventListener("submit", handleAdminLogin);

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

  initWorksheetEvents();

  const sdgSearchInput = document.getElementById("sdgSearchInput");
  if (sdgSearchInput) sdgSearchInput.addEventListener("input", filterSDGsDisplay);

  // Earth Defense Start & Restart buttons explicit event binding
  const startDefenseBtn = document.getElementById("startDefenseGameBtn");
  if (startDefenseBtn) {
    startDefenseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      initNewEarthDefenseGame();
    });
  }
  const restartDefenseBtn = document.getElementById("restartDefenseGameBtn");
  if (restartDefenseBtn) {
    restartDefenseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      initNewEarthDefenseGame();
    });
  }
}

function handleAdminAccess() {
  if (state.user && ['admin', 'teacher'].includes(state.user.role)) {
    switchTab("admin");
  } else {
    const modal = document.getElementById("adminLoginModal");
    if (modal) {
      modal.classList.remove("hidden");
      const acc = document.getElementById("adminAccount");
      const pwd = document.getElementById("adminPassword");
      if (acc) acc.value = "";
      if (pwd) pwd.value = "";
      document.getElementById("adminLoginError")?.classList.add("hidden");
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
  if (tabId === "earth_defense") {
    if (!state.earthDefense.active) {
      const intro = document.getElementById("defenseIntroCard");
      const main = document.getElementById("defenseMainScreen");
      const over = document.getElementById("defenseGameOverScreen");
      if (intro) intro.classList.remove("hidden");
      if (main) main.classList.add("hidden");
      if (over) over.classList.add("hidden");
    }
  }
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

async function handleLogin(e, explicitStudentId = null) {
  if (e) e.preventDefault();
  const account = document.getElementById("loginAccount").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  const errorEl = document.getElementById("loginError");
  const pickerBox = document.getElementById("studentPickerBox");
  errorEl.classList.add("hidden");
  pickerBox.classList.add("hidden");

  try {
    const payload = { account, password };
    if (explicitStudentId) payload.student_id = explicitStudentId;

    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.detail || "登入失敗，請確認帳號密碼";
      errorEl.classList.remove("hidden");
      return;
    }

    if (data.multiple_matches && data.students) {
      pickerBox.classList.remove("hidden");
      const listEl = document.getElementById("studentPickerList");
      listEl.innerHTML = "";
      data.students.forEach(s => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "w-full text-left p-2.5 rounded-xl bg-slate-50 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-400 text-xs font-semibold text-slate-800 flex justify-between items-center transition-colors";
        btn.innerHTML = `
          <span>👤 ${s.name}</span>
          <span class="text-[11px] text-slate-500 font-normal">[${s.unit_code || ''}] ${s.unit_name}</span>
        `;
        btn.onclick = () => handleLogin(null, s.id);
        listEl.appendChild(btn);
      });
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
    document.getElementById("adminAccount").value = "";
    document.getElementById("adminPassword").value = "";
    updateUserUI();
    showToast(`管理員登入成功，歡迎 ${data.user.name}！`, "success");
    switchTab("admin");
  } catch (err) {
    document.getElementById("adminPassword").value = "";
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
    if (formUnit) {
      formUnit.value = state.user.unit_name || "佛光學員";
    }
  }
}

// ==============================================================================
// 3. SDGs Reference & Smart Quote Module
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

window.quoteTargetToWorksheet = function(goalText, targetText) {
  const radialRows = document.querySelectorAll(".radial-line-row");
  const normGoal = goalText.split(" ")[0].trim();
  const normMech = targetText.trim();

  // 1. Check duplicate
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

  // 2. Empty slot check
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

  // 3. Auto add new line
  if (!targetRow) {
    addRadialLineRow();
    const updatedRows = document.querySelectorAll(".radial-line-row");
    targetRow = updatedRows[updatedRows.length - 1];
    targetIndex = updatedRows.length;
  }

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
// 4. Worksheet Module (CRUD)
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
// 5. 《SDGs 地球保衛戰》遊戲引擎 (Whac-A-Mole 綠色永續打地鼠)
// ==============================================================================
function initNewEarthDefenseGame() {
  try {
    const g = state.earthDefense;
    g.active = true;
    g.score = 0;
    g.combo = 0;
    g.maxCombo = 0;
    g.monstersHit = 0;
    g.lives = state.gameSettings.initial_lives || 3;
    g.timeLeft = state.gameSettings.game_duration || 45;
    g.feverTime = false;
    g.holesState = Array(9).fill(null);
    g.currentActiveHole = null;

    clearInterval(g.timer);
    clearInterval(g.spawnInterval);
    clearTimeout(g.feverTimer);
    clearTimeout(g.activeMoleTimeout);

    const introCard = document.getElementById("defenseIntroCard");
    const mainScreen = document.getElementById("defenseMainScreen");
    const gameOverScreen = document.getElementById("defenseGameOverScreen");

    if (introCard) introCard.classList.add("hidden");
    if (mainScreen) mainScreen.classList.remove("hidden");
    if (gameOverScreen) gameOverScreen.classList.add("hidden");

    renderDefenseGrid();
    updateDefenseHUD();

    // Start countdown timer
    g.timer = setInterval(() => {
      g.timeLeft -= 1;
      updateDefenseHUD();
      if (g.timeLeft <= 0) {
        endEarthDefenseGame();
      }
    }, 1000);

    // Start spawning loop (1 秒鐘閃過一張卡)
    startMoleSpawning();
    showToast(`🥊 《SDGs 地球保衛戰》啟動！${g.timeLeft}秒全力擊退環境破壞怪！`, "success");
  } catch (err) {
    console.error("啟動地球保衛戰失敗：", err);
    alert("啟動遊戲時發生錯誤：" + err.message);
  }
}

function showDefenseIntroCard() {
  const g = state.earthDefense;
  g.active = false;
  clearInterval(g.timer);
  clearInterval(g.spawnInterval);
  clearTimeout(g.feverTimer);
  clearTimeout(g.activeMoleTimeout);

  const introCard = document.getElementById("defenseIntroCard");
  const mainScreen = document.getElementById("defenseMainScreen");
  const gameOverScreen = document.getElementById("defenseGameOverScreen");

  if (introCard) introCard.classList.remove("hidden");
  if (mainScreen) mainScreen.classList.add("hidden");
  if (gameOverScreen) gameOverScreen.classList.add("hidden");
  updateDefenseRuleTexts();
}

window.initNewEarthDefenseGame = initNewEarthDefenseGame;
window.startEarthDefenseGame = initNewEarthDefenseGame;
window.showDefenseIntroCard = showDefenseIntroCard;

function renderDefenseGrid() {
  const container = document.getElementById("defenseGridContainer");
  if (!container) return;
  container.innerHTML = "";

  for (let i = 0; i < 9; i++) {
    const hole = document.createElement("div");
    hole.className = "hole-container w-24 h-28 sm:w-28 sm:h-36 flex items-center justify-center relative select-none cursor-pointer";
    hole.id = `hole_${i}`;
    hole.innerHTML = `
      <div class="hole-rim"></div>
      <div id="target_${i}" class="mole-target" onclick="hitMoleTarget(${i}, event)"></div>
    `;
    hole.addEventListener("click", (e) => {
      hitMoleTarget(i, e);
    });
    container.appendChild(hole);
  }
}

function startMoleSpawning() {
  const g = state.earthDefense;
  clearInterval(g.spawnInterval);
  clearTimeout(g.activeMoleTimeout);

  // 清除現有洞穴狀態
  for (let i = 0; i < 9; i++) {
    const el = document.getElementById(`target_${i}`);
    if (el) {
      el.classList.remove("up", "hit");
      el.innerHTML = "";
    }
  }
  g.holesState = Array(9).fill(null);
  g.currentActiveHole = null;

  // 每張卡片閃過速度 (毫秒，預設 1000ms = 1秒鐘閃過一張卡)
  const speedMs = state.gameSettings.card_speed_ms || 1000;

  // 立即閃出第一張卡片
  spawnSingleMole();

  // 依照設定的速度 (1秒鐘) 定期閃過下一張卡
  g.spawnInterval = setInterval(() => {
    if (!g.active) return;
    spawnSingleMole();
  }, speedMs);
}

function spawnSingleMole() {
  const g = state.earthDefense;
  if (!g.active) return;

  const speedMs = state.gameSettings.card_speed_ms || 1000;

  // 若場上有上一張未被擊中的卡片，先平順收回
  if (g.currentActiveHole !== null && g.currentActiveHole !== undefined) {
    const prevIdx = g.currentActiveHole;
    const prevEl = document.getElementById(`target_${prevIdx}`);
    if (prevEl) {
      prevEl.classList.remove("up");
    }
    g.holesState[prevIdx] = null;
    g.currentActiveHole = null;
  }

  // 隨機選取 9 個洞穴中的 1 個 (保證單張卡片閃現，不重疊干擾)
  const holeIdx = Math.floor(Math.random() * 9);
  g.currentActiveHole = holeIdx;

  // 決定卡片角色：70% 危機破壞怪、20% 永續守護精靈、10% 彩虹金星
  let char = null;
  const rand = Math.random();
  if (rand < 0.70) {
    char = DEFENSE_CHARACTERS.monsters[Math.floor(Math.random() * DEFENSE_CHARACTERS.monsters.length)];
    char = { ...char, pts: state.gameSettings.monster_pts || 100 };
  } else if (rand < 0.90) {
    char = DEFENSE_CHARACTERS.guardians[Math.floor(Math.random() * DEFENSE_CHARACTERS.guardians.length)];
    char = { ...char, pts: -(state.gameSettings.guardian_penalty || 150) };
  } else {
    char = { ...DEFENSE_CHARACTERS.bonus, pts: state.gameSettings.bonus_pts || 500 };
  }

  g.holesState[holeIdx] = { ...char, id: Date.now() + Math.random(), hit: false };

  const targetEl = document.getElementById(`target_${holeIdx}`);
  if (!targetEl) return;

  targetEl.innerHTML = `
    <div class="text-3xl sm:text-4xl filter drop-shadow-md transform active:scale-90 transition-transform select-none">${char.icon}</div>
    <span class="text-[10px] font-black px-1.5 py-0.5 rounded-full mt-1 text-white shadow select-none" style="background-color: ${char.color}">
      ${char.name}
    </span>
    <span class="text-[9px] opacity-80 text-white block mt-0.5 font-bold select-none">${char.tag}</span>
  `;
  targetEl.classList.remove("hit");
  targetEl.classList.add("up");

  // 卡片停留時間：剛好在下一張出現前微幅縮回，節奏分明
  clearTimeout(g.activeMoleTimeout);
  g.activeMoleTimeout = setTimeout(() => {
    if (g.holesState[holeIdx] && !g.holesState[holeIdx].hit) {
      targetEl.classList.remove("up");
      g.holesState[holeIdx] = null;
      if (g.currentActiveHole === holeIdx) {
        g.currentActiveHole = null;
      }
    }
  }, Math.max(200, speedMs - 80));
}

window.hitMoleTarget = function(holeIdx, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const g = state.earthDefense;
  if (!g.active) return;
  const target = g.holesState[holeIdx];
  if (!target || target.hit) return;

  target.hit = true;
  const targetEl = document.getElementById(`target_${holeIdx}`);
  const holeContainer = document.getElementById(`hole_${holeIdx}`);

  // 浮動得分文字動態效果
  const floatEl = document.createElement("div");
  floatEl.className = "score-float text-xs sm:text-sm select-none pointer-events-none";
  floatEl.style.left = "50%";
  floatEl.style.top = "30%";

  if (target.type === "monster") {
    // 成功擊退環境危機破壞怪！
    g.combo += 1;
    if (g.combo > g.maxCombo) g.maxCombo = g.combo;
    g.monstersHit += 1;

    let mult = 1.0;
    if (g.combo >= 10) mult = 2.5;
    else if (g.combo >= 5) mult = 2.0;
    else if (g.combo >= 3) mult = 1.5;

    const basePts = state.gameSettings.monster_pts || 100;
    const gained = Math.round(basePts * mult);
    g.score += gained;

    floatEl.innerHTML = `<span class="text-emerald-400 font-black">+${gained} 🍃</span>`;
    if (g.combo > 1) floatEl.innerHTML += `<span class="block text-[10px] text-amber-300 font-bold">${g.combo} COMBO!</span>`;

    // 擊中動畫
    targetEl.classList.add("hit");
    const iconEl = targetEl.querySelector("div");
    if (iconEl) iconEl.textContent = "😵";
    setTimeout(() => {
      targetEl.classList.remove("up");
      g.holesState[holeIdx] = null;
      if (g.currentActiveHole === holeIdx) g.currentActiveHole = null;
    }, 200);

  } else if (target.type === "guardian") {
    // 誤擊永續守護精靈！懲罰扣分並扣心
    g.combo = 0;
    g.lives -= 1;
    const penalty = state.gameSettings.guardian_penalty || 150;
    g.score = Math.max(0, g.score - penalty);

    floatEl.innerHTML = `<span class="text-red-400 font-black">-${penalty} 💔 誤傷！</span>`;
    
    // 震動畫面
    const arena = document.getElementById("defenseMainScreen");
    if (arena) {
      arena.classList.add("shake");
      setTimeout(() => arena.classList.remove("shake"), 300);
    }

    targetEl.classList.remove("up");
    g.holesState[holeIdx] = null;
    if (g.currentActiveHole === holeIdx) g.currentActiveHole = null;

    if (g.lives <= 0) {
      endEarthDefenseGame();
    }
  } else if (target.type === "bonus") {
    // 敲中彩虹永續金星！FEVER TIME！
    const bonus = state.gameSettings.bonus_pts || 500;
    g.score += bonus;
    floatEl.innerHTML = `<span class="text-pink-400 font-black">+${bonus} ⭐ FEVER!</span>`;
    triggerFeverTime();
    targetEl.classList.remove("up");
    g.holesState[holeIdx] = null;
    if (g.currentActiveHole === holeIdx) g.currentActiveHole = null;
  }

  if (holeContainer) {
    holeContainer.appendChild(floatEl);
    setTimeout(() => floatEl.remove(), 800);
  }
  updateDefenseHUD();
};

function triggerFeverTime() {
  const g = state.earthDefense;
  g.feverTime = true;
  showToast("🌈 觸發 FEVER TIME！全場危機怪獸秒速淨化！", "success");
  
  // 清場現有怪獸獲得加分
  for (let i = 0; i < 9; i++) {
    if (g.holesState[i] && g.holesState[i].type === "monster") {
      hitMoleTarget(i, null);
    }
  }

  clearTimeout(g.feverTimer);
  g.feverTimer = setTimeout(() => {
    g.feverTime = false;
  }, 4000);
}

function updateDefenseHUD() {
  const g = state.earthDefense;
  document.getElementById("defenseScoreVal").textContent = g.score.toLocaleString();
  document.getElementById("defenseComboVal").textContent = `${g.combo}x`;
  document.getElementById("defenseTimerVal").textContent = `${g.timeLeft}s`;

  // Hearts UI 依據後台設定的起始愛心數動態顯示
  const heartsEl = document.getElementById("defenseHeartsVal");
  if (heartsEl) {
    const totalLives = state.gameSettings.initial_lives || 3;
    heartsEl.innerHTML = "❤️".repeat(Math.max(0, g.lives)) + "🖤".repeat(Math.max(0, totalLives - g.lives));
  }
}

function endEarthDefenseGame() {
  const g = state.earthDefense;
  g.active = false;
  clearInterval(g.timer);
  clearInterval(g.spawnInterval);
  clearTimeout(g.feverTimer);
  clearTimeout(g.activeMoleTimeout);

  // 隱藏全部洞穴目標
  for (let i = 0; i < 9; i++) {
    const el = document.getElementById(`target_${i}`);
    if (el) el.classList.remove("up", "hit");
  }

  document.getElementById("defenseMainScreen").classList.add("hidden");
  document.getElementById("defenseGameOverScreen").classList.remove("hidden");

  document.getElementById("finalDefenseScore").textContent = g.score.toLocaleString();
  document.getElementById("finalDefenseCombo").textContent = `${g.maxCombo} 連擊`;
  document.getElementById("finalDefenseMonsters").textContent = `${g.monstersHit} 隻`;

  let title = "🌱 綠野見習巡邏員";
  if (g.score >= 8000) title = "🌌 綠野傳奇守護神";
  else if (g.score >= 5000) title = "🌟 星級永續特警隊";
  else if (g.score >= 3000) title = "🌿 森林生態保衛者";

  document.getElementById("finalDefenseTitle").textContent = title;

  document.getElementById("submitDefenseLeaderboardBtn").onclick = () => {
    submitGameScoreToBackend(g.score, g.maxCombo, 100, g.monstersHit, title, "earth_defense");
  };
}

async function submitGameScoreToBackend(score, combo, health, solved, title, gameType) {
  if (!state.token) {
    showToast("請先登入後方可登錄保衛英雄榜！", "warning");
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
      showToast(data.message || "成績已成功登錄保衛英雄榜！", "success");
      switchTab("leaderboard");
    }
  } catch (err) {
    showToast("登錄失敗，請重試", "error");
  }
}


async function loadAdminGameSettings() {
  await loadGameSettings();
  const s = state.gameSettings;
  const dEl = document.getElementById("setting_game_duration");
  if (dEl) dEl.value = s.game_duration || 45;

  const spdEl = document.getElementById("setting_card_speed_ms");
  if (spdEl) spdEl.value = s.card_speed_ms || 1000;

  const lEl = document.getElementById("setting_initial_lives");
  if (lEl) lEl.value = s.initial_lives || 3;

  const mEl = document.getElementById("setting_monster_pts");
  if (mEl) mEl.value = s.monster_pts || 100;

  const gEl = document.getElementById("setting_guardian_penalty");
  if (gEl) gEl.value = s.guardian_penalty || 150;

  const bEl = document.getElementById("setting_bonus_pts");
  if (bEl) bEl.value = s.bonus_pts || 500;
}

async function saveAdminGameSettings() {
  if (!state.token) {
    showToast("需要管理員權限", "error");
    return;
  }
  const payload = {
    game_duration: parseInt(document.getElementById("setting_game_duration")?.value) || 45,
    card_speed_ms: parseInt(document.getElementById("setting_card_speed_ms")?.value) || 1000,
    initial_lives: parseInt(document.getElementById("setting_initial_lives")?.value) || 3,
    monster_pts: parseInt(document.getElementById("setting_monster_pts")?.value) || 100,
    guardian_penalty: parseInt(document.getElementById("setting_guardian_penalty")?.value) || 150,
    bonus_pts: parseInt(document.getElementById("setting_bonus_pts")?.value) || 500
  };

  try {
    const res = await fetch(`${API_BASE}/admin/game/settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      state.gameSettings = { ...state.gameSettings, ...(data.settings || payload) };
      updateDefenseRuleTexts();
      showToast("✓ 《SDGs 地球保衛戰》遊戲參數已成功更新並即時生效！", "success");
    } else {
      showToast(data.detail || "更新失敗", "error");
    }
  } catch (err) {
    showToast("連線異常，儲存設定失敗", "error");
  }
}

function resetAdminGameSettingsToDefault() {
  const dEl = document.getElementById("setting_game_duration");
  if (dEl) dEl.value = 45;
  const spdEl = document.getElementById("setting_card_speed_ms");
  if (spdEl) spdEl.value = 1000;
  const lEl = document.getElementById("setting_initial_lives");
  if (lEl) lEl.value = 3;
  const mEl = document.getElementById("setting_monster_pts");
  if (mEl) mEl.value = 100;
  const gEl = document.getElementById("setting_guardian_penalty");
  if (gEl) gEl.value = 150;
  const bEl = document.getElementById("setting_bonus_pts");
  if (bEl) bEl.value = 500;
  showToast("已載入推薦預設參數（1秒閃過一張卡），請點擊「儲存遊戲設定」生效！", "info");
}

window.loadAdminGameSettings = loadAdminGameSettings;
window.saveAdminGameSettings = saveAdminGameSettings;
window.resetAdminGameSettingsToDefault = resetAdminGameSettingsToDefault;

// ==============================================================================
// 6. Leaderboard Module (Updated for 《SDGs 地球保衛戰》)
// ==============================================================================
async function loadLeaderboard() {
  const container = document.getElementById("leaderboardTableBody");
  if (!container) return;
  container.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">保衛英雄榜載入中...</td></tr>';

  try {
    const res = await fetch(`${API_BASE}/game/leaderboard`);
    if (res.ok) {
      const data = await res.json();
      renderLeaderboardTable(data.leaderboard, data.my_best);
    }
  } catch (err) {
    container.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-red-400">無法讀取排行榜</td></tr>';
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
    container.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">目前尚無戰績，成為第一位上榜者吧！</td></tr>';
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
      <td class="p-3 text-center"><span class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-extrabold">🥊 地球保衛戰</span></td>
      <td class="p-3 text-right font-mono font-black text-emerald-600">${item.score.toLocaleString()}</td>
      <td class="p-3 text-center font-mono text-slate-600">${item.max_combo}x</td>
      <td class="p-3 text-center"><span class="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">${item.title_earned}</span></td>
      <td class="p-3 text-right text-xs text-slate-400">${new Date(item.played_at).toLocaleDateString('zh-TW')}</td>
    `;
    container.appendChild(tr);
  });
}

// ==============================================================================
// 7. Admin Dashboard & Review Module
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
    loadAdminGameSettings();
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

    const radialHtml = (ws.radial_data || []).map((r, i) => `
      <tr class="border-b border-slate-100">
        <td class="p-2 font-bold text-emerald-800">#${i+1} ${r.goal || ''}</td>
        <td class="p-2 text-slate-700">${r.mechanism || ''}</td>
        <td class="p-2 text-slate-600">${r.observable || ''}</td>
      </tr>
    `).join("");

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
      showToast(`✓ 批閱完成！已記錄 ${score} 分，並發送指導通知信至學員信箱 (${d.email_target})！`, "success");
      loadAdminWorksheets();
    }
  } catch (err) {
    showToast("批閱失敗", "error");
  }
}

// ==============================================================================
// 8. Student Management (6-column CRUD, Batch Delete, Import & Export)
// ==============================================================================
async function loadAdminStudents(search = "") {
  const container = document.getElementById("adminStudentsTableBody");
  if (!container) return;
  container.innerHTML = '<tr><td colspan="9" class="p-6 text-center text-slate-400">載入學員名單...</td></tr>';
  state.selectedStudentIds.clear();
  updateSelectedCountUI();

  try {
    const url = search ? `${API_BASE}/admin/students?search=${encodeURIComponent(search)}&limit=300` : `${API_BASE}/admin/students?limit=150`;
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
          <td class="p-3 text-slate-600 font-mono">${s.email}</td>
          <td class="p-3 text-slate-500 font-mono">${s.email_backup || '-'}</td>
          <td class="p-3 text-slate-600 font-mono">${s.phone}</td>
          <td class="p-3 font-mono text-slate-600 font-bold">${s.unit_code || '-'}</td>
          <td class="p-3 text-slate-700 font-medium">${s.unit_name || '佛光學員'}</td>
          <td class="p-3 text-right space-x-1">
            <button class="px-2 py-1 bg-amber-50 text-amber-800 hover:bg-amber-100 rounded font-semibold text-[11px]" 
              onclick="openEditStudentModal(${s.id}, '${s.name}', '${s.email}', '${s.email_backup || ''}', '${s.phone}', '${s.unit_code || ''}', '${s.unit_name || '佛光學員'}', '${s.role}')">
              修改
            </button>
            ${s.role !== 'admin' ? `
            <button class="px-2 py-1 bg-red-50 text-red-700 hover:bg-red-100 rounded font-semibold text-[11px]" 
              onclick="deleteSingleStudent(${s.id}, '${s.name}')">
              刪除
            </button>` : ''}
          </td>
        `;
        container.appendChild(tr);
      });
    }
  } catch (err) {
    container.innerHTML = '<tr><td colspan="9" class="p-6 text-center text-red-400">無法讀取名單</td></tr>';
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

window.openAddStudentModal = function() {
  document.getElementById("addStudentModal")?.classList.remove("hidden");
};

window.saveNewStudent = async function() {
  const name = document.getElementById("addStudentName").value.trim();
  const email = document.getElementById("addStudentEmail").value.trim();
  const email_backup = document.getElementById("addStudentEmailBackup").value.trim();
  const phone = document.getElementById("addStudentPhone").value.trim();
  const unit_code = document.getElementById("addStudentUnitCode").value.trim();
  const unit_name = document.getElementById("addStudentUnitName").value.trim();
  const password = document.getElementById("addStudentPassword").value.trim();

  if (!name || !email || !phone) {
    showToast("學員姓名、Email與電話為必填欄位！", "error");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/students`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`
      },
      body: JSON.stringify({ name, email, email_backup, phone, unit_code, unit_name, password })
    });
    const d = await res.json();
    if (res.ok) {
      showToast(d.message || "學員新增成功！", "success");
      document.getElementById("addStudentModal").classList.add("hidden");
      loadAdminStudents();
    } else {
      showToast(d.detail || "新增失敗", "error");
    }
  } catch (err) {
    showToast("連線異常", "error");
  }
};

window.openEditStudentModal = function(id, name, email, email_backup, phone, unit_code, unit_name, role) {
  const modal = document.getElementById("editStudentModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  document.getElementById("editStudentId").value = id;
  document.getElementById("editStudentName").value = name;
  document.getElementById("editStudentEmail").value = email;
  document.getElementById("editStudentEmailBackup").value = email_backup || "";
  document.getElementById("editStudentPhone").value = phone;
  document.getElementById("editStudentUnitCode").value = unit_code || "";
  document.getElementById("editStudentUnitName").value = unit_name || "";
  document.getElementById("editStudentPassword").value = "";
};

window.saveStudentEdit = async function() {
  const id = document.getElementById("editStudentId").value;
  const name = document.getElementById("editStudentName").value.trim();
  const email = document.getElementById("editStudentEmail").value.trim();
  const email_backup = document.getElementById("editStudentEmailBackup").value.trim();
  const phone = document.getElementById("editStudentPhone").value.trim();
  const unit_code = document.getElementById("editStudentUnitCode").value.trim();
  const unit_name = document.getElementById("editStudentUnitName").value.trim();
  const password = document.getElementById("editStudentPassword").value.trim();

  if (!name || !email || !phone) {
    showToast("姓名、Email與電話為必填欄位", "error");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/students/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`
      },
      body: JSON.stringify({ name, email, email_backup, phone, unit_code, unit_name, password })
    });
    const d = await res.json();
    if (res.ok) {
      showToast(d.message || "學員資料更新成功！", "success");
      document.getElementById("editStudentModal").classList.add("hidden");
      loadAdminStudents();
    } else {
      showToast("更新失敗", "error");
    }
  } catch (err) {
    showToast("更新失敗", "error");
  }
};

window.deleteSingleStudent = async function(id, name) {
  if (!confirm(`確定要刪除學員 ${name} 嗎？此操作將同時刪除該學員的練習單。`)) return;
  try {
    const res = await fetch(`${API_BASE}/admin/students/${id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    if (res.ok) {
      showToast(`學員 ${name} 已成功刪除！`, "success");
      loadAdminStudents();
    }
  } catch (err) {
    showToast("刪除失敗", "error");
  }
};

window.executeBatchDeleteStudents = async function() {
  const ids = Array.from(state.selectedStudentIds);
  if (ids.length === 0) return;
  if (!confirm(`確定要批次刪除選取的 ${ids.length} 位學員嗎？此操作無法復原。`)) return;

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

  function parseCSVLine(line) {
    const parts = line.split(",").map(p => p.trim());
    if (parts.length >= 2 && parts[0] && parts[1] && parts[0] !== "學員姓名") {
      return {
        name: parts[0],
        email: parts[1],
        email_backup: parts[2] || "",
        phone: parts[3] || "0920111111",
        unit_code: parts[4] || "",
        unit_name: parts[5] || parts[4] || "佛光學員"
      };
    }
    return null;
  }

  if (textVal) {
    const lines = textVal.split("\n");
    for (let l of lines) {
      const s = parseCSVLine(l);
      if (s) parsedStudents.push(s);
    }
  }

  if (fileInput.files.length > 0) {
    const file = fileInput.files[0];
    const text = await file.text();
    const rows = text.split("\n");
    for (let r of rows) {
      const s = parseCSVLine(r);
      if (s) parsedStudents.push(s);
    }
  }

  if (parsedStudents.length === 0) {
    showToast("未偵測到有效名冊資料，請確認格式（學員姓名, Email, 補課Email, 電話, 分會編號, 分會名稱）", "error");
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

window.exportStudentsCSV = function() {
  if (!state.token) return;
  window.open(`${API_BASE}/admin/students/export-csv`, "_blank");
};

window.exportWorksheetsCSV = function() {
  if (!state.token) return;
  window.open(`${API_BASE}/admin/export/csv`, "_blank");
};

// ==============================================================================
// 9. Utilities & Toast Notifications
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
