const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/static/js/app.js'), 'utf8');
const functions = source.slice(source.indexOf('window.executeBatchImport ='), source.indexOf('window.exportWorksheetsCSV ='));

function setup(filename, ok = true) {
  const requests = [], notices = [], opened = [];
  let refreshed = false, closed = false;
  const file = filename ? { name: filename } : null;
  const fields = {
    importFileInput: { files: file ? [file] : [], value: filename || '' },
    importStudentsSubmitBtn: { disabled: false },
    importStudentsStatus: { hidden: true, textContent: '' },
    batchImportModal: { classList: { add() { closed = true; } } },
  };
  const context = vm.createContext({
    window: { open: url => opened.push(url) }, state: { token: 'test' }, API_BASE: '/api',
    document: { getElementById: id => fields[id] },
    FormData: class { append(name, value) { this[name] = value; } },
    showToast: (message, type) => notices.push({ message, type }),
    loadAdminStudents: () => { refreshed = true; },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok, json: async () => ({ detail: '欄位錯誤' }) }; },
  });
  vm.runInContext(functions, context);
  return { context, fields, file, requests, notices, opened, refreshed: () => refreshed, closed: () => closed };
}

test('roster imports upload the XLSX file as multipart and refresh after success', async () => {
  const env = setup('student.XLSX');
  await env.context.window.executeBatchImport();
  assert.equal(env.requests[0].url, '/api/admin/students/import-xlsx');
  assert.equal(env.requests[0].options.body.file, env.file);
  assert.equal(env.requests[0].options.headers['Content-Type'], undefined);
  assert.equal(env.refreshed(), true);
  assert.equal(env.closed(), true);
  assert.equal(env.fields.importStudentsSubmitBtn.disabled, false);
});

test('missing and non-XLSX files never reach the API; server errors preserve the selected file', async () => {
  for (const filename of ['', 'students.csv', 'students.xls']) {
    const env = setup(filename);
    await env.context.window.executeBatchImport();
    assert.equal(env.requests.length, 0);
    assert.equal(env.notices[0].type, 'error');
  }
  const env = setup('students.xlsx', false);
  await env.context.window.executeBatchImport();
  assert.equal(env.closed(), false);
  assert.equal(env.fields.importFileInput.value, 'students.xlsx');
  assert.equal(env.notices[0].message, '欄位錯誤');
  assert.equal(env.fields.importStudentsSubmitBtn.disabled, false);
});

test('export uses the XLSX endpoint and authentication', () => {
  const env = setup();
  env.context.window.exportStudentsXLSX();
  assert.equal(env.opened[0], '/api/admin/students/export-xlsx?token=test');
});
