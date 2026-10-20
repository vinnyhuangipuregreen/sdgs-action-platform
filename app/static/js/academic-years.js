// Academic year selection belongs to the authenticated session, not individual forms.
const yearFetch = window.fetch.bind(window);
window.fetch = (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    const headers = new Headers(options.headers || (typeof input !== 'string' ? input.headers : undefined));
    headers.set('X-Academic-Year', localStorage.getItem('sdgs_academic_year_id') || '1');
    options = {...options, headers};
  }
  return yearFetch(input, options);
};
let academicYears = [];

async function loadAcademicYears() {
  const response = await fetch('/api/academic-years', {cache:'no-store'});
  if (!response.ok) throw new Error('學年度暫時無法載入');
  academicYears = await response.json();
  for (const id of ['loginAcademicYear', 'adminAcademicYear']) {
    const select = document.getElementById(id);
    if (!select) continue;
    select.replaceChildren(...academicYears.map(year => new Option(String(year.year), year.id)));
    select.value = localStorage.getItem('sdgs_academic_year_id') || '1';
    const requestedYear = new URLSearchParams(location.search).get('academic_year_id');
    if (id==='loginAcademicYear' && requestedYear && academicYears.some(year=>String(year.id)===requestedYear)) select.value=requestedYear;
    if (!select.value && academicYears.length) select.value = academicYears[0].id;
    select.disabled = false;
  }
  if (typeof state !== 'undefined' && state.user?.academic_year) {
    const updated=academicYears.find(year=>year.id===state.user.academic_year.id);
    if(updated) {state.user.academic_year=updated;updateAcademicYearUI(state.user);}
  }
}

function updateAcademicYearUI(user) {
  const year = user?.academic_year;
  const badge = document.getElementById('academicYearBadge');
  if (badge) {
    badge.hidden = !year;
    badge.style.whiteSpace='pre-line';
    if (year) badge.textContent = `學年度：${year.year}\n${year.start_month}–${year.end_month}`;
  }
  if (!year) return;
  localStorage.setItem('sdgs_academic_year_id', year.id);
  document.getElementById('adminAcademicYear').value = year.id;
  for (const link of document.querySelectorAll('a[href^="https://sdgs-matching-game.vercel.app"],a[data-module="attendance"],a[href^="/tools/laba"]')) {
    const url = new URL(link.href);
    url.searchParams.set('academic_year_id', year.id);
    link.href = url.href;
  }
}

async function yearRequest(path, method='GET', body) {
  const response = await fetch('/api/' + path, {method, headers:{Authorization:`Bearer ${state.token}`,'Content-Type':'application/json'},body:body ? JSON.stringify(body) : undefined});
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : '學年度資料有誤，請檢查各欄位。');
  return result;
}

async function switchAcademicYear(yearId) {
  try {
    const result = await yearRequest(`auth/academic-year/${yearId}`, 'POST');
    localStorage.setItem('sdgs_token', result.token);
    localStorage.setItem('sdgs_academic_year_id', yearId);
    location.reload();
  } catch (error) { alert(error.message); updateAcademicYearUI(state.user); }
}

async function openAcademicYearManager() {
  let dialog = document.getElementById('academicYearManager');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'academicYearManager';
    dialog.style.cssText = 'width:min(850px,calc(100% - 32px));max-height:90dvh;overflow:auto;border:1px solid #dce5e7;border-radius:16px;padding:24px;color:#12332f';
    dialog.innerHTML = `<div class="flex justify-between items-center mb-4"><h3 class="text-xl font-bold">學年度管理</h3><button type="button" id="closeAcademicYears" aria-label="關閉學年度管理">✕</button></div>
      <form id="academicYearSearch" class="flex gap-2 mb-4"><label>查詢學年度 <input id="academicYearQuery" type="search" class="border rounded-lg px-3 py-2"></label><button class="px-4 py-2 border rounded-lg">查詢</button></form>
      <div class="overflow-x-auto mb-5"><table class="w-full text-left"><thead><tr><th>編號</th><th>學年度</th><th>期間</th><th>狀態</th><th>操作</th></tr></thead><tbody id="academicYearRows"></tbody></table></div>
      <form id="academicYearForm" class="space-y-4"><h4 id="academicYearFormTitle" class="font-bold">新增學年度</h4>
      <div><label for="academicYearValue">學年度<span class="required-marker" aria-hidden="true"> *</span></label><select required id="academicYearValue" class="border rounded-lg px-3 py-2"></select></div>
      <div class="flex flex-wrap gap-3"><label>期間開始<span class="required-marker" aria-hidden="true"> *</span><select required id="academicStartYear" class="border rounded-lg px-2 py-2"></select><select required id="academicStartMonth" class="border rounded-lg px-2 py-2"></select></label>
      <label>期間結束<span class="required-marker" aria-hidden="true"> *</span><select required id="academicEndYear" class="border rounded-lg px-2 py-2"></select><select required id="academicEndMonth" class="border rounded-lg px-2 py-2"></select></label></div>
      <label class="block">複製教材來源 <select id="academicSourceYear" class="border rounded-lg px-3 py-2"></select></label>
      <p class="text-sm text-slate-500">只複製教材、活動分類與設定；練習單、成績、課程及報名名冊從空白開始。已有教材或紀錄的學年度不可刪除。</p>
      <p id="academicYearError" role="alert" class="text-red-600 whitespace-pre-wrap"></p>
      <div class="flex gap-3"><button id="saveAcademicYear" class="bg-emerald-700 text-white rounded-lg px-4 py-2">儲存</button><button type="button" id="newAcademicYear" class="border rounded-lg px-4 py-2">新增學年度</button></div></form>`;
    document.body.appendChild(dialog);
    document.getElementById('closeAcademicYears').onclick = () => dialog.close();
    for (const id of ['academicYearValue','academicStartYear','academicEndYear']) {
      const select = document.getElementById(id);
      for (let year=2026; year <= (id==='academicYearValue' ? 2050 : 2051); year++) select.add(new Option(year,year));
    }
    for (const id of ['academicStartMonth','academicEndMonth']) for (let month=1;month<=12;month++) document.getElementById(id).add(new Option(String(month).padStart(2,'0'),String(month).padStart(2,'0')));
    document.getElementById('academicYearValue').onchange = () => {
      const year = Number(document.getElementById('academicYearValue').value);
      setYearPeriod(`${year}09`, `${year+1}06`);
    };
    document.getElementById('academicYearSearch').onsubmit = event => {event.preventDefault(); renderAcademicYears();};
    document.getElementById('newAcademicYear').onclick = () => editAcademicYear(null);
    document.getElementById('academicYearForm').onsubmit = async event => {
      event.preventDefault();
      const button=document.getElementById('saveAcademicYear'); button.disabled=true;
      const item={year:Number(document.getElementById('academicYearValue').value),start_month:document.getElementById('academicStartYear').value+document.getElementById('academicStartMonth').value,end_month:document.getElementById('academicEndYear').value+document.getElementById('academicEndMonth').value,source_id:Number(document.getElementById('academicSourceYear').value)};
      try {
        if (item.start_month > item.end_month) throw new Error('期間結束月份不可早於開始月份');
        const id=event.currentTarget.dataset.yearId;
        await yearRequest('admin/academic-years'+(id ? '/'+id : ''),id ? 'PUT':'POST',item);
        await loadAcademicYears(); await renderAcademicYears(); editAcademicYear(null);
      } catch(error) {document.getElementById('academicYearError').textContent=error.message;await renderAcademicYears();}
      finally {button.disabled=false;}
    };
  }
  document.getElementById('academicSourceYear').replaceChildren(...academicYears.map(year=>new Option(String(year.year),year.id)));
  document.getElementById('academicSourceYear').value=state.user.academic_year.id;
  editAcademicYear(null); await renderAcademicYears(); dialog.showModal();
}

function setYearPeriod(start,end) {
  document.getElementById('academicStartYear').value=start.slice(0,4); document.getElementById('academicStartMonth').value=start.slice(4);
  document.getElementById('academicEndYear').value=end.slice(0,4); document.getElementById('academicEndMonth').value=end.slice(4);
}
function editAcademicYear(year) {
  document.getElementById('academicYearForm').dataset.yearId=year?.id || '';
  document.getElementById('academicYearFormTitle').textContent=year ? `修改學年度（編號 ${year.id}）`:'新增學年度（編號自動產生）';
  document.getElementById('academicYearValue').value=year?.year || Math.min(2050,Math.max(...academicYears.map(item=>item.year))+1);
  const value=Number(document.getElementById('academicYearValue').value);
  setYearPeriod(year?.start_month || `${value}09`,year?.end_month || `${value+1}06`);
  document.getElementById('academicSourceYear').disabled=!!year;
  if (!year) {
    const previous=academicYears.filter(item=>item.year<value).sort((a,b)=>b.year-a.year)[0];
    if(previous) document.getElementById('academicSourceYear').value=previous.id;
  }
  document.getElementById('academicYearError').textContent='';
}
async function renderAcademicYears() {
  try {
    const years=await yearRequest('admin/academic-years?search='+encodeURIComponent(document.getElementById('academicYearQuery').value));
    const body=document.getElementById('academicYearRows');body.replaceChildren();
    for (const year of years) {
      const row=document.createElement('tr');
      for (const text of [year.id,year.year,`${year.start_month}–${year.end_month}`,year.status==='active'?'可使用':'初始化未完成']) {const cell=document.createElement('td');cell.textContent=text;cell.className='py-3 pr-3';row.appendChild(cell);}
      const cell=document.createElement('td');
      for (const label of (year.status==='active' ? ['修改','刪除'] : ['重試初始化'])) {
        const button=document.createElement('button');button.type='button';button.textContent=label;button.className='border rounded-lg px-3 py-2 mr-2';
        button.onclick=async()=>{
          if(label==='修改') return editAcademicYear(year);
          if(label==='刪除' && !confirm(`確定刪除 ${year.year} 學年度？`)) return;
          button.disabled=true;
          try {
            if(label==='重試初始化') await yearRequest('admin/academic-years','POST',{year:year.year,start_month:year.start_month,end_month:year.end_month,source_id:year.source_id});
            else await yearRequest(`admin/academic-years/${year.id}`,'DELETE');
            await loadAcademicYears();await renderAcademicYears();
          }catch(error){alert(error.message);button.disabled=false;}
        };
        cell.appendChild(button);
      }
      row.appendChild(cell);body.appendChild(row);
    }
  } catch(error) {document.getElementById('academicYearError').textContent=error.message;}
}

window.addEventListener('storage', event => {if(event.key==='sdgs_academic_year_id' && event.newValue!==event.oldValue) location.reload();});
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('adminAcademicYear').onchange=event=>switchAcademicYear(event.target.value);
  document.getElementById('manageAcademicYears').onclick=openAcademicYearManager;
  loadAcademicYears().catch(error=>{document.getElementById('loginError').textContent=error.message;document.getElementById('loginError').classList.remove('hidden');});
});
