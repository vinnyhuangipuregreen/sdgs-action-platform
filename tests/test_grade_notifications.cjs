const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/static/js/app.js'), 'utf8');
const grade = source.slice(source.indexOf('async function submitGrade('), source.indexOf('// 7B. Staff / Admin Account Management'));

function setup(response) {
  const notices = [];
  let closed = false, loaded = false;
  const fields = {
    gradeScoreInput: { value: '95' }, gradeCommentInput: { value: 'Review' },
    gradeSubmitBtn: { disabled: false }, gradeModal: { classList: { add() { closed = true; } } },
  };
  const context = vm.createContext({
    document: { getElementById: id => fields[id] }, state: { token: 'test' }, API_BASE: '/api',
    fetch: async () => response,
    showToast: (message, type) => notices.push({ message, type }),
    loadAdminWorksheets: () => { loaded = true; },
  });
  vm.runInContext(grade, context);
  return { context, fields, notices, closed: () => closed, loaded: () => loaded };
}

test('a saved grade with failed email displays a warning and refreshes the saved score', async () => {
  const env = setup({ ok: true, json: async () => ({ email_sent: false, email_warning: 'SMTP unavailable' }) });
  await env.context.submitGrade(8);
  assert.equal(env.notices[0].type, 'warning');
  assert.match(env.notices[0].message, /評分已儲存.*SMTP unavailable/);
  assert.equal(env.closed(), true);
  assert.equal(env.loaded(), true);
  assert.equal(env.fields.gradeSubmitBtn.disabled, false);
});

test('only confirmed email delivery displays a success notification', async () => {
  const env = setup({ ok: true, json: async () => ({ email_sent: true, email_target: 'student@example.invalid' }) });
  await env.context.submitGrade(8);
  assert.equal(env.notices[0].type, 'success');
  assert.match(env.notices[0].message, /student@example.invalid/);
});

test('JSON and non-JSON API errors leave the grading form open and allow retry', async () => {
  for (const json of [async () => ({ detail: '權限不足' }), async () => { throw new SyntaxError('Internal Server Error'); }]) {
    const env = setup({ ok: false, json });
    await env.context.submitGrade(8);
    assert.equal(env.notices[0].type, 'error');
    assert.equal(env.closed(), false);
    assert.equal(env.loaded(), false);
    assert.equal(env.fields.gradeSubmitBtn.disabled, false);
  }
});
