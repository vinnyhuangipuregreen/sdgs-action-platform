const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../app/static/js/app.js'), 'utf8');
const edit = source.slice(source.indexOf('window.openEditStudentModal ='), source.indexOf('window.deleteSingleStudent ='));
const deletes = source.slice(source.indexOf('window.deleteSingleStaff ='), source.indexOf('window.openBatchImportStaffModal ='));

test('editing uses the original account type and only offers roles from that table', async () => {
  const elements = {};
  const requests = [];
  const context = vm.createContext({
    window: {}, state: {}, API_BASE: '/api',
    document: { getElementById: id => elements[id] ||= { value: '', classList: { add() {}, remove() {} } } },
    showToast() {},
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: false, json: async () => ({}) };
    },
  });
  vm.runInContext(source.slice(source.indexOf('function maskStaffPhone('), source.indexOf('async function loadAdminStaff(')) + edit, context);
  for (const type of ['staff', 'student']) {
    context.window.openEditStudentModal(1, 'Test', 'test@example.invalid', '', '555', '', '', type === 'staff' ? 'teacher' : 'student', type);
    assert.equal(elements.editStudentRole.innerHTML.includes('value="student"'), type === 'student');
    assert.equal(elements.editStudentRole.innerHTML.includes('value="admin"'), type === 'staff');
    await context.window.saveStudentEdit();
    assert.equal(requests.at(-1).url, `/api/admin/${type === 'staff' ? 'staff' : 'students'}/1`);
  }
});

test('staff deletion calls staff endpoints for both single and batch actions', async () => {
  const requests = [];
  const context = vm.createContext({
    window: {}, state: { selectedStaffIds: new Set([2]) }, API_BASE: '/api',
    confirm: () => true, showToast() {},
    fetch: async url => { requests.push(url); return { ok: false, json: async () => ({}) }; },
  });
  vm.runInContext(deletes, context);
  await context.window.deleteSingleStaff(2, 'Test');
  await context.window.executeBatchDeleteStaff();
  assert.deepEqual(requests, ['/api/admin/staff/2', '/api/admin/staff/batch-delete']);
});
