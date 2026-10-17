const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/static/js/app.js'), 'utf8');
const handler = source.slice(source.indexOf('async function loadAttendanceAdmin()'), source.indexOf('async function loadAdminDashboard()'));

function setup(response) {
  const elements = {};
  for (const id of ['attendanceAdminStatus', 'attendanceAdminFrame', 'attendanceAdminRetry']) {
    const classes = new Set();
    elements[id] = { classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) } };
  }
  const calls = [];
  const state = { token: 'verified-token', user: { role: 'admin' } };
  const context = vm.createContext({ state, API_BASE: '/api', AbortSignal,
    document: { getElementById: id => elements[id] }, handleLogout: () => { state.token = null; },
    fetch: async (url, options) => { calls.push({url, options}); return response; }
  });
  vm.runInContext(handler, context);
  return { context, elements, calls, state };
}

test('one request loads the original course HTML and shows the actual tools', async () => {
  const html = '<html><div id="panel-courses">Original course management</div></html>';
  const { context, elements, calls } = setup({ ok: true, status: 200, text: async () => html });
  await context.loadAttendanceAdmin();
  assert.deepEqual(calls.map(call => call.url), ['/api/attendance-admin/view']);
  assert.equal(elements.attendanceAdminFrame.srcdoc, html);
  assert.equal(elements.attendanceAdminFrame.classList.contains('hidden'), false);
  assert.equal(elements.attendanceAdminStatus.textContent, '');
});

test('a failed upstream shows retry instead of a blank frame', async () => {
  const { context, elements } = setup({ ok: false, status: 503 });
  await context.loadAttendanceAdmin();
  assert.equal(elements.attendanceAdminFrame.classList.contains('hidden'), true);
  assert.equal(elements.attendanceAdminRetry.classList.contains('hidden'), false);
  assert.match(elements.attendanceAdminStatus.textContent, /無法載入/);
});

test('student accounts cannot request the original management page', async () => {
  const { context, state, calls } = setup();
  state.user.role = 'student';
  await context.loadAttendanceAdmin();
  assert.equal(calls.length, 0);
});
