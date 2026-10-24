const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/static/js/app.js'), 'utf8');
const functions = source.slice(source.indexOf('window.executeBatchImportStaff ='), source.indexOf('// 8. Student Management'));

function setup(filename, ok = true) {
  const requests = [], notices = [], opened = [];
  let refreshed = false, closed = false;
  const file = filename ? { name: filename } : null;
  const fields = {
    importStaffTextarea: { value: '' },
    importStaffFileInput: { files: file ? [file] : [], value: filename || '' },
    importStaffSubmitBtn: { disabled: false },
    batchImportStaffModal: { classList: { add() { closed = true; } } },
  };
  const context = vm.createContext({
    window: { open: url => opened.push(url) }, state: { token: 'test' }, API_BASE: '/api',
    document: { getElementById: id => fields[id] },
    FormData: class { append(name, value) { this[name] = value; } },
    showToast: (message, type) => notices.push({ message, type }),
    loadAdminStaff: () => { refreshed = true; },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok, json: async () => ({ detail: '欄位錯誤' }) }; },
  });
  vm.runInContext(functions, context);
  return { context, fields, file, requests, notices, opened, refreshed: () => refreshed, closed: () => closed };
}

test('roster imports upload the XLSX file as multipart and refresh after success', async () => {
  const env = setup('admins.XLSX');
  await env.context.window.executeBatchImportStaff();
  assert.equal(env.requests[0].url, '/api/admin/staff/import-xlsx');
  assert.equal(env.requests[0].options.body.file, env.file);
  assert.equal(env.requests[0].options.headers['Content-Type'], undefined);
  assert.equal(env.refreshed(), true);
  assert.equal(env.closed(), true);
  assert.equal(env.fields.importStaffSubmitBtn.disabled, false);
});

test('missing and non-XLSX files never reach the API; server errors preserve the selected file', async () => {
  for (const filename of ['', 'students.csv', 'students.xls']) {
    const env = setup(filename);
    await env.context.window.executeBatchImportStaff();
    assert.equal(env.requests.length, 0);
    assert.ok(env.notices.length, filename || 'missing file');
    assert.equal(env.notices[0].type, 'error');
  }
  const env = setup('students.xlsx', false);
  await env.context.window.executeBatchImportStaff();
  assert.equal(env.closed(), false);
  assert.equal(env.fields.importStaffFileInput.value, 'students.xlsx');
  assert.equal(env.notices[0].message, '欄位錯誤');
  assert.equal(env.fields.importStaffSubmitBtn.disabled, false);
});

test('export uses the XLSX endpoint and authentication', () => {
  const env = setup();
  env.context.window.exportStaffXLSX();
  assert.equal(env.opened[0], '/api/admin/staff/export-xlsx?token=test');
});


test('pasted seven-column sample maps password, unit fields and Chinese role without defaults', async () => {
  const env = setup();
  env.fields.importStaffTextarea.value = '管理員, admin@gmail.com, admin_backup@gmail.com, XXXXXXXX, ipuregreen, 綠色公益基金會, 系統管理員';
  await env.context.window.executeBatchImportStaff();
  assert.equal(env.requests[0].url, '/api/admin/staff/batch-import');
  const row = JSON.parse(env.requests[0].options.body).students[0];
  assert.equal(row.phone, 'XXXXXXXX');
  assert.equal(row.unit_code, 'ipuregreen');
  assert.equal(row.unit_name, '綠色公益基金會');
  assert.equal(row.role, '系統管理員');
});

test('mixed file and paste input, or incomplete pasted columns, cannot submit', async () => {
  const env = setup('admins.xlsx');
  env.fields.importStaffTextarea.value = '管理員, admin@gmail.com';
  await env.context.window.executeBatchImportStaff();
  assert.equal(env.requests.length, 0);
  env.fields.importStaffFileInput.files = [];
  await env.context.window.executeBatchImportStaff();
  assert.equal(env.requests.length, 0);
});
