const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/static/js/app.js'), 'utf8');
const switching = source.slice(source.indexOf('function switchTab('), source.indexOf('async function checkAuth('));
const closing = source.slice(source.indexOf('function closeStudentLogin()'), source.indexOf('function showLoginModal('));
const auth = source.slice(source.indexOf('async function checkAuth('), source.indexOf('async function handleLogin('));

function setup(user, token = null) {
  const events = [];
  const state = { user, token, activeTab: 'home' };
  const pane = { classList: { remove: () => events.push('worksheetVisible') } };
  const tools = { hidden: true, classList: { toggle: (_, hidden) => { tools.hidden = hidden; } } };
  const context = vm.createContext({
    state, URLSearchParams, location: { pathname: '/', search: '', replace: value => events.push(['redirect', value]) },
    document: { querySelectorAll: () => [], querySelector: () => null, getElementById: id => id === 'worksheetTools' ? tools : id === 'tabPane_worksheet' ? pane : null },
    loadLeaderboard() {}, loadAdminDashboard() {},
    showLoginModal: show => events.push(['login', show]),
  });
  vm.runInContext(switching + closing + auth, context);
  return { context, state, events, tools };
}

test('guests and staff see student login instead of the worksheet', () => {
  for (const user of [null, {role:'admin',account_type:'staff'}]) {
    const {context,state,events} = setup(user, user ? 'staff-token' : null);
    context.switchTab('worksheet');
    assert.deepEqual(events, [['login',true]]);
    assert.equal(state.activeTab,'home');
    assert.equal(state.studentDestination,'worksheet');
  }
});

test('a verified student can open the worksheet without another login', () => {
  const {context,state,events} = setup({role:'student',account_type:'student'},'student-token');
  context.switchTab('worksheet');
  assert.equal(state.activeTab,'worksheet');
  assert.deepEqual(events,['worksheetVisible']);
});

test('closing student login returns home and cancels pending access', () => {
  const {context,state,events} = setup(null);
  state.studentDestination = 'worksheet';
  context.closeStudentLogin();
  assert.equal(state.activeTab,'home');
  assert.equal(state.studentDestination,null);
  assert.deepEqual(events,[['login',false]]);
});

test('closing course SSO login leaves the pending authorization flow', () => {
  const {context,events} = setup(null);
  context.location.pathname = '/sso/authorize';
  context.closeStudentLogin();
  assert.deepEqual(events,[['login',false],['redirect','/']]);
});

test('returning to the toolbox as a guest does not prompt for login', async () => {
  const {context,state,events} = setup(null);
  context.switchTab('food');
  await context.checkAuth();
  assert.equal(state.activeTab, 'food');
  assert.deepEqual(events, []);
});

test('guest worksheet access still prompts for login during initialization', async () => {
  const {context,state,events} = setup(null);
  context.switchTab('worksheet');
  await context.checkAuth();
  assert.equal(state.studentDestination, 'worksheet');
  assert.deepEqual(events, [['login', true]]);
});

test('learning buttons appear only on the worksheet and hide on other tabs', () => {
  const {context,state,tools} = setup({role:'student'}, 'student-token');
  state.earthDefense = {active: true};
  for (const tab of ['home', 'food', 'carbon', 'sdgs', 'earth_defense', 'leaderboard', 'admin']) {
    context.switchTab('worksheet');
    assert.equal(tools.hidden, false);
    context.switchTab(tab);
    assert.equal(tools.hidden, true, tab);
  }
});

test('blocked worksheet access does not reveal learning buttons', () => {
  const {context,tools} = setup(null);
  context.switchTab('worksheet');
  assert.equal(tools.hidden, true);
});

test('returning students enter the worksheet before the activity catalog finishes loading', async () => {
  const {context,state,tools,events} = setup(null, 'student-token');
  let start, releaseCatalog;
  const catalog = new Promise(resolve => { releaseCatalog = resolve; });
  context.location.hash = '#worksheet';
  context.document.addEventListener = (_, callback) => { start = callback; };
  Object.assign(context, {
    API_BASE: '/api', initUIEvents() {}, resumeCourseSignIn: () => false,
    loadCenterActions: () => catalog,
    fetch: async () => ({ok: true, json: async () => ({role:'student',account_type:'student'})}),
    updateUserUI() {}, loadMyWorksheets() {}, loadSDGsData() {}, loadGameSettings() {},
  });
  const init = source.slice(source.indexOf('document.addEventListener("DOMContentLoaded"'), source.indexOf('function initUIEvents()'));
  vm.runInContext(init, context);
  const completed = start();
  await new Promise(setImmediate);
  try {
    assert.equal(state.activeTab, 'worksheet');
    assert.equal(tools.hidden, false);
    assert.equal(events.some(event => Array.isArray(event) && event[0] === 'login' && event[1]), false);
  } finally {
    releaseCatalog();
    await completed;
  }
});
