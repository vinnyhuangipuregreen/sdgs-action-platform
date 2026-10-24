const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app/static/js/nsp.js'),'utf8');
const durationSource=source.slice(source.indexOf('  async function duration('),source.indexOf('  async function saveEditor('));
const flushSource=source.slice(source.indexOf('  async function flush('),source.indexOf('  function tick('));

test('editor section, lesson and material numbers follow their current order without changing IDs',()=>{
  const elements={nspSectionEditor:{},nspMaterialEditor:{}};
  const lesson=id=>({id,title:id,url:'https://example.invalid/'+id,duration:30});
  const edit={sections:[{title:'章節甲',lessons:[lesson('a'),lesson('b')]},{title:'章節乙',lessons:[lesson('c')]}],materials:[{title:'教材甲'},{title:'教材乙'}]};
  const context=vm.createContext({edit,meta:{terms:[]},document:{getElementById:id=>elements[id]},esc:v=>v??'',field:(label,value)=>value,button:()=>'',options:()=>'',empty:()=>''});
  const renderSource=source.slice(source.indexOf('  function renderSections('),source.indexOf('  async function duration('));
  const moveSource=source.slice(source.indexOf('  function move('),source.indexOf("  document.addEventListener('click'"));
  vm.runInContext(renderSource+moveSource+'\nrenderSections();renderMaterials();',context);
  assert.match(elements.nspSectionEditor.innerHTML,/#章節1[\s\S]*章節甲[\s\S]*#影片1-1[\s\S]*#影片1-2[\s\S]*#章節2[\s\S]*#影片2-1/);
  assert.match(elements.nspMaterialEditor.innerHTML,/#教材1[\s\S]*教材甲[\s\S]*#教材2[\s\S]*教材乙/);
  vm.runInContext('move(edit.sections,1,-1);move(edit.materials,1,-1);renderSections();renderMaterials();',context);
  assert.match(elements.nspSectionEditor.innerHTML,/#章節1[\s\S]*章節乙[\s\S]*data-lesson-id="c"[\s\S]*#影片1-1/);
  assert.match(elements.nspMaterialEditor.innerHTML,/#教材1[\s\S]*教材乙/);
  vm.runInContext('edit.sections.splice(0,1);edit.sections[0].lessons.splice(0,1);edit.materials.splice(0,1);renderSections();renderMaterials();',context);
  assert.match(elements.nspSectionEditor.innerHTML,/data-lesson-id="b"[\s\S]*#影片1-1/);
  assert.doesNotMatch(elements.nspSectionEditor.innerHTML,/#章節2|#影片1-2/);
  assert.doesNotMatch(elements.nspMaterialEditor.innerHTML,/#教材2/);
});

test('YouTube iframe blocks popups and top navigation before loading while retaining playback API access',()=>{
  const frame={attributes:{},setAttribute(name,value){this.attributes[name]=value;}};
  Object.defineProperty(frame,'src',{set(value){
    assert.equal(frame.attributes.sandbox,'allow-scripts allow-same-origin allow-presentation');
    this.source=value;
  }});
  const helper=source.slice(source.indexOf('  function youtubeFrame('),source.indexOf('  async function play('));
  const context=vm.createContext({URL,location:{origin:'https://example.invalid'},document:{createElement(tag){assert.equal(tag,'iframe');return frame;}}});
  vm.runInContext(helper+'\nthis.makeFrame=youtubeFrame;',context);
  context.makeFrame('M7lc1UVf-VE','課程影片',12);
  const url=new URL(frame.source);
  assert.equal(url.searchParams.get('enablejsapi'),'1');
  assert.equal(url.searchParams.get('origin'),'https://example.invalid');
  assert.equal(url.searchParams.get('start'),'12');
  assert.doesNotMatch(frame.attributes.sandbox,/allow-popups|allow-top-navigation/);
  assert.match(frame.allow,/fullscreen/);
  assert.equal(frame.referrerPolicy,'strict-origin-when-cross-origin');
});

test('Google Drive cover sharing URLs become image URLs without changing other image hosts',()=>{
  const coverSource=source.slice(source.indexOf('  const coverImage ='),source.indexOf('  const uid ='));
  const context=vm.createContext({URL});
  vm.runInContext(coverSource+'\nthis.imageURL=coverImage;',context);
  const id='1OL4vP6591syyBq2asr2v3-t6lQb7YAPz';
  for(const url of [`https://drive.google.com/file/d/${id}/view?usp=sharing`,`https://drive.google.com/open?id=${id}`,`https://drive.google.com/uc?export=view&id=${id}`]){
    assert.equal(context.imageURL(url),`https://drive.google.com/thumbnail?id=${id}&sz=w1200`);
  }
  assert.match(context.imageURL(`https://drive.google.com/file/d/${id}/view?resourcekey=test-key`),/resourcekey=test-key/);
  for(const url of ['', 'https://example.invalid/cover.png',`https://drive.google.com.example.invalid/file/d/${id}/view`,'https://drive.google.com/drive/folders/test'])assert.equal(context.imageURL(url),url);
});

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

test('instructor editors use an independent email input and require the biography',async()=>{
  const listeners={},elements={};
  const options={terms:[],instructors:[{id:3,number:1,name:'外聘講師',email:'external@example.invalid',bio:'簡介',expertise:'永續'}]};
  const context=vm.createContext({window:{addEventListener(){}},state:{token:'test'},structuredClone,
    document:{addEventListener(name,fn){listeners[name]=fn;},getElementById(id){return elements[id]??={innerHTML:'',showModal(){},addEventListener(){}};}},
    fetch:async()=>({ok:true,json:async()=>options}),showToast(message){assert.fail(message);}});
  vm.runInContext(source,context);
  await context.window.NSP.admin('nsp_instructors');
  assert.match(elements.adminSubPane_nsp_instructors.innerHTML,/external@example.invalid/);
  assert.match(elements.adminSubPane_nsp_instructors.innerHTML,/<td>#1<\/td>/);
  for(const action of ['new','edit']){
    await listeners.click({target:{closest:()=>({dataset:{nsp:action,id:'3',type:'nsp_instructors'}})}});
    const html=elements.nspDialog.innerHTML;
    assert.match(html,/<input name="email" type="email"[^>]+required/);
    assert.match(html,/講師簡介<span class="required-marker"> \*<\/span>/);
    assert.match(html,/<textarea name="bio" rows="4" required>/);
    assert.doesNotMatch(html,/name="staff_id"|<select/);
    if(action==='edit'){
      assert.match(html,/value="external@example.invalid"/);
      assert.match(html,/name="display_id" type="text" value="1" readonly/);
    }
  }
});

test('all four admin lists show administrator names and Taipei timestamps',async()=>{
  const elements={};
  const row={id:3,number:1,name:'項目',title:'課程',status:'draft',created_by:'actor@example.invalid',updated_by:'actor@example.invalid',created_by_name:'管理員甲',updated_by_name:'管理員乙',created_at:'2026-10-24T11:12:59Z',updated_at:'2026-10-24T16:00:00Z'};
  const options={terms:[{...row,kind:'course'},{...row,kind:'material'}],instructors:[{...row,email:'teacher@example.invalid'}]};
  const context=vm.createContext({window:{addEventListener(){}},state:{token:'test'},
    document:{addEventListener(){},getElementById(id){return elements[id]??={innerHTML:''};}},
    fetch:async path=>({ok:true,json:async()=>path.endsWith('/courses')?[row]:options})});
  vm.runInContext(source,context);
  for(const type of ['nsp_courses','nsp_categories','nsp_material_categories','nsp_instructors']){
    await context.window.NSP.admin(type);
    const html=elements['adminSubPane_'+type].innerHTML;
    assert.match(html,/管理員甲<br>2026-10-24 19:12:59/);
    assert.match(html,/管理員乙<br>2026-10-25 00:00:00/);
    assert.doesNotMatch(html,/actor@example.invalid/);
  }
  const auditSource=source.slice(source.indexOf('  const auditDate ='),source.indexOf('  const required ='));
  const details=vm.runInNewContext(auditSource+'\nauditDetails(row)',{row,esc:value=>value??''});
  assert.match(details,/建立：管理員甲／2026-10-24 19:12:59/);
  assert.match(details,/修改：管理員乙／2026-10-25 00:00:00/);
});

test('course list and editor display number one but keep the original course ID for actions',async()=>{
  const elements={},listeners={};
  const course={id:2,number:1,title:'導論：自然永續的核心觀念與倫理基礎',status:'published'};
  const context=vm.createContext({window:{addEventListener(){}},state:{token:'test'},structuredClone,
    document:{addEventListener(name,fn){listeners[name]=fn;},getElementById(id){return elements[id]??={innerHTML:'',value:'',open:true,classList:{add(){}},showModal(){},addEventListener(){}};}},
    fetch:async path=>({ok:true,json:async()=>path.endsWith('/courses')?[course]:path.endsWith('/catalog')?[]:{terms:[],instructors:[]}}),showToast(message){assert.fail(message);}});
  vm.runInContext(source,context);
  await context.window.NSP.admin('nsp_courses');
  assert.match(elements.adminSubPane_nsp_courses.innerHTML,/<td>#1<\/td>/);
  assert.match(elements.adminSubPane_nsp_courses.innerHTML,/data-id="2"/);
  await listeners.click({target:{closest:()=>({dataset:{nsp:'edit',id:'2',type:'nsp_courses'}})}});
  assert.match(elements.nspDialog.innerHTML,/name="display_id" type="text" value="1" readonly/);
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
