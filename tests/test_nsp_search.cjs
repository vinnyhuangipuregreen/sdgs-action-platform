const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/static/js/nsp.js'), 'utf8');

function setup() {
  const controls = {};
  let html = '';
  const root = {get innerHTML() {return html;}, set innerHTML(value) {
    html = value;
    const input = value.match(/<input\b[^>]*id="nspSearch"[^>]*>/)?.[0];
    if (input) {
      controls.nspSearch = {value: input.match(/value="([^"]*)"/)?.[1] || '',
        addEventListener(name, handler) {this[name] = handler;}};
      controls.nspFavorites = {checked: /id="nspFavorites"[^>]*\bchecked\b/.test(value),
        addEventListener(name, handler) {this[name] = handler;}};
      controls.nspCourseGrid = {innerHTML: ''};
    }
  }};
  const courses = [
    {id: 1, title: '森林復育', category: '自然教育', instructors: ['講師甲'], bookmarked: true},
    {id: 2, title: 'ESG報告', category: '企業永續', instructors: ['講師乙'], bookmarked: false},
  ].map(c => ({...c, total: 1, completed: 0, percent: 0, course_date: '2026/11/17', cover_url: '', makeup_count: 0}));
  const context = vm.createContext({
    state: {token: 'account-one', activeTab: 'nsp', user: {name: '測試學員', email: 'learner@example.invalid'}},
    window: {addEventListener() {}, scrollTo() {}},
    document: {addEventListener() {}, getElementById: id => id === 'nspApp' ? root : controls[id]},
    fetch: async () => ({ok: true, json: async () => courses}), URL,
  });
  vm.runInContext(source, context);
  return {context, root, controls};
}

test('search has its own search semantics and starts blank instead of using the learner account', async () => {
  const {context, root, controls} = setup();
  await context.window.NSP.load();
  const input = root.innerHTML.match(/<input\b[^>]*id="nspSearch"[^>]*>/)[0];
  assert.match(input, /type="search"/);
  assert.match(input, /name="nsp_course_query"/);
  assert.match(input, /autocomplete="off"/);
  assert.equal(controls.nspSearch.value, '');
});

test('title, instructor, category, no matches and favorites still filter the course list', async () => {
  const {context, controls} = setup();
  await context.window.NSP.load();
  for (const query of ['森林', '講師甲', '自然教育']) {
    controls.nspSearch.value = query;
    controls.nspSearch.input({target: controls.nspSearch});
    assert.match(controls.nspCourseGrid.innerHTML, /森林復育/);
    assert.doesNotMatch(controls.nspCourseGrid.innerHTML, /ESG報告/);
  }
  controls.nspSearch.value = '不存在的課程';
  controls.nspSearch.input({target: controls.nspSearch});
  assert.doesNotMatch(controls.nspCourseGrid.innerHTML, /nsp-course-card/);
  controls.nspSearch.value = '';
  controls.nspSearch.input({target: controls.nspSearch});
  controls.nspFavorites.checked = true;
  controls.nspFavorites.change({target: controls.nspFavorites});
  assert.match(controls.nspCourseGrid.innerHTML, /森林復育/);
  assert.doesNotMatch(controls.nspCourseGrid.innerHTML, /ESG報告/);
});

test('same-session catalog reload retains user search; switching accounts clears it', async () => {
  const {context, controls} = setup();
  await context.window.NSP.load();
  controls.nspSearch.value = '森林';
  controls.nspSearch.input({target: controls.nspSearch});
  await context.window.NSP.load();
  assert.equal(controls.nspSearch.value, '森林');
  assert.doesNotMatch(controls.nspCourseGrid.innerHTML, /ESG報告/);
  context.state.token = 'account-two';
  await context.window.NSP.load();
  assert.equal(controls.nspSearch.value, '');
  assert.match(controls.nspCourseGrid.innerHTML, /ESG報告/);
});

test('both login forms identify saved usernames and current passwords', () => {
  const html = fs.readFileSync(path.join(__dirname, '../app/templates/index.html'), 'utf8');
  for (const id of ['loginAccount', 'adminAccount']) {
    assert.match(html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))[0], /autocomplete="username"/);
  }
  for (const id of ['loginPassword', 'adminPassword']) {
    assert.match(html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))[0], /autocomplete="current-password"/);
  }
});
