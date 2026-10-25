/* NSP learning and authoring use the existing account session and academic year. */
window.NSP = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const coverImage = value => {
    try {
      const url = new URL(value);
      if (url.hostname !== 'drive.google.com') return value;
      const id = url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1] || url.searchParams.get('id');
      if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return value;
      const image = new URL('https://drive.google.com/thumbnail');
      image.searchParams.set('id', id);
      image.searchParams.set('sz', 'w1200');
      if (url.searchParams.has('resourcekey')) image.searchParams.set('resourcekey', url.searchParams.get('resourcekey'));
      return image.href;
    } catch { return value; }
  };
  const uid = () => crypto.randomUUID().replaceAll('-', '');
  const labels = { nsp_courses:'課程管理', nsp_categories:'課程分類管理', nsp_material_categories:'課程教材分類管理', nsp_instructors:'課程講師管理' };
  const api = async (path, method='GET', body) => {
    const token = state.token;
    const response = await fetch(`/api/nsp${path}`, {method, headers:{Authorization:`Bearer ${token}`, ...(body ? {'Content-Type':'application/json'} : {})}, ...(body ? {body:JSON.stringify(body)} : {})});
    const data = await response.json();
    if (token !== state.token) throw new Error('帳號已切換，請重新載入');
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : Array.isArray(data.detail) ? data.detail.map(e=>e.msg.replace(/^Value error, /,'')).join('；') : '請檢查必填欄位、網址及課程發布條件');
    return data;
  };
  const button = (text, action, extra='', secondary=false) => `<button type="button" class="ds-button ${secondary?'ds-button-secondary':''}" data-nsp="${action}" ${extra}>${text}</button>`;
  const empty = text => `<div class="nsp-empty">${esc(text)}</div>`;
  const auditDate = value => {
    if (!value) return '';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
    return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  };
  const courseDate = value => value ? value.replaceAll('-', '/').split('/').map((part,i)=>i?part.padStart(2,'0'):part).join('/') : '—';
  const audit = row => `<small>${esc(row.created_by_name)}<br>${esc(auditDate(row.created_at))}</small></td><td><small>${esc(row.updated_by_name)}<br>${esc(auditDate(row.updated_at))}</small>`;
  const auditDetails = row => row.created_at ? '建立：'+esc(row.created_by_name)+'／'+esc(auditDate(row.created_at))+'<br>修改：'+esc(row.updated_by_name)+'／'+esc(auditDate(row.updated_at)) : '建立與修改帳號、時間由系統自動記錄。';
  const required = '<span class="required-marker"> *</span>';
  const field = (label, control) => `<label class="nsp-field"><span>${label}</span>${control}</label>`;
  const input = (name, value='', type='text', extra='') => `<input name="${name}" type="${type}" value="${esc(value)}" ${extra}>`;
  const options = (rows, selected, value='id', text='name') => '<option value="">請選擇</option>'+rows.map(r=>`<option value="${esc(r[value])}" ${String(r[value])===String(selected)?'selected':''}>${esc(r[text])}</option>`).join('');
  let courses=[], meta={terms:[],instructors:[]}, adminRows=[], catalog=[], activeAdmin='', edit=null, player=null, previewCourse=null, generation=0, makeupRequest=0;
  const root = () => document.getElementById(previewCourse?'nspPreviewContent':'nspApp');
  const dialog = () => document.getElementById('nspDialog');
  const minutes = seconds => { const total=Math.round(seconds||0); return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`; };
  const lessons = c => c.sections.flatMap(s=>s.lessons);
  const course = id => previewCourse?.id===Number(id)?previewCourse:courses.find(c=>c.id===Number(id));

  async function load() {
    await stop();
    const request = ++generation;
    if (!state.token) {
      root().innerHTML = `<div class="nsp-welcome"><span class="eyebrow">NSP 數位學習中心</span><h2>從理解，走向實踐</h2><p>登入後即可開始學習，保存您的課程進度。</p>${button('學員登入','login')}</div>`;
      return;
    }
    root().innerHTML=empty('正在讀取本學年度課程…');
    try {
      courses=await api('/courses');
      if (request!==generation || state.activeTab!=='nsp') return;
      renderCatalog();
    } catch (error) { if(request===generation) root().innerHTML=empty(error.message); }
  }
  function renderCatalog() {
    window.scrollTo(0,0);
    const done=courses.filter(c=>c.total>0 && c.completed===c.total).length;
    const total= courses.reduce((a,c)=>a+c.total,0), completed=courses.reduce((a,c)=>a+c.completed,0);
    root().innerHTML=`<section class="nsp-welcome"><span class="eyebrow">NSP 數位學習中心</span><h2>歡迎您，${esc(state.user?.name || '學員')}！</h2><p>這裡是您的 NSP 數位學習中心。讓我們一起積累知識、持續精進，解鎖您的 SDGs 永續智慧力！</p></section>
    <div class="nsp-stats">${[['☘','總堂數',courses.length+' 堂'],['✓','已學習',done+' 堂'],['◷','待學習',(courses.length-done)+' 堂'],['⌛','進度',(total?Math.round(completed/total*100):0)+'%']].map(([icon,name,n])=>`<div class="ds-card"><span>${icon}</span><small>${name}</small><strong>${n}</strong></div>`).join('')}</div>
    <div class="nsp-catalog-toolbar"><h3>本學年度課程</h3><label>搜尋課程 <input id="nspSearch" placeholder="課程名稱、講師、分類"></label><label><input id="nspFavorites" type="checkbox"> 只看收藏</label></div><div id="nspCourseGrid" class="nsp-course-grid"></div>`;
    renderCards();
    document.getElementById('nspSearch').addEventListener('input',renderCards);
    document.getElementById('nspFavorites').addEventListener('change',renderCards);
  }
  function renderCards() {
    const search=document.getElementById('nspSearch').value.trim().toLowerCase(), favorites=document.getElementById('nspFavorites').checked;
    const selected=courses.filter(c=>(!favorites||c.bookmarked) && [c.title,c.category,...c.instructors].join(' ').toLowerCase().includes(search));
    document.getElementById('nspCourseGrid').innerHTML=selected.map(c=>`<article class="ds-card nsp-course-card"><div class="nsp-cover"><img src="${esc(coverImage(c.cover_url))}" alt="${esc(c.title)}" loading="lazy"><button type="button" data-nsp="bookmark" data-id="${c.id}" aria-label="${c.bookmarked?'取消收藏':'收藏'}${esc(c.title)}" aria-pressed="${c.bookmarked}">${c.bookmarked?'★':'☆'}</button></div><div class="nsp-card-copy"><p class="nsp-course-date">🕒 ${esc(courseDate(c.course_date))}</p><h3>${esc(c.title)}</h3><p>👤 ${esc(c.instructors.join('、'))}</p><p>🌿 ${esc(c.category)}</p><p>🌳 ${c.makeup_count ?? '—'}人完成學習</p>${c.makeup_synced===false?'<p role="status">補課同步未完成，請重新開啟課程清單重試。</p>':''}<div class="nsp-progress"><progress max="100" value="${c.percent}"></progress><span>${c.percent}%</span></div>${button(c.completed?'繼續學習':'開始學習','detail',`data-id="${c.id}"`)}</div></article>`).join('') || empty(courses.length?'沒有符合條件的課程':'本學年度尚無已發布課程，敬請期待。');
  }
  async function preview(id) {
    await stop();
    const row=adminRows.find(c=>c.id===Number(id)); if(!row)return;
    previewCourse={...structuredClone(row),category:meta.terms.find(t=>t.id===row.category_id)?.name||'',instructors:meta.instructors.filter(i=>row.instructor_ids.includes(i.id)).map(i=>i.name),material_categories:Object.fromEntries(meta.terms.map(t=>[t.id,t.name])),progress:[],completed:0,total:lessons(row).length,percent:0};
    const modal=document.getElementById('nspPreviewDialog');
    modal.innerHTML=`<header class="nsp-preview-header"><h2>課程預覽</h2>${button('關閉預覽','preview-close','',true)}</header><div id="nspPreviewContent"></div>`;
    modal.onclose=()=>{stop(false);previewCourse=null;modal.innerHTML='';};
    modal.showModal();
    await detail(id);
  }
  async function detail(id) {
    await stop();
    if(previewCourse)document.getElementById('nspPreviewDialog').scrollTop=0;else window.scrollTo(0,0);
    const c=course(id); if(!c) return;
    root().innerHTML=`<div class="nsp-back">${button(previewCourse?'← 返回課程管理':'← 返回課程清單',previewCourse?'preview-close':'catalog','',true)}</div><section class="ds-card nsp-course-detail"><img src="${esc(coverImage(c.cover_url))}" alt="${esc(c.title)}"><div><span class="eyebrow">🌿 ${esc(c.category)}</span><p class="nsp-course-date">🕒 ${esc(courseDate(c.course_date))}</p><h2>${esc(c.title)}</h2><p>👤 授課講師：${esc(c.instructors.join('、'))}</p><p>🌳 完成學習：${c.makeup_count ?? '—'}</p>${previewCourse?'<p class="nsp-help">預覽模式，不記錄學習進度。</p>':`<p>⌛ 學習進度：${c.completed}/${c.total}（${c.percent}%）</p><progress max="100" value="${c.percent}"></progress>`}</div></section><section class="ds-card nsp-content"><h3>課程資訊</h3><div class="nsp-rich-text">${c.info_html}</div></section><section class="ds-card nsp-content"><h3>課程內容</h3>${c.sections.map(s=>`<div class="nsp-section"><h4>${esc(s.title)}</h4>${s.lessons.map(l=>`<button type="button" class="nsp-lesson" data-nsp="play" data-id="${c.id}" data-lesson="${l.id}"><span>${(c.makeup_completed || c.progress.find(p=>p.lesson_id===l.id)?.completed)?'✅':'▷'} ${esc(l.title)}</span><time>${minutes(l.duration)}</time></button>`).join('')}</div>`).join('')}</section><section class="ds-card nsp-content"><h3>教材內容</h3>${c.materials.map(m=>`<div class="nsp-material"><span class="nsp-tag">${esc(c.material_categories[m.category_id])}</span><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">⇩ ${esc(m.title)}</a><small>${esc(m.note)}</small></div>`).join('')||empty('尚無教材')}</section>`;
  }
  let ytPromise;
  function youtube() {
    if(window.YT?.Player) return Promise.resolve(window.YT);
    if(!ytPromise) ytPromise=new Promise((resolve,reject)=>{
      window.onYouTubeIframeAPIReady=()=>resolve(window.YT);
      const script=document.createElement('script'); script.src='https://www.youtube.com/iframe_api'; script.onerror=()=>{ytPromise=null;reject(new Error('YouTube 播放器暫時無法載入'));};document.head.appendChild(script);
    });
    return ytPromise;
  }
  function youtubeId(url) {
    try { const u=new URL(url); if(['youtube.com','www.youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(u.hostname)) return u.searchParams.get('v') || u.pathname.match(/\/(?:embed|shorts)\/([\w-]{11})/)?.[1]; if(u.hostname==='youtu.be') return u.pathname.slice(1).split('/')[0]; } catch {} return null;
  }
  function updateProgress(c) {
    c.completed=c.makeup_completed?c.total:c.progress.filter(p=>p.completed && lessons(c).some(l=>l.id===p.lesson_id)).length;
    c.percent=c.total?Math.round(c.completed/c.total*100):0;
    const label=document.getElementById('nspPlayerProgress'); if(label)label.textContent=previewCourse?'課程預覽':`你的進度：${c.completed}/${c.total}（${c.percent}%）`;
    for(const l of lessons(c)) { const mark=document.querySelector(`[data-nsp-marker="${l.id}"]`); if(mark)mark.textContent=(c.makeup_completed || c.progress.find(p=>p.lesson_id===l.id)?.completed)?'✓':'○'; }
  }
  async function flush(p=player) {
    if(!p || p.preview || state.token!==p.token || !p.position) return;
    if(p.sending)return p.savePromise;
    p.sending=true; const delta=Math.min(30,p.pending), position=p.position();
    p.savePromise=(async()=>{try {
      const saved=await api(`/courses/${p.c.id}/progress/${p.l.id}`,'PUT',{position,watched_delta:delta}); p.pending=Math.max(0,p.pending-delta); if('makeup_synced' in saved)p.c.makeup_synced=saved.makeup_synced;
      const progress=p.c.progress.find(r=>r.lesson_id===p.l.id);
      if(progress)Object.assign(progress,saved,{position});else { if(!p.c.progress.length)p.c.learners++; p.c.progress.push({lesson_id:p.l.id,...saved,position}); }
      if(player===p) { updateProgress(p.c); document.getElementById('nspSaveStatus').textContent=p.c.makeup_synced===true?'已完成學習，已同步課程登錄的已補課紀錄。':p.c.makeup_synced===false?'學習進度已儲存；補課同步未完成，請重新開啟課程清單重試。':'進度已儲存'; }
      return true;
    }catch(error){ if(player===p)document.getElementById('nspSaveStatus').textContent='進度尚未儲存：'+error.message; return false; }finally{p.sending=false;}})();
    return p.savePromise;
  }
  async function finish(p) {
    if(player!==p || p.ending || state.token!==p.token)return;
    p.ending=true;
    if(p.preview){
      const saved=p.c.progress.find(r=>r.lesson_id===p.l.id);
      if(saved)saved.completed=1;else p.c.progress.push({lesson_id:p.l.id,completed:1});
      updateProgress(p.c);
    }else{
      await p.savePromise;
      if(player!==p || state.token!==p.token)return;
      if(!await flush(p)){p.ending=false;return;}
    }
    if(player!==p || state.token!==p.token)return;
    clearInterval(p.timer);
    const ordered=lessons(p.c),next=ordered[ordered.findIndex(l=>l.id===p.l.id)+1];
    if(next)await play(p.c.id,next.id,true);
    else document.getElementById('nspSaveStatus').textContent=p.preview?'本課程影片已全部預覽完畢。':p.c.makeup_synced===true?'已完成學習，已同步課程登錄的已補課紀錄。':p.c.makeup_synced===false?'學習進度已儲存；補課同步未完成，請重新開啟課程清單重試。':'影片觀看紀錄已儲存，本課程影片已全部播放完畢。';
  }
  function tick(p) {
    const time=Date.now();
    if(p.playing?.())p.pending+=Math.min(2,(time-p.clock)/1000)*(p.rate?.()||1);
    p.clock=time;
    if(time-p.lastSave>=10000){p.lastSave=time;flush(p);}
  }
  function stop(save=true) {
    const p=player; if(!p)return;
    clearInterval(p.timer); const saved=save && !p.ending?flush(p):Promise.resolve();
    player=null; p.yt?.destroy(); p.video?.pause();
    return saved;
  }
  function youtubeFrame(id,title,start=0,autoplay=false) {
    const frame=document.createElement('iframe');
    frame.id='nspYouTube'; frame.title=title;
    frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');
    frame.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen=true; frame.frameBorder='0';
    frame.referrerPolicy='strict-origin-when-cross-origin';
    const url=new URL(`https://www.youtube.com/embed/${id}`);
    for(const [key,value] of Object.entries({enablejsapi:1,origin:location.origin,start,rel:0,playsinline:1}))url.searchParams.set(key,value);
    if(autoplay)url.searchParams.set('autoplay','1');
    frame.src=url.href;
    return frame;
  }
  async function play(id,lessonId,autoplay=false) {
    await stop(); const c=course(id),l=lessons(c).find(l=>l.id===lessonId); if(!l)return;
    if(previewCourse)document.getElementById('nspPreviewDialog').scrollTop=0;else window.scrollTo(0,0);
    const saved=autoplay?null:c.progress.find(p=>p.lesson_id===lessonId);
    root().innerHTML=`<div class="nsp-learning"><aside class="nsp-outline"><h3>課程內容［學習區］</h3>${c.sections.map(s=>`<details open><summary>${esc(s.title)}</summary>${s.lessons.map(item=>`<button type="button" data-nsp="play" data-id="${id}" data-lesson="${item.id}" ${item.id===lessonId?'aria-current="true"':''}><span data-nsp-marker="${item.id}">${(c.makeup_completed || c.progress.find(p=>p.lesson_id===item.id)?.completed)?'✓':'○'}</span><span>${esc(item.title)}</span><time>${minutes(item.duration)}</time></button>`).join('')}</details>`).join('')}</aside><section class="nsp-screen"><div class="nsp-player-header">${button('←','detail',`data-id="${id}"`,true)}<strong>${esc(c.title)}｜${esc(l.title)}</strong><span id="nspPlayerProgress"></span>${button('✕','detail',`data-id="${id}" aria-label="關閉學習區"`,true)}</div><div class="nsp-video-wrap" id="nspVideo"></div><div class="nsp-player-footer"><span id="nspSaveStatus" role="status">${previewCourse?'預覽模式，不記錄正式學習進度；播完自動播放下一支。':'觀看進度每 10 秒自動儲存，觀看達影片 90% 後計為完成；播完自動播放下一支。'}</span>${button('返回課程','detail',`data-id="${id}"`,true)}</div></section></div>`;
    const p={c,l,preview:!!previewCourse,token:state.token,pending:0,sending:false,clock:Date.now(),lastSave:Date.now()}; player=p; updateProgress(c);
    const videoId=youtubeId(l.url);
    if(videoId){
      const frame=youtubeFrame(videoId,l.title,Math.floor(saved?.position||0),autoplay);
      document.getElementById('nspVideo').appendChild(frame);
      try{const YT=await youtube();if(player!==p)return;p.yt=new YT.Player(frame,{events:{onReady:()=>{p.position=()=>p.yt.getCurrentTime();p.playing=()=>p.yt.getPlayerState()===1;p.rate=()=>p.yt.getPlaybackRate();if(autoplay)p.yt.playVideo();},onStateChange:event=>{if(event.data===0)finish(p);else if(event.data===2 && !p.ending)flush(p);},onAutoplayBlocked:()=>{if(player===p)document.getElementById('nspSaveStatus').textContent='已切換下一支影片，請點選播放以繼續。';},onError:()=>{if(player===p)document.getElementById('nspSaveStatus').textContent='影片無法播放，請確認連結及嵌入權限';}}});}catch(error){if(player===p)document.getElementById('nspSaveStatus').textContent=error.message;}
    }else{
      const v=document.createElement('video');v.controls=true;v.preload='metadata';v.src=l.url;v.poster=coverImage(c.cover_url);v.playsInline=true;document.getElementById('nspVideo').appendChild(v);p.video=v;p.position=()=>v.currentTime;p.playing=()=>!v.paused&&!v.ended;p.rate=()=>v.playbackRate;
      v.addEventListener('loadedmetadata',()=>{v.currentTime=Math.min(saved?.position||0,v.duration||0);if(autoplay)v.play().catch(()=>{if(player===p)document.getElementById('nspSaveStatus').textContent='已切換下一支影片，請點選播放以繼續。';});});v.addEventListener('pause',()=>{if(player===p && !p.ending)flush(p);});v.addEventListener('ended',()=>finish(p));v.addEventListener('error',()=>{if(player===p)document.getElementById('nspSaveStatus').textContent='影片無法播放，請使用可公開存取的影片檔案或 YouTube 網址';});
    }
    if(!p.preview)p.timer=setInterval(()=>tick(p),1000);
  }

  async function makeup(id) {
    const row=adminRows.find(c=>c.id===Number(id));
    const matches=catalog.filter(c=>c.title===row?.title);
    if(matches.length!==1)throw new Error(matches.length?'有多筆同名課程，請至「課程登錄」選擇正確的課程補課名單。':'找不到對應的課程登錄資料，請先確認課程名稱。');
    const token=state.token,request=++makeupRequest,modal=document.getElementById('nspMakeupDialog');
    modal.innerHTML=`<header class="nsp-preview-header"><h2>學員補課名單</h2>${button('返回後台課程列表','makeup-close','',true)}</header><p id="nspMakeupStatus" role="status" class="nsp-help">正在讀取學員補課名單…</p><iframe id="nspMakeupFrame" title="${esc(row.title)}：學員補課名單" hidden></iframe>`;
    modal.onclose=()=>{makeupRequest++;modal.innerHTML='';};
    modal.showModal();
    try{
      const response=await fetch(`/api/attendance-admin/courses/${matches[0].id}/makeup/view`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(45000)});
      if(state.token!==token || request!==makeupRequest)return;
      if(response.status===401){modal.close();handleLogout();return;}
      if(!response.ok)throw new Error('學員補課名單暫時無法載入，請關閉後重試。');
      const html=await response.text();
      if(state.token!==token || request!==makeupRequest)return;
      const frame=document.getElementById('nspMakeupFrame');frame.srcdoc=html;frame.hidden=false;
      document.getElementById('nspMakeupStatus').textContent='';
    }catch(error){if(state.token===token && request===makeupRequest)document.getElementById('nspMakeupStatus').textContent=error.message;}
  }
  window.addEventListener('message',event=>{
    const frame=document.getElementById('nspMakeupFrame');
    if(event.origin!==location.origin || !frame || event.source!==frame.contentWindow)return;
    if(event.data?.type==='nsp-makeup-close')document.getElementById('nspMakeupDialog').close();
    else if(event.data?.type==='attendance-admin-expired'){document.getElementById('nspMakeupDialog').close();handleLogout();}
  });
  async function admin(type) {
    activeAdmin=type; const mount=document.getElementById(`adminSubPane_${type}`);
    mount.innerHTML=empty('正在載入…');
    try {
      meta=await api('/admin/options');
      adminRows=type==='nsp_courses'?await api('/admin/courses'):type==='nsp_instructors'?meta.instructors:meta.terms.filter(t=>t.kind===(type==='nsp_categories'?'course':'material'));
      let catalogError='';
      if(type==='nsp_courses'){
        catalog=[];
        try{catalog=await api('/admin/catalog');}catch(error){catalogError=error.message;}
      }
      if(activeAdmin!==type)return;
      const instructor=type==='nsp_instructors', isCourse=type==='nsp_courses';
      mount.innerHTML=`<div class="ds-card nsp-admin"><div class="nsp-admin-heading"><div><span class="eyebrow">NSP 數位學習</span><h3>${labels[type]}</h3></div>${button('＋ 新增'+(isCourse?'課程':instructor?'講師':'分類'),'new',`data-type="${type}"`)}</div>${catalogError?empty(catalogError):''}<div class="nsp-table-wrap"><table><thead><tr><th>編號</th>${isCourse?'<th>課程日期</th>':''}<th>${isCourse?'課程名稱':instructor?'講師名稱':'分類名稱'}</th>${instructor?'<th>電子郵件</th>':''}${isCourse?'<th>補課人數</th><th>狀態</th>':''}<th>建立資訊</th><th>修改資訊</th><th>操作</th></tr></thead><tbody>${adminRows.map(row=>`<tr><td>#${row.number}</td>${isCourse?`<td>${esc([...new Set(catalog.filter(c=>c.title===row.title).map(c=>c.course_date?.replaceAll('-','/')).filter(Boolean))].join('、')||'—')}</td>`:''}<td>${esc(row.name||row.title)}</td>${instructor?`<td>${esc(row.email)}</td>`:''}${isCourse?`<td>${esc(row.makeup_count ?? '—')}</td><td><span class="nsp-tag">${row.status==='published'?'已發布':'草稿'}</span></td>`:''}<td>${audit(row)}</td><td>${isCourse?button('預覽','preview',`data-id="${row.id}"`,true)+' '+button('補課','makeup',`data-id="${row.id}"`,true)+' ':''}${button('修改','edit',`data-id="${row.id}" data-type="${type}"`,true)} ${button('刪除','delete',`data-id="${row.id}" data-type="${type}"`,true)}</td></tr>`).join('')||`<tr><td colspan="${isCourse?8:instructor?6:5}">尚無資料，請新增。</td></tr>`}</tbody></table></div></div>`;
    }catch(error){mount.innerHTML=empty(error.message);}
  }
  function openDialog(title,body) {
    dialog().innerHTML=`<form id="nspEditor"><header><h3>${title}</h3>${button('關閉','close','',true)}</header><div class="nsp-editor-body">${body}</div><p id="nspEditorError" role="alert"></p><footer>${button('取消','close','',true)}<button type="submit" class="ds-button">儲存</button></footer></form>`;
    dialog().showModal();
    document.getElementById('nspEditor').addEventListener('submit',saveEditor);
  }
  async function editItem(type,id) {
    activeAdmin=type; const existing=adminRows.find(r=>r.id===Number(id));
    edit=existing?structuredClone(existing):{id:null};
    if(type!=='nsp_courses'){
      const instructor=type==='nsp_instructors';
      openDialog((id?'修改':'新增')+(instructor?'課程講師':'分類'),field(instructor?'課程講師編號':'分類編號',input('display_id',edit.number||'系統自動編號','text','readonly'))+field((instructor?'講師名稱':'分類名稱')+required,input('name',edit.name||'','text','required maxlength="100"'))+(instructor?field('電子郵件'+required,input('email',edit.email||'','email','required maxlength="254"'))+field('講師簡介'+required,`<textarea name="bio" rows="4" required>${esc(edit.bio)}</textarea>`)+field('講師專長'+required,`<textarea name="expertise" rows="4" required>${esc(edit.expertise)}</textarea>`):'')+`<p class="nsp-audit">${auditDetails(edit)}</p>`);
      return;
    }
    edit={title:'',category_id:'',cover_url:'',info_html:'',instructor_ids:[],sections:[],materials:[],status:'draft',version:0,...edit};
    catalog=[];
    openCourseEditor();
    try{catalog=await api('/admin/catalog');if(dialog().open && document.getElementById('nspTitleSelect'))renderTitleOptions();}catch(error){const notice=document.getElementById('nspCatalogNotice');if(notice)notice.textContent=error.message;}
  }
  function renderTitleOptions() {
    const select=document.getElementById('nspTitleSelect'); const title=document.getElementById('nspCustomTitle').value||edit.title;
    select.innerHTML=options(catalog.map(c=>({...c,label:c.course_date?'['+c.course_date.replaceAll('-', '/')+']'+c.title:c.title})),title,'title','label')+'<option value="__other">其他</option>';
    select.value=catalog.some(c=>c.title===title)?title:'__other';
    document.getElementById('nspCustomTitle').hidden=select.value!=='__other';
  }
  function openCourseEditor() {
    const terms=meta.terms.filter(t=>t.kind==='course');
    openDialog(edit.id?'修改課程':'新增課程',`<div class="nsp-form-grid">${field('課程編號',input('display_id',edit.number||'系統自動編號','text','readonly'))}${field('發布狀態',`<select name="status"><option value="draft" ${edit.status==='draft'?'selected':''}>草稿</option><option value="published" ${edit.status==='published'?'selected':''}>發布</option></select>`)}${field('課程名稱'+required,`<select id="nspTitleSelect"><option value="__other">其他</option></select><input id="nspCustomTitle" value="${esc(edit.title)}" placeholder="其他課程名稱" maxlength="250"><small id="nspCatalogNotice"></small>`)}${field('課程分類'+required,`<select name="category_id" required>${options(terms,edit.category_id)}</select>`)}${field('課程封面'+required,input('cover_url',edit.cover_url,'url','placeholder="https://… 圖片網址"'))}</div><p class="nsp-help">草稿可先儲存未完成內容；發布前須填妥所有紅色 * 欄位及影片長度。封面與教材先使用網址。</p><div class="nsp-field"><span>課程資訊${required}</span><div class="nsp-html-toolbar">${[['bold','粗體'],['italic','斜體'],['underline','底線'],['insertUnorderedList','項目清單'],['formatBlock','標題']].map(([cmd,text])=>button(text,'format',`data-cmd="${cmd}"`,true)).join('')}${button('加入連結','link','',true)}${button('HTML／視覺','html','',true)}</div><div id="nspRichEditor" contenteditable="true" role="textbox" aria-label="課程資訊 HTML 編輯器" class="nsp-rich-editor">${edit.info_html}</div><textarea id="nspHTMLCode" rows="7" hidden>${esc(edit.info_html)}</textarea></div><div class="nsp-admin-heading"><h4>課程內容</h4>${button('＋ 新增章節','section')}</div><div id="nspSectionEditor"></div><div class="nsp-admin-heading"><h4>教材內容</h4>${button('＋ 新增教材','material')}</div><div id="nspMaterialEditor"></div><fieldset class="nsp-instructors"><legend>課程講師${required}（可複選）</legend>${meta.instructors.map(i=>`<label><input type="checkbox" name="instructor_ids" value="${i.id}" ${edit.instructor_ids.includes(i.id)?'checked':''}>${esc(i.name)} <small>${esc(i.email)}</small></label>`).join('')||'<p>請先至「課程講師管理」建立講師。</p>'}</fieldset><p class="nsp-audit">${auditDetails(edit)}</p>`);
    dialog().classList.add('nsp-course-dialog');
    document.getElementById('nspTitleSelect').addEventListener('change',event=>{document.getElementById('nspCustomTitle').hidden=event.target.value!=='__other';});
    document.getElementById('nspRichEditor').addEventListener('paste',event=>{event.preventDefault();document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));});
    renderTitleOptions(); renderSections(); renderMaterials();
  }
  function collectContent() {
    edit.sections=Array.from(document.querySelectorAll('.nsp-edit-section')).map(section=>({title:section.querySelector('[data-section-title]').value,lessons:Array.from(section.querySelectorAll('.nsp-edit-lesson')).map(row=>({id:row.dataset.lessonId,title:row.querySelector('[data-lesson-title]').value,url:row.querySelector('[data-lesson-url]').value.trim(),duration:Number(row.querySelector('[data-lesson-duration]').value)||0}))}));
    edit.materials=Array.from(document.querySelectorAll('.nsp-edit-material')).map(row=>({category_id:Number(row.querySelector('[data-material-category]').value),title:row.querySelector('[data-material-title]').value,url:row.querySelector('[data-material-url]').value.trim(),note:row.querySelector('[data-material-note]').value}));
  }
  function renderSections() {
    document.getElementById('nspSectionEditor').innerHTML=edit.sections.map((s,index)=>`<section class="nsp-edit-section" data-section="${index}"><span class="nsp-editor-number">#章節${index+1}</span><div class="nsp-admin-heading"><input data-section-title value="${esc(s.title)}" placeholder="輸入章節標題" aria-label="章節標題">${button('↑','move-section',`data-index="${index}" data-step="-1"`,true)}${button('↓','move-section',`data-index="${index}" data-step="1"`,true)}${button('刪除章節','remove-section',`data-index="${index}"`,true)}</div>${s.lessons.map((l,j)=>`<div class="nsp-edit-lesson" data-lesson-id="${l.id}" data-metadata-url="${l.duration>0?esc(l.url):''}"><span class="nsp-editor-number">#影片${index+1}-${j+1}</span><div>${field('課程影片標題',`<input data-lesson-title value="${esc(l.title)}" placeholder="輸入課程標題">`)}${field('課程影片連結',`<input data-lesson-url onblur="NSP.detect(this)" type="url" value="${esc(l.url)}" placeholder="YouTube 或 MP4／WebM 網址">`)}</div><div>${field('影片長度（秒）',`<input data-lesson-duration type="number" min="0" max="86400" value="${l.duration}" step="any">`)}${button('自動偵測長度','duration',`data-index="${index}" data-row="${j}"`,true)}<small class="nsp-detect-status"></small></div><div class="nsp-row-actions">${button('↑','move-lesson',`data-index="${index}" data-row="${j}" data-step="-1"`,true)}${button('↓','move-lesson',`data-index="${index}" data-row="${j}" data-step="1"`,true)}${button('刪除影片','remove-lesson',`data-index="${index}" data-row="${j}"`,true)}</div></div>`).join('')}${button('＋ 新增課程影片','lesson',`data-index="${index}"`,true)}</section>`).join('')||empty('尚無章節，按「新增章節」開始編輯。');
  }
  function renderMaterials() {
    document.getElementById('nspMaterialEditor').innerHTML=edit.materials.map((m,index)=>`<div class="nsp-edit-material"><span class="nsp-editor-number">#教材${index+1}</span>${field('教材分類',`<select data-material-category>${options(meta.terms.filter(t=>t.kind==='material'),m.category_id)}</select>`)}${field('教材標題',`<input data-material-title value="${esc(m.title)}">`)}${field('教材檔案連結',`<input data-material-url type="url" value="${esc(m.url)}" placeholder="https://…">`)}${field('備註',`<input data-material-note value="${esc(m.note)}">`)}<div>${button('↑','move-material',`data-index="${index}" data-step="-1"`,true)}${button('↓','move-material',`data-index="${index}" data-step="1"`,true)}${button('刪除教材','remove-material',`data-index="${index}"`,true)}</div></div>`).join('')||empty('尚無教材');
  }
  async function duration(index,rowIndex) {
    const row=document.querySelectorAll('.nsp-edit-section')[index].querySelectorAll('.nsp-edit-lesson')[rowIndex],url=row.querySelector('[data-lesson-url]').value,status=row.querySelector('.nsp-detect-status');
    if(!/^https?:\/\//.test(url)){status.textContent='請先填入影片網址';return;}
    status.textContent='正在讀取影片長度…';
    const live=()=>Array.from(document.querySelectorAll('.nsp-edit-lesson')).find(el=>el.dataset.lessonId===row.dataset.lessonId && el.querySelector('[data-lesson-url]').value===url);
    const done=value=>{const target=live();if(!target)return true;if(Number.isFinite(value)&&value>0){target.querySelector('[data-lesson-duration]').value=Math.round(value);target.querySelector('.nsp-detect-status').textContent='已偵測 '+minutes(value);return true;}return false;};
    const fail=()=>{const target=live();if(target)target.querySelector('.nsp-detect-status').textContent='無法讀取：請確認影片公開及嵌入權限，或填寫秒數。';};
    const id=youtubeId(url);
    if(id){let yt,tries=0,timer;const host=document.createElement('div');host.className='nsp-metadata-player';document.body.appendChild(host);const target=document.createElement('div');host.appendChild(target);try{const YT=await youtube();yt=new YT.Player(target,{videoId:id,events:{onReady:()=>{timer=setInterval(()=>{if(done(yt.getDuration())||++tries>=8){if(tries>=8)fail();clearInterval(timer);yt.destroy();host.remove();}},1000);},onError:()=>{clearInterval(timer);yt?.destroy();host.remove();fail();}}});}catch{host.remove();fail();}}
    else{const v=document.createElement('video');v.preload='metadata';v.src=url;const timeout=setTimeout(()=>{v.removeAttribute('src');fail();},15000);v.onloadedmetadata=()=>{clearTimeout(timeout);if(!done(v.duration))fail();v.removeAttribute('src');};v.onerror=()=>{clearTimeout(timeout);fail();};}
  }
  async function saveEditor(event) {
    event.preventDefault();const form=event.currentTarget,error=document.getElementById('nspEditorError'),submit=form.querySelector('button[type=submit]');let path,body;
    if(activeAdmin==='nsp_courses'){
      collectContent();const code=document.getElementById('nspHTMLCode');
      body={...edit,title:document.getElementById('nspTitleSelect').value==='__other'?document.getElementById('nspCustomTitle').value:document.getElementById('nspTitleSelect').value,category_id:Number(form.elements.category_id.value),cover_url:form.elements.cover_url.value.trim(),info_html:code.hidden?document.getElementById('nspRichEditor').innerHTML:code.value,instructor_ids:Array.from(form.querySelectorAll('[name=instructor_ids]:checked')).map(el=>Number(el.value)),status:form.elements.status.value};path='/admin/courses';
    }else{body=Object.fromEntries(new FormData(form));if(activeAdmin==='nsp_instructors'){path='/admin/instructors';}else path='/admin/terms/'+(activeAdmin==='nsp_categories'?'course':'material');}
    submit.disabled=true;error.textContent='儲存中…';
    try{await api(path+(edit.id?'/'+edit.id:''),edit.id?'PUT':'POST',body);dialog().close();dialog().classList.remove('nsp-course-dialog');showToast('儲存完成','success');admin(activeAdmin);}catch(e){error.textContent=e.message;}finally{submit.disabled=false;}
  }
  function sanitizeEditor(value){
    const parsed=new DOMParser().parseFromString(value,'text/html');
    parsed.querySelectorAll('script,style,iframe,object,svg,math').forEach(el=>el.remove());
    parsed.body.querySelectorAll('*').forEach(el=>{for(const attr of Array.from(el.attributes)){if(!(el.tagName==='A'&&attr.name==='href'&&/^https?:\/\//i.test(attr.value)))el.removeAttribute(attr.name);}});
    return parsed.body.innerHTML;
  }
  function move(array,index,step){const next=index+step;if(next>=0&&next<array.length)[array[index],array[next]]=[array[next],array[index]];}
  document.addEventListener('click',async event=>{
    const el=event.target.closest('[data-nsp]');if(!el)return;
    const action=el.dataset.nsp,id=el.dataset.id,type=el.dataset.type,index=Number(el.dataset.index),row=Number(el.dataset.row),step=Number(el.dataset.step);
    try{
      if(action==='login'){state.studentDestination='nsp';showLoginModal(true);}
      else if(action==='catalog')await load();
      else if(action==='makeup')await makeup(id);
      else if(action==='makeup-close')document.getElementById('nspMakeupDialog').close();
      else if(action==='preview')await preview(id);
      else if(action==='preview-close')document.getElementById('nspPreviewDialog').close();
      else if(action==='detail')await detail(id);
      else if(action==='play')await play(id,el.dataset.lesson);
      else if(action==='bookmark'){const saved=await api(`/courses/${id}/bookmark`,'PUT');course(id).bookmarked=saved.bookmarked;renderCards();}
      else if(action==='new'||action==='edit')await editItem(type,action==='edit'?id:null);
      else if(action==='close'){dialog().close();dialog().classList.remove('nsp-course-dialog');}
      else if(action==='delete'){if(confirm('確定刪除此項目？')){await api(`/admin/${type==='nsp_courses'?'courses':type==='nsp_instructors'?'instructors':'terms'}/${id}`,'DELETE');await admin(type);}}
      else if(action==='format'){document.getElementById('nspRichEditor').focus();document.execCommand(el.dataset.cmd,false,el.dataset.cmd==='formatBlock'?'h3':null);}
      else if(action==='link'){const url=prompt('請輸入 http 或 https 連結');if(url&&/^https?:\/\//i.test(url)){document.getElementById('nspRichEditor').focus();document.execCommand('createLink',false,url);}}
      else if(action==='html'){const visual=document.getElementById('nspRichEditor'),code=document.getElementById('nspHTMLCode');if(code.hidden){code.value=visual.innerHTML;visual.hidden=true;code.hidden=false;}else{visual.innerHTML=sanitizeEditor(code.value);code.hidden=true;visual.hidden=false;}}
      else if(action==='duration')await duration(index,row);
      else{
        collectContent();
        if(action==='section')edit.sections.push({title:'',lessons:[]});
        if(action==='lesson')edit.sections[index].lessons.push({id:uid(),title:'',url:'',duration:0});
        if(action==='material')edit.materials.push({category_id:'',title:'',url:'',note:''});
        if(action==='remove-section')edit.sections.splice(index,1);
        if(action==='remove-lesson')edit.sections[index].lessons.splice(row,1);
        if(action==='remove-material')edit.materials.splice(index,1);
        if(action==='move-section')move(edit.sections,index,step);
        if(action==='move-lesson')move(edit.sections[index].lessons,row,step);
        if(action==='move-material')move(edit.materials,index,step);
        if(action.includes('material'))renderMaterials();else renderSections();
      }
    }catch(error){showToast(error.message,'error');}
  });
  window.addEventListener('pagehide',()=>flush());
  function detect(element) {
    const section=element.closest('.nsp-edit-section'),row=element.closest('.nsp-edit-lesson');
    if(row.dataset.metadataUrl===element.value)return;
    row.dataset.metadataUrl=element.value;
    row.querySelector('[data-lesson-duration]').value=0;
    duration(Array.from(document.querySelectorAll('.nsp-edit-section')).indexOf(section),Array.from(section.querySelectorAll('.nsp-edit-lesson')).indexOf(row));
  }
  return {load,admin,stop,detect};
})();
