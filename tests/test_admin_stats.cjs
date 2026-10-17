const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../app/static/js/app.js'), 'utf8');
const render = source.slice(source.indexOf('function renderAdminStats('), source.indexOf('function renderAdminCharts('));

test('dashboard separates drafts and formal submissions including reviewed worksheets', () => {
  const elements = {};
  const context = vm.createContext({ document: { getElementById: id => elements[id] ||= {} } });
  vm.runInContext(render, context);
  for (const [draft, submitted, reviewed] of [[0, 0, 0], [2, 3, 4]]) {
    context.renderAdminStats({ total_students: 10, total_games: 1, max_game_score: 100, draft_worksheets: draft, submitted_worksheets: submitted, reviewed_worksheets: reviewed });
    assert.equal(elements.adminStatDraftWorksheets.textContent, draft);
    assert.equal(elements.adminStatSubmittedWorksheets.textContent, submitted + reviewed);
  }
});
