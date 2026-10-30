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
  assert.equal(context.imageURL('https://drive.google.com/file/d/1SNLAR3QUoHbnMTL-2Gv5bx8uGhoogt06/view?usp=drive_link'),'/static/images/courses/esg-report-reading.png');
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
    fetch:async path=>({ok:true,json:async()=>path.endsWith('/courses')?[row]:path.endsWith('/catalog')?[]:options})});
  vm.runInContext(source,context);
  for(const type of ['nsp_courses','nsp_categories','nsp_material_categories','nsp_instructors']){
    await context.window.NSP.admin(type);
    const html=elements['adminSubPane_'+type].innerHTML;
    assert.match(html,/管理員甲<br>2026\/10\/24 19:12:59/);
    assert.match(html,/管理員乙<br>2026\/10\/25 00:00:00/);
    assert.doesNotMatch(html,/actor@example.invalid/);
  }
  const auditSource=source.slice(source.indexOf('  const auditDate ='),source.indexOf('  const required ='));
  const details=vm.runInNewContext(auditSource+'\nauditDetails(row)',{row,esc:value=>value??''});
  assert.match(details,/建立：管理員甲／2026\/10\/24 19:12:59/);
  assert.match(details,/修改：管理員乙／2026\/10\/25 00:00:00/);
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


test('course dates appear after numbers and in add/edit title options without changing titles',async()=>{
  const elements={},listeners={};
  const title='導論：自然永續的核心觀念與倫理基礎';
  const course={id:2,number:1,title,status:'published'};
  const catalog=[{id:10,title,course_date:'2026/09/15'},{id:11,title:'未排定課程'}];
  const context=vm.createContext({window:{addEventListener(){}},state:{token:'test'},structuredClone,
    document:{addEventListener(name,fn){listeners[name]=fn;},getElementById(id){return elements[id]??={innerHTML:'',value:'',open:true,classList:{add(){}},showModal(){},addEventListener(){}};}},
    fetch:async path=>({ok:true,json:async()=>path.endsWith('/courses')?[course,{id:3,number:2,title:'自訂課程',status:'draft'}]:path.endsWith('/catalog')?catalog:{terms:[],instructors:[]}}),showToast(message){assert.fail(message);}});
  vm.runInContext(source,context);
  await context.window.NSP.admin('nsp_courses');
  assert.match(elements.adminSubPane_nsp_courses.innerHTML,/<th>編號<\/th><th>課程日期<\/th><th>課程名稱<\/th>/);
  assert.match(elements.adminSubPane_nsp_courses.innerHTML,/<td>#1<\/td><td>2026\/09\/15<\/td>/);
  assert.match(elements.adminSubPane_nsp_courses.innerHTML,/<td>#2<\/td><td>—<\/td>/);
  for(const action of ['new','edit']){
    await listeners.click({target:{closest:()=>({dataset:{nsp:action,id:action==='edit'?'2':'',type:'nsp_courses'}})}});
    assert.ok(elements.nspTitleSelect.innerHTML.includes('value="'+title+'"'));
    assert.ok(elements.nspTitleSelect.innerHTML.includes('>[2026/09/15]'+title+'</option>'));
    assert.ok(elements.nspTitleSelect.innerHTML.includes('>未排定課程</option>'));
    assert.equal(elements.nspTitleSelect.value,action==='edit'?title:'__other');
  }
});


test('admin preview opens saved draft content, plays lessons and closes without progress writes',async()=>{
  const elements={},listeners={},requests=[],mediaEvents={};let video,intervals=0;
  const c={id:5,number:1,title:'預覽草稿',status:'draft',category_id:2,cover_url:'https://example.invalid/cover.png',info_html:'<p>介紹內容</p>',instructor_ids:[3],learners:2,makeup_count:33,sections:[{title:'第一章',lessons:[{id:'preview_lesson',title:'影片標題',duration:30,url:'https://example.invalid/video.mp4'}]}],materials:[{category_id:4,title:'講義',url:'https://example.invalid/material.pdf',note:'備註'}]};
  const options={terms:[{id:2,kind:'course',name:'課程分類'},{id:4,kind:'material',name:'教材分類'}],instructors:[{id:3,name:'講師甲'}]};
  const context=vm.createContext({URL,window:{addEventListener(){},scrollTo(){}},state:{token:'test'},structuredClone,clearInterval(){},setInterval(){intervals++;},
    document:{addEventListener(name,fn){listeners[name]=fn;},querySelector(){return null;},getElementById(id){return elements[id]??={innerHTML:'',textContent:'',showModal(){this.open=true;},close(){this.open=false;this.onclose?.();},appendChild(){}};},createElement(){video={currentTime:0,paused:true,addEventListener(name,fn){mediaEvents[name]=fn;},pause(){this.paused=true;mediaEvents.pause?.();}};return video;}},
    fetch:async(path,init)=>{requests.push([path,init.method]);return {ok:true,json:async()=>path.endsWith('/courses')?[c]:path.endsWith('/catalog')?[]:options};},showToast(message){assert.fail(message);}});
  vm.runInContext(source,context);
  await context.window.NSP.admin('nsp_courses');
  assert.match(elements.adminSubPane_nsp_courses.innerHTML,/data-nsp="preview"[^>]*data-id="5"/);
  const click=(action,extra={})=>listeners.click({target:{closest:()=>({dataset:{nsp:action,id:'5',...extra}})}});
  await click('preview');
  assert.equal(elements.nspPreviewDialog.open,true);
  assert.match(elements.nspPreviewContent.innerHTML,/預覽草稿[\s\S]*講師甲[\s\S]*完成學習：33/);
  assert.match(elements.nspPreviewContent.innerHTML,/介紹內容[\s\S]*第一章[\s\S]*影片標題[\s\S]*教材分類[\s\S]*講義/);
  await click('play',{lesson:'preview_lesson'});
  assert.match(elements.nspPreviewContent.innerHTML,/nsp-learning[\s\S]*影片標題[\s\S]*返回課程/);
  assert.equal(video.src,'https://example.invalid/video.mp4');
  video.currentTime=20;video.paused=false;mediaEvents.pause();mediaEvents.ended();
  assert.equal(intervals,0);
  await click('detail');
  assert.match(elements.nspPreviewContent.innerHTML,/介紹內容/);
  await click('preview-close');
  assert.equal(elements.nspPreviewDialog.open,false);
  assert.equal(requests.filter(([,method])=>method!=='GET').length,0);
  await context.window.NSP.admin('nsp_categories');
  assert.doesNotMatch(elements.adminSubPane_nsp_categories.innerHTML,/data-nsp="preview"/);
});

test('preview player flush never submits learning progress',async()=>{
  let called=false;
  const context=vm.createContext({state:{token:'test'},api:()=>{called=true;},player:null});
  vm.runInContext(flushSource,context);
  await context.flush({preview:true,token:'test',position:()=>20,pending:20});
  assert.equal(called,false);
});


const finishSource=source.slice(source.indexOf('  async function finish('),source.indexOf('  function tick('));
function endingContext(preview=false){
  const first={id:'a'},second={id:'b'},c={id:7,sections:[{lessons:[first]},{lessons:[second]}],progress:[]};
  const p={c,l:first,preview,token:'test'},status={textContent:''},calls=[];
  const context=vm.createContext({player:p,state:{token:'test'},lessons:c=>c.sections.flatMap(s=>s.lessons),flush:async()=>{calls.push('saved');return true;},play:async(...args)=>calls.push(args),updateProgress(){calls.push('marked');},clearInterval(){},document:{getElementById:()=>status}});
  vm.runInContext(finishSource,context);
  return {context,p,c,calls,status};
}

test('ended waits for in-flight progress then saves before auto-playing across chapters once',async()=>{
  const {context,p,calls}=endingContext();let resolve;
  p.savePromise=new Promise(r=>resolve=r);
  const ended=context.finish(p);
  await context.finish(p);
  assert.deepEqual(calls,[]);
  resolve();await ended;
  assert.deepEqual(calls,['saved',[7,'b',true]]);
});

test('preview completion marks this session and advances without writing progress',async()=>{
  const {context,p,c,calls}=endingContext(true);
  await context.finish(p);
  assert.equal(c.progress[0].lesson_id,'a');
  assert.equal(c.progress[0].completed,1);
  assert.deepEqual(calls,['marked',[7,'b',true]]);
});

test('last lesson saves and stops with a finished message instead of leaving the course',async()=>{
  for(const preview of [false,true]){
    const {context,p,c,calls,status}=endingContext(preview);p.l=c.sections[1].lessons[0];
    await context.finish(p);
    assert.equal(calls.some(Array.isArray),false);
    assert.match(status.textContent,preview?/全部預覽完畢/:/觀看紀錄已儲存.*全部播放完畢/);
  }
});

test('course completion reports makeup sync success or a retry without losing completion',async()=>{
  for(const synced of [true,false]){
    const {context,p,c,status}=endingContext();p.l=c.sections[1].lessons[0];c.makeup_synced=synced;
    await context.finish(p);
    assert.match(status.textContent,synced?/已同步課程登錄的已補課紀錄/:/學習進度已儲存.*重新開啟課程清單重試/);
  }
});

test('failed progress save does not advance, and manual navigation or logout cancels delayed advancement',async()=>{
  const failed=endingContext();failed.context.flush=async()=>false;
  await failed.context.finish(failed.p);assert.equal(failed.p.ending,false);assert.deepEqual(failed.calls,[]);
  for(const action of ['navigate','logout']){
    const {context,p,calls}=endingContext();let resolve;p.savePromise=new Promise(r=>resolve=r);
    const ended=context.finish(p);
    if(action==='navigate')context.player=null;else context.state.token='other';
    resolve();await ended;assert.deepEqual(calls,[]);
  }
});

test('YouTube auto-next requests autoplay while normal opening retains the saved start',()=>{
  let frame;
  const helper=source.slice(source.indexOf('  function youtubeFrame('),source.indexOf('  async function play('));
  const context=vm.createContext({URL,location:{origin:'https://example.invalid'},document:{createElement(){return frame={setAttribute(){}};}}});
  vm.runInContext(helper,context);
  context.youtubeFrame('M7lc1UVf-VE','影片',12);assert.equal(new URL(frame.src).searchParams.get('start'),'12');assert.equal(new URL(frame.src).searchParams.has('autoplay'),false);
  context.youtubeFrame('M7lc1UVf-VE','影片',0,true);assert.equal(new URL(frame.src).searchParams.get('autoplay'),'1');
});


test('makeup opens the matching attendance course rather than the independent NSP ID',async()=>{
  const elements={},listeners={},calls=[],errors=[];
  let catalog=[{id:17,title:'導論',course_date:'2026/09/15'}];
  const context=vm.createContext({AbortSignal,window:{addEventListener(){}},state:{token:'test'},
    document:{addEventListener(name,fn){listeners[name]=fn;},getElementById(id){return elements[id]??={innerHTML:'',showModal(){this.open=true;},close(){this.open=false;this.onclose?.();}};}},
    fetch:async(path,init)=>{calls.push([path,init]);return {ok:true,status:200,text:async()=>'<h1>學員補課名單</h1>',json:async()=>path.endsWith('/courses')?[{id:2,number:1,title:'導論',status:'published'}]:path.endsWith('/catalog')?catalog:{terms:[],instructors:[]}};},showToast:message=>errors.push(message)});
  vm.runInContext(source,context);
  await context.window.NSP.admin('nsp_courses');
  assert.match(elements.adminSubPane_nsp_courses.innerHTML,/data-nsp="preview"[\s\S]*>補課<\/button>[\s\S]*>修改<\/button>/);
  const click=action=>listeners.click({target:{closest:()=>({dataset:{nsp:action,id:'2'}})}});
  await click('makeup');
  assert.equal(calls.at(-1)[0],'/api/attendance-admin/courses/17/makeup/view');
  assert.equal(calls.at(-1)[1].headers.Authorization,'Bearer test');
  assert.equal(elements.nspMakeupDialog.open,true);
  assert.match(elements.nspMakeupFrame.srcdoc,/學員補課名單/);
  assert.equal(elements.nspMakeupFrame.hidden,false);
  await click('makeup-close');
  assert.equal(elements.nspMakeupDialog.open,false);
  assert.equal(elements.nspMakeupDialog.innerHTML,'');
  for(const rows of [[],[{id:17,title:'導論'},{id:18,title:'導論'}]]){
    catalog=rows;await context.window.NSP.admin('nsp_courses');const before=calls.length;
    await click('makeup');assert.equal(calls.length,before);
  }
  assert.match(errors[0],/找不到對應/);assert.match(errors[1],/多筆同名課程/);
});


test('makeup count replaces started-learner totals consistently in cards and admin lists',async()=>{
  const elements={},listeners={};
  const course={id:1,number:1,title:'導論',category:'分類',instructors:[],sections:[],materials:[],progress:[],total:1,completed:0,percent:0,learners:2,makeup_count:33,cover_url:''};
  const context=vm.createContext({window:{addEventListener(){},scrollTo(){}},state:{token:'test',activeTab:'nsp'},
    document:{addEventListener(name,fn){listeners[name]=fn;},getElementById(id){return elements[id]??={innerHTML:'',value:'',checked:false,addEventListener(){}};}},
    fetch:async path=>({ok:true,json:async()=>path.endsWith('/courses')?[course]:path.endsWith('/catalog')?[]:{terms:[],instructors:[]}})});
  vm.runInContext(source,context);
  await context.window.NSP.load();
  assert.match(elements.nspApp.innerHTML,/已學習/);assert.match(elements.nspApp.innerHTML,/待學習/);
  assert.match(elements.nspCourseGrid.innerHTML,/33人完成學習/);assert.doesNotMatch(elements.nspCourseGrid.innerHTML,/2 人開始學習/);
  await context.window.NSP.admin('nsp_courses');
  assert.match(elements.adminSubPane_nsp_courses.innerHTML,/<th>補課人數<\/th>/);assert.match(elements.adminSubPane_nsp_courses.innerHTML,/<td>33<\/td>/);
});

test('course cards and detail show date icons and completed makeup lessons',async()=>{
  const elements={},listeners={};
  const c={id:1,title:'測試課程',category:'分類',instructors:['講師'],course_date:'2026-10-20',makeup_count:12,makeup_completed:true,sections:[{title:'第一章',lessons:[{id:'a',title:'第一支',duration:7},{id:'b',title:'第二支',duration:7}]}],materials:[],progress:[],total:2,completed:2,percent:100,cover_url:'',info_html:'介紹',material_categories:{}};
  const context=vm.createContext({window:{addEventListener(){},scrollTo(){}},state:{token:'test',activeTab:'nsp'},
    document:{addEventListener(n,f){listeners[n]=f;},getElementById(id){return elements[id]??={innerHTML:'',value:'',checked:false,addEventListener(){}};}},fetch:async()=>({ok:true,json:async()=>[c]})});
  vm.runInContext(source,context);await context.window.NSP.load();
  assert.match(elements.nspCourseGrid.innerHTML,/🕒 2026\/10\/20/);
  assert.match(elements.nspCourseGrid.innerHTML,/value="100"/);
  await listeners.click({target:{closest:()=>({dataset:{nsp:'detail',id:'1'}})}});
  const html=elements.nspApp.innerHTML;
  assert.match(html,/🌿 分類/);assert.match(html,/🕒 2026\/10\/20/);
  assert.match(html,/👤 授課講師/);assert.match(html,/🌳 完成學習：12/);
  assert.match(html,/⌛ 學習進度：2\/2（100%）/);
  assert.match(html,/✅ 第一支/);assert.match(html,/✅ 第二支/);
});

test('returning makeup students see their completion timestamp and the 100 percent rule',async()=>{
  const elements={},listeners={},alerts=[];
  const c={id:1,title:'測試',category:'分類',instructors:[],sections:[{title:'章節',lessons:[{id:'a',title:'影片',url:'https://example.invalid/a.mp4',duration:7}]}],materials:[],progress:[],total:1,completed:1,percent:100,makeup_completed:true,makeup_completed_at:'2026-10-25 19:12:59'};
  const context=vm.createContext({URL,window:{addEventListener(){},scrollTo(){},alert(message){alerts.push(message);}},state:{token:'test',activeTab:'nsp',user:{name:'黃雅筠'}},setInterval(){},clearInterval(){},
    document:{addEventListener(n,f){listeners[n]=f;},querySelector(){return null;},getElementById(id){return elements[id]??={innerHTML:'',value:'',checked:false,addEventListener(){},appendChild(){}};},createElement(){return {addEventListener(){},pause(){}};}},fetch:async()=>({ok:true,json:async()=>[c]})});
  vm.runInContext(source,context);await context.window.NSP.load();
  await listeners.click({target:{closest:()=>({dataset:{nsp:'play',id:'1',lesson:'a'}})}});
  assert.match(elements.nspApp.innerHTML,/黃雅筠 學員 您好！您已於 2026\/10\/25 19:12:59 完成學習。/);
  assert.match(elements.nspApp.innerHTML,/每 10 秒自動儲存，觀看達影片 100% 後計為完成；播完自動播放下一支/);
  assert.doesNotMatch(elements.nspApp.innerHTML,/90%/);
  assert.deepEqual(alerts,['黃雅筠 學員 您好！歡迎您再次學習，您第一次已於 2026/10/25 19:12:59 完成學習，系統會記錄第一次的學習紀錄。']);
  await listeners.click({target:{closest:()=>({dataset:{nsp:'play',id:'1',lesson:'a'}})}});
  assert.equal(alerts.length,1);
  await listeners.click({target:{closest:()=>({dataset:{nsp:'detail',id:'1'}})}});
  await listeners.click({target:{closest:()=>({dataset:{nsp:'play',id:'1',lesson:'a'}})}});
  assert.equal(alerts.length,2);

});

test('the final playback fraction is saved even after the ended state stops playing',()=>{
  const tickSource=source.slice(source.indexOf('  function tick('),source.indexOf('  function stop('));
  const context=vm.createContext({Date:{now:()=>100000},flush(){assert.fail('not ten seconds yet');}});
  vm.runInContext(tickSource,context);
  const p={pending:0,clock:99320,lastSave:100000,l:{duration:7},mediaDuration:()=>6.8,playing:()=>false,rate:()=>1};
  context.tick(p,true);assert.ok(Math.abs(p.pending-0.7)<1e-9);
});


test('first completion alerts only after successful makeup sync and preserves its timestamp on repeat saves',async()=>{
  for(const synced of [true,false]){
    const alerts=[],c={id:1,progress:[],learners:0},p={c,l:{id:'a'},token:'test',pending:7,position:()=>7};
    const saved={completed:1,makeup_synced:synced,...(synced?{makeup_completed_at:'2026-10-26 19:12:59'}:{})};
    const context=vm.createContext({player:p,state:{token:'test',user:{name:'學員甲'}},window:{alert:message=>alerts.push(message)},api:async()=>saved,updateProgress(){},document:{getElementById:()=>({})}});
    vm.runInContext(flushSource,context);
    await context.flush(p);await context.flush(p);
    assert.deepEqual(alerts,synced?['學員甲 學員 您好！恭喜您已於 2026/10/26 19:12:59 完成學習，歡迎您再次學習！']:[]);
    if(synced){assert.equal(c.makeup_completed_at,'2026-10-26 19:12:59');assert.equal(c.makeup_completed,true);}
  }
});


test('public and preview YouTube players block lower-left links while keeping active playback controls usable',async()=>{
  const start=source.indexOf('    if(videoId){',source.indexOf('  async function play('));
  const block=source.slice(start,source.indexOf('    }else{',start))+'    }';
  for(const preview of [false,true]){
    const children=[],p={preview,l:{title:'課程影片'}};
    let events;
    const context=vm.createContext({p,l:p.l,player:p,videoId:'M7lc1UVf-VE',saved:null,autoplay:false,
      youtubeFrame:()=>({tag:'iframe'}),youtube:async()=>({Player:function(frame,options){events=options.events;}}),
      finish(){},flush(){},document:{createElement:()=>({setAttribute(name,value){this[name]=value;}}),getElementById:()=>({appendChild:child=>children.push(child)})}});
    await vm.runInContext('(async()=>{'+block+'})()',context);
    const guard=children.find(c=>c.className==='nsp-youtube-link-guard');
    assert.ok(guard,'both public and preview need the click guard');
    assert.equal(guard['aria-hidden'],'true');
    assert.equal(guard.hidden,false);
    events.onStateChange({data:1});assert.equal(guard.hidden,true);
    events.onStateChange({data:2});assert.equal(guard.hidden,false);
    events.onStateChange({data:0});assert.equal(guard.hidden,false);
  }
  const css=fs.readFileSync(require('node:path').join(__dirname,'../app/static/css/nsp.css'),'utf8');
  assert.match(css,/\.nsp-youtube-link-guard\s*\{[^}]*left:0[^}]*bottom:0/);
  assert.match(css,/\.nsp-youtube-link-guard\s*\{[^}]*pointer-events:auto/);
});
