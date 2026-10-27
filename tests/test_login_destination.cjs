const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/static/js/app.js'), 'utf8');
const handler = source.slice(source.indexOf('async function handleLogin('), source.indexOf('async function handleAdminLogin('));

function setup({destination = null, sso = false, ok = true, multiple = false} = {}) {
  const events = [];
  const elements = Object.fromEntries(['loginAccount', 'loginPassword', 'loginAcademicYear', 'loginError', 'studentPickerBox', 'studentPickerList'].map(id => [id, {
    value: id === 'loginAcademicYear' ? '7' : 'test', classList: {add() {}, remove() {}}, appendChild() {},
  }]));
  const context = vm.createContext({
    state: {studentDestination: destination}, API_BASE: '/api', URL,
    document: {getElementById: id => elements[id], createElement: () => ({})},
    localStorage: {setItem: (...args) => events.push(['stored', ...args])},
    location: {replace: url => events.push(['redirect', url])},
    fetch: async (_, options) => {
      events.push(['request', JSON.parse(options.body)]);
      return {ok, json: async () => multiple ? {multiple_matches: true, students: [{id: 2}]} : {token: 'test-token', user: {name: 'Test', role: 'student'}}};
    },
    showLoginModal() {}, updateUserUI() {}, showToast() {},
    resumeCourseSignIn: () => sso,
    loadCenterActions: () => events.push(['catalog']), loadSDGsData() {}, loadGameSettings() {},
    switchTab: tab => events.push(['tab', tab]), loadMyWorksheets() {},
  });
  vm.runInContext(handler, context);
  return {context, events};
}

test('default student login starts attendance SSO with the selected academic year before loading catalogs', async () => {
  const {context, events} = setup();
  await context.handleLogin();
  assert.deepEqual(events.find(event => event[0] === 'redirect'), ['redirect', 'https://sdgs-attendance-record.vercel.app/sso/login?academic_year_id=7']);
  assert.equal(events.some(event => event[0] === 'catalog'), false);
  assert.equal(context.state.token, 'test-token');
});

test('explicit student selection follows the same default destination', async () => {
  const {context, events} = setup();
  await context.handleLogin(null, 2);
  assert.equal(events[0][1].student_id, 2);
  assert.equal(events.some(event => event[0] === 'redirect'), true);
});

test('worksheet and NSP login retain the requested destination', async () => {
  for (const destination of ['worksheet', 'nsp']) {
    const {context, events} = setup({destination});
    await context.handleLogin();
    assert.deepEqual(events.find(event => event[0] === 'tab'), ['tab', destination]);
    assert.equal(events.some(event => event[0] === 'redirect'), false);
  }
});

test('pending SSO, invalid credentials and unresolved student matches do not start a second redirect', async () => {
  for (const options of [{sso: true}, {ok: false}, {multiple: true}]) {
    const {context, events} = setup(options);
    await context.handleLogin();
    assert.equal(events.some(event => event[0] === 'redirect'), false);
  }
});
