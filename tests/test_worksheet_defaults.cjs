const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/app.js'), 'utf8');
const defaults = source.slice(source.indexOf('function renderDefaultWorksheetRows()'), source.indexOf('function addRadialLineRow('));
const load = source.slice(source.indexOf('window.loadWorksheetToForm ='), source.indexOf('window.deleteWorksheetConfirm ='));
const loadLatest = source.slice(source.indexOf('async function loadMyWorksheets('), source.indexOf('function renderMyWorksheetsBadge('));

function setup(radialCount = 0) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        children: [],
        set innerHTML(value) { this.children = []; },
        classList: { add() {} },
      });
      return elements.get(id);
    },
  };
  const radial = document.getElementById('radialLinesContainer');
  radial.children = Array(radialCount).fill({});
  const tradeoff = document.getElementById('tradeoffContainer');
  const context = vm.createContext({
    document, window: {}, state: { worksheetsList: [] },
    addRadialLineRow: () => radial.children.push({}),
    addTradeoffRow: data => tradeoff.children.push(data || {}),
    restoreCenterAction() {}, renderCausalChains() {}, updateCenterActionSelection() {},
    loadActivityDetails() {},
  });
  vm.runInContext(defaults + load, context);
  return { context, radial, tradeoff };
}

test('default rows include one tradeoff even when radial rows already exist', () => {
  for (const radialCount of [0, 3]) {
    const { context, radial, tradeoff } = setup(radialCount);
    context.renderDefaultWorksheetRows();
    context.renderDefaultWorksheetRows();
    assert.equal(radial.children.length, 3);
    assert.equal(tradeoff.children.length, 1);
  }
});

test('loading empty tradeoffs provides one row and preserves existing entries', () => {
  for (const data of [undefined, [], [{ who: '植被' }, { who: '居民' }]]) {
    const { context, tradeoff } = setup();
    context.state.worksheetsList = [{ id: 1, tradeoff_data: data }];
    context.window.loadWorksheetToForm(1, true);
    assert.equal(tradeoff.children.length, data?.length || 1);
    if (data?.length) assert.deepEqual(tradeoff.children, data);
  }
});

test('automatic latest worksheet load keeps the initial tradeoff row visible', async () => {
  const { context, tradeoff } = setup();
  context.state.token = 'test';
  context.API_BASE = '/api';
  context.fetch = async () => ({ ok: true, json: async () => [{ id: 1, tradeoff_data: [] }] });
  context.renderMyWorksheetsBadge = () => {};
  context.console = { error(error) { throw error; } };
  context.loadWorksheetToForm = context.window.loadWorksheetToForm;
  vm.runInContext(loadLatest, context);
  context.renderDefaultWorksheetRows();
  assert.equal(tradeoff.children.length, 1);
  await context.loadMyWorksheets(true);
  assert.equal(tradeoff.children.length, 1);
});
