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
      if (!elements.has(id)) elements.set(id, { value: '', dataset: {}, classList: { toggle() {} }, focus() {} });
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
  assert.match(context.describeActivity(context.collectActivityDetails()), /活動日期區間：2026-10-19 ～ 2026-10-21/);
  for (const old of [{ purpose: '原本的內容' }, null]) {
    context.loadActivityDetails(old);
    assert.equal(document.getElementById('ws_activity_start_date').value, '');
    assert.equal(document.getElementById('ws_activity_end_date').value, '');
  }
});

test('date range accepts blank or same-day dates and rejects incomplete or reversed ranges', () => {
  const { context, notices } = setup();
  const details = { purpose: '目的', process: '流程', features: '特色', audience: '親子', participants: null, volunteers: null };
  for (const [start_date, end_date, valid] of [
    ['', '', true], ['2026-10-19', '2026-10-19', true], ['2026-10-19', '2026-10-20', true],
    ['2026-10-20', '2026-10-19', false], ['2026-10-19', '', false], ['', '2026-10-20', false],
  ]) assert.equal(context.validateActivityDetails({ ...details, start_date, end_date }), valid);
  assert.ok(notices.includes('活動結束日期不可早於開始日期。'));
});
