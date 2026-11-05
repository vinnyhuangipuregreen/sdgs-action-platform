const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../app/static/js/nsp.js'),'utf8');
const input=JSON.parse(fs.readFileSync(0,'utf8')),course=input.course,ordered=course.sections.flatMap(s=>s.lessons);
const markers=Object.fromEntries(ordered.map(l=>[l.id,{textContent:'○'}]));
const elements={nspSaveStatus:{},nspPlayerProgress:{},nspCompletionNotice:{hidden:true}},alerts=[],transitions=[];
let clock=100000,position=0,context;
function playerFor(lesson){return {c:course,l:lesson,preview:false,token:'test',pending:0,clock,lastSave:clock,position:()=>position,playing:()=>true,mediaDuration:()=>7,rate:()=>1};}
context=vm.createContext({Date:{now:()=>clock},state:{token:'test',user:{name:'測試學員'}},previewCourse:null,
  window:{alert:message=>alerts.push(message)},playerElement:id=>elements[id],clearInterval(){},
  root:()=>({querySelector:selector=>markers[selector.match(/"([^"]+)"/)?.[1]]}),lessons:c=>c.sections.flatMap(s=>s.lessons),
  api:async(path,method,body)=>{
    const response=await fetch(process.argv[2]+'/api/nsp'+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;
  },
  play:async(id,lessonId,autoplay)=>{
    transitions.push({id,lessonId,autoplay});position=0;context.player=playerFor(ordered.find(l=>l.id===lessonId));
  }});
const code=source.slice(source.indexOf('  function completionMessage('),source.indexOf('  function stop('));
vm.runInContext(code,context);
context.player=playerFor(ordered[0]);
(async()=>{
  if(input.scenario==='gap'){
    for(const lesson of ordered){
      clock+=500;position=6.881;await context.finish(context.player);
      assert.equal(course.progress.find(r=>r.lesson_id===lesson.id).completed,0);
      assert.equal(markers[lesson.id].textContent,'○');
    }
    assert.equal(transitions.length,ordered.length-1);assert.equal(alerts.length,0);
    assert.equal(elements.nspCompletionNotice.hidden,true);
    assert.match(elements.nspSaveStatus.textContent,/尚未完整觀看/);
    process.stdout.write(JSON.stringify({completed:0,autoplayTransitions:transitions.length,alerts:0}));return;
  }
  for(let i=0;i<ordered.length;i++){
    const p=context.player;
    for(let second=1;second<=6;second++){clock+=1000;position=second;context.tick(p);}
    // YouTube reports a seven-second duration but ends on its final frame at 6.881.
    clock+=881;position=6.881;await context.finish(p);
    assert.equal(course.progress.find(r=>r.lesson_id===ordered[i].id)?.completed,1,'natural end must be saved as complete');
    assert.equal(markers[ordered[i].id].textContent,'V');
    assert.equal(course.completed,i+1);
    if(i<ordered.length-1){
      assert.equal(transitions[i].lessonId,ordered[i+1].id);assert.equal(transitions[i].autoplay,true);
      assert.equal(alerts.length,0,'no course completion before every lesson ends');
    }
  }
  const message='測試學員 學員 您好！您已於 2026/10/26 19:12:59 完成學習。\n\n已經同步了您的補課紀錄，請至[課程登錄]頁面確認，謝謝。';
  assert.deepEqual(alerts,[message]);assert.equal(elements.nspCompletionNotice.textContent,message);
  assert.equal(elements.nspCompletionNotice.hidden,false);
  // A retry keeps the existing completion and does not repeat the alert.
  await context.flush(context.player);assert.equal(alerts.length,1);
  process.stdout.write(JSON.stringify({completed:course.completed,autoplayTransitions:transitions.length,alerts:alerts.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
