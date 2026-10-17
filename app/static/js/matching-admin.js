const AdminApp = {
  token: localStorage.getItem("sdgs_admin_token") || null,

  init() {
    this.bindEvents();
    if (this.token) {
      this.showApp();
    } else {
      this.showLogin();
    }
  },

  bindEvents() {
    // Login
    document.getElementById("btn-do-login").addEventListener("click", () => this.handleLogin());
    document.getElementById("admin-pass").addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.handleLogin();
    });

    // Logout
    document.getElementById("btn-logout").addEventListener("click", () => this.handleLogout());

    // Sidebar tab switching
    document.querySelectorAll(".sidebar-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".sidebar-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-pane").forEach(p => p.style.display = "none");

        btn.classList.add("active");
        const targetTab = btn.dataset.tab;
        document.getElementById(targetTab).style.display = "block";

        if (targetTab === "tab-dashboard") this.loadStats();
        if (targetTab === "tab-records") this.loadRecords();
        if (targetTab === "tab-targets") this.loadTargets();
        if (targetTab === "tab-settings") this.loadSettings();
      });
    });

    // Records search & CSV Export
    document.getElementById("record-search").addEventListener("input", (e) => {
      this.debounce(() => this.loadRecords(e.target.value), 400);
    });
    document.getElementById("btn-export-csv").addEventListener("click", () => this.exportCsv());

    // Target search & filter
    document.getElementById("target-goal-filter").addEventListener("change", () => this.loadTargets());
    document.getElementById("target-search").addEventListener("input", () => {
      this.debounce(() => this.loadTargets(), 400);
    });

    // Modal close
    document.getElementById("admin-modal-close").addEventListener("click", () => {
      document.getElementById("admin-modal").classList.remove("open");
    });
  },

  debounceTimer: null,
  debounce(func, wait) {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(func, wait);
  },

  async handleLogin() {
    const username = document.getElementById("admin-user").value.trim();
    const password = document.getElementById("admin-pass").value;

    try {
      const res = await fetch("/api/matching-admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      if (!res.ok) {
        alert("登入失敗：請確認管理員帳號密碼。");
        return;
      }

      const data = await res.json();
      this.token = data.token;
      localStorage.setItem("sdgs_admin_token", this.token);
      this.showApp();
    } catch (e) {
      console.error(e);
      alert("連線後端發生錯誤。");
    }
  },

  handleLogout() {
    this.token = null;
    localStorage.removeItem("sdgs_admin_token");
    this.showLogin();
  },

  showLogin() {
    document.getElementById("section-login").style.display = "block";
    document.getElementById("section-admin-app").style.display = "none";
    document.getElementById("btn-logout").style.display = "none";
  },

  showApp() {
    document.getElementById("section-login").style.display = "none";
    document.getElementById("section-admin-app").style.display = "flex";
    document.getElementById("btn-logout").style.display = "inline-flex";
    this.populateGoalFilter();
    this.loadStats();
  },

  getAuthHeaders() {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.token}`
    };
  },

  async loadStats() {
    try {
      const res = await fetch("/api/matching-admin/stats", { headers: this.getAuthHeaders() });
      if (res.status === 401) return this.handleLogout();
      const data = await res.json();

      document.getElementById("kpi-challengers").innerText = data.summary.total_challengers;
      document.getElementById("kpi-sessions").innerText = data.summary.total_sessions;
      document.getElementById("kpi-avg-score").innerText = `${data.summary.avg_score} 分`;
      document.getElementById("kpi-avg-accuracy").innerText = `${data.summary.avg_accuracy_pct}%`;

      // Most mistaken list
      const mistakenEl = document.getElementById("list-most-mistaken");
      if (data.most_mistaken_targets && data.most_mistaken_targets.length > 0) {
        mistakenEl.innerHTML = data.most_mistaken_targets.map(item => `
          <div style="background:#fef2f2; border-left:4px solid #ef4444; padding:0.75rem; border-radius:4px;">
            <div style="display:flex; justify-content:space-between; font-size:0.85rem;">
              <strong style="color:#991b1b;">細項 ${item.code} (${item.goal_name})</strong>
              <span style="color:#dc2626; font-weight:700;">累計答錯 ${item.wrong_count} 次</span>
            </div>
            <p style="font-size:0.8rem; color:#475569; margin-top:4px;">${item.description}</p>
          </div>
        `).join("");
      } else {
        mistakenEl.innerHTML = `<p style="color:#64748b; font-size:0.85rem;">尚未有足夠答錯資料記錄。</p>`;
      }

      // Mode stats
      const modeEl = document.getElementById("list-mode-stats");
      if (data.mode_breakdown && data.mode_breakdown.length > 0) {
        modeEl.innerHTML = data.mode_breakdown.map(item => {
          const modeName = AdminApp.MODE_NAMES[item.mode] || item.mode_zh || item.mode;
          return `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:0.75rem; border-radius:6px; border:1px solid #e2e8f0;">
              <div>
                <span class="badge-mode">${modeName}</span>
                <span style="font-size:0.85rem; margin-left:0.5rem; color:#334155;">平均得分: <strong>${Math.round(item.avg_score)}</strong></span>
              </div>
              <strong style="font-size:1rem; color:#15803d;">${item.count} 次遊玩</strong>
            </div>
          `;
        }).join("");
      } else {
        modeEl.innerHTML = `<p style="color:#64748b; font-size:0.85rem;">暫無對局資料。</p>`;
      }
    } catch (e) {
      console.error(e);
    }
  },

  MODE_NAMES: {
    scenario: "生活情境入門",
    standard: "標準細項配對",
    cards: "翻牌記憶連連看",
    master169: "169細項極限闖關"
  },

  currentRecordMode: "scenario",

  MODE_DESCRIPTIONS: {
    scenario: "日常生活案例與 17 目標配對之挑戰紀錄",
    standard: "169 細項具體承諾判斷所屬 17 大目標之挑戰紀錄",
    cards: "16 卡牌翻牌短時記憶兩兩連線配對之挑戰紀錄",
    master169: "30 題極限高壓綜合測驗之挑戰紀錄"
  },

  switchRecordMode(mode) {
    this.currentRecordMode = mode;
    document.querySelectorAll(".admin-tab-btn").forEach(btn => {
      if (btn.dataset.mode === mode) btn.classList.add("active");
      else btn.classList.remove("active");
    });

    const modeName = this.MODE_NAMES[mode] || mode;
    const descEl = document.getElementById("admin-mode-desc");
    if (descEl) {
      descEl.innerHTML = `<strong>${modeName} 排行榜：</strong>${this.MODE_DESCRIPTIONS[mode] || ''}`;
    }

    const exportBtn = document.getElementById("btn-export-csv");
    if (exportBtn) {
      exportBtn.innerText = `📥 匯出「${modeName}」CSV 報表`;
    }

    const searchInput = document.getElementById("record-search");
    this.loadRecords(searchInput ? searchInput.value.trim() : "");
  },

  async loadRecords(searchQuery = "") {
    try {
      const mode = this.currentRecordMode || "scenario";
      const url = `/api/matching-admin/records?page=1&page_size=50&mode=${mode}${searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : ''}`;
      const res = await fetch(url, { headers: this.getAuthHeaders() });
      if (res.status === 401) return this.handleLogout();
      const data = await res.json();

      const countEl = document.getElementById("admin-mode-count");
      if (countEl) {
        countEl.innerText = `共 ${data.total} 筆挑戰紀錄`;
      }

      const tbody = document.getElementById("records-tbody");
      if (!data.items || data.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:2rem; color:#64748b;">目前「${this.MODE_NAMES[mode] || mode}」尚無符合條件之挑戰紀錄</td></tr>`;
        return;
      }

      tbody.innerHTML = data.items.map((item, idx) => `
        <tr>
          <td><strong>#${item.id}</strong></td>
          <td>
            <div style="display:flex; align-items:center; gap:0.35rem;">
              <span>${item.avatar || '🌱'}</span>
              <strong>${item.nickname}</strong>
            </div>
          </td>
          <td>${item.organization || "-"}</td>
          <td><span class="badge-mode">${this.MODE_NAMES[item.mode] || item.mode}</span></td>
          <td><strong style="color:#10b981; font-size:1rem;">${item.total_score}</strong></td>
          <td>${Math.round(item.correct_count * 100 / (item.total_questions || 1))}%</td>
          <td>🔥 ${item.combo_max}</td>
          <td>${item.time_taken_seconds}s</td>
          <td style="font-size:0.8rem; color:#64748b;">${item.completed_at ? item.completed_at.slice(0, 16) : '-'}</td>
          <td>
            <button class="btn btn-outline" style="color:#ef4444; border-color:#fca5a5; padding:2px 8px; font-size:0.75rem;" onclick="AdminApp.deleteRecord(${item.id})">刪除</button>
          </td>
        </tr>
      `).join("");
    } catch (e) {
      console.error(e);
    }
  },

  async deleteRecord(sessionId) {
    if (!confirm(`確定要刪除對局紀錄 #${sessionId} 嗎？此動作無法復原。`)) return;
    try {
      const res = await fetch(`/api/matching-admin/records/${sessionId}`, {
        method: "DELETE",
        headers: this.getAuthHeaders()
      });
      if (res.ok) {
        this.loadRecords();
        this.loadStats();
      } else {
        alert("刪除失敗。");
      }
    } catch (e) {
      console.error(e);
    }
  },

  async populateGoalFilter() {
    try {
      const res = await fetch("/api/matching-admin/goals");
      const goals = await res.json();
      const sel = document.getElementById("target-goal-filter");
      sel.innerHTML = '<option value="">全部 17 目標</option>' + goals.map(g => `<option value="${g.id}">SDG ${g.id} ${g.name}</option>`).join("");
    } catch (e) {}
  },

  async loadTargets() {
    const goalId = document.getElementById("target-goal-filter").value;
    const search = document.getElementById("target-search").value.trim();

    try {
      let url = "/api/matching-admin/targets?";
      if (goalId) url += `goal_id=${goalId}&`;
      if (search) url += `search=${encodeURIComponent(search)}`;

      const res = await fetch(url, { headers: this.getAuthHeaders() });
      if (res.status === 401) return this.handleLogout();
      const targets = await res.json();

      const tbody = document.getElementById("targets-tbody");
      tbody.innerHTML = targets.map(t => `
        <tr>
          <td><strong>${t.code}</strong></td>
          <td><span style="color:${t.goal_color}; font-weight:700;">SDG ${t.goal_id} ${t.goal_name}</span></td>
          <td><span style="font-size:0.75rem; background:#f1f5f9; padding:2px 6px; border-radius:4px;">${t.type}</span></td>
          <td style="font-size:0.85rem; max-width:350px;">${t.description}</td>
          <td>
            <span style="color:${t.is_active ? '#10b981' : '#ef4444'}; font-weight:700;">${t.is_active ? '啟用' : '停用'}</span>
          </td>
          <td>
            <button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem;" onclick='AdminApp.editTargetModal(${JSON.stringify(t)})'>編輯</button>
          </td>
        </tr>
      `).join("");
    } catch (e) {
      console.error(e);
    }
  },

  editTargetModal(target) {
    const modal = document.getElementById("admin-modal");
    document.getElementById("admin-modal-title").innerText = `編輯細項目標 ${target.code}`;
    const body = document.getElementById("admin-modal-body");

    body.innerHTML = `
      <div class="form-group">
        <label>細項編號與類別</label>
        <input type="text" class="form-input" value="${target.code} (${target.type})" disabled>
      </div>
      <div class="form-group">
        <label>細項詳細內容說明</label>
        <textarea id="edit-target-desc" class="form-input" style="height:120px; font-size:0.9rem;">${target.description}</textarea>
      </div>
      <div class="form-group" style="display:flex; align-items:center; gap:0.5rem;">
        <input type="checkbox" id="edit-target-active" ${target.is_active ? 'checked' : ''} style="width:18px; height:18px;">
        <label for="edit-target-active" style="margin-bottom:0; cursor:pointer;">在遊戲中啟用此指標</label>
      </div>
      <button class="btn btn-primary" style="width:100%; margin-top:1rem;" onclick="AdminApp.saveTargetEdit(${target.id})">
        儲存變更
      </button>
    `;

    modal.classList.add("open");
  },

  async saveTargetEdit(targetId) {
    const desc = document.getElementById("edit-target-desc").value.trim();
    const isActive = document.getElementById("edit-target-active").checked;

    try {
      const res = await fetch(`/api/matching-admin/targets/${targetId}`, {
        method: "PUT",
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          description: desc,
          is_active: isActive
        })
      });

      if (res.ok) {
        document.getElementById("admin-modal").classList.remove("open");
        this.loadTargets();
      } else {
        alert("更新失敗。");
      }
    } catch (e) {
      console.error(e);
    }
  },

  async loadSettings() {
    try {
      const res = await fetch("/api/matching-admin/settings", { headers: this.getAuthHeaders() });
      if (res.status === 401) return this.handleLogout();
      const settings = await res.json();

      const container = document.getElementById("settings-form");
      container.innerHTML = settings.map(s => `
        <div style="background:#f8fafc; padding:1rem; border-radius:8px; border:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h4 style="font-size:0.95rem; color:#1e293b;">${s.description}</h4>
            <span style="font-size:0.75rem; color:#64748b; font-family:monospace;">${s.key}</span>
          </div>
          <div style="display:flex; gap:0.5rem; align-items:center;">
            <input type="text" id="setting-${s.key}" class="form-input" style="width:100px; text-align:right;" value="${s.value}">
            <button class="btn btn-primary" style="padding:4px 10px; font-size:0.8rem;" onclick="AdminApp.saveSetting('${s.key}')">更新</button>
          </div>
        </div>
      `).join("");
    } catch (e) {
      console.error(e);
    }
  },

  async saveSetting(key) {
    const input = document.getElementById(`setting-${key}`);
    const value = input.value.trim();

    try {
      const res = await fetch(`/api/matching-admin/settings/${key}`, {
        method: "PUT",
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ value })
      });

      if (res.ok) {
        alert(`設定 [${key}] 已成功更新為 ${value}！`);
      } else {
        alert("設定更新失敗。");
      }
    } catch (e) {
      console.error(e);
    }
  },

  async exportCsv() {
    const mode = this.currentRecordMode || "scenario";
    const modeName = this.MODE_NAMES[mode] || mode;
    try {
      const res = await fetch(`/api/matching-admin/export/csv?mode=${mode}`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) {
        alert("匯出報表失敗，請確認登入憑證。");
        return;
      }
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `sdgs_${modeName}_挑戰紀錄.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (e) {
      console.error(e);
      // Fallback
      window.open(`/api/matching-admin/export/csv?mode=${mode}&token=${encodeURIComponent(this.token)}`, "_blank");
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  AdminApp.init();
});
