const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../app/static/js/activity-details.js'),'utf8');

function setup() {
  const elements = {}, notices = [], buttons = ['before','after'].map(phase => ({dataset:{activityPhase:phase},setAttribute(key,value){this[key]=value;},addEventListener(){}}));
  let selected = null, focused = null;
  const element = id => elements[id] ||= {dataset:{},events:{},placeholder:'',_value:'',
    get value(){return this._value;},set value(value){this._value=String(value);},
    classList:{toggle(name,hidden){this[name]=hidden;}},addEventListener(event,callback){this.events[event]=callback;},focus(){focused=id;}};
  const template = {purpose:'示範目的',process:'示範流程',features:'示範特色',audience:'示範對象',participants:'例：300',volunteers:'例：30',results:'成果填寫指引',feedback:'回饋指引',improvements:'檢討指引'};
  const context = vm.createContext({state:{centerActions:[{category:'文化教育',name:'課程',template},{category:'文化教育',name:'講座',template:{...template,purpose:'講座目的',process:'講座流程'}}]},
    document:{getElementById:element,querySelector:() => selected,querySelectorAll:() => buttons},showToast:message => notices.push(message)});
  vm.runInContext(source,context);
  context.loadActivityDetails(null);
  context.initActivityDetails();
  return {context,element,notices,buttons,template,get focused(){return focused;},select(name='課程'){selected={value:'文化教育',dataset:{action:name}};element('centerActionOptions').events.change();}};
}

test('activity name asks for classification before entry', () => {
  const env=setup();env.element('ws_activity_name').events.focus();
  assert.equal(env.notices[0],'請先選擇：活動分類。');
  assert.equal(env.focused,'centerActionSearch');
});

test('examples fill the plan while outcome guidance stays in placeholders', () => {
  const env=setup();env.select();
  assert.equal(env.element('ws_activity_purpose').value,env.template.purpose);
  assert.equal(env.element('ws_activity_audience').value,env.template.audience);
  assert.equal(env.element('ws_activity_results').placeholder,env.template.results);
  assert.equal(env.element('ws_activity_results').value,'');
  assert.equal(env.element('ws_activity_participants').value,'');
  env.element('ws_activity_purpose').value='使用者改寫';env.select('講座');
  assert.equal(env.element('ws_activity_purpose').value,'使用者改寫');
  assert.equal(env.element('ws_activity_process').value,'講座流程');
});

test('phase switching preserves actual results and reload retains zero counts', () => {
  const env=setup();env.select();env.context.setActivityPhase('after');
  env.element('ws_activity_start_date').value='2026-10-19';env.element('ws_activity_end_date').value='2026-10-19';
  env.element('ws_activity_participants').value='0';env.element('ws_activity_results').value='實際成果';
  const details=env.context.collectActivityDetails();
  assert.equal(details.participants,0);assert.equal(env.context.validateActivityDetails(details),true);
  env.context.setActivityPhase('before');assert.equal(env.element('activityResults').classList.hidden,true);
  env.context.loadActivityDetails(details);
  assert.equal(env.element('activityResults').classList.hidden,false);
  assert.equal(env.element('ws_activity_participants').value,'0');
  assert.match(env.context.describeActivity(details),/實際成果/);
  assert.doesNotMatch(env.context.describeActivity(details),/回饋指引/);
});

test('all four plan fields are required and retired text is never restored or collected', () => {
  const env=setup();env.select();
  env.element('ws_activity_start_date').value='2026-10-19';env.element('ws_activity_end_date').value='2026-10-19';
  env.element('ws_activity_audience').value='';
  assert.equal(env.context.validateActivityDetails(env.context.collectActivityDetails()),false);
  env.context.loadActivityDetails({phase:'before',purpose:'目的',process:'流程',features:'特色',audience:'對象',legacy_description:'歷史說明'});
  const details=env.context.collectActivityDetails();
  assert.equal('legacy_description' in details,false);
  assert.doesNotMatch(env.context.describeActivity(details),/歷史說明/);
  env.context.loadActivityDetails(null);
  assert.equal(env.element('ws_activity_purpose').value,'');
});
