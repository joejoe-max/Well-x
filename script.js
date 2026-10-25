'use strict';
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];

/* ---------- Loading sequence (deterministic; CSS also force-hides it after 4.5 s) ---------- */
(()=>{
  const m=['INITIALIZING SYSTEM','LOADING WELL DATA','PREPARING ANALYSIS ENVIRONMENT','SYSTEM READY'],L=$('#loader');let i=0;
  const done=()=>{L.classList.add('off');setTimeout(()=>L.remove(),600)};
  const step=()=>{$('#ldMsg').textContent=m[i];$('#ldBar').style.width=(i+1)*25+'%';++i<m.length?setTimeout(step,600):setTimeout(done,500)};
  step();setTimeout(done,4000);
})();

/* ---------- Central mock dataset (fictional). Water cut = water / (oil + water) ---------- */
const DAYS=180,END=Date.UTC(2026,9,24),iso=t=>new Date(t).toISOString().slice(0,10);
const WELLS=[
{id:'WX-001',field:'Field Alpha',type:'Vertical producer',status:'Producing',q:[540,520],w:[16,18],p:[2400,2330],test:'2026-09-18',interv:'Pump change, 2025-11'},
{id:'WX-002',field:'Field Alpha',type:'Deviated producer',status:'Underperforming',q:[300,210],w:[41,64],p:null,test:null,interv:null},
{id:'WX-003',field:'Field Beta',type:'Vertical producer',status:'Shut-in',q:[300,300],w:[34,38],p:null,test:null,interv:null,shut:150},
{id:'WX-004',field:'Field Beta',type:'Deviated producer',status:'Producing',q:[430,440],w:[21,22],p:[2550,2500],test:'2026-10-02',interv:'Choke change, 2026-03'},
{id:'WX-005',field:'Field Gamma',type:'Vertical producer',status:'Underperforming',q:[235,165],w:[45,71],p:null,test:'2026-06-12',interv:null},
{id:'WX-006',field:'Field Gamma',type:'Vertical producer',status:'Producing',q:[375,380],w:[26,28],p:[2300,2280],test:'2026-09-25',interv:null},
{id:'WX-007',field:'Field Delta',type:'Deviated producer',status:'Shut-in',q:[350,350],w:[30,33],p:null,test:'2026-04-20',interv:null,shut:100},
{id:'WX-008',field:'Field Delta',type:'Horizontal producer',status:'Producing',q:[455,460],w:[18,19],p:[2650,2610],test:'2026-10-09',interv:'Pump change, 2026-01'}];
WELLS.forEach(w=>{
  w.hist=[];
  for(let i=0;i<DAYS;i++){
    const t=i/(DAYS-1);
    let oil=w.q[0]+(w.q[1]-w.q[0])*t+w.q[0]*.012*Math.sin(i*1.7+w.id.charCodeAt(5));
    const c=w.w[0]+(w.w[1]-w.w[0])*t+.5*Math.sin(i*.9);
    let water=oil*c/(100-c),off=w.shut!=null&&i>=w.shut;
    if(off)oil=water=0;
    oil=Math.round(oil);water=Math.round(water);
    w.hist.push({d:iso(END-(DAYS-1-i)*864e5),oil,water,wc:oil+water?+(water/(oil+water)*100).toFixed(1):null,p:w.p&&!off?Math.round(w.p[0]+(w.p[1]-w.p[0])*t):null});
  }
  w.cur=w.hist[DAYS-1];w.updated=w.cur.d;
});
const S={well:'WX-002',sort:{k:'id',d:1},sv:null};
const byId=id=>WELLS.find(w=>w.id===id),cur=()=>byId(S.well);
const cls={Producing:'ok',Underperforming:'wn','Shut-in':'cr'};
const badge=s=>`<span class="st ${cls[s]}">${s}</span>`;
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const wcOf=w=>w.cur.wc==null?null:Math.round(w.cur.wc);
const li=a=>a.length?`<ul>${a.map(x=>`<li>${x}</li>`).join('')}</ul>`:'<p class="mu">None</p>';
const setWell=id=>{if(S.well!==id){S.well=id;$('#result').innerHTML=''}$('#wsel').value=$('#iw').value=S.well};

/* ---------- Analysis helpers (everything derived from the records) ---------- */
function trend(h){
  const o=h.map(x=>x.oil),a=avg(o.slice(0,7)),b=avg(o.slice(-7)),wc=h.filter(x=>x.wc!=null),k=h.findIndex((x,i)=>i>0&&x.oil===0&&h[i-1].oil>0);
  return{a,b,chg:a?(b-a)/a*100:0,wc0:wc.length?wc[0].wc:null,wc1:wc.length?wc[wc.length-1].wc:null,stop:k>0?h[k].d:null,idle:o[0]===0&&b===0,noP:h.every(x=>x.p==null)};
}
function observations(w,n){
  const t=trend(w.hist.slice(-n)),o=[];
  if(t.idle)o.push('Well was shut-in throughout the selected period; no production recorded.');
  else{
    if(t.stop)o.push(`Production stopped on ${t.stop}; no production recorded afterward.`);
    else if(t.chg<=-5)o.push(`Oil production declined ${Math.round(-t.chg)}% over the selected period (${Math.round(t.a)} to ${Math.round(t.b)} bbl/d, 7-day averages).`);
    else if(t.chg>=5)o.push(`Oil production increased ${Math.round(t.chg)}% over the selected period.`);
    else o.push('Production remained relatively stable over the selected period.');
    if(t.wc0!=null&&t.wc1-t.wc0>=5)o.push(`Water cut increased from ${Math.round(t.wc0)}% to ${Math.round(t.wc1)}%.`);
    else if(t.wc0!=null)o.push('Water cut remained broadly stable.');
  }
  if(t.noP)o.push('Pressure measurements are unavailable.');
  return o;
}
function diagnose(w){
  const t=trend(w.hist),r={wellId:w.id,field:w.field,date:iso(Date.now()),abn:[],causes:[],missing:[]};
  const shut=t.stop||t.idle,dec=-t.chg,wcUp=t.wc0!=null&&t.wc1-t.wc0>=15;
  const dl=`Oil rate fell from ${Math.round(t.a)} to ${Math.round(t.b)} bbl/d over the 180-day record (−${Math.round(dec)}%).`;
  r.assessment=w.hist.length<30?'Insufficient data':shut?'Shut-in':dec>=40?'Severe production decline':dec>=20?'Underperforming':'Normal';
  if(shut){r.abn.push('Production interruption'+(t.stop?` (stopped ${t.stop})`:''));
    r.causes.push({n:'Possible surface-facility constraint',ev:[t.stop?`Oil rate is 0 bbl/d from ${t.stop}.`:'Oil rate is 0 bbl/d for the whole record.','The reason for shut-in is not recorded.']})}
  else if(dec>=20){r.abn.push(`Production decline (${Math.round(t.a)} → ${Math.round(t.b)} bbl/d)`);
    r.causes.push({n:'Potential reservoir-related constraint',ev:[dl,t.noP?'Pressure readings are unavailable, so pressure support cannot be assessed.':'Pressure readings are available for review.']},
      {n:'Possible wellbore restriction',ev:[dl,w.test?`Last well test: ${w.test}.`:'No well-test result is available to confirm.']},
      {n:'Possible artificial-lift issue',ev:[dl,'Artificial-lift operating data is unavailable.']})}
  if(wcUp){r.abn.push(`Increasing water cut (${Math.round(t.wc0)}% → ${Math.round(t.wc1)}%)`);
    r.causes.push({n:'Possible water-production problem',ev:[`Water cut rose ${Math.round(t.wc1-t.wc0)} percentage points over the record.`]})}
  if(!r.abn.length)r.abn.push('No abnormalities detected in the production record.');
  if(!w.p)r.missing.push('Pressure readings unavailable');
  if(!w.test)r.missing.push('Recent well-test results unavailable');
  else if((END-Date.parse(w.test))/864e5>90)r.missing.push(`Last well test is older than 90 days (${w.test})`);
  r.missing.push('Artificial-lift operating data unavailable');
  if(!w.interv)r.missing.push('Intervention history unavailable');
  return r;
}
const resultHTML=r=>`<section class="panel res"><div class="rh"><h2>Diagnostic result</h2><span class="tag">SIMULATED</span></div>
<p><b>${r.wellId}</b> · ${r.field} · Analysed ${r.date}</p>
<h3>Performance assessment</h3><p class="assess">${r.assessment}</p>
<h3>Detected abnormalities</h3>${li(r.abn)}
<h3>Possible causes (not confirmed) and supporting evidence</h3>${r.causes.length?r.causes.map(c=>`<div class="cause"><b>${c.n}</b>${li(c.ev)}</div>`).join(''):'<p class="mu">No possible causes identified from the available records.</p>'}
<h3>Missing information</h3>${li(r.missing)}
<p class="lim">Simulated findings for demonstration only. Possible causes are not confirmed diagnoses. Real-world conclusions require adequate field data and engineering review.</p></section>`;

/* ---------- SVG charts ---------- */
const CS={};let cid=0;
function chart(title,unit,v,d,color){
  const W=600,H=180,L=46,R=10,T=10,B=24,n=v.length,m=Math.max(1,...v.filter(x=>x!=null))*1.1,id=++cid;
  const X=i=>L+(W-L-R)*i/(n-1),Y=x=>T+(H-T-B)*(1-x/m);let g='',p='',pen=false;
  for(let k=0;k<=4;k++){const y=Y(m*k/4);g+=`<line class="gl" x1="${L}" x2="${W-R}" y1="${y}" y2="${y}"/><text x="${L-6}" y="${y+3}" text-anchor="end">${Math.round(m*k/4)}</text>`}
  v.forEach((x,i)=>{if(x==null){pen=false;return}p+=(pen?'L':'M')+X(i).toFixed(1)+' '+Y(x).toFixed(1);pen=true});
  [0,n>>1,n-1].forEach(i=>g+=`<text x="${X(i)}" y="${H-6}" text-anchor="${i?i===n-1?'end':'middle':'start'}">${d[i].slice(5)}</text>`);
  const s=v.findIndex((x,i)=>i>0&&x===0&&v[i-1]>0),mk=title.startsWith('Oil')&&s>0?`<line x1="${X(s)}" x2="${X(s)}" y1="${T}" y2="${H-B}" stroke="#C45B55" stroke-dasharray="3 3"/><text x="${X(s)+4}" y="${T+10}" fill="#C45B55">SHUT-IN</text>`:'';
  CS[id]={v,d,unit};
  return`<figure class="ch"><figcaption><b>${title}</b><small>${unit}</small><output class="ro">Hover or touch to inspect</output></figcaption><svg viewBox="0 0 ${W} ${H}" data-id="${id}" role="img" aria-label="${title} (${unit}) over ${n} days">${g}${mk}<path d="${p}" fill="none" stroke="${color}" stroke-width="1.6"/><line class="cur" y1="${T}" y2="${H-B}" x1="0" x2="0" style="display:none"/></svg></figure>`;
}
document.addEventListener('pointermove',e=>{
  const s=e.target.closest&&e.target.closest('svg[data-id]');if(!s)return;
  const c=CS[s.dataset.id],r=s.getBoundingClientRect(),n=c.v.length,f=(e.clientX-r.left)/r.width*600,i=Math.max(0,Math.min(n-1,Math.round((f-46)/544*(n-1)))),x=46+544*i/(n-1),l=$('.cur',s);
  l.style.display='';l.setAttribute('x1',x);l.setAttribute('x2',x);
  $('output',s.parentNode).textContent=`${c.d[i]}: ${c.v[i]==null?'Not available':c.v[i]+' '+c.unit}`;
});
function charts(w,n){
  const h=w.hist.slice(-n),d=h.map(x=>x.d);
  return chart('Oil Production','bbl/d',h.map(x=>x.oil),d,'#FFFFFF')+chart('Water Production','bbl/d',h.map(x=>x.water),d,'#E7A33E')+chart('Water Cut','%',h.map(x=>x.wc),d,'#8FA3B8')+
    (h.some(x=>x.p!=null)?chart('Pressure','psi',h.map(x=>x.p),d,'#9CA3AF'):'<div class="ch na"><b>Pressure</b>PRESSURE DATA UNAVAILABLE</div>');
}

/* ---------- Pages ---------- */
const PAGES=[['overview','Overview','M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],['analysis','Well Analysis','M12 2v14M8 16l4 5 4-5M5 8h14'],['surveillance','Production Surveillance','M3 12h4l3-8 4 16 3-8h4'],['intervention','Intervention Assessment','M4 20l9-9M13 5l6 6-3 3-6-6z'],['reports','Reports','M6 3h9l4 4v14H6zM9 12h7M9 16h7']];
$('#nav').innerHTML=PAGES.map(([id,l,d])=>`<a href="#${id}" data-p="${id}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="${d}"/></svg>${l}</a>`).join('');
const statusOpts='<option value="">All statuses</option><option>Producing</option><option>Underperforming</option><option>Shut-in</option>';
$('#stf').innerHTML=$('#svst').innerHTML=statusOpts;
$('#wsel').innerHTML=$('#iw').innerHTML=WELLS.map(w=>`<option>${w.id}</option>`).join('');
$('#today').textContent=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
const closeNav=()=>{$('#side').classList.remove('open');$('#menuBtn').setAttribute('aria-expanded','false')};
$('#menuBtn').onclick=()=>{const o=$('#side').classList.toggle('open');$('#menuBtn').setAttribute('aria-expanded',o)};
addEventListener('keydown',e=>{if(e.key==='Escape')closeNav()});

const COLS=[['id','Well ID'],['field','Field','hs'],['status','Status'],['oil','Oil Rate'],['wc','Water Cut'],['upd','Last Updated','hs'],[null,'Action']];
const val=(w,k)=>({id:w.id,field:w.field,status:w.status,oil:w.cur.oil,wc:wcOf(w)??-1,upd:w.updated})[k];
function renderOverview(){
  const n=s=>WELLS.filter(w=>w.status===s).length;
  $('#kpis').innerHTML=[['Total Wells',WELLS.length],['Producing Wells',n('Producing')],['Underperforming Wells',n('Underperforming')],['Shut-in Wells',n('Shut-in')]].map(([a,b])=>`<div class="kpi"><span>${a}</span><b>${b}</b></div>`).join('');
  const q=$('#q').value.trim().toLowerCase(),f=$('#stf').value,{k,d}=S.sort;
  const rows=WELLS.filter(w=>(!f||w.status===f)&&(w.id+' '+w.field).toLowerCase().includes(q)).sort((a,b)=>{const x=val(a,k),y=val(b,k);return(x>y?1:x<y?-1:0)*d});
  $('#inv thead').innerHTML='<tr>'+COLS.map(([c,l,h])=>`<th class="${h||''}"${c?` aria-sort="${S.sort.k===c?(d>0?'ascending':'descending'):'none'}"`:''}>${c?`<button data-k="${c}">${l}</button>`:l}</th>`).join('')+'</tr>';
  $('#inv tbody').innerHTML=rows.map(w=>`<tr><td><b>${w.id}</b></td><td class="hs">${w.field}</td><td>${badge(w.status)}</td><td>${w.cur.oil} bbl/d</td><td>${wcOf(w)==null?'Not available':wcOf(w)+'%'}</td><td class="hs">${w.updated}</td><td><button class="btn s" data-open="${w.id}" aria-label="Open analysis for ${w.id}">Analyse</button></td></tr>`).join('')||'<tr><td colspan="7" class="mu">No wells match the current filters.</td></tr>';
}
function info(w){
  const c=w.cur,rows=[['Well ID',w.id],['Field',w.field],['Well type',w.type],['Status',badge(w.status)],['Oil rate',c.oil+' bbl/d'],['Water rate',c.water+' bbl/d'],['Water cut',wcOf(w)==null?'Not available':wcOf(w)+'%'],['Pressure',c.p==null?'Not available':c.p+' psi'],['Last well test',w.test||'Not available'],['Last updated',w.updated]];
  return`<dl class="info">${rows.map(([a,b])=>`<div><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>`;
}
function renderAnalysis(){
  const w=cur(),n=+$('#per').value;
  $('#wsel').value=w.id;
  $('#ahead').innerHTML=`${w.id} · ${w.field} · ${badge(w.status)} · Reporting period: last ${n} days`;
  $('#winfo').innerHTML=info(w);
  $('#charts').innerHTML=charts(w,n);
  $('#obs').innerHTML=observations(w,n).map(x=>`<li>${x}</li>`).join('');
}
function renderSV(){
  const f=$('#svst').value,ws=WELLS.filter(w=>!f||w.status===f);
  if(!ws.some(w=>w.id===S.sv))S.sv=ws.length?ws[0].id:null;
  const dot=(v,l)=>`<span class="dt ${v?'ok':'na'}">${l}: ${v?'Yes':'No'}</span>`;
  $('#sv').innerHTML='<thead><tr><th>Well</th><th>Status</th><th>Oil now</th><th class="hs">30-day avg</th><th class="hs">Prior 30-day avg</th><th>Change</th><th class="hs">Water-cut change</th><th>Data availability</th></tr></thead><tbody>'+
    (ws.map(w=>{
      const a=avg(w.hist.slice(-30).map(x=>x.oil)),b=avg(w.hist.slice(-60,-30).map(x=>x.oil)),t=trend(w.hist.slice(-30)),dw=t.wc0==null?'Not available':(t.wc1-t.wc0>=0?'+':'')+(t.wc1-t.wc0).toFixed(1)+' pts';
      return`<tr class="${w.id===S.sv?'sel':''}"><td><button class="lnk" data-sv="${w.id}">${w.id}</button></td><td>${badge(w.status)}</td><td>${w.cur.oil} bbl/d</td><td class="hs">${a.toFixed(0)}</td><td class="hs">${b.toFixed(0)}</td><td>${b?((a-b)/b*100>0?'+':'')+((a-b)/b*100).toFixed(0)+'%':'n/a'}</td><td class="hs">${dw}</td><td>${dot(w.p,'Pressure')} ${dot(w.test,'Well test')}</td></tr>`}).join('')||'<tr><td colspan="8" class="mu">No wells match this status.</td></tr>')+'</tbody>';
  const w=S.sv&&byId(S.sv);
  $('#svd').innerHTML=w?`<h2 style="margin:14px 0 8px">${w.id} · ${w.field} — last 90 days</h2><div class="grid2">${charts(w,90)}</div><div class="panel" style="margin-top:12px"><h2>Detected production changes</h2>${li(observations(w,90))}</div>`:'';
}
const SC=[['Artificial-lift optimisation',40000,35,50,'Lift equipment is the limiting factor.','Lift operating data is unavailable.'],
['Wellbore cleanout',120000,60,100,'A removable restriction exists.','The restriction is not confirmed.'],
['Stimulation',250000,90,150,'The formation responds to treatment.','Response varies widely.'],
['Workover',600000,150,300,'A mechanical cause can be repaired.','Highest cost and risk.'],
['No intervention / further investigation',15000,0,0,'Cost covers well test and data review only.','Does not change production by itself.']];
$('#iv').innerHTML='<thead><tr><th>Scenario</th><th>Intervention cost (USD)</th><th>Incremental oil (bbl/d)</th><th>Added daily operating cost (USD/d)</th><th>Additional daily revenue (gross)</th><th>Net daily benefit</th><th>Simple payback</th></tr></thead><tbody>'+
  SC.map(s=>`<tr><td><b>${s[0]}</b><small>Assumes: ${s[4]}<br>Uncertainty: ${s[5]}</small></td>${[1,2,3].map(i=>`<td><input type="number" min="0" step="any" value="${s[i]}" aria-label="${s[0]}: ${['','intervention cost','incremental oil','additional operating cost'][i]}"></td>`).join('')}<td data-o></td><td data-o></td><td data-o></td></tr>`).join('')+'</tbody>';
const money=x=>'$'+Math.round(x).toLocaleString('en-US');
function calc(){
  const pr=parseFloat($('#price').value);
  $$('#iv tbody tr').forEach(tr=>{
    const [c,q,o]=$$('input',tr).map(i=>parseFloat(i.value)),u=$$('[data-o]',tr),ok=[pr,c,q,o].every(x=>Number.isFinite(x)&&x>=0);
    if(!ok){u[0].textContent=u[1].textContent='—';u[2].textContent='INSUFFICIENT DATA';return}
    const rev=q*pr,net=rev-o;
    u[0].textContent=money(rev)+'/d';u[1].textContent=(net<0?'−':'')+money(Math.abs(net))+'/d';
    u[2].textContent=net>0?Math.ceil(c/net)+' days':'NO POSITIVE PAYBACK UNDER CURRENT ASSUMPTIONS';
  });
}
function renderIV(){const w=cur();$('#iw').value=w.id;$('#ivb').innerHTML=`${w.id} · ${w.field} · ${badge(w.status)} · Current oil rate ${w.cur.oil} bbl/d. Scenario inputs are fictional baselines, not well-specific estimates.`;calc()}

/* ---------- Reports (localStorage) ---------- */
const RK='wellx.reports';
const loadR=()=>{try{return JSON.parse(localStorage.getItem(RK))||[]}catch(e){return[]}};
const saveR=a=>{try{localStorage.setItem(RK,JSON.stringify(a));return true}catch(e){return false}};
function renderReports(){
  const a=loadR();
  $('#rep').innerHTML=a.length?`<div class="tw"><table><thead><tr><th>Well ID</th><th class="hs">Field</th><th>Analysis date</th><th>Assessment</th><th class="hs">Status</th><th>Actions</th></tr></thead><tbody>${a.map(r=>`<tr><td><b>${r.wellId}</b></td><td class="hs">${r.field}</td><td>${r.date}</td><td>${r.assessment}</td><td class="hs">Simulated</td><td><button class="btn s" data-view="${r.id}">View Report</button> <button class="btn s" data-del="${r.id}" aria-label="Delete report for ${r.wellId}">Delete</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><b>NO REPORTS GENERATED</b><p>Run a well analysis to create your first report.</p></div>';
}
let lastR=null;
function runAnalysis(){
  const st=['VALIDATING WELL DATA','ANALYSING PRODUCTION HISTORY','CHECKING PERFORMANCE INDICATORS','PREPARING DIAGNOSTIC REPORT'],box=$('#result'),btn=$('#analyse'),w=cur();let i=0;
  btn.disabled=true;
  const step=()=>{
    if(i<st.length){box.innerHTML=`<div class="panel prog"><b>${st[i]}</b><div class="ld-bar"><i style="width:${(i+1)*25}%"></i></div></div>`;i++;setTimeout(step,500);return}
    try{lastR=diagnose(w);box.innerHTML=resultHTML(lastR)+'<div class="bar" style="margin-top:12px"><button class="btn" data-save>Save report</button><span class="msg" id="smsg"></span></div>'}
    catch(e){box.innerHTML='<div class="panel msg err">Analysis failed. Try again.</div>'}
    btn.disabled=false;
  };
  step();
}

/* ---------- Router ---------- */
function show(){
  const h=location.hash.slice(1),id=PAGES.some(p=>p[0]===h)?h:'overview',P=PAGES.find(p=>p[0]===id);
  $$('.page').forEach(s=>s.hidden=s.id!=='p-'+id);
  $$('#nav a').forEach(a=>a.dataset.p===id?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current'));
  $('#title').textContent=P[1];$('#crumb').textContent='WELL - X / '+P[1];closeNav();
  ({overview:renderOverview,analysis:renderAnalysis,surveillance:renderSV,intervention:renderIV,reports:renderReports})[id]();
  scrollTo(0,0);
}
addEventListener('hashchange',show);

document.addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;const d=t.dataset;
  if(d.k){S.sort={k:d.k,d:S.sort.k===d.k?-S.sort.d:1};renderOverview()}
  else if(d.open){setWell(d.open);location.hash='analysis'}
  else if(d.sv){S.sv=d.sv;renderSV()}
  else if(d.save!==undefined){
    if(!lastR)return;const a=loadR();a.unshift({...lastR,id:Date.now()});
    const m=$('#smsg');m.className=saveR(a)?'msg':'msg err';m.textContent=m.className==='msg'?'Report saved. Open the Reports page to view it.':'Report could not be saved (browser storage unavailable).';
  }
  else if(d.view){const r=loadR().find(x=>String(x.id)===d.view);if(r){$('#rview').innerHTML=`<article class="doc"><h2>WELL - X — Simulated diagnostic report</h2>${resultHTML(r)}</article><div class="bar noprint" style="margin-top:12px"><button class="btn" data-print>Print report</button><button class="btn s" data-reopen="${r.wellId}">Reopen well analysis</button><button class="btn s" data-close>Close</button></div>`;$('#rview').scrollIntoView({behavior:'smooth'})}}
  else if(d.del){saveR(loadR().filter(x=>String(x.id)!==d.del));$('#rview').innerHTML='';renderReports()}
  else if(d.print!==undefined)print();
  else if(d.reopen){setWell(d.reopen);location.hash='analysis'}
  else if(d.close!==undefined)$('#rview').innerHTML='';
  else if(d.act)view3d(d.act);
});
$('#q').oninput=$('#stf').onchange=renderOverview;
$('#svst').onchange=renderSV;
$('#per').onchange=renderAnalysis;
$('#wsel').onchange=e=>{setWell(e.target.value);renderAnalysis()};
$('#iw').onchange=e=>{setWell(e.target.value);renderIV()};
$('#price').oninput=$('#iv').oninput=calc;
$('#analyse').onclick=runAnalysis;

/* ---------- Projected 3D well model (canvas, no libraries) ---------- */
const cv=$('#cv'),cx=cv.getContext('2d'),V0={yaw:-.6,pitch:.35,zoom:1,px:0,py:0},V={...V0},L3={geo:1,well:1,tgt:1,grid:1};
const LAY=[['OVERBURDEN',0,-250,'rgba(70,76,88,.16)'],['SHALE',-250,-500,'rgba(70,76,88,.26)'],['CAPROCK',-500,-640,'rgba(95,101,113,.30)'],['RESERVOIR',-640,-820,'rgba(231,163,62,.20)'],['BASEMENT',-820,-950,'rgba(40,44,52,.45)']];
const PATH=[[0,0,0],[0,-380,0],[40,-520,10],[120,-650,40],[220,-730,70],[260,-745,80]],TGT=[[200,-690,40],[290,-790,120]];
let cw=0,ch=0,dpr=1,raf=0,anim=0;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function proj([x,y,z]){
  const cy=Math.cos(V.yaw),sy=Math.sin(V.yaw),cp=Math.cos(V.pitch),sp=Math.sin(V.pitch);
  const x1=x*cy-z*sy,z1=x*sy+z*cy,y2=(y+475)*cp-z1*sp,z2=(y+475)*sp+z1*cp;
  const s=Math.min(cw/900,ch/1150)*V.zoom,f=2200/(2200+z2);
  return[cw/2+V.px+x1*s*f,ch/2+V.py-y2*s*f,z2];
}
const seg=(a,b)=>{cx.beginPath();cx.moveTo(a[0],a[1]);cx.lineTo(b[0],b[1]);cx.stroke()};
const lab=(t,x,y,c='#9CA3AF')=>{cx.fillStyle=c;cx.fillText(t,clamp(x,4,Math.max(4,cw-cx.measureText(t).width-4)),y)};
function draw(){
  if(!cw)return;
  cx.setTransform(dpr,0,0,dpr,0,0);cx.clearRect(0,0,cw,ch);cx.font='11px Arial,sans-serif';cx.lineJoin='round';
  const K=300,C=[[-K,-K],[K,-K],[K,K],[-K,K]];
  if(L3.grid){cx.strokeStyle='rgba(156,163,175,.22)';cx.lineWidth=1;for(let k=-K;k<=K;k+=100){seg(proj([k,0,-K]),proj([k,0,K]));seg(proj([-K,0,k]),proj([K,0,k]))}}
  if(L3.geo){
    const F=[];
    LAY.forEach(([n,a,b,c])=>C.forEach((p,k)=>{const q=C[(k+1)%4],f=[[p[0],a,p[1]],[q[0],a,q[1]],[q[0],b,q[1]],[p[0],b,p[1]]].map(proj);F.push([f,c,f.reduce((s,v)=>s+v[2],0)/4])}));
    F.sort((u,v)=>v[2]-u[2]).forEach(([f,c])=>{cx.beginPath();f.forEach((v,i)=>i?cx.lineTo(v[0],v[1]):cx.moveTo(v[0],v[1]));cx.closePath();cx.fillStyle=c;cx.fill();cx.strokeStyle='rgba(156,163,175,.3)';cx.lineWidth=1;cx.stroke()});
    LAY.forEach(([n,a,b])=>{const q=proj([K,(a+b)/2,K]);lab(`${n} ${-a}–${-b} m`,q[0]+8,q[1]+4)});
    const g=proj([-K,0,K]);lab('GROUND SURFACE',g[0]-4,g[1]-6);
  }
  if(L3.tgt){
    const[a,b]=TGT,v=[];for(let i=0;i<8;i++)v.push(proj([i&1?b[0]:a[0],i&2?b[1]:a[1],i&4?b[2]:a[2]]));
    cx.strokeStyle='#E7A33E';cx.lineWidth=1.2;cx.setLineDash([4,3]);
    [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]].forEach(([i,j])=>seg(v[i],v[j]));cx.setLineDash([]);
    lab('TARGET ZONE',v[7][0]+6,v[7][1]-4,'#E7A33E');
  }
  if(L3.well){
    cx.strokeStyle='#fff';cx.lineWidth=2.5;cx.beginPath();PATH.forEach((p,i)=>{const q=proj(p);i?cx.lineTo(q[0],q[1]):cx.moveTo(q[0],q[1])});cx.stroke();
    const h=proj(PATH[0]),e=proj(PATH[5]);cx.fillStyle='#E7A33E';cx.fillRect(h[0]-4,h[1]-4,8,8);
    lab('WELLHEAD',h[0]+8,h[1]-6,'#fff');lab('BOTTOM HOLE',e[0]+8,e[1]+4,'#fff');
  }
}
const req=()=>{if(!raf)raf=requestAnimationFrame(()=>{raf=0;draw()})};
function viewFor(pt,zoom,yaw=V.yaw,pitch=V.pitch){const o={...V};Object.assign(V,{yaw,pitch,zoom,px:0,py:0});const s=proj(pt);Object.assign(V,o);return{yaw,pitch,zoom,px:cw/2-s[0],py:ch/2-s[1]}}
function goTo(t){
  cancelAnimationFrame(anim);const a={...V},t0=performance.now(),ms=matchMedia('(prefers-reduced-motion: reduce)').matches?0:500;
  const f=now=>{const k=ms?1:Math.min(1,(now-t0)/ms),e=k*k*(3-2*k);for(const q in t)V[q]=a[q]+(t[q]-a[q])*e;draw();if(k<1)anim=requestAnimationFrame(f)};
  anim=requestAnimationFrame(f);
}
function zoomAt(x,y,k){
  const r=cv.getBoundingClientRect(),lx=x-r.left-cw/2,ly=y-r.top-ch/2,nz=clamp(V.zoom*k,.4,8);k=nz/V.zoom;
  V.px=lx-(lx-V.px)*k;V.py=ly-(ly-V.py)*k;V.zoom=nz;
}
const clampPan=()=>{const l=Math.max(cw,ch)*V.zoom*.5;V.px=clamp(V.px,-l,l);V.py=clamp(V.py,-l,l)};
function view3d(a){
  const r=cv.getBoundingClientRect(),mid=[0,-475,0];
  if(a==='in'||a==='out'){cancelAnimationFrame(anim);zoomAt(r.left+cw/2,r.top+ch/2,a==='in'?1.25:.8);clampPan();req()}
  else if(a==='reset')goTo({...V0});
  else if(a==='fit'||a==='full')goTo(viewFor(mid,1));
  else if(a==='head')goTo(viewFor([0,-20,0],3.2));
  else if(a==='res')goTo(viewFor([220,-730,70],2.6));
}
$$('[data-l]').forEach(c=>c.onchange=()=>{L3[c.dataset.l]=c.checked?1:0;req()});
cv.addEventListener('wheel',e=>{e.preventDefault();cancelAnimationFrame(anim);zoomAt(e.clientX,e.clientY,Math.exp(-e.deltaY*.0015));clampPan();req()},{passive:false});
const PT=new Map();let G=null,pan=false;
const meas=()=>{const a=[...PT.values()];return a.length===2?{d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2}:a.length?{d:0,x:a[0].x,y:a[0].y}:null};
cv.onpointerdown=e=>{cv.setPointerCapture(e.pointerId);cancelAnimationFrame(anim);PT.set(e.pointerId,{x:e.clientX,y:e.clientY});G=meas();pan=e.button===2||e.shiftKey};
cv.onpointermove=e=>{
  if(!PT.has(e.pointerId))return;PT.set(e.pointerId,{x:e.clientX,y:e.clientY});const m=meas();
  if(PT.size===2&&G&&G.d){zoomAt(m.x,m.y,m.d/G.d);V.px+=m.x-G.x;V.py+=m.y-G.y}
  else if(PT.size===1&&G){const dx=m.x-G.x,dy=m.y-G.y;if(pan){V.px+=dx;V.py+=dy}else{V.yaw+=dx*.008;V.pitch=clamp(V.pitch+dy*.006,-1.2,1.4)}}
  G=m;clampPan();req();
};
cv.onpointerup=cv.onpointercancel=e=>{PT.delete(e.pointerId);G=meas()};
cv.oncontextmenu=e=>e.preventDefault();
new ResizeObserver(()=>{dpr=devicePixelRatio||1;cw=cv.clientWidth;ch=cv.clientHeight;cv.width=Math.round(cw*dpr);cv.height=Math.round(ch*dpr);draw()}).observe(cv);

setWell(S.well);
show();
