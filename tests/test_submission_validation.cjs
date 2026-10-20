const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../app/static/js/app.js'), 'utf8');
const validation = source.slice(source.indexOf('function getWorksheetSubmissionError('), source.indexOf('async function loadMyWorksheets('));

function completePayload() {
  return {
    radial_data: Array.from({ length: 3 }, () => ({ goal: 'SDG 13', mechanism: '減少排放', observable: '用電量下降' })),
    tradeoff_data: [{ who: '植被', situation: '踩踏', how: '規劃步道' }],
    causal_data: { chains: [Object.fromEntries(['start', 'start_cond', 'mid', 'mid_cond', 'result', 'result_cond', 'impact', 'measurement'].map(key => [key, '已填寫']))] },
    self_checks: [true, true, true, true],
    commitment: Object.fromEntries(['start_action', 'target_1', 'target_2', 'risk_aware', 'metric'].map(key => [key, '已填寫'])),
  };
}

function setup(payload) {
  const notices = [];
  const requests = [];
  const fields = { ws_unitName: { value: 'Test' } };
  payload.self_checks.forEach((checked, index) => { fields[`ws_check${index + 1}`] = { checked }; });
  ['Start', 'T1', 'T2', 'Risk', 'Metric'].forEach((suffix, index) => {
    fields[`ws_commit${suffix}`] = { value: payload.commitment[['start_action', 'target_1', 'target_2', 'risk_aware', 'metric'][index]] || '' };
  });
  const rows = (data, selectors) => data.map(row => ({ querySelector: selector => ({ value: row[selectors[selector]] || '' }) }));
  const context = vm.createContext({
    state: { user: { name: 'Test' }, token: 'test' }, API_BASE: '/api',
    document: {
      getElementById: id => fields[id],
      querySelector: () => ({ value: '環保', dataset: {} }),
      querySelectorAll: selector => ({
        '.radial-line-row': rows(payload.radial_data, { '.radial-goal-select': 'goal', '.radial-mech-input': 'mechanism', '.radial-obs-input': 'observable' }),
        '.tradeoff-row': rows(payload.tradeoff_data, { '.tradeoff-who': 'who', '.tradeoff-sit': 'situation', '.tradeoff-how': 'how' }),
        '.causal-chain': payload.causal_data.chains.map(row => ({ querySelectorAll: () => Object.entries(row).map(([key, value]) => ({ dataset: { causalField: key }, value })) })),
      })[selector],
    },
    showToast: message => notices.push(message),
    collectActivityDetails: () => ({purpose:'目的',process:'流程',features:'特色',audience:'對象'}), validateActivityDetails: () => true, validateActivityDates: () => true,
    fetch: async (url, options) => {
      requests.push({ url, payload: JSON.parse(options.body) });
      // Stop after the request so this test does not reset the form or fetch history.
      return { ok: false, json: async () => ({ detail: 'test response' }) };
    },
  });
  vm.runInContext(validation, context);
  return { context, notices, requests };
}

test('every required field is checked, including whitespace and each checkbox', () => {
  const { context } = setup(completePayload());
  assert.equal(context.getWorksheetSubmissionError(completePayload()), '');
  const sections = [
    ['radial_data', '三'], ['tradeoff_data', '四'], ['causal_data', '五'], ['commitment', '七'],
  ];
  for (const [section, number] of sections) {
    const row = section === 'causal_data' ? completePayload()[section].chains[0]
      : section === 'commitment' ? completePayload()[section] : completePayload()[section][0];
    for (const field of Object.keys(row)) {
      const payload = completePayload();
      const target = section === 'causal_data' ? payload[section].chains[0]
        : section === 'commitment' ? payload[section] : payload[section][0];
      target[field] = ' \n\t ';
      assert.ok(context.getWorksheetSubmissionError(payload).startsWith(number), `${section}.${field}`);
    }
  }
  for (let index = 0; index < 4; index++) {
    const payload = completePayload();
    payload.self_checks[index] = false;
    assert.ok(context.getWorksheetSubmissionError(payload).startsWith('六'));
  }
});

test('submit blocks incomplete data before fetch, while drafts can still be saved', async () => {
  const payload = completePayload();
  payload.tradeoff_data = [];
  const { context, notices, requests } = setup(payload);
  await context.saveWorksheet('submitted');
  assert.equal(requests.length, 0);
  assert.ok(notices[0].startsWith('四'));
  await context.saveWorksheet('draft');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].payload.status, 'draft');
});

test('complete submission reaches the API with all required data', async () => {
  const { context, requests } = setup(completePayload());
  await context.saveWorksheet('submitted');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].payload.status, 'submitted');
  assert.equal(requests[0].payload.radial_data.length, 3);
});
