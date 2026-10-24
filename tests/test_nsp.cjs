const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app/static/js/nsp.js'),'utf8');
const durationSource=source.slice(source.indexOf('  async function duration('),source.indexOf('  async function saveEditor('));
const flushSource=source.slice(source.indexOf('  async function flush('),source.indexOf('  function tick('));

test('category lists and editors display independent numbers while actions keep relation IDs',async()=>{
  const listeners={},elements={};
  const options={terms:[{id:3,number:1,kind:'course',name:'課程分類'},{id:7,number:1,kind:'material',name:'教材分類'}],instructors:[],staff:[]};
  const context=vm.createContext({window:{addEventListener(){}},state:{token:'test'},structuredClone,
    document:{addEventListener(name,fn){listeners[name]=fn;},getElementById(id){return elements[id]??=( {innerHTML:'',showModal(){},addEventListener(){}} );}},
    fetch:async()=>({ok:true,json:async()=>options}),showToast(message){assert.fail(message);}});
  vm.runInContext(source,context);
  for(const [type,id] of [['nsp_categories',3],['nsp_material_categories',7]]){
    await context.window.NSP.admin(type);
    assert.match(elements['adminSubPane_'+type].innerHTML,/<td>#1<\/td>/);
    assert.match(elements['adminSubPane_'+type].innerHTML,new RegExp('data-id="'+id+'"'));
    await listeners.click({target:{closest:()=>({dataset:{nsp:'edit',id:String(id),type}})}});
    assert.match(elements.nspDialog.innerHTML,/name="display_id" type="text" value="1" readonly/);
  }
});

test('video metadata updates the current lesson row after an editor rerender',async()=>{
  function row(){const fields={'[data-lesson-url]':{value:'https://example.invalid/video.mp4'},'[data-lesson-duration]':{value:0},'.nsp-detect-status':{textContent:''}};return {dataset:{lessonId:'stable_id'},fields,querySelector:s=>fields[s]};}
  const old=row(),replacement=row();let current=old,video;
  const context=vm.createContext({Number,Math,setTimeout:()=>1,clearTimeout(){},youtubeId:()=>null,minutes:()=> '0:05',document:{querySelectorAll:s=>s==='.nsp-edit-section'?[{querySelectorAll:()=>[old]}]:[current],createElement(){video={duration:5.055,removeAttribute(){}};return video;}}});
  vm.runInContext(durationSource,context);
  await context.duration(0,0);
  current=replacement;
  video.onloadedmetadata();
  assert.equal(replacement.fields['[data-lesson-duration]'].value,5);
  assert.equal(old.fields['[data-lesson-duration]'].value,0);
  assert.match(replacement.fields['.nsp-detect-status'].textContent,/已偵測/);
});

test('progress persists its captured position even after the player is destroyed',async()=>{
  let resolve,destroyed=false;
  const p={token:'token',pending:5,sending:false,l:{id:'video'},c:{id:1,progress:[],learners:0},position(){if(destroyed)throw Error('destroyed');return 5;}};
  const context=vm.createContext({state:{token:'token'},player:p,Math,api:()=>new Promise(r=>resolve=r),updateProgress(){},document:{getElementById:()=>({textContent:''})}});
  vm.runInContext(flushSource,context);
  const saved=context.flush(p);destroyed=true;context.player=null;resolve({watched:5,completed:1});await saved;
  assert.equal(p.c.progress[0].position,5);
  assert.equal(p.c.progress[0].completed,1);
  assert.equal(p.c.learners,1);
  assert.equal(p.pending,0);
});

test('an account switch prevents progress from being sent with the next user token',async()=>{
  let called=false;
  const context=vm.createContext({state:{token:'new'},player:null,api:()=>{called=true;}});
  vm.runInContext(flushSource,context);
  await context.flush({token:'old',position:()=>10});
  assert.equal(called,false);
});
