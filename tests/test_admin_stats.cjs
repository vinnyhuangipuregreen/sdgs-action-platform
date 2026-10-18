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


const charts = source.slice(source.indexOf('function renderAdminCharts('), source.indexOf('async function loadAdminWorksheets('));
function setupCharts() {
  const configs = [], elements = {};
  for (const id of ['adminRadarChart','adminPieChart']) elements[id] = {getContext:()=>({id}),classList:{toggle(){}}};
  elements.adminPieEmpty = {classList:{toggle(name,value){this[name]=value;}}};
  const context = vm.createContext({state:{goals:[],centerActions:[{category:'文化教育'},{category:'慈善弘揚'},{category:'聯誼交流'}]},chartRadar:null,chartPie:null,
    document:{getElementById:id=>elements[id]},Chart:class {constructor(ctx,config){configs.push({ctx,config});}destroy(){}}});
  vm.runInContext(charts,context);
  return {context,configs,elements};
}
test('doughnut draws all six formal submissions with numeric counts and omits unused categories',()=>{
  const env=setupCharts();env.context.renderAdminCharts({sdg_frequency:{},center_action_distribution:{'文化教育':3,'慈善弘揚':3}});
  const pie=env.configs.find(x=>x.config.type==='doughnut').config;
  assert.deepEqual(Array.from(pie.data.labels),['文化教育','慈善弘揚']);
  assert.deepEqual(Array.from(pie.data.datasets[0].data),[3,3]);
  assert.equal(pie.options.maintainAspectRatio,false);
});
test('no formal submissions displays an empty-state message instead of a blank doughnut',()=>{
  const env=setupCharts();env.context.renderAdminCharts({sdg_frequency:{},center_action_distribution:{}});
  assert.equal(env.elements.adminPieEmpty.classList.hidden,false);
});
