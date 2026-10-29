const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/static/js/app.js'), 'utf8');
const handler = source.slice(source.indexOf('let studentAttendanceRequest ='), source.indexOf('window.changeStudentPage ='));

function setup(fetch) {
  const elements = {};
  for (const id of ['studentAttendanceModal', 'studentAttendanceFrame', 'studentAttendanceStatus', 'studentBackfillModal', 'studentBackfillFrame', 'studentBackfillStatus']) {
    const classes = new Set(['hidden']);
    elements[id] = { classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) } };
  }
  const state = { token: 'staff-token', user: { role: 'admin' } };
  const context = vm.createContext({ state, API_BASE: '/api', AbortSignal, fetch,
    document: { getElementById: id => elements[id] }, handleLogout() { state.token = null; }
  });
  context.window = context;
  vm.runInContext(handler, context);
  return { context, state, elements };
}

test('selected account ID loads its course dashboard with the staff token', async () => {
  const calls = [];
  const { context, elements } = setup(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, text: async () => '<h1>Selected student</h1>' };
  });
  await context.openStudentAttendance(433);
  assert.equal(calls[0].url, '/api/attendance-admin/students/433/view');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer staff-token');
  assert.equal(elements.studentAttendanceFrame.srcdoc, '<h1>Selected student</h1>');
  assert.equal(elements.studentAttendanceFrame.classList.contains('hidden'), false);
  context.closeStudentAttendance();
  assert.equal(elements.studentAttendanceModal.classList.contains('hidden'), true);
  assert.equal(elements.studentAttendanceFrame.srcdoc, '');
});

test('a closed or superseded request never displays another student', async () => {
  let complete;
  const { context, elements } = setup(() => new Promise(resolve => { complete = resolve; }));
  const old = context.openStudentAttendance(433);
  context.closeStudentAttendance();
  complete({ ok: true, text: async () => 'Old student' });
  await old;
  assert.equal(elements.studentAttendanceFrame.srcdoc, '');
  assert.equal(elements.studentAttendanceModal.classList.contains('hidden'), true);
});

test('missing records show a message and expired login closes the student view', async () => {
  let status = 404;
  const { context, state, elements } = setup(async () => ({ ok: false, status }));
  await context.openStudentAttendance(433);
  assert.match(elements.studentAttendanceStatus.textContent, /查無此學員/);
  assert.equal(elements.studentAttendanceFrame.classList.contains('hidden'), true);
  status = 401;
  await context.openStudentAttendance(433);
  assert.equal(state.token, null);
  assert.equal(elements.studentAttendanceModal.classList.contains('hidden'), true);
});


test('backfill opens a separate modal and keeps the original course entry', async () => {
  const calls=[];
  const {context,elements}=setup(async url=>{calls.push(url);return {ok:true,text:async()=>'<h1>Backfill</h1>'};});
  await context.openStudentAttendance(433,true);
  assert.equal(calls[0],'/api/attendance-admin/students/433/backfill/view');
  assert.equal(elements.studentBackfillModal.classList.contains('hidden'),false);
  assert.equal(elements.studentAttendanceModal.classList.contains('hidden'),true);
  assert.match(elements.studentBackfillFrame.srcdoc,/Backfill/);
  context.closeStudentAttendance(true);
  assert.equal(elements.studentBackfillFrame.srcdoc,'');
  assert.equal(elements.studentBackfillModal.classList.contains('hidden'),true);
  await context.openStudentAttendance(433);
  assert.equal(calls.at(-1),'/api/attendance-admin/students/433/view');
});
