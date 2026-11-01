const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app/static/js/nsp.js'),'utf8');
const helpers=source.slice(source.indexOf('  function coursePayload('),source.indexOf('  function sanitizeEditor('));

function editor(id=null){
  const calls=[],toasts=[],nodes={},events={};
  const node=key=>nodes[key]??={value:'',hidden:false,setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},focus(){events.focus=key;},scrollIntoView(){},addEventListener(name,fn){events[key+':'+name]=fn;}};
  const fields={status:{value:'published'},category_id:{value:'2'},cover_url:{value:'https://example.invalid/cover.png'}};
  const form={elements:fields,querySelectorAll(selector){return selector==='[name=instructor_ids]:checked'?instructors.map(value=>({value})):Object.values(nodes).filter(n=>n['aria-invalid']);},querySelector(selector){return selector==='button[type=submit]'?submit:node(selector);},reportValidity(){return true;}};
  const submit={disabled:false};let instructors=['3'];
  node('nspTitleSelect').value='__other';node('nspCustomTitle').value='測試課程';
  node('nspHTMLCode').hidden=true;node('nspRichEditor').innerHTML='<p>課程資訊</p>';
  const edit={id,version:1,sections:[{title:'章節一',lessons:[{id:'lesson_1',title:'影片一',url:'https://example.invalid/video.mp4',duration:60}]}],materials:[]};
  const context=vm.createContext({edit,activeAdmin:'nsp_courses',collectContent(){},sanitizeEditor:v=>v,
    DOMParser:class{parseFromString(html){return {body:{textContent:html.replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,'\u00a0')}};}},
    document:{getElementById:node},showToast:(...args)=>toasts.push(args),api:async(...args)=>calls.push(args),admin(){},
    dialog:()=>({close(){events.closed=true;},classList:{remove(){}}}),FormData:class{}});
  vm.runInContext(helpers,context);
  return {context,form,fields,edit,node,calls,toasts,events,setInstructors(value){instructors=value;},save:()=>context.saveEditor({preventDefault(){},currentTarget:form})};
}

test('new and edited courses block every missing starred field before sending any API request',async()=>{
  const missing=[['課程名稱',e=>e.node('nspCustomTitle').value='  '],['課程分類',e=>e.fields.category_id.value=''],['課程封面',e=>e.fields.cover_url.value=''],['課程資訊',e=>e.node('nspRichEditor').innerHTML='<p>&nbsp;\u200b<br></p>'],['課程講師',e=>e.setInstructors([])]];
  for(const id of [null,9])for(const [label,clear] of missing){
    const e=editor(id);clear(e);await e.save();
    assert.equal(e.calls.length,0,label);
    assert.match(e.node('nspEditorError').textContent,new RegExp(label));
    assert.equal(e.toasts[0][1],'error');assert.ok(e.events.focus);assert.equal(e.events.closed,undefined);
    assert.equal(e.form.querySelector('button[type=submit]').disabled,false);
  }
});

test('publishing lists all missing values and checks at least one instructor and positive video duration',()=>{
  const e=editor();e.fields.cover_url.value='';e.node('nspRichEditor').innerHTML='<p><br></p>';e.setInstructors([]);e.edit.sections[0].lessons[0].duration=0;
  assert.equal(e.context.checkCourse(e.form,e.context.coursePayload(e.form)),false);
  for(const label of ['課程封面','課程資訊','至少選擇一位','影片長度'])assert.ok(e.node('nspEditorError').textContent.includes(label));
  assert.equal(e.calls.length,0);
  e.edit.sections=[];
  assert.ok(e.context.courseErrors(e.context.coursePayload(e.form)).some(([label])=>label.includes('至少一部')));
});

test('empty HTML source is checked and focused when the rich-text editor is in HTML mode',async()=>{
  const e=editor(9);e.node('nspHTMLCode').hidden=false;e.node('nspHTMLCode').value='<p>&#160;</p>';
  await e.save();assert.equal(e.calls.length,0);assert.equal(e.events.focus,'#nspHTMLCode');
});

test('drafts save optional unfinished content; complete courses submit POST or PUT with one instructor',async()=>{
  for(const id of [null,9]){
    const draft=editor(id);draft.fields.status.value='draft';draft.fields.cover_url.value='';draft.node('nspRichEditor').innerHTML='';draft.setInstructors([]);draft.edit.sections=[];
    await draft.save();assert.equal(draft.calls.length,1);assert.equal(draft.calls[0][2].status,'draft');
    const published=editor(id);await published.save();assert.equal(published.calls.length,1);
    assert.equal(published.calls[0][0],id?'/admin/courses/9':'/admin/courses');
    assert.equal(published.calls[0][1],id?'PUT':'POST');assert.deepEqual(Array.from(published.calls[0][2].instructor_ids),[3]);
    assert.equal(published.events.closed,true);
  }
});

test('course editor checks on changing publication status and clears warnings on returning to draft',()=>{
  const e=editor();
  e.context.meta={terms:[],instructors:[]};e.context.openDialog=()=>{};e.context.dialog=()=>({classList:{add(){}}});
  e.context.field=()=>'';e.context.input=()=>'';e.context.options=()=>'';e.context.button=()=>'';e.context.auditDetails=()=>'';e.context.required='*';
  e.context.renderTitleOptions=()=>{};e.context.renderSections=()=>{};e.context.renderMaterials=()=>{};
  e.context.esc=v=>v;
  // Use the real editor setup and its event callback, with the rendered controls represented above.
  vm.runInContext(source.slice(source.indexOf('  function openCourseEditor('),source.indexOf('  function collectContent(')),e.context);
  Object.assign(e.node('nspEditor'),e.form);
  const original=e.context.checkCourse;let checked=0;e.context.checkCourse=()=>{checked++;return false;};
  e.context.openCourseEditor();
  e.events['nspPublishStatus:change']({target:{value:'published'}});assert.equal(checked,1);
  e.node('nspEditorError').textContent='缺少必填欄位';
  e.events['nspPublishStatus:change']({target:{value:'draft'}});assert.equal(checked,1);assert.equal(e.node('nspEditorError').textContent,'');
  e.context.checkCourse=original;
});
