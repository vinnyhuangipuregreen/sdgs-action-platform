const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../app/static/js/app.js'), 'utf8');
const pagination = source.slice(source.indexOf('async function loadAdminStudents('), source.indexOf('window.handleStudentSelectChange ='));

function setup(fetchPage) {
  const elements = {};
  const requests = [];
  const element = () => ({ children: [], set innerHTML(value) { this.children = []; this.html = value; }, appendChild(child) { this.children.push(child); } });
  const state = { studentSearch: '', studentPage: 1, studentTotalPages: 1, studentRequestId: 0, selectedStudentIds: new Set([1]) };
  const context = vm.createContext({
    state, window: {}, API_BASE: '/api', updateSelectedCountUI() {},
    document: { getElementById: id => elements[id] ||= element(), createElement: element },
    fetch: async url => {
      requests.push(url);
      const data = await fetchPage(new URL(url, 'https://example.invalid').searchParams);
      return { ok: true, json: async () => data };
    },
  });
  vm.runInContext(pagination, context);
  return { context, state, elements, requests };
}

function page(total, offset) {
  return { total, items: Array.from({ length: Math.max(0, Math.min(100, total - offset)) }, (_, i) => ({ id: offset + i + 1, name: 'Test', email: 'test@example.invalid', phone: '1' })) };
}

test('100 rows per page with correct boundaries and cleared selections', async () => {
  const { context, state, elements, requests } = setup(params => page(427, Number(params.get('offset'))));
  await context.loadAdminStudents();
  assert.equal(elements.adminStudentsTableBody.children.length, 100);
  assert.equal(elements.studentPrevPage.disabled, true);
  assert.equal(elements.studentNextPage.disabled, false);
  assert.equal(state.selectedStudentIds.size, 0);
  await context.loadAdminStudents('', 5);
  assert.equal(elements.adminStudentsTableBody.children.length, 27);
  assert.match(elements.studentPageInfo.textContent, /第 5 \/ 5 頁，共 427 筆/);
  assert.equal(elements.studentNextPage.disabled, true);
  assert.equal(new URL(requests.at(-1), 'https://example.invalid').searchParams.get('limit'), '100');
  await context.window.changeStudentPage(1);
  assert.equal(requests.length, 2);
  await context.window.changeStudentPage(-1);
  assert.match(requests.at(-1), /offset=300/);
});

test('search resets to page one and empty results disable both buttons', async () => {
  const { context, elements, requests } = setup(params => params.get('search') ? page(0, 0) : page(427, Number(params.get('offset'))));
  await context.loadAdminStudents('', 5);
  await context.loadAdminStudents('找不到');
  assert.match(requests.at(-1), /offset=0/);
  assert.match(elements.studentPageInfo.textContent, /共 0 筆/);
  assert.equal(elements.studentPrevPage.disabled, true);
  assert.equal(elements.studentNextPage.disabled, true);
  assert.match(elements.adminStudentsTableBody.html, /無符合條件/);
});

test('deleting the last page returns to the last available page', async () => {
  const { context, state, requests } = setup(params => page(400, Number(params.get('offset'))));
  await context.loadAdminStudents('', 5);
  assert.equal(state.studentPage, 4);
  assert.match(requests.at(-1), /offset=300/);
});

test('a slower earlier search cannot overwrite newer results', async () => {
  let resolveOld;
  const { context, elements } = setup(params => params.get('search') === 'old' ? new Promise(resolve => { resolveOld = resolve; }) : page(1, 0));
  const old = context.loadAdminStudents('old');
  await context.loadAdminStudents('new');
  resolveOld(page(427, 0));
  await old;
  assert.match(elements.studentPageInfo.textContent, /共 1 筆/);
  assert.equal(elements.adminStudentsTableBody.children.length, 1);
});
