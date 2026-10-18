const activityPlanFields = {
  purpose: '1. 活動目的與理念', process: '2. 活動流程與內容',
  features: '3. 活動創意與特色', audience: '4. 預計參與對象'
};
const activityResultFields = {
  participants: '實際參與人數', volunteers: '服務義工人數', results: '5. 活動成果與效益',
  feedback: '6. 參與者回饋與感受', improvements: '7. 檢討與改善建議'
};

function setActivityPhase(phase) {
  document.getElementById('ws_activityPhase').value = phase;
  document.getElementById('activityResults').classList.toggle('hidden', phase !== 'after');
  document.querySelectorAll('[data-activity-phase]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.activityPhase === phase));
  });
}

function applyActivityTemplate(fillExamples = false) {
  const selected = document.querySelector("input[name='center_action']:checked");
  const action = (state.centerActions || []).find(item => item.category === selected?.value && item.name === selected?.dataset.action);
  const template = action?.template || {};
  Object.keys(activityPlanFields).forEach(field => {
    const input = document.getElementById(`ws_activity_${field}`);
    if (fillExamples && (!input.value || input.value === input.dataset.templateValue)) input.value = template[field] || '';
    input.dataset.templateValue = template[field] || '';
  });
  Object.keys(activityResultFields).forEach(field => {
    document.getElementById(`ws_activity_${field}`).placeholder = template[field] || '';
  });
}

function initActivityDetails() {
  document.querySelectorAll('[data-activity-phase]').forEach(button => {
    button.addEventListener('click', () => setActivityPhase(button.dataset.activityPhase));
  });
  document.getElementById('ws_activity_name').addEventListener('focus', () => {
    if (!document.querySelector("input[name='center_action']:checked")) {
      showToast('請先選擇：活動分類。', 'warning');
      document.getElementById('centerActionSearch').focus();
    }
  });
  document.getElementById('centerActionOptions').addEventListener('change', () => applyActivityTemplate(true));
}

function loadActivityDetails(details) {
  setActivityPhase(details?.phase || 'before');
  ['name', ...Object.keys(activityPlanFields), ...Object.keys(activityResultFields)].forEach(field => {
    const input = document.getElementById(`ws_activity_${field}`);
    input.value = details?.[field] ?? '';
    input.dataset.templateValue = '';
  });
  applyActivityTemplate(false);
}

function collectActivityDetails() {
  const details = {phase: document.getElementById('ws_activityPhase').value};
  ['name', ...Object.keys(activityPlanFields), ...Object.keys(activityResultFields)].forEach(field => {
    const value = document.getElementById(`ws_activity_${field}`).value.trim();
    details[field] = ['participants', 'volunteers'].includes(field) ? (value === '' ? null : Number(value)) : value;
  });
  return details;
}

function validateActivityDetails(details) {
  for (const [field, label] of Object.entries(activityPlanFields)) {
    if (!details[field]) {
      showToast(`請填寫${label}！`, 'error');
      document.getElementById(`ws_activity_${field}`).focus();
      return false;
    }
  }
  for (const field of ['participants', 'volunteers']) {
    if (details[field] !== null && (!Number.isInteger(details[field]) || details[field] < 0)) {
      showToast(`${activityResultFields[field]}請填寫 0 以上的整數！`, 'error');
      document.getElementById(`ws_activity_${field}`).focus();
      return false;
    }
  }
  return true;
}

function describeActivity(details) {
  if (!details) return '';
  const fields = {...activityPlanFields, ...(details.phase === 'after' ? activityResultFields : {})};
  return [details.phase === 'before' ? '活動前｜規劃' : '活動後｜成果', `活動名稱：${details.name}`,
    ...Object.entries(fields).map(([field, label]) => `${label}：${details[field] ?? ''}`)].join('\n');
}
