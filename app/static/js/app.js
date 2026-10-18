// SDGs and Climate Action Platform - Frontend Core v4.0 (Earth Defense Battle)
const API_BASE = "/api";

const state = {
  user: null,
  token: localStorage.getItem("sdgs_token") || null,
  goals: [],
  targets: [],
  currentWorksheetId: null,
  worksheetsList: [],
  activeTab: "home",
  
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

  selectedStudentIds: new Set(),
  studentPage: 1,
  studentSearch: "",
  studentTotalPages: 1,
  studentRequestId: 0,
  selectedStaffIds: new Set(),
  activeAdminSubTab: "dashboard",
  centerActions: [],
  lastAdminStats: null
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
  const initialTab = location.hash.slice(1);
  const adminEntry = ["admin", "admin-matching", "admin-attendance"].includes(initialTab);
  const publicTabs = ["home", "worksheet", "carbon", "food", "sdgs", "earth_defense", "leaderboard"];
  switchTab(publicTabs.includes(initialTab) ? initialTab : "home");
  if (resumeCourseSignIn()) return;
  await checkAuth(false);
  if (!adminEntry) {
    await loadCenterActions();
    if (state.user?.role === "student") await loadMyWorksheets(true);
  }
  if (new URLSearchParams(location.search).get("sso_logout") === "1") {
    handleLogout();
    history.replaceState(null, "", "/");
  }
  if (resumeCourseSignIn()) return;
  if (adminEntry) {
    handleAdminAccess();
    if (initialTab === "admin" && state.user && ["admin", "teacher"].includes(state.user.role)) switchAdminSubTab("dashboard");
    if (initialTab === "admin-matching" && state.user && ["admin", "teacher"].includes(state.user.role)) switchAdminSubTab("matching");
    if (initialTab === "admin-attendance" && state.user && ["admin", "teacher"].includes(state.user.role)) switchAdminSubTab("attendance");
  }
  if (adminEntry) await loadCenterActions();
  await loadSDGsData();
  await loadGameSettings();
});

function initUIEvents() {
  window.addEventListener("message", event => {
    const frame = document.getElementById("matchingAdminFrame");
    if (event.origin === location.origin && event.source === frame?.contentWindow && event.data?.type === "sdgs-admin-expired") handleLogout();
    const attendanceFrame = document.getElementById("attendanceAdminFrame");
    if (event.origin === location.origin && event.source === attendanceFrame?.contentWindow && event.data?.type === "attendance-admin-expired") handleLogout();
  });
  document.querySelectorAll("[data-open-tab]").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.openTab));
  });
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
  initCategoryAdminEvents();

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
  showLoginModal(false);
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
  if (tabId === "worksheet" && state.user?.account_type !== "student" && state.user?.role !== "student") {
    state.studentDestination = "worksheet";
    if (!state.token || state.user) showLoginModal(true);
    return;
  }
  state.activeTab = tabId;
  document.getElementById("worksheetTools")?.classList.toggle("hidden", tabId !== "worksheet");
  document.querySelectorAll(".tab-pane").forEach(el => el.classList.add("hidden"));
  document.querySelectorAll("[data-nav-tab]").forEach(el => {
    el.removeAttribute("aria-current");
    el.classList.remove("text-emerald-700", "bg-emerald-50", "border-b-2", "border-emerald-600");
    el.classList.add("text-slate-600");
  });

  const targetPane = document.getElementById(`tabPane_${tabId}`);
  const targetTabBtn = document.querySelector(`[data-nav-tab="${tabId}"]`);

  if (targetPane) targetPane.classList.remove("hidden");
  if (targetTabBtn) {
    targetTabBtn.setAttribute("aria-current", "page");
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
async function checkAuth(loadWorksheets = true) {
  if (!state.token) {
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
      if (state.studentDestination === "worksheet") switchTab("worksheet");
      if (loadWorksheets && state.user.role === "student") await loadMyWorksheets(true);
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
    const payload = { account, password, account_type: "student" };
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

    if (state.token) await fetch(`${API_BASE}/auth/logout`, {method: "POST", headers: {Authorization: `Bearer ${state.token}`}}).catch(() => {});
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("sdgs_token", data.token);
    showLoginModal(false);
    updateUserUI();
    showToast(`歡迎回來，${data.user.name}！`, "success");
    if (resumeCourseSignIn()) return;
    if (state.studentDestination === "worksheet") {
      state.studentDestination = null;
      switchTab("worksheet");
    }
    // 切換或登入新帳號時，自動載入該帳號之表單資料
    await loadMyWorksheets(true);
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
      body: JSON.stringify({ account, password, account_type: "staff" })
    });
    const data = await res.json();
    if (!res.ok || !['admin', 'teacher'].includes(data.user?.role)) {
      errEl.textContent = data.detail || "管理員驗證失敗，需要管理權限";
      errEl.classList.remove("hidden");
      return;
    }
    if (state.token) await fetch(`${API_BASE}/auth/logout`, {method: "POST", headers: {Authorization: `Bearer ${state.token}`}}).catch(() => {});
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("sdgs_token", data.token);
    document.getElementById("adminLoginModal").classList.add("hidden");
    document.getElementById("adminAccount").value = "";
    document.getElementById("adminPassword").value = "";
    updateUserUI();
    showToast(`管理員登入成功，歡迎 ${data.user.name}！`, "success");
    if (resumeCourseSignIn()) return;
    switchTab("admin");
    if (location.hash === "#admin-matching") switchAdminSubTab("matching");
    if (location.hash === "#admin-attendance") switchAdminSubTab("attendance");
  } catch (err) {
    document.getElementById("adminPassword").value = "";
    errEl.textContent = "連線異常，請重試";
    errEl.classList.remove("hidden");
  }
}

function handleLogout() {
  const attendanceFrame = document.getElementById("attendanceAdminFrame");
  if (attendanceFrame) { attendanceFrame.removeAttribute("srcdoc"); attendanceFrame.src = "about:blank"; attendanceFrame.classList.add("hidden"); }
  state.attendanceAdminSession = null;
  if (state.token) fetch(`${API_BASE}/auth/logout`, {method: "POST", headers: {Authorization: `Bearer ${state.token}`}, keepalive: true}).catch(() => {});
  state.token = null;
  state.user = null;
  state.currentWorksheetId = null;
  state.worksheetsList = [];
  localStorage.removeItem("sdgs_token");
  // 清空前台練習單所有欄位，防止前一位使用者的資料殘留
  createNewWorksheet(false);
  const nameEl = document.getElementById("ws_userName");
  if (nameEl) nameEl.value = "";
  const unitEl = document.getElementById("ws_unitName");
  if (unitEl) unitEl.value = "";

  showLoginModal(true);
  updateUserUI();
  state.studentDestination = "worksheet";
  switchTab("home");
}

function closeStudentLogin() {
  showLoginModal(false);
  state.studentDestination = null;
  if (location.pathname === "/sso/authorize" || new URLSearchParams(location.search).has("sso_return")) {
    location.replace("/");
    return;
  }
  switchTab("home");
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
        ? "text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold"
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
                <span class="text-[10px] px-1.5 py-0.5 rounded ${t.target_type === '成果目標' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}">${t.target_type}</span>
              </div>
              <p class="text-slate-600 text-[11px] leading-relaxed mb-2">${t.content}</p>
              <button type="button" class="w-full py-1 text-center bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 rounded font-medium text-[11px] transition-colors"
                onclick="quoteTargetToWorksheet('${goal.code}', '${goal.name}', '${t.code}', '${escapedContent}')">
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

window.quoteTargetToWorksheet = function(goalCode, goalName, targetCode, targetContent) {
  // 兼顧舊版呼叫相容性 (如果只傳 2 個參數)
  let targetGoalCode = goalCode;
  let targetGoalName = goalName;
  let formattedTargetText = "";
  let rawTargetCode = targetCode || "";

  if (arguments.length === 2) {
    // 舊版格式: goalText ('SDG 1 消除貧窮'), targetText ('1.1：到2030年以前...')
    const fullGoalText = (goalCode || "").trim();
    formattedTargetText = (goalName || "").trim();
    const parts = fullGoalText.split(" ");
    targetGoalCode = parts[0] || ""; // 'SDG' 或 'SDG 1'
    if (parts.length >= 3) {
      targetGoalCode = `${parts[0]} ${parts[1]}`;
      targetGoalName = parts.slice(2).join(" ");
    } else if (parts.length === 2) {
      targetGoalCode = parts[0];
      targetGoalName = parts[1];
    }
    const matchCode = formattedTargetText.match(/^([0-9]{1,2}\.[0-9a-zA-Z]+)/);
    if (matchCode) rawTargetCode = matchCode[1];
  } else {
    // 新版格式: goalCode ('SDG 1'), goalName ('消除貧窮'), targetCode ('1.1'), targetContent ('到2030年以前...')
    formattedTargetText = `${targetCode}：${targetContent}`;
  }

  // 標準目標文字，例如 "SDG 1 消除貧窮"
  const expectedGoalString = `${targetGoalCode} ${targetGoalName}`.trim();

  const radialRows = document.querySelectorAll(".radial-line-row");

  // 1. 防呆檢查：檢查是否已引用過相同的細項或目標
  for (let idx = 0; idx < radialRows.length; idx++) {
    const r = radialRows[idx];
    const rGoal = (r.querySelector(".radial-goal-select")?.value || "").trim();
    const rMech = (r.querySelector(".radial-mech-input")?.value || "").trim();
    const lineNumber = idx + 1;

    const isSameGoal = rGoal === expectedGoalString || (targetGoalCode && rGoal.startsWith(targetGoalCode + " "));
    const isSameTarget = rawTargetCode ? rMech.includes(rawTargetCode) : (rMech === formattedTargetText);

    if (isSameGoal && isSameTarget) {
      switchTab("worksheet");
      r.scrollIntoView({ behavior: 'smooth', block: 'center' });
      r.classList.add("ring-2", "ring-emerald-500");
      setTimeout(() => r.classList.remove("ring-2", "ring-emerald-500"), 3000);
      alert(`您已經將「${rawTargetCode || expectedGoalString}」設定在[連動線#${lineNumber}]中！`);
      return;
    }
  }

  // 2. 尋找尚未選擇「連動目標 (SDG)」的連動線欄位
  let targetRow = null;
  let targetIndex = -1;
  for (let idx = 0; idx < radialRows.length; idx++) {
    const r = radialRows[idx];
    const rGoal = (r.querySelector(".radial-goal-select")?.value || "").trim();
    if (!rGoal) {
      targetRow = r;
      targetIndex = idx + 1;
      break;
    }
  }

  // 3. 若現有連動線都已選擇目標，則自動增加一條新的連動線
  if (!targetRow) {
    addRadialLineRow();
    const updatedRows = document.querySelectorAll(".radial-line-row");
    targetRow = updatedRows[updatedRows.length - 1];
    targetIndex = updatedRows.length;
  }

  const goalSelect = targetRow.querySelector(".radial-goal-select");
  const mechInput = targetRow.querySelector(".radial-mech-input");

  // 4. 精確自動選擇對應的連動目標 (SDG)，例如 "SDG 1 消除貧窮"
  if (goalSelect) {
    let matchedOptionValue = "";
    for (let opt of goalSelect.options) {
      if (!opt.value) continue;
      // 優先 1: 完全一致
      if (opt.value === expectedGoalString) {
        matchedOptionValue = opt.value;
        break;
      }
      // 優先 2: 以 "SDG 1 " 或 "SDG 14 " 開頭 (精確匹配目標編號，避免 SDG 1 誤匹配 SDG 10~17)
      if (targetGoalCode && (opt.value.startsWith(targetGoalCode + " ") || opt.value.startsWith(targetGoalCode + "("))) {
        matchedOptionValue = opt.value;
        break;
      }
      // 優先 3: 目標名稱一致
      if (targetGoalName && opt.value.includes(targetGoalName)) {
        matchedOptionValue = opt.value;
        break;
      }
    }

    if (matchedOptionValue) {
      goalSelect.value = matchedOptionValue;
    } else {
      // 容錯防呆：若 option value 找不到，比對 textContent
      for (let opt of goalSelect.options) {
        if (targetGoalCode && (opt.textContent.startsWith(targetGoalCode + " ") || opt.textContent.includes(targetGoalCode + " "))) {
          goalSelect.value = opt.value;
          break;
        }
      }
    }
    goalSelect.dispatchEvent(new Event("change"));
  }

  // 5. 填寫細項目標資料到 [怎麼影響？(作用機制機制說明)] 欄位內
  if (mechInput) {
    mechInput.value = formattedTargetText;
    mechInput.dispatchEvent(new Event("input"));
  }

  // 6. 平滑切換捲動至該連動線
  switchTab("worksheet");
  targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  targetRow.classList.add("ring-2", "ring-emerald-500");
  setTimeout(() => targetRow.classList.remove("ring-2", "ring-emerald-500"), 2500);
  showToast(`已成功將「${rawTargetCode} (${expectedGoalString})」引用至[連動線#${targetIndex}]！`, "success");
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
async function loadCenterActions() {
  const selected = document.querySelector("input[name='center_action']:checked");
  const category = selected?.value || "";
  const name = selected?.dataset.legacyCustom === "true" ? document.getElementById("ws_centerCustom").value : selected?.dataset.customValue || "";
  try {
    const response = await fetch(`${API_BASE}/center-actions`, { cache: "no-store" });
    if (!response.ok) throw new Error("無法載入活動清單，請重新整理頁面");
    state.centerActions = await response.json();
    renderCenterActionPicker();
    restoreCenterAction(category, name);
    applyActivityTemplate(false);
    return true;
  } catch (error) {
    document.getElementById("centerActionResultCount").textContent = "活動清單載入失敗，請重新整理頁面";
    showToast("活動清單載入失敗，請重新整理頁面", "error");
    return false;
  }
}

function renderCenterActionPicker() {
  const options = document.getElementById("centerActionOptions");
  options.replaceChildren();
  state.centerActions.forEach(action => {
    const label = document.createElement("label");
    label.className = "action-option";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "center_action";
    radio.value = action.category;
    radio.dataset.action = action.name;
    radio.dataset.customValue = action.name;
    const text = document.createElement("span");
    const category = document.createElement("span");
    category.className = "action-category-label";
    category.textContent = action.category;
    const name = document.createElement("span");
    name.className = "action-name";
    name.textContent = action.name;
    text.append(category, name);
    label.append(radio, text);
    options.appendChild(label);
  });
  const categories = document.getElementById("centerActionCategories");
  categories.replaceChildren();
  ["", ...new Set(state.centerActions.map(a => a.category))].forEach(category => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.category = category;
    button.setAttribute("aria-pressed", String(category === ""));
    const count = state.centerActions.filter(a => !category || a.category === category).length;
    button.textContent = `${category || "全部"} ${count}`;
    button.addEventListener("click", () => {
      categories.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === button)));
      filterCenterActions();
    });
    categories.appendChild(button);
  });
  filterCenterActions();
}

function initCenterActionPicker() {
  document.getElementById("centerActionSearch").addEventListener("input", filterCenterActions);
  document.getElementById("clearCenterActionFilters").addEventListener("click", resetCenterActionFilters);
  document.getElementById("centerActionOptions").addEventListener("change", () => {
    const options = document.getElementById("centerActionOptions");
    const radio = options.querySelector("input:checked");
    document.getElementById("centerCustomBox").classList.toggle("hidden", radio?.dataset.legacyCustom !== "true");
    updateCenterActionSelection();
  });
  document.getElementById("centerActionResultCount").textContent = "活動清單載入中…";
}

function filterCenterActions() {
  const category = document.querySelector("#centerActionCategories button[aria-pressed='true']")?.dataset.category || "";
  const terms = document.getElementById("centerActionSearch").value.normalize("NFKC").toLowerCase().trim().split(/\s+/).filter(Boolean);
  let count = 0;
  document.querySelectorAll("#centerActionOptions .action-option").forEach(label => {
    const radio = label.querySelector("input");
    const text = `${radio.value} ${radio.dataset.action || label.textContent}`.normalize("NFKC").toLowerCase();
    const matches = (!category || radio.value === category) && terms.every(term => text.includes(term));
    label.hidden = !matches;
    if (matches) count++;
  });
  document.getElementById("centerActionResultCount").textContent = `符合 ${count} 項活動・單選`;
  document.getElementById("centerActionEmpty").classList.toggle("hidden", count > 0);
}

function resetCenterActionFilters() {
  document.getElementById("centerActionSearch").value = "";
  document.querySelectorAll("#centerActionCategories button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.category === "")));
  filterCenterActions();
}

function restoreCenterAction(category, name) {
  document.getElementById("centerActionLegacy")?.remove();
  document.querySelectorAll("input[name='center_action']").forEach(r => { r.checked = false; });
  const customInput = document.getElementById("ws_centerCustom");
  customInput.value = "";
  let radio = [...document.querySelectorAll("input[name='center_action']")].find(r => r.value === category && r.dataset.action === name);
  if (!radio && category) {
    const label = document.createElement("label");
    label.id = "centerActionLegacy";
    label.className = "action-option";
    radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "center_action";
    radio.value = category;
    radio.dataset.action = name || ({ A: "一次淨灘", B: "社區二手衣物交換", C: "道場或家裡改用太陽能", D: "自選佛光活動" }[category] || category);
    radio.dataset.customValue = name;
    if (category === "D") radio.dataset.legacyCustom = "true";
    label.append(radio, document.createTextNode(`歷史紀錄：${radio.dataset.action}`));
    document.getElementById("centerActionOptions").prepend(label);
    if (category === "D") customInput.value = name || "";
  }
  if (radio) radio.checked = true;
  document.getElementById("centerCustomBox").classList.toggle("hidden", radio?.dataset.legacyCustom !== "true");
  resetCenterActionFilters();
  updateCenterActionSelection();
}

function initWorksheetEvents() {
  initActivityDetails();
  initCenterActionPicker();

  const customInput = document.getElementById("ws_centerCustom");
  if (customInput) customInput.addEventListener("input", updateCenterActionSelection);

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

  document.getElementById("addCausalChainBtn").addEventListener("click", () => addCausalChain());
  renderCausalChains();
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
  if (container && container.children.length === 0) {
    for (let i = 0; i < 3; i++) addRadialLineRow();
  }
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
      ${count > 3 ? `<button type="button" class="text-red-500 hover:text-red-700 text-xs font-semibold" onclick="this.closest('.radial-line-row').remove();">✕ 刪除此線</button>` : ''}
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
  row.className = "tradeoff-row bg-emerald-50/60 p-4 rounded-xl border border-emerald-200/80 space-y-3 relative";
  row.innerHTML = `
    <div class="flex justify-between items-center">
      <span class="text-xs font-bold px-2 py-0.5 rounded bg-emerald-200 text-emerald-900">拉扯檢查 #${count}</span>
      ${count > 1 ? `<button type="button" class="text-red-500 hover:text-red-700 text-xs font-semibold" onclick="this.closest('.tradeoff-row').remove();">✕ 刪除</button>` : ''}
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

  if (data) {
    who.value = data.who || "";
    row.querySelector(".tradeoff-sit").value = data.situation || "";
    row.querySelector(".tradeoff-how").value = data.how || "";
  }
}

function getCausalChains(data) {
  if (Array.isArray(data?.chains)) return data.chains.length ? data.chains : [{}];
  if (!data) return [{}];
  // 舊版 C 的第二格填寫的是受影響對象，移到 D 影響保留原意。
  return [{ ...data, result_cond: "", impact: data.result_cond || "" }];
}

function createCausalTable(chain, editable = false) {
  const wrapper = document.createElement("div");
  wrapper.className = "overflow-x-auto";
  wrapper.innerHTML = `<table class="causal-table">
    <thead><tr><th scope="col">階段</th><th scope="col">發生了什麼？</th><th scope="col">這一步要成立，需要什麼條件？</th></tr></thead>
    <tbody>
      <tr><th scope="row">A 起點</th><td data-field="start"></td><td data-field="start_cond"></td></tr>
      <tr><th scope="row">B 中介</th><td data-field="mid"></td><td data-field="mid_cond"></td></tr>
      <tr><th scope="row">C 結果</th><td data-field="result"></td><td data-field="result_cond"></td></tr>
      <tr class="causal-impact-heading"><th scope="col">階段</th><th scope="col">受到影響是那些人或環境？</th><th scope="col">如何衡量此影響？</th></tr>
      <tr><th scope="row">D 影響</th><td data-field="impact"></td><td data-field="measurement"></td></tr>
    </tbody>
  </table>`;
  wrapper.querySelectorAll("[data-field]").forEach(cell => {
    const field = cell.dataset.field;
    cell.dataset.label = cell.cellIndex === 1 ? (field === "impact" ? "受到影響是那些人或環境？" : "發生了什麼？") : (field === "measurement" ? "如何衡量此影響？" : "這一步要成立，需要什麼條件？");
    if (editable) {
      const input = document.createElement("textarea");
      input.dataset.causalField = field;
      input.rows = 2;
      input.value = chain[field] || "";
      input.setAttribute("aria-label", `${cell.parentElement.cells[0].textContent} ${cell.cellIndex === 1 ? (field === 'impact' ? '受到影響是那些人或環境？' : '發生了什麼？') : (field === 'measurement' ? '如何衡量此影響？' : '這一步要成立，需要什麼條件？')}`);
      cell.appendChild(input);
    } else {
      cell.textContent = chain[field] || "未填寫";
    }
  });
  return wrapper;
}

function addCausalChain(chain = {}) {
  const container = document.getElementById("causalChainsContainer");
  const row = document.createElement("div");
  row.className = "causal-chain space-y-3";
  const header = document.createElement("div");
  header.className = "flex justify-between items-center gap-3";
  const title = document.createElement("h4");
  title.className = "causal-chain-title";
  title.textContent = `因果鏈 #${container.children.length + 1}`;
  header.appendChild(title);
  if (container.children.length > 0) {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "text-red-500 hover:text-red-700 text-xs font-semibold";
    removeButton.textContent = "✕ 刪除此因果鏈";
    removeButton.addEventListener("click", () => {
      row.remove();
      container.querySelectorAll(".causal-chain-title").forEach((heading, index) => {
        heading.textContent = `因果鏈 #${index + 1}`;
      });
    });
    header.appendChild(removeButton);
  }
  row.append(header, createCausalTable(chain, true));
  container.appendChild(row);
}

function renderCausalChains(data) {
  document.getElementById("causalChainsContainer").replaceChildren();
  getCausalChains(data).forEach(chain => addCausalChain(chain));
}

function updateCenterActionSelection() {
  const selectedActionRadio = document.querySelector("input[name='center_action']:checked");
  const actionCode = selectedActionRadio ? selectedActionRadio.value : "未選擇";
  
  let actionName = selectedActionRadio?.dataset.action || "請選擇中心行動";
  if (selectedActionRadio?.dataset.legacyCustom === "true") {
    actionName = document.getElementById("ws_centerCustom")?.value.trim() || "自選佛光活動";
  }
  const selected = document.getElementById("centerActionSelected");
  if (selected) selected.textContent = selectedActionRadio ? `已選擇｜${actionCode} · ${actionName}` : "尚未選擇活動";
}

function getWorksheetSubmissionError(payload) {
  const complete = (row, fields) => fields.every(field => typeof row?.[field] === "string" && row[field].trim());
  if (payload.radial_data.filter(row => complete(row, ["goal", "mechanism", "observable"])).length < 3) {
    return "三、放射型分析：請完整填寫至少 3 條連動線，每條的三個欄位都要填寫！";
  }
  if (!payload.tradeoff_data.some(row => complete(row, ["who", "situation", "how"]))) {
    return "四、拉扯檢查：請完整填寫至少 1 條拉扯檢查，每條的三個欄位都要填寫！";
  }
  if (!payload.causal_data.chains.some(row => complete(row, ["start", "start_cond", "mid", "mid_cond", "result", "result_cond", "impact", "measurement"]))) {
    return "五、因果型分析：請完整填寫至少 1 條因果鏈，A～D 階段的八個欄位都要填寫！";
  }
  if (payload.self_checks.length !== 4 || !payload.self_checks.every(Boolean)) {
    return "六、自我檢核：請勾選確認全部 4 個項目！";
  }
  if (!complete(payload.commitment, ["start_action", "target_1", "target_2", "risk_aware", "metric"])) {
    return "七、我的連動承諾宣言：請填寫全部 5 個欄位！";
  }
  return "";
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
  const centerCustom = actionRadio.dataset.legacyCustom === "true" ? document.getElementById("ws_centerCustom")?.value.trim() : actionRadio.dataset.customValue || "";

  const activityDetails = collectActivityDetails();
  if (!validateActivityDetails(activityDetails)) return;

  const radialData = [];
  document.querySelectorAll(".radial-line-row").forEach(row => {
    const goal = row.querySelector(".radial-goal-select")?.value;
    const mechanism = row.querySelector(".radial-mech-input")?.value.trim();
    const observable = row.querySelector(".radial-obs-input")?.value.trim();
    if (goal || mechanism || observable) {
      radialData.push({ goal, mechanism, observable });
    }
  });

  const tradeoffData = [];
  document.querySelectorAll(".tradeoff-row").forEach(row => {
    const who = row.querySelector(".tradeoff-who")?.value.trim();
    const situation = row.querySelector(".tradeoff-sit")?.value.trim();
    const how = row.querySelector(".tradeoff-how")?.value.trim();
    if (who || situation || how) {
      tradeoffData.push({ who, situation, how });
    }
  });

  const causalData = { chains: Array.from(document.querySelectorAll(".causal-chain")).map(row =>
    Object.fromEntries(Array.from(row.querySelectorAll("[data-causal-field]")).map(input => [input.dataset.causalField, input.value.trim()]))
  ) };

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

  const payload = {
    unit_name: unitName,
    center_action: centerAction,
    center_custom: centerCustom,
    activity_description: describeActivity(activityDetails),
    activity_details: activityDetails,
    radial_data: radialData,
    tradeoff_data: tradeoffData,
    causal_data: causalData,
    self_checks: selfChecks,
    commitment: commitment,
    status: status
  };

  if (status === "submitted") {
    const error = getWorksheetSubmissionError(payload);
    if (error) {
      showToast(error, "error");
      return;
    }
  }

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

    if (status === "submitted") {
      // 正式提交練習單儲存成功後：清空表單上的資料，方便填寫新練習單
      createNewWorksheet(false);
      showToast("🎉 練習單已正式提交成功！已為您清空表單資料。", "success");
      // 重新整理歷史紀錄列表（不自動載入至表單，保持清空）
      await loadMyWorksheets(false);
    } else {
      if (method === "POST" && data.id) state.currentWorksheetId = data.id;
      showToast("💾 草稿已成功儲存！", "success");
      await loadMyWorksheets(false);
    }
  } catch (err) {
    showToast("網路異常，無法儲存練習單", "error");
  }
}

async function loadMyWorksheets(autoLoadLatest = false) {
  if (!state.token) return;
  try {
    // 依據當前登入者身分載入其專屬練習單
    const res = await fetch(`${API_BASE}/worksheets?mine=true`, {
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    if (res.ok) {
      state.worksheetsList = await res.json();
      renderMyWorksheetsBadge();

      // 切換帳號或登入時：自動載入該登入者的表單；若無歷史紀錄則提供乾淨空白表單
      if (autoLoadLatest) {
        if (state.worksheetsList && state.worksheetsList.length > 0) {
          loadWorksheetToForm(state.worksheetsList[0].id, true);
        } else {
          createNewWorksheet(false);
        }
      }
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
    const statusColor = ws.status === 'reviewed' ? 'bg-emerald-100 text-emerald-800' : (ws.status === 'submitted' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700');

    card.innerHTML = `
      <div>
        <div class="flex items-center gap-2 mb-1">
          <span class="text-xs px-2 py-0.5 rounded font-bold ${statusColor}">${statusLabel}</span>
          <h4 class="font-bold text-slate-800 text-sm">行動：${ws.center_action} (${ws.center_custom || '標準活動'})</h4>
          <span class="text-xs text-slate-400">${new Date(ws.updated_at).toLocaleString('zh-TW')}</span>
        </div>
        ${ws.score ? `<div class="mt-2 text-xs font-bold text-emerald-700">評分：${ws.score} 分 ｜ 講師講評：${ws.teacher_comment || '無'}</div>` : ''}
      </div>
      <div class="flex items-center gap-2">
        <button type="button" onclick="downloadWorksheetDocx(${ws.id})" class="cursor-pointer px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-semibold flex items-center gap-1">
          📄 下載Word
        </button>
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

window.loadWorksheetToForm = function(wsId, silent = false) {
  const ws = state.worksheetsList.find(w => w.id === wsId);
  if (!ws) return;
  state.currentWorksheetId = ws.id;

  const nameEl = document.getElementById("ws_userName");
  if (nameEl) nameEl.value = ws.student_name || state.user?.name || "";
  const unitEl = document.getElementById("ws_unitName");
  if (unitEl) unitEl.value = ws.unit_name || state.user?.unit_name || "佛光學員";

  restoreCenterAction(ws.center_action, ws.center_custom || "");
  loadActivityDetails(ws.activity_details, ws.activity_description || "");

  const radialContainer = document.getElementById("radialLinesContainer");
  if (radialContainer) {
    radialContainer.innerHTML = "";
    if (Array.isArray(ws.radial_data) && ws.radial_data.length > 0) {
      ws.radial_data.forEach(line => addRadialLineRow(line));
      while (radialContainer.children.length < 3) {
        addRadialLineRow();
      }
    } else {
      for (let i = 0; i < 3; i++) addRadialLineRow();
    }
  }

  const tradeoffContainer = document.getElementById("tradeoffContainer");
  if (tradeoffContainer) {
    tradeoffContainer.innerHTML = "";
    if (Array.isArray(ws.tradeoff_data)) {
      ws.tradeoff_data.forEach(to => addTradeoffRow(to));
    }
    if (tradeoffContainer.children.length === 0) addTradeoffRow();
  }

  renderCausalChains(ws.causal_data);

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

  updateCenterActionSelection();
  const myWsModal = document.getElementById("myWorksheetsModal");
  if (myWsModal) myWsModal.classList.add("hidden");
  if (!silent) {
    showToast(`已載入練習單 #${ws.id}，您可以進行修改後重新提交！`, "success");
  }
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

window.createNewWorksheet = function(showToastMsg = true) {
  state.currentWorksheetId = null;
  const nameEl = document.getElementById("ws_userName");
  if (nameEl) nameEl.value = state.user?.name || "";
  const unitEl = document.getElementById("ws_unitName");
  if (unitEl) unitEl.value = state.user?.unit_name || "佛光學員";

  restoreCenterAction("", "");
  loadActivityDetails(null);
  
  const rc = document.getElementById("radialLinesContainer");
  if (rc) { rc.innerHTML = ""; for(let i=0; i<3; i++) addRadialLineRow(); }
  const tc = document.getElementById("tradeoffContainer");
  if (tc) { tc.innerHTML = ""; addTradeoffRow(); }

  renderCausalChains();

  ["ws_commitStart", "ws_commitT1", "ws_commitT2", "ws_commitRisk", "ws_commitMetric"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  ["ws_check1", "ws_check2", "ws_check3", "ws_check4"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  updateCenterActionSelection();
  if (showToastMsg) {
    showToast("已重置為新練習單！", "info");
  }
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
    if (g.combo > 1) floatEl.innerHTML += `<span class="block text-[10px] text-emerald-300 font-bold">${g.combo} 連擊！</span>`;

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
    tr.className = `border-b border-slate-100 hover:bg-slate-50 transition-colors ${state.user && item.user_id === state.user.id && item.account_type === (state.user.account_type || (['admin', 'teacher'].includes(state.user.role) ? 'staff' : 'student')) ? 'bg-emerald-50/60 font-semibold' : ''}`;
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

window.switchAdminSubTab = function(subTab) {
  state.activeAdminSubTab = subTab;
  document.querySelectorAll(".admin-subpane").forEach(el => el.classList.add("hidden"));
  const targetPane = document.getElementById(`adminSubPane_${subTab}`);
  if (targetPane) targetPane.classList.remove("hidden");
  if (subTab === "matching" && state.matchingAdminSession !== state.token) {
    document.getElementById("matchingAdminFrame").src = "/matching-admin";
    state.matchingAdminSession = state.token;
  }
  if (subTab === "attendance" && state.attendanceAdminSession !== state.token) loadAttendanceAdmin();

  document.querySelectorAll(".admin-subtab-btn").forEach(btn => {
    const btnTab = btn.getAttribute("data-admin-subtab");
    if (btnTab === subTab) {
      btn.className = "admin-subtab-btn px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all flex items-center gap-2 bg-emerald-700 text-white shadow-sm cursor-pointer";
    } else {
      btn.className = "admin-subtab-btn px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer";
    }
  });

  if (subTab === "dashboard" && state.lastAdminStats) {
    setTimeout(() => renderAdminCharts(state.lastAdminStats), 30);
  }
  if (subTab === "categories") loadAdminCategories();
};

async function loadAttendanceAdmin() {
  if (!state.token || !["admin", "teacher"].includes(state.user?.role)) return;
  const token = state.token;
  const status = document.getElementById("attendanceAdminStatus");
  const retry = document.getElementById("attendanceAdminRetry");
  const frame = document.getElementById("attendanceAdminFrame");
  frame.classList.add("hidden");
  retry.classList.add("hidden");
  status.textContent = "正在讀取原課程後台…";
  try {
    const response = await fetch(`${API_BASE}/attendance-admin/view`, {
      headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(45000)
    });
    if (state.token !== token) return;
    if (response.status === 401) { handleLogout(); return; }
    if (!response.ok) throw new Error();
    const html = await response.text();
    if (state.token !== token) return;
    frame.srcdoc = html;
    frame.classList.remove("hidden");
    state.attendanceAdminSession = token;
    status.textContent = "";
  } catch {
    if (state.token !== token) return;
    status.textContent = "原課程後台暫時無法載入，請重新載入。";
    retry.classList.remove("hidden");
  }
}

async function loadAdminDashboard() {
  if (!state.token || !state.user || !["admin", "teacher"].includes(state.user.role)) return;

  try {
    const resStats = await fetch(`${API_BASE}/admin/stats`, {
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    if (resStats.ok) {
      const stats = await resStats.json();
      state.lastAdminStats = stats;
      renderAdminStats(stats);
      renderAdminCharts(stats);
    }

    loadAdminWorksheets();
    loadAdminStaff();
    loadAdminStudents();
    loadAdminGameSettings();
  } catch (err) {
    console.error("Admin dashboard load failed", err);
  }
}

function renderAdminStats(s) {
  document.getElementById("adminStatStudents").textContent = s.total_students;
  document.getElementById("adminStatDraftWorksheets").textContent = s.draft_worksheets;
  document.getElementById("adminStatSubmittedWorksheets").textContent = s.submitted_worksheets + s.reviewed_worksheets;
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
    const actionCategories = [...new Set(state.centerActions.map(a => a.category))];
    const chartLabels = [...actionCategories, ...Object.keys(counts).filter(key => !actionCategories.includes(key))];
    const legacyLabels = { A: "A. 淨灘", B: "B. 二手衣交換", C: "C. 太陽能", D: "D. 自選佛光活動" };
    chartPie = new Chart(ctxPie, {
      type: "doughnut",
      data: {
        labels: chartLabels.map(key => legacyLabels[key] || key),
        datasets: [{
          data: chartLabels.map(key => counts[key] || 0),
          backgroundColor: ["#3b82f6", "#65a30d", "#16a34a", "#0ea5a4", "#526176", "#15803d", "#0f766e", "#4d7c0f"]
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
          <td class="p-3"><span class="px-2 py-0.5 rounded font-bold ${w.status === 'reviewed' ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-100 text-emerald-800'}">${w.status}</span></td>
          <td class="p-3 font-bold text-emerald-700">${w.score ? w.score + '分' : '未評分'}</td>
          <td class="p-3 text-right space-x-1">
            <button class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-semibold text-xs" onclick="viewWorksheetDetailModal(${w.id})">詳情</button>
            <button type="button" onclick="downloadWorksheetDocx(${w.id})" class="cursor-pointer inline-block px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded font-semibold text-xs">Word匯出</button>
            <button class="px-2.5 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded font-semibold text-xs" onclick="openGradeModal(${w.id}, '${w.user_name}', ${w.score || 0}, '${(w.teacher_comment || '').replace(/'/g, "\\'")}')">批閱評分</button>
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
    window.currentDetailWorksheetId = ws.id;
    const docxBtn = document.getElementById("detailDownloadDocxBtn");
    if (docxBtn) {
      docxBtn.onclick = () => downloadWorksheetDocx(ws.id);
      docxBtn.setAttribute("href", `${API_BASE}/worksheets/${ws.id}/export-docx?token=${encodeURIComponent(state.token || '')}`);
    }

    const radialHtml = (ws.radial_data || []).map((r, i) => `
      <tr class="border-b border-slate-100">
        <td class="p-2 font-bold text-emerald-800">#${i+1} ${r.goal || ''}</td>
        <td class="p-2 text-slate-700">${r.mechanism || ''}</td>
        <td class="p-2 text-slate-600">${r.observable || ''}</td>
      </tr>
    `).join("");

    const tradeoffHtml = (ws.tradeoff_data || []).map((t, i) => `
      <tr class="border-b border-slate-100">
        <td class="p-2 font-bold text-emerald-900">${t.who || ''}</td>
        <td class="p-2 text-slate-700">${t.situation || ''}</td>
        <td class="p-2 text-slate-600">${t.how || ''}</td>
      </tr>
    `).join("");

    const causalHtml = getCausalChains(ws.causal_data).map((chain, i) => `<div class="space-y-2"><h5 class="font-bold text-red-600">因果鏈 #${i + 1}</h5>${createCausalTable(chain).outerHTML}</div>`).join("");
    const commit = ws.commitment || {};

    document.getElementById("detailModalBody").innerHTML = `
      <div class="space-y-4 text-xs">
        <div class="bg-slate-50 p-3 rounded-xl border border-slate-200">
          <span class="font-bold text-slate-500">中心行動：</span>
          <span class="font-black text-slate-900 text-sm ml-2">${ws.center_action} (${ws.center_custom || '標準行動'})</span>
          <h4 class="font-bold text-slate-500 mt-3 mb-1">活動簡介及說明：</h4>
          <p id="detailActivityDescription" class="whitespace-pre-wrap break-words text-sm text-slate-700"></p>
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
          <h4 class="font-extrabold text-emerald-900 mb-2">善意拉扯檢核（負面影響與對策）：</h4>
          <table class="w-full text-left bg-white border border-slate-200 rounded-lg overflow-hidden">
            <thead class="bg-emerald-50 text-emerald-900 font-bold">
              <tr><th class="p-2">可能傷到誰/什麼</th><th class="p-2">發生情況</th><th class="p-2">降低影響對策</th></tr>
            </thead>
            <tbody>${tradeoffHtml || '<tr><td colspan="3" class="p-3 text-center text-slate-400">無拉扯檢核</td></tr>'}</tbody>
          </table>
        </div>

        <div class="bg-blue-50/50 p-3 rounded-xl border border-blue-100">
          <h4 class="font-bold text-blue-900 mb-1">五、因果型分析</h4>
          <div class="space-y-5">${causalHtml}</div>
        </div>

        <div class="bg-slate-50 p-3 rounded-xl border border-slate-200">
          <h4 class="font-bold text-slate-900 mb-1">六、自我檢核</h4>
          ${Array.from(document.querySelectorAll('#ws_check1, #ws_check2, #ws_check3, #ws_check4')).map((input, i) => `<p>${ws.self_checks?.[i] ? '☑ 已勾選' : '☐ 未勾選'}：${input.nextElementSibling.textContent}</p>`).join('')}
        </div>

        <div class="bg-emerald-50/50 p-3 rounded-xl border border-emerald-200">
          <h4 class="font-bold text-emerald-900 mb-1">七、我的連動承諾宣言</h4>
          <p>「我願意從 <u>${commit.start_action || ''}</u> 開始，希望促進 <u>${commit.target_1 || ''}</u> 與 <u>${commit.target_2 || ''}</u>，也會留意 <u>${commit.risk_aware || ''}</u> 的風險。一個月後，我會用 <u>${commit.metric || ''}</u> 來確認自己有沒有做到。」</p>
        </div>

        ${ws.score ? `
        <div class="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
          <div class="font-bold text-emerald-900">審定成績：${ws.score} 分</div>
          <div class="text-slate-700 mt-1">講師講評：${ws.teacher_comment || '無'}</div>
        </div>` : '<div class="text-slate-400 italic">目前尚未評分</div>'}
      </div>
    `;
    document.getElementById("detailActivityDescription").textContent = ws.activity_description || "未填寫";
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
// 7B. Staff / Admin Account Management ([管理帳號與權限名單維護])
// ==============================================================================
async function loadAdminStaff(search = "") {
  const container = document.getElementById("adminStaffTableBody");
  if (!container) return;
  container.innerHTML = '<tr><td colspan="10" class="p-6 text-center text-slate-400">載入管理帳號名單...</td></tr>';
  state.selectedStaffIds.clear();
  updateSelectedStaffCountUI();
  const masterCb = document.getElementById("masterStaffCb");
  if (masterCb) masterCb.checked = false;

  try {
    const url = search ? `${API_BASE}/admin/staff?search=${encodeURIComponent(search)}&limit=200` : `${API_BASE}/admin/staff?limit=200`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      container.innerHTML = "";
      if (!data.items || data.items.length === 0) {
        container.innerHTML = '<tr><td colspan="10" class="p-6 text-center text-slate-400">無符合條件之管理員／講師帳號</td></tr>';
        return;
      }
      data.items.forEach(s => {
        const isPrimaryRootAdmin = (s.email === "admin");
        const roleBadge = s.role === "admin"
          ? '<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-extrabold text-[11px]">🛡️ 系統管理員</span>'
          : '<span class="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold text-[11px]">👩‍🏫 授課講師</span>';

        const tr = document.createElement("tr");
        tr.className = "border-b border-slate-100 hover:bg-emerald-50/30 text-xs";
        tr.innerHTML = `
          <td class="p-3 text-center">
            ${!isPrimaryRootAdmin ? `<input type="checkbox" class="staff-cb rounded text-emerald-600" value="${s.id}" onchange="handleStaffSelectChange(${s.id}, this.checked)">` : '<span title="預設最高管理員受系統保護" class="text-emerald-600 font-bold">🔒</span>'}
          </td>
          <td class="p-3 font-mono text-slate-500">#${s.id}</td>
          <td class="p-3 font-bold text-slate-900">${s.name}</td>
          <td class="p-3 text-emerald-700 font-mono font-bold">${s.email}</td>
          <td class="p-3 text-slate-500 font-mono">${s.email_backup || '-'}</td>
          <td class="p-3 text-slate-600 font-mono">${s.phone}</td>
          <td class="p-3 font-mono text-slate-600 font-bold">${s.unit_code || 'FGU'}</td>
          <td class="p-3 text-slate-700 font-medium">${s.unit_name || '佛光永續學院'}</td>
          <td class="p-3">${roleBadge}</td>
          <td class="p-3 text-right space-x-1">
            <button class="px-2.5 py-1 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 rounded font-semibold text-[11px]"
              onclick="openEditStudentModal(${s.id}, '${(s.name || '').replace(/'/g, "\\'")}', '${(s.email || '').replace(/'/g, "\\'")}', '${(s.email_backup || '').replace(/'/g, "\\'")}', '${(s.phone || '').replace(/'/g, "\\'")}', '${(s.unit_code || '').replace(/'/g, "\\'")}', '${(s.unit_name || '佛光永續學院').replace(/'/g, "\\'")}', '${s.role}', 'staff')">
              修改
            </button>
            ${!isPrimaryRootAdmin ? `
            <button class="px-2.5 py-1 bg-red-50 text-red-700 hover:bg-red-100 rounded font-semibold text-[11px]"
              onclick="deleteSingleStaff(${s.id}, '${(s.name || '').replace(/'/g, "\\'")}')">
              刪除
            </button>` : '<span class="text-[11px] text-slate-400 px-1">預設主帳號</span>'}
          </td>
        `;
        container.appendChild(tr);
      });
    }
  } catch (err) {
    container.innerHTML = '<tr><td colspan="10" class="p-6 text-center text-red-400">無法讀取管理帳號名單</td></tr>';
  }
}

window.loadAdminStaff = loadAdminStaff;

window.handleStaffSelectChange = function(id, isChecked) {
  if (isChecked) state.selectedStaffIds.add(id);
  else state.selectedStaffIds.delete(id);
  updateSelectedStaffCountUI();
};

window.toggleSelectAllStaff = function(masterCb) {
  document.querySelectorAll(".staff-cb").forEach(cb => {
    cb.checked = masterCb.checked;
    const sid = parseInt(cb.value, 10);
    if (masterCb.checked) state.selectedStaffIds.add(sid);
    else state.selectedStaffIds.delete(sid);
  });
  updateSelectedStaffCountUI();
};

function updateSelectedStaffCountUI() {
  const countEl = document.getElementById("selectedStaffCount");
  if (countEl) countEl.textContent = state.selectedStaffIds.size;
  const btn = document.getElementById("batchDeleteStaffBtn");
  if (btn) btn.disabled = state.selectedStaffIds.size === 0;
}

window.openAddStaffModal = function() {
  document.getElementById("addStaffModal")?.classList.remove("hidden");
};

window.saveNewStaff = async function() {
  const name = document.getElementById("addStaffName").value.trim();
  const email = document.getElementById("addStaffEmail").value.trim();
  const email_backup = document.getElementById("addStaffEmailBackup").value.trim();
  const phone = document.getElementById("addStaffPhone").value.trim();
  const unit_code = document.getElementById("addStaffUnitCode").value.trim() || "FGU";
  const unit_name = document.getElementById("addStaffUnitName").value.trim() || "佛光永續學院";
  const role = document.getElementById("addStaffRole").value || "admin";
  const password = document.getElementById("addStaffPassword").value.trim();

  if (!name || !email || !phone) {
    showToast("姓名、登入帳號/Email 與聯絡電話為必填欄位！", "error");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/staff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`
      },
      body: JSON.stringify({ name, email, email_backup, phone, unit_code, unit_name, role, password })
    });
    const d = await res.json();
    if (res.ok) {
      showToast(d.message || "管理帳號新增成功！", "success");
      document.getElementById("addStaffModal").classList.add("hidden");
      document.getElementById("addStaffName").value = "";
      document.getElementById("addStaffEmail").value = "";
      document.getElementById("addStaffEmailBackup").value = "";
      document.getElementById("addStaffPhone").value = "";
      document.getElementById("addStaffPassword").value = "";
      loadAdminStaff();
    } else {
      showToast(d.detail || "新增失敗", "error");
    }
  } catch (err) {
    showToast("連線異常", "error");
  }
};

window.deleteSingleStaff = async function(id, name) {
  if (!confirm(`確定要刪除管理員／講師帳號「${name}」嗎？`)) return;
  try {
    const res = await fetch(`${API_BASE}/admin/staff/${id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      showToast(`帳號 ${name} 已成功刪除！`, "success");
      loadAdminStaff();
    } else {
      showToast(d.detail || "刪除失敗", "error");
    }
  } catch (err) {
    showToast("刪除失敗", "error");
  }
};

window.executeBatchDeleteStaff = async function() {
  const ids = Array.from(state.selectedStaffIds);
  if (ids.length === 0) return;
  if (!confirm(`確定要批次刪除選取的 ${ids.length} 個管理帳號嗎？此操作無法復原。`)) return;

  try {
    const res = await fetch(`${API_BASE}/admin/staff/batch-delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`
      },
      body: JSON.stringify({ ids })
    });
    const d = await res.json();
    if (res.ok) {
      showToast(d.message || "批次刪除管理帳號成功！", "success");
      loadAdminStaff();
    }
  } catch (err) {
    showToast("批次刪除失敗", "error");
  }
};

window.openBatchImportStaffModal = function() {
  document.getElementById("batchImportStaffModal")?.classList.remove("hidden");
};

window.executeBatchImportStaff = async function() {
  const textVal = document.getElementById("importStaffTextarea").value.trim();
  const fileInput = document.getElementById("importStaffFileInput");

  let parsedStaff = [];

  function parseCSVLine(line) {
    const parts = line.split(",").map(p => p.trim());
    if (parts.length >= 2 && parts[0] && parts[1] && !["姓名", "管理員／講師姓名", "學員姓名"].includes(parts[0])) {
      return {
        name: parts[0],
        email: parts[1],
        email_backup: parts[2] || "",
        phone: parts[3] || "0912345678",
        unit_code: parts[4] || "FGU",
        unit_name: parts[5] || parts[4] || "佛光永續學院",
        role: parts[6] || "admin"
      };
    }
    return null;
  }

  if (textVal) {
    const lines = textVal.split("\n");
    for (let l of lines) {
      const s = parseCSVLine(l);
      if (s) parsedStaff.push(s);
    }
  }

  if (fileInput && fileInput.files.length > 0) {
    const file = fileInput.files[0];
    const text = await file.text();
    const rows = text.split("\n");
    for (let r of rows) {
      const s = parseCSVLine(r);
      if (s) parsedStaff.push(s);
    }
  }

  if (parsedStaff.length === 0) {
    showToast("未偵測到有效管理名單資料，請確認格式（姓名, 帳號/Email, 備用Email, 電話, 單位編號, 單位名稱）", "error");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/staff/batch-import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`
      },
      body: JSON.stringify({ students: parsedStaff, default_role: "admin" })
    });
    const d = await res.json();
    if (res.ok) {
      showToast(d.message || "管理名單批次匯入完成！", "success");
      document.getElementById("batchImportStaffModal").classList.add("hidden");
      document.getElementById("importStaffTextarea").value = "";
      if (fileInput) fileInput.value = "";
      loadAdminStaff();
    }
  } catch (err) {
    showToast("匯入失敗", "error");
  }
};

window.exportStaffCSV = function() {
  if (!state.token) {
    showToast("請先登入管理員帳號", "warning");
    return;
  }
  window.open(`${API_BASE}/admin/staff/export-csv?token=${encodeURIComponent(state.token)}`, "_blank");
};

// ==============================================================================
// 8. Student Management (6-column CRUD, Batch Delete, Import & Export)
// ==============================================================================
async function loadAdminStudents(search = state.studentSearch, page = state.studentPage) {
  const container = document.getElementById("adminStudentsTableBody");
  if (!container) return;
  if (search !== state.studentSearch) page = 1;
  state.studentSearch = search;
  state.studentPage = Math.max(1, page);
  const requestId = ++state.studentRequestId;
  document.getElementById("studentPrevPage").disabled = true;
  document.getElementById("studentNextPage").disabled = true;
  document.getElementById("studentPageInfo").textContent = "載入中…";
  container.innerHTML = '<tr><td colspan="9" class="p-6 text-center text-slate-400">載入學員名單...</td></tr>';
  state.selectedStudentIds.clear();
  updateSelectedCountUI();
  const masterCb = document.getElementById("masterStudentCb");
  if (masterCb) masterCb.checked = false;

  try {
    const url = `${API_BASE}/admin/students?search=${encodeURIComponent(search)}&limit=100&offset=${(state.studentPage - 1) * 100}`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error("無法讀取名單");
    if (res.ok) {
      const data = await res.json();
      if (requestId !== state.studentRequestId) return;
      state.studentTotalPages = Math.max(1, Math.ceil(data.total / 100));
      if (state.studentPage > state.studentTotalPages) {
        return loadAdminStudents(search, state.studentTotalPages);
      }
      document.getElementById("studentPageInfo").textContent = `第 ${state.studentPage} / ${state.studentTotalPages} 頁，共 ${data.total} 筆（每頁 100 筆）`;
      document.getElementById("studentPrevPage").disabled = state.studentPage === 1;
      document.getElementById("studentNextPage").disabled = state.studentPage === state.studentTotalPages;
      container.innerHTML = "";
      if (!data.items || data.items.length === 0) {
        container.innerHTML = '<tr><td colspan="9" class="p-6 text-center text-slate-400">無符合條件之學員資料</td></tr>';
        return;
      }
      data.items.forEach(s => {
        const tr = document.createElement("tr");
        tr.className = "border-b border-slate-100 hover:bg-slate-50 text-xs";
        tr.innerHTML = `
          <td class="p-3 text-center">
            <input type="checkbox" class="student-cb rounded text-emerald-600" value="${s.id}" onchange="handleStudentSelectChange(${s.id}, this.checked)">
          </td>
          <td class="p-3 font-mono text-slate-500">#${s.id}</td>
          <td class="p-3 font-bold text-slate-800">${s.name}</td>
          <td class="p-3 text-slate-600 font-mono">${s.email}</td>
          <td class="p-3 text-slate-500 font-mono">${s.email_backup || '-'}</td>
          <td class="p-3 text-slate-600 font-mono">${s.phone}</td>
          <td class="p-3 font-mono text-slate-600 font-bold">${s.unit_code || '-'}</td>
          <td class="p-3 text-slate-700 font-medium">${s.unit_name || '佛光學員'}</td>
          <td class="p-3 text-right space-x-1">
            <button class="px-2 py-1 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 rounded font-semibold text-[11px]"
              onclick="openEditStudentModal(${s.id}, '${(s.name || '').replace(/'/g, "\\'")}', '${(s.email || '').replace(/'/g, "\\'")}', '${(s.email_backup || '').replace(/'/g, "\\'")}', '${(s.phone || '').replace(/'/g, "\\'")}', '${(s.unit_code || '').replace(/'/g, "\\'")}', '${(s.unit_name || '佛光學員').replace(/'/g, "\\'")}', '${s.role || 'student'}')">
              修改
            </button>
            <button class="px-2 py-1 bg-red-50 text-red-700 hover:bg-red-100 rounded font-semibold text-[11px]"
              onclick="deleteSingleStudent(${s.id}, '${(s.name || '').replace(/'/g, "\\'")}')">
              刪除
            </button>
          </td>
        `;
        container.appendChild(tr);
      });
    }
  } catch (err) {
    if (requestId !== state.studentRequestId) return;
    document.getElementById("studentPageInfo").textContent = "名單載入失敗，請重新整理數據";
    container.innerHTML = '<tr><td colspan="9" class="p-6 text-center text-red-400">無法讀取名單</td></tr>';
  }
}

window.loadAdminStudents = loadAdminStudents;
window.changeStudentPage = function(delta) {
  const page = state.studentPage + delta;
  if (page >= 1 && page <= state.studentTotalPages) return loadAdminStudents(state.studentSearch, page);
};

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

window.openEditStudentModal = function(id, name, email, email_backup, phone, unit_code, unit_name, role, accountType = "student") {
  state.editingAccountType = accountType;
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
  const roleSel = document.getElementById("editStudentRole");
  if (roleSel) {
    roleSel.innerHTML = accountType === "staff"
      ? '<option value="teacher">授課講師／助教</option><option value="admin">系統管理員</option>'
      : '<option value="student">學員</option>';
    roleSel.value = role || "student";
    roleSel.disabled = accountType === "student" || email === "admin";
  }
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
  const role = document.getElementById("editStudentRole")?.value || "student";

  if (!name || !email || !phone) {
    showToast("姓名、Email與電話為必填欄位", "error");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/${state.editingAccountType === "staff" ? "staff" : "students"}/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`
      },
      body: JSON.stringify({ name, email, email_backup, phone, unit_code, unit_name, password, role })
    });
    const d = await res.json();
    if (res.ok) {
      showToast(d.message || "帳號資料更新成功！", "success");
      document.getElementById("editStudentModal").classList.add("hidden");
      loadAdminStaff();
      loadAdminStudents();
    } else {
      showToast(d.detail || "更新失敗", "error");
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
        unit_name: parts[5] || parts[4] || "佛光學員",
        role: "student"
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
      body: JSON.stringify({ students: parsedStudents, default_role: "student" })
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
  if (!state.token) {
    showToast("請先登入管理員帳號", "warning");
    return;
  }
  window.open(`${API_BASE}/admin/students/export-csv?token=${encodeURIComponent(state.token)}`, "_blank");
};

window.exportWorksheetsCSV = async function() {
  if (!state.token) {
    showToast("請先登入管理員帳號", "warning");
    return;
  }
  try {
    const response = await fetch(`${API_BASE}/admin/export/csv`, {headers: {Authorization: `Bearer ${state.token}`}});
    if (!response.ok) throw new Error();
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "SDGs_Worksheets_Export.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { showToast("練習單匯出失敗，請稍後再試", "error"); }
};

window.currentDetailWorksheetId = null;

window.downloadCurrentDetailDocx = function() {
  if (window.currentDetailWorksheetId) {
    downloadWorksheetDocx(window.currentDetailWorksheetId);
  } else {
    showToast("未指定練習單編號", "warning");
  }
};

window.downloadWorksheetDocx = async function(worksheetId) {
  if (!state.token) {
    showToast("請先登入系統", "warning");
    showLoginModal(true);
    return;
  }
  showToast("📄 正在產生 Word (.docx) 文件，請稍候...", "info");
  try {
    const res = await fetch(`${API_BASE}/worksheets/${worksheetId}/export-docx`, {
      headers: {
        "Authorization": `Bearer ${state.token}`
      }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || "匯出失敗，請確認登入狀態或權限", "error");
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SDGs_Worksheet_${worksheetId}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => window.URL.revokeObjectURL(url), 2000);
    showToast("✓ Word 文件已成功下載！", "success");
  } catch (err) {
    console.warn("fetch 下載失敗，切換為直接下載", err);
    window.open(`${API_BASE}/worksheets/${worksheetId}/export-docx?token=${encodeURIComponent(state.token)}`, "_blank");
  }
};

// ==============================================================================
// 9. Utilities & Toast Notifications
// ==============================================================================
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  const bgClass = type === "success" ? "bg-emerald-600 text-white" : (type === "error" ? "bg-red-600 text-white" : (type === "warning" ? "bg-emerald-600 text-white" : "bg-slate-800 text-white"));

  toast.className = `${bgClass} px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-semibold transition-all transform duration-300 opacity-0 translate-y-2 pointer-events-auto`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : (type === 'error' ? '✕' : 'ℹ')}</span>
    <span>${message}</span>
  `;

  toast.setAttribute("role", ["error", "warning"].includes(type) ? "alert" : "status");
  container.appendChild(toast);
  setTimeout(() => toast.classList.remove("opacity-0", "translate-y-2"), 10);
  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-y-2");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function resumeCourseSignIn() {
  const destination = location.pathname === "/sso/authorize" ? location.href : new URLSearchParams(location.search).get("sso_return");
  if (!destination) return false;
  const url = new URL(destination, location.origin);
  if (url.origin !== location.origin || url.pathname !== "/sso/authorize") return false;
  const query = url.searchParams;
  const callback = "https://sdgs-attendance-record.vercel.app/auth/sso/callback";
  if (query.get("client_id") !== "attendance" || query.get("redirect_uri") !== callback ||
      !/^[A-Za-z0-9_-]{43}$/.test(query.get("code_challenge") || "") ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(query.get("state") || "")) {
    showToast("登入連結無效，請從課程登錄重新開始。", "error");
    return true;
  }
  const signIn = () => {
    if (query.get("login_type") === "staff") { showLoginModal(false); handleAdminAccess(); }
    else showLoginModal(true);
  };
  if (!state.token) { signIn(); return true; }
  (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/sso/ticket`, {
        method: "POST", headers: {"Content-Type": "application/json", Authorization: `Bearer ${state.token}`},
        body: JSON.stringify({client_id: "attendance", redirect_uri: callback, code_challenge: query.get("code_challenge"), account_type: query.get("login_type") === "staff" ? "staff" : "student"})
      });
      if (response.status === 401) { handleLogout(); signIn(); return; }
      if (response.status === 403) { signIn(); return; }
      if (!response.ok) throw new Error();
      const data = await response.json();
      const target = new URL(callback);
      target.searchParams.set("code", data.code);
      target.searchParams.set("state", query.get("state"));
      location.replace(target.href);
    } catch {
      showToast("目前無法完成登入，請稍後再從課程登錄重試。", "error");
    }
  })();
  return true;
}
