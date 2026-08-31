import { CARDS, MONTHS, MONTHS_FULL, CARD_LABELS, CARD_SHORT_LABELS, CARD_CLS, BENEFIT_CATEGORIES, POINTS_PROGRAMS, PREMIUM_CARD_CATALOG, POINTS_MULTIPLIERS } from './cards.js';
import { state, CY, CM, escapeHtml } from './state.js';
import { isUsed, isCredited, toggleCredited, getEffectiveAmount, bName, getNote, getPartialUsed, loadNotes, saveNotes, getNoteKey, isSkipped, isGloballySnoozed, isMonthSnoozed, getSnoozedUntil, getCardFeeMonth, getCardFeeDay, countSkipped, clearAllSkipped, loadSkipped, loadPointsRedeemed, getPointsRedeemedYTD, getAllPointsRedeemedYTD, getPointsSource } from './storage.js';
import {
  getCardYearStart, getCardYearPeriods, getYTDPeriods, isPFuture, isPCurrent, isYTDCurrent,
  getCurrentPK, getCurrentLabel, getBAmount, getFee, isBExpired, isBNotAvailable,
  calcStats, metricsHTML, progressHTML, getStreak, getLongestStreak, daysUntilFee, daysUntilEOM,
  getUnclaimedMonthly, maxCardYearValue, calcCapturedByType, getCardYearMonthsElapsed,
  getProjectedCapture, getROIGrade
} from './periods.js';
import { renderExportReport, ensureReportStyles } from './report-view.js';
import { buildBreakEven, breakEvenVerdict } from './breakeven-model.js';

// ── Helpers ────────────────────────────────────────────────────────────────
export function getVisibleCardKeys(){
  const base=(state.userCards&&state.userCards.length?state.userCards:['csr','gold','platinum','cap1_venture_x']).filter(c=>!!CARDS[c]);
  try{
    const saved=JSON.parse(localStorage.getItem('perks-card-order')||'[]');
    if(saved.length){
      const set=new Set(base);
      const ordered=saved.filter(k=>set.has(k));
      const rest=base.filter(k=>!saved.includes(k));
      return [...ordered,...rest];
    }
  }catch(e){}
  return base;
}

// ── View groups ────────────────────────────────────────────────────────────
// Several views answered the same question with different framing: five of
// them computed captured-vs-fees, three asked "should I change my lineup",
// two listed things needing attention. Grouping them behind one tab strip
// each cuts the drawer from 22 entries to 14 without touching the render
// functions themselves — every tab is still its own view id.
export const VIEW_GROUPS={
  money:{label:'Money', tabs:[
    {view:'net-value',       label:'Now'},
    {view:'break-even',      label:'Break-even'},
    {view:'fee-optimizer',   label:'Per card'},
    {view:'performance',     label:'Trends'},
    {view:'recap',           label:'Year'},
    {view:'wrap',            label:'Report card'},
  ]},
  cards:{label:'Cards', tabs:[
    {view:'compare',         label:'Compare'},
    {view:'card-simulator',  label:'Simulate'},
    {view:'upgrade-advisor', label:'Upgrade'},
  ]},
  alerts:{label:'Alerts', tabs:[
    {view:'digest',          label:'Act now'},
    {view:'benefit-alerts',  label:'Changes'},
  ]},
};
// view id -> group id
export const VIEW_GROUP_OF=Object.fromEntries(
  Object.entries(VIEW_GROUPS).flatMap(([g,{tabs}])=>tabs.map(t=>[t.view,g]))
);
// Entering a group lands on its first tab.
export const GROUP_ENTRY=Object.fromEntries(
  Object.entries(VIEW_GROUPS).map(([g,{tabs}])=>[g,tabs[0].view])
);

function groupTabsHTML(view){
  const g=VIEW_GROUP_OF[view];
  if(!g) return '';
  return `<nav class="group-tabs" aria-label="${VIEW_GROUPS[g].label} views">`+
    VIEW_GROUPS[g].tabs.map(t=>{
      const on=t.view===view;
      return `<button class="group-tab${on?' active':''}"${on?' aria-current="page"':''} onclick="setActiveView('${t.view}')">${t.label}</button>`;
    }).join('')+`</nav>`;
}

// Rebuilding #main destroys whatever the keyboard was focused on, which
// dropped the user back to the top of the page on every benefit toggle.
// Remember the focused control by its data attributes and re-focus its
// replacement once the new HTML is in.
function focusFingerprint(el){
  if(!el||el===document.body||!document.getElementById('main').contains(el)) return null;
  const parts=['id','pk','creditId','creditPk','snoozeId','unsnooze']
    .filter(k=>el.dataset[k]!=null)
    .map(k=>`[data-${k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}="${CSS.escape(el.dataset[k])}"]`);
  if(!parts.length) return null;
  const cls=[...el.classList].filter(c=>c!=='checked'&&c!=='pop')[0];
  return (cls?'.'+CSS.escape(cls):el.tagName.toLowerCase())+parts.join('');
}

export function set(html, onReady){
  const main=document.getElementById('main');
  const refocus=focusFingerprint(document.activeElement);
  main.classList.add('transitioning');
  const tabs=groupTabsHTML(state.activeView);
  setTimeout(()=>{
    main.innerHTML=tabs+html;
    main.classList.remove('transitioning');
    if(onReady) onReady();
    if(refocus){
      try{ main.querySelector(refocus)?.focus({preventScroll:true}); }catch(e){}
    }
  },180);
}

export function haptic(style='light'){
  if(!navigator.vibrate) return;
  const patterns={light:[10],medium:[20],heavy:[30],success:[10,50,20]};
  navigator.vibrate(patterns[style]||[10]);
}

export function animateCounters(){
  document.querySelectorAll('[data-count]').forEach(el=>{
    const target=parseFloat(el.dataset.count);
    const prefix=el.dataset.prefix||'',suffix=el.dataset.suffix||'';
    const duration=600,start=performance.now(),from=0;
    function update(now){
      const elapsed=now-start,progress=Math.min(elapsed/duration,1);
      const eased=1-Math.pow(1-progress,3);
      const current=from+(target-from)*eased;
      el.textContent=prefix+(Number.isInteger(target)?Math.round(current):current.toFixed(0))+suffix;
      if(progress<1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  });
}

export function launchConfetti(){
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas=document.getElementById('confettiCanvas');
  const ctx=canvas.getContext('2d');
  canvas.width=window.innerWidth; canvas.height=window.innerHeight;
  const colors=['#C8922A','#2A9B6A','#4A7FA5','#D94040','#F5C542','#ffffff'];
  const pieces=Array.from({length:120},()=>({
    x:Math.random()*canvas.width,y:-10-Math.random()*100,
    r:Math.random()*6+3,d:Math.random()*3+1,
    color:colors[Math.floor(Math.random()*colors.length)],
    tilt:Math.random()*10-5,tiltAngle:0,tiltSpeed:Math.random()*0.1+0.05,
  }));
  let frame=0;
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    pieces.forEach(p=>{ p.tiltAngle+=p.tiltSpeed; p.y+=p.d; p.tilt=Math.sin(p.tiltAngle)*12; ctx.beginPath(); ctx.fillStyle=p.color; ctx.ellipse(p.x+p.tilt,p.y,p.r,p.r/2,p.tiltAngle,0,2*Math.PI); ctx.fill(); });
    frame++;
    if(frame<160) requestAnimationFrame(draw);
    else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  draw();
}

export function checkAllClaimed(cardKey){
  const card=CARDS[cardKey];
  let allDone=true;
  card.sections.forEach(s=>{
    const pk=getCurrentPK(cardKey,s.cadence);
    s.benefits.forEach(b=>{
      if(isBExpired(b,{calY:CY,calM:CM,m:CM})||isBNotAvailable(b,CY,{calM:CM,calY:CY})||isGloballySnoozed(cardKey,b.id)) return;
      if(!isUsed(cardKey,b.id,pk)) allDone=false;
    });
  });
  if(allDone) launchConfetti();
}

// ── Expiry helpers ─────────────────────────────────────────────────────────
function getExpiryBadge(b){
  if(!b.expiresAfter) return '';
  const {y,h}=b.expiresAfter;
  const expMonth=h===0?5:11;
  const expAbs=y*12+expMonth,nowAbs=CY*12+CM;
  const monthsLeft=expAbs-nowAbs;
  if(monthsLeft<=0) return '';
  if(monthsLeft<=3) return `<span class="expiry-badge">ends ${MONTHS[expMonth]} ${y}</span>`;
  if(monthsLeft<=6) return `<span class="expiry-badge soon">ends ${MONTHS[expMonth]} ${y}</span>`;
  return '';
}
function getBenefitExpiryLabel(b){
  if(b.startsFrom&&CY<b.startsFrom) return '';
  const now=new Date();
  if(b.desc&&b.desc.includes('through')){
    const match=b.desc.match(/through\s+([\w]+\s+\d{4})/i);
    if(match){
      const expDate=new Date(match[1]);
      const monthsLeft=Math.round((expDate-now)/(1000*60*60*24*30));
      if(monthsLeft<=6&&monthsLeft>0) return `<span class="expiry-badge soon">⏰ ${monthsLeft}mo left</span>`;
    }
  }
  return '';
}


// ── Partial bar ────────────────────────────────────────────────────────────
function buildPartialBar(cardKey,benefitId,pk,totalAmt){
  const used=getPartialUsed(cardKey,benefitId,pk);
  const pct=Math.min(100,Math.round(used/totalAmt*100));
  return `<div class="partial-bar">
    <div class="partial-track"><div class="partial-fill" style="width:${pct}%"></div></div>
    <div class="partial-label"><span>$${used.toFixed(0)} used</span><span>$${(totalAmt-used).toFixed(0)} remaining</span></div>
    <div class="partial-input-row">
      <input class="partial-input" type="number" min="0" max="${totalAmt}" step="1"
        value="${used}" placeholder="$0"
        data-card="${cardKey}" data-id="${benefitId}" data-pk="${pk}" data-total="${totalAmt}"
        style="width:80px"/>
      <span style="font-size:11px;color:var(--text-tertiary);font-family:var(--mono)">/ $${totalAmt} total</span>
    </div>
  </div>`;
}

// ── Donut chart ────────────────────────────────────────────────────────────
function buildDonut(captured,missed,remaining,size=100){
  const total=captured+missed+remaining||1;
  const r=38,cx=50,cy=50,circ=2*Math.PI*r;
  function slice(value,offset,color){
    const pct=value/total,dash=pct*circ,gap=circ-dash;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="14" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
  }
  const c1=captured/total*circ,c2=missed/total*circ;
  const svg=`<svg class="donut-svg" width="${size}" height="${size}" viewBox="0 0 100 100">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border-light)" stroke-width="14"/>
    ${slice(captured,0,'var(--green)')}${slice(missed,c1,'var(--red)')}${slice(remaining,c1+c2,'rgba(200,146,42,0.3)')}
    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="14" font-weight="700" fill="var(--text)" font-family="DM Mono,monospace">${Math.round(captured/total*100)}%</text>
  </svg>`;
  const legend=`<div class="donut-legend">
    <div class="donut-legend-item"><span class="donut-dot" style="background:var(--green)"></span><span style="color:var(--text-secondary)">Captured <strong style="color:var(--text)">$${captured.toFixed(0)}</strong></span></div>
    <div class="donut-legend-item"><span class="donut-dot" style="background:var(--red)"></span><span style="color:var(--text-secondary)">Missed <strong style="color:var(--text)">$${missed.toFixed(0)}</strong></span></div>
    <div class="donut-legend-item"><span class="donut-dot" style="background:rgba(200,146,42,0.4)"></span><span style="color:var(--text-secondary)">Remaining <strong style="color:var(--text)">$${remaining.toFixed(0)}</strong></span></div>
  </div>`;
  return `<div class="donut-wrap">${svg}${legend}</div>`;
}

// ── Projection bar ─────────────────────────────────────────────────────────
function buildProjection(cardKey){
  const monthsElapsed=getCardYearMonthsElapsed(cardKey);
  const monthsRemaining=12-monthsElapsed;
  const {repeating,oneTime}=calcCapturedByType(cardKey);
  const projectedRepeating=monthsRemaining>0?(repeating/monthsElapsed)*monthsRemaining:0;
  const projected=oneTime+repeating+projectedRepeating;
  const fee=getFee(cardKey,CY);
  const projectedEffective=fee-projected;
  const isProfit=projected>fee;
  return `<div class="projection-bar">
    <div>
      <div style="font-size:10px;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.06em;color:var(--text-tertiary);margin-bottom:2px">${CARD_LABELS[cardKey]}</div>
      <div class="projection-label">Projected year-end capture</div>
      <div style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary)">at current rate · ${monthsRemaining} months left</div>
    </div>
    <div style="text-align:right">
      <div class="projection-val" style="color:${isProfit?'var(--green)':''}">$${projected.toFixed(0)}</div>
      <div style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary)">${isProfit?'+$'+Math.abs(projectedEffective).toFixed(0)+' profit':'~$'+Math.abs(projectedEffective).toFixed(0)+' effective fee'}</div>
    </div>
  </div>`;
}

// ── Countdown strip ────────────────────────────────────────────────────────
function buildCountdownStrip(cardKey){
  const fee=getFee(cardKey,CY);
  if(!fee) return '';
  const days=daysUntilFee(cardKey);
  const fm=getCardFeeMonth(cardKey),fd=getCardFeeDay(cardKey);
  const {captured}=calcStats(cardKey,c=>getCardYearPeriods(cardKey,c),isPCurrent);
  const needed=Math.max(0,fee-captured);
  const cls=days<=30?'urgent':days<=90?'soon':'';
  const feeLabel=`${MONTHS[fm]} ${fd}`;
  const feeMonthShort=MONTHS[fm].toUpperCase();
  const editBtn=`<button onclick="openFeeDateModal('${cardKey}')" style="background:none;border:none;cursor:pointer;padding:2px 4px;color:var(--text-tertiary);font-size:10px;font-family:var(--mono);line-height:1" title="Edit fee date">✎</button>`;
  const calSvg=`<span style="display:inline-flex;flex-direction:column;align-items:center;justify-content:center;width:32px;height:32px;border-radius:7px;background:var(--surface);border:1px solid var(--border);overflow:hidden;line-height:1;flex-shrink:0">
    <span style="background:#e03030;color:#fff;font-size:7px;font-weight:700;font-family:var(--mono);width:100%;text-align:center;padding:1px 0;letter-spacing:0.04em">${feeMonthShort}</span>
    <span style="font-size:14px;font-weight:700;font-family:var(--font);color:var(--text);line-height:1.5">${fd}</span>
  </span>`;
  const targetSvg=`<span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex-shrink:0;color:var(--text-secondary)"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.6"/><line x1="10" y1="2" x2="10" y2="5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="10" y1="15" x2="10" y2="18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="2" y1="10" x2="5" y2="10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="15" y1="10" x2="18" y2="10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span>`;
  let html=`<div class="countdown-strip">`;
  html+=`<div class="countdown-pill ${cls}">${calSvg}<div><div style="font-size:11px;font-weight:600;color:inherit">${days}d until fee ${editBtn}</div><div style="font-size:10px;opacity:0.7">Due ${feeLabel} · $${fee}</div></div></div>`;
  if(needed>0){
    html+=`<div class="countdown-pill">${targetSvg}<div><div style="font-size:11px;font-weight:600;color:var(--text)">$${needed.toFixed(0)} to breakeven</div><div style="font-size:10px;opacity:0.7">$${captured.toFixed(0)} of $${fee} captured</div></div></div>`;
  } else {
    html+=`<div class="countdown-pill" style="border-color:var(--green)"><span style="font-size:13px;font-family:var(--mono);color:var(--green);font-weight:600">+</span><div><div style="font-size:11px;font-weight:600;color:var(--green)">$${Math.abs(fee-captured).toFixed(0)} in profit</div><div style="font-size:10px;color:var(--text-tertiary)">Fee fully offset</div></div></div>`;
  }
  html+=`</div>`;
  return html;
}

function buildBreakevenBar(cardKey){
  const fee=getFee(cardKey,CY);
  const {captured}=calcStats(cardKey,c=>getCardYearPeriods(cardKey,c),isPCurrent);
  const diff=captured-fee;
  if(diff>=0) return `<div class="breakeven-bar in-profit"><div>In profit — you've extracted more than the annual fee</div><div class="breakeven-amt">+$${diff.toFixed(0)}</div></div>`;
  return `<div class="breakeven-bar needs-more"><div>Claim <strong>$${Math.abs(diff).toFixed(0)}</strong> more to fully offset your $${fee} annual fee</div><div class="breakeven-amt">$${captured.toFixed(0)}/$${fee}</div></div>`;
}

function buildEOMWarning(cardKey){
  const days=daysUntilEOM();
  if(days>5) return '';
  const unclaimed=getUnclaimedMonthly(cardKey);
  if(!unclaimed.length) return '';
  const total=unclaimed.reduce((s,b)=>s+b.amt,0);
  const names=unclaimed.map(b=>bName(cardKey,b)).join(', ');
  return `<div class="eom-warning"><div><strong>${days} day${days===1?'':'s'} left this month</strong> — you still have $${total.toFixed(0)} unclaimed: ${names}</div></div>`;
}

// ── All cards summary ──────────────────────────────────────────────────────
function buildAllCardsSummary(){
  let totalAvail=0,totalClaimed=0,totalFees=0;
  getVisibleCardKeys().forEach(cardKey=>{
    totalFees+=getFee(cardKey,CY);
    CARDS[cardKey].sections.forEach(s=>{
      const pk=getCurrentPK(cardKey,s.cadence);
      const p={calY:CY,calM:CM,m:CM};
      s.benefits.forEach(b=>{
        if(isBExpired(b,p)||isBNotAvailable(b,CY,p)||isGloballySnoozed(cardKey,b.id)) return;
        const amt=getBAmount(b,{m:CM});
        totalAvail+=amt;
        if(isUsed(cardKey,b.id,pk)) totalClaimed+=amt;
      });
    });
  });
  const effectiveFee=totalFees-totalClaimed;
  const isProfitable=totalClaimed>=totalFees;
  const feeCoveragePct=totalFees>0?Math.round(totalClaimed/totalFees*100):0;
  const remaining=totalAvail-totalClaimed;
  return `<div class="allcards-summary">
    <div class="allcards-stats-row">
      <div class="allcards-stat"><div class="allcards-stat-val green">$${totalClaimed.toFixed(0)}</div><div class="allcards-stat-label">Claimed</div></div>
      <div class="allcards-stat" style="text-align:center"><div class="allcards-stat-val ${isProfitable?'green':feeCoveragePct>=80?'gold':''}">${feeCoveragePct}%</div><div class="allcards-stat-label">Fee coverage</div></div>
      <div class="allcards-stat" style="text-align:right"><div class="allcards-stat-val" style="color:var(--text-tertiary)">$${remaining.toFixed(0)}</div><div class="allcards-stat-label">Still available</div></div>
    </div>
    <div class="allcards-track" style="position:relative;overflow:visible">
      <div class="allcards-fill-claimed" style="width:${Math.min(feeCoveragePct,115)}%;background:${isProfitable?'var(--green)':'var(--gold)'};border-radius:inherit;transition:width 0.4s ease"></div>
      ${!isProfitable?`<div style="position:absolute;top:-3px;bottom:-3px;right:0;width:2px;background:#fff;opacity:0.5;border-radius:1px"></div>`:''}
    </div>
    <div class="allcards-track-labels">
      <span>$0</span>
      <span style="color:${isProfitable?'var(--green)':'var(--text-tertiary)'}">${isProfitable?'In profit +$'+Math.abs(effectiveFee).toFixed(0):'Break-even at $'+totalFees}</span>
      <span>${isProfitable?'':'$'+totalFees}</span>
    </div>
  </div>`;
}

function buildLiveBanner(){
  const items=buildPriorityQueue();
  if(!items.length) return '';
  const top=items[0];
  const eomDays=daysUntilEOM();
  const urgency=eomDays<=3?`${eomDays}d left`:eomDays<=7?`${eomDays}d left`:'This month';
  return `<div class="live-banner" onclick="setActiveView('this-period')">
    <div class="live-banner-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
    <div><div class="live-banner-title">Use next: ${top.name}</div><div class="live-banner-sub">${top.card} · ${urgency}</div></div>
    <div class="live-banner-amt">$${top.amt}</div>
  </div>`;
}

function buildCategoryBreakdown(){
  const cats={dining:0,travel:0,shopping:0,fitness:0,entertainment:0,other:0};
  const catColors={dining:'#C86428',travel:'var(--plat)',shopping:'var(--gold)',fitness:'var(--green)',entertainment:'#9333ea',other:'var(--text-tertiary)'};
  getVisibleCardKeys().forEach(cardKey=>{
    CARDS[cardKey].sections.forEach(s=>{
      const pk=getCurrentPK(cardKey,s.cadence);
      s.benefits.forEach(b=>{
        if(isBNotAvailable(b,CY,{calM:CM,calY:CY})||isBExpired(b,{calY:CY,calM:CM,m:CM})||isGloballySnoozed(cardKey,b.id)) return;
        if(!isUsed(cardKey,b.id,pk)) return;
        const cat=BENEFIT_CATEGORIES[b.id]||'other';
        cats[cat]+=getBAmount(b,{m:CM});
      });
    });
  });
  const total=Object.values(cats).reduce((a,b)=>a+b,0)||1;
  const sorted=Object.entries(cats).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  if(!sorted.length) return '';
  const catIcons={dining:'Dining',travel:'Travel',shopping:'Shopping',fitness:'Fitness',entertainment:'Ent.',other:'Other'};
  let html=`<div style="font-size:11px;font-family:var(--mono);color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Claimed by category</div>`;
  sorted.forEach(([cat,val])=>{
    const pct=Math.round(val/total*100);
    html+=`<div class="cat-row"><div class="cat-name">${catIcons[cat]} ${cat}</div><div class="cat-bar-wrap"><div class="cat-bar-fill" style="width:${pct}%;background:${catColors[cat]}"></div></div><div class="cat-val">$${val.toFixed(0)}</div></div>`;
  });
  return `<div class="cat-breakdown">${html}</div>`;
}

// ── Digest view ────────────────────────────────────────────────────────────
export function renderDigest(){
  const now=new Date();
  const eomDays=daysUntilEOM();
  const q=Math.floor(CM/3);
  const eoqDays=Math.ceil((new Date(CY,(q+1)*3,0)-now)/86400000);
  const h=CM<6?0:1;
  const eohDays=Math.ceil((new Date(CY,h===0?6:12,0)-now)/86400000);

  const priorityItems=buildPriorityQueue();
  const skippedCount=countSkipped();

  const buckets=[
    {key:'month',label:'This month',days:eomDays,dayLabel:`${eomDays}d left`,cadences:['monthly'],
     urgentCls:eomDays<=5?'digest-urgent':eomDays<=10?'digest-soon':'',items:[]},
    {key:'quarter',label:'This quarter',days:eoqDays,dayLabel:`${eoqDays}d left`,cadences:['quarterly'],
     urgentCls:eoqDays<=7?'digest-urgent':eoqDays<=21?'digest-soon':'',items:[]},
    {key:'half',label:'This half-year',days:eohDays,dayLabel:`${eohDays}d left`,cadences:['semi-annual','cal-semi-annual'],
     urgentCls:eohDays<=14?'digest-urgent':eohDays<=45?'digest-soon':'',items:[]},
    {key:'year',label:'This year',days:null,dayLabel:'renews annually',cadences:['annual','cal-annual','cal-annual-overlap','feb-annual'],
     urgentCls:'',items:[]},
  ];

  getVisibleCardKeys().forEach(cardKey=>{
    CARDS[cardKey].sections.forEach(s=>{
      const bucket=buckets.find(b=>b.cadences.includes(s.cadence));
      if(!bucket) return;
      const pk=getCurrentPK(cardKey,s.cadence);
      const p={calY:CY,calM:CM,m:CM};
      s.benefits.forEach(b=>{
        if(isBExpired(b,p)||isBNotAvailable(b,CY,p)||isGloballySnoozed(cardKey,b.id)) return;
        if(isUsed(cardKey,b.id,pk)||isSkipped(cardKey,b.id,pk)) return;
        bucket.items.push({cardKey,cardLabel:CARD_LABELS[cardKey],name:bName(cardKey,b),amt:getRemainingAmt(cardKey,b,{m:CM},pk),pk,benefitId:b.id});
      });
    });
  });

  const totalAtRisk=buckets.flatMap(b=>b.items).reduce((s,i)=>s+i.amt,0);
  const monthTotal=buckets[0].items.reduce((s,i)=>s+i.amt,0);

  let html=`<div class="banner"><strong>Benefit digest</strong> — unclaimed benefits by urgency &amp; deadline</div>`;

  if(totalAtRisk===0 && !priorityItems.length){
    html+=`<div style="text-align:center;padding:48px 20px;color:var(--green);font-size:15px;font-weight:500">All benefits up to date! ✓</div>`;
    set(html); return;
  }

  // Hero total
  html+=`<div class="digest-summary">
    <div class="digest-summary-val">$${totalAtRisk.toFixed(0)}</div>
    <div class="digest-summary-label">Total unclaimed across all cards</div>
    ${monthTotal>0?`<div class="digest-summary-sub">$${monthTotal.toFixed(0)} expires this month</div>`:''}
  </div>`;

  // Dismissed section — collapsed by default
  if(skippedCount>0){
    const skippedData=loadSkipped();
    const skippedRows=Object.keys(skippedData).map(key=>{
      const [cardKey,benefitId,pk]=key.split('__');
      if(!CARDS[cardKey]) return '';
      let benefitName='',benefitAmt=0;
      CARDS[cardKey].sections.forEach(s=>s.benefits.forEach(b=>{
        if(b.id===benefitId){ benefitName=bName(cardKey,b); benefitAmt=getBAmount(b,{m:CM}); }
      }));
      if(!benefitName) return '';
      return `<div class="priority-row" style="opacity:0.6">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500;color:var(--text)">${benefitName}</div>
          <div style="font-size:10px;color:var(--text-tertiary);font-family:var(--mono)">${CARD_LABELS[cardKey]||cardKey} · $${benefitAmt}</div>
        </div>
        <button onclick="unskipBenefit('${cardKey}','${benefitId}','${pk}')" style="background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text-secondary);font-size:12px;padding:4px 10px;font-family:var(--mono);flex-shrink:0">Restore</button>
      </div>`;
    }).filter(Boolean).join('');
    if(skippedRows){
      html+=`<details style="margin-bottom:8px">
        <summary style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;list-style:none;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)">
          <span style="font-size:11px;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.06em;color:var(--text-tertiary)">${skippedCount} Dismissed</span>
          <span style="font-size:11px;color:var(--blue);font-family:var(--mono)">Show ▾</span>
        </summary>
        <div style="margin-top:4px">
          <div style="text-align:right;margin-bottom:6px"><button onclick="clearAllSkipped()" style="background:none;border:none;cursor:pointer;font-size:11px;color:var(--blue);padding:0;font-family:var(--mono)">Restore all</button></div>
          ${skippedRows}
        </div>
      </details>`;
    }
  }

  if(eomDays<=5) html+=`<div class="eom-warning">Only ${eomDays} day${eomDays===1?'':'s'} left — monthly benefits reset soon!</div>`;

  // Act now — urgency ranked list with dismiss
  if(priorityItems.length){
    html+=`<div class="section-header"><span class="section-title">Act now</span><span class="section-period">${priorityItems.length} unclaimed · by urgency</span></div>`;
    priorityItems.forEach((item,i)=>{
      const rankCls=i===0?'urgent':i<3?'high':'normal';
      html+=`<div class="priority-row">
        <div class="priority-rank ${rankCls}" onclick="goToCardPeriod('${item.cardKey}')">${i+1}</div>
        <div style="flex:1;cursor:pointer" onclick="goToCardPeriod('${item.cardKey}')">
          <div style="font-size:13px;font-weight:500;color:var(--text)">${item.name}</div>
          <div style="font-size:10px;color:var(--text-tertiary);font-family:var(--mono)">${item.card}</div>
        </div>
        <div style="text-align:right;cursor:pointer" onclick="goToCardPeriod('${item.cardKey}')">
          <div style="font-size:14px;font-weight:700;font-family:var(--mono);color:var(--green)">$${item.amt}</div>
          <span class="priority-urgency ${item.urgencyCls}">${item.urgencyLabel}</span>
        </div>
        <button onclick="skipBenefit('${item.cardKey}','${item.benefitId}','${item.pk}')" title="Dismiss" style="margin-left:10px;background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text-secondary);font-size:14px;padding:4px 8px;line-height:1;flex-shrink:0">×</button>
      </div>`;
    });
  }

  // By deadline — collapsed period buckets
  const filledBuckets=buckets.filter(b=>b.items.length>0);
  if(filledBuckets.length){
    let bucketHTML='';
    filledBuckets.forEach(bucket=>{
      const bucketTotal=bucket.items.reduce((s,i)=>s+i.amt,0);
      bucketHTML+=`<div class="digest-bucket ${bucket.urgentCls}">
        <div class="digest-bucket-header">
          <div>
            <div class="digest-bucket-label">${bucket.label}</div>
            <div class="digest-bucket-days">${bucket.dayLabel} · ${bucket.items.length} benefit${bucket.items.length!==1?'s':''}</div>
          </div>
          <div class="digest-bucket-total">$${bucketTotal.toFixed(0)}</div>
        </div>`;
      bucket.items.sort((a,b)=>b.amt-a.amt).forEach(item=>{
        bucketHTML+=`<div class="digest-item" onclick="goToCardPeriod('${item.cardKey}')">
          <div>
            <div class="digest-item-name">${item.name}</div>
            <div class="digest-item-card">${item.cardLabel}</div>
          </div>
          <div class="digest-item-amt">$${item.amt}</div>
        </div>`;
      });
      bucketHTML+=`</div>`;
    });
    html+=`<details style="margin-top:16px">
      <summary style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;list-style:none;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px">
        <span style="font-size:11px;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.06em;color:var(--text-tertiary)">By Deadline</span>
        <span style="font-size:11px;color:var(--text-tertiary);font-family:var(--mono)">Show ▾</span>
      </summary>
      ${bucketHTML}
    </details>`;
  }

  set(html);
}

// ── Net value dashboard ────────────────────────────────────────────────────
export function renderNetValue(){
  const CARD_KEYS=getVisibleCardKeys();

  // ── Points balance (computed upfront so it feeds the hero) ─────────────
  const ptsBalances=JSON.parse(localStorage.getItem('perks-points-balances')||'{}');
  const ptsVals=JSON.parse(localStorage.getItem('perks-points-valuations')||'{}');
  const cardKeySet=new Set(CARD_KEYS);
  const activeProgs=Object.entries(POINTS_PROGRAMS).filter(([,p])=>p.cards.some(c=>cardKeySet.has(c)));
  let totalPtsVal=0, progRows='';
  activeProgs.forEach(([pid,prog])=>{
    const bal=parseFloat(ptsBalances[pid])||0;
    const cpp=ptsVals[pid]??prog.centsPerPt;
    const est=bal*cpp/100;
    totalPtsVal+=est;
    const cardNames=prog.cards.filter(c=>cardKeySet.has(c)).map(c=>CARD_LABELS[c]).join(', ');
    progRows+=`<div class="pts-row">
      <div class="pts-info"><div class="pts-name">${prog.name}</div><div class="pts-cards">${cardNames}</div></div>
      <div class="pts-inputs">
        <input type="number" class="pts-balance-input" value="${bal||''}" placeholder="0"
          oninput="window.savePointsBalance('${pid}',this.value)">
        <span class="pts-sep">×</span>
        <input type="number" class="pts-val-input" step="0.05" min="0.1" max="10" value="${cpp}"
          oninput="window.savePointsValuation('${pid}',this.value)">
        <span class="pts-cpp">¢</span>
      </div>
      <div class="pts-est" style="color:${est>0?'var(--green)':'var(--text-tertiary)'}">${est>0?'$'+est.toFixed(2):'—'}</div>
    </div>`;
  });

  // ── Per-card stats including redemptions ───────────────────────────────
  let totalFees=0,totalCaptured=0,totalProjected=0,totalRedeemed=0;
  const cards=CARD_KEYS.map(cardKey=>{
    const fee=getFee(cardKey,CY);
    const {captured}=calcStats(cardKey,c=>getCardYearPeriods(cardKey,c),isPCurrent);
    const projected=getProjectedCapture(cardKey);
    const redeemed=getPointsRedeemedYTD(cardKey,CY);
    totalFees+=fee; totalCaptured+=captured; totalProjected+=projected;
    totalRedeemed+=redeemed;
    return {cardKey,fee,captured,projected,redeemed};
  });

  // Projected year-end: benefit projection + locked-in redemptions YTD + points balance held
  const allInNow=totalCaptured+totalRedeemed;
  const allInProj=totalProjected+totalRedeemed+totalPtsVal;
  const netNow=allInNow-totalFees;
  const netProj=allInProj-totalFees;
  const inProfit=netNow>=0;
  const projProfit=netProj>=0;
  const coveragePct=totalFees>0?Math.min(100,Math.round(allInNow/totalFees*100)):0;
  const projPct=totalFees>0?Math.min(110,Math.round(allInProj/totalFees*100)):0;

  let html=`<div class="banner"><strong>Portfolio value</strong> — all cards, this card year</div>`;

  // Hero summary
  html+=`<div class="netval-hero">
    <div class="netval-hero-row">
      <div>
        <div class="netval-hero-val ${inProfit?'green':'red'}">${inProfit?'+':'-'}$${Math.abs(netNow).toFixed(2)}</div>
        <div class="netval-hero-label">Net position now</div>
      </div>
      <div style="text-align:right">
        <div class="netval-hero-val ${projProfit?'green':''}">${projProfit?'+':'-'}$${Math.abs(netProj).toFixed(2)}</div>
        <div class="netval-hero-label">Projected year-end</div>
      </div>
    </div>
    <div class="netval-progress">
      <div class="netval-progress-proj" style="width:${projPct}%;background:${projProfit?'rgba(42,155,106,0.22)':'rgba(200,146,42,0.18)'}"></div>
      <div class="netval-progress-fill" style="width:${coveragePct}%;background:${inProfit?'var(--green)':'var(--gold)'}"></div>
    </div>
    <div class="netval-progress-labels">
      <span>$0</span>
      <span style="color:${inProfit?'var(--green)':'var(--gold)'}">
        ${coveragePct}% of $${totalFees} in fees covered
      </span>
      <span>$${totalFees}</span>
    </div>
    <div class="netval-hero-totals">
      <span><strong style="color:var(--green)">$${totalCaptured.toFixed(0)}</strong> benefits</span>
      ${totalRedeemed>0?`<span>·</span><span><strong style="color:var(--green)">$${totalRedeemed.toFixed(0)}</strong> redeemed</span>`:''}
      ${totalPtsVal>0?`<span>·</span><span><strong style="color:var(--green)">$${totalPtsVal.toFixed(0)}</strong> pts balance</span>`:''}
      <span>·</span>
      <span><strong>$${totalFees}</strong> fees</span>
    </div>
  </div>`;

  // Per-card breakdown sorted by all-in captured %
  html+=`<div class="section-header"><span class="section-title">Per card breakdown</span></div>`;
  [...cards].sort((a,b)=>((b.captured+b.redeemed)/(b.fee||1))-((a.captured+a.redeemed)/(a.fee||1))).forEach(({cardKey,fee,captured,projected,redeemed})=>{
    const allIn=captured+redeemed;
    const allInProj2=projected+redeemed;
    const capPct=fee>0?Math.min(100,allIn/fee*100):0;
    const projPct2=fee>0?Math.min(110,allInProj2/fee*100):0;
    const net=allIn-fee;
    const inP=net>=0;
    const projNet=allInProj2-fee;
    const projInP=projNet>=0;
    html+=`<div class="netval-card-row" onclick="goToCardPeriod('${cardKey}')">
      <div class="netval-card-header">
        <span class="netval-card-name">${CARD_LABELS[cardKey]}</span>
        <span class="netval-card-net" style="color:${inP?'var(--green)':'var(--text-secondary)'}">
          ${inP?'+':'-'}$${Math.abs(net).toFixed(0)}<span style="font-size:9px;color:var(--text-tertiary)"> / $${fee}</span>
        </span>
      </div>
      <div class="netval-bar-wrap">
        <div class="netval-bar-proj" style="width:${projPct2}%;background:${projInP?'rgba(42,155,106,0.18)':'rgba(200,146,42,0.18)'}"></div>
        <div class="netval-bar-cap" style="width:${capPct}%;background:${inP?'var(--green)':'var(--gold)'}"></div>
      </div>
      <div class="netval-card-sub">
        <span style="color:var(--green)">$${captured.toFixed(0)} benefits</span>
        ${redeemed>0?`<span style="color:var(--text-tertiary)">·</span><span style="color:var(--green)">$${redeemed.toFixed(0)} redeemed</span>`:''}
        <span style="color:var(--text-tertiary)">·</span>
        <span>$${allInProj2.toFixed(0)} projected</span>
        <span style="color:var(--text-tertiary)">·</span>
        <span style="color:${projInP?'var(--green)':'var(--text-tertiary)'}">$${fee} fee${projInP?' ✓':''}</span>
      </div>
    </div>`;
  });

  // Points balances section
  if(activeProgs.length){
    html+=`<div class="section-header" style="margin-top:4px"><span class="section-title">Points balances</span><span class="section-period">${totalPtsVal>0?'≈ $'+totalPtsVal.toFixed(2)+' est. · included in projected':''}</span></div>`;
    html+=progRows;
    html+=`<div style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);text-align:center;margin-top:8px;padding-bottom:8px">Estimates only · edit ¢/pt to adjust</div>`;
  }
  set(html);
}

// ── Priority queue ─────────────────────────────────────────────────────────
// Full benefit amount minus whatever's already been logged as partially
// used, so "unclaimed" views (digest, priority queue) show what's actually
// still available rather than the full total regardless of progress.
function getRemainingAmt(cardKey,b,p,pk){
  const full=getBAmount(b,p);
  if(!b.partial) return full;
  return Math.max(0,full-getPartialUsed(cardKey,b.id,pk));
}

function buildPriorityQueue(){
  const eomDays=daysUntilEOM();
  const items=[];
  (state.userCards||[]).filter(k=>CARDS[k]).forEach(cardKey=>{
    const card=CARDS[cardKey];
    card.sections.forEach(s=>{
      const pk=getCurrentPK(cardKey,s.cadence);
      const p={calY:CY,calM:CM,m:CM};
      s.benefits.forEach(b=>{
        if(isBExpired(b,p)||isBNotAvailable(b,CY,p)) return;
        if(isUsed(cardKey,b.id,pk)) return;
        if(isSkipped(cardKey,b.id,pk)) return;
        if(isGloballySnoozed(cardKey,b.id)) return;
        const amt=getRemainingAmt(cardKey,b,{m:CM},pk);
        let urgency=0,urgencyLabel='Anytime',urgencyCls='urgency-ok',tier=1;
        if(s.cadence==='monthly'){
          urgency=40+(1-eomDays/31)*55;
          urgencyLabel=eomDays<=7?'Expires soon':'This month';
          urgencyCls=eomDays<=7?'urgency-fire':'urgency-soon';
          tier=3;
        } else if(s.cadence==='quarterly'){
          const dayOfQ=(CM%3)*30+new Date().getDate();
          urgency=20+(dayOfQ/92)*40;
          urgencyLabel='This quarter';
          urgencyCls=urgency>50?'urgency-soon':'urgency-ok';
          tier=2;
        } else if(s.cadence==='cal-semi-annual'||s.cadence==='semi-annual'){
          const dayOfH=(CM%6)*30+new Date().getDate();
          urgency=20+(dayOfH/182)*40;
          urgencyLabel='This half';
          urgencyCls=urgency>50?'urgency-soon':'urgency-ok';
          tier=2;
        } else if(s.cadence==='annual'){
          urgency=10; urgencyLabel='This card year'; tier=1;
        } else if(s.cadence==='cal-annual'||s.cadence==='cal-annual-overlap'){
          urgency=10; urgencyLabel='This calendar year'; tier=1;
        } else if(s.cadence==='feb-annual'){
          urgency=10; urgencyLabel='This travel year'; tier=1;
        } else { urgency=10; urgencyLabel='This period'; tier=1; }
        const score=tier*1000+urgency*Math.log(amt+1);
        items.push({cardKey,benefitId:b.id,pk,name:bName(cardKey,b),card:CARD_LABELS[cardKey],amt,urgency,urgencyLabel,urgencyCls,score,cadence:s.cadence});
      });
    });
  });
  return items.sort((a,b)=>b.score-a.score);
}

// ── Render: this period ────────────────────────────────────────────────────
export function renderCurrent(){
  const card=CARDS[state.activeCard];
  const offset=state._periodOffset||0;
  const absMonth=CY*12+CM+offset;
  const viewY=Math.floor(absMonth/12);
  const viewM=absMonth%12;
  const isHistory=offset<0;
  const monthPK=`${viewY}-m${viewM}`;

  let totalNow=0,usedNow=0;
  card.sections.forEach(s=>{ if(s.cadence!=='monthly') return; s.benefits.forEach(b=>{ if(isBExpired(b,{calY:viewY,calM:viewM,m:viewM})||isBNotAvailable(b,viewY)||isGloballySnoozed(state.activeCard,b.id)) return; totalNow+=getBAmount(b,{m:viewM}); if(isUsed(state.activeCard,b.id,monthPK)) usedNow+=getBAmount(b,{m:viewM}); }); });
  const pct=totalNow>0?Math.round(usedNow/totalNow*100):0;
  const {captured}=calcStats(state.activeCard,c=>getCardYearPeriods(state.activeCard,c),isPCurrent);
  const effectiveFee=getFee(state.activeCard,CY)-captured;

  let html='';
  if(isHistory) html+=`<div style="background:rgba(200,146,42,0.08);border:1px solid rgba(200,146,42,0.2);border-radius:6px;padding:5px 10px;font-size:11px;font-family:var(--mono);color:var(--gold);margin-bottom:8px;display:flex;align-items:center;justify-content:space-between"><span>${MONTHS_FULL[viewM]} ${viewY}</span><button onclick="window.setPeriodOffset(0)" style="background:none;border:none;cursor:pointer;font-size:11px;font-family:var(--mono);color:var(--gold);padding:0;text-decoration:underline">current</button></div>`;

  if(!isHistory){
    html+=buildCountdownStrip(state.activeCard);
    html+=buildEOMWarning(state.activeCard);
    html+=buildBreakevenBar(state.activeCard);
  }
  html+=metricsHTML(isHistory?`${MONTHS_FULL[viewM]}`:'This month',`$${totalNow.toFixed(0)}`,'Claimed',`$${usedNow.toFixed(0)}`,'This card year',`$${captured.toFixed(0)}`,'Effective fee',`${effectiveFee<=0?'<span style="color:var(--green)">$'+Math.abs(effectiveFee).toFixed(0)+' profit!</span>':'$'+effectiveFee.toFixed(0)}`);
  if(totalNow>0) html+=progressHTML(pct,'',`${MONTHS_FULL[viewM]} ${viewY}: $${usedNow.toFixed(0)} of $${totalNow.toFixed(0)} claimed`);
  if(!isHistory) html+=`<div class="period-note">Use it now — <strong>${MONTHS_FULL[CM]} ${CY}</strong></div>`;

  const CADENCE_THIS={'monthly':'This month','quarterly':'This quarter','semi-annual':'This half','cal-semi-annual':'This half','annual':'This card year','cal-annual':'This year','cal-annual-overlap':'This year','feb-annual':'This year'};
  card.sections.forEach(s=>{
    const isMonthly=s.cadence==='monthly';
    const pk=isMonthly?monthPK:getCurrentPK(state.activeCard,s.cadence);
    const lbl=isMonthly?`${MONTHS_FULL[viewM]} ${viewY}`:getCurrentLabel(state.activeCard,s.cadence);
    const pY=isMonthly?viewY:CY,pM=isMonthly?viewM:CM;
    const currentP={calY:pY,calM:pM,m:pM};
    const visibleBenefits=s.benefits.filter(b=>!isBExpired(b,currentP)&&!isBNotAvailable(b,pY,currentP));
    if(!visibleBenefits.length) return;
    if(isHistory&&!isMonthly) return; // in history mode, only show monthly section
    const allClaimed=visibleBenefits.every(b=>isUsed(state.activeCard,b.id,pk));
    const claimedCount=visibleBenefits.filter(b=>isUsed(state.activeCard,b.id,pk)).length;
    const sectionKey=`current-${state.activeCard}-${s.cadence}`;
    if(!allClaimed) state._userExpandedSections.delete(sectionKey);
    const isAutoCollapsed=allClaimed&&!state._userExpandedSections.has(sectionKey);
    const isCollapsed=isAutoCollapsed||state._collapsedCurrentSections.has(sectionKey);
    const indicator=allClaimed&&isCollapsed?`<span style="color:var(--green);font-size:12px">✓</span>`:allClaimed?`<span style="color:var(--green);font-size:12px">✓</span>`:`<span style="font-size:13px;color:var(--text-tertiary);display:inline-block;transform:rotate(${isCollapsed?'-90deg':'0deg'});transition:transform 0.2s">▾</span>`;
    const countBadge=allClaimed?`<span style="font-size:10px;font-family:var(--mono);color:var(--green);background:rgba(42,155,106,0.1);padding:1px 7px;border-radius:100px">${claimedCount}/${visibleBenefits.length} ✓</span>`:`<span style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);background:var(--border-light);padding:1px 7px;border-radius:100px">${claimedCount}/${visibleBenefits.length}</span>`;
    const sectionTitle=isMonthly&&isHistory?`${MONTHS_FULL[viewM]} ${viewY}`:(CADENCE_THIS[s.cadence]||s.label);
    html+=`<div class="section-header collapsible-header" data-section-key="${sectionKey}" data-all-claimed="${allClaimed}" style="cursor:pointer;user-select:none">
      <div style="display:flex;align-items:center;gap:8px">${indicator}<span class="section-title" style="color:${allClaimed?'var(--text-tertiary)':''}">${sectionTitle}</span>${countBadge}</div>
      <span class="section-period">${lbl}</span>
    </div>`;
    if(!isCollapsed){
      visibleBenefits.forEach(b=>{
        const used=isUsed(state.activeCard,b.id,pk);
        const credited=isCredited(state.activeCard,b.id,pk);
        const snoozed=isGloballySnoozed(state.activeCard,b.id);
        const snoozedUntil=getSnoozedUntil(state.activeCard,b.id);
        const streak=s.cadence==='monthly'?getStreak(state.activeCard,b.id):0;
        const streakBadge=streak>=2?`<span class="streak-badge">${streak} mo streak</span>`:'';
        const expiryBadge=getExpiryBadge(b)+getBenefitExpiryLabel(b);
        const catTag='';
        const effectiveAmt=getEffectiveAmount(state.activeCard,b.id,getBAmount(b,{m:viewM}));
        const dispAmt=b.note&&b.amount===0?b.note:`$${effectiveAmt}`;
        const note=getNote(state.activeCard,b.id,pk);
        const periodLabel=isMonthly?`${MONTHS_FULL[viewM]} ${viewY}`:lbl;
        const noteHTML=note?`<button type="button" class="benefit-note" data-id="${b.id}" data-pk="${pk}" data-name="${bName(state.activeCard,b)}" data-period="${periodLabel}"><span class="note-dot"></span>${escapeHtml(note)}</button>`:`<button type="button" class="add-note" data-id="${b.id}" data-pk="${pk}" data-name="${bName(state.activeCard,b)}" data-period="${periodLabel}">+ add note</button>`;
        // Always show the partial bar for partial-eligible benefits, not just
        // once fully used -- otherwise logging an amount below the total
        // hides the input the moment it drops below 100%, with no way back
        // to it short of re-checking the box (which re-marks it fully used).
        const partialHTML=b.partial?buildPartialBar(state.activeCard,b.id,pk,effectiveAmt):'';
        const creditedHTML=used?`<div style="margin-top:4px;font-size:10px;font-family:var(--mono)"><button type="button" class="linkish" style="color:${credited?'var(--green)':'var(--text-tertiary)'}" data-credit-id="${b.id}" data-credit-pk="${pk}" aria-pressed="${credited?'true':'false'}">${credited?'✓ Credit posted':'○ Credit pending'}</button></div>`:'';
        const snoozedBadge=snoozed?`<span style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);margin-top:3px;display:block">⏸︎ snoozed until ${snoozedUntil} · <button type="button" class="linkish" style="text-decoration:underline" data-unsnooze="${b.id}" data-unsnooze-card="${state.activeCard}">resume</button></span>`:'';
        const snoozeBtn=!snoozed?`<button class="snooze-btn" data-snooze-id="${b.id}" data-snooze-card="${state.activeCard}" data-snooze-name="${bName(state.activeCard,b)}" title="Snooze this benefit — hide from all calculations until a chosen month" style="background:none;border:none;cursor:pointer;font-size:12px;padding:6px 8px;color:var(--text-secondary);opacity:0.55;transition:opacity 0.15s;line-height:1;border-radius:3px;flex-shrink:0" aria-label="Snooze benefit">⏸︎</button>`:'';
        html+=`<div class="benefit-row${used?' used':''}${snoozed?' snoozed-row':''}" style="${snoozed?'opacity:0.45;':''}">
          <div style="flex:1">
            <div class="benefit-name">${bName(state.activeCard,b)}${catTag}${streakBadge}${expiryBadge}</div>
            <div class="benefit-desc">${b.desc}</div>
            ${snoozedBadge}${!snoozed?noteHTML:''}${partialHTML}${creditedHTML}
          </div>
          <div style="display:flex;align-items:center;gap:4px">${snoozeBtn}<div class="benefit-amt">${dispAmt}</div></div>
          <button class="check-btn${used?' checked':''}" data-id="${b.id}" data-pk="${pk}" aria-pressed="${used?'true':'false'}" aria-label="${used?'Mark unused':'Mark used'}: ${escapeHtml(bName(state.activeCard,b))}"></button>
        </div>`;
      });
    }
  });

  set(html, ()=>{
    document.querySelectorAll('.benefit-note,.add-note').forEach(el=>el.addEventListener('click',()=>{
      window.openNoteModal(state.activeCard,el.dataset.id,el.dataset.pk,el.dataset.name,el.dataset.period);
    }));
    document.querySelectorAll('.partial-input').forEach(inp=>inp.addEventListener('change',()=>{
      const amt=Math.min(parseFloat(inp.value)||0,parseFloat(inp.dataset.total));
      window.setPartialUsed(inp.dataset.card,inp.dataset.id,inp.dataset.pk,amt);
      renderCurrent();
    }));
    document.querySelectorAll('[data-credit-id]').forEach(el=>el.addEventListener('click',()=>{
      toggleCredited(state.activeCard,el.dataset.creditId,el.dataset.creditPk);
      renderCurrent();
    }));
  });
}

// ── Render: history / summary base ────────────────────────────────────────
export function renderHistBase(getPsFn,isCurFn,bannerHTML){
  const card=CARDS[state.activeCard];
  let html=bannerHTML+`<div class="legend"><span class="legend-item"><span class="dot dot-used" style="width:13px;height:13px"></span>Used</span><span class="legend-item"><span class="dot dot-missed" style="width:13px;height:13px"></span>Missed</span><span class="legend-item"><span class="dot dot-current" style="width:13px;height:13px"></span>Current</span><span class="legend-item"><span class="dot dot-future" style="width:13px;height:13px"></span>Future</span></div><div class="period-note">Click any past or current dot to toggle used / missed.</div>`;
  card.sections.forEach(s=>{
    const ps=getPsFn(s.cadence);
    const visibleBenefits=s.benefits.filter(b=>!isGloballySnoozed(state.activeCard,b.id)&&ps.some(p=>!isBExpired(b,p)&&!isBNotAvailable(b,0,p)));
    if(!visibleBenefits.length) return;
    html+=`<div class="section-header"><span class="section-title">${s.label} benefits</span></div>`;
    visibleBenefits.forEach(b=>{
      html+=`<div class="hist-row"><div><div class="hist-name">${bName(state.activeCard,b)}</div><div class="hist-sub">${b.decAmount?`$${b.amount}/mo · $${b.decAmount} Dec`:`$${b.amount}/${s.cadence==='semi-annual'||s.cadence==='cal-semi-annual'?'half':s.cadence==='monthly'?'mo':s.cadence==='quarterly'?'qtr':'yr'}`}</div></div><div class="dots-row">`;
      ps.forEach(p=>{
        if(isBExpired(b,p)||isBNotAvailable(b,0,p)) return;
        const fut=isPFuture(p),cur=isCurFn(s.cadence,p),used=isUsed(state.activeCard,b.id,p.pk);
        const cls=fut?'dot-future':used?'dot-used':cur?'dot-current':'dot-missed';
        const clickable=!fut;
        const title=fut?`${p.lbl}: upcoming`:used?`${p.lbl}: used — click to unmark`:`${p.lbl}: ${cur?'not yet used':'missed'} — click to mark used`;
        html+=`<button class="dot-btn${clickable?'':' no-click'}" data-id="${b.id}" data-pk="${p.pk}" data-c="${clickable}" title="${title}"><span class="dot ${cls}"></span><span class="dot-lbl">${p.lbl}</span></button>`;
      });
      html+=`</div></div>`;
    });
  });
  set(html);
}

export function renderSummBase(getPsFn,isCurFn,bannerHTML,label){
  const card=CARDS[state.activeCard];
  const {captured,missed,total}=calcStats(state.activeCard,getPsFn,isCurFn);
  const fee=getFee(state.activeCard,state.selectedYear);
  const remaining=total-captured-missed;
  const effectiveFee=fee-captured;
  const feePct=fee>0?Math.min(100,Math.round(captured/fee*100)):0;
  const totalPct=total>0?Math.round(captured/total*100):0;
  let html=bannerHTML;
  html+=buildDonut(captured,missed,Math.max(0,remaining));
  html+=metricsHTML(`Total ${label} value`,`$${total.toFixed(0)}`,'Captured',`$${captured.toFixed(0)}`,'Missed',`$${missed.toFixed(0)}`,'Effective fee',`${effectiveFee<=0?'<span style="color:var(--green)">$'+Math.abs(effectiveFee).toFixed(0)+' profit!</span>':'$'+effectiveFee.toFixed(0)}`);
  html+=`<div class="progress-wrap">
    <div style="display:flex;justify-content:space-between;font-size:10px;font-family:var(--mono);color:var(--text-tertiary);margin-bottom:4px"><span>Fee coverage</span><span>${feePct}% of $${fee} fee</span></div>
    <div class="progress-track" style="margin-bottom:8px"><div class="progress-fill" style="width:${feePct}%;background:${effectiveFee<=0?'var(--green)':'var(--gold)'}"></div></div>
    <div style="display:flex;justify-content:space-between;font-size:10px;font-family:var(--mono);color:var(--text-tertiary);margin-bottom:4px"><span>Benefit capture rate</span><span>${totalPct}% of $${total.toFixed(0)} available</span></div>
    <div class="progress-track"><div class="progress-fill" style="width:${totalPct}%"></div></div>
  </div>`;
  html+=`<div class="summary-table">`;
  card.sections.forEach(s=>{
    s.benefits.forEach(b=>{
      const ps=getPsFn(s.cadence);
      if(!ps.some(p=>!isBExpired(b,p)&&!isBNotAvailable(b,0,p))) return;
      const snoozed=isGloballySnoozed(state.activeCard,b.id);
      const snoozedUntil=getSnoozedUntil(state.activeCard,b.id);
      const cadLbl=s.cadence==='semi-annual'||s.cadence==='cal-semi-annual'?'half':s.cadence==='monthly'?'mo':s.cadence==='quarterly'?'qtr':'yr';
      const amtLbl=b.decAmount?`$${b.amount}–$${b.decAmount}/mo`:`$${b.amount}/${cadLbl}`;
      const expiredTag=b.expiresAfter?`<span style="font-size:10px;color:var(--red);margin-left:4px">ends ${b.expiresAfter.h===0?'Jun':'Dec'} ${b.expiresAfter.y}</span>`:'';
      if(snoozed){
        html+=`<div class="summary-row-item" style="opacity:0.45"><div><span class="summary-item-name">${bName(state.activeCard,b)}</span>${expiredTag}<span class="summary-item-cadence">${amtLbl}</span><span style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);margin-left:6px">⏸︎ until ${snoozedUntil} · <button type="button" class="linkish" style="text-decoration:underline" data-unsnooze="${b.id}" data-unsnooze-card="${state.activeCard}">resume</button></span></div></div>`;
        return;
      }
      let bc=0,bm=0,bl=0;
      ps.forEach(p=>{
        if(isBExpired(b,p)||isBNotAvailable(b,0,p)) return;
        const fut=isPFuture(p),cur=isCurFn(s.cadence,p),used=isUsed(state.activeCard,b.id,p.pk),amt=getBAmount(b,p);
        if(used) bc+=amt; else if(!fut&&!cur) bm+=amt; else bl+=amt;
      });
      const snoozeBtn=`<button class="snooze-btn" data-snooze-id="${b.id}" data-snooze-card="${state.activeCard}" data-snooze-name="${bName(state.activeCard,b)}" title="Snooze this benefit" style="background:none;border:none;cursor:pointer;font-size:11px;padding:6px 8px;color:var(--text-secondary);opacity:0.55;transition:opacity 0.15s;line-height:1;border-radius:3px;flex-shrink:0" aria-label="Snooze benefit">⏸︎</button>`;
      html+=`<div class="summary-row-item"><div><span class="summary-item-name">${bName(state.activeCard,b)}</span>${expiredTag}<span class="summary-item-cadence">${amtLbl}</span></div><div class="badges" style="display:flex;align-items:center;gap:4px">${bc>0?`<span class="badge-captured">+$${bc.toFixed(0)}</span>`:''}${bm>0?`<span class="badge-missed">−$${bm.toFixed(0)} missed</span>`:''}${bl>0?`<span class="badge-left">$${bl.toFixed(0)} left</span>`:''}${snoozeBtn}</div></div>`;
    });
  });
  html+=`</div>`;
  set(html);
}

// ── Render: all cards ──────────────────────────────────────────────────────
export function renderAllCards(){
  const CARD_KEYS=getVisibleCardKeys();
  const CADENCE_ORDER=['monthly','quarterly','cal-semi-annual','semi-annual','feb-annual','cal-annual','cal-annual-overlap','annual'];
  const CADENCE_LABELS={
    'monthly':`Monthly — ${MONTHS_FULL[CM]} ${CY}`,
    'quarterly':`Quarterly — Q${Math.floor(CM/3)+1} ${CY}`,
    'cal-semi-annual':CM<6?`Semi-annual — Jan–Jun ${CY}`:`Semi-annual — Jul–Dec ${CY}`,
    'semi-annual':'Semi-annual (card-year)',
    'feb-annual':`Annual — Feb ${CM>=1?CY:CY-1}–Jan ${CM>=1?CY+1:CY}`,
    'cal-annual':`Annual — ${CY}`,
    'cal-annual-overlap':`Annual — ${CY}`,
    'annual':'Annual (card-year)',
  };
  const byPeriod={},byPeriodTotal={};
  CADENCE_ORDER.forEach(c=>{ byPeriod[c]=[]; byPeriodTotal[c]=0; });
  let grandTotal=0;
  CARD_KEYS.forEach(cardKey=>{
    CARDS[cardKey].sections.forEach(s=>{
      const pk=getCurrentPK(cardKey,s.cadence);
      s.benefits.forEach(b=>{
        if(isBExpired(b,{calY:CY,calM:CM,m:CM})||isBNotAvailable(b,CY,{calM:CM,calY:CY})||isGloballySnoozed(cardKey,b.id)) return;
        byPeriodTotal[s.cadence]=(byPeriodTotal[s.cadence]||0)+1;
        const used=isUsed(cardKey,b.id,pk);
        if(!used){
          const amt=getBAmount(b,{m:CM});
          byPeriod[s.cadence].push({cardKey,cardLabel:CARD_LABELS[cardKey],cardCls:CARD_CLS[cardKey],name:bName(cardKey,b),amt});
          grandTotal+=amt;
        }
      });
    });
  });
  let html='';
  html+=buildAllCardsSummary();
  html+=buildLiveBanner();
  html+=`<div class="grand-total-row" style="margin-top:0;margin-bottom:16px"><span class="grand-total-label">Total available to collect</span><span class="grand-total-amt">$${grandTotal.toFixed(0)}</span></div>`;
  let anyShown=false;
  CADENCE_ORDER.forEach(cadence=>{
    const items=byPeriod[cadence]||[];
    const totalCount=byPeriodTotal[cadence]||0;
    if(totalCount===0) return;
    anyShown=true;
    const allClaimed=items.length===0;
    const periodTotal=items.reduce((s,i)=>s+i.amt,0);
    const isCollapsed=state._collapsedSections.has(cadence);
    const indicator=allClaimed?`<span style="color:var(--green);font-size:12px;line-height:1">✓</span>`:`<span style="font-size:13px;color:var(--text-tertiary);display:inline-block;transform:rotate(${isCollapsed?'-90deg':'0deg'});transition:transform 0.2s">▾</span>`;
    const claimedCount=totalCount-items.length;
    html+=`<div class="all-cards-header collapsible-header" data-cadence="${cadence}" style="cursor:pointer;user-select:none">
      <div style="display:flex;align-items:center;gap:8px">
        ${indicator}
        <span style="font-size:11px;font-weight:600;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.06em;color:${allClaimed?'var(--text-tertiary)':'var(--text-secondary)'}">${CADENCE_LABELS[cadence]||cadence}</span>
        <span style="font-size:10px;font-family:var(--mono);color:${allClaimed?'var(--green)':'var(--text-tertiary)'};background:${allClaimed?'rgba(42,155,106,0.1)':'var(--border-light)'};padding:1px 7px;border-radius:100px">${allClaimed?`${claimedCount}/${totalCount} ✓`:`${items.length} left`}</span>
      </div>
      <span class="all-cards-subtotal" style="color:${allClaimed?'var(--green)':''}">${allClaimed?'All claimed ✓':`$${periodTotal.toFixed(0)} left`}</span>
    </div>`;
    if(!allClaimed){
      const bodyId=`section-body-${cadence}`;
      html+=`<div id="${bodyId}" style="overflow:hidden;transition:max-height 0.25s ease,opacity 0.25s ease;max-height:${isCollapsed?'0':'2000px'};opacity:${isCollapsed?'0':'1'}">`;
      items.forEach(item=>{
        html+=`<div class="avail-row"><div><div class="avail-name">${item.name}</div><div class="avail-period"><span class="all-cards-card-name ${item.cardCls}" style="font-size:10px;text-transform:none;letter-spacing:0;font-weight:600">${item.cardLabel}</span></div></div><div class="avail-amt">$${item.amt.toFixed(0)}</div></div>`;
      });
      html+=`</div>`;
    }
  });
  if(!anyShown) html+=`<div style="text-align:center;padding:32px;color:var(--text-tertiary);font-size:13px">All visible card benefits claimed!</div>`;
  html+=`<div style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);text-align:center;margin-top:12px">Active periods only · switch to a card tab to mark benefits used</div>`;
  set(html);
}

// ── Heatmap HTML builder (shared by Insights and standalone view) ──────────
function buildHeatmapHTML(){
  const CARD_KEYS=getVisibleCardKeys();
  const isMobile=window.innerWidth<=600;
  let html='';
  if(!isMobile) html+=`<p style="font-size:11px;color:var(--text-tertiary);font-family:var(--mono);margin:0 0 10px">drag rows to reorder · double-click a month for details</p>`;
  else html+=`<p style="font-size:10px;color:var(--text-tertiary);font-family:var(--mono);margin:0 0 8px">double-tap a month cell for details</p>`;
  const CELL_W=isMobile?22:42,CELL_H=isMobile?26:36,LABEL_W=isMobile?48:88,TOTAL_W=isMobile?34:58;
  const GAP=3,totalW=LABEL_W+(CELL_W+GAP)*12+GAP+TOTAL_W;
  const wrapStyle=isMobile?`width:100%;box-sizing:border-box`:`overflow-x:auto;-webkit-overflow-scrolling:touch`;
  html+=`<div style="${wrapStyle}"><div style="min-width:${totalW}px">`;
  // header row
  html+=`<div style="display:flex;align-items:center;gap:${GAP}px;margin-bottom:3px">`;
  html+=`<div style="width:${LABEL_W}px;flex-shrink:0"></div>`;
  for(let m=0;m<12;m++) html+=`<div style="width:${CELL_W}px;flex-shrink:0;text-align:center;font-size:${isMobile?8:10}px;font-family:var(--mono);color:var(--text-tertiary);padding:4px 0">${isMobile?MONTHS[m].slice(0,1):MONTHS[m]}</div>`;
  html+=`<div style="width:${TOTAL_W}px;flex-shrink:0;text-align:center;font-size:${isMobile?8:10}px;font-family:var(--mono);color:var(--text-tertiary);padding:4px 0;border-left:1px solid var(--border);margin-left:${GAP}px">Total</div>`;
  html+=`</div>`;
  window._heatmapMonthDetails={};
  CARD_KEYS.forEach(cardKey=>{
    const card=CARDS[cardKey];
    const {year:fy,month:fm}=getCardYearStart(cardKey,CY);
    const monthData=Array.from({length:12},()=>({total:0,claimed:0,items:[]}));
    card.sections.forEach(s=>{
      const cadence=s.cadence||'monthly';
      const addAmt=(displayM,b,pk)=>{
        if(isMonthSnoozed(cardKey,b.id,CY,displayM)) return;
        const amt=b.amount||0;
        const used=isUsed(cardKey,b.id,pk);
        // for redeemed benefits, place at actual redemption month if known
        const rdEntry=used?state.redemptionDates[`${cardKey}__${b.id}__${pk}`]:null;
        const rdMonth=(rdEntry&&rdEntry.year===CY)?rdEntry.month:displayM;
        monthData[rdMonth].total+=amt;
        if(used) monthData[rdMonth].claimed+=amt;
        monthData[rdMonth].items.push({name:bName(cardKey,b)||b.label||'Benefit',amount:amt,claimed:used,id:b.id,pk});
      };
      if(cadence==='monthly'){
        for(let m=0;m<12;m++){ const pk=`${CY}-m${m}`; s.benefits.forEach(b=>{ if(isBNotAvailable(b,CY)||isBExpired(b,{calY:CY,calM:m,m})) return; addAmt(m,b,pk); }); }
      } else if(cadence==='quarterly'){
        [[2,0],[5,1],[8,2],[11,3]].forEach(([displayM,q])=>{ const pk=`${CY}-q${q}`; s.benefits.forEach(b=>{ if(isBNotAvailable(b,CY)) return; addAmt(displayM,b,pk); }); });
      } else if(cadence==='cal-semi-annual'){
        [[5,0],[11,1]].forEach(([displayM,h])=>{ const pk=`${CY}-h${h}`; s.benefits.forEach(b=>{ if(isBNotAvailable(b,CY)||(b.halfStart!==undefined&&h<b.halfStart)||(b.halfEnd!==undefined&&h>b.halfEnd)) return; addAmt(displayM,b,pk); }); });
      } else if(cadence==='semi-annual'){
        const pkH1=`cy-${fy}-${fm}-h1`,pkH2=`cy-${fy}-${fm}-h2`;
        s.benefits.forEach(b=>{ if(isBNotAvailable(b,CY)) return; addAmt(5,b,pkH1); addAmt(11,b,pkH2); });
      } else if(cadence==='annual'){
        const pk=`cy-${fy}-${fm}-annual`;
        s.benefits.forEach(b=>{ if(isBNotAvailable(b,CY)) return; addAmt(11,b,pk); });
      } else if(cadence==='cal-annual'||cadence==='cal-annual-overlap'){
        const pk=`${CY}-annual`;
        s.benefits.forEach(b=>{ if(isBNotAvailable(b,CY)) return; addAmt(11,b,pk); });
      } else if(cadence==='feb-annual'){
        const febY=CM>=1?CY:CY-1,pk=`feb-${febY}`;
        s.benefits.forEach(b=>{ if(isBNotAvailable(b,CY)) return; addAmt(11,b,pk); });
      }
    });
    // store detail data for all months that have claimed items (including future display months
    // where annual/semi-annual benefits land when not yet re-placed by a stored redemption date)
    for(let m=0;m<12;m++){
      if(m<=CM||monthData[m].claimed>0){
        window._heatmapMonthDetails[`${cardKey}_${m}`]={
          cardLabel:CARD_LABELS[cardKey],
          monthLabel:MONTHS[m],
          items:monthData[m].items,
          totalClaimed:monthData[m].claimed,
          totalAvailable:monthData[m].total
        };
      }
    }
    // each card is a row (draggable on desktop only)
    const rowAttrs=isMobile?'':`data-drag-card="${cardKey}" draggable="true"`;
    const rowCursor=isMobile?'':'cursor:grab;';
    html+=`<div ${rowAttrs} style="display:flex;align-items:center;gap:${GAP}px;margin-bottom:3px;${rowCursor}">`;
    const labelFontSize=isMobile?8:10;
    if(isMobile){
      html+=`<div style="width:${LABEL_W}px;flex-shrink:0;padding-right:2px;overflow:hidden"><span style="font-size:${labelFontSize}px;font-family:var(--mono);color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block">${CARD_SHORT_LABELS[cardKey]||CARD_LABELS[cardKey].split(' ')[0]}</span></div>`;
    } else {
      html+=`<div style="width:${LABEL_W}px;flex-shrink:0;display:flex;align-items:center;gap:4px;padding-right:4px"><span class="drag-handle" style="font-size:14px;opacity:0.35;flex-shrink:0">⠿</span><span style="font-size:${labelFontSize}px;font-family:var(--mono);color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${CARD_LABELS[cardKey]}</span></div>`;
    }
    // sum claimed across all months — annual/semi-annual benefits may be placed at a future
    // display month even when already redeemed, so don't gate on isFut here
    const rowTotalClaimed=monthData.reduce((s,md)=>s+md.claimed,0);
    for(let m=0;m<12;m++){
      const isFut=m>CM,{total,claimed}=monthData[m];
      if(isFut){
        if(claimed>0){
          // future month with already-redeemed benefits (e.g. annual placed at Dec) — make it tappable to set date
          html+=`<div ondblclick="showHeatmapMonthDetail('${cardKey}',${m})" title="Double-click to set redemption date" style="width:${CELL_W}px;flex-shrink:0;height:${CELL_H}px;border-radius:4px;background:rgba(42,155,106,0.2);border:1px solid rgba(42,155,106,0.4);display:flex;align-items:center;justify-content:center;font-size:${labelFontSize}px;font-family:var(--mono);color:#2a9b6a;cursor:zoom-in">✓</div>`;
        } else {
          html+=`<div style="width:${CELL_W}px;flex-shrink:0;height:${CELL_H}px;border-radius:4px;background:var(--surface);display:flex;align-items:center;justify-content:center;font-size:${labelFontSize}px;color:var(--text-tertiary)">–</div>`;
        }
        continue;
      }
      if(total===0){ html+=`<div style="width:${CELL_W}px;flex-shrink:0;height:${CELL_H}px;border-radius:4px"></div>`; continue; }
      const rate=claimed/total,pct=Math.round(rate*100);
      const bg=rate===0?'var(--border-light)':rate<0.5?'rgba(220,60,60,0.6)':rate<0.9?'rgba(210,160,0,0.5)':rate<1?'rgba(210,160,0,0.85)':'#2a9b6a';
      const fg=rate>=1?'#fff':rate>0&&rate<0.5?'#fff':'var(--text)';
      html+=`<div ondblclick="showHeatmapMonthDetail('${cardKey}',${m})" title="Double-click for details" style="width:${CELL_W}px;flex-shrink:0;height:${CELL_H}px;border-radius:4px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:${labelFontSize}px;font-family:var(--mono);color:${fg};cursor:zoom-in">${pct}%</div>`;
    }
    // grand total cell
    const totalFmt=rowTotalClaimed>0?`$${rowTotalClaimed.toFixed(0)}`:'—';
    html+=`<div style="width:${TOTAL_W}px;flex-shrink:0;height:${CELL_H}px;border-radius:4px;background:var(--surface);display:flex;align-items:center;justify-content:center;font-size:${labelFontSize}px;font-family:var(--mono);color:${rowTotalClaimed>0?'var(--green)':'var(--text-tertiary)'};border-left:1px solid var(--border);margin-left:${GAP}px">${totalFmt}</div>`;
    html+=`</div>`;
  });
  html+=`</div></div>`;
  html+=`<div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;font-size:10px;font-family:var(--mono);color:var(--text-tertiary)">
    <span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:var(--border-light);vertical-align:middle;margin-right:4px"></span>0%</span>
    <span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:rgba(220,60,60,0.55);vertical-align:middle;margin-right:4px"></span>1–49%</span>
    <span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:rgba(210,160,0,0.45);vertical-align:middle;margin-right:4px"></span>50–89%</span>
    <span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:rgba(210,160,0,0.75);vertical-align:middle;margin-right:4px"></span>90–99%</span>
    <span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:var(--green);vertical-align:middle;margin-right:4px"></span>100%</span>
  </div>`;
  return html;
}

// ── Render: heatmap ────────────────────────────────────────────────────────
export function renderHeatmap(){
  let html=`<div class="banner"><strong>Missed money heatmap</strong> — benefit capture rate by card</div>`;
  html+=buildHeatmapHTML();
  set(html);
}

// ── Render: performance (ROI + Trends combined) ───────────────────────────
export function renderPerformance(){
  const tab=state._performanceTab||'roi';
  const tabBtn=(key,label)=>`<button onclick="switchPerfTab('${key}')" style="padding:4px 16px;border-radius:20px;border:1px solid ${key===tab?'var(--blue)':'var(--border)'};background:${key===tab?'var(--blue)':'transparent'};color:${key===tab?'#fff':'var(--text-secondary)'};font-size:12px;font-family:var(--mono);cursor:pointer;transition:all 0.15s">${label}</button>`;
  const tabs=`<div style="display:flex;gap:6px;padding:0 0 14px">${tabBtn('roi','ROI Grades')}${tabBtn('trends','Trends')}</div>`;
  let html='';
  if(tab==='roi'){
    const CARD_KEYS=getVisibleCardKeys();
    html+=`<div class="banner"><strong>Card ROI scores</strong> — graded on annual fee coverage</div>`;
    html+=`<p style="font-size:11px;color:var(--text-tertiary);font-family:var(--mono);margin:0 0 10px">drag cards to reorder</p>`;
    html+=`<div class="comparison-grid">`;
    CARD_KEYS.forEach(cardKey=>{
      const fee=getFee(cardKey,CY);
      const {captured}=calcStats(cardKey,c=>getCardYearPeriods(cardKey,c),isPCurrent);
      const projected=getProjectedCapture(cardKey);
      const elapsed=getCardYearMonthsElapsed(cardKey);
      const grade=getROIGrade(fee,cardKey);
      const effectiveFee=fee-captured;
      const projGap=fee-projected;
      const verdict=projGap<=0?'→ Keep: in profit'
        :projGap<=250?`→ Keep: $${projGap.toFixed(0)} short of break-even`
        :projGap<=500?`→ Reconsider if habits don't improve`
        :`→ Consider canceling ($${projGap.toFixed(0)} gap)`;
      const verdictColor=projGap<=0?'var(--green)':projGap<=250?'var(--gold)':'var(--red)';
      const gradeDesc={A:`Projecting $${projected.toFixed(0)} — fully covering the $${fee} fee`,B:`Projecting $${projected.toFixed(0)} — $${projGap.toFixed(0)} short but within acceptable range`,C:`Projecting $${projected.toFixed(0)} — need to claim more benefits`,D:`Projecting $${projected.toFixed(0)} — well below the $${fee} fee`}[grade];
      html+=`<div class="comparison-card ${CARD_CLS[cardKey]}" data-drag-card="${cardKey}" draggable="true">
        <div class="drag-handle">⠿</div>
        <div class="comp-card-name">${CARD_LABELS[cardKey]}</div>
        <div class="roi-grade ${grade}">${grade}</div>
        <div class="roi-label">${effectiveFee<=0?'$'+Math.abs(effectiveFee).toFixed(0)+' profit so far':'$'+captured.toFixed(0)+' of $'+fee+' captured'}</div>
        <div class="roi-desc">${gradeDesc}</div>
        <div style="font-size:11px;font-family:var(--mono);font-weight:600;color:${verdictColor};margin:6px 0 2px">${verdict}</div>
        <div class="comp-divider"></div>
        <div style="font-size:11px;font-family:var(--mono);color:var(--text-tertiary)">Month ${elapsed} of 12 · $${projected.toFixed(0)} projected</div>
      </div>`;
    });
    html+=`</div>`;
  } else {
    const CARD_KEYS=getVisibleCardKeys();
    const years=[CY-1,CY];
    const yearRange=years.length>1?`${years[0]}–${years[years.length-1]}`:`${years[0]}`;
    html+=`<div class="banner"><strong>Multi-year trends</strong> — ${yearRange} comparison</div>`;
    function capturedForYear(cardKey,y){
      const card=CARDS[cardKey];
      const openedYear=state.cardMeta?.[cardKey]?.openedYear??card.openedYear;
      if(openedYear&&y<openedYear) return 0;
      let total=0;
      const lastMonth=y<CY?11:CM;
      card.sections.forEach(s=>{
        const periods=[];
        if(s.cadence==='monthly'){
          for(let m=0;m<=lastMonth;m++) periods.push({pk:`${y}-m${m}`,m,calY:y,calM:m});
        } else if(s.cadence==='quarterly'){
          const seen=new Set();
          for(let m=0;m<=lastMonth;m++){ const pk=`${y}-q${Math.floor(m/3)}`; if(!seen.has(pk)){seen.add(pk);periods.push({pk,m,calY:y,calM:m});} }
        } else if(s.cadence==='cal-semi-annual'){
          periods.push({pk:`${y}-h0`,m:0,calY:y,calM:0,endM:5,endY:y});
          if(lastMonth>=6) periods.push({pk:`${y}-h1`,m:6,calY:y,calM:6,endM:11,endY:y});
        } else if(s.cadence==='cal-annual'||s.cadence==='cal-annual-overlap'){
          periods.push({pk:`${y}-annual`,m:0,calY:y,calM:0});
        } else if(s.cadence==='semi-annual'){
          const fm=getCardFeeMonth(cardKey);
          periods.push({pk:`cy-${y}-${fm}-h1`,m:fm,calY:y,calM:fm,endM:(fm+5)%12,endY:fm+5>=12?y+1:y});
          periods.push({pk:`cy-${y}-${fm}-h2`,m:(fm+6)%12,calY:y,calM:(fm+6)%12,endM:(fm+11)%12,endY:fm+11>=12?y+1:y});
        } else if(s.cadence==='annual'){
          const fm=getCardFeeMonth(cardKey);
          periods.push({pk:`cy-${y}-${fm}-annual`,m:fm,calY:y,calM:fm});
        } else if(s.cadence==='feb-annual'){
          periods.push({pk:`feb-${y}`,m:1,calY:y,calM:1,endM:0,endY:y+1});
        }
        s.benefits.forEach(b=>{
          if(isBNotAvailable(b,y)) return;
          periods.forEach(p=>{
            if(isBExpired(b,p)) return;
            if(isUsed(cardKey,b.id,p.pk)) total+=getBAmount(b,p);
            else if(b.partial){ const partial=getPartialUsed(cardKey,b.id,p.pk); if(partial>0) total+=partial; }
          });
        });
      });
      return total;
    }
    html+=`<p style="font-size:11px;color:var(--text-tertiary);font-family:var(--mono);margin:0 0 10px">drag cards to reorder</p>`;
    CARD_KEYS.forEach(cardKey=>{
      html+=`<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:10px;cursor:grab" data-drag-card="${cardKey}" draggable="true">`;
      html+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span class="drag-handle" style="font-size:16px">⠿</span><span style="font-size:11px;font-family:var(--mono);color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.06em">${CARD_LABELS[cardKey]}</span></div>`;
      const vals=years.map(y=>({y,captured:capturedForYear(cardKey,y),fee:getFee(cardKey,y)}));
      vals.forEach(({y,captured,fee})=>{
        const barPct=Math.min(100,Math.round(captured/fee*100));
        const isCurrent=y===CY,profit=captured-fee;
        const label=isCurrent?`${y} YTD`:String(y);
        html+=`<div class="trend-row"><div class="trend-year" style="color:${isCurrent?'var(--text)':'var(--text-tertiary)'}">${label}</div><div style="flex:1;position:relative"><div class="trend-bar-wrap"><div class="trend-bar-fill" style="width:${barPct}%;background:${captured>fee?'var(--blue)':captured>=fee?'var(--green)':'var(--gold)'}"></div></div></div><div class="trend-val" style="color:${profit>0?'var(--blue)':profit===0?'var(--green)':'var(--text-secondary)'}">$${captured.toFixed(0)}<span style="font-size:9px;color:var(--text-tertiary)"> / $${fee}</span></div></div>`;
      });
      html+=`</div>`;
    });
  }
  set(tabs+html);
}


// ── Render: comparison ─────────────────────────────────────────────────────
export function renderComparison(){
  const CARD_KEYS=getVisibleCardKeys();
  let html=`<div class="banner"><strong>All cards compared</strong> — current card-year performance</div>`;
  html+=`<p style="font-size:11px;color:var(--text-tertiary);font-family:var(--mono);margin:0 0 10px">drag cards to reorder</p>`;
  html+=`<div class="comparison-grid">`;
  CARD_KEYS.forEach(cardKey=>{
    const fee=getFee(cardKey,CY);
    const mxVal=maxCardYearValue(cardKey);
    const {captured,missed}=calcStats(cardKey,c=>getCardYearPeriods(cardKey,c),isPCurrent);
    const projected=getProjectedCapture(cardKey);
    const elapsed=getCardYearMonthsElapsed(cardKey);
    const projectedFee=fee-projected;
    const days=daysUntilFee(cardKey);
    html+=`<div class="comparison-card ${CARD_CLS[cardKey]}" data-drag-card="${cardKey}" draggable="true">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span class="drag-handle" style="font-size:14px">⠿</span><div class="comp-card-name" style="margin:0">${CARD_LABELS[cardKey]}</div></div>
      <div class="comp-metric"><div class="comp-metric-val green">$${captured.toFixed(0)}</div><div class="comp-metric-label">captured (mo ${elapsed})</div></div>
      <div class="comp-metric"><div class="comp-metric-val ${projectedFee<=0?'green':''}">$${projected.toFixed(0)}</div><div class="comp-metric-label">projected year-end</div></div>
      <div class="comp-divider"></div>
      <div class="comp-metric"><div class="comp-metric-val ${projectedFee<=0?'green':''}">${projectedFee<=0?'+$'+Math.abs(projectedFee).toFixed(0):'$'+projectedFee.toFixed(0)}</div><div class="comp-metric-label">${projectedFee<=0?'projected profit':'projected vs $'+fee+' fee'}</div></div>
      <div class="comp-metric"><div class="comp-metric-val red">$${missed.toFixed(0)}</div><div class="comp-metric-label">missed so far</div></div>
      <div class="comp-progress"><div class="comp-progress-fill" style="width:${Math.min(100,projected/fee*100).toFixed(0)}%"></div></div>
      <div style="font-size:10px;color:var(--text-tertiary);font-family:var(--mono);margin-top:6px">${Math.round(projected/fee*100)}% of fee on pace · ${days}d to renewal</div>
    </div>`;
  });
  html+=`</div>`;
  set(html);
}

// ── Render: recap ──────────────────────────────────────────────────────────
export function renderRecap(){
  const year=state.selectedYear;
  // For prior years, only include cards that had actual activity — filters out cards added after that year
  const allKeys=getVisibleCardKeys();
  const CARD_KEYS=year<CY?allKeys.filter(k=>{
    const s=state.selectedYear; state.selectedYear=year;
    const {captured}=calcStats(k,c=>getYTDPeriods(c),isYTDCurrent);
    state.selectedYear=s;
    return captured>0||getPointsRedeemedYTD(k,year)>0;
  }):allKeys;
  let totalCaptured=0,totalMissed=0,totalFees=0;
  let bestCard={key:'',captured:0},worstCard={key:'',missed:0};
  let biggestMiss={name:'',amt:0,card:''};
  let topBenefit={name:'',amt:0,card:''};
  let longestStreak={name:'',streak:0,card:''},longestStreakCount=0;
  CARD_KEYS.forEach(cardKey=>{
    const fee=getFee(cardKey,year);
    totalFees+=fee;
    const savedYear=state.selectedYear;
    state.selectedYear=year;
    const {captured,missed}=calcStats(cardKey,c=>getYTDPeriods(c),isYTDCurrent);
    state.selectedYear=savedYear;
    totalCaptured+=captured;
    totalMissed+=missed;
    if(captured>bestCard.captured) bestCard={key:cardKey,captured};
    if(missed>worstCard.missed) worstCard={key:cardKey,missed};
    const savedYear2=state.selectedYear; state.selectedYear=year;
    CARDS[cardKey].sections.forEach(s=>{
      s.benefits.forEach(b=>{
        if(isBNotAvailable(b,year)) return;
        const periods=getYTDPeriods(s.cadence);
        let bMissed=0,bCaptured=0;
        periods.forEach(p=>{ if(isPFuture(p)) return; const amt=getBAmount(b,p); if(isUsed(cardKey,b.id,p.pk)) bCaptured+=amt; else if(!isYTDCurrent(s.cadence,p)) bMissed+=amt; });
        if(bMissed>biggestMiss.amt) biggestMiss={name:bName(cardKey,b),amt:bMissed,card:CARD_LABELS[cardKey]};
        if(bCaptured>topBenefit.amt) topBenefit={name:bName(cardKey,b),amt:bCaptured,card:CARD_LABELS[cardKey]};
      });
    });
    state.selectedYear=savedYear2;
    CARDS[cardKey].sections.forEach(s=>{
      if(s.cadence!=='monthly') return;
      s.benefits.forEach(b=>{
        if(isBNotAvailable(b,year)) return;
        const streak=getStreak(cardKey,b.id);
        if(streak>longestStreak.streak){ longestStreak={name:bName(cardKey,b),streak,card:CARD_LABELS[cardKey]}; longestStreakCount=1; }
        else if(streak===longestStreak.streak&&streak>0) longestStreakCount++;
      });
    });
  });
  const totalRedeemed=getAllPointsRedeemedYTD(year);
  const totalValueAllIn=totalCaptured+totalRedeemed;
  const effectiveFees=totalFees-totalValueAllIn;
  const feeCoverageRate=totalFees>0?Math.min(100,Math.round(totalValueAllIn/totalFees*100)):0;
  const recapYearBtns=[CY-1,CY].map(y=>`<button onclick="setSelectedYear(${y});renderRecap()" style="padding:3px 12px;border-radius:20px;border:1px solid ${y===year?'rgba(255,255,255,0.5)':'rgba(255,255,255,0.2)'};background:${y===year?'rgba(255,255,255,0.2)':'transparent'};color:${y===year?'#fff':'rgba(255,255,255,0.5)'};font-size:11px;font-family:var(--mono);cursor:pointer;transition:all 0.15s">${y===CY?y+' YTD':y}</button>`).join('');
  let html=`
    <div class="recap-hero">
      <div style="display:flex;justify-content:center;gap:6px;margin-bottom:14px">${recapYearBtns}</div>
      <div class="recap-year">${year===CY?year+' YTD':year} Annual Recap · Perks Ledger</div>
      <div class="recap-total">$${totalValueAllIn.toFixed(0)}</div>
      <div class="recap-total-label">total value extracted across all cards${totalRedeemed>0?` · $${totalCaptured.toFixed(0)} benefits + $${totalRedeemed.toFixed(0)} redeemed`:''}</div>
    </div>
    <div class="recap-grid">
      <div class="recap-stat"><div class="recap-stat-val ${feeCoverageRate>=100?'green':feeCoverageRate>=80?'gold':''}">${feeCoverageRate}%</div><div class="recap-stat-label">Fee coverage</div></div>
      <div class="recap-stat"><div class="recap-stat-val">$${totalFees}</div><div class="recap-stat-label">Total fees paid</div></div>
      <div class="recap-stat" style="grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;text-align:left;padding:12px 18px"><div class="recap-stat-label">${effectiveFees<=0?'Net profit':'Effective fees'}</div><div class="recap-stat-val ${effectiveFees<=0?'green':''}">${effectiveFees<=0?'+$'+Math.abs(effectiveFees).toFixed(0):'$'+effectiveFees.toFixed(0)}</div></div>
    </div>`;
  if(bestCard.key) html+=`<div class="recap-highlight"><div class="recap-highlight-icon">#1</div><div><div class="recap-highlight-label">Best card</div><div class="recap-highlight-val">${CARD_LABELS[bestCard.key]} — $${bestCard.captured.toFixed(0)} captured</div></div></div>`;
  if(topBenefit.name&&topBenefit.amt>0) html+=`<div class="recap-highlight"><div class="recap-highlight-icon">★</div><div><div class="recap-highlight-label">Top benefit</div><div class="recap-highlight-val">${topBenefit.name} — $${topBenefit.amt.toFixed(0)} captured · ${topBenefit.card}</div></div></div>`;
  if(biggestMiss.name) html+=`<div class="recap-highlight"><div class="recap-highlight-icon">!</div><div><div class="recap-highlight-label">Biggest miss</div><div class="recap-highlight-val">${biggestMiss.name} — $${biggestMiss.amt.toFixed(0)} left on table · ${biggestMiss.card}</div></div></div>`;
  if(longestStreak.streak>=2&&longestStreakCount===1) html+=`<div class="recap-highlight"><div class="recap-highlight-icon">${longestStreak.streak}mo</div><div><div class="recap-highlight-label">Best streak</div><div class="recap-highlight-val">${longestStreak.name} — ${longestStreak.streak} months in a row · ${longestStreak.card}</div></div></div>`;

  // Per-card export table
  const savedYearEx=state.selectedYear; state.selectedYear=year;
  const exportRows=CARD_KEYS.map(ck=>{
    const fee=getFee(ck,year);
    const {captured:ec,missed:em,total:et}=calcStats(ck,c=>getYTDPeriods(c),isYTDCurrent);
    const redeemed=getPointsRedeemedYTD(ck,year);
    return {ck,label:CARD_LABELS[ck],fee,captured:ec,redeemed,missed:em,total:et,net:ec+redeemed-fee,grade:getROIGrade(fee,ck)};
  });
  state.selectedYear=savedYearEx;
  const totEx=exportRows.reduce((a,r)=>({fee:a.fee+r.fee,captured:a.captured+r.captured,redeemed:a.redeemed+r.redeemed,missed:a.missed+r.missed,total:a.total+r.total,net:a.net+r.net}),{fee:0,captured:0,redeemed:0,missed:0,total:0,net:0});
  const totPct=totEx.total>0?Math.round(totEx.captured/totEx.total*100):0;
  const hasRedeemed=totEx.redeemed>0;
  state._exportRows=exportRows; state._exportYear=year;
  html+=`<div class="section-header" style="margin-top:20px"><span class="section-title">Per-card breakdown</span><span class="section-period">${year===CY?year+' YTD':year}</span></div>`;
  html+=`<div class="export-actions">
    <button class="settings-btn settings-btn-primary" onclick="downloadBenefitsCSV()">Download CSV</button>
    <button class="settings-btn" onclick="window.print()">Print / Save as PDF</button>
  </div>
  <div class="export-report">
    <div class="export-head"><h2>Benefits Report — ${year}</h2><p>Perks Ledger · generated ${new Date().toLocaleDateString()}</p></div>
    <div class="export-table-wrap"><table class="export-table">
      <thead><tr><th>Card</th><th>Annual Fee</th><th>Captured</th>${hasRedeemed?'<th>Redeemed</th>':''}<th>Missed</th><th>Net vs Fee</th></tr></thead>
      <tbody>
        ${exportRows.map(r=>`<tr><td>${r.label}</td><td>$${r.fee.toLocaleString()}</td><td>$${r.captured.toFixed(0)}</td>${hasRedeemed?`<td>${r.redeemed>0?'$'+r.redeemed.toFixed(0):'—'}</td>`:''}<td>$${r.missed.toFixed(0)}</td><td class="${r.net>=0?'pos':'neg'}">${r.net>=0?'+':'−'}$${Math.abs(r.net).toFixed(0)}</td></tr>`).join('')}
        <tr class="export-total"><td>Total</td><td>$${totEx.fee.toLocaleString()}</td><td>$${totEx.captured.toFixed(0)}</td>${hasRedeemed?`<td>$${totEx.redeemed.toFixed(0)}</td>`:''}<td>$${totEx.missed.toFixed(0)}</td><td class="${totEx.net>=0?'pos':'neg'}">${totEx.net>=0?'+':'−'}$${Math.abs(totEx.net).toFixed(0)}</td></tr>
      </tbody>
    </table></div>
    <p class="export-foot">Net vs Fee = benefits captured + points redeemed − annual fee.</p>
  </div>`;
  set(html);
}

// ── Render: history log ────────────────────────────────────────────────────
export async function renderHistoryLog(){
  const {sb}=await import('./state.js');
  set(`<div class="banner"><strong>Benefit history</strong> — recent activity across all cards</div><div style="text-align:center;padding:24px;color:var(--text-tertiary);font-size:13px">Loading history…</div>`);
  try{
    const {data,error}=await sb.from('benefit_log').select('*').order('created_at',{ascending:false}).limit(100);
    if(error||!data||!data.length){ set(`<div class="banner"><strong>Benefit history</strong></div><div style="text-align:center;padding:32px;color:var(--text-tertiary);font-size:13px">No history yet — start marking benefits used!</div>`); return; }
    const benefitNames={};
    Object.keys(CARDS).forEach(ck=>{ CARDS[ck].sections.forEach(s=>s.benefits.forEach(b=>{ benefitNames[b.id]=bName(ck,b); })); });
    let html=`<div class="banner"><strong>Benefit history</strong> — last ${data.length} actions</div>`;
    html+=`<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">`;
    data.forEach(entry=>{
      const d=new Date(entry.created_at);
      const timeStr=d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' · '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
      html+=`<div class="log-entry"><span class="log-dot ${entry.action}"></span><div style="flex:1"><div class="log-benefit">${entry.action==='used'?'✓':'✗'} ${benefitNames[entry.benefit_id]||entry.benefit_id}</div><div class="log-card">${CARD_LABELS[entry.card_key]||entry.card_key}</div></div><div class="log-time">${timeStr}</div></div>`;
    });
    html+=`</div>`;
    set(html);
  }catch(e){
    set(`<div class="banner"><strong>Benefit history</strong></div><div style="text-align:center;padding:32px;color:var(--red);font-size:13px">Could not load history.</div>`);
  }
}

// ── Tab badges ─────────────────────────────────────────────────────────────
export function updateCardBadges(){
  getVisibleCardKeys().forEach(cardKey=>{
    const btn=document.querySelector(`.card-btn[data-card="${cardKey}"]`);
    if(!btn) return;
    let unclaimed=0;
    CARDS[cardKey].sections.forEach(s=>{
      const pk=getCurrentPK(cardKey,s.cadence);
      const p={calY:CY,calM:CM,m:CM};
      s.benefits.forEach(b=>{ if(isBExpired(b,p)||isBNotAvailable(b,CY,p)||isGloballySnoozed(cardKey,b.id)) return; if(!isUsed(cardKey,b.id,pk)) unclaimed++; });
    });
    let badge=btn.querySelector('.card-notif-badge');
    if(unclaimed>0){
      if(!badge){ badge=document.createElement('div'); badge.className='card-notif-badge'; const front=btn.querySelector('.card-front')||btn; front.style.position='relative'; front.appendChild(badge); }
      badge.textContent=unclaimed; badge.classList.remove('hidden');
    } else { if(badge) badge.classList.add('hidden'); }
  });
}
export function updateTabBadge(){
  const btn=document.querySelector('.nav-primary-btn[data-primary="this-period"]');
  if(!btn) return;
  const dot=btn.querySelector('.tab-dot');
  if(dot) dot.remove();
}

// ── Render: fee optimizer ──────────────────────────────────────────────────
export function renderFeeOptimizer(){
  const CARD_KEYS=getVisibleCardKeys();
  let totalFees=0,totalProjectedAllIn=0;
  const cards=CARD_KEYS.map(cardKey=>{
    const fee=getFee(cardKey,CY);
    const projected=getProjectedCapture(cardKey);
    const {captured}=calcStats(cardKey,c=>getCardYearPeriods(cardKey,c),isPCurrent);
    const redeemed=getPointsRedeemedYTD(cardKey,CY);
    const projAllIn=projected+redeemed;
    totalFees+=fee; totalProjectedAllIn+=projAllIn;
    return {cardKey,fee,projected,captured,redeemed,projAllIn,cancelImpact:fee-projAllIn};
  });
  cards.sort((a,b)=>b.cancelImpact-a.cancelImpact);
  const netPortfolio=totalProjectedAllIn-totalFees;
  const inProfit=netPortfolio>=0;
  const coveragePct=totalFees>0?Math.min(100,Math.round(totalProjectedAllIn/totalFees*100)):0;
  let html=`<div class="banner"><strong>Fee optimizer</strong> — net impact of canceling each card</div>`;
  html+=`<div class="netval-hero">
    <div class="netval-hero-row">
      <div>
        <div class="netval-hero-val ${inProfit?'green':'red'}">${inProfit?'+':'-'}$${Math.abs(netPortfolio).toFixed(0)}</div>
        <div class="netval-hero-label">Portfolio net (projected)</div>
      </div>
      <div style="text-align:right">
        <div class="netval-hero-val">$${totalFees}</div>
        <div class="netval-hero-label">Total annual fees</div>
      </div>
    </div>
    <div class="netval-progress">
      <div class="netval-progress-fill" style="width:${coveragePct}%;background:${inProfit?'var(--green)':'var(--gold)'}"></div>
    </div>
    <div class="netval-progress-labels">
      <span>$0</span>
      <span style="color:${inProfit?'var(--green)':'var(--gold)'}">$${totalProjectedAllIn.toFixed(0)} projected vs $${totalFees} fees</span>
      <span>$${totalFees}</span>
    </div>
  </div>`;
  html+=`<div class="section-header"><span class="section-title">Cancel impact</span><span class="section-period">sorted by net gain from canceling</span></div>`;
  cards.forEach(({cardKey,fee,projected,captured,redeemed,projAllIn,cancelImpact})=>{
    const saves=cancelImpact>0;
    const close=Math.abs(cancelImpact)<=75;
    const verdictColor=saves?'var(--green)':close?'var(--gold)':'var(--text-secondary)';
    const verdict=saves
      ?`Cancel and save $${cancelImpact.toFixed(0)}/yr net`
      :close
      ?`Borderline — costs $${Math.abs(cancelImpact).toFixed(0)}/yr to cancel`
      :`Keep — you'd lose $${Math.abs(cancelImpact).toFixed(0)}/yr net`;
    const capPct=fee>0?Math.min(100,Math.round(projAllIn/fee*100)):0;
    const barColor=projAllIn>=fee?'var(--green)':projAllIn>=fee*0.7?'var(--gold)':'var(--red)';
    html+=`<div class="optimizer-card" onclick="goToCardPeriod('${cardKey}')">
      <div class="optimizer-card-header">
        <span class="optimizer-card-name">${CARD_LABELS[cardKey]}</span>
        <span class="optimizer-impact" style="color:${saves?'var(--green)':'var(--red)'}">${saves?'+':'-'}$${Math.abs(cancelImpact).toFixed(0)}</span>
      </div>
      <div class="optimizer-verdict" style="color:${verdictColor}">${verdict}</div>
      <div class="optimizer-bar-wrap">
        <div class="optimizer-bar-fill" style="width:${capPct}%;background:${barColor}"></div>
      </div>
      <div class="optimizer-card-sub">
        <span>$${fee} fee</span>
        <span style="color:var(--text-tertiary)">·</span>
        <span style="color:var(--green)">$${captured.toFixed(0)} benefits</span>
        ${redeemed>0?`<span style="color:var(--text-tertiary)">·</span><span style="color:var(--green)">$${redeemed.toFixed(0)} redeemed</span>`:''}
        <span style="color:var(--text-tertiary)">·</span>
        <span>$${projAllIn.toFixed(0)} proj.</span>
        <span style="color:var(--text-tertiary)">·</span>
        <span style="color:${capPct>=100?'var(--green)':capPct>=70?'var(--gold)':'var(--red)'}">${capPct}% coverage</span>
      </div>
    </div>`;
  });
  html+=`<div style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);text-align:center;margin-top:12px;padding-bottom:8px">Cancel impact = annual fee saved minus projected annual benefits lost</div>`;
  set(html);
}

// ── Render: card simulator ─────────────────────────────────────────────────
export function renderCardSimulator(){
  const userKeys=new Set(getVisibleCardKeys());
  const unowned=Object.keys(CARDS).filter(k=>!userKeys.has(k));

  if(!unowned.length){
    set(`<div class="banner"><strong>Card Simulator</strong></div>
      <div style="text-align:center;padding:40px 16px;color:var(--text-tertiary);font-size:13px">You already own all cards in the database.</div>`);
    return;
  }
  if(!state._simCard||!unowned.includes(state._simCard)) state._simCard=unowned[0];
  const simKey=state._simCard;
  const simCard=CARDS[simKey];
  const simFee=simCard.fee;

  // Derive category capture rates from owned cards (past periods only)
  const catD={},cadD={};
  userKeys.forEach(ck=>{
    CARDS[ck].sections.forEach(s=>{
      getCardYearPeriods(ck,s.cadence).forEach(p=>{
        if(isPFuture(p)) return;
        s.benefits.forEach(b=>{
          if(isBExpired(b,p)||isBNotAvailable(b,CY,p)||isGloballySnoozed(ck,b.id)) return;
          const cat=BENEFIT_CATEGORIES[b.id]||'other';
          const amt=getBAmount(b,p);
          const used=isUsed(ck,b.id,p.pk);
          if(!catD[cat]) catD[cat]={c:0,t:0};
          catD[cat].t+=amt; if(used) catD[cat].c+=amt;
          if(!cadD[s.cadence]) cadD[s.cadence]={c:0,t:0};
          cadD[s.cadence].t+=amt; if(used) cadD[s.cadence].c+=amt;
        });
      });
    });
  });

  const catRate=cat=>{const d=catD[cat]; return(d&&d.t>0)?d.c/d.t:null;};
  const cadRate=cad=>{const d=cadD[cad]; return(d&&d.t>0)?d.c/d.t:null;};
  const DEFAULT_RATE=0.55;

  // Annual max for a benefit (full 12-month year)
  function annMax(b,cadence){
    if(cadence==='monthly') return b.amount*11+(b.decAmount||b.amount);
    if(cadence==='quarterly') return b.amount*4;
    if(cadence==='cal-semi-annual'||cadence==='semi-annual') return b.amount*2;
    return b.amount;
  }

  let totalMax=0,totalProj=0;
  const sections=simCard.sections.map(s=>{
    const rows=s.benefits.filter(b=>!isBNotAvailable(b,CY)).map(b=>{
      const cat=BENEFIT_CATEGORIES[b.id]||'other';
      const max=annMax(b,s.cadence);
      const cr=catRate(cat), cadr=cadRate(s.cadence);
      const rate=cr!==null?cr:(cadr!==null?cadr:DEFAULT_RATE);
      const hasData=cr!==null||cadr!==null;
      const proj=max*rate;
      return{b,cat,max,rate,proj,hasData};
    });
    const sMax=rows.reduce((a,r)=>a+r.max,0);
    const sProj=rows.reduce((a,r)=>a+r.proj,0);
    totalMax+=sMax; totalProj+=sProj;
    return{s,rows,sMax,sProj};
  });

  const net=totalProj-simFee;
  const covPct=Math.min(100,Math.round(totalProj/simFee*100));
  const maxPct=Math.min(100,Math.round(totalMax/simFee*100));
  const grade=net>=0?'A':net>=-250?'B':net>=-500?'C':'D';
  const netColor=net>=0?'var(--green)':net>=-250?'var(--blue)':net>=-500?'var(--gold)':'var(--red)';
  const verdict=net>=0?'Projects to pay for itself at your claim rate'
    :net>=-250?'Nearly breaks even — one or two habits away'
    :net>=-500?'Marginal — worth it only if you improve capture'
    :'Likely not worth the fee at your current pace';

  const CAT_NAMES={dining:'Dining',travel:'Travel',shopping:'Shopping',fitness:'Fitness',entertainment:'Entertainment',other:'Other'};
  const CAT_COLORS_SIM={dining:'#C86428',travel:'var(--blue)',shopping:'var(--gold)',fitness:'var(--green)',entertainment:'#9333ea',other:'var(--text-tertiary)'};

  // Card picker
  const picker=`<div class="sim-picker">${unowned.map(k=>`<button class="sim-pill${k===simKey?' sp-active':''}" onclick="window.setSimCard('${k}')">${CARD_LABELS[k]}</button>`).join('')}</div>`;

  // Hero card
  const hero=`<div class="sim-hero">
    <div class="sim-grade" style="color:${netColor};border-color:${netColor}3A">${grade}</div>
    <div>
      <div class="sim-hero-name">${simCard.name}</div>
      <div class="sim-hero-fee">$${simFee}/yr annual fee</div>
      <div class="sim-verdict" style="color:${netColor}">${verdict}</div>
    </div>
  </div>
  <div class="sim-metrics">
    <div class="sim-m"><div class="sim-m-val" style="color:${netColor}">${net>=0?'+':''}$${net.toFixed(0)}</div><div class="sim-m-lbl">net projected</div></div>
    <div class="sim-m"><div class="sim-m-val green">$${totalProj.toFixed(0)}</div><div class="sim-m-lbl">you'd capture</div></div>
    <div class="sim-m"><div class="sim-m-val" style="color:var(--text-secondary)">$${totalMax.toFixed(0)}</div><div class="sim-m-lbl">max possible</div></div>
  </div>
  <div class="sim-bar-bg">
    <div class="sim-bar-max" style="width:${maxPct}%"></div>
    <div class="sim-bar-proj" style="width:${covPct}%;background:${net>=0?'var(--green)':'var(--gold)'}"></div>
  </div>
  <div class="sim-bar-labels"><span>$0</span><span style="color:${netColor}">$${totalProj.toFixed(0)} projected · $${totalMax.toFixed(0)} max · $${simFee} fee</span></div>`;

  // Behavior profile
  const profileRows=Object.entries(catD).filter(([,d])=>d.t>0).sort((a,b)=>b[1].t-a[1].t);
  let profile='';
  if(profileRows.length){
    profile=`<div class="section-header" style="margin-top:16px"><span class="section-title">Your claim profile</span><span class="section-period">from ${userKeys.size} owned card${userKeys.size!==1?'s':''}</span></div><div class="sim-profile">`;
    profileRows.forEach(([cat,d])=>{
      const pct=Math.round(d.c/d.t*100);
      const col=CAT_COLORS_SIM[cat]||'var(--text-tertiary)';
      profile+=`<div class="sim-prof-row">
        <div class="sim-prof-cat" style="color:${col}">${CAT_NAMES[cat]||cat}</div>
        <div class="sim-prof-bar"><div class="sim-prof-fill" style="width:${pct}%;background:${col}"></div></div>
        <div class="sim-prof-pct">${pct}%</div>
      </div>`;
    });
    profile+=`</div>`;
  }

  // Benefit breakdown
  const CADENCE_LBL={monthly:'Monthly',quarterly:'Quarterly','cal-semi-annual':'Semi-Annual','semi-annual':'Semi-Annual','cal-annual':'Annual','cal-annual-overlap':'Annual',annual:'Annual','feb-annual':'Annual'};
  let breakdown=`<div class="section-header" style="margin-top:16px"><span class="section-title">Benefit breakdown</span><span class="section-period">max → your projected</span></div>`;
  sections.forEach(({s,rows,sMax,sProj})=>{
    if(!rows.length) return;
    breakdown+=`<div class="sim-section">
      <div class="sim-sec-hdr">
        <span class="sim-sec-lbl">${CADENCE_LBL[s.cadence]||s.label}</span>
        <span><span class="green" style="font-family:var(--mono);font-size:12px;font-weight:600">$${sProj.toFixed(0)}</span><span class="sim-sec-max"> / $${sMax.toFixed(0)}</span></span>
      </div>`;
    rows.forEach(({b,cat,max,rate,proj,hasData})=>{
      const col=CAT_COLORS_SIM[cat]||'var(--text-tertiary)';
      const rateLbl=`${Math.round(rate*100)}%${hasData?'':' est.'}`;
      breakdown+=`<div class="sim-ben">
        <div style="flex:1;min-width:0">
          <div class="sim-ben-name">${b.name}</div>
          <div class="sim-ben-sub" style="color:${col}">${CAT_NAMES[cat]||cat} · ${rateLbl} claim rate</div>
        </div>
        <div class="sim-ben-vals"><span class="green sim-ben-proj">$${proj.toFixed(0)}</span><span class="sim-ben-max"> / $${max.toFixed(0)}</span></div>
      </div>`;
    });
    breakdown+=`</div>`;
  });

  const totalPts=Object.values(catD).reduce((a,d)=>a+d.t,0);
  const footer=`<div style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);text-align:center;margin-top:16px;padding-bottom:8px">Projected value uses your historical claim rate per category${totalPts>0?` · $${totalPts.toFixed(0)} in past benefits analyzed`:' · no prior data, using '+Math.round(DEFAULT_RATE*100)+'% default'}</div>`;

  set(`<div class="banner"><strong>Card Simulator</strong> — what if you added this card?</div>${picker}${hero}${profile}${breakdown}${footer}`);
}

window.setSimCard=function(k){state._simCard=k;renderCardSimulator();};

// ── Render: card upgrade advisor ───────────────────────────────────────────
export function renderUpgradeAdvisor(){
  const userKeys=new Set(getVisibleCardKeys());

  const UPGRADE_PATHS=[
    {from:'chase_sapphire_pref',to:'csr'},
    {from:'amex_green',to:'gold'},
    {from:'gold',to:'platinum'},
    {from:'amex_biz_gold',to:'amex_biz_plat'},
    {from:'chase_united_quest',to:'chase_united_club'},
  ];

  // Build category + cadence rates from all owned cards (same approach as card simulator)
  const catD={},cadD={};
  userKeys.forEach(ck=>{
    CARDS[ck].sections.forEach(s=>{
      getCardYearPeriods(ck,s.cadence).forEach(p=>{
        if(isPFuture(p)) return;
        s.benefits.forEach(b=>{
          if(isBExpired(b,p)||isBNotAvailable(b,CY,p)||isGloballySnoozed(ck,b.id)) return;
          const cat=BENEFIT_CATEGORIES[b.id]||'other';
          const amt=getBAmount(b,p);
          const used=isUsed(ck,b.id,p.pk);
          if(!catD[cat]) catD[cat]={c:0,t:0};
          catD[cat].t+=amt; if(used) catD[cat].c+=amt;
          if(!cadD[s.cadence]) cadD[s.cadence]={c:0,t:0};
          cadD[s.cadence].t+=amt; if(used) cadD[s.cadence].c+=amt;
        });
      });
    });
  });
  const catRate=cat=>{const d=catD[cat];return(d&&d.t>0)?d.c/d.t:null;};
  const cadRate=cad=>{const d=cadD[cad];return(d&&d.t>0)?d.c/d.t:null;};
  const DEFAULT_RATE=0.55;
  function annMax(b,cadence){
    if(cadence==='monthly') return b.amount*11+(b.decAmount||b.amount);
    if(cadence==='quarterly') return b.amount*4;
    if(cadence==='cal-semi-annual'||cadence==='semi-annual') return b.amount*2;
    return b.amount;
  }
  function projCard(cardKey){
    let total=0;
    CARDS[cardKey].sections.forEach(s=>{
      s.benefits.filter(b=>!isBNotAvailable(b,CY)).forEach(b=>{
        const cat=BENEFIT_CATEGORIES[b.id]||'other';
        const max=annMax(b,s.cadence);
        const cr=catRate(cat),cadr=cadRate(s.cadence);
        const rate=cr!==null?cr:(cadr!==null?cadr:DEFAULT_RATE);
        total+=max*rate;
      });
    });
    return total;
  }
  function benCadence(cardKey,benefitId){
    for(const s of CARDS[cardKey].sections){
      if(s.benefits.find(b=>b.id===benefitId)) return s.cadence;
    }
    return 'annual';
  }

  // Only paths where user owns "from" but not "to"
  const paths=UPGRADE_PATHS.filter(p=>userKeys.has(p.from)&&CARDS[p.to]&&!userKeys.has(p.to));

  if(!paths.length){
    let rows='';
    [...userKeys].forEach(k=>{
      const proj=getProjectedCapture(k);
      const fee=getFee(k,CY);
      const net=proj-fee;
      const netColor=net>=0?'var(--green)':net>=-250?'var(--gold)':'var(--red)';
      rows+=`<div class="optimizer-card">
        <div class="optimizer-card-header">
          <span class="optimizer-card-name">${CARD_LABELS[k]}</span>
          <span class="optimizer-impact" style="color:${netColor}">${net>=0?'+':''}$${net.toFixed(0)}</span>
        </div>
        <div class="optimizer-verdict" style="color:${netColor}">${net>=0?'Positive ROI — well-optimized':'Room to improve capture rate'}</div>
        <div class="optimizer-card-sub"><span>$${fee}/yr fee</span><span>·</span><span style="color:var(--green)">$${proj.toFixed(0)} projected</span></div>
      </div>`;
    });
    set(`<div class="banner"><strong>Card Upgrade Advisor</strong></div>
      <div style="text-align:center;padding:28px 16px 8px">
        <div style="font-size:28px;margin-bottom:8px;color:var(--green)">✓</div>
        <div style="font-size:15px;font-weight:600;color:var(--text)">You're already at the top tier</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">No upgrade paths available for your current cards.</div>
      </div>
      <div class="section-header" style="margin-top:8px"><span class="section-title">Your portfolio</span></div>
      ${rows}
      <div style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);text-align:center;margin-top:12px;padding-bottom:8px">Defined paths: Sapphire Preferred→Reserve · Green→Gold · Gold→Platinum · Biz Gold→Biz Plat · United Quest→Club</div>`);
    return;
  }

  const scored=paths.map(p=>{
    const fromFee=getFee(p.from,CY);
    const toFee=CARDS[p.to].fee;
    const feeDelta=toFee-fromFee;
    const fromProj=getProjectedCapture(p.from);
    const fromNet=fromProj-fromFee;
    const toProj=projCard(p.to);
    const toNet=toProj-toFee;
    const gain=toNet-fromNet;
    const {captured,total}=calcStats(p.from,c=>getCardYearPeriods(p.from,c),isPCurrent);
    const captureRate=total>0?captured/total:0;
    return{...p,fromFee,toFee,feeDelta,fromNet,toProj,toNet,gain,captureRate};
  }).sort((a,b)=>b.gain-a.gain);

  let html=`<div class="banner"><strong>Card Upgrade Advisor</strong> — should you level up?</div>`;

  scored.forEach(({from,to,fromFee,toFee,feeDelta,fromNet,toProj,toNet,gain,captureRate})=>{
    const fromCard=CARDS[from],toCard=CARDS[to];
    const gainColor=gain>=0?'var(--green)':gain>=-150?'var(--gold)':'var(--red)';
    let verdict,verdictColor;
    if(gain>=100){verdict='Worth upgrading at your current pace';verdictColor='var(--green)';}
    else if(gain>=0){verdict='Likely worth it — modest net gain';verdictColor='var(--green)';}
    else if(gain>=-150){verdict='Marginal — close to break-even';verdictColor='var(--gold)';}
    else{verdict='Not recommended — fee jump exceeds projected gains';verdictColor='var(--red)';}

    const capPct=Math.round(captureRate*100);
    const capColor=capPct>=80?'var(--green)':capPct>=60?'var(--blue)':'var(--gold)';

    const fromBenIds=new Set(CARDS[from].sections.flatMap(s=>s.benefits.map(b=>b.id)));
    const newBens=CARDS[to].sections
      .flatMap(s=>s.benefits.filter(b=>!fromBenIds.has(b.id)&&!isBNotAvailable(b,CY)))
      .sort((a,b)=>annMax(b,benCadence(to,b.id))-annMax(a,benCadence(to,a.id)))
      .slice(0,5);

    const newBensHtml=newBens.length?`
      <div class="ua-new-bens-hdr">New benefits gained</div>
      ${newBens.map(b=>`<div class="ua-new-ben"><span>${b.name}</span><span class="ua-new-ben-amt">$${annMax(b,benCadence(to,b.id))}/yr max</span></div>`).join('')}
    `:'';

    html+=`<div class="ua-card">
      <div class="ua-path">
        <div class="ua-side">
          <div class="ua-side-name">${fromCard.name}</div>
          <div class="ua-side-sub">$${fromFee}/yr · <span style="color:${capColor}">${capPct}% captured</span></div>
          <div class="ua-side-net" style="color:${fromNet>=0?'var(--green)':'var(--red)'}">${fromNet>=0?'+':''}$${fromNet.toFixed(0)} net/yr</div>
        </div>
        <div class="ua-arrow">→</div>
        <div class="ua-side ua-side-right">
          <div class="ua-side-name">${toCard.name}</div>
          <div class="ua-side-sub">$${toFee}/yr</div>
          <div class="ua-side-net green">${toNet>=0?'+':''}$${toNet.toFixed(0)} projected</div>
        </div>
      </div>
      <div class="ua-verdict" style="color:${verdictColor}">${verdict}</div>
      <div class="sim-metrics" style="margin-top:8px">
        <div class="sim-m"><div class="sim-m-val" style="color:${gainColor}">${gain>=0?'+':''}$${gain.toFixed(0)}</div><div class="sim-m-lbl">net change</div></div>
        <div class="sim-m"><div class="sim-m-val" style="color:var(--red)">+$${feeDelta}</div><div class="sim-m-lbl">fee increase</div></div>
        <div class="sim-m"><div class="sim-m-val green">$${toProj.toFixed(0)}</div><div class="sim-m-lbl">you'd capture</div></div>
      </div>
      ${newBensHtml}
    </div>`;
  });

  html+=`<div style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);text-align:center;margin-top:16px;padding-bottom:8px">Projected value uses your historical claim rate per category · assumes product change replaces current card</div>`;
  set(html);
}

// ── Render: renewal calendar + fee tracker ─────────────────────────────────
function feeHistory(ck){
  const card=CARDS[ck];
  const years=new Set(Object.keys(card.historicalFees||{}).map(Number));
  years.add(CY);
  return [...years].sort((a,b)=>a-b).map(y=>({year:y,fee:getFee(ck,y)}));
}
function feeSparkline(hist){
  const max=Math.max(...hist.map(h=>h.fee),1);
  return `<div class="fee-spark">`+hist.map((h,i)=>{
    const pct=Math.round(h.fee/max*100), last=i===hist.length-1;
    return `<div class="fee-spark-col"><div class="fee-spark-bar${last?' fee-spark-last':''}" style="height:${Math.max(8,pct)}%"></div><div class="fee-spark-lbl">'${String(h.year).slice(2)}</div></div>`;
  }).join('')+`</div>`;
}
export function renderRenewalCalendar(){
  const keys=getVisibleCardKeys();
  const now=new Date(), startToday=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const rows=keys.map(ck=>{
    const fm=getCardFeeMonth(ck), fd=getCardFeeDay(ck);
    let feeDate=new Date(startToday.getFullYear(),fm,fd);
    if(feeDate<startToday) feeDate=new Date(startToday.getFullYear()+1,fm,fd);
    const days=Math.round((feeDate-startToday)/86400000);
    const hist=feeHistory(ck);
    const cur=hist[hist.length-1].fee, prev=hist.length>1?hist[hist.length-2].fee:cur;
    return {ck,fm,fd,feeDate,days,fee:getFee(ck,feeDate.getFullYear()),hist,raised:cur>prev,prevFee:prev};
  }).sort((a,b)=>a.days-b.days);
  const totalFees=rows.reduce((t,r)=>t+(r.fee||0),0);
  const next=rows[0];
  let html=`<div class="banner"><strong>Renewal Calendar</strong> — ${rows.length} card${rows.length===1?'':'s'} · $${totalFees.toLocaleString()} in annual fees</div>`;
  if(next) html+=`<p style="font-size:12px;color:var(--text-tertiary);margin:0 0 12px">Next up: <strong style="color:var(--text)">${CARD_LABELS[next.ck]}</strong> in ${next.days} day${next.days===1?'':'s'} · $${next.fee}</p>`;

  // Fee-increase alert
  const raised=rows.filter(r=>r.raised);
  if(raised.length){
    html+=`<div class="rc-alert">⚠ ${raised.length} card${raised.length===1?'':'s'} raised fees this year: `+
      raised.map(r=>`<strong>${CARD_LABELS[r.ck]}</strong> $${r.prevFee}→$${r.fee}`).join(' · ')+`</div>`;
  }
  // Fee history charts (cards with more than one distinct fee)
  const withHist=rows.filter(r=>new Set(r.hist.map(h=>h.fee)).size>1);
  if(withHist.length){
    html+=`<div class="rc-month">Fee history</div>`;
    withHist.forEach(r=>{
      html+=`<div class="fee-hist-row"><div class="fee-hist-name">${CARD_LABELS[r.ck]}</div>${feeSparkline(r.hist)}</div>`;
    });
  }

  let any=false;
  for(let i=0;i<12;i++){
    const mo=(CM+i)%12;
    const inMonth=rows.filter(r=>r.fm===mo).sort((a,b)=>a.fd-b.fd);
    if(!inMonth.length) continue;
    any=true;
    html+=`<div class="rc-month">${MONTHS_FULL[mo]}</div>`;
    inMonth.forEach(r=>{
      const urgent=r.days<=30, soon=r.days<=60;
      const cls=urgent?'rc-urgent':soon?'rc-soon':'';
      html+=`<div class="rc-row" onclick="goToCardPeriod('${r.ck}')">
        <div class="rc-date">${MONTHS[r.fm]} ${r.fd}</div>
        <div class="rc-card">${CARD_LABELS[r.ck]}</div>
        <div class="rc-days ${cls}">in ${r.days}d</div>
        <div class="rc-fee">$${r.fee}${r.raised?`<span class="rc-up" title="up from $${r.prevFee}">▲</span>`:''}</div>
      </div>`;
    });
  }
  if(!any) html+=`<p style="color:var(--text-tertiary);font-size:13px">No cards selected.</p>`;
  set(html);
}

function csvCell(v){ const s=String(v); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }
window.downloadBenefitsCSV=function(){
  const rows=state._exportRows||[], year=state._exportYear||CY;
  const lines=[['Card','Annual Fee','Captured','Missed','Net vs Fee','Capture %','ROI Grade'].join(',')];
  rows.forEach(r=>{ const pct=r.total>0?Math.round(r.captured/r.total*100):0;
    lines.push([csvCell(r.label),r.fee,r.captured.toFixed(0),r.missed.toFixed(0),(r.captured-r.fee).toFixed(0),pct,r.grade].join(',')); });
  const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`perks-ledger-${year}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};

// ── Report Card (Annual Wrap) ──────────────────────────────────────────────
export function renderWrap(){
  const keys=getVisibleCardKeys();
  let totalCaptured=0,totalFees=0,totalClaims=0;
  let bestBenefitsCard={key:null,captured:0};
  let biggestWin={name:'',card:'',amt:0};
  const monthTotals={};

  // Map period key → calendar month (0-indexed) for best-month attribution
  function pkToCalMonth(pk){
    const m=pk.match(/-m(\d+)/); if(m) return parseInt(m[1]);
    const q=pk.match(/-q(\d+)/); if(q) return parseInt(q[1])*3;
    if(pk.includes('-h2')) return 6;
    return 0;
  }

  const savedYear=state.selectedYear;
  state.selectedYear=CY;
  try{
    keys.forEach(k=>{
      totalFees+=getFee(k,CY);
      const{captured}=calcStats(k,c=>getYTDPeriods(c),isYTDCurrent);
      totalCaptured+=captured;
      if(captured>bestBenefitsCard.captured) bestBenefitsCard={key:k,captured};
      CARDS[k].sections.forEach(s=>{
        if(s.cadence==='monthly'){
          s.benefits.forEach(b=>{
            for(let m=0;m<=CM;m++){
              const pk=`${CY}-m${m}`;
              if(isUsed(k,b.id,pk)){
                const amt=(b.decAmount&&m===11)?b.decAmount:b.amount;
                monthTotals[m]=(monthTotals[m]||0)+amt;
                totalClaims++;
                if(amt>biggestWin.amt) biggestWin={name:bName(k,b),card:CARD_LABELS[k],amt};
              }
            }
          });
        } else {
          getYTDPeriods(s.cadence).forEach(p=>{
            if(isPFuture(p)) return;
            s.benefits.forEach(b=>{
              if(isBExpired(b,p)||isBNotAvailable(b,CY,p)) return;
              if(isUsed(k,b.id,p.pk)){
                totalClaims++;
                const amt=getBAmount(b,p);
                const mo=pkToCalMonth(p.pk);
                monthTotals[mo]=(monthTotals[mo]||0)+amt;
                if(amt>biggestWin.amt) biggestWin={name:bName(k,b),card:CARD_LABELS[k],amt};
              }
            });
          });
        }
      });
    });
  }finally{state.selectedYear=savedYear;}

  // Best points card
  let bestPointsCard={key:null,redeemed:0};
  keys.forEach(k=>{
    const r=getPointsRedeemedYTD(k,CY);
    if(r>bestPointsCard.redeemed) bestPointsCard={key:k,redeemed:r};
  });

  const totalRedeemed=getAllPointsRedeemedYTD(CY);
  const totalValueAllIn=totalCaptured+totalRedeemed;
  const netValue=totalValueAllIn-totalFees;
  const inProfit=netValue>=0;
  const grade=netValue>=0?'A':netValue>=-500?'B':netValue>=-1000?'C':'D';
  const gradeColor=grade==='A'?'#4ade80':grade==='B'?'var(--blue)':grade==='C'?'var(--gold)':'#f87171';
  const capPct=totalFees>0?Math.round(totalValueAllIn/totalFees*100):0;
  const bestMonthEntry=Object.entries(monthTotals).sort((a,b)=>b[1]-a[1])[0];
  const bestMonthName=bestMonthEntry?MONTHS[parseInt(bestMonthEntry[0])]:'—';
  const bestMonthAmt=bestMonthEntry?bestMonthEntry[1]:0;

  set(`<div class="banner"><strong>Report Card</strong> — ${CY} · through ${MONTHS[CM]}</div>
  <div class="wrap-card">
    <div class="wrap-header">
      <div class="wrap-title">PERKS LEDGER</div>
      <div class="wrap-year">${CY} Annual Report Card · through ${MONTHS[CM]}</div>
    </div>
    <div class="wrap-hero">
      <div class="wrap-hero-label">Total Value Extracted</div>
      <div class="wrap-hero-val">$${totalValueAllIn.toFixed(0)}</div>
      <div class="wrap-hero-sub">${capPct}% of $${totalFees} in annual fees${totalRedeemed>0?` · $${totalCaptured.toFixed(0)} benefits + $${totalRedeemed.toFixed(0)} redeemed`:''}</div>
    </div>
    <div class="wrap-grid">
      <div class="wrap-stat">
        <div class="wrap-stat-val" style="color:${inProfit?'#4ade80':'#f87171'}">${inProfit?'+':''}$${netValue.toFixed(0)}</div>
        <div class="wrap-stat-lbl">Net Value</div>
      </div>
      <div class="wrap-stat">
        <div class="wrap-stat-val" style="color:${gradeColor}">${grade}</div>
        <div class="wrap-stat-lbl">Portfolio Grade</div>
      </div>
      <div class="wrap-stat">
        <div class="wrap-stat-val">${bestBenefitsCard.key?CARD_SHORT_LABELS[bestBenefitsCard.key]:'—'}</div>
        <div class="wrap-stat-lbl">Top Benefits · $${bestBenefitsCard.captured.toFixed(0)}</div>
      </div>
      <div class="wrap-stat">
        <div class="wrap-stat-val">${bestMonthName}</div>
        <div class="wrap-stat-lbl">Best Month · $${bestMonthAmt.toFixed(0)}</div>
      </div>
    </div>
    ${bestPointsCard.key&&bestPointsCard.redeemed>0?`<div class="wrap-win">
      <div class="wrap-win-label">✦ Top Points Card</div>
      <div class="wrap-win-name">${CARD_LABELS[bestPointsCard.key]}</div>
      <div class="wrap-win-card">$${bestPointsCard.redeemed.toFixed(2)} redeemed</div>
    </div>`:''}
    ${biggestWin.amt>0?`<div class="wrap-win">
      <div class="wrap-win-label">✦ Biggest Win</div>
      <div class="wrap-win-name">${biggestWin.name}</div>
      <div class="wrap-win-card">${biggestWin.card} · $${biggestWin.amt}</div>
    </div>`:''}
    <div class="wrap-footer">
      <span>${totalClaims} claims · ${keys.length} card${keys.length!==1?'s':''}</span>
      <span>perks.hueyventures.org</span>
    </div>
  </div>
  <div class="wrap-actions">
    <button class="wrap-share-btn" id="wrap-share-btn">Share</button>
    <button class="wrap-print-btn" onclick="window.print()">Save PDF</button>
  </div>
  <div style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);text-align:center;margin-top:8px;padding-bottom:8px">Calendar year ${CY} · YTD through ${MONTHS[CM]}</div>`,
  ()=>{
    const btn=document.getElementById('wrap-share-btn');
    if(!btn) return;
    btn.addEventListener('click',()=>{
      const text=`My ${CY} Credit Card Report Card 🏆\n\n`+
        `💰 Extracted: $${totalValueAllIn.toFixed(0)}${totalRedeemed>0?` ($${totalCaptured.toFixed(0)} benefits + $${totalRedeemed.toFixed(0)} redeemed)`:''}\n`+
        `📊 Net: ${inProfit?'+':''}$${netValue.toFixed(0)}\n`+
        `🏅 Grade: ${grade}\n`+
        `⭐ Top Benefits: ${bestBenefitsCard.key?CARD_LABELS[bestBenefitsCard.key]:'—'} ($${bestBenefitsCard.captured.toFixed(0)})\n`+
        (bestPointsCard.key&&bestPointsCard.redeemed>0?`💎 Top Points: ${CARD_LABELS[bestPointsCard.key]} ($${bestPointsCard.redeemed.toFixed(0)} redeemed)\n`:'')+
        `🎯 ${totalClaims} claims made\n\n`+
        `Tracked with Perks Ledger`;
      if(navigator.share) navigator.share({title:`${CY} Card Report Card`,text});
      else navigator.clipboard?.writeText(text).then(()=>{btn.textContent='Copied!';setTimeout(()=>btn.textContent='Share',2000);});
    });
  });
}

// ── Benefit Alerts ─────────────────────────────────────────────────────────
export function computeAlerts(userKeySet){
  const alerts=[];
  [...userKeySet].forEach(k=>{
    const card=CARDS[k];
    if(!card.historicalFees) return;
    const years=Object.keys(card.historicalFees).map(Number).sort();
    for(let i=1;i<years.length;i++){
      const from=card.historicalFees[years[i-1]],to=card.historicalFees[years[i]];
      if(from!==to) alerts.push({id:`fc_${k}_${years[i]}`,type:'fee_change',card:k,year:years[i],from,to,delta:to-from});
    }
    const ly=Math.max(...years);
    if(card.historicalFees[ly]!==card.fee) alerts.push({id:`fc_${k}_now`,type:'fee_change',card:k,year:CY,from:card.historicalFees[ly],to:card.fee,delta:card.fee-card.historicalFees[ly]});
  });
  [...userKeySet].forEach(k=>{
    CARDS[k].sections.forEach(s=>{
      s.benefits.forEach(b=>{
        if(b.startsFrom&&b.startsFrom>=CY-1) alerts.push({id:`nb_${b.id}`,type:'new_benefit',card:k,benefit:bName(k,b),amount:b.amount,since:b.startsFrom,cadence:s.cadence});
      });
    });
  });
  [...userKeySet].forEach(k=>{
    CARDS[k].sections.forEach(s=>{
      s.benefits.forEach(b=>{
        if(!b.expiresAfter) return;
        const{y,h}=b.expiresAfter;
        if(y*12+(h===0?5:11)>=CY*12+CM) alerts.push({id:`ex_${b.id}`,type:'expiring',card:k,benefit:bName(k,b),amount:b.amount,expiryStr:`${h===0?'Jun':'Dec'} ${y}`});
      });
    });
  });
  return alerts;
}

export function renderBenefitAlerts(){
  const keySet=new Set(getVisibleCardKeys());
  const alerts=computeAlerts(keySet);
  const feeChanges=alerts.filter(a=>a.type==='fee_change').sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
  const newBens=alerts.filter(a=>a.type==='new_benefit').sort((a,b)=>b.since-a.since||b.amount-a.amount);
  const expiring=alerts.filter(a=>a.type==='expiring');

  let html=`<div class="banner"><strong>Benefit Alerts</strong> — changes & upcoming</div>`;
  if(!alerts.length){set(html+`<div style="text-align:center;padding:40px 16px;color:var(--text-tertiary);font-size:13px">No recent changes detected for your cards.</div>`);return;}

  if(feeChanges.length){
    html+=`<div class="section-header"><span class="section-title">Fee changes</span></div>`;
    feeChanges.forEach(({card,year,from,to,delta})=>{
      const col=delta>0?'var(--red)':'var(--green)';
      html+=`<div class="alert-row"><div class="alert-row-hdr"><span class="alert-card-name">${CARD_LABELS[card]}</span><span style="font-family:var(--mono);font-size:13px;font-weight:600;color:${col}">${delta>0?'+':''}$${delta}</span></div><div class="alert-detail">$${from} → $${to}${year!==CY?` · ${year}`:''}</div></div>`;
    });
  }
  if(newBens.length){
    html+=`<div class="section-header" style="margin-top:8px"><span class="section-title">New benefits (${CY-1}–${CY})</span></div>`;
    newBens.forEach(({card,benefit,amount,since,cadence})=>{
      const sfx=cadence==='monthly'?'/mo':cadence==='quarterly'?'/qtr':cadence.includes('semi')?'/half':'/yr';
      html+=`<div class="alert-row"><div class="alert-row-hdr"><span class="alert-card-name">${CARD_LABELS[card]}</span><span class="green" style="font-family:var(--mono);font-size:11px;font-weight:600">NEW ${since}</span></div><div class="alert-detail">${benefit} · $${amount}${sfx}</div></div>`;
    });
  }
  if(expiring.length){
    html+=`<div class="section-header" style="margin-top:8px"><span class="section-title">Expiring soon</span></div>`;
    expiring.forEach(({card,benefit,amount,expiryStr})=>{
      html+=`<div class="alert-row"><div class="alert-row-hdr"><span class="alert-card-name">${CARD_LABELS[card]}</span><span style="font-family:var(--mono);font-size:11px;font-weight:600;color:var(--gold)">ENDS ${expiryStr}</span></div><div class="alert-detail">${benefit} · $${amount}</div></div>`;
    });
  }
  set(html);
}

// ── AI Advisor ─────────────────────────────────────────────────────────────
export function buildAdvisorContext(){
  const keys=getVisibleCardKeys();
  const lines=[];
  lines.push(`Today: ${MONTHS[CM]} ${new Date().getDate()}, ${CY}`);
  lines.push(`Cards: ${keys.map(k=>CARD_LABELS[k]).join(', ')}`);
  lines.push('');

  // Unclaimed benefits by cadence bucket
  const monthly=[], other=[];
  keys.forEach(ck=>{
    CARDS[ck].sections.forEach(s=>{
      const pk=getCurrentPK(ck,s.cadence);
      const p={calY:CY,calM:CM,m:CM,endM:CM,endY:CY};
      s.benefits.forEach(b=>{
        if(isBExpired(b,p)||isBNotAvailable(b,CY,p)||isGloballySnoozed(ck,b.id)) return;
        if(isUsed(ck,b.id,pk)) return;
        const amt=getBAmount(b,{m:CM});
        const item=`${CARD_LABELS[ck]}: ${bName(ck,b)} ($${amt})`;
        if(s.cadence==='monthly') monthly.push(item);
        else other.push(item);
      });
    });
  });
  if(monthly.length){
    const lastDay=new Date(CY,CM+1,0).getDate();
    lines.push(`Unclaimed this month (expires ${MONTHS[CM]} ${lastDay}):`);
    monthly.forEach(i=>lines.push(`- ${i}`));
    lines.push('');
  }
  if(other.length){
    lines.push('Other unclaimed benefits:');
    other.slice(0,8).forEach(i=>lines.push(`- ${i}`));
    lines.push('');
  }

  // Current year performance
  const monthsElapsedMap={};
  lines.push(`Current card year performance (${MONTHS[CM]} ${CY}):`);
  keys.forEach(k=>{
    const {captured,total}=calcStats(k,c=>getCardYearPeriods(k,c),isPCurrent);
    const proj=getProjectedCapture(k);
    const fee=getFee(k,CY);
    const rate=total>0?Math.round(captured/total*100):0;
    const mo=getCardYearMonthsElapsed(k);
    monthsElapsedMap[k]=mo;
    const net=proj-fee;
    lines.push(`- ${CARD_LABELS[k]}: ${rate}% captured so far ($${captured.toFixed(0)}/$${total.toFixed(0)} avail), projected $${proj.toFixed(0)}, fee $${fee}, projected net ${net>=0?'+':''}$${net.toFixed(0)}, ${mo}/12 months into card year`);
  });
  lines.push('');

  // Previous year performance
  const savedYear=state.selectedYear;
  state.selectedYear=CY-1;
  try{
    const lastYearLines=[];
    keys.forEach(k=>{
      const {captured:lc,total:lt}=calcStats(k,c=>getYTDPeriods(c),()=>false);
      if(lt>0){
        const lf=getFee(k,CY-1);
        const lr=Math.round(lc/lt*100);
        const ln=lc-lf;
        lastYearLines.push(`- ${CARD_LABELS[k]}: ${lr}% captured ($${lc.toFixed(0)}/$${lt.toFixed(0)}), fee $${lf}, net ${ln>=0?'+':''}$${ln.toFixed(0)}`);
      }
    });
    if(lastYearLines.length){
      lines.push(`Previous year (${CY-1}) actual performance:`);
      lastYearLines.forEach(l=>lines.push(l));
      lines.push('');
    }
  }finally{
    state.selectedYear=savedYear;
  }

  return lines.join('\n');
}

export function buildCardChooserContext(spend){
  const owned=new Set(getVisibleCardKeys());
  const lines=[];
  lines.push(`Today: ${MONTHS[CM]} ${new Date().getDate()}, ${CY}`);
  lines.push(`Cards I already have: ${[...owned].map(k=>CARD_LABELS[k]).join(', ')||'none'}`);
  lines.push('');

  if(spend&&Object.values(spend).some(v=>v>0)){
    lines.push('My rough monthly spending by category:');
    Object.entries(spend).forEach(([cat,amt])=>{ if(amt>0) lines.push(`- ${cat}: $${amt}/mo`); });
    lines.push('');
  }

  // maxCardYearValue reads state.selectedYear — pin to the current year so
  // candidate-card estimates aren't skewed by a past year selected elsewhere in the app.
  const savedYear=state.selectedYear;
  state.selectedYear=CY;
  try{
    lines.push('Candidate premium cards (annual fee, max annual credit value if every credit is fully used, top earn-rate categories, point valuation):');
    PREMIUM_CARD_CATALOG.filter(c=>c.supported&&CARDS[c.id]).forEach(c=>{
      const already=owned.has(c.id);
      const maxVal=Math.round(maxCardYearValue(c.id));
      const mult=POINTS_MULTIPLIERS[c.id];
      const multStr=mult?mult.slice(0,3).map(m=>`${m.pts} ${m.cat}`).join('; '):'';
      const prog=Object.values(POINTS_PROGRAMS).find(p=>p.cards.includes(c.id));
      const ptVal=prog?`${prog.name} @ ~${prog.centsPerPt}¢/pt`:'';
      lines.push(`- ${c.name} (${c.issuer})${already?' [ALREADY OWNED]':''}: $${c.fee}/yr fee, up to $${maxVal}/yr in credits. Earns: ${multStr}. ${ptVal}`);
    });
  }finally{
    state.selectedYear=savedYear;
  }
  lines.push('');
  lines.push('Note: "up to $X/yr in credits" assumes disciplined use of every single credit — realistic captured value is usually much lower. Weigh credits against how well they actually match my spending/lifestyle, not face value, and do a simple breakeven (fee vs. realistic credit capture + extra points earned from my spending).');
  return lines.join('\n');
}

export function renderAIAdvisor(){
  const mode=state._advisorMode||'optimize';
  const modeTabBtn=(key,label)=>`<button onclick="switchAdvisorMode('${key}')" style="padding:4px 16px;border-radius:20px;border:1px solid ${key===mode?'var(--blue)':'var(--border)'};background:${key===mode?'var(--blue)':'transparent'};color:${key===mode?'#fff':'var(--text-secondary)'};font-size:12px;font-family:var(--mono);cursor:pointer;transition:all 0.15s">${label}</button>`;
  const modeTabs=`<div style="display:flex;gap:6px;padding:0 0 14px">${modeTabBtn('optimize','Optimize My Cards')}${modeTabBtn('choose','Choose a New Card')}</div>`;

  if(mode==='choose'){ renderCardChooser(modeTabs); return; }

  const history=state._advisorHistory||[];
  const loading=state._advisorLoading||false;

  const quickQs=[
    'What should I use this month?',
    'Which benefits expire soon?',
    'Am I getting enough value?',
    'What should I prioritize?',
  ];
  const quickBtns=quickQs.map(q=>`<button class="adv-quick" data-q="${escapeHtml(q)}">${q}</button>`).join('');

  let responseHtml='';
  if(loading){
    responseHtml=`<div class="adv-loading"><span class="adv-dot"></span><span class="adv-dot"></span><span class="adv-dot"></span></div>`;
  } else if(history.length){
    responseHtml=history.map(({q,a})=>`
      <div class="adv-q">${escapeHtml(q)}</div>
      <div class="adv-a">${formatAdvisorMarkdown(a)}</div>
    `).join('');
  } else {
    responseHtml=`<div class="adv-placeholder">Ask anything about your benefits — or tap a quick question above.</div>`;
  }

  set(`${modeTabs}<div class="banner"><strong>AI Advisor</strong> — powered by Claude</div>
    <div class="adv-quick-row">${quickBtns}</div>
    <div class="adv-input-row">
      <input type="text" id="adv-input" class="adv-input" placeholder="Ask about your benefits…">
      <button class="adv-send" id="adv-send-btn">→</button>
    </div>
    <div class="adv-response" id="adv-response">${responseHtml}</div>
    <div style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);text-align:center;margin-top:8px;padding-bottom:8px">Claude has access to your card data and capture rates · answers are estimates</div>
  `, ()=>{
    document.querySelectorAll('.adv-quick').forEach(btn=>{
      btn.addEventListener('click',()=>window.askAdvisor(btn.dataset.q));
    });
    const sendBtn=document.getElementById('adv-send-btn');
    if(sendBtn) sendBtn.addEventListener('click',()=>window.sendAdvisor());
    const inp=document.getElementById('adv-input');
    if(inp){
      inp.addEventListener('keydown',e=>{ if(e.key==='Enter') window.sendAdvisor(); });
      inp.focus();
    }
  });
}

function renderCardChooser(modeTabsHtml){
  if(!state._chooserSpend) state._chooserSpend={};
  const spend=state._chooserSpend;
  const history=state._chooserHistory||[];
  const loading=state._chooserLoading||false;

  const spendFields=[
    ['dining','Dining'],['travel','Travel'],['groceries','Groceries'],
    ['gas','Gas'],['streaming','Streaming/Ent.'],['other','Everything else'],
  ];
  const spendInputs=spendFields.map(([key,label])=>`
    <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;font-family:var(--mono);color:var(--text-tertiary)">
      ${label}
      <input type="number" min="0" step="1" class="adv-input" style="padding:6px 8px" data-spend="${key}" value="${spend[key]||''}" placeholder="$/mo">
    </label>
  `).join('');

  const quickQs=[
    "Is any card worth getting for me?",
    'Compare my options for travel.',
    "What's the best card for dining?",
  ];
  const quickBtns=quickQs.map(q=>`<button class="adv-quick" data-q="${escapeHtml(q)}">${q}</button>`).join('');

  let responseHtml='';
  if(loading){
    responseHtml=`<div class="adv-loading"><span class="adv-dot"></span><span class="adv-dot"></span><span class="adv-dot"></span></div>`;
  } else if(history.length){
    responseHtml=history.map(({q,a})=>`
      <div class="adv-q">${escapeHtml(q)}</div>
      <div class="adv-a">${formatAdvisorMarkdown(a)}</div>
    `).join('');
  } else {
    responseHtml=`<div class="adv-placeholder">Optionally add your monthly spending below, then ask which card (if any) is worth getting.</div>`;
  }

  set(`${modeTabsHtml}<div class="banner"><strong>Choose a New Card</strong> — powered by Claude</div>
    <details style="margin-bottom:12px">
      <summary style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;list-style:none;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)">+ Add my monthly spending (optional, improves the recommendation)</summary>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;margin-top:10px">${spendInputs}</div>
    </details>
    <div class="adv-quick-row">${quickBtns}</div>
    <div class="adv-input-row">
      <input type="text" id="chooser-input" class="adv-input" placeholder="Ask which card is worth getting…">
      <button class="adv-send" id="chooser-send-btn">→</button>
    </div>
    <div class="adv-response" id="chooser-response">${responseHtml}</div>
    <div style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);text-align:center;margin-top:8px;padding-bottom:8px">Claude compares candidate cards against your data · estimates only, not financial advice</div>
  `, ()=>{
    document.querySelectorAll('[data-spend]').forEach(inp=>{
      inp.addEventListener('input',()=>{
        const v=parseFloat(inp.value);
        state._chooserSpend[inp.dataset.spend]=isNaN(v)?0:v;
      });
    });
    document.querySelectorAll('.adv-quick').forEach(btn=>{
      btn.addEventListener('click',()=>window.askCardChooser(btn.dataset.q));
    });
    const sendBtn=document.getElementById('chooser-send-btn');
    if(sendBtn) sendBtn.addEventListener('click',()=>window.sendCardChooser());
    const inp=document.getElementById('chooser-input');
    if(inp){
      inp.addEventListener('keydown',e=>{ if(e.key==='Enter') window.sendCardChooser(); });
      inp.focus();
    }
  });
}

export function formatAdvisorMarkdown(text){
  const escaped=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let formatted=escaped.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
  const lines=formatted.split('\n');
  let inList=false;
  const out=[];
  for(const line of lines){
    const heading=/^#{1,4}\s+(.*)/.exec(line);
    if(/^[-•]\s/.test(line)){
      if(!inList){out.push('<ul class="adv-list">');inList=true;}
      out.push(`<li>${line.replace(/^[-•]\s/,'')}</li>`);
    } else if(heading){
      if(inList){out.push('</ul>');inList=false;}
      out.push(`<p class="adv-p"><strong>${heading[1]}</strong></p>`);
    } else {
      if(inList){out.push('</ul>');inList=false;}
      if(line.trim()) out.push(`<p class="adv-p">${line}</p>`);
    }
  }
  if(inList) out.push('</ul>');
  return out.join('');
}

// ── Main render dispatcher ─────────────────────────────────────────────────
// Absolute month (year*12+month) a card was opened / closed, from _cardMeta.
// _cardMeta is the single source of open dates — cards.js no longer carries any.
function cardHeldRange(cardKey){
  const meta=state.cardMeta?.[cardKey];
  const from=meta?.openedYear?meta.openedYear*12+(meta.openedMonth??0):null;
  const to=meta?.closedYear?meta.closedYear*12+(meta.closedMonth??11):null;
  return {from,to};
}
function wasCardHeld(cardKey,year,month){
  const {from,to}=cardHeldRange(cardKey);
  const abs=year*12+month;
  if(from!==null&&abs<from) return false;
  if(to!==null&&abs>to) return false;
  return true;
}

// ── Render: points redeemed ────────────────────────────────────────────────
// Source is user-declared only — the app cannot know where points came from,
// and the Detailed Report must not present a first-year welcome bonus as
// recurring annual value.
const POINTS_SOURCE_OPTIONS=[
  ['','Source…'],
  ['ongoing-spend','Ongoing spend'],
  ['welcome-bonus','Welcome bonus'],
  ['referral','Referral'],
  ['adjustment','Adjustment'],
  ['unknown','Other / unknown'],
];
export function renderPointsRedemptions(){
  const CARD_KEYS=getVisibleCardKeys();
  const yr=window._ptsRY||CY;
  const isPrior=yr<CY;
  const totalYTD=getAllPointsRedeemedYTD(yr);

  // Year selector tabs
  const availableYears=[CY-1,CY];
  let yearTabs=`<div style="display:flex;gap:6px;margin-bottom:12px">`;
  availableYears.forEach(y=>{
    const active=y===yr;
    yearTabs+=`<button onclick="window.setPtsRY(${y})" style="flex:1;padding:7px;border:1px solid ${active?'var(--blue)':'var(--border)'};border-radius:var(--radius-sm);background:${active?'rgba(96,165,250,0.12)':'var(--surface)'};color:${active?'var(--blue)':'var(--text-secondary)'};font-size:12px;font-family:var(--mono);font-weight:${active?'700':'400'};cursor:pointer">${y}</button>`;
  });
  yearTabs+=`</div>`;

  let html=`<div class="banner"><strong>Points Redeemed</strong> — cash value from points, separate from statement credits</div>`;
  html+=yearTabs;

  // Hero total
  html+=`<div class="netval-hero" style="margin-bottom:16px">
    <div class="netval-hero-row">
      <div>
        <div class="netval-hero-val ${totalYTD>0?'green':''}">$${totalYTD.toFixed(2)}</div>
        <div class="netval-hero-label">${yr}${isPrior?' full year':' YTD'} — redeemed across all cards</div>
      </div>
    </div>
    <div style="font-size:11px;font-family:var(--mono);color:var(--text-tertiary);margin-top:6px">Log what you actually redeemed each month, and tag where it came from. Tagging a welcome bonus keeps it out of the recurring-value figures in the Detailed Report.</div>
  </div>`;

  // Build months list: prior year = all 12 months; current year = 0..CM — newest first
  const months=[];
  const maxM=isPrior?11:CM;
  for(let m=maxM;m>=0;m--){
    months.push({year:yr,month:m});
  }

  // Per-card sections
  CARD_KEYS.forEach(cardKey=>{
    const ytd=getPointsRedeemedYTD(cardKey,yr);
    const byMonth=loadPointsRedeemed()[cardKey]||{};

    html+=`<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:10px">`;
    html+=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span style="font-size:12px;font-family:var(--mono);color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.06em">${CARD_LABELS[cardKey]}</span>
      <span style="font-size:13px;font-weight:700;font-family:var(--mono);color:${ytd>0?'var(--green)':'var(--text-tertiary)'}">$${ytd.toFixed(2)} ${isPrior?yr:'YTD'}</span>
    </div>`;

    // Months before the card existed cannot have redemptions. Still shown if a
    // value is already recorded there, so a mistaken entry stays visible and
    // can be cleared rather than becoming orphaned data the UI hides.
    const visible=months.filter(({year,month})=>wasCardHeld(cardKey,year,month)||byMonth[`${year}-${month}`]);
    if(!visible.length){
      const {from}=cardHeldRange(cardKey);
      const opened=from!==null?`${MONTHS[from%12]} ${Math.floor(from/12)}`:'later';
      html+=`<div style="font-size:11px;font-family:var(--mono);color:var(--text-tertiary);padding:4px 0">Not held in ${yr} — opened ${opened}.</div></div>`;
      return;
    }
    visible.forEach(({year,month})=>{
      const mk=`${year}-${month}`;
      const amt=(byMonth[mk]||0);
      const held=wasCardHeld(cardKey,year,month);
      const isCurrent=!isPrior&&month===CM;
      const monthLabel=`${MONTHS[month]} ${year}`;
      html+=`<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border-light)">
        <div style="width:68px;flex-shrink:0;font-size:11px;font-family:var(--mono);color:${isCurrent?'var(--text)':'var(--text-tertiary)'};font-weight:${isCurrent?'600':'400'}">${monthLabel}${held?'':`<span title="Card was not open this month" style="color:var(--red);margin-left:3px">!</span>`}</div>
        <div style="display:flex;align-items:center;gap:4px;flex:1">
          <span style="font-size:12px;color:var(--text-tertiary);font-family:var(--mono)">$</span>
          <input type="number" min="0" step="0.01" placeholder="0.00"
            value="${amt?amt.toFixed(2):''}"
            data-card="${cardKey}" data-mk="${mk}"
            class="pts-redeemed-input"
            style="width:90px;padding:5px 7px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg);color:var(--text);font-size:13px;font-family:var(--mono)">
          ${isCurrent?`<span style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);margin-left:4px">this month</span>`:''}
        </div>
        <select class="pts-source-select" data-card="${cardKey}" data-mk="${mk}"
          title="Where did these points come from? Used by the Detailed Report to separate one-off welcome-bonus value from recurring value."
          style="flex-shrink:0;padding:4px 6px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg);color:${getPointsSource(cardKey,mk)?'var(--text)':'var(--text-tertiary)'};font-size:11px;font-family:var(--mono);${amt>0?'':'opacity:0.4'}">
          ${POINTS_SOURCE_OPTIONS.map(([v,l])=>`<option value="${v}"${getPointsSource(cardKey,mk)===v?' selected':''}>${l}</option>`).join('')}
        </select>
        ${amt>0?`<span style="font-size:12px;font-family:var(--mono);color:var(--green);flex-shrink:0">✓</span>`:''}
      </div>`;
    });

    html+=`</div>`;
  });

  html+=`<div style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);text-align:center;margin-top:8px;padding-bottom:16px">Values save automatically · shown in Keep/Cancel view as total card value</div>`;

  set(html, ()=>{
    document.querySelectorAll('.pts-redeemed-input').forEach(inp=>{
      inp.addEventListener('change',()=>{
        const amt=Math.max(0,parseFloat(inp.value)||0);
        window.savePointsRedeemedEntry(inp.dataset.card, inp.dataset.mk, amt);
      });
    });
    document.querySelectorAll('.pts-source-select').forEach(sel=>{
      sel.addEventListener('change',()=>{
        window.savePointsSourceEntry(sel.dataset.card, sel.dataset.mk, sel.value);
        sel.style.color=sel.value?'var(--text)':'var(--text-tertiary)';
      });
    });
  });
}

export function render(){
  const _analyticsViews=['compare','history-log','recap','heatmap','performance','digest','net-value','badges','fee-optimizer','card-simulator','renewal-calendar','upgrade-advisor','ai-advisor','wrap','benefit-alerts','points-redemptions','export-report','break-even'];
  const _isAnalytics=_analyticsViews.includes(state.activeView);
  ['cardSelector','navPrimary','navSecondary','yearSelector','ptrIndicator'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display=_isAnalytics?'none':''; });
  document.querySelectorAll('.drag-hint,.ptr-indicator').forEach(el=>{ el.style.display=_isAnalytics?'none':''; });
  const _btns=document.querySelectorAll('.card-btn[data-card]');
  if(state.activeView==='all-cards'){
    _btns.forEach(b=>{ b.className='card-btn'; b.classList.add(`active-${b.dataset.card}`); });
  } else {
    _btns.forEach(b=>{ b.className='card-btn'; if(b.dataset.card===state.activeCard) b.classList.add(`active-${state.activeCard}`); });
  }
  const fee=getFee(state.activeCard,state.selectedYear);
  const {year:fy,month:fm}=getCardYearStart(state.activeCard,state.selectedYear);
  const cyEnd=(fm+11)%12,cyEndY=fy+Math.floor((fm+11)/12);
  const cyBanner=`<div class="banner">Card year: <strong>${MONTHS[fm]} ${fy} → ${MONTHS[cyEnd]} ${cyEndY}</strong> &nbsp;·&nbsp; Annual fee: <strong>$${fee}</strong></div>`;
  const isCurrentYear=state.selectedYear===CY;
  const ytdEndLabel=isCurrentYear?`${MONTHS_FULL[CM]} ${CY}`:`Dec ${state.selectedYear}`;
  const ytdBanner=`<div class="banner"><strong>Jan ${state.selectedYear} → ${ytdEndLabel}</strong> &nbsp;·&nbsp; ${isCurrentYear?'Calendar YTD':state.selectedYear+' full year'} &nbsp;·&nbsp; Annual fee: <strong>$${fee}</strong></div>`;
  if(state.activeView==='all-cards') renderAllCards();
  else if(state.activeView==='current') renderCurrent();
  else if(state.activeView==='history') renderHistBase(c=>getCardYearPeriods(state.activeCard,c),isPCurrent,cyBanner);
  else if(state.activeView==='annual') renderSummBase(c=>getCardYearPeriods(state.activeCard,c),isPCurrent,cyBanner,'card-year');
  else if(state.activeView==='ytd-history') renderHistBase(c=>getYTDPeriods(c),isYTDCurrent,ytdBanner);
  else if(state.activeView==='ytd') renderSummBase(c=>getYTDPeriods(c),isYTDCurrent,ytdBanner,state.selectedYear===CY?'YTD':state.selectedYear+' full year');
  else if(state.activeView==='compare') renderComparison();
  else if(state.activeView==='history-log') renderHistoryLog();
  else if(state.activeView==='recap') renderRecap();
  else if(state.activeView==='heatmap') renderHeatmap();
  else if(state.activeView==='performance') renderPerformance();
  else if(state.activeView==='digest') renderDigest();
  else if(state.activeView==='net-value') renderNetValue();
  else if(state.activeView==='break-even') renderBreakEven();
  else if(state.activeView==='fee-optimizer') renderFeeOptimizer();
  else if(state.activeView==='card-simulator') renderCardSimulator();
  else if(state.activeView==='renewal-calendar') renderRenewalCalendar();
  else if(state.activeView==='upgrade-advisor') renderUpgradeAdvisor();
  else if(state.activeView==='ai-advisor') renderAIAdvisor();
  else if(state.activeView==='wrap') renderWrap();
  else if(state.activeView==='benefit-alerts') renderBenefitAlerts();
  else if(state.activeView==='points-redemptions') renderPointsRedemptions();
  else if(state.activeView==='export-report'){ ensureReportStyles(); renderExportReport(); }
  setTimeout(()=>{ updateTabBadge(); updateCardBadges(); },200);
}

// ── Break-even ─────────────────────────────────────────────────────────────
// The app could always say "you have captured $X of your $Y fee". It could not
// say whether $X was good *for the date* — 62% is ahead of pace in May and
// behind it in November. These plot capture against the fee over the card
// year, which is the same basis Portfolio Value and Fee Optimizer use.

// Where a claim sits within the card year, 0-indexed from the card-year start.
function cardYearPos(cardKey, calY, calM){
  const {year:fy, month:fm} = getCardYearStart(cardKey, CY);
  return (calY * 12 + calM) - (fy * 12 + fm);
}

// Claims for one card, using the same inclusion rules as calcStats() so the
// chart cannot disagree with the totals shown elsewhere. A claim is dated by
// its recorded redemption month where we have one, and by the month its period
// opened where we do not (data predating redemption tracking).
export function collectBreakEvenClaims(cardKey){
  const claims = [];
  CARDS[cardKey].sections.forEach(s=>{
    getCardYearPeriods(cardKey, s.cadence).forEach(p=>{
      s.benefits.forEach(b=>{
        if(isBExpired(b,p) || isBNotAvailable(b, state.selectedYear, p) || isGloballySnoozed(cardKey,b.id)) return;
        if(!isUsed(cardKey, b.id, p.pk)) return;
        const full = getBAmount(b,p);
        const partial = b.partial ? getPartialUsed(cardKey, b.id, p.pk) : 0;
        const amount = b.partial && partial > 0 ? Math.min(partial, full) : full;
        const rd = state.redemptionDates?.[`${cardKey}__${b.id}__${p.pk}`];
        const pos = rd ? cardYearPos(cardKey, rd.year, rd.month)
                       : cardYearPos(cardKey, p.calY ?? CY, p.calM ?? 0);
        if(pos >= 0 && pos < 12) claims.push({month:pos, amount});
      });
    });
  });
  return claims;
}

export function breakEvenForCard(cardKey){
  const {year:fy, month:fm} = getCardYearStart(cardKey, CY);
  const elapsed = (CY * 12 + CM) - (fy * 12 + fm) + 1;
  return buildBreakEven({
    claims: collectBreakEvenClaims(cardKey),
    fee: getFee(cardKey, CY),
    monthsElapsed: Math.min(Math.max(elapsed, 0), 12),
    label: CARD_LABELS[cardKey],
  });
}

// Portfolio-wide. Cards start their years on different months, so each card's
// claims are re-based onto a shared calendar-month axis before summing --
// otherwise month 3 would mean a different thing per card.
export function breakEvenForPortfolio(){
  const claims = [];
  let fee = 0;
  getVisibleCardKeys().forEach(cardKey=>{
    fee += getFee(cardKey, CY);
    const {year:fy, month:fm} = getCardYearStart(cardKey, CY);
    collectBreakEvenClaims(cardKey).forEach(c=>{
      const abs = (fy * 12 + fm) + c.month;      // back to absolute months
      const pos = abs - (CY * 12);               // then onto this calendar year
      if(pos >= 0 && pos < 12) claims.push({month:pos, amount:c.amount});
    });
  });
  return buildBreakEven({ claims, fee, monthsElapsed: CM + 1, label:'Portfolio' });
}

// The chart. Inline SVG in a viewBox so it scales with the container; all
// colour comes from theme tokens so it works in both themes.
export function breakEvenChartHTML(model, opts={}){
  const H=opts.compact?104:150, W=480, PL=8, PR=8, PT=12, PB=20;   // viewBox units
  const iw=W-PL-PR, ih=H-PT-PB;
  const {ceiling, fee, monthCount, monthsElapsed, actual, projected, crossed} = model;
  const x = i => PL + (monthCount<=1 ? 0 : (i/(monthCount-1))*iw);
  const y = v => PT + ih - Math.min(1, v/ceiling)*ih;

  const pt=(arr,off)=>arr.map((v,i)=>`${x(i+off).toFixed(1)},${y(v).toFixed(1)}`);
  const actualPts=pt(actual,0);
  // Join the projection onto the last real point so the line is continuous.
  const projPts=projected.length
    ? [actualPts[actualPts.length-1]||`${x(0)},${y(0)}`, ...pt(projected,monthsElapsed)].filter(Boolean)
    : [];

  const feeY=y(fee);
  const area=actualPts.length>1
    ? `<polygon points="${x(0).toFixed(1)},${y(0).toFixed(1)} ${actualPts.join(' ')} ${x(actual.length-1).toFixed(1)},${y(0).toFixed(1)}" fill="var(--green)" opacity="0.13"/>`
    : '';

  // Interpolate between the point before the crossing month and the crossing
  // itself; clamp so a first-month crossing sits on the axis, not off it.
  const crossX = crossed.reached && actual.length
    ? x(Math.max(0, crossed.month - 1 + crossed.fraction))
    : null;

  const labels=(opts.monthLabels||[]).map((l,i)=>
    i%2===0?`<text x="${x(i).toFixed(1)}" y="${H-5}" font-size="8" fill="var(--text-tertiary)" text-anchor="middle" font-family="var(--mono)">${l}</text>`:''
  ).join('');

  return `<svg class="be-chart" viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H}" role="img" aria-label="${escapeHtml(model.label)}: $${model.pace.captured.toFixed(0)} captured against a $${fee.toFixed(0)} annual fee">
    ${area}
    <line x1="${PL}" y1="${feeY.toFixed(1)}" x2="${W-PR}" y2="${feeY.toFixed(1)}" stroke="var(--red)" stroke-width="1" stroke-dasharray="3 3" opacity="0.75"/>
    <text x="${W-PR}" y="${(feeY-3).toFixed(1)}" font-size="8" fill="var(--red)" text-anchor="end" font-family="var(--mono)">fee $${fee.toFixed(0)}</text>
    ${projPts.length>1?`<polyline points="${projPts.join(' ')}" fill="none" stroke="var(--text-tertiary)" stroke-width="1.4" stroke-dasharray="3 3"/>`:''}
    ${actualPts.length>1?`<polyline points="${actualPts.join(' ')}" fill="none" stroke="var(--green)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`:''}
    ${actualPts.length?`<circle cx="${x(actual.length-1).toFixed(1)}" cy="${y(model.pace.captured).toFixed(1)}" r="2.6" fill="var(--green)"/>`:''}
    ${crossX!==null?`<circle cx="${crossX.toFixed(1)}" cy="${feeY.toFixed(1)}" r="2.6" fill="none" stroke="var(--gold)" stroke-width="1.6"/>`:''}
    ${labels}
  </svg>`;
}

// Month tick labels for a card year starting at `startMonth`.
function beMonthLabels(startMonth){
  return Array.from({length:12},(_,i)=>MONTHS[(startMonth+i)%12]);
}

export function renderBreakEven(){
  const port=breakEvenForPortfolio();
  const pv=breakEvenVerdict(port);
  const toneCol=t=>t==='good'?'var(--green)':t==='bad'?'var(--red)':'var(--gold)';

  let html=`<div class="banner"><strong>Break-even</strong> — capture against annual fees, across the year</div>`;

  html+=`<div class="be-hero">
    <div class="be-hero-top">
      <div>
        <div class="be-hero-val" style="color:${port.pace.captured>=port.fee?'var(--green)':'var(--text)'}">$${port.pace.captured.toFixed(0)}</div>
        <div class="be-hero-lbl">captured of $${port.fee.toFixed(0)} in fees</div>
      </div>
      <div style="text-align:right">
        <div class="be-hero-val" style="color:${port.pace.projectedNet>=0?'var(--green)':'var(--red)'}">${port.pace.projectedNet>=0?'+':'−'}$${Math.abs(port.pace.projectedNet).toFixed(0)}</div>
        <div class="be-hero-lbl">projected year end</div>
      </div>
    </div>
    ${breakEvenChartHTML(port,{monthLabels:beMonthLabels(0)})}
    <div class="be-verdict" style="color:${toneCol(pv.tone)}">${pv.text}</div>
  </div>`;

  html+=`<div class="section-header"><span class="section-title">By card</span><span class="section-period">card year</span></div>`;
  getVisibleCardKeys().forEach(k=>{
    const m=breakEvenForCard(k);
    const v=breakEvenVerdict(m);
    const {month:fm}=getCardYearStart(k,CY);
    html+=`<div class="be-card-row" onclick="goToCardPeriod('${k}')">
      <div class="be-card-head">
        <span class="all-cards-card-name ${CARD_CLS[k]||''}">${CARD_LABELS[k]}</span>
        <span class="be-card-num" style="color:${m.pace.captured>=m.fee?'var(--green)':'var(--text-secondary)'}">$${m.pace.captured.toFixed(0)} <span style="color:var(--text-tertiary)">/ $${m.fee.toFixed(0)}</span></span>
      </div>
      ${breakEvenChartHTML(m,{monthLabels:beMonthLabels(fm),compact:true})}
      <div class="be-verdict" style="color:${toneCol(v.tone)}">${v.text}</div>
    </div>`;
  });

  set(html);
}
