const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/static/js/app.js'), 'utf8');
const switching = source.slice(source.indexOf('function switchTab('), source.indexOf('async function checkAuth('));
const closing = source.slice(source.indexOf('function closeStudentLogin()'), source.indexOf('function showLoginModal('));

function setup(user, token = null) {
  const events = [];
  const state = { user, token, activeTab: 'home' };
  const pane = { classList: { remove: () => events.push('worksheetVisible') } };
  const context = vm.createContext({
    state, URLSearchParams, location: { pathname: '/', search: '', replace: value => events.push(['redirect', value]) },
    document: { querySelectorAll: () => [], querySelector: () => null, getElementById: id => id === 'tabPane_worksheet' ? pane : null },
    showLoginModal: show => events.push(['login', show]),
  });
  vm.runInContext(switching + closing, context);
  return { context, state, events };
}

test('guests and staff see student login instead of the worksheet', () => {
  for (const user of [null, {role:'admin',account_type:'staff'}]) {
    const {context,state,events} = setup(user, user ? 'staff-token' : null);
    context.switchTab('worksheet');
    assert.deepEqual(events, [['login',true]]);
    assert.equal(state.activeTab,'home');
    assert.equal(state.studentDestination,'worksheet');
  }
});

test('a verified student can open the worksheet without another login', () => {
  const {context,state,events} = setup({role:'student',account_type:'student'},'student-token');
  context.switchTab('worksheet');
  assert.equal(state.activeTab,'worksheet');
  assert.deepEqual(events,['worksheetVisible']);
});

test('closing student login returns home and cancels pending access', () => {
  const {context,state,events} = setup(null);
  state.studentDestination = 'worksheet';
  context.closeStudentLogin();
  assert.equal(state.activeTab,'home');
  assert.equal(state.studentDestination,null);
  assert.deepEqual(events,[['login',false]]);
});

test('closing course SSO login leaves the pending authorization flow', () => {
  const {context,events} = setup(null);
  context.location.pathname = '/sso/authorize';
  context.closeStudentLogin();
  assert.deepEqual(events,[['login',false],['redirect','/']]);
});
