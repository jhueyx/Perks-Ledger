import { CARDS, MONTHS, MONTHS_FULL } from './cards.js';
import { state, CY, CM, CD } from './state.js';
import { isUsed, getCardFeeMonth, getCardFeeDay, isGloballySnoozed } from './storage.js';

// ── Period helpers ────────────────────────────────────────────────────────
export function getCardYearStart(c,forYear){
  const fm=getCardFeeMonth(c), fd=getCardFeeDay(c);
  const yr=forYear||state.selectedYear;
  if(yr<CY) return {year:yr,month:fm};
  const pastAnniversary=CM>fm||(CM===fm&&CD>=fd);
  return pastAnniversary?{year:CY,month:fm}:{year:CY-1,month:fm};
}
export function getCardYearMonths(c){ const {year,month:fm}=getCardYearStart(c); return Array.from({length:12},(_,i)=>({m:(fm+i)%12,y:year+Math.floor((fm+i)/12)})); }
export function isCalFuture(m,y){ return y>CY||(y===CY&&m>CM); }
export function isCalCurrent(m,y){ return m===CM&&y===CY; }
export function getPK(cadence,m,y){
  if(cadence==='monthly') return `${y}-m${m}`;
  if(cadence==='quarterly') return `${y}-q${Math.floor(m/3)}`;
  if(cadence==='semi-annual'||cadence==='cal-semi-annual') return `${y}-h${m<6?0:1}`;
  return `${y}-annual`;
}

export function getCardYearPeriods(cardKey,cadence){
  if(cadence==='feb-annual'){
    const out=[];
    const curStart=CM>=1?CY:CY-1;
    const prevStart=curStart-1;
    const {year:fy}=getCardYearStart(cardKey);
    if(fy<=prevStart) out.push({m:1,y:prevStart,pk:`feb-${prevStart}`,lbl:`Feb ${prevStart}–Jan ${prevStart+1}`,calM:1,calY:prevStart,endM:0,endY:prevStart+1});
    out.push({m:1,y:curStart,pk:`feb-${curStart}`,lbl:`Feb ${curStart}–Jan ${curStart+1}`,calM:1,calY:curStart,endM:0,endY:curStart+1});
    return out;
  }
  if(cadence==='cal-annual-overlap'){
    const years=[...new Set(getCardYearMonths(cardKey).map(mo=>mo.y))];
    const openedYear=state.cardMeta?.[cardKey]?.openedYear??CARDS[cardKey].openedYear;
    return years
      .filter(y=>!openedYear||y>=openedYear)
      .map(y=>({m:0,y,pk:`${y}-annual`,lbl:`${y}`,calM:0,calY:y}));
  }
  if(cadence==='cal-annual'){
    const {year:fy}=getCardYearStart(cardKey);
    const openedYear=state.cardMeta?.[cardKey]?.openedYear??CARDS[cardKey].openedYear;
    const out=[];
    if(fy<CY&&(!openedYear||fy>=openedYear)) out.push({m:0,y:fy,pk:`${fy}-annual`,lbl:`${fy}`,calM:0,calY:fy});
    if(!openedYear||CY>=openedYear) out.push({m:0,y:CY,pk:`${CY}-annual`,lbl:`${CY}`,calM:0,calY:CY});
    return out;
  }
  if(cadence==='cal-semi-annual'){
    const openedYear=state.cardMeta?.[cardKey]?.openedYear??CARDS[cardKey].openedYear;
    const months=getCardYearMonths(cardKey);
    const seen=new Set(),out=[];
    months.forEach(mo=>{
      const pk=getPK('cal-semi-annual',mo.m,mo.y);
      if(!seen.has(pk)){
        seen.add(pk);
        const isH1=mo.m<6;
        const endY=mo.y,endM=isH1?5:11;
        if(openedYear&&endY<openedYear) return;
        out.push({m:isH1?0:6,y:mo.y,pk,lbl:isH1?`Jan–Jun ${mo.y}`:`Jul–Dec ${mo.y}`,calM:isH1?0:6,calY:mo.y,endM,endY});
      }
    });
    return out;
  }
  const months=getCardYearMonths(cardKey);
  if(cadence==='monthly') return months.map(mo=>({m:mo.m,y:mo.y,pk:getPK(cadence,mo.m,mo.y),lbl:MONTHS[mo.m],calM:mo.m,calY:mo.y}));
  const seen=new Set(),out=[];
  if(cadence==='quarterly'){
    months.forEach(mo=>{ const pk=getPK(cadence,mo.m,mo.y); if(!seen.has(pk)){seen.add(pk);out.push({m:mo.m,y:mo.y,pk,lbl:`Q${Math.floor(mo.m/3)+1}`,calM:mo.m,calY:mo.y});} });
  } else if(cadence==='semi-annual'){
    const {year:fy,month:fm}=getCardYearStart(cardKey);
    out.push({m:months[0].m,y:months[0].y,pk:`cy-${fy}-${fm}-h1`,lbl:'H1',calM:months[0].m,calY:months[0].y,endM:months[5].m,endY:months[5].y});
    if(months[6]) out.push({m:months[6].m,y:months[6].y,pk:`cy-${fy}-${fm}-h2`,lbl:'H2',calM:months[6].m,calY:months[6].y,endM:months[11].m,endY:months[11].y});
  } else {
    const {year:fy,month:fm}=getCardYearStart(cardKey);
    out.push({m:months[0].m,y:months[0].y,pk:`cy-${fy}-${fm}-annual`,lbl:`${MONTHS[months[0].m]} ${months[0].y}–${MONTHS[months[11].m]} ${months[11].y}`,calM:months[0].m,calY:months[0].y,endM:months[11].m,endY:months[11].y});
  }
  return out;
}

export function getYTDPeriods(cadence){
  const SY=state.selectedYear;
  const isCurrentYear=SY===CY;
  const isFutureYear=SY>CY;
  const lastMonth=isCurrentYear?CM:(isFutureYear?-1:11);
  if(cadence==='feb-annual'){
    const curStart=SY>=CY&&CM>=1?CY:SY;
    return [{m:1,y:curStart,pk:`feb-${curStart}`,lbl:`Feb ${curStart}–Jan ${curStart+1}`,calM:1,calY:curStart,endM:0,endY:curStart+1}];
  }
  if(cadence==='cal-annual-overlap') return getYTDPeriods('cal-annual');
  if(cadence==='monthly') return Array.from({length:lastMonth+1},(_,m)=>({m,y:SY,pk:getPK(cadence,m,SY),lbl:MONTHS[m],calM:m,calY:SY}));
  if(cadence==='quarterly'){ const seen=new Set(),out=[]; for(let m=0;m<=lastMonth;m++){ const pk=getPK(cadence,m,SY); if(!seen.has(pk)){seen.add(pk);out.push({m,y:SY,pk,lbl:`Q${Math.floor(m/3)+1}`,calM:m,calY:SY});} } return out; }
  if(cadence==='semi-annual'||cadence==='cal-semi-annual'){
    const out=[{m:0,y:SY,pk:getPK('cal-semi-annual',0,SY),lbl:`H1 (Jan–Jun ${SY})`,calM:0,calY:SY,endM:5,endY:SY}];
    if(lastMonth>=6) out.push({m:6,y:SY,pk:getPK('cal-semi-annual',6,SY),lbl:`H2 (Jul–Dec ${SY})`,calM:6,calY:SY,endM:11,endY:SY});
    return out;
  }
  return [{m:0,y:SY,pk:`${SY}-annual`,lbl:`${SY}`,calM:0,calY:SY}];
}

export function isPFuture(p){ return isCalFuture(p.calM,p.calY); }
export function isPCurrent(cadence,p){
  if(cadence==='monthly') return isCalCurrent(p.calM,p.calY);
  if(cadence==='quarterly') return Math.floor(p.calM/3)===Math.floor(CM/3)&&p.calY===CY;
  if(cadence==='semi-annual'){ const s=p.calY*12+p.calM,e=(p.endY||CY)*12+(p.endM!==undefined?p.endM:11),n=CY*12+CM; return n>=s&&n<=e; }
  if(cadence==='cal-semi-annual'){ const s=p.calY*12+p.calM,e=p.calY*12+(p.endM!==undefined?p.endM:11),n=CY*12+CM; return n>=s&&n<=e; }
  if(cadence==='cal-annual'||cadence==='cal-annual-overlap') return p.calY===CY;
  if(cadence==='feb-annual'){ const s=p.calY*12+1,e=(p.endY||p.calY+1)*12+(p.endM!==undefined?p.endM:0),n=CY*12+CM; return n>=s&&n<=e; }
  return !isPFuture(p);
}
export function isYTDCurrent(cadence,p){
  if(state.selectedYear<CY) return false;
  if(cadence==='monthly') return isCalCurrent(p.calM,p.calY);
  if(cadence==='quarterly') return Math.floor(p.calM/3)===Math.floor(CM/3)&&p.calY===CY;
  if(cadence==='semi-annual'||cadence==='cal-semi-annual'){ const s=p.calY*12+p.calM,e=p.calY*12+(p.endM!==undefined?p.endM:11),n=CY*12+CM; return n>=s&&n<=e; }
  if(cadence==='feb-annual'){ const s=p.calY*12+1,e=(p.endY||p.calY+1)*12+(p.endM!==undefined?p.endM:0),n=CY*12+CM; return n>=s&&n<=e; }
  return false;
}
export function getCurrentPK(cardKey,cadence){
  const ps=getCardYearPeriods(cardKey,cadence);
  for(const p of ps){if(isPCurrent(cadence,p)) return p.pk;}
  let last=null; for(const p of ps){if(!isPFuture(p)) last=p;}
  return last?last.pk:ps[0].pk;
}
export function getCurrentLabel(cardKey,cadence){
  if(cadence==='monthly') return `${MONTHS_FULL[CM]} ${CY}`;
  const ps=getCardYearPeriods(cardKey,cadence);
  for(const p of ps){if(isPCurrent(cadence,p)) return p.lbl+(p.endM!==undefined&&!p.lbl.includes('–')?` (${MONTHS[p.calM]}–${MONTHS[p.endM]})`:'');}
  return '';
}

export function getBAmount(b,p){ return (b.decAmount&&p.m===11)?b.decAmount:b.amount; }
export function getFee(cardKey,year){
  const card=CARDS[cardKey];
  year=year||state.selectedYear;
  return (card.historicalFees&&card.historicalFees[year]!==undefined)?card.historicalFees[year]:card.fee;
}
export function isBExpired(b,p){
  if(!b.expiresAfter) return false;
  const {y,h}=b.expiresAfter;
  const expAbs=y*12+(h===0?5:11);
  const pAbs=p.calY*12+p.calM;
  return pAbs>expAbs;
}
export function isBNotAvailable(b,viewYear,p){
  if(b.startsFrom){
    const checkYear=p?(p.endY!==undefined?p.endY:p.calY):viewYear;
    if(checkYear<b.startsFrom) return true;
  }
  if(b.halfStart!==undefined&&p!==undefined&&Math.floor(p.calM/6)<b.halfStart) return true;
  if(b.halfEnd!==undefined&&p!==undefined&&Math.floor(p.calM/6)>b.halfEnd) return true;
  return false;
}

export function calcStats(cardKey,getPsFn,isCurFn){
  const card=CARDS[cardKey]; let captured=0,missed=0,total=0;
  card.sections.forEach(s=>{ const ps=getPsFn(s.cadence); ps.forEach(p=>{ const fut=isPFuture(p),cur=isCurFn(s.cadence,p); s.benefits.forEach(b=>{ if(isBExpired(b,p)||isBNotAvailable(b,state.selectedYear,p)||isGloballySnoozed(cardKey,b.id)) return; const amt=getBAmount(b,p); total+=amt; const used=isUsed(cardKey,b.id,p.pk); if(used) captured+=amt; else if(!fut&&!cur) missed+=amt; }); }); });
  return {captured,missed,total};
}

export function metricsHTML(m1l,m1v,m2l,m2v,m3l,m3v,m4l,m4v,m4cls=''){
  return `<div class="metrics">
    <div class="metric"><div class="metric-label">${m1l}</div><div class="metric-val">${m1v}</div></div>
    <div class="metric"><div class="metric-label">${m2l}</div><div class="metric-val green">${m2v}</div></div>
    <div class="metric"><div class="metric-label">${m3l}</div><div class="metric-val blue">${m3v}</div></div>
    <div class="metric"><div class="metric-label">${m4l}</div><div class="metric-val ${m4cls}">${m4v}</div></div>
  </div>`;
}
export function progressHTML(pct,left,right){
  return `<div class="progress-wrap"><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><div class="progress-labels"><span>${pct}% captured</span><span>${right}</span></div></div>`;
}

// ── Streak / days ──────────────────────────────────────────────────────────
export function getStreak(cardKey,benefitId){
  let streak=0,m=CM,y=CY;
  while(y>=CY-2){
    const pk=getPK('monthly',m,y);
    if(isUsed(cardKey,benefitId,pk)) streak++;
    else break;
    if(m>0) m--; else { m=11; y--; }
  }
  return streak;
}
export function getLongestStreak(cardKey,benefitId){
  const months=Object.entries(state.DATA[cardKey]||{})
    .filter(([k,v])=>v===true&&k.startsWith(`${benefitId}__`))
    .map(([k])=>{
      const m=/__(\d{4})-m(\d{1,2})$/.exec(k);
      if(!m) return null;
      return Number(m[1])*12+Number(m[2]);
    })
    .filter(v=>v!==null)
    .sort((a,b)=>a-b);
  let best=0,cur=0,prev=null;
  months.forEach(abs=>{
    cur=prev!==null&&abs===prev+1?cur+1:1;
    if(cur>best) best=cur;
    prev=abs;
  });
  return best;
}
export function daysUntilFee(cardKey){
  const fm=getCardFeeMonth(cardKey),fd=getCardFeeDay(cardKey);
  const now=new Date();
  let feeDate=new Date(now.getFullYear(),fm,fd);
  if(feeDate<=now) feeDate=new Date(now.getFullYear()+1,fm,fd);
  return Math.ceil((feeDate-now)/(1000*60*60*24));
}
export function daysUntilEOM(){
  const now=new Date();
  const eom=new Date(now.getFullYear(),now.getMonth()+1,0);
  return Math.ceil((eom-now)/(1000*60*60*24));
}
export function getUnclaimedMonthly(cardKey){
  const card=CARDS[cardKey];
  const unclaimed=[];
  card.sections.forEach(s=>{
    if(s.cadence!=='monthly') return;
    const pk=getCurrentPK(cardKey,s.cadence);
    s.benefits.forEach(b=>{
      if(isBExpired(b,{calY:CY,calM:CM,m:CM})||isBNotAvailable(b,CY,{calM:CM,calY:CY})||isGloballySnoozed(cardKey,b.id)) return;
      if(!isUsed(cardKey,b.id,pk)) unclaimed.push({name:b.name,amt:getBAmount(b,{m:CM})});
    });
  });
  return unclaimed;
}
export function maxCardYearValue(cardKey){
  const card=CARDS[cardKey]; let t=0;
  card.sections.forEach(s=>{
    const ps=getCardYearPeriods(cardKey,s.cadence);
    s.benefits.forEach(b=>{
      if(isGloballySnoozed(cardKey,b.id)) return;
      ps.forEach(p=>{
        if(isBExpired(b,p)||isBNotAvailable(b,CY,p)) return;
        t+=getBAmount(b,p);
      });
    });
  });
  return t;
}

// ── Projections ────────────────────────────────────────────────────────────
export function calcCapturedByType(cardKey){
  const card=CARDS[cardKey];
  const REPEATING=['monthly','quarterly'];
  let repeating=0,oneTime=0;
  const {year:cyStart,month:cyStartMonth}=getCardYearStart(cardKey,CY);
  const cyStartAbs=cyStart*12+cyStartMonth;
  const cyEndAbs=cyStartAbs+11;
  card.sections.forEach(s=>{
    const isRepeating=REPEATING.includes(s.cadence);
    const ps=getCardYearPeriods(cardKey,s.cadence);
    ps.forEach(p=>{
      if(isPFuture(p)) return;
      if(isRepeating){
        const pAbs=p.calY*12+p.calM;
        if(pAbs<cyStartAbs||pAbs>cyEndAbs) return;
      }
      s.benefits.forEach(b=>{
        if(isBExpired(b,p)||isBNotAvailable(b,CY,p)||isGloballySnoozed(cardKey,b.id)) return;
        if(!isUsed(cardKey,b.id,p.pk)) return;
        const amt=getBAmount(b,p);
        if(isRepeating) repeating+=amt;
        else oneTime+=amt;
      });
    });
  });
  return {repeating,oneTime};
}
export function getCardYearMonthsElapsed(cardKey){
  const {year:cyYear,month:fm}=getCardYearStart(cardKey,CY);
  const cyStartAbs=cyYear*12+fm;
  const currentAbs=CY*12+CM;
  return Math.max(1,Math.min(12,currentAbs-cyStartAbs+1));
}
export function getProjectedCapture(cardKey){
  const monthsElapsed=getCardYearMonthsElapsed(cardKey);
  const monthsRemaining=12-monthsElapsed;
  const {repeating,oneTime}=calcCapturedByType(cardKey);
  const projectedRepeating=monthsRemaining>0?(repeating/monthsElapsed)*monthsRemaining:0;
  return oneTime+repeating+projectedRepeating;
}
export function getROIGrade(fee,cardKey){
  const projected=getProjectedCapture(cardKey);
  const gap=fee-projected;
  if(gap<=0) return 'A';
  if(gap<=250) return 'B';
  if(gap<=500) return 'C';
  return 'D';
}
