const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../app/static/js/activity-details.js'), 'utf8');

function setup() {
  const elements = new Map();
  const notices = [];
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { value: '', dataset: {}, classList: { toggle() {} }, focus() { this.focused = true; } });
      return elements.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const context = vm.createContext({ document, state: { centerActions: [] }, showToast: message => notices.push(message) });
  vm.runInContext(source, context);
  return { context, document, notices };
}

test('dates round trip through form collection and reset when loading an old or blank worksheet', () => {
  const { context, document } = setup();
  context.loadActivityDetails({ start_date: '2026-10-19', end_date: '2026-10-21' });
  assert.equal(context.collectActivityDetails().start_date, '2026-10-19');
  assert.equal(context.collectActivityDetails().end_date, '2026-10-21');
  assert.match(context.describeActivity(context.collectActivityDetails()), /開始日期：2026-10-19\n結束日期：2026-10-21/);
  for (const old of [{ purpose: '原本的內容' }, null]) {
    context.loadActivityDetails(old);
    assert.equal(document.getElementById('ws_activity_start_date').value, '');
    assert.equal(document.getElementById('ws_activity_end_date').value, '');
  }
});

test('date range requires both dates and accepts same-day dates', () => {
  const { context, notices } = setup();
  const details = { purpose: '目的', process: '流程', features: '特色', audience: '親子', participants: null, volunteers: null };
  for (const [start_date, end_date, valid] of [
    ['', '', false], ['2026-10-19', '2026-10-19', true], ['2026-10-19', '2026-10-20', true],
    ['2026-10-20', '2026-10-19', false], ['2026-10-19', '', false], ['', '2026-10-20', false],
  ]) assert.equal(context.validateActivityDetails({ ...details, start_date, end_date }), valid);
  assert.ok(notices.includes('活動結束日期不可早於開始日期。'));
});

test('missing dates identify and focus the missing field before validating other details', () => {
  for (const [start_date, end_date, message, field] of [
    ['', '', '請填寫開始日期與結束日期。', 'start_date'],
    ['', '2026-10-20', '請填寫開始日期。', 'start_date'],
    ['2026-10-19', '', '請填寫結束日期。', 'end_date'],
  ]) {
    const { context, document, notices } = setup();
    assert.equal(context.validateActivityDetails({start_date, end_date}), false);
    assert.equal(notices[0], message);
    assert.equal(document.getElementById(`ws_activity_${field}`).focused, true);
  }
});

test('draft and submit both stop on missing dates even before choosing a center action', async () => {
  const app = fs.readFileSync(path.join(__dirname, '../app/static/js/app.js'), 'utf8');
  for (const status of ['draft', 'submitted']) {
    const { context, document, notices } = setup();
    let requests = 0;
    context.state.user = {name: 'Test'};
    context.fetch = async () => { requests++; };
    vm.runInContext(app.slice(app.indexOf('async function saveWorksheet('), app.indexOf('async function loadMyWorksheets(')), context);
    await context.saveWorksheet(status);
    assert.equal(notices[0], '請填寫開始日期與結束日期。');
    assert.equal(requests, 0);
    assert.equal(document.getElementById('ws_activity_start_date').focused, true);
  }
});
