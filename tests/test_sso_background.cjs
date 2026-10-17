const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/static/js/app.js'), 'utf8');
const handler = source.slice(source.indexOf('function resumeCourseSignIn()'));
const callback = 'https://sdgs-attendance-record.vercel.app/auth/sso/callback';

function setup({ token = 'existing-token', staff = false, status = 200, redirect = callback } = {}) {
  const query = new URLSearchParams({ client_id: 'attendance', redirect_uri: redirect, state: 's'.repeat(43), code_challenge: 'c'.repeat(43), login_type: staff ? 'staff' : 'student' });
  const url = new URL('https://sdgs-action-platform.vercel.app/sso/authorize?' + query);
  const events = [];
  const state = { token, user: null };
  const context = vm.createContext({
    URL, URLSearchParams, API_BASE: '/api', state,
    location: { href: url.href, pathname: url.pathname, search: url.search, origin: url.origin, replace: target => events.push(['redirect', target]) },
    fetch: async (path, options) => { events.push(['request', path, options]); return { status, ok: status === 200, json: async () => ({ code: 'one-time-code' }) }; },
    showLoginModal: show => events.push(['login', show]), handleAdminAccess: () => events.push(['staff']),
    handleLogout: () => { state.token = null; events.push(['logout']); }, showToast: message => events.push(['error', message]),
  });
  vm.runInContext(handler, context);
  return { context, events };
}

test('an existing login authorizes in the background with only one request', async () => {
  const { context, events } = setup();
  assert.equal(context.resumeCourseSignIn(), true);
  await new Promise(setImmediate);
  assert.deepEqual(events.map(event => event[0]), ['request', 'redirect']);
  assert.equal(events[0][1], '/api/auth/sso/ticket');
  const target = new URL(events[1][1]);
  assert.equal(target.origin + target.pathname, callback);
  assert.equal(target.searchParams.get('code'), 'one-time-code');
  assert.equal(target.href.includes('existing-token'), false);
});

test('signed-out users see the existing login modal without a redirect', () => {
  const { context, events } = setup({ token: null });
  assert.equal(context.resumeCourseSignIn(), true);
  assert.deepEqual(events, [['login', true]]);
});

test('expired staff sessions open only the staff login modal', async () => {
  const { context, events } = setup({ staff: true, status: 401 });
  context.resumeCourseSignIn();
  await new Promise(setImmediate);
  assert.deepEqual(events.slice(1), [['logout'], ['login', false], ['staff']]);
});

test('untrusted destinations never receive an authorization request', () => {
  const { context, events } = setup({ redirect: 'https://example.invalid/' });
  context.resumeCourseSignIn();
  assert.deepEqual(events.map(event => event[0]), ['error']);
});
