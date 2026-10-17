const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/static/js/app.js'), 'utf8');
const init = source.slice(source.indexOf('document.addEventListener("DOMContentLoaded"'), source.indexOf('function initUIEvents()'));
const access = source.slice(source.indexOf('function handleAdminAccess()'), source.indexOf('function switchTab('));
const auth = source.slice(source.indexOf('async function checkAuth('), source.indexOf('async function handleLogin('));

async function run(role, expired = false) {
  let start, release;
  const events = [];
  const modal = { hidden: true, classList: { remove() { modal.hidden = false; } } };
  const center = new Promise(resolve => { release = resolve; });
  const state = { token: role ? 'existing-token' : null, user: null };
  const context = vm.createContext({
    state, API_BASE: '/api', location: { hash: '#admin', search: '' }, URLSearchParams,
    document: { addEventListener: (_, callback) => { start = callback; }, getElementById: id => id === 'adminLoginModal' ? modal : { classList: { add() {} } } },
    initUIEvents() {}, resumeCourseSignIn: () => false,
    switchTab: tab => { state.activeTab = tab; events.push(['tab', tab]); },
    switchAdminSubTab: tab => events.push(['subtab', tab]),
    showLoginModal: show => events.push(['studentLogin', show]), updateUserUI() {},
    handleLogout: () => { state.token = null; state.user = null; },
    loadCenterActions: () => { events.push(['center']); return center; },
    loadMyWorksheets: () => { events.push(['worksheets']); }, loadSDGsData() {}, loadGameSettings() {},
    fetch: async () => ({ ok: !expired, json: async () => ({ role }) }),
  });
  vm.runInContext(access + auth + init, context);
  const completion = start();
  await new Promise(setImmediate);
  // The catalog is still pending: management access must already be resolved.
  const result = { events, modal, state, loginBeforeCatalog: !modal.hidden,
    dashboardBeforeCatalog: events.some(event => event[0] === 'subtab' && event[1] === 'dashboard') };
  release();
  await completion;
  return result;
}

test('signed-out admin links open the management login without student login', async () => {
  const { events, modal, loginBeforeCatalog } = await run(null);
  assert.equal(loginBeforeCatalog, true);
  assert.equal(modal.hidden, false);
  assert.equal(events.some(event => event[0] === 'studentLogin' && event[1]), false);
  assert.equal(events.some(event => event[0] === 'worksheets'), false);
});

test('student sessions must use the dedicated management login', async () => {
  const { modal, events } = await run('student');
  assert.equal(modal.hidden, false);
  assert.equal(events.some(event => event[0] === 'tab' && event[1] === 'admin'), false);
});

test('verified administrators and teachers enter the dashboard directly', async () => {
  for (const role of ['admin', 'teacher']) {
    const { modal, events, dashboardBeforeCatalog } = await run(role);
    assert.equal(dashboardBeforeCatalog, true);
    assert.equal(modal.hidden, true);
    assert.ok(events.some(event => event[0] === 'subtab' && event[1] === 'dashboard'));
    assert.equal(events.some(event => event[0] === 'worksheets'), false);
  }
});

test('expired sessions show management login instead of entering the dashboard', async () => {
  const { modal, events } = await run('admin', true);
  assert.equal(modal.hidden, false);
  assert.equal(events.some(event => event[0] === 'subtab'), false);
});
