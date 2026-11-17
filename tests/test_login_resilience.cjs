const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/static/js/app.js'), 'utf8');

function setup(fetch) {
  const elements = {};
  const events = [];
  const context = vm.createContext({
    API_BASE: '/api', AbortController, setTimeout, clearTimeout, TypeError, URL, fetch,
    state: {token: null},
    document: {getElementById: id => elements[id] ||= {value: 'test', classList: {add() {}, remove() {}}}},
    localStorage: {setItem: () => events.push('stored')},
    showLoginModal() {}, updateUserUI() {}, showToast() {}, resumeCourseSignIn: () => false,
    switchTab: tab => events.push(tab), location: {hash: ''},
    loadCenterActions: () => { throw Error('unnecessary dependency'); },
    loadSDGsData: () => { throw Error('unnecessary dependency'); },
    loadGameSettings: () => { throw Error('unnecessary dependency'); },
  });
  vm.runInContext(source.slice(source.indexOf('async function requestLogin('), source.indexOf('function handleLogout()')), context);
  return {context, elements, events};
}

test('non-JSON server failures and structured 503 give useful messages without client retries', async () => {
  for (const response of [
    {status: 500, json: async () => {throw new SyntaxError('not JSON');}},
    {status: 503, json: async () => ({request_id: 'test-id'})},
  ]) {
    let calls = 0;
    const {context} = setup(async () => {calls++; return response;});
    await assert.rejects(context.requestLogin({}), /系統暫時忙碌/);
    assert.equal(calls, 1);
  }
});

test('credential rejection remains distinct from a connection failure', async () => {
  const {context, elements} = setup(async () => ({ok: false, status: 400, json: async () => ({detail: '帳號或密碼錯誤'})}));
  await context.handleAdminLogin({preventDefault() {}});
  assert.equal(elements.adminLoginError.textContent, '帳號或密碼錯誤');
  assert.equal(context.state.token, null);
});

test('duplicate submissions issue only one login, restore button and skip unrelated data loading', async () => {
  let finish, calls = 0;
  const {context, events} = setup(() => {calls++; return new Promise(resolve => finish = resolve);});
  const button = {disabled: false};
  const event = {preventDefault() {}, submitter: button};
  const first = context.handleAdminLogin(event);
  assert.equal(button.disabled, true);
  await context.handleAdminLogin(event);
  assert.equal(calls, 1);
  finish({ok: true, status: 200, json: async () => ({token: 'test', user: {role: 'admin', name: 'Test'}})});
  await first;
  assert.equal(button.disabled, false);
  assert.equal(context.state.loginPending, false);
  assert.deepEqual(events, ['stored', 'admin']);
});

test('the request timeout aborts once and offers retry instead of waiting indefinitely', async () => {
  let expire;
  const {context} = setup((_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(Error(), {name: 'AbortError'})));
  }));
  context.setTimeout = fn => {expire = fn; return 1;};
  context.clearTimeout = () => {};
  const pending = context.requestLogin({});
  expire();
  await assert.rejects(pending, /登入等候逾時/);
});

test('temporary auth verification errors preserve the saved session, but 401 clears it', async () => {
  for (const status of [503, 401]) {
    const {context} = setup(async () => ({ok: false, status}));
    context.state.token = 'saved';
    let loggedOut = false;
    context.handleLogout = () => {loggedOut = true;};
    vm.runInContext(source.slice(source.indexOf('async function checkAuth('), source.indexOf('async function requestLogin(')), context);
    await context.checkAuth(false);
    assert.equal(loggedOut, status === 401);
  }
});
