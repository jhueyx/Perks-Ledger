import { CARDS, FEE_MONTHS } from './cards.js';
import { state, STORAGE_KEY, sb, freshDATA, CY, CM } from './state.js';

// ── Data helpers ──────────────────────────────────────────────────────────
export function bKey(id,pk){ return `${id}__${pk}`; }
export function isUsed(card,id,pk){ return !!(state.DATA[card]||{})[bKey(id,pk)]; }
export function toggle(card,id,pk){
  if(!state.DATA[card]) state.DATA[card]={};
  const k=bKey(id,pk);
  state.DATA[card][k]=!state.DATA[card][k];
  const action=state.DATA[card][k]?'used':'unused';
  if(action==='used') setRedemptionMonth(card,id,pk,CY,CM);
  else clearRedemptionMonth(card,id,pk);
  scheduleSave();
  document.dispatchEvent(new CustomEvent('perks:benefit-toggled',{detail:{cardKey:card,id,pk,action}}));
  if(sb&&state.currentUser){
    sb.from('benefit_log').insert({user_id:state.currentUser.id,card_key:card,benefit_id:id,period_key:pk,action}).then(({error:e})=>{if(e)console.error('[benefit_log]',e.message,e.code,e.details,e.hint);}).catch(e=>console.error('[benefit_log throw]',e));
  }
}

// ── Supabase sync ─────────────────────────────────────────────────────────
export async function syncFromSupabase(){
  if(!state.currentUser||state.currentUser.id==='demo') return;
  try{
    const {data,error}=await sb.from('tracker_data').select('data,updated_at').eq('user_id',state.currentUser.id).single();
    if(!error&&data&&data.data){
      const localTs=localStorage.getItem(STORAGE_KEY+'-ts-'+state.currentUser.id);
      if(localTs&&data.updated_at&&new Date(data.updated_at)<=new Date(localTs)) return;
      const raw=data.data;
      const remoteExtras={_customAmounts:raw._customAmounts||{},_customNames:raw._customNames||{},_partial:raw._partial||{},_notes:raw._notes||{},_credited:raw._credited||{},_skipped:raw._skipped||{},_feeOverrides:raw._feeOverrides||{},_snoozed:raw._snoozed||{},_cardOrder:raw._cardOrder||[],_cardMeta:raw._cardMeta||{},_badges:raw._badges||{},_redemptionMonths:raw._redemptionMonths||{},_pointsRedeemed:raw._pointsRedeemed||{},_pointsSources:raw._pointsSources||{}};
      const benefitData={...raw};
      delete benefitData._customAmounts; delete benefitData._customNames; delete benefitData._partial; delete benefitData._notes; delete benefitData._credited; delete benefitData._skipped; delete benefitData._feeOverrides; delete benefitData._snoozed; delete benefitData._cardOrder; delete benefitData._cardMeta; delete benefitData._badges; delete benefitData._redemptionMonths; delete benefitData._pointsRedeemed; delete benefitData._pointsSources;
      const localExtras={_customAmounts:loadCustomAmounts(),_customNames:loadCustomNames(),_partial:loadPartial(),_notes:loadNotes(),_credited:loadCredited(),_skipped:loadSkipped(),_feeOverrides:getFeeOverrides(),_snoozed:loadSnoozed(),_cardOrder:JSON.parse(localStorage.getItem('perks-card-order')||'[]'),_cardMeta:loadCardMeta(),_badges:loadBadges(),_redemptionMonths:loadRedemptionMonths(),_pointsRedeemed:loadPointsRedeemed(),_pointsSources:loadPointsSources()};
      const changed=JSON.stringify(benefitData)!==JSON.stringify(state.DATA)||JSON.stringify(remoteExtras)!==JSON.stringify(localExtras);
      if(changed){
        state.DATA=Object.assign(freshDATA(),benefitData);
        localStorage.setItem(STORAGE_KEY+'-'+state.currentUser.id,JSON.stringify(state.DATA));
        localStorage.setItem(STORAGE_KEY+'-ts-'+state.currentUser.id,data.updated_at);
        saveCustomAmounts(remoteExtras._customAmounts);
        saveCustomNames(remoteExtras._customNames);
        savePartial(remoteExtras._partial);
        saveNotes(remoteExtras._notes);
        saveCredited(remoteExtras._credited);
        saveSkipped(remoteExtras._skipped);
        if(Object.keys(remoteExtras._feeOverrides).length) saveFeeOverridesData(remoteExtras._feeOverrides);
        if(Object.keys(remoteExtras._snoozed).length) saveSnoozed(remoteExtras._snoozed);
        if(remoteExtras._cardOrder.length) localStorage.setItem('perks-card-order',JSON.stringify(remoteExtras._cardOrder));
        if(Object.keys(remoteExtras._cardMeta).length) saveCardMetaData(remoteExtras._cardMeta);
        if(Object.keys(remoteExtras._badges).length) saveBadges(remoteExtras._badges);
        if(Object.keys(remoteExtras._redemptionMonths).length) saveRedemptionMonths(remoteExtras._redemptionMonths);
        if(Object.keys(remoteExtras._pointsRedeemed).length) savePointsRedeemedData(remoteExtras._pointsRedeemed);
        if(Object.keys(remoteExtras._pointsSources).length) savePointsSourcesData(remoteExtras._pointsSources);
        document.dispatchEvent(new CustomEvent('perks:rerender'));
      }
    }
  }catch(e){}
}

export async function saveToStorage(){
  if(!state.currentUser) return;
  if(state.currentUser.id==='demo'){ setSave('saved','✓ saved locally'); setTimeout(()=>setSave('',''),2000); return; }
  setSave('saving','saving…');
  const ts=new Date().toISOString();
  try{
    localStorage.setItem(STORAGE_KEY+'-'+state.currentUser.id,JSON.stringify(state.DATA));
    localStorage.setItem(STORAGE_KEY+'-ts-'+state.currentUser.id,ts);
  }catch(e){}
  try{
    const payload={...state.DATA,_customAmounts:loadCustomAmounts(),_customNames:loadCustomNames(),_partial:loadPartial(),_notes:loadNotes(),_credited:loadCredited(),_skipped:loadSkipped(),_feeOverrides:getFeeOverrides(),_snoozed:loadSnoozed(),_cardOrder:JSON.parse(localStorage.getItem('perks-card-order')||'[]'),_cardMeta:loadCardMeta(),_badges:loadBadges(),_redemptionMonths:loadRedemptionMonths(),_pointsRedeemed:loadPointsRedeemed(),_pointsSources:loadPointsSources()};
    const {data:updated,error:upErr}=await sb.from('tracker_data').update({data:payload,updated_at:ts}).eq('user_id',state.currentUser.id).select('user_id');
    if(upErr) throw upErr;
    if(!updated||updated.length===0){
      const {error:insErr}=await sb.from('tracker_data').insert({user_id:state.currentUser.id,data:payload,updated_at:ts});
      if(insErr) throw insErr;
    }
    setSave('saved','✓ saved');
    setTimeout(()=>setSave('',''),2000);
  }catch(e){
    console.error('[tracker_data save error]',e?.message,e?.code,e?.details,e?.hint);
    setSave('error','⚠ cloud sync failed — saved locally');
    setTimeout(()=>setSave('',''),3000);
  }
}
export function scheduleSave(){ clearTimeout(state.saveTimer); state.saveTimer=setTimeout(saveToStorage,600); }
export function setSave(cls,msg){ const el=document.getElementById('saveStatus'); if(el){el.className='save-status'+(cls?' '+cls:''); el.textContent=msg;} }

// ── Custom amounts ─────────────────────────────────────────────────────────
const CUSTOM_AMOUNTS_KEY='perks-custom-amounts';
export function loadCustomAmounts(){ try{ return JSON.parse(localStorage.getItem(CUSTOM_AMOUNTS_KEY)||'{}'); }catch(e){ return {}; } }
export function saveCustomAmounts(d){ localStorage.setItem(CUSTOM_AMOUNTS_KEY,JSON.stringify(d)); }
export function getEffectiveAmount(cardKey,benefitId,baseAmount){
  const custom=loadCustomAmounts();
  return custom[`${cardKey}__${benefitId}`]||baseAmount;
}
export function setCustomAmount(cardKey,benefitId,amount){
  const d=loadCustomAmounts();
  if(amount===null) delete d[`${cardKey}__${benefitId}`];
  else d[`${cardKey}__${benefitId}`]=amount;
  saveCustomAmounts(d);
}

// ── Custom benefit names ───────────────────────────────────────────────────
// Lets "Dining Credit" be renamed to "Grubhub" so a benefit reads as whatever
// the user actually spends it on. Stored per card+benefit, exactly like custom
// amounts. Views should call bName() rather than reading b.name directly.
const CUSTOM_NAMES_KEY='perks-custom-names';
export function loadCustomNames(){ try{ return JSON.parse(localStorage.getItem(CUSTOM_NAMES_KEY)||'{}'); }catch(e){ return {}; } }
export function saveCustomNames(d){ localStorage.setItem(CUSTOM_NAMES_KEY,JSON.stringify(d)); }
export function getCustomName(cardKey,benefitId){ return loadCustomNames()[`${cardKey}__${benefitId}`]||''; }
export function bName(cardKey,b){ return (b&&(loadCustomNames()[`${cardKey}__${b.id}`]||b.name))||''; }
export function setCustomName(cardKey,benefitId,name){
  const d=loadCustomNames();
  const k=`${cardKey}__${benefitId}`;
  const trimmed=(name||'').trim();
  if(!trimmed) delete d[k];
  else d[k]=trimmed;
  saveCustomNames(d);
  scheduleSave();
}

// ── Partial use ────────────────────────────────────────────────────────────
const PARTIAL_KEY='perks-partial';
export function loadPartial(){ try{ return JSON.parse(localStorage.getItem(PARTIAL_KEY)||'{}'); }catch(e){ return {}; } }
export function savePartial(d){ localStorage.setItem(PARTIAL_KEY,JSON.stringify(d)); }
export function getPartialKey(cardKey,benefitId,pk){ return `${cardKey}__${benefitId}__${pk}`; }
export function getPartialUsed(cardKey,benefitId,pk){ return loadPartial()[getPartialKey(cardKey,benefitId,pk)]||0; }
export function getBenefitTotal(cardKey,benefitId){
  const card=CARDS[cardKey];
  let totalAmt=0;
  card.sections.forEach(s=>s.benefits.forEach(b=>{ if(b.id===benefitId) totalAmt=b.amount; }));
  return totalAmt;
}
// Sets the partial-use dollar amount and derives isUsed from amount vs the
// benefit's full total. Mirrors toggle()'s side effects (redemption-month
// tracking, benefit_log activity entry) whenever the derived used-state
// actually changes, so partial benefits keep the same history/streak/
// achievement behavior as fully-toggled ones.
export function setPartialUsed(cardKey,benefitId,pk,amount){
  const d=loadPartial();
  d[getPartialKey(cardKey,benefitId,pk)]=amount;
  savePartial(d);
  const totalAmt=getBenefitTotal(cardKey,benefitId);
  const wasUsed=isUsed(cardKey,benefitId,pk);
  const nowUsed=totalAmt>0&&amount>=totalAmt;
  if(!state.DATA[cardKey]) state.DATA[cardKey]={};
  state.DATA[cardKey][bKey(benefitId,pk)]=nowUsed;
  if(nowUsed!==wasUsed){
    const action=nowUsed?'used':'unused';
    if(action==='used') setRedemptionMonth(cardKey,benefitId,pk,CY,CM);
    else clearRedemptionMonth(cardKey,benefitId,pk);
    document.dispatchEvent(new CustomEvent('perks:benefit-toggled',{detail:{cardKey,id:benefitId,pk,action}}));
    if(sb&&state.currentUser){
      sb.from('benefit_log').insert({user_id:state.currentUser.id,card_key:cardKey,benefit_id:benefitId,period_key:pk,action}).then(({error:e})=>{if(e)console.error('[benefit_log]',e.message,e.code,e.details,e.hint);}).catch(e=>console.error('[benefit_log throw]',e));
    }
  }
  scheduleSave();
}

// ── Notes ──────────────────────────────────────────────────────────────────
const NOTES_KEY='perks-notes';
export function loadNotes(){ try{ return JSON.parse(localStorage.getItem(NOTES_KEY)||'{}'); }catch(e){ return {}; } }
export function saveNotes(notes){ try{ localStorage.setItem(NOTES_KEY,JSON.stringify(notes)); }catch(e){} }
export function getNoteKey(cardKey,benefitId,pk){ return `${cardKey}__${benefitId}__${pk}`; }
export function getNote(cardKey,benefitId,pk){ return loadNotes()[getNoteKey(cardKey,benefitId,pk)]||''; }

// ── Credited ───────────────────────────────────────────────────────────────
const CREDITED_KEY='perks-credited';
export function loadCredited(){ try{ return JSON.parse(localStorage.getItem(CREDITED_KEY)||'{}'); }catch(e){ return {}; } }
export function saveCredited(d){ localStorage.setItem(CREDITED_KEY,JSON.stringify(d)); }
export function isCredited(cardKey,id,pk){ return !!(loadCredited()[`${cardKey}__${id}__${pk}`]); }
export function toggleCredited(cardKey,id,pk){
  const d=loadCredited();
  const k=`${cardKey}__${id}__${pk}`;
  d[k]=!d[k];
  saveCredited(d);
}

// ── Badges ────────────────────────────────────────────────────────────────
// Scoped per-user, same as STORAGE_KEY above — this was previously a bare
// global key shared by every account on the same browser (see badges.js).
function badgesKey(){ return 'perks-badges'+(state.currentUser?'-'+state.currentUser.id:''); }
export function loadBadges(){ try{ return JSON.parse(localStorage.getItem(badgesKey())||'{}'); }catch(e){ return {}; } }
export function saveBadges(d){ localStorage.setItem(badgesKey(),JSON.stringify(d)); }

// ── Skipped ────────────────────────────────────────────────────────────────
const SKIPPED_KEY='perks-skipped';
export function loadSkipped(){ try{ return JSON.parse(localStorage.getItem(SKIPPED_KEY)||'{}'); }catch(e){ return {}; } }
export function saveSkipped(d){ localStorage.setItem(SKIPPED_KEY,JSON.stringify(d)); }
export function isSkipped(cardKey,id,pk){ return !!(loadSkipped()[`${cardKey}__${id}__${pk}`]); }
export function skipBenefit(cardKey,id,pk){
  const d=loadSkipped();
  d[`${cardKey}__${id}__${pk}`]=true;
  saveSkipped(d);
  scheduleSave();
  document.dispatchEvent(new CustomEvent('perks:benefit-skipped',{detail:{cardKey,id,pk}}));
  document.dispatchEvent(new CustomEvent('perks:rerender'));
}
export function unskipBenefit(cardKey,id,pk){
  const d=loadSkipped();
  delete d[`${cardKey}__${id}__${pk}`];
  saveSkipped(d);
  scheduleSave();
  document.dispatchEvent(new CustomEvent('perks:rerender'));
}
export function clearAllSkipped(){
  saveSkipped({});
  scheduleSave();
  document.dispatchEvent(new CustomEvent('perks:rerender'));
}
export function countSkipped(){ return Object.keys(loadSkipped()).length; }

// ── Benefit snooze ────────────────────────────────────────────────────────
// Stores { 'cardKey__benefitId': {from:'YYYY-MM',until:'YYYY-MM'} }
// Legacy string format (just 'until') is auto-upgraded on read.
const SNOOZED_KEY='perks-snoozed';
export function loadSnoozed(){ try{ return JSON.parse(localStorage.getItem(SNOOZED_KEY)||'{}'); }catch(e){ return {}; } }
export function saveSnoozed(d){ localStorage.setItem(SNOOZED_KEY,JSON.stringify(d)); }
function parseSnoozed(raw){ if(!raw) return null; if(typeof raw==='string') return {from:'2000-01',until:raw}; return raw; }
export function getSnoozedUntil(cardKey,benefitId){ return parseSnoozed(loadSnoozed()[`${cardKey}__${benefitId}`])?.until||null; }
export function getSnoozedFrom(cardKey,benefitId){ return parseSnoozed(loadSnoozed()[`${cardKey}__${benefitId}`])?.from||null; }
export function isGloballySnoozed(cardKey,benefitId){
  const p=parseSnoozed(loadSnoozed()[`${cardKey}__${benefitId}`]);
  if(!p) return false;
  const now=new Date(), nowAbs=now.getFullYear()*12+now.getMonth()+1;
  const [uy,um]=p.until.split('-').map(Number);
  const [fy,fm]=p.from.split('-').map(Number);
  return nowAbs>=fy*12+fm && nowAbs<=uy*12+um;
}
export function isMonthSnoozed(cardKey,benefitId,calY,calM0){
  // calM0 is 0-indexed (0=Jan)
  const p=parseSnoozed(loadSnoozed()[`${cardKey}__${benefitId}`]);
  if(!p) return false;
  const mAbs=calY*12+(calM0+1);
  const [uy,um]=p.until.split('-').map(Number);
  const [fy,fm]=p.from.split('-').map(Number);
  return mAbs>=fy*12+fm && mAbs<=uy*12+um;
}
export function setSnoozedBenefit(cardKey,benefitId,fromYYYYMM,untilYYYYMM){
  const d=loadSnoozed();
  const k=`${cardKey}__${benefitId}`;
  if(untilYYYYMM==null){ delete d[k]; }
  else {
    // YYYY-MM strings sort lexically; swap a reversed range so it isn't a silent no-op.
    let from=fromYYYYMM||untilYYYYMM, until=untilYYYYMM;
    if(from>until) [from,until]=[until,from];
    d[k]={from,until};
  }
  saveSnoozed(d);
  scheduleSave();
}

// ── Card open dates ────────────────────────────────────────────────────────
const CARD_META_KEY='perks-card-meta';
export function loadCardMeta(){ try{ return JSON.parse(localStorage.getItem(CARD_META_KEY)||'{}'); }catch(e){ return {}; } }
export function saveCardMetaData(d){ localStorage.setItem(CARD_META_KEY,JSON.stringify(d)); state.cardMeta=d; }
export function setCardOpenedDate(cardKey,year,month){
  const d=loadCardMeta();
  if(!year){ delete d[cardKey]; } else { d[cardKey]={openedYear:year,openedMonth:month??0}; }
  saveCardMetaData(d);
}

// ── Redemption months ─────────────────────────────────────────────────────
// Stores {year, month} for each benefit the user has marked used.
// Auto-written on toggle; editable via the heatmap detail sheet for old data.
const REDEMPTION_MONTHS_KEY='perks-redemption-dates';
export function loadRedemptionMonths(){ try{ return JSON.parse(localStorage.getItem(REDEMPTION_MONTHS_KEY)||'{}'); }catch(e){ return {}; } }
export function saveRedemptionMonths(d){ localStorage.setItem(REDEMPTION_MONTHS_KEY,JSON.stringify(d)); state.redemptionDates=d; }
export function setRedemptionMonth(card,id,pk,year,month){
  const d=loadRedemptionMonths();
  d[`${card}__${id}__${pk}`]={year,month};
  saveRedemptionMonths(d);
}
export function clearRedemptionMonth(card,id,pk){
  const d=loadRedemptionMonths();
  delete d[`${card}__${id}__${pk}`];
  saveRedemptionMonths(d);
}

// ── Fee date overrides ─────────────────────────────────────────────────────
export function getFeeOverrides(){ if(!state._feeOverrides) state._feeOverrides=JSON.parse(localStorage.getItem('perks-fee-overrides')||'{}'); return state._feeOverrides; }
export function saveFeeOverridesData(d){ state._feeOverrides=d; localStorage.setItem('perks-fee-overrides',JSON.stringify(d)); }
export function getCardFeeMonth(cardKey){ return getFeeOverrides()[cardKey]?.feeMonth??FEE_MONTHS[cardKey]??0; }
export function getCardFeeDay(cardKey){ return getFeeOverrides()[cardKey]?.feeDay??CARDS[cardKey]?.feeDay??1; }

// ── Points redeemed (cash value from points redemptions, not statement credits) ──
// Key format: cardKey → { "YYYY-M": amount }  (M is 0-indexed, same as CM)
const POINTS_REDEEMED_KEY='perks-points-redeemed';
export function loadPointsRedeemed(){ try{ return JSON.parse(localStorage.getItem(POINTS_REDEEMED_KEY)||'{}'); }catch(e){ return {}; } }
export function savePointsRedeemedData(d){ localStorage.setItem(POINTS_REDEEMED_KEY,JSON.stringify(d)); }
export function setPointsRedeemed(cardKey,yearMonth,amount){
  const d=loadPointsRedeemed();
  if(!d[cardKey]) d[cardKey]={};
  if(!amount||amount<=0) delete d[cardKey][yearMonth];
  else d[cardKey][yearMonth]=amount;
  savePointsRedeemedData(d);
  scheduleSave();
}
export function getPointsRedeemed(cardKey,yearMonth){ return (loadPointsRedeemed()[cardKey]||{})[yearMonth]||0; }

// ── Points redemption source ───────────────────────────────────────────────
// Where a redemption came from — welcome bonus, ongoing spend, referral, etc.
// User-declared only: the app has no way to know, and a first-year welcome
// bonus must never be presented as recurring annual value. Key: cardKey__YYYY-M
const POINTS_SOURCES_KEY='perks-points-sources';
export function loadPointsSources(){ try{ return JSON.parse(localStorage.getItem(POINTS_SOURCES_KEY)||'{}'); }catch(e){ return {}; } }
export function savePointsSourcesData(d){ localStorage.setItem(POINTS_SOURCES_KEY,JSON.stringify(d)); }
export function getPointsSource(cardKey,yearMonth){ return loadPointsSources()[`${cardKey}__${yearMonth}`]||''; }
export function setPointsSource(cardKey,yearMonth,source){
  const d=loadPointsSources();
  const k=`${cardKey}__${yearMonth}`;
  if(!source) delete d[k]; else d[k]=source;
  savePointsSourcesData(d);
  scheduleSave();
}
export function getPointsRedeemedYTD(cardKey,year){
  const byMonth=loadPointsRedeemed()[cardKey]||{};
  return Object.entries(byMonth).filter(([k])=>k.startsWith(`${year}-`)).reduce((s,[,v])=>s+v,0);
}
export function getAllPointsRedeemedYTD(year){
  const d=loadPointsRedeemed();
  let total=0;
  Object.values(d).forEach(byMonth=>{
    Object.entries(byMonth).filter(([k])=>k.startsWith(`${year}-`)).forEach(([,v])=>{ total+=v; });
  });
  return total;
}
