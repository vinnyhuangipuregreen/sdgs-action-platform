// Only public year metadata crosses origins. Authentication remains in the platform.
const platformYearOrigin = 'https://sdgs-action-platform.vercel.app';
let publicYearId = Number(new URLSearchParams(location.search).get('academic_year_id') || 1);
const moduleYearFetch = window.fetch.bind(window);
window.fetch = (input, options={}) => {
  const url=new URL(typeof input==='string' ? input : input.url,location.href);
  if(url.origin===location.origin && url.pathname.startsWith('/api/')) {
    const headers=new Headers(options.headers || {});headers.set('X-Academic-Year',String(publicYearId));options={...options,headers};
  }
  return moduleYearFetch(input,options);
};
document.addEventListener('DOMContentLoaded',async()=>{
  try {
    const response=await moduleYearFetch(platformYearOrigin+'/api/academic-years',{cache:'no-store'});
    if(!response.ok) return;
    const year=(await response.json()).find(item=>item.id===publicYearId);
    if(!year) return;
    const badge=document.createElement('span');badge.textContent=`學年度：${year.year}\n${year.start_month}–${year.end_month}`;
    badge.style.cssText='font-size:14px;font-weight:700;color:#12823d;line-height:1.5;white-space:pre-line;flex-shrink:0';
    document.querySelector('.platform-header-inner').insertBefore(badge,document.querySelector('.platform-account'));
    for(const link of document.querySelectorAll('.platform-nav a')) {const url=new URL(link.href);url.searchParams.set('academic_year_id',year.id);link.href=url.href;}
  }catch{}
});
window.addEventListener('message',event=>{
  const frame=document.querySelector('.ui-account-frame');
  if(event.origin!==platformYearOrigin || event.source!==frame?.contentWindow || event.data?.type!=='platform-academic-year') return;
  const year=event.data.academic_year;
  if(!Number.isInteger(year?.id) || year.id===publicYearId) return;
  const url=new URL(location.href);url.searchParams.set('academic_year_id',year.id);location.replace(url.href);
});
