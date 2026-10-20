const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/static/js/app.js'), 'utf8');
const start = source.indexOf('window.downloadWorksheetDocx = async function');
const end = source.indexOf('// ===', start);
function setup(ok = true) {
  const clicks = [], requests = [], urls = [];
  const context = vm.createContext({API_BASE:'/api', state:{token:'test-token'}, showToast(){}, showLoginModal(){}, setTimeout(){}, console,
    document:{body:{appendChild(){}},createElement(){return {click(){clicks.push(this.download);},remove(){}};}},
    window:{URL:{createObjectURL(){return 'blob:test';},revokeObjectURL(){}},open(url){urls.push(url);}},
    fetch:async(url, options)=>{requests.push({url,options});if(!ok)throw new Error('test network failure');return {ok:true,headers:{get(){return "attachment; filename*=UTF-8''"+encodeURIComponent('A178_松山第五分會_李O立_連動分析練習單.docx');}},blob:async()=>({})};}});
  vm.runInContext(source.slice(start, end), context);
  return {context, clicks, requests, urls};
}
test('history download uses the server unit code, unit name and student name',async()=>{
  const env=setup();await env.context.window.downloadWorksheetDocx(12);
  assert.equal(env.requests[0].url,'/api/worksheets/12/export-docx?format=docx');
  assert.equal(env.clicks[0],'A178_松山第五分會_李O立_連動分析練習單.docx');
});
test('network fallback preserves the requested doc format and authentication',async()=>{
  const env=setup(false);await env.context.window.downloadWorksheetDocx(12,'doc');
  assert.match(env.urls[0],/export-docx\?format=doc&token=test-token$/);
});

test('history button requests the default DOCX format',()=>{
  assert.match(source, /onclick="downloadWorksheetDocx\(\$\{ws.id\}\)"/);
});
