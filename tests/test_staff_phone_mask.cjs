const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/static/js/app.js'), 'utf8');

function setup(staffId = 4) {
  const fields = {}, requests = [], notices = [];
  const element = () => ({value: '', children: [], classList: {add() {}, remove() {}}, appendChild(child) {this.children.push(child);}});
  const context = vm.createContext({
    window: {}, state: {selectedStaffIds: new Set(), token: 'test'}, API_BASE: '/api',
    document: {getElementById: id => fields[id] ||= element(), createElement: element},
    updateSelectedStaffCountUI() {}, loadAdminStudents() {},
    showToast: message => notices.push(message),
    fetch: async (url, options) => {
      requests.push({url, options});
      return {ok: true, json: async () => ({items: [{id: staffId, name: 'Test', email: 'staff@example.invalid', phone: '0966027621', role: 'admin'}]})};
    },
  });
  vm.runInContext(source.slice(source.indexOf('function maskStaffPhone('), source.indexOf('window.loadAdminStaff =')), context);
  vm.runInContext(source.slice(source.indexOf('window.openEditStudentModal ='), source.indexOf('window.deleteSingleStudent =')), context);
  return {context, fields, requests, notices};
}

function open(env, type = 'staff', phone = '0966027621') {
  env.context.window.openEditStudentModal(4, 'Test', 'staff@example.invalid', '', phone, 'TEST', 'Unit', 'admin', type);
}

test('staff account five displays three while retaining its real ID for account actions', async () => {
  for (const [id, displayed] of [[1, 1], [2, 2], [4, 4], [5, 3]]) {
    const env = setup(id);
    await env.context.loadAdminStaff();
    const row = env.fields.adminStaffTableBody.children[0].innerHTML;
    assert.match(row, new RegExp(`>#${displayed}</td>`));
    assert.match(row, new RegExp(`openEditStudentModal\\(${id},`));
    assert.match(row, new RegExp(`handleStaffSelectChange\\(${id},`));
    assert.match(row, new RegExp(`deleteSingleStaff\\(${id},`));
  }
});

test('staff list and edit show only the first three characters', async () => {
  const env = setup();
  await env.context.loadAdminStaff();
  assert.match(env.fields.adminStaffTableBody.children[0].innerHTML, />096\*{7}<\/td>/);
  open(env);
  assert.equal(env.fields.editStudentPhone.value, '096*******');
  for (const [raw, expected] of [['at0988065845', 'at0*********'], ['', ''], ['12', '12']]) {
    open(env, 'staff', raw);
    assert.equal(env.fields.editStudentPhone.value, expected);
  }
});

test('saving other staff fields sends the original complete phone and an empty password', async () => {
  const env = setup();
  open(env);
  env.fields.editStudentName.value = 'Changed name';
  await env.context.window.saveStudentEdit();
  const write = env.requests.find(r => r.options.method === 'PUT');
  assert.equal(write.url, '/api/admin/staff/4');
  assert.equal(JSON.parse(write.options.body).phone, '0966027621');
  assert.equal(JSON.parse(write.options.body).password, '');
});

test('a replacement phone masks on blur and saves its complete content', async () => {
  const env = setup();
  open(env);
  env.fields.editStudentPhone.value = 'abc1234567';
  env.fields.editStudentPhone.onblur();
  assert.equal(env.fields.editStudentPhone.value, 'abc*******');
  await env.context.window.saveStudentEdit();
  assert.equal(JSON.parse(env.requests[0].options.body).phone, 'abc1234567');
});

test('partially edited masks cannot be written to the account', async () => {
  const env = setup();
  open(env);
  env.fields.editStudentPhone.value = '097*******';
  env.fields.editStudentPhone.onblur();
  await env.context.window.saveStudentEdit();
  assert.equal(env.requests.length, 0);
  assert.equal(env.notices.length, 1);
});

test('opening a student after staff resets masking and preserves student editing', async () => {
  const env = setup();
  open(env);
  open(env, 'student', '0912345678');
  assert.equal(env.fields.editStudentPhone.value, '0912345678');
  assert.equal(env.fields.editStudentPhone.onblur, null);
  await env.context.window.saveStudentEdit();
  assert.equal(env.requests[0].url, '/api/admin/students/4');
  assert.equal(JSON.parse(env.requests[0].options.body).phone, '0912345678');
});

test('staff roster sorts numerically by displayed ID and retains account action targets', async () => {
  const env = setup();
  env.context.fetch = async () => ({ok: true, json: async () => ({items:
    [1, 2, 4, 5, 10, 6].map(id => ({id, name: 'Test', email: 'staff@example.invalid', role: 'admin'}))
  })});
  await env.context.loadAdminStaff();
  const rows = env.fields.adminStaffTableBody.children.map(row => row.innerHTML);
  assert.deepEqual(rows.map(row => Number(row.match(/>#(\d+)<\/td>/)[1])), [1, 2, 3, 4, 6, 10]);
  assert.match(rows[2], /openEditStudentModal\(5,/);
  assert.match(rows[2], /deleteSingleStaff\(5,/);
  assert.match(rows[3], /openEditStudentModal\(4,/);
});
