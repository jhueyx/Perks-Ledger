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
  // A local change that never reached the cloud has to go up before a pull can
  // be trusted, otherwise the pull overwrites it with the older remote row.
  if(hasPendingSync()){
    await saveToStorage();
    if(hasPendingSync()) return;
  }
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
      // Record the baseline on every confirmed read, changed or not — it is
      // what diffPayload() measures "what this device changed" against.
      saveBase(raw);
      if(changed){
        applyPayloadLocally(raw);
        localStorage.setItem(STORAGE_KEY+'-ts-'+state.currentUser.id,data.updated_at);
        document.dispatchEvent(new CustomEvent('perks:rerender'));
      }
    }
  }catch(e){}
}

// Write a whole tracker_data payload into `state` and localStorage. Shared by
// the pull path and by the rebase inside saveToStorage(), so the two cannot
// drift apart on which extras they know about.
export const PAYLOAD_EXTRAS=['_customAmounts','_customNames','_partial','_notes','_credited','_skipped','_feeOverrides','_snoozed','_cardOrder','_cardMeta','_badges','_redemptionMonths','_pointsRedeemed','_pointsSources'];
export function applyPayloadLocally(raw){
  const x=k=>raw[k]||(k==='_cardOrder'?[]:{});
  const benefitData={...raw};
  for(const k of PAYLOAD_EXTRAS) delete benefitData[k];
  state.DATA=Object.assign(freshDATA(),benefitData);
  try{ localStorage.setItem(STORAGE_KEY+'-'+state.currentUser.id,JSON.stringify(state.DATA)); }catch(e){}
  saveCustomAmounts(x('_customAmounts'));
  saveCustomNames(x('_customNames'));
  savePartial(x('_partial'));
  saveNotes(x('_notes'));
  saveCredited(x('_credited'));
  saveSkipped(x('_skipped'));
  if(Object.keys(x('_feeOverrides')).length) saveFeeOverridesData(x('_feeOverrides'));
  if(Object.keys(x('_snoozed')).length) saveSnoozed(x('_snoozed'));
  if(x('_cardOrder').length) { try{ localStorage.setItem('perks-card-order',JSON.stringify(x('_cardOrder'))); }catch(e){} }
  if(Object.keys(x('_cardMeta')).length) saveCardMetaData(x('_cardMeta'));
  if(Object.keys(x('_badges')).length) saveBadges(x('_badges'));
  if(Object.keys(x('_redemptionMonths')).length) saveRedemptionMonths(x('_redemptionMonths'));
  if(Object.keys(x('_pointsRedeemed')).length) savePointsRedeemedData(x('_pointsRedeemed'));
  if(Object.keys(x('_pointsSources')).length) savePointsSourcesData(x('_pointsSources'));
}

// ── Pending cloud writes ───────────────────────────────────────────────────
// A failed cloud save used to leave no trace: the error cleared after 3s and
// nothing ever retried, so the change lived on one device only. Worse, the
// local timestamp was advanced regardless of whether the write landed, which
// made syncFromSupabase() treat the local copy as newer than the cloud and
// refuse to pull forever.
//
// Now a failure records the payload's timestamp under a pending key. While
// that key is set the UI says so, every reconnect/foreground/load retries, and
// syncFromSupabase() flushes the pending write before it considers pulling.
function pendingKey(){ return 'perks-pending-sync-'+state.currentUser.id; }
// The payload as the cloud last confirmed it. Diffing the current payload
// against this baseline tells us exactly which entries THIS device changed,
// which is what makes a three-way merge possible without an operation log.
function baseKey(){ return 'perks-synced-base-'+state.currentUser.id; }
function loadBase(){ try{ return JSON.parse(localStorage.getItem(baseKey())||'null'); }catch(e){ return null; } }
function saveBase(p){ try{ localStorage.setItem(baseKey(),JSON.stringify(p)); }catch(e){} }

// Both the benefit maps and the `_extras` are two levels of plain object, so
// one shallow-per-branch walk covers the whole payload.
function isPlain(v){ return v&&typeof v==='object'&&!Array.isArray(v); }

// Every leaf where `cur` differs from `base` -- i.e. this device's own edits.
export function diffPayload(base,cur){
  const out={};
  for(const k of Object.keys(cur||{})){
    const b=(base||{})[k], c=cur[k];
    if(isPlain(c)&&isPlain(b)){
      const inner=diffPayload(b,c);
      if(Object.keys(inner).length) out[k]=inner;
    }else if(JSON.stringify(b)!==JSON.stringify(c)){
      out[k]=c;
    }
  }
  return out;
}

// Apply this device's edits on top of whatever the cloud now holds, so a
// change made on another device while we were offline survives the flush.
export function mergePayload(remote,changes){
  const out=isPlain(remote)?{...remote}:{};
  for(const k of Object.keys(changes||{})){
    const c=changes[k];
    out[k]=isPlain(c)&&isPlain(out[k])?mergePayload(out[k],c):c;
  }
  return out;
}

export function hasPendingSync(){
  if(!state.currentUser||state.currentUser.id==='demo') return false;
  try{ return !!localStorage.getItem(pendingKey()); }catch(e){ return false; }
}
function markPending(ts){ try{ localStorage.setItem(pendingKey(),ts); }catch(e){} }
function clearPending(){ try{ localStorage.removeItem(pendingKey()); }catch(e){} }

let _retryTimer=null, _retryDelay=0;
const RETRY_MIN=5000, RETRY_MAX=300000;

function scheduleRetry(){
  if(_retryTimer) return;
  _retryDelay=_retryDelay?Math.min(_retryDelay*2,RETRY_MAX):RETRY_MIN;
  _retryTimer=setTimeout(()=>{ _retryTimer=null; if(hasPendingSync()) saveToStorage(); },_retryDelay);
}
function cancelRetry(){ if(_retryTimer){ clearTimeout(_retryTimer); _retryTimer=null; } _retryDelay=0; }

// Retry the moment the device looks usable again, rather than waiting out the
// backoff. Guarded so the module stays importable under node for tests.
let _hooksInstalled=false;
export function installSyncRetryHooks(){
  if(typeof window==='undefined'||_hooksInstalled) return;   // doUnlock() can run again on re-login
  _hooksInstalled=true;
  const flush=()=>{ if(hasPendingSync()){ cancelRetry(); saveToStorage(); } };
  window.addEventListener('online',flush);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) flush(); });
}

let _saveInFlight=null;
export async function saveToStorage(){
  if(!state.currentUser) return;
  if(state.currentUser.id==='demo'){ setSave('saved','✓ saved locally'); setTimeout(()=>setSave('',''),2000); return; }
  // Serialise saves: a retry firing while the user is toggling would otherwise
  // let two rebases read the same remote row and race each other's write.
  if(_saveInFlight) return _saveInFlight;
  _saveInFlight=(async()=>{ try{ return await _doSave(); } finally { _saveInFlight=null; } })();
  return _saveInFlight;
}

async function _doSave(){
  setSave('saving','saving…');
  const ts=new Date().toISOString();
  try{
    localStorage.setItem(STORAGE_KEY+'-'+state.currentUser.id,JSON.stringify(state.DATA));
  }catch(e){}
  try{
    let payload={...state.DATA,_customAmounts:loadCustomAmounts(),_customNames:loadCustomNames(),_partial:loadPartial(),_notes:loadNotes(),_credited:loadCredited(),_skipped:loadSkipped(),_feeOverrides:getFeeOverrides(),_snoozed:loadSnoozed(),_cardOrder:JSON.parse(localStorage.getItem('perks-card-order')||'[]'),_cardMeta:loadCardMeta(),_badges:loadBadges(),_redemptionMonths:loadRedemptionMonths(),_pointsRedeemed:loadPointsRedeemed(),_pointsSources:loadPointsSources()};
    // If another device wrote while this one was queued, rebase onto that row
    // instead of overwriting it: take the remote as the base and re-apply only
    // the entries this device actually changed since its last confirmed sync.
    if(hasPendingSync()){
      const {data:cur}=await sb.from('tracker_data').select('data,updated_at').eq('user_id',state.currentUser.id).single();
      const lastTs=localStorage.getItem(STORAGE_KEY+'-ts-'+state.currentUser.id);
      const remoteMoved=cur&&cur.updated_at&&(!lastTs||new Date(cur.updated_at)>new Date(lastTs));
      if(remoteMoved&&cur.data){
        payload=mergePayload(cur.data,diffPayload(loadBase(),payload));
        applyPayloadLocally(payload);
      }
    }
    const {data:updated,error:upErr}=await sb.from('tracker_data').update({data:payload,updated_at:ts}).eq('user_id',state.currentUser.id).select('user_id');
    if(upErr) throw upErr;
    if(!updated||updated.length===0){
      const {error:insErr}=await sb.from('tracker_data').insert({user_id:state.currentUser.id,data:payload,updated_at:ts});
      if(insErr) throw insErr;
    }
    // Only now is the local copy genuinely in sync, so only now may the
    // local timestamp move -- it is what syncFromSupabase() compares against.
    try{ localStorage.setItem(STORAGE_KEY+'-ts-'+state.currentUser.id,ts); }catch(e){}
    saveBase(payload);
    clearPending();
    cancelRetry();
    setSave('saved','✓ saved');
    setTimeout(()=>setSave('',''),2000);
  }catch(e){
    console.error('[tracker_data save error]',e?.message,e?.code,e?.details,e?.hint);
    markPending(ts);
    scheduleRetry();
    // Stays on screen: an unsynced change is a standing condition, not a blip.
    setSave('error','⚠ unsynced — will retry');
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
