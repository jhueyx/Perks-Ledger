import { CARDS, CARD_LABELS, PREMIUM_CARD_CATALOG, POINTS_MULTIPLIERS, TRANSFER_PARTNERS } from './cards.js';
const DEPLOY_DATE='2026-07-05 23:00';
import { state, CY, CM, MONTHS, MONTHS_FULL, sb, freshDATA, STORAGE_KEY, escapeHtml, SUPABASE_URL, SUPABASE_KEY } from './state.js';
import {
  toggle, scheduleSave, setSave, syncFromSupabase,
  loadRedemptionMonths, setRedemptionMonth,
  loadCustomAmounts, saveCustomAmounts, setCustomAmount,
  loadPartial, savePartial, setPartialUsed,
  loadNotes, saveNotes, getNoteKey,
  loadCredited, saveCredited, toggleCredited,
  loadSkipped, saveSkipped, isSkipped, skipBenefit, unskipBenefit, clearAllSkipped, countSkipped,
  getFeeOverrides, saveFeeOverridesData, getCardFeeMonth, getCardFeeDay,
  setSnoozedBenefit, isGloballySnoozed, isUsed,
  loadCardMeta, setCardOpenedDate,
  setPointsRedeemed
} from './storage.js';
import { render, getVisibleCardKeys, renderCurrent, renderRecap, haptic, checkAllClaimed, animateCounters, renderFeeOptimizer, buildAdvisorContext, formatAdvisorMarkdown, computeAlerts, renderPointsRedemptions } from './views.js';
import { checkBadges, getEarnedBadges, getEarnedAt, getUnseenBadges, markAllSeen, BADGE_DEFS, getApplicableBadgeDefs, TIER_COLORS, backfill2025Badges, unlockReviewedBadges } from './badges.js';
import { calcStats, getCardYearPeriods, isPCurrent, getFee, getBAmount, getCurrentPK, isBExpired, isBNotAvailable } from './periods.js';

// Web Push: paste the base64url VAPID PUBLIC key here (same one set as the
// send-push function's VAPID_PUBLIC_KEY secret). Generate with:
//   npx web-push generate-vapid-keys
// Leaving this blank disables the background-push toggle.
const VAPID_PUBLIC_KEY = 'BOcIiFWlNWs5xYccaoAweAIuJq56bG7hIuAijXvJl-i08ez5S8ZAj18KfDWdn51v2YwAdoJHZeIOQoNwFuaTn8w';

// ── Splash: show login only if no cached session ──────────────────────────
try {
  const hasSession=Object.keys(localStorage).some(k=>k.startsWith('sb-')&&k.endsWith('-auth-token'));
  if(!hasSession) document.getElementById('splash').classList.remove('hidden');
} catch(e) { document.getElementById('splash').classList.remove('hidden'); }

// ── Auth ──────────────────────────────────────────────────────────────────
function switchAuthTab(tab){
  state._authTab=tab;
  document.getElementById('tabLogin').classList.toggle('active',tab==='login');
  document.getElementById('tabSignup').classList.toggle('active',tab==='signup');
  document.getElementById('signupExtras').style.display=tab==='signup'?'':'none';
  document.getElementById('authBtn').textContent=tab==='login'?'Sign In':'Create Account';
  document.getElementById('authSub').textContent=tab==='login'?'Sign in to track your credit card perks':'Create a free account to get started';
  document.getElementById('authError').textContent='';
  document.getElementById('authHelper').textContent='';
  document.getElementById('forgotBtn').style.display=tab==='login'?'':'none';
}

async function handleForgotPassword(){
  const email=document.getElementById('authEmail').value.trim();
  const errEl=document.getElementById('authError');
  const helper=document.getElementById('authHelper');
  errEl.textContent=''; helper.textContent='';
  if(!email){ errEl.textContent='Enter your email address above first.'; document.getElementById('authEmail').focus(); return; }
  document.getElementById('forgotBtn').textContent='Sending…';
  document.getElementById('forgotBtn').disabled=true;
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:window.location.href});
  document.getElementById('forgotBtn').textContent='Forgot password?';
  document.getElementById('forgotBtn').disabled=false;
  if(error){ errEl.textContent=error.message; }
  else { helper.textContent=`✓ Reset link sent to ${email} — check your inbox.`; helper.style.color='var(--green)'; }
}

async function handleAuth(){
  const email=document.getElementById('authEmail').value.trim();
  const password=document.getElementById('authPassword').value;
  const errEl=document.getElementById('authError');
  errEl.textContent='';
  if(!email||!password){ errEl.textContent='Please enter email and password.'; return; }

  if(email==='test'&&password==='test'){
    state._sessionHandled=true;
    state.currentUser={id:'demo',email:'test'};
    document.getElementById('drawerUserEmail').textContent='Demo mode';
    state.userCards=['csr'];
    state.DATA={csr:{}};
    document.getElementById('splash').classList.add('hidden');
    document.getElementById('cardPickerOverlay').classList.add('hidden');
    applyUserCards();
    render();
    setTimeout(initCardFlip,200);
    return;
  }

  const btn=document.getElementById('authBtn');
  btn.textContent='…'; btn.disabled=true; errEl.textContent='';

  try {
    if(state._authTab==='login'){
      errEl.style.color='var(--text-tertiary)'; errEl.textContent='Signing in…';
      const {data,error}=await sb.auth.signInWithPassword({email,password});
      errEl.textContent=''; errEl.style.color='var(--red)';
      if(error) throw error;
      state._sessionHandled=true;
      await onSignedIn(data.user,false);
    } else {
      const confirm=document.getElementById('authConfirm').value;
      if(password!==confirm) throw new Error('Passwords do not match.');
      if(password.length<6) throw new Error('Password must be at least 6 characters.');
      errEl.style.color='var(--text-tertiary)'; errEl.textContent='Creating account…';
      const {data,error}=await sb.auth.signUp({email,password});
      errEl.textContent=''; errEl.style.color='var(--red)';
      if(error) throw error;
      if(data.user&&data.user.identities&&data.user.identities.length===0)
        throw new Error('An account with this email already exists. Please sign in.');
      state._sessionHandled=true;
      await onSignedIn(data.user,true);
    }
  } catch(e) {
    state._sessionHandled=false;
    errEl.style.color='var(--red)';
    errEl.textContent=e.message||'Authentication failed.';
    btn.textContent=state._authTab==='login'?'Sign In':'Create Account';
    btn.disabled=false;
  }
}

function updateDrawerGreeting(){
  const user=state.currentUser;
  if(!user) return;
  const name=user.user_metadata?.display_name;
  const greetEl=document.getElementById('drawerGreeting');
  const emailEl=document.getElementById('drawerUserEmail');
  if(greetEl) greetEl.textContent=name?`Hi, ${name}`:'';
  if(emailEl) emailEl.textContent=user.email||'';
  const hGreet=document.getElementById('headerGreeting');
  const hEmail=document.getElementById('headerUserEmail');
  if(hGreet) hGreet.textContent=name?`Hi, ${name}`:(user.email||'');
  if(hEmail) hEmail.textContent=user.email||'';
  const headerUser=document.getElementById('headerUser');
  if(headerUser) headerUser.style.display='';
}

// ── Email digest cache ────────────────────────────────────────────────────
function buildDigestCache(){
  const user=state.currentUser;
  if(!user) return null;
  const buckets={monthly:[],quarterly:[],semiannual:[],annual:[]};
  let totalUnclaimed=0;
  getVisibleCardKeys().forEach(cardKey=>{
    CARDS[cardKey].sections.forEach(sec=>{
      const pk=getCurrentPK(cardKey,sec.cadence);
      const p={calY:CY,calM:CM,m:CM};
      sec.benefits.forEach(b=>{
        if(isBExpired(b,p)||isBNotAvailable(b,CY,p)||isGloballySnoozed(cardKey,b.id)) return;
        if(isUsed(cardKey,b.id,pk)||isSkipped(cardKey,b.id,pk)) return;
        const amt=getBAmount(b,{m:CM});
        const item={card:CARD_LABELS[cardKey],name:b.name,amt};
        if(sec.cadence==='monthly') buckets.monthly.push(item);
        else if(sec.cadence==='quarterly') buckets.quarterly.push(item);
        else if(sec.cadence==='semi-annual'||sec.cadence==='cal-semi-annual') buckets.semiannual.push(item);
        else buckets.annual.push(item);
        totalUnclaimed+=amt;
      });
    });
  });
  return {email:user.email,total_unclaimed:totalUnclaimed,...buckets,updated_at:new Date().toISOString()};
}

async function saveDigestCache(){
  if(!state.currentUser) return;
  // Cache feeds both Email Digest and Web Push, so refresh if either is enabled.
  const pushOn=localStorage.getItem('push-enabled')==='1';
  if(!state._digestEnabled&&!pushOn) return;
  const cache=buildDigestCache();
  if(!cache) return;
  await sb.from('user_profiles').upsert({user_id:state.currentUser.id,digest_cache:cache,updated_at:new Date().toISOString()},{onConflict:'user_id'});
}

async function toggleDigestEmail(el){
  if(!state.currentUser) return;
  const enabled=el.checked;
  el.disabled=true;
  const cache=enabled?buildDigestCache():null;
  await sb.from('user_profiles').upsert({user_id:state.currentUser.id,digest_enabled:enabled,digest_cache:cache,updated_at:new Date().toISOString()},{onConflict:'user_id'});
  state._digestEnabled=enabled;
  el.disabled=false;
  const msg=document.getElementById('digestMsg');
  if(msg){ msg.textContent=enabled?'✓ Digest enabled — you\'ll get a weekly email':'Digest disabled'; msg.style.color=enabled?'var(--green)':'var(--text-tertiary)'; setTimeout(()=>{ if(msg) msg.textContent=''; },3000); }
}

async function onSignedIn(user,isNew){
  state.currentUser=user;
  updateDrawerGreeting();
  const {data:profile}=await sb.from('user_profiles').select('cards,digest_enabled').eq('user_id',user.id).single();
  state._digestEnabled=profile?.digest_enabled||false;
  if(isNew||!profile||!profile.cards||profile.cards.length===0){
    document.getElementById('splash').classList.add('hidden');
    showCardPicker();
  } else {
    state.userCards=profile.cards;
    doUnlock();
  }
}

async function signOut(){
  await sb.auth.signOut({ scope: 'local' });
  state._sessionHandled=false; state.currentUser=null; state.userCards=null;
  state.DATA=freshDATA();
  document.getElementById('splash').classList.remove('hidden');
  document.getElementById('authEmail').value='';
  document.getElementById('authPassword').value='';
  document.getElementById('authConfirm').value='';
  document.getElementById('authError').textContent='';
  document.getElementById('authBtn').textContent='Sign In';
  document.getElementById('authBtn').disabled=false;
  switchAuthTab('login');
}

function doUnlock(){
  document.getElementById('splash').classList.add('hidden');
  document.getElementById('cardPickerOverlay').classList.add('hidden');
  try{
    const key=STORAGE_KEY+(state.currentUser?'-'+state.currentUser.id:'');
    const val=localStorage.getItem(key);
    if(val) state.DATA=Object.assign(freshDATA(),JSON.parse(val));
  }catch(e){}
  state.cardMeta=loadCardMeta();
  applyUserCards();
  render();
  updateAlertBadge();
  setTimeout(initCardFlip,200);
  syncFromSupabase();
  state.redemptionDates=loadRedemptionMonths();
  setTimeout(saveDigestCache,3000);
  setTimeout(()=>{
    checkBadges();
    const newOnes=[...backfill2025Badges(),...unlockReviewedBadges()];
    if(newOnes.length>1){
      const toast=document.getElementById('badgeToast');
      const inner=document.getElementById('badgeToastInner');
      if(toast&&inner){
        inner.innerHTML=`
          <div style="width:36px;height:36px;border-radius:50%;border:2px solid var(--gold);background:rgba(200,146,42,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px">🏅</div>
          <div style="min-width:0">
            <div style="font-size:10px;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.07em;color:var(--gold);font-weight:600">Prior Activity</div>
            <div style="font-size:13px;font-weight:600;color:var(--text);margin-top:1px">${newOnes.length} badges awarded</div>
            <div style="font-size:11px;color:var(--text-secondary);font-family:var(--mono);margin-top:1px">Based on your tracking history</div>
          </div>`;
        inner.onclick=()=>{ toast.classList.remove('show'); setActiveView('badges'); };
        toast.classList.add('show');
        setTimeout(()=>toast.classList.remove('show'),5000);
      }
    } else if(newOnes.length===1){
      showBadgeToast(newOnes[0]);
    }
    if(state.activeView==='badges') renderBadgesView();
  },500);
}

// ── Session restore ───────────────────────────────────────────────────────
sb.auth.onAuthStateChange(async(event,session)=>{
  if(event==='INITIAL_SESSION'){
    if(session&&session.user&&!state._sessionHandled){
      state._sessionHandled=true;
      await onSignedIn(session.user,false);
    } else if(!session){
      document.getElementById('splash').classList.remove('hidden');
      setTimeout(()=>document.getElementById('authEmail').focus(),100);
    }
  }
});

// ── Card picker ───────────────────────────────────────────────────────────
function renderCPGrid(containerId,searchId,selectedSet){
  const search=(document.getElementById(searchId)?.value||'').toLowerCase();
  const grid=document.getElementById(containerId);
  const issuers={};
  PREMIUM_CARD_CATALOG.forEach(c=>{
    if(!c.fee) return;
    const name=c.name.toLowerCase(),issuer=c.issuer.toLowerCase();
    if(search&&!name.includes(search)&&!issuer.includes(search)) return;
    if(!issuers[c.issuer]) issuers[c.issuer]=[];
    issuers[c.issuer].push(c);
  });
  if(search){
    PREMIUM_CARD_CATALOG.forEach(c=>{
      if(c.fee) return;
      const name=c.name.toLowerCase(),issuer=c.issuer.toLowerCase();
      if(name.includes(search)||issuer.includes(search)){
        if(!issuers[c.issuer]) issuers[c.issuer]=[];
        if(!issuers[c.issuer].find(x=>x.id===c.id)) issuers[c.issuer].push(c);
      }
    });
  }
  let html='';
  Object.entries(issuers).forEach(([issuer,cards])=>{
    html+=`<div class="cp-issuer-header">${issuer}</div>`;
    cards.forEach(c=>{
      const sel=selectedSet.has(c.id);
      const feeLabel=c.fee?`$${c.fee}/yr`:'No annual fee';
      const supportedBadge=c.supported?'':`<span style="font-size:9px;background:var(--border-light);color:var(--text-tertiary);padding:1px 5px;border-radius:4px;margin-left:4px">catalog</span>`;
      html+=`<div class="cp-card-item${sel?' selected':''}" onclick="toggleCPCard('${c.id}','${containerId}','${searchId}',this)">
        <div class="cp-check"></div>
        <div><div class="cp-card-name">${c.name}${supportedBadge}</div><div class="cp-card-fee">${feeLabel}</div></div>
      </div>`;
    });
  });
  if(!html) html=`<div style="color:var(--text-tertiary);font-size:13px;padding:12px;grid-column:1/-1">No cards match "${search}"</div>`;
  grid.innerHTML=html;
}

function toggleCPCard(id,gridId,searchId){
  const isCP=gridId==='cpGrid';
  const set=isCP?state._cpSelected:state._mcSelected;
  if(set.has(id)) set.delete(id); else set.add(id);
  renderCPGrid(gridId,searchId,set);
  if(isCP){
    document.getElementById('cpCount').textContent=`${state._cpSelected.size} card${state._cpSelected.size!==1?'s':''} selected`;
    document.getElementById('cpConfirm').disabled=state._cpSelected.size===0;
  } else {
    const countId=gridId==='settingsCardGrid'?'settingsCardCount':'mcCount';
    const countEl=document.getElementById(countId);
    if(countEl) countEl.textContent=`${state._mcSelected.size} card${state._mcSelected.size!==1?'s':''} selected`;
  }
}

function filterCPCards(){ renderCPGrid('cpGrid','cpSearch',state._cpSelected); }
function filterMCCards(){ renderCPGrid('mcGrid','mcSearch',state._mcSelected); }

function showCardPicker(){
  state._cpSelected=new Set(['platinum','gold','csr']);
  document.getElementById('cardPickerOverlay').classList.remove('hidden');
  document.getElementById('cpCount').textContent=`${state._cpSelected.size} cards selected`;
  document.getElementById('cpConfirm').disabled=false;
  renderCPGrid('cpGrid','cpSearch',state._cpSelected);
}

async function confirmCardPick(){
  const cards=[...state._cpSelected];
  if(cards.length===0) return;
  document.getElementById('cpConfirm').textContent='Saving…';
  document.getElementById('cpConfirm').disabled=true;
  await sb.from('user_profiles').upsert({user_id:state.currentUser.id,cards,updated_at:new Date().toISOString()},{onConflict:'user_id'});
  state.userCards=cards;
  document.getElementById('cardPickerOverlay').classList.add('hidden');
  doUnlock();
  showCardDateModal(cards);
}

// ── My Cards modal ────────────────────────────────────────────────────────
function openMyCards(){
  state._mcSelected=new Set(state.userCards||['csr','gold','platinum']);
  document.getElementById('mcCount').textContent=`${state._mcSelected.size} cards selected`;
  renderCPGrid('mcGrid','mcSearch',state._mcSelected);
  document.getElementById('myCardsModal').classList.remove('hidden');
}
function closeMyCards(){ document.getElementById('myCardsModal').classList.add('hidden'); }

async function saveMyCards(){
  const cards=[...state._mcSelected];
  if(cards.length===0){ alert('Please select at least one card.'); return; }
  document.getElementById('mcSave').textContent='Saving…';
  await sb.from('user_profiles').upsert({user_id:state.currentUser.id,cards,updated_at:new Date().toISOString()},{onConflict:'user_id'});
  state.userCards=cards;
  applyUserCards();
  if(!state.userCards.includes(state.activeCard)) state.activeCard=getVisibleCardKeys()[0]||'csr';
  render();
  closeMyCards();
  setSave('saved','✓ Cards updated');
  setTimeout(()=>setSave('',''),2000);
}

// ── Notification settings helpers ────────────────────────────────────────
function buildNotifSettingsHTML(){
  const supported='Notification' in window;
  if(!supported) return `<div class="settings-sub">Notifications not supported in this browser.</div>`;
  const granted=Notification.permission==='granted';
  const enabled=localStorage.getItem('perks-notif')==='1';
  if(!granted||!enabled){
    return `<div class="settings-sub" style="margin-bottom:10px">Get reminded when benefits are about to expire across monthly, quarterly, and semi-annual windows.</div>
    <button class="settings-btn settings-btn-primary" onclick="requestNotifications()">Enable Notifications</button>`;
  }
  const rows=[
    {key:'notif-monthly',label:'Monthly reminders',sub:'Last 3 days of the month'},
    {key:'notif-quarterly',label:'Quarterly reminders',sub:'Last 5 days of each quarter'},
    {key:'notif-semiannual',label:'Semi-annual reminders',sub:'Last 2 weeks of each half-year'},
    {key:'notif-perbenefit',label:'Per-benefit reminders',sub:'Each unclaimed benefit before it expires',defaultOff:true},
  ];
  let html=`<div class="settings-sub" style="margin-bottom:10px">Notifications enabled. Toggle individual reminder types below.</div>`;
  rows.forEach(r=>{
    const isOn=r.defaultOff?localStorage.getItem(r.key)==='1':localStorage.getItem(r.key)!=='0';
    html+=`<div class="notif-setting-row">
      <div>
        <div class="notif-setting-label">${r.label}</div>
        <div class="notif-setting-sub">${r.sub}</div>
      </div>
      <button class="notif-toggle ${isOn?'on':''}" onclick="toggleNotifType('${r.key}',this)"></button>
    </div>`;
  });
  if(pushSupported()){
    const pon=localStorage.getItem('push-enabled')==='1';
    html+=`<div class="notif-setting-row" style="border-top:1px solid var(--border);margin-top:8px;padding-top:12px">
      <div>
        <div class="notif-setting-label">Background push</div>
        <div class="notif-setting-sub">Reminders even when the app is closed${VAPID_PUBLIC_KEY?'':' — not configured yet'}</div>
      </div>
      <button class="notif-toggle ${pon?'on':''}" onclick="togglePush(this)"></button>
    </div>`;
  }
  html+=`<button class="settings-btn" style="margin-top:12px;font-size:12px;color:var(--text-tertiary)" onclick="disableNotifications()">Turn off all notifications</button>`;
  return html;
}

// ── Settings screen ──────────────────────────────────────────────────────
function renderSettings(){
  const user=state.currentUser;
  const displayName=user?.user_metadata?.display_name||'';
  const email=escapeHtml(user?.email||'');
  state._mcSelected=new Set(state.userCards||['csr','gold','platinum']);
  if(state._settingsCardsCollapsed===undefined) state._settingsCardsCollapsed=true;
  if(state._settingsSecurityCollapsed===undefined) state._settingsSecurityCollapsed=true;
  if(state._settingsProfileCollapsed===undefined) state._settingsProfileCollapsed=true;
  if(state._settingsNotifCollapsed===undefined) state._settingsNotifCollapsed=true;
  if(state._settingsDigestCollapsed===undefined) state._settingsDigestCollapsed=true;
  const chev=(id,collapsed)=>`<span id="${id}" style="font-size:12px;color:var(--text-tertiary);transition:transform 0.2s;transform:${collapsed?'rotate(-90deg)':'rotate(0deg)'}">▾</span>`;
  const colTitle=(label,fn,chevId,collapsed)=>`<div class="settings-section-title" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center" onclick="${fn}()">${label}${chev(chevId,collapsed)}</div>`;
  document.getElementById('main').innerHTML=`
    <div class="settings-page">
      <div class="settings-page-header">Settings</div>

      <div class="settings-section">
        ${colTitle('Profile','toggleSettingsProfile','settingsProfileChevron',state._settingsProfileCollapsed)}
        <div id="settingsProfileBody" style="display:${state._settingsProfileCollapsed?'none':'block'}">
          <div class="settings-field">
            <label class="settings-label">What to call you</label>
            <input class="settings-input" id="settingsName" type="text" placeholder="e.g. Jason" value="${escapeHtml(displayName)}"/>
          </div>
          <div class="settings-field">
            <label class="settings-label">Email</label>
            <input class="settings-input" type="email" value="${email}" readonly/>
          </div>
          <button class="settings-btn settings-btn-primary" onclick="saveSettingsProfile()">Save Profile</button>
          <div class="settings-feedback" id="settingsProfileMsg"></div>
        </div>
      </div>

      <div class="settings-section">
        ${colTitle('Security','toggleSettingsSecurity','settingsSecurityChevron',state._settingsSecurityCollapsed)}
        <div id="settingsSecurityBody" style="display:${state._settingsSecurityCollapsed?'none':'block'}">
          <div class="settings-field">
            <label class="settings-label">New password</label>
            <input class="settings-input" id="settingsNewPwd" type="password" placeholder="At least 6 characters" autocomplete="new-password"/>
          </div>
          <div class="settings-field">
            <label class="settings-label">Confirm new password</label>
            <input class="settings-input" id="settingsConfirmPwd" type="password" placeholder="Confirm new password" autocomplete="new-password"/>
          </div>
          <button class="settings-btn settings-btn-primary" onclick="saveSettingsPassword()">Change Password</button>
          <div class="settings-feedback" id="settingsPwdMsg"></div>
        </div>
      </div>

      <div class="settings-section">
        ${colTitle('My Cards','toggleSettingsCards','settingsCardsChevron',state._settingsCardsCollapsed)}
        <div id="settingsCardsBody" style="display:${state._settingsCardsCollapsed?'none':'block'}">
          <div class="settings-sub">Select the cards you want to track.</div>
          <input class="cp-search" id="settingsCardSearch" placeholder="Search cards…" oninput="filterSettingsCards()" style="margin:12px 0 8px"/>
          <div class="cp-count" id="settingsCardCount">${state._mcSelected.size} card${state._mcSelected.size!==1?'s':''} selected</div>
          <div class="cp-grid" id="settingsCardGrid" style="margin-bottom:16px"></div>
          <button class="settings-btn settings-btn-primary" id="settingsCardSave" onclick="saveSettingsCards()">Save Cards</button>
          <div class="settings-feedback" id="settingsCardMsg"></div>
        </div>
      </div>

      <div class="settings-section">
        ${colTitle('Notifications','toggleSettingsNotif','settingsNotifChevron',state._settingsNotifCollapsed)}
        <div id="settingsNotifBody" style="display:${state._settingsNotifCollapsed?'none':'block'}">
          ${buildNotifSettingsHTML()}
        </div>
      </div>

      <div class="settings-section">
        ${colTitle('Email Digest','toggleSettingsDigest','settingsDigestChevron',state._settingsDigestCollapsed)}
        <div id="settingsDigestBody" style="display:${state._settingsDigestCollapsed?'none':'block'}">
          <div class="settings-sub" style="margin-bottom:12px">Get a weekly email summary of unclaimed benefits across your cards.</div>
          <div class="notif-setting-row" style="border-bottom:none;padding-bottom:0">
            <div>
              <div class="notif-setting-label">Weekly digest email</div>
              <div class="notif-setting-sub">${escapeHtml(user?.email||'')}</div>
            </div>
            <input type="checkbox" id="digestToggle" ${state._digestEnabled?'checked':''} onchange="toggleDigestEmail(this)" style="width:18px;height:18px;cursor:pointer;accent-color:var(--green)">
          </div>
          <div class="settings-feedback" id="digestMsg"></div>
        </div>
      </div>

      <div class="settings-section">
        <button class="settings-btn" style="color:var(--red);border-color:rgba(217,64,64,0.35);width:100%" onclick="signOut()">Sign Out</button>
      </div>
    </div>`;
  if(!state._settingsCardsCollapsed) renderCPGrid('settingsCardGrid','settingsCardSearch',state._mcSelected);
}

async function saveSettingsProfile(){
  const name=document.getElementById('settingsName').value.trim();
  const msg=document.getElementById('settingsProfileMsg');
  msg.textContent='Saving…'; msg.style.color='var(--text-tertiary)';
  const {data,error}=await sb.auth.updateUser({data:{display_name:name}});
  if(error){ msg.textContent=error.message; msg.style.color='var(--red)'; return; }
  if(data?.user) state.currentUser=data.user;
  updateDrawerGreeting();
  msg.textContent='✓ Saved'; msg.style.color='var(--green)';
  setTimeout(()=>{ if(msg) msg.textContent=''; },2500);
}

async function saveSettingsPassword(){
  const pwd=document.getElementById('settingsNewPwd').value;
  const confirm=document.getElementById('settingsConfirmPwd').value;
  const msg=document.getElementById('settingsPwdMsg');
  msg.style.color='var(--red)';
  if(!pwd){ msg.textContent='Enter a new password.'; return; }
  if(pwd.length<6){ msg.textContent='Password must be at least 6 characters.'; return; }
  if(pwd!==confirm){ msg.textContent='Passwords do not match.'; return; }
  msg.textContent='Saving…'; msg.style.color='var(--text-tertiary)';
  const {error}=await sb.auth.updateUser({password:pwd});
  if(error){ msg.textContent=error.message; msg.style.color='var(--red)'; return; }
  document.getElementById('settingsNewPwd').value='';
  document.getElementById('settingsConfirmPwd').value='';
  msg.textContent='✓ Password changed'; msg.style.color='var(--green)';
  setTimeout(()=>{ if(msg) msg.textContent=''; },2500);
}

async function saveSettingsCards(){
  const cards=[...state._mcSelected];
  const msg=document.getElementById('settingsCardMsg');
  if(cards.length===0){ msg.textContent='Select at least one card.'; msg.style.color='var(--red)'; return; }
  const prev=new Set(state.userCards||[]);
  const newCards=cards.filter(c=>!prev.has(c));
  const btn=document.getElementById('settingsCardSave');
  if(btn){ btn.textContent='Saving…'; btn.disabled=true; }
  await sb.from('user_profiles').upsert({user_id:state.currentUser.id,cards,updated_at:new Date().toISOString()},{onConflict:'user_id'});
  state.userCards=cards;
  applyUserCards();
  if(!state.userCards.includes(state.activeCard)) state.activeCard=getVisibleCardKeys()[0]||'csr';
  if(btn){ btn.textContent='Save Cards'; btn.disabled=false; }
  msg.textContent='✓ Cards updated'; msg.style.color='var(--green)';
  setTimeout(()=>{ if(msg) msg.textContent=''; },2500);
  if(newCards.length) showCardDateModal(newCards);
}

function filterSettingsCards(){ renderCPGrid('settingsCardGrid','settingsCardSearch',state._mcSelected); }
window.toggleSettingsCards=function(){
  state._settingsCardsCollapsed=!state._settingsCardsCollapsed;
  const body=document.getElementById('settingsCardsBody');
  const chev=document.getElementById('settingsCardsChevron');
  if(body) body.style.display=state._settingsCardsCollapsed?'none':'block';
  if(chev) chev.style.transform=state._settingsCardsCollapsed?'rotate(-90deg)':'rotate(0deg)';
  if(!state._settingsCardsCollapsed) renderCPGrid('settingsCardGrid','settingsCardSearch',state._mcSelected);
};
window.toggleSettingsSecurity=function(){
  state._settingsSecurityCollapsed=!state._settingsSecurityCollapsed;
  const body=document.getElementById('settingsSecurityBody');
  const chev=document.getElementById('settingsSecurityChevron');
  if(body) body.style.display=state._settingsSecurityCollapsed?'none':'block';
  if(chev) chev.style.transform=state._settingsSecurityCollapsed?'rotate(-90deg)':'rotate(0deg)';
};
window.toggleSettingsProfile=function(){
  state._settingsProfileCollapsed=!state._settingsProfileCollapsed;
  const body=document.getElementById('settingsProfileBody');
  const chev=document.getElementById('settingsProfileChevron');
  if(body) body.style.display=state._settingsProfileCollapsed?'none':'block';
  if(chev) chev.style.transform=state._settingsProfileCollapsed?'rotate(-90deg)':'rotate(0deg)';
};
window.toggleSettingsNotif=function(){
  state._settingsNotifCollapsed=!state._settingsNotifCollapsed;
  const body=document.getElementById('settingsNotifBody');
  const chev=document.getElementById('settingsNotifChevron');
  if(body) body.style.display=state._settingsNotifCollapsed?'none':'block';
  if(chev) chev.style.transform=state._settingsNotifCollapsed?'rotate(-90deg)':'rotate(0deg)';
};
window.toggleSettingsDigest=function(){
  state._settingsDigestCollapsed=!state._settingsDigestCollapsed;
  const body=document.getElementById('settingsDigestBody');
  const chev=document.getElementById('settingsDigestChevron');
  if(body) body.style.display=state._settingsDigestCollapsed?'none':'block';
  if(chev) chev.style.transform=state._settingsDigestCollapsed?'rotate(-90deg)':'rotate(0deg)';
};

// ── Card selector ─────────────────────────────────────────────────────────
function sizeCardSelector(){ /* sizing handled by CSS flex-basis breakpoints */ }

function applyUserCards(){
  document.querySelectorAll('.card-btn[data-card]').forEach(btn=>{
    const card=btn.dataset.card;
    btn.style.display=(state.userCards&&state.userCards.includes(card))?'block':'none';
  });
  sizeCardSelector();
  const firstCard=(state.userCards||['csr']).find(c=>CARDS[c])||'csr';
  state.activeCard=firstCard;
  document.querySelectorAll('.card-btn').forEach(b=>b.className='card-btn');
  const activeBtn=document.querySelector(`.card-btn[data-card="${state.activeCard}"]`);
  if(activeBtn){ activeBtn.classList.add(`active-${state.activeCard}`); activeBtn.scrollIntoView({behavior:'instant',block:'nearest',inline:'center'}); }
}

function initCardSelector(){
  const selector=document.getElementById('cardSelector');
  const btns=()=>[...selector.querySelectorAll('.card-btn')];
  let dragSrc=null;

  btns().forEach(btn=>{
    btn.setAttribute('draggable','true');
    let lastTap=0;
    btn.addEventListener('click',e=>{
      if(btn.classList.contains('dragging')) return;
      const now=Date.now();
      if(now-lastTap<300){ openCardSheet(btn.dataset.card); lastTap=0; return; }
      lastTap=now;
      btns().forEach(b=>b.className='card-btn');
      const c=btn.dataset.card;
      btn.classList.add(`active-${c}`);
      state.activeCard=c;
      stopCarousel();
      btn.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
      setActiveView('this-period');
      setTimeout(()=>{ initCardFlip(); },50);
    });
    btn.addEventListener('dragstart',e=>{ dragSrc=btn; btn.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
    btn.addEventListener('dragend',()=>{ btn.classList.remove('dragging'); btns().forEach(b=>b.classList.remove('drag-over')); dragSrc=null; });
    btn.addEventListener('dragover',e=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; if(btn!==dragSrc){ btns().forEach(b=>b.classList.remove('drag-over')); btn.classList.add('drag-over'); } });
    btn.addEventListener('dragleave',()=>btn.classList.remove('drag-over'));
    btn.addEventListener('drop',e=>{
      e.preventDefault(); btn.classList.remove('drag-over');
      if(dragSrc&&dragSrc!==btn){
        const all=btns(),si=all.indexOf(dragSrc),ti=all.indexOf(btn);
        if(si<ti) selector.insertBefore(dragSrc,btn.nextSibling);
        else selector.insertBefore(dragSrc,btn);
      }
    });
  });
}

// ── Card info sheet ───────────────────────────────────────────────────────
function openCardSheet(cardKey){
  const card=CARDS[cardKey];
  const {captured}=calcStats(cardKey,c=>getCardYearPeriods(cardKey,c),isPCurrent);
  const fee=getFee(cardKey,CY);
  const effectiveFee=fee-captured;
  const multipliers=POINTS_MULTIPLIERS[cardKey]||[];

  let html=`<div class="card-sheet-section">
    <div class="card-sheet-section-title">Card Year</div>
    <div class="card-sheet-row"><span style="color:var(--text-secondary)">Annual fee</span><span style="font-family:var(--mono);font-weight:600">$${fee}</span></div>
    <div class="card-sheet-row"><span style="color:var(--text-secondary)">Captured so far</span><span style="font-family:var(--mono);font-weight:600;color:var(--green)">$${captured.toFixed(0)}</span></div>
    <div class="card-sheet-row"><span style="color:var(--text-secondary)">Effective fee</span><span style="font-family:var(--mono);font-weight:600;color:${effectiveFee<=0?'var(--green)':'var(--text)'}">${effectiveFee<=0?'+$'+Math.abs(effectiveFee).toFixed(0)+' profit':'$'+effectiveFee.toFixed(0)}</span></div>
  </div>`;

  if(multipliers.length){
    html+=`<div class="card-sheet-section">
      <div class="card-sheet-section-title">Earning rates</div>`;
    multipliers.forEach(m=>{
      html+=`<div class="card-sheet-row"><span style="color:var(--text-secondary);font-size:12px">${m.cat}</span><span style="font-family:var(--mono);font-weight:700;color:var(--gold);font-size:13px">${m.pts}</span></div>`;
    });
    html+=`</div>`;
  }

  html+=`<div class="card-sheet-section"><div class="card-sheet-section-title">Benefits</div>`;
  card.sections.forEach(s=>{
    const cadLbl=s.cadence==='monthly'?'monthly':s.cadence==='quarterly'?'quarterly':s.cadence==='cal-semi-annual'||s.cadence==='semi-annual'?'semi-annual':'annual';
    s.benefits.filter(b=>!b.startsFrom||b.startsFrom<=CY).forEach(b=>{
      const amt=b.amount>0?`$${b.amount}`:(b.note||'');
      html+=`<div class="card-sheet-row"><span style="color:var(--text-secondary);font-size:12px">${b.name}</span><span style="font-family:var(--mono);font-size:12px;color:var(--text)">${amt}<span style="color:var(--text-tertiary);font-size:10px"> /${cadLbl}</span></span></div>`;
    });
  });
  html+=`</div>`;

  const partners=TRANSFER_PARTNERS[cardKey]||[];
  if(partners.length){
    html+=`<div class="card-sheet-section">
      <div class="card-sheet-section-title">Transfer partners</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">`;
    partners.forEach(p=>{
      html+=`<span style="font-size:10px;font-family:var(--mono);color:var(--text-secondary);background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 7px">${p}</span>`;
    });
    html+=`</div></div>`;
  }

  document.getElementById('cardSheetTitle').textContent=card.name;
  document.getElementById('cardSheetBody').innerHTML=html;
  document.getElementById('cardSheetOverlay').classList.add('open');
  document.getElementById('cardSheet').classList.add('open');
  haptic('medium');
}
function closeCardSheet(){
  document.getElementById('cardSheetOverlay').classList.remove('open');
  document.getElementById('cardSheet').classList.remove('open');
}
function initCardFlip(){ startCarousel(); }

// ── Navigation ────────────────────────────────────────────────────────────
function updateYearSelector(show){
  const ys=document.getElementById('yearSelector');
  ys.classList.toggle('hidden',!show);
  const cardYearStart=(state.activePrimary==='card-year')?getCardYearStartLocal(state.activeCard,CY).year:CY;
  const openedYear=state.cardMeta?.[state.activeCard]?.openedYear??CARDS[state.activeCard]?.openedYear;
  const prevYear=cardYearStart-1;
  const cardData=state.DATA[state.activeCard]||{};
  const hasPrevData=Object.keys(cardData).some(k=>k.includes(String(prevYear)));
  const showPrev=!openedYear?hasPrevData:(prevYear>=openedYear);
  const years=showPrev?[prevYear,cardYearStart]:[cardYearStart];
  if(state.activePrimary==='card-year'&&!years.includes(state.selectedYear)) state.selectedYear=cardYearStart;
  ys.innerHTML=years.map(y=>`<button class="year-btn${y===state.selectedYear?' active':''}" data-year="${y}">${y}</button>`).join('');
}

function getCardYearStartLocal(c,forYear){
  const fm=getCardFeeMonth(c),fd=getCardFeeDay(c);
  const yr=forYear||state.selectedYear;
  if(yr<CY) return {year:yr,month:fm};
  const pastAnniversary=CM>fm||(CM===fm&&new Date().getDate()>=fd);
  return pastAnniversary?{year:CY,month:fm}:{year:CY-1,month:fm};
}

function updateSecondaryNav(primary){
  const sec=document.getElementById('navSecondary');
  const stabs=sec.querySelectorAll('.stab');
  if(primary==='card-year'){
    sec.classList.remove('hidden');
    stabs[0].textContent='Period'; stabs[0].dataset.view='history';
    stabs[1].textContent='Summary'; stabs[1].dataset.view='annual';
    updateYearSelector(true);
  } else if(primary==='ytd'){
    sec.classList.remove('hidden');
    stabs[0].textContent=`${state.selectedYear} History`; stabs[0].dataset.view='ytd-history';
    stabs[1].textContent=`${state.selectedYear} Summary`; stabs[1].dataset.view='ytd';
    updateYearSelector(true);
  } else if(primary==='recap'){
    sec.classList.add('hidden');
    updateYearSelector(true);
  } else {
    sec.classList.add('hidden');
    updateYearSelector(false);
  }
  stabs.forEach(t=>t.classList.toggle('active',t.dataset.view===state.activeView));
}

function setActiveView(primary){
  state.activePrimary=primary;
  if(primary==='all-cards'){ state.activeView='all-cards'; state.selectedYear=CY; }
  else if(primary==='this-period') state.activeView='current';
  else if(primary==='card-year') state.activeView=state.activeSecondary['card-year']||'history';
  else if(primary==='ytd') state.activeView=state.activeSecondary['ytd']||'ytd-history';
  else if(primary==='compare') state.activeView='compare';
  else if(primary==='history-log') state.activeView='history-log';
  else if(primary==='recap') state.activeView='recap';
  else if(primary==='heatmap') state.activeView='heatmap';
  else if(primary==='performance') state.activeView='performance';
  else if(primary==='digest') state.activeView='digest';
  else if(primary==='net-value') state.activeView='net-value';
  else if(primary==='badges') state.activeView='badges';
  else if(primary==='fee-optimizer') state.activeView='fee-optimizer';
  else if(primary==='card-simulator') state.activeView='card-simulator';
  else if(primary==='renewal-calendar') state.activeView='renewal-calendar';
  else if(primary==='upgrade-advisor') state.activeView='upgrade-advisor';
  else if(primary==='ai-advisor') state.activeView='ai-advisor';
  else if(primary==='wrap') state.activeView='wrap';
  else if(primary==='benefit-alerts') state.activeView='benefit-alerts';
  else if(primary==='points-redemptions') state.activeView='points-redemptions';
  else if(primary==='settings') state.activeView='settings';
  else if(primary==='more') state.activeView='more';
  else if(primary==='my-cards'){ openMyCards(); return; }

  const topViews=['all-cards','this-period','card-year','ytd'];
  if(topViews.includes(primary)){
    document.querySelectorAll('.nav-primary-btn').forEach(b=>b.classList.toggle('active',b.dataset.primary===primary));
    document.querySelectorAll('.drawer-item').forEach(b=>b.classList.remove('active'));
  } else {
    document.querySelectorAll('.nav-primary-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.drawer-item').forEach(b=>b.classList.toggle('active',b.dataset.primary===primary));
  }
  document.getElementById('navPrimary').classList.toggle('hidden', primary==='more');
  updateSecondaryNav(primary);
  updateBottomTabBar(primary);
  updateMainChromeVisibility(primary);
  if(primary==='settings'){ renderSettings(); updateAlertBadge(); return; }
  if(primary==='more'){ renderMore(); updateAlertBadge(); return; }
  if(primary==='badges'){ renderBadgesView(); updateAlertBadge(); return; }
  render();
  if(primary==='benefit-alerts') markAlertsSeen();
  updateAlertBadge();
}

function goToCardPeriod(cardKey){ state.activeCard=cardKey; setActiveView('this-period'); }

function openDrawer(){
  document.getElementById('navExtras').classList.add('open');
  document.getElementById('drawerOverlay').classList.add('open');
}
function closeDrawer(){
  document.getElementById('navExtras').classList.remove('open');
  document.getElementById('drawerOverlay').classList.remove('open');
}
function updateBottomTabBar(primary){
  document.querySelectorAll('.bottom-tab[data-bottom]').forEach(b=>b.classList.toggle('active',b.dataset.bottom===primary));
  const menuBtn=document.getElementById('bottomMenuBtn');
  if(menuBtn) menuBtn.classList.toggle('active',primary==='more');
  const homeBtn=document.getElementById('bottomHomeBtn');
  if(homeBtn) homeBtn.classList.toggle('active',['all-cards','this-period','card-year','ytd'].includes(primary));
}

function updateMainChromeVisibility(primary){
  const showTopChrome=['all-cards','this-period','card-year','ytd'].includes(primary);
  ['cardSelector','navPrimary','navSecondary','yearSelector','ptrIndicator'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.display=showTopChrome?'':'none';
  });
  document.querySelectorAll('.drag-hint,.ptr-indicator').forEach(el=>{
    el.style.display=showTopChrome?'':'none';
  });
}

// ── Card date modal ───────────────────────────────────────────────────────
function showCardDateModal(cards){
  const meta=loadCardMeta();
  const rows=cards.map(id=>{
    const card=CARDS[id]; if(!card) return '';
    const existing=meta[id];
    const monthOpts=MONTHS_FULL.map((m,i)=>`<option value="${i}"${existing?.openedMonth===i?' selected':''}>${m}</option>`).join('');
    return `<div style="margin-bottom:16px">
      <div style="font-size:12px;font-family:var(--mono);color:var(--text-secondary);margin-bottom:6px">${escapeHtml(card.name)}</div>
      <div style="display:flex;gap:8px;align-items:flex-end">
        <div style="flex:1">
          <label style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);display:block;margin-bottom:3px;letter-spacing:0.06em">MONTH</label>
          <select data-card="${id}" data-field="month" style="width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg);color:var(--text);font-size:13px">${monthOpts}</select>
        </div>
        <div style="width:80px">
          <label style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);display:block;margin-bottom:3px;letter-spacing:0.06em">YEAR</label>
          <input data-card="${id}" data-field="year" type="number" min="2000" max="2099" placeholder="—" value="${existing?.openedYear||''}" style="width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg);color:var(--text);font-size:13px;box-sizing:border-box">
        </div>
      </div>
    </div>`;
  }).join('');
  document.getElementById('cardDateList').innerHTML=rows;
  document.getElementById('cardDateModal').classList.remove('hidden');
}

function saveCardDates(){
  const modal=document.getElementById('cardDateModal');
  const years=modal.querySelectorAll('[data-field="year"]');
  const months=modal.querySelectorAll('[data-field="month"]');
  years.forEach((inp,i)=>{
    const cardId=inp.dataset.card;
    const year=parseInt(inp.value);
    const month=parseInt(months[i].value)||0;
    if(year>=2000&&year<=2099) setCardOpenedDate(cardId,year,month);
  });
  modal.classList.add('hidden');
  render();
}

// ── Note modal ────────────────────────────────────────────────────────────
function openNoteModal(cardKey,benefitId,pk,benefitName,periodLabel){
  state._noteCtx={cardKey,benefitId,pk};
  document.getElementById('noteModalTitle').textContent=benefitName;
  document.getElementById('noteModalSub').textContent=periodLabel||`${MONTHS_FULL[CM]} ${CY}`;
  const notes=loadNotes();
  document.getElementById('noteText').value=notes[getNoteKey(cardKey,benefitId,pk)]||'';
  document.getElementById('noteModal').classList.remove('hidden');
  setTimeout(()=>document.getElementById('noteText').focus(),100);
}
function closeNoteModal(){ document.getElementById('noteModal').classList.add('hidden'); }

// ── Fee date modal ────────────────────────────────────────────────────────
function openFeeDateModal(cardKey){
  state._feeDateEditCard=cardKey;
  document.getElementById('feeDateCardName').textContent=CARDS[cardKey].name;
  document.getElementById('feeDateMonth').value=getCardFeeMonth(cardKey);
  document.getElementById('feeDateDay').value=getCardFeeDay(cardKey);
  document.getElementById('feeDateModal').classList.remove('hidden');
}
function closeFeeDateModal(){ document.getElementById('feeDateModal').classList.add('hidden'); state._feeDateEditCard=null; }

// ── Dark mode toggle ──────────────────────────────────────────────────────
function toggleDark(){
  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  const newTheme=isDark?'light':'dark';
  document.documentElement.setAttribute('data-theme',newTheme);
  document.getElementById('darkIcon').innerHTML=newTheme==='dark'
    ?`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="1" x2="8" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="8" y1="13" x2="8" y2="15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="8" x2="3" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="13" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="3.05" y1="3.05" x2="4.46" y2="4.46" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="11.54" y1="11.54" x2="12.95" y2="12.95" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="12.95" y1="3.05" x2="11.54" y2="4.46" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="4.46" y1="11.54" x2="3.05" y2="12.95" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`
    :`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  document.getElementById('darkLabel').textContent=newTheme==='dark'?'Light':'Dark';
  localStorage.setItem('perks-theme',newTheme);
}

// ── Notifications ─────────────────────────────────────────────────────────
async function requestNotifications(){
  if(!('Notification' in window)){ alert('Notifications not supported in this browser.'); return; }
  const perm=await Notification.requestPermission();
  if(perm==='granted'){
    localStorage.setItem('perks-notif','1');
    scheduleMonthlyReminder();
    firePerBenefitReminders();
    new Notification('Perks Ledger',{body:'Notifications enabled! You\'ll be reminded before monthly, quarterly, and semi-annual benefits expire.',icon:'apple-touch-icon.png'});
    if(state.activeView==='settings') renderSettings();
    else setActiveView('settings');
  }
}
function disableNotifications(){
  localStorage.setItem('perks-notif','0');
  if(state.activeView==='settings') renderSettings();
}
function toggleNotifType(key,btn){
  const isOn=btn.classList.toggle('on');
  localStorage.setItem(key,isOn?'1':'0');
  if(key==='notif-perbenefit'&&isOn) firePerBenefitReminders();
}

function scheduleMonthlyReminder(){
  if(localStorage.getItem('perks-notif')!=='1') return;
  const now=new Date();
  const eomDays=new Date(CY,CM+1,0).getDate()-now.getDate();
  const q=Math.floor(CM/3);
  const eoqDays=Math.ceil((new Date(CY,(q+1)*3,0)-now)/86400000);
  const h=CM<6?0:1;
  const eohDays=Math.ceil((new Date(CY,h===0?6:12,0)-now)/86400000);

  function fire(key,body){ if(!localStorage.getItem(key)){ new Notification('Perks Ledger',{body,icon:'apple-touch-icon.png'}); localStorage.setItem(key,'1'); } }
  function sum(cadences,pkFn){
    let t=0;
    getVisibleCardKeys().forEach(ck=>{
      CARDS[ck].sections.forEach(s=>{
        if(!cadences.includes(s.cadence)) return;
        const pk=pkFn(s.cadence);
        s.benefits.forEach(b=>{ if(!state.DATA[ck]?.[`${b.id}__${pk}`]) t+=b.amount||0; });
      });
    });
    return t;
  }

  // Monthly: last 3 days
  if(eomDays<=2){
    const t=sum(['monthly'],()=>`${CY}-m${CM}`);
    if(t>0) fire(`notif-m-${CY}-${CM}`,`$${t.toFixed(0)} in monthly benefits expiring this month!`);
  }
  // Quarterly: last 5 days of quarter
  if(eoqDays<=4){
    const t=sum(['quarterly'],()=>`${CY}-q${q}`);
    if(t>0) fire(`notif-q-${CY}-${q}`,`$${t.toFixed(0)} in quarterly benefits expiring this week!`);
  }
  // Semi-annual: last 14 days of half
  if(eohDays<=13){
    const t=sum(['cal-semi-annual'],()=>`${CY}-h${h}`);
    if(t>0) fire(`notif-h-${CY}-${h}`,`$${t.toFixed(0)} in semi-annual benefits expiring soon!`);
  }
}

// Per-benefit reminders (opt-in): one notification per unclaimed benefit whose
// current period is within its cadence's expiry window. Deduped per benefit+period.
function firePerBenefitReminders(){
  if(localStorage.getItem('perks-notif')!=='1') return;
  if(localStorage.getItem('notif-perbenefit')!=='1') return;
  if(!('Notification' in window)||Notification.permission!=='granted') return;
  const now=new Date();
  const THRESH={monthly:3,quarterly:7,'cal-semi-annual':14,'semi-annual':14,annual:30,'cal-annual-overlap':30,'feb-annual':30};
  const cands=[];
  getVisibleCardKeys().forEach(ck=>{
    CARDS[ck].sections.forEach(s=>{
      const thr=THRESH[s.cadence]; if(thr===undefined) return;
      const ps=getCardYearPeriods(ck,s.cadence);
      const cur=ps.find(p=>isPCurrent(s.cadence,p));
      if(!cur) return;
      const eM=cur.endM!==undefined?cur.endM:cur.calM;
      const eY=cur.endY!==undefined?cur.endY:cur.calY;
      const endDate=new Date(eY,eM+1,0);
      const daysLeft=Math.round((endDate-now)/86400000);
      if(daysLeft<0||daysLeft>thr) return;
      s.benefits.forEach(b=>{
        if(isBNotAvailable(b,CY,cur)||isBExpired(b,cur)) return;
        if(isGloballySnoozed(ck,b.id)||isSkipped(ck,b.id,cur.pk)) return;
        if(isUsed(ck,b.id,cur.pk)) return;
        cands.push({ck,b,pk:cur.pk,daysLeft});
      });
    });
  });
  cands.sort((a,b)=>a.daysLeft-b.daysLeft);
  let fired=0;
  for(const {ck,b,pk,daysLeft} of cands){
    if(fired>=6) break;
    const dkey=`notifb-${ck}-${b.id}-${pk}`;
    if(localStorage.getItem(dkey)) continue;
    const when=daysLeft<=0?'expires today':`${daysLeft} day${daysLeft===1?'':'s'} left`;
    new Notification('Perks Ledger',{body:`$${b.amount||0} ${b.name} (${CARD_LABELS[ck]}) — ${when}`,icon:'apple-touch-icon.png'});
    localStorage.setItem(dkey,'1');
    fired++;
  }
}
if(localStorage.getItem('perks-notif')==='1'){ scheduleMonthlyReminder(); firePerBenefitReminders(); }

// ── Web Push (background, app-closed) ──────────────────────────────────────
function pushSupported(){ return 'serviceWorker' in navigator && 'PushManager' in window; }
function urlBase64ToUint8Array(base64String){
  const padding='='.repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(base64);
  const arr=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) arr[i]=raw.charCodeAt(i);
  return arr;
}
async function enablePush(){
  if(!pushSupported()){ alert('Background push is not supported in this browser.'); return false; }
  if(!VAPID_PUBLIC_KEY){ alert('Background push is not configured yet.'); return false; }
  const perm=await Notification.requestPermission();
  if(perm!=='granted') return false;
  const reg=await navigator.serviceWorker.ready;
  let sub=await reg.pushManager.getSubscription();
  if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC_KEY)});
  const uid=state.currentUser&&state.currentUser.id;
  if(uid&&uid!=='demo'){
    // delete+insert keeps the (user_id, endpoint) row unique without relying on upsert against a generated column
    await sb.from('perks_push_subscriptions').delete().eq('user_id',uid).eq('endpoint',sub.endpoint);
    const {error}=await sb.from('perks_push_subscriptions').insert({user_id:uid,subscription:sub.toJSON()});
    if(error){ console.error('[push subscribe]',error.message); alert('Could not save push subscription.'); return false; }
    // The send-push function reads digest_cache to build payloads, so prime it here
    // (otherwise the user would only get pushes if Email Digest is also enabled).
    const cache=buildDigestCache();
    const update={push_enabled:true};
    if(cache) update.digest_cache=cache;
    await sb.from('user_profiles').update(update).eq('user_id',uid);
  }
  localStorage.setItem('push-enabled','1');
  return true;
}
async function disablePush(){
  const uid=state.currentUser&&state.currentUser.id;
  if(pushSupported()){
    const reg=await navigator.serviceWorker.ready;
    const sub=await reg.pushManager.getSubscription();
    if(sub){
      const endpoint=sub.endpoint;
      await sub.unsubscribe();
      if(uid&&uid!=='demo') await sb.from('perks_push_subscriptions').delete().eq('user_id',uid).eq('endpoint',endpoint);
    }
  }
  if(uid&&uid!=='demo') await sb.from('user_profiles').update({push_enabled:false}).eq('user_id',uid);
  localStorage.setItem('push-enabled','0');
}
async function togglePush(btn){
  const turningOn=!btn.classList.contains('on');
  btn.disabled=true;
  try{
    if(turningOn){ if(await enablePush()) btn.classList.add('on'); }
    else { await disablePush(); btn.classList.remove('on'); }
  }catch(e){ console.error('togglePush',e); alert('Could not update background push.'); }
  btn.disabled=false;
}

// ── Undo ──────────────────────────────────────────────────────────────────
function showUndo(cardKey,id,pk,action){
  clearTimeout(state._undoTimer);
  state._undoStack={cardKey,id,pk,action};
  const toast=document.getElementById('undoToast');
  const msg=document.getElementById('undoMsg');
  if(action==='skipped') msg.textContent='Dismissed';
  else msg.textContent=action==='used'?'✓ Marked as used':'Unmarked';
  toast.classList.add('show');
  haptic('light');
  state._undoTimer=setTimeout(()=>{ toast.classList.remove('show'); state._undoStack=null; },4000);
}

function executeUndo(){
  if(!state._undoStack) return;
  const {cardKey,id,pk,action}=state._undoStack;
  if(action==='skipped') unskipBenefit(cardKey,id,pk);
  else toggle(cardKey,id,pk);
  document.getElementById('undoToast').classList.remove('show');
  state._undoStack=null;
  clearTimeout(state._undoTimer);
  haptic('medium');
  render();
}

document.addEventListener('perks:benefit-toggled',e=>{
  showUndo(e.detail.cardKey,e.detail.id,e.detail.pk,e.detail.action);
});
document.addEventListener('perks:benefit-skipped',e=>{
  showUndo(e.detail.cardKey,e.detail.id,e.detail.pk,'skipped');
});
document.addEventListener('perks:rerender',()=>{ if(state.activeView!=='settings') render(); });
document.addEventListener('perks:benefit-toggled',()=>{ setTimeout(checkProfitConfetti,200); });
document.addEventListener('perks:benefit-toggled',()=>{
  setTimeout(()=>{
    const newBadges=checkBadges();
    if(newBadges.length) showBadgeToast(newBadges[0]);
  },400);
});

// ── Shake to undo ─────────────────────────────────────────────────────────
(function initShake(){
  let shakeTime=0;
  const THRESHOLD=20,COOLDOWN=1000;
  function onMotion(e){
    const acc=e.accelerationIncludingGravity;
    if(!acc) return;
    const mag=Math.abs(acc.x)+Math.abs(acc.y)+Math.abs(acc.z);
    const now=Date.now();
    if(mag>THRESHOLD&&now-shakeTime>COOLDOWN&&state._undoStack){
      shakeTime=now;
      executeUndo();
    }
  }
  if(typeof DeviceMotionEvent!=='undefined'){
    if(typeof DeviceMotionEvent.requestPermission==='function'){
      if(localStorage.getItem('perks-motion')==='granted'){
        window.addEventListener('devicemotion',onMotion);
      } else if(localStorage.getItem('perks-motion')!=='denied'){
        document.addEventListener('click',function grantMotion(){
          DeviceMotionEvent.requestPermission().then(r=>{
            localStorage.setItem('perks-motion',r);
            if(r==='granted') window.addEventListener('devicemotion',onMotion);
          }).catch(()=>{});
        },{once:true});
      }
    } else {
      window.addEventListener('devicemotion',onMotion);
    }
  }
})();

// ── Event listeners ───────────────────────────────────────────────────────
document.getElementById('authBtn').addEventListener('click',handleAuth);
document.getElementById('authEmail').addEventListener('keydown',e=>{ if(e.key==='Enter') handleAuth(); });
document.getElementById('authPassword').addEventListener('keydown',e=>{ if(e.key==='Enter') handleAuth(); });
document.getElementById('authConfirm').addEventListener('keydown',e=>{ if(e.key==='Enter') handleAuth(); });

document.getElementById('undoBtn').addEventListener('click',()=>{ executeUndo(); });

document.getElementById('noteSave').addEventListener('click',()=>{
  const notes=loadNotes();
  const key=getNoteKey(state._noteCtx.cardKey,state._noteCtx.benefitId,state._noteCtx.pk);
  const val=document.getElementById('noteText').value.trim();
  if(val) notes[key]=val; else delete notes[key];
  saveNotes(notes);
  closeNoteModal();
  renderCurrent();
});
document.getElementById('noteClear').addEventListener('click',()=>{
  const notes=loadNotes();
  delete notes[getNoteKey(state._noteCtx.cardKey,state._noteCtx.benefitId,state._noteCtx.pk)];
  saveNotes(notes);
  closeNoteModal();
  renderCurrent();
});
document.getElementById('noteCancel').addEventListener('click',closeNoteModal);
document.getElementById('noteModal').addEventListener('click',e=>{ if(e.target===e.currentTarget) closeNoteModal(); });

document.getElementById('feeDateSave').addEventListener('click',()=>{
  if(!state._feeDateEditCard) return;
  const d=getFeeOverrides();
  d[state._feeDateEditCard]={feeMonth:parseInt(document.getElementById('feeDateMonth').value),feeDay:parseInt(document.getElementById('feeDateDay').value)||1};
  saveFeeOverridesData(d);
  closeFeeDateModal();
  render();
});
document.getElementById('feeDateReset').addEventListener('click',()=>{
  if(!state._feeDateEditCard) return;
  const d=getFeeOverrides();
  delete d[state._feeDateEditCard];
  saveFeeOverridesData(d);
  closeFeeDateModal();
  render();
});
document.getElementById('feeDateCancel').addEventListener('click',closeFeeDateModal);
document.getElementById('feeDateModal').addEventListener('click',e=>{ if(e.target===e.currentTarget) closeFeeDateModal(); });

document.getElementById('cardSheetClose').addEventListener('click',closeCardSheet);
document.getElementById('cardSheetOverlay').addEventListener('click',closeCardSheet);

document.getElementById('menuBtn').addEventListener('click',openDrawer);
document.getElementById('drawerClose').addEventListener('click',closeDrawer);
document.getElementById('drawerOverlay').addEventListener('click',closeDrawer);

// ── Bottom tab bar ────────────────────────────────────────────────────────
document.getElementById('bottomMenuBtn').addEventListener('click',()=>setActiveView('more'));
document.getElementById('bottomHomeBtn').addEventListener('click',()=>setActiveView('this-period'));
document.getElementById('bottomTabBar').querySelectorAll('.bottom-tab[data-bottom]').forEach(btn=>{
  btn.addEventListener('click',()=>setActiveView(btn.dataset.bottom));
});

document.getElementById('navPrimary').querySelectorAll('.nav-primary-btn').forEach(btn=>{
  btn.addEventListener('click',e=>{
    if(e.target.closest('.month-arrow')) return;
    if(btn.dataset.primary==='this-period'){ state._periodOffset=0; updateMonthTabLabel(); }
    document.querySelectorAll('.drawer-item').forEach(b=>b.classList.remove('active'));
    setActiveView(btn.dataset.primary);
  });
});
document.getElementById('monthPrevBtn').addEventListener('click',e=>{
  e.stopPropagation();
  state._periodOffset=(state._periodOffset||0)-1;
  updateMonthTabLabel();
  if(state.activePrimary==='this-period') renderCurrent(); else setActiveView('this-period');
});
document.getElementById('monthNextBtn').addEventListener('click',e=>{
  e.stopPropagation();
  if((state._periodOffset||0)>=0) return;
  state._periodOffset=(state._periodOffset||0)+1;
  updateMonthTabLabel();
  if(state.activePrimary==='this-period') renderCurrent(); else setActiveView('this-period');
});
document.getElementById('navExtras').querySelectorAll('.drawer-item').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.nav-primary-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.drawer-item').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    closeDrawer();
    setActiveView(btn.dataset.primary);
  });
});
document.getElementById('navSecondary').addEventListener('click',e=>{
  const btn=e.target.closest('.stab');
  if(!btn) return;
  const view=btn.dataset.view;
  if(!view) return;
  state.activeView=view;
  state.activeSecondary[state.activePrimary]=view;
  updateSecondaryNav(state.activePrimary);
  render();
});
document.getElementById('yearSelector').addEventListener('click',e=>{
  const btn=e.target.closest('.year-btn');
  if(!btn) return;
  state.selectedYear=parseInt(btn.dataset.year);
  updateYearSelector(true);
  render();
});

// ── #main event delegation ────────────────────────────────────────────────
document.getElementById('main').addEventListener('click',e=>{
  const checkBtn=e.target.closest('.check-btn');
  if(checkBtn){
    e.stopPropagation();
    toggle(state.activeCard,checkBtn.dataset.id,checkBtn.dataset.pk);
    haptic('light');
    checkBtn.classList.add('pop');
    setTimeout(()=>checkBtn.classList.remove('pop'),300);
    checkAllClaimed(state.activeCard);
    renderCurrent();
    return;
  }
  const dotBtn=e.target.closest('.dot-btn');
  if(dotBtn){
    if(dotBtn.dataset.c==='false') return;
    toggle(state.activeCard,dotBtn.dataset.id,dotBtn.dataset.pk);
    render();
    return;
  }
  const secHeader=e.target.closest('.section-header.collapsible-header');
  if(secHeader&&secHeader.dataset.sectionKey){
    if(e.target.closest('.check-btn,.benefit-note,.add-note,.partial-input')) return;
    const key=secHeader.dataset.sectionKey;
    const allClaimed=secHeader.dataset.allClaimed==='true';
    if(allClaimed){
      if(state._userExpandedSections.has(key)) state._userExpandedSections.delete(key);
      else state._userExpandedSections.add(key);
    } else {
      if(state._collapsedCurrentSections.has(key)) state._collapsedCurrentSections.delete(key);
      else state._collapsedCurrentSections.add(key);
    }
    haptic('light');
    renderCurrent();
    return;
  }
  const snoozeBtn=e.target.closest('[data-snooze-id]');
  if(snoozeBtn){
    e.stopPropagation();
    const benefitId=snoozeBtn.dataset.snoozeId;
    const cardKey=snoozeBtn.dataset.snoozeCard;
    const benefitName=snoozeBtn.dataset.snoozeName||benefitId;
    openSnoozeModal(cardKey,benefitId,benefitName);
    return;
  }
  const unsnoozeLink=e.target.closest('[data-unsnooze]');
  if(unsnoozeLink){
    e.stopPropagation();
    const benefitId=unsnoozeLink.dataset.unsnooze;
    const cardKey=unsnoozeLink.dataset.unsnoozeCard||state.activeCard;
    setSnoozedBenefit(cardKey,benefitId,null,null);
    render();
    return;
  }
  const cadHeader=e.target.closest('.collapsible-header[data-cadence]');
  if(cadHeader){
    const cadence=cadHeader.dataset.cadence;
    const nowCollapsed=state._collapsedSections.has(cadence);
    if(nowCollapsed) state._collapsedSections.delete(cadence);
    else state._collapsedSections.add(cadence);
    haptic('light');
    const body=document.getElementById(`section-body-${cadence}`);
    const chevron=cadHeader.querySelector('[style*="rotate"]');
    if(body){
      body.style.maxHeight=nowCollapsed?'2000px':'0';
      body.style.opacity=nowCollapsed?'1':'0';
    }
    if(chevron) chevron.style.transform=`rotate(${nowCollapsed?'0deg':'-90deg'})`;
    return;
  }
});

// ── ROI/Trends card drag-to-reorder ──────────────────────────────────────
let _dragCardSrc=null;
document.getElementById('main').addEventListener('dragstart',e=>{
  const card=e.target.closest('[data-drag-card]');
  if(!card) return;
  _dragCardSrc=card.dataset.dragCard;
  e.dataTransfer.effectAllowed='move';
  setTimeout(()=>card.style.opacity='0.4',0);
});
document.getElementById('main').addEventListener('dragend',e=>{
  const card=e.target.closest('[data-drag-card]');
  if(card) card.style.opacity='';
  document.querySelectorAll('[data-drag-card].drag-over').forEach(el=>el.classList.remove('drag-over'));
  _dragCardSrc=null;
});
document.getElementById('main').addEventListener('dragover',e=>{
  const card=e.target.closest('[data-drag-card]');
  if(!card||card.dataset.dragCard===_dragCardSrc) return;
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
  document.querySelectorAll('[data-drag-card].drag-over').forEach(el=>{ if(el!==card) el.classList.remove('drag-over'); });
  card.classList.add('drag-over');
});
document.getElementById('main').addEventListener('dragleave',e=>{
  const card=e.target.closest('[data-drag-card]');
  if(card&&!card.contains(e.relatedTarget)) card.classList.remove('drag-over');
});
document.getElementById('main').addEventListener('drop',e=>{
  const card=e.target.closest('[data-drag-card]');
  if(!card||!_dragCardSrc||card.dataset.dragCard===_dragCardSrc) return;
  e.preventDefault();
  card.classList.remove('drag-over');
  const keys=getVisibleCardKeys();
  const si=keys.indexOf(_dragCardSrc),ti=keys.indexOf(card.dataset.dragCard);
  if(si<0||ti<0) return;
  keys.splice(si,1); keys.splice(ti,0,_dragCardSrc);
  localStorage.setItem('perks-card-order',JSON.stringify(keys));
  scheduleSave();
  render();
});

// ── Swipe gestures ────────────────────────────────────────────────────────
const TOP_VIEWS=['all-cards','this-period','card-year','ytd'];
document.addEventListener('touchstart',e=>{ state.touchStartX=e.touches[0].clientX; state.touchStartY=e.touches[0].clientY; },{passive:true});
document.addEventListener('touchend',e=>{
  const dx=e.changedTouches[0].clientX-state.touchStartX;
  const dy=e.changedTouches[0].clientY-state.touchStartY;
  if(Math.abs(dx)<40||Math.abs(dy)>Math.abs(dx)*0.8) return;
  if(dx<-40&&state.touchStartX>30){ const idx=TOP_VIEWS.indexOf(state.activePrimary); if(idx>=0&&idx<TOP_VIEWS.length-1) setActiveView(TOP_VIEWS[idx+1]); }
  else if(dx>40){ const idx=TOP_VIEWS.indexOf(state.activePrimary); if(idx>0) setActiveView(TOP_VIEWS[idx-1]); }
},{passive:true});

// ── Pull to refresh ───────────────────────────────────────────────────────
document.addEventListener('touchstart',e=>{ if(window.scrollY===0) state.ptrStartY=e.touches[0].clientY; },{passive:true});
document.addEventListener('touchmove',e=>{
  if(!state.ptrStartY) return;
  const dy=e.touches[0].clientY-state.ptrStartY;
  if(dy>20&&window.scrollY===0){
    state.ptrActive=true;
    const ind=document.getElementById('ptrIndicator');
    if(ind){ ind.classList.remove('hidden'); ind.classList.add('visible'); }
  }
},{passive:true});
document.addEventListener('touchend',async()=>{
  if(state.ptrActive){
    state.ptrActive=false; haptic('light');
    await syncFromSupabase();
    const ind=document.getElementById('ptrIndicator');
    if(ind){ ind.classList.remove('visible'); ind.classList.add('hidden'); }
    state.ptrStartY=0;
  }
},{passive:true});

// ── Keyboard shortcuts ────────────────────────────────────────────────────
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if(e.key==='1') setActiveView('all-cards');
  else if(e.key==='2') setActiveView('this-period');
  else if(e.key==='3') setActiveView('card-year');
  else if(e.key==='4') setActiveView('ytd');
  else if(e.key==='m'||e.key==='M') openDrawer();
  else if(e.key==='Escape') closeDrawer();
});

// ── SVG nav icons IIFE ────────────────────────────────────────────────────
(function(){
  const day=new Date().getDate();
  const month=new Date().toLocaleString('default',{month:'short'}).toUpperCase();
  const currentTab=document.getElementById('currentTab');
  if(currentTab) currentTab.textContent='Month';
  const S='width:22px;height:22px;display:block';
  const icons={
    'all-cards':`<svg style="${S}" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="18" height="3" rx="1.5" fill="currentColor" opacity="0.9"/><rect x="2" y="9.5" width="18" height="3" rx="1.5" fill="currentColor" opacity="0.9"/><rect x="2" y="15" width="18" height="3" rx="1.5" fill="currentColor" opacity="0.9"/></svg>`,
    'this-period':`<svg style="${S}" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="18" height="16" rx="2.5" fill="currentColor" opacity="0.08"/><rect x="2" y="3" width="18" height="16" rx="2.5" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="3" width="18" height="6.5" rx="2.5" fill="#e03030"/><rect x="2" y="6.5" width="18" height="3" fill="#e03030"/><line x1="7" y1="3" x2="7" y2="9.5" stroke="rgba(255,255,255,0.4)" stroke-width="1.2"/><line x1="15" y1="3" x2="15" y2="9.5" stroke="rgba(255,255,255,0.4)" stroke-width="1.2"/><text x="11" y="8.8" text-anchor="middle" font-size="4.5" font-weight="700" font-family="system-ui,sans-serif" fill="white" letter-spacing="0.5">${month}</text><text x="11" y="17.5" text-anchor="middle" font-size="8.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">${day}</text></svg>`,
    'card-year':`<svg style="${S}" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="18" height="12" rx="2.5" stroke="currentColor" stroke-width="1.6"/><rect x="2" y="9" width="18" height="2.5" fill="currentColor" opacity="0.35"/><rect x="4" y="13" width="5" height="1.5" rx="0.75" fill="currentColor" opacity="0.7"/></svg>`,
    'ytd':`<svg style="${S}" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="2,17 7,11 11,13 16,7 20,5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><polyline points="16,5 20,5 20,9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };
  Object.entries(icons).forEach(([primary,svg])=>{
    const btn=document.querySelector(`.nav-primary-btn[data-primary="${primary}"]`);
    if(!btn) return;
    const icon=btn.querySelector('.nav-icon');
    if(!icon) return;
    icon.innerHTML=svg; icon.style.fontSize='0'; icon.style.lineHeight='0';
    icon.style.display='flex'; icon.style.alignItems='center'; icon.style.justifyContent='center'; icon.style.marginBottom='2px';
  });
})();

// ── Drawer icon map (module scope for reuse in renderMore) ────────────────
const _DRAWER_ICONS={
  'priority':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="5" x2="8" y2="8.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11" r="0.8" fill="currentColor"/></svg>`,
  'insights':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2a4 4 0 0 1 4 4c0 1.6-.9 3-2.2 3.7V11H6.2V9.7A4 4 0 0 1 4 6a4 4 0 0 1 4-4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><line x1="6.2" y1="12.5" x2="9.8" y2="12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="6.8" y1="14" x2="9.2" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  'keep-card':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="4" width="13" height="9" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 8.5L7 10l3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  'compare':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="3.5" width="5.5" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="3.5" width="5.5" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5"/></svg>`,
  'heatmap':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="3" height="3" rx="0.75" fill="currentColor" opacity="0.3"/><rect x="6.5" y="2" width="3" height="3" rx="0.75" fill="currentColor" opacity="0.7"/><rect x="11" y="2" width="3" height="3" rx="0.75" fill="currentColor"/><rect x="2" y="6.5" width="3" height="3" rx="0.75" fill="currentColor" opacity="0.7"/><rect x="6.5" y="6.5" width="3" height="3" rx="0.75" fill="currentColor" opacity="0.4"/><rect x="11" y="6.5" width="3" height="3" rx="0.75" fill="currentColor" opacity="0.85"/><rect x="2" y="11" width="3" height="3" rx="0.75" fill="currentColor"/><rect x="6.5" y="11" width="3" height="3" rx="0.75" fill="currentColor" opacity="0.5"/><rect x="11" y="11" width="3" height="3" rx="0.75" fill="currentColor" opacity="0.25"/></svg>`,
  'history-log':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><polyline points="8,5 8,8.5 10.5,10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  'recap':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/><line x1="10.5" y1="1.5" x2="10.5" y2="4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="5.5" y1="1.5" x2="5.5" y2="4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="2" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.4"/></svg>`,
  'digest':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="3" rx="1" fill="currentColor" opacity="0.9"/><rect x="2" y="6.5" width="8" height="3" rx="1" fill="currentColor" opacity="0.7"/><rect x="2" y="11" width="5" height="3" rx="1" fill="currentColor" opacity="0.45"/></svg>`,
  'net-value':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.4"/></svg>`,
  'badges':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.5 3 3.5.5-2.5 2.4.6 3.6L8 10l-3.1 1.5.6-3.6L3 5.5l3.5-.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  'performance':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="9" width="2.5" height="5" rx="0.75" fill="currentColor" opacity="0.7"/><rect x="6" y="6" width="2.5" height="8" rx="0.75" fill="currentColor" opacity="0.85"/><rect x="10" y="3" width="2.5" height="11" rx="0.75" fill="currentColor"/><line x1="1.5" y1="14.5" x2="14.5" y2="14.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3.5 7.5l3.5-2.5 2.5 1.5 3-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  'fee-optimizer':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.5V8l2.5 1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M5.5 11.5C6.3 12.4 7 13 8 13s2-.5 2-1.5-1-1.5-2-1.5-2-.5-2-1.5S6 7 8 7s1.5.5 2 1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  'card-simulator':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="4.5" width="13" height="8.5" rx="2" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="7" x2="8" y2="10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="6.25" y1="8.75" x2="9.75" y2="8.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M5 4.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  'upgrade-advisor':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="7.5" width="9" height="6" rx="1.5" stroke="currentColor" stroke-width="1.4" opacity="0.55"/><rect x="4" y="4.5" width="9" height="6" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M12 1.5V4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10.5 3L12 1.5 13.5 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  'wrap':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.2 2.5 2.8.4-2 2 .5 2.8L8 8.4l-2.5 1.3.5-2.8-2-2 2.8-.4z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><line x1="5.5" y1="13.5" x2="10.5" y2="13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="8" y1="11" x2="8" y2="13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  'benefit-alerts':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2A3.5 3.5 0 0 1 11.5 5.5c0 2 .5 3 1.5 3.5H3c1-.5 1.5-1.5 1.5-3.5A3.5 3.5 0 0 1 8 2z" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 11.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1.4"/><circle cx="12.5" cy="3.5" r="2" fill="var(--red)"/></svg>`,
  'ai-advisor':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 6.5C5.5 5.1 6.6 4 8 4s2.5 1.1 2.5 2.5c0 1-0.6 1.9-1.5 2.3V10H7V8.8C6.1 8.4 5.5 7.5 5.5 6.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><line x1="7" y1="11.5" x2="9" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="7.5" y1="13" x2="8.5" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  'renewal-calendar':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/><line x1="2" y1="6.5" x2="14" y2="6.5" stroke="currentColor" stroke-width="1.5"/><line x1="5" y1="1.5" x2="5" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="11" y1="1.5" x2="11" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  'points-redemptions':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.5V5m0 6v.5M6 6.5c0-.8.9-1.5 2-1.5s2 .7 2 1.5S9.1 8 8 8s-2 .7-2 1.5S7 11 8 11s2-.7 2-1.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/></svg>`,
  'settings':`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/><path d="M13 9.5l.6-1-1-1a3.5 3.5 0 0 0-.3-.7l.4-1.3-1.2-1.2-1.3.4a3.5 3.5 0 0 0-.7-.3L9 3H7l-.5 1.4a3.5 3.5 0 0 0-.7.3L4.5 4.3 3.3 5.5l.4 1.3a3.5 3.5 0 0 0-.3.7L2 8v1l1.4.5c.1.2.2.5.3.7l-.4 1.3 1.2 1.2 1.3-.4c.2.1.5.2.7.3L7 14h2l.5-1.4c.2-.1.5-.2.7-.3l1.3.4 1.2-1.2-.4-1.3c.1-.2.2-.5.3-.7L14 9.5z" stroke="currentColor" stroke-width="1.4"/></svg>`,
};

// ── Badge toast ───────────────────────────────────────────────────────────
let _badgeToastTimer=null;
function showBadgeToast(id){
  const def=BADGE_DEFS.find(d=>d.id===id);
  if(!def) return;
  const color=TIER_COLORS[def.tier];
  const toast=document.getElementById('badgeToast');
  const inner=document.getElementById('badgeToastInner');
  if(!toast||!inner) return;
  const trophySVG=`<svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.5 3 3.5.5-2.5 2.4.6 3.6L8 10l-3.1 1.5.6-3.6L3 5.5l3.5-.5z" stroke="${color}" stroke-width="1.4" stroke-linejoin="round" fill="${color}22"/></svg>`;
  inner.innerHTML=`
    <div style="width:36px;height:36px;border-radius:50%;border:2px solid ${color};background:${color}18;display:flex;align-items:center;justify-content:center;flex-shrink:0">${trophySVG}</div>
    <div style="min-width:0">
      <div style="font-size:10px;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.07em;color:${color};font-weight:600">Badge Unlocked · ${def.tier}</div>
      <div style="font-size:13px;font-weight:600;color:var(--text);margin-top:1px">${def.name}</div>
      <div style="font-size:11px;color:var(--text-secondary);font-family:var(--mono);margin-top:1px">${def.desc}</div>
    </div>`;
  inner.onclick=()=>{ toast.classList.remove('show'); setActiveView('badges'); };
  clearTimeout(_badgeToastTimer);
  toast.classList.add('show');
  haptic('success');
  _badgeToastTimer=setTimeout(()=>toast.classList.remove('show'),5000);
}

// ── Badges view ───────────────────────────────────────────────────────────
const BADGE_ICONS={
  // Streaks — flame / lightning / diamond
  streak_3:   `<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><path d="M12 3c-2 3.5-4 7-2 10C8.5 12 8 10 8 10 6 12.5 6 16 8.5 18.5 10 20 11 21 12 21s2-1 3.5-2.5C18 16 18 12.5 16 10c0 0 0 2-2 3 2-3 0-7-2-10z" fill="white"/></svg>`,
  streak_6:   `<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><path d="M12 3c-2 3.5-4 7-2 10C8.5 12 8 10 8 10 6 12.5 6 16 8.5 18.5 10 20 11 21 12 21s2-1 3.5-2.5C18 16 18 12.5 16 10c0 0 0 2-2 3 2-3 0-7-2-10z" fill="white"/></svg>`,
  streak_12:  `<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><path d="M12 3c-2 3.5-4 7-2 10C8.5 12 8 10 8 10 6 12.5 6 16 8.5 18.5 10 20 11 21 12 21s2-1 3.5-2.5C18 16 18 12.5 16 10c0 0 0 2-2 3 2-3 0-7-2-10z" fill="white"/></svg>`,
  streak_18:  `<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><path d="M13 3L6 14h6l-1 7 7-11h-6l1-7z" fill="white" stroke="white" stroke-width="0.5" stroke-linejoin="round"/></svg>`,
  streak_24:  `<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><path d="M12 3l2.4 7.3H22l-6.2 4.5 2.4 7.2L12 17.2l-6.2 4.8 2.4-7.2L2 10.3h7.6z" fill="white" stroke="white" stroke-width="0.5" stroke-linejoin="round"/></svg>`,
  // Portfolio size — stacked cards
  collector:     `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="2" y="13" width="14" height="8" rx="2" fill="white" fill-opacity="0.45"/><rect x="4" y="9" width="14" height="8" rx="2" fill="white" fill-opacity="0.7"/><rect x="6" y="5" width="14" height="8" rx="2" fill="white"/></svg>`,
  portfolio_pro: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="2" y="13" width="14" height="8" rx="2" fill="white" fill-opacity="0.45"/><rect x="4" y="9" width="14" height="8" rx="2" fill="white" fill-opacity="0.7"/><rect x="6" y="5" width="14" height="8" rx="2" fill="white"/></svg>`,
  card_shark:    `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="2" y="13" width="14" height="8" rx="2" fill="white" fill-opacity="0.45"/><rect x="4" y="9" width="14" height="8" rx="2" fill="white" fill-opacity="0.7"/><rect x="6" y="5" width="14" height="8" rx="2" fill="white"/></svg>`,
  whale:         `<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><path d="M2 19h20M4 19L2 8l5 5 5-9 5 9 5-5-2 11H4z" fill="white" fill-opacity="0.25" stroke="white" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  // Single-card value — gem
  big_win:      `<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><path d="M8 7l4-4 4 4-4 10z" fill="white"/><path d="M5 7l3-4M19 7l-3-4M5 7h14" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  high_roller:  `<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><path d="M8 7l4-4 4 4-4 10z" fill="white"/><path d="M5 7l3-4M19 7l-3-4M5 7h14" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  elite_earner: `<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><path d="M8 7l4-4 4 4-4 10z" fill="white"/><path d="M5 7l3-4M19 7l-3-4M5 7h14" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  // Portfolio total — trophy / chart up
  getting_started:`<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M12 5v14M5 12l7-7 7 7" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  gaining_ground: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><polyline points="3,17 9,11 13,15 21,7" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 7h6v6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  high_achiever:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M8 3h8v5a4 4 0 0 1-8 0V3z" fill="white" fill-opacity="0.9"/><path d="M5 5H3v2.5a3 3 0 0 0 3 3" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M19 5h2v2.5a3 3 0 0 1-3 3" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M9 11.5h6M12 11.5v3M9 14.5h6" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  power_user:     `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M8 3h8v5a4 4 0 0 1-8 0V3z" fill="white" fill-opacity="0.9"/><path d="M5 5H3v2.5a3 3 0 0 0 3 3" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M19 5h2v2.5a3 3 0 0 1-3 3" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M9 11.5h6M12 11.5v3M9 14.5h6" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  maximizer:      `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M8 3h8v5a4 4 0 0 1-8 0V3z" fill="white" fill-opacity="0.9"/><path d="M5 5H3v2.5a3 3 0 0 0 3 3" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M19 5h2v2.5a3 3 0 0 1-3 3" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M9 11.5h6M12 11.5v3M9 14.5h6" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  true_maximizer: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M8 3h8v5a4 4 0 0 1-8 0V3z" fill="white" fill-opacity="0.9"/><path d="M5 5H3v2.5a3 3 0 0 0 3 3" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M19 5h2v2.5a3 3 0 0 1-3 3" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M9 11.5h6M12 11.5v3M9 14.5h6" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  // Fee mastery — scissors
  first_profit:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="7" cy="7" r="2.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.2"/><circle cx="7" cy="17" r="2.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.2"/><path d="M9.5 8.5L21 4M9.5 15.5L21 20" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  double_dipper: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="7" cy="7" r="2.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.2"/><circle cx="7" cy="17" r="2.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.2"/><path d="M9.5 8.5L21 4M9.5 15.5L21 20" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  triple_threat: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="7" cy="7" r="2.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.2"/><circle cx="7" cy="17" r="2.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.2"/><path d="M9.5 8.5L21 4M9.5 15.5L21 20" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  fee_crusher:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="7" cy="7" r="2.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.2"/><circle cx="7" cy="17" r="2.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.2"/><path d="M9.5 8.5L21 4M9.5 15.5L21 20" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  // Card mastery — ribbon medal
  gold_master:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="12" cy="9" r="4.5" fill="white" fill-opacity="0.9"/><path d="M8.5 12l-3 9 3.5-1.5 1.5 2 2.5-7M15.5 12l3 9-3.5-1.5-1.5 2-2.5-7" fill="white" fill-opacity="0.55"/></svg>`,
  plat_master:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="12" cy="9" r="4.5" fill="white" fill-opacity="0.9"/><path d="M8.5 12l-3 9 3.5-1.5 1.5 2 2.5-7M15.5 12l3 9-3.5-1.5-1.5 2-2.5-7" fill="white" fill-opacity="0.55"/></svg>`,
  csr_master:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="12" cy="9" r="4.5" fill="white" fill-opacity="0.9"/><path d="M8.5 12l-3 9 3.5-1.5 1.5 2 2.5-7M15.5 12l3 9-3.5-1.5-1.5 2-2.5-7" fill="white" fill-opacity="0.55"/></svg>`,
  // Claim volume — lightning
  benefit_ninja:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M13 3L6 14h6l-1 7 7-11h-6l1-7z" fill="white" stroke="white" stroke-width="0.5" stroke-linejoin="round"/></svg>`,
  benefit_machine: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M13 3L6 14h6l-1 7 7-11h-6l1-7z" fill="white" stroke="white" stroke-width="0.5" stroke-linejoin="round"/></svg>`,
  century:         `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M13 3L6 14h6l-1 7 7-11h-6l1-7z" fill="white" stroke="white" stroke-width="0.5" stroke-linejoin="round"/></svg>`,
  // Completionist — star / sunrise
  grand_slam:   `<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><path d="M12 2l2.4 7.3H22l-6.2 4.5 2.4 7.2L12 17l-6.2 4 2.4-7.2L2 9.3h7.6z" fill="white" stroke="white" stroke-width="0.5" stroke-linejoin="round"/></svg>`,
  early_bird:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M12 9v1.5M7.5 11.5l1.1 1.1M16.5 11.5l-1.1 1.1M5 18h14M8.5 18a3.5 3.5 0 0 1 7 0" stroke="white" stroke-width="1.9" stroke-linecap="round"/></svg>`,
  all_in:       `<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><path d="M12 2l2.4 7.3H22l-6.2 4.5 2.4 7.2L12 17l-6.2 4 2.4-7.2L2 9.3h7.6z" fill="white" stroke="white" stroke-width="0.5" stroke-linejoin="round"/></svg>`,
  perfectionist:`<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><path d="M12 2l2.4 7.3H22l-6.2 4.5 2.4 7.2L12 17l-6.2 4 2.4-7.2L2 9.3h7.6z" fill="white" stroke="white" stroke-width="0.5" stroke-linejoin="round"/></svg>`,
  all_in_2:     `<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><path d="M12 2l2.4 7.3H22l-6.2 4.5 2.4 7.2L12 17l-6.2 4 2.4-7.2L2 9.3h7.6z" fill="white" stroke="white" stroke-width="0.5" stroke-linejoin="round"/></svg>`,
  // Category specialists
  uber_loyalist:    `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M5 11l2-5h10l2 5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="11" width="18" height="6" rx="1.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.15"/><circle cx="7.5" cy="19.5" r="1.5" fill="white"/><circle cx="16.5" cy="19.5" r="1.5" fill="white"/></svg>`,
  doordash_devotee:`<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M6 8h12l1.5 10H4.5L6 8z" stroke="white" stroke-width="1.8" stroke-linejoin="round" fill="white" fill-opacity="0.15"/><path d="M9 8V6a3 3 0 0 1 6 0v2" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  dining_devotee:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M8 3v7a3 3 0 0 0 3 3v8" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M16 3v18" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M8 3c0 0 2.5 1.5 2.5 3.5S8 10 8 10" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  fitness_fan:     `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M2 12h4l3-6 4 12 3-6h6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  clear_member:    `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M12 3L4 7v5c0 4.5 3.5 8.7 8 10 4.5-1.3 8-5.5 8-10V7L12 3z" stroke="white" stroke-width="1.8" stroke-linejoin="round" fill="white" fill-opacity="0.15"/><path d="M9 12l2 2 4-4" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  global_traveler: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M21 16v-2l-8-5V4a1 1 0 0 0-2 0v5l-8 5v2l8-2.5V18l-2 1.5V21l3-1 3 1v-1.5l-2-1.5v-4.5l8 2.5z" fill="white"/></svg>`,
  hotel_hopper:    `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="3" y="4" width="18" height="17" rx="1.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M3 9h18" stroke="white" stroke-width="1.8"/><path d="M8 14h2M14 14h2M8 17h2M14 17h2" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M10 21v-4h4v4" stroke="white" stroke-width="1.8"/></svg>`,
  lounge_lizard:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M4 12V9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M2 12h20v4H2v-4z" fill="white" fill-opacity="0.2" stroke="white" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 20v-4M18 20v-4" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  jet_setter:      `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="12" cy="12" r="9" stroke="white" stroke-width="1.8"/><path d="M12 3c-2.5 3-4 6-4 9s1.5 6 4 9M12 3c2.5 3 4 6 4 9s-1.5 6-4 9M3 12h18M4.5 7.5h15M4.5 16.5h15" stroke="white" stroke-width="1.3"/></svg>`,
  // Brand loyalty
  amex_loyalist:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="2" y="6" width="20" height="13" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M2 10h20" stroke="white" stroke-width="1.8"/><path d="M6 14h4M15 14h3" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  chase_loyalist:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="2" y="6" width="20" height="13" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M2 10h20" stroke="white" stroke-width="1.8"/><path d="M6 14h4M15 14h3" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  cap1_loyalist:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="2" y="6" width="20" height="13" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M2 10h20" stroke="white" stroke-width="1.8"/><path d="M6 14h4M15 14h3" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  citi_loyalist:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="2" y="6" width="20" height="13" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M2 10h20" stroke="white" stroke-width="1.8"/><path d="M6 14h4M15 14h3" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  wf_loyalist:     `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="2" y="6" width="20" height="13" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M2 10h20" stroke="white" stroke-width="1.8"/><path d="M6 14h4M15 14h3" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  multi_bank:      `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M3 9l9-6 9 6v2H3V9z" fill="white" fill-opacity="0.8" stroke="white" stroke-width="0.5"/><rect x="5" y="11" width="3" height="7" fill="white" fill-opacity="0.7"/><rect x="10.5" y="11" width="3" height="7" fill="white" fill-opacity="0.7"/><rect x="16" y="11" width="3" height="7" fill="white" fill-opacity="0.7"/><path d="M2 20h20" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  amex_trifecta:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="2" y="13" width="10" height="7" rx="1.5" fill="white" fill-opacity="0.5"/><rect x="6" y="9" width="10" height="7" rx="1.5" fill="white" fill-opacity="0.7"/><rect x="10" y="5" width="10" height="7" rx="1.5" fill="white"/></svg>`,
  chase_trifecta:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="2" y="13" width="10" height="7" rx="1.5" fill="white" fill-opacity="0.5"/><rect x="6" y="9" width="10" height="7" rx="1.5" fill="white" fill-opacity="0.7"/><rect x="10" y="5" width="10" height="7" rx="1.5" fill="white"/></svg>`,
  // Card-specific tracking
  hilton_devotee:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="3" y="4" width="18" height="17" rx="1.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M3 9h18" stroke="white" stroke-width="1.8"/><path d="M8 14h2M14 14h2M8 17h2M14 17h2" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M10 21v-4h4v4" stroke="white" stroke-width="1.8"/></svg>`,
  marriott_fan:    `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="3" y="4" width="18" height="17" rx="1.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M3 9h18" stroke="white" stroke-width="1.8"/><path d="M8 14h2M14 14h2M8 17h2M14 17h2" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M10 21v-4h4v4" stroke="white" stroke-width="1.8"/></svg>`,
  hyatt_explorer:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="3" y="4" width="18" height="17" rx="1.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M3 9h18" stroke="white" stroke-width="1.8"/><path d="M8 14h2M14 14h2M8 17h2M14 17h2" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M10 21v-4h4v4" stroke="white" stroke-width="1.8"/></svg>`,
  hotel_portfolio: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="2" y="13" width="10" height="8" rx="1.5" stroke="white" stroke-width="1.5" fill="white" fill-opacity="0.2"/><rect x="5" y="9" width="10" height="8" rx="1.5" stroke="white" stroke-width="1.5" fill="white" fill-opacity="0.15"/><rect x="8" y="5" width="14" height="8" rx="1.5" stroke="white" stroke-width="1.5" fill="white" fill-opacity="0.1"/></svg>`,
  csp_holder:      `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="2" y="6" width="20" height="13" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M2 10h20" stroke="white" stroke-width="1.8"/><circle cx="7" cy="14.5" r="2" fill="white" fill-opacity="0.7"/><path d="M13 14h5" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  green_carrier:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M12 3c-4 4-6 8-4 12 2-2 2-5 2-5 3 3 2 7 2 7s4-3 4-7c0-2.5-2-5-4-7z" fill="white" fill-opacity="0.9"/><path d="M12 21v-9" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  venture_x_holder:`<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="2" y="6" width="20" height="13" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M2 10h20" stroke="white" stroke-width="1.8"/><path d="M6 14l3 3 3-3 3 3" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  united_flyer:    `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M21 16v-2l-8-5V4a1 1 0 0 0-2 0v5l-8 5v2l8-2.5V18l-2 1.5V21l3-1 3 1v-1.5l-2-1.5v-4.5l8 2.5z" fill="white"/></svg>`,
  strata_holder:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="2" y="6" width="20" height="13" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M2 10h20" stroke="white" stroke-width="1.8"/><path d="M6 15h5M6 17.5h3" stroke="white" stroke-width="1.6" stroke-linecap="round"/><path d="M18 13l-3 5M15 13l3 5" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  // Specific benefits
  saks_shopper:    `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M6 8h12l1.5 10H4.5L6 8z" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M9 8V6.5A3 3 0 0 1 15 6.5V8" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M9 13h6" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  lulu_fan:        `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M12 3C8 7 6 11 8 14c1-2 1-4 1-4 2 3 2 6 3 7s2-4 2-7c0 0 0 2 1 4 2-3 0-7-3-11z" fill="white" fill-opacity="0.9"/></svg>`,
  oura_owner:      `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="12" cy="12" r="7" stroke="white" stroke-width="2.2"/><circle cx="12" cy="12" r="3.5" fill="white" fill-opacity="0.3"/><circle cx="12" cy="12" r="1.5" fill="white"/></svg>`,
  uber_one_club:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M12 2L3 7v5c0 4.5 4 8.5 9 10 5-1.5 9-5.5 9-10V7l-9-5z" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M8 12a4 4 0 0 0 8 0" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M12 8v4" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  equinox_devotee: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M6 16c0 0 2-6 6-6s6 6 6 6" stroke="white" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="7" r="2.5" stroke="white" stroke-width="1.8"/><path d="M4 19h16" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  resy_regular:    `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M3 10h18" stroke="white" stroke-width="1.8"/><path d="M8 3v4M16 3v4" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M8 15h3M8 18h5" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  dec_bonus:       `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M20 12a8 8 0 0 1-8 8m0 0a8 8 0 0 1-8-8m16 0a8 8 0 0 0-8-8m0 0a8 8 0 0 0-8 8m16 0H4" stroke="white" stroke-width="1.8"/><path d="M12 4v8l4 2" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  digital_devotee: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="2" y="4" width="20" height="13" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M8 21h8M12 17v4" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M9.5 11l5-3v6l-5-3z" fill="white"/></svg>`,
  dunkin_addict:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M6 8h12l-1 11H7L6 8z" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M9.5 12c0 0 1 1.5 2.5 0s2.5 0 2.5 0" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  walmart_weekly:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M6 3h12l1 14H5L6 3z" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M9 3V2M15 3V2" stroke="white" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="20" r="1.5" fill="white"/><circle cx="15" cy="20" r="1.5" fill="white"/><path d="M9 11h6M9 14h4" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  peloton_rider:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="5.5" cy="15.5" r="3.5" stroke="white" stroke-width="1.8"/><circle cx="18.5" cy="15.5" r="3.5" stroke="white" stroke-width="1.8"/><path d="M18.5 12l-5-7-4 4 3 3" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 12h4" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  uber_vip:        `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M5 11l2-5h10l2 5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="11" width="18" height="6" rx="1.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><circle cx="7.5" cy="19.5" r="1.5" fill="white"/><circle cx="16.5" cy="19.5" r="1.5" fill="white"/><path d="M12 5l.6 1.5h1.6l-1.3 1 .5 1.5L12 8l-1.4 1 .5-1.5-1.3-1h1.6z" fill="white" fill-opacity="0.9"/></svg>`,
  doordash_pro:    `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M6 8h12l1.5 10H4.5L6 8z" stroke="white" stroke-width="1.8" stroke-linejoin="round" fill="white" fill-opacity="0.15"/><path d="M9 8V6a3 3 0 0 1 6 0v2" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M9 13l1.5 1.5L14 11" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  // Wellness
  wellness_stack:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M12 21C12 21 4 16 4 10a4 4 0 0 1 8 0 4 4 0 0 1 8 0c0 6-8 11-8 11z" fill="white" fill-opacity="0.2" stroke="white" stroke-width="1.8"/><path d="M2 12h4l3-6 4 12 3-6h6" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  full_wellness:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M12 21C12 21 4 16 4 10a4 4 0 0 1 8 0 4 4 0 0 1 8 0c0 6-8 11-8 11z" fill="white" fill-opacity="0.7" stroke="white" stroke-width="1.8"/></svg>`,
  // Travel
  clear_and_ge:    `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M12 3L4 7v5c0 4.5 3.5 8.7 8 10 4.5-1.3 8-5.5 8-10V7L12 3z" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.12"/><path d="M9 12l2 2 4-4" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  airport_royalty: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M21 16v-2l-8-5V4a1 1 0 0 0-2 0v5l-8 5v2l8-2.5V18l-2 1.5V21l3-1 3 1v-1.5l-2-1.5v-4.5l8 2.5z" fill="white"/><path d="M4 21h16" stroke="white" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  airline_insider: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M21 16v-2l-8-5V4a1 1 0 0 0-2 0v5l-8 5v2l8-2.5V18l-2 1.5V21l3-1 3 1v-1.5l-2-1.5v-4.5l8 2.5z" fill="white"/></svg>`,
  hotel_connoisseur:`<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="3" y="4" width="18" height="17" rx="1.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M3 9h18" stroke="white" stroke-width="1.8"/><path d="M8 14h2M14 14h2M8 17h2M14 17h2" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M10 21v-4h4v4" stroke="white" stroke-width="1.8"/></svg>`,
  first_class_combo:`<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M3 17h18M5 17V9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M8 11h8M8 14h5" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  lounge_regular:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M4 12V9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M2 12h20v4H2v-4z" fill="white" fill-opacity="0.2" stroke="white" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 20v-4M18 20v-4" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M10 7V5M14 7V5" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  saks_both:       `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M6 8h12l1.5 10H4.5L6 8z" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M9 8V6.5A3 3 0 0 1 15 6.5V8" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M9.5 14.5L11 16l3.5-3.5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  // Combos
  food_combo:      `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M8 3v7a3 3 0 0 0 3 3v8" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M8 3c0 0 2.5 1.5 2.5 3.5S8 10 8 10" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M16 3v18" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  commuter_pack:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M5 11l2-5h10l2 5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="11" width="18" height="6" rx="1.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><circle cx="7.5" cy="19.5" r="1.5" fill="white"/><circle cx="16.5" cy="19.5" r="1.5" fill="white"/></svg>`,
  dining_trifecta: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M8 3v7a3 3 0 0 0 3 3v8" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M16 3v18" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M8 3c0 0 2.5 1.5 2.5 3.5S8 10 8 10" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M12 8.5l4-5.5" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  entertainment_bundle:`<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="2" y="4" width="14" height="10" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M7 9.5l4-2.5v5L7 9.5z" fill="white"/><path d="M18 10c1 1 1 3 0 4M20 8c2 2 2 6 0 8" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  // Dollar milestones
  silver_bullet:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M8 7l4-4 4 4-4 10z" fill="white"/><path d="M5 7l3-4M19 7l-3-4M5 7h14" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  gold_mine:       `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M12 3l2.4 7.3H22l-6.2 4.5 2.4 7.2L12 17l-6.2 4 2.4-7.2L2 10.3h7.6z" fill="white" stroke="white" stroke-width="0.5" stroke-linejoin="round"/></svg>`,
  platinum_tier:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M3 9l9-6 9 6v2H3V9z" fill="white" fill-opacity="0.8"/><rect x="5" y="11" width="3" height="8" fill="white" fill-opacity="0.7"/><rect x="10.5" y="11" width="3" height="8" fill="white" fill-opacity="0.7"/><rect x="16" y="11" width="3" height="8" fill="white" fill-opacity="0.7"/><path d="M2 21h20" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  // Volume
  claim_addict:    `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M13 3L6 14h6l-1 7 7-11h-6l1-7z" fill="white" stroke="white" stroke-width="0.5" stroke-linejoin="round"/></svg>`,
  claim_machine:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M13 3L6 14h6l-1 7 7-11h-6l1-7z" fill="white" stroke="white" stroke-width="0.5" stroke-linejoin="round"/></svg>`,
  // Misc
  new_year_start:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M3 10h18M8 3v4M16 3v4" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M12 14l.8 2.5H16l-2.6 1.9.9 2.6-2.3-1.7-2.3 1.7.9-2.6L8 16.5h3.2z" fill="white" stroke="white" stroke-width="0.5"/></svg>`,
  // Meta progression — rosette-style
  badge_20:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="12" cy="12" r="6" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.15"/><path d="M12 6V4M12 20v-2M6 12H4M20 12h-2M7.8 7.8L6.4 6.4M17.6 17.6l-1.4-1.4M7.8 16.2l-1.4 1.4M17.6 6.4l-1.4 1.4" stroke="white" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="2.5" fill="white"/></svg>`,
  badge_35:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="12" cy="12" r="6" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.15"/><path d="M12 6V4M12 20v-2M6 12H4M20 12h-2M7.8 7.8L6.4 6.4M17.6 17.6l-1.4-1.4M7.8 16.2l-1.4 1.4M17.6 6.4l-1.4 1.4" stroke="white" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="2.5" fill="white"/></svg>`,
  badge_50:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="12" cy="12" r="6" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.15"/><path d="M12 6V4M12 20v-2M6 12H4M20 12h-2M7.8 7.8L6.4 6.4M17.6 17.6l-1.4-1.4M7.8 16.2l-1.4 1.4M17.6 6.4l-1.4 1.4" stroke="white" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="2.5" fill="white"/></svg>`,
  badge_75:  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="12" cy="12" r="6" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.15"/><path d="M12 6V4M12 20v-2M6 12H4M20 12h-2M7.8 7.8L6.4 6.4M17.6 17.6l-1.4-1.4M7.8 16.2l-1.4 1.4M17.6 6.4l-1.4 1.4" stroke="white" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="2.5" fill="white"/></svg>`,
  badge_100: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="12" cy="12" r="6" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.15"/><path d="M12 6V4M12 20v-2M6 12H4M20 12h-2M7.8 7.8L6.4 6.4M17.6 17.6l-1.4-1.4M7.8 16.2l-1.4 1.4M17.6 6.4l-1.4 1.4" stroke="white" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="2.5" fill="white"/></svg>`,
  // Year badges — calendar
  yr_2024:      `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M3 10h18M8 3v4M16 3v4" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M7 15h2M11 15h2M15 15h2M7 18h2M11 18h2" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  yr_2025:      `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M3 10h18M8 3v4M16 3v4" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M7 15h2M11 15h2M15 15h2M7 18h2M11 18h2" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  yr_2026:      `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M3 10h18M8 3v4M16 3v4" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M7 15h2M11 15h2M15 15h2M7 18h2M11 18h2" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  multi_year:   `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M3 10h18M8 3v4M16 3v4" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M12 13l1 2.5L16 16l-2.5 2 .8 3L12 19.5l-2.3 1.5.8-3L8 16l3-.5z" fill="white" stroke="white" stroke-width="0.5"/></svg>`,
  early_adopter:`<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="12" cy="12" r="9" stroke="white" stroke-width="1.8"/><path d="M12 8v5l3 3" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  // Legendary
  founder:  `<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><path d="M2 19h20M4 19L2 8l5 5 5-9 5 9 5-5-2 11H4z" fill="white" fill-opacity="0.25" stroke="white" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  hacker:   `<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><rect x="2" y="3" width="20" height="14" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M8 9l3 3-3 3M13 15h3" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 21h20" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  obsessive:`<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><path d="M12 5c-5.5 0-9 7-9 7s3.5 7 9 7 9-7 9-7-3.5-7-9-7z" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.12"/><circle cx="12" cy="12" r="3.5" fill="white"/></svg>`,
  // CSR-specific
  stubhub_fan:      `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="M9 18V5l12-2v13" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" stroke="white" stroke-width="1.8"/><circle cx="18" cy="16" r="3" stroke="white" stroke-width="1.8"/></svg>`,
  csr_traveler:     `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6.12 6.12l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  exclusive_tables: `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="M3 11l19-9-9 19-2-8-8-2z" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="white" fill-opacity="0.12"/></svg>`,
  apple_insider:    `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><rect x="5" y="2" width="14" height="20" rx="3" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M9 7h6M12 17v-6M9 14l3 3 3-3" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  the_edit_guest:   `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="M3 21h18M5 21V7l7-4 7 4v14" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 21v-4h6v4" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  lyft_rider:       `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3m-2 9H9m8 0h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-3l-2-3H9" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7.5" cy="17.5" r="2.5" stroke="white" stroke-width="1.8"/><circle cx="17.5" cy="17.5" r="2.5" stroke="white" stroke-width="1.8"/></svg>`,
  csr_month_sweep:  `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="M5 13l4 4L19 7" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 7l4 4" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.5"/><path d="M5 19h14" stroke="white" stroke-width="1.6" stroke-linecap="round" opacity="0.4"/></svg>`,
  stub_season:      `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.08"/><path d="M16 2v4M8 2v4M3 10h18" stroke="white" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16" r="2" fill="white"/></svg>`,
  // Gold-specific
  gold_sweep:       `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="M12 2l3 7h7l-6 4.5 2 7.5L12 17l-6 4 2-7.5L2 9h7z" stroke="white" stroke-width="1.8" stroke-linejoin="round" fill="white" fill-opacity="0.12"/></svg>`,
  dunkin_power:     `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="M17 8h1a4 4 0 0 1 0 8h-1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="white" fill-opacity="0.1"/><path d="M6 2v2M10 2v2M14 2v2" stroke="white" stroke-width="1.6" stroke-linecap="round" opacity="0.5"/></svg>`,
  // Platinum-specific
  plat_trifecta_month:`<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="white" fill-opacity="0.1"/></svg>`,
  hotel_twice:      `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="M3 21V7l9-4 9 4v14" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 21v-5h6v5M9 12h6" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  plat_mega:        `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M12 2l2.5 7.5H22l-6.5 4.5 2.5 7.5L12 17l-6 4.5 2.5-7.5L3 9.5h7.5z" fill="white" fill-opacity="0.2" stroke="white" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  // WF Premier-specific
  wf_airline_user:  `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="white" fill-opacity="0.15" stroke="white" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  wf_ge_user:       `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><rect x="3" y="4" width="18" height="16" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.08"/><circle cx="9" cy="10" r="2.5" stroke="white" stroke-width="1.6"/><path d="M5 18c0-2.2 1.8-4 4-4s4 1.8 4 4M14 9h4M14 13h3" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  // Cross-card combos
  chase_amex_duo:   `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><rect x="2" y="5" width="9" height="14" rx="1.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><rect x="13" y="5" width="9" height="14" rx="1.5" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M11 12h2" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  double_airline:   `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="M5 17.5l14-6M5 12l14-3" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M17 4l3 3-12 5-2-3z" fill="white" fill-opacity="0.2" stroke="white" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  both_resy:        `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="M3 3h8v13H3zM13 3h8v13h-8z" stroke="white" stroke-width="1.8" rx="1" fill="white" fill-opacity="0.08"/><path d="M5 21h14" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  uber_double_month:`<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><rect x="2" y="7" width="8" height="10" rx="2" stroke="white" stroke-width="1.6" fill="white" fill-opacity="0.08"/><rect x="14" y="7" width="8" height="10" rx="2" stroke="white" stroke-width="1.6" fill="white" fill-opacity="0.08"/><path d="M10 12h4" stroke="white" stroke-width="1.8" stroke-linecap="round"/><circle cx="4" cy="17" r="1.5" fill="white"/><circle cx="16" cy="17" r="1.5" fill="white"/></svg>`,
  four_kings:       `<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M3 7l3 9h12l3-9-5 3-4-6-4 6-5-3z" fill="white" fill-opacity="0.2" stroke="white" stroke-width="1.8" stroke-linejoin="round"/><path d="M5 21h14" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M5 19v-3h14v3" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

function renderBadgesView(){
  const earned=new Set(getEarnedBadges());
  const earnedAt=getEarnedAt();
  markAllSeen();
  const defs=getApplicableBadgeDefs();
  const total=defs.length;
  const earnedCount=[...earned].filter(id=>defs.some(d=>d.id===id)).length;
  const pct=total>0?Math.round(earnedCount/total*100):0;

  // Short display names for compact grid
  const SHORT={
    multi_year:'Veteran', multi_bank:'Multi-Bank', hotel_connoisseur:'Connoisseur',
    hotel_portfolio:'Hotel Stack', entertainment_bundle:'Ent. Bundle',
    dining_trifecta:'Triple Stack', global_traveler:'Globetrotter',
    wf_loyalist:'WF Card', badge_100:'Complete', new_year_start:'New Year',
    digital_devotee:'Digital', first_class_combo:'First Class',
    plat_trifecta_month:'Plat Triple', csr_month_sweep:'CSR Sweep',
    uber_double_month:'Uber Double', chase_amex_duo:'Chase×Amex',
    wellness_stack:'Wellness', full_wellness:'Wellness Max',
    double_airline:'Dual Runway', airport_royalty:'Air Royalty',
    airline_insider:'Airline Pro', lounge_regular:'Lounge Pro',
    plat_mega:'Plat Legend', early_adopter:'Early Bird',
    both_resy:'Resy Duo', dec_bonus:'Dec Bonus',
  };
  const dName=d=>SHORT[d.id]||d.name;
  function fmtDate(ts){if(!ts)return'';return new Date(ts).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
  function fmtDateShort(ts){if(!ts)return'';return new Date(ts).toLocaleDateString('en-US',{month:'short',day:'numeric'});}

  const CHAINS=[
    {id:'streak',   label:'Claim Streak',  milestones:[{id:'streak_3',lbl:'3 mo'},{id:'streak_6',lbl:'6 mo'},{id:'streak_12',lbl:'12 mo'},{id:'streak_18',lbl:'18 mo'},{id:'streak_24',lbl:'24 mo'}]},
    {id:'value',    label:'Value Captured', milestones:[{id:'getting_started',lbl:'$100'},{id:'gaining_ground',lbl:'$500'},{id:'high_achiever',lbl:'$1K'},{id:'power_user',lbl:'$2.5K'},{id:'maximizer',lbl:'$5K'},{id:'true_maximizer',lbl:'$10K'}]},
    {id:'fees',     label:'Fee Recovery',   milestones:[{id:'first_profit',lbl:'1 card'},{id:'double_dipper',lbl:'2 cards'},{id:'triple_threat',lbl:'3 cards'},{id:'fee_crusher',lbl:'all cards'}]},
    {id:'portfolio',label:'Portfolio',       milestones:[{id:'collector',lbl:'3'},{id:'portfolio_pro',lbl:'5'},{id:'card_shark',lbl:'7'},{id:'whale',lbl:'10'}]},
    {id:'volume',   label:'Claims',          milestones:[{id:'benefit_ninja',lbl:'25'},{id:'benefit_machine',lbl:'50'},{id:'century',lbl:'100'},{id:'claim_addict',lbl:'150'},{id:'claim_machine',lbl:'300'}]},
    {id:'meta',     label:'Decorated',       milestones:[{id:'badge_20',lbl:'20'},{id:'badge_35',lbl:'35'},{id:'badge_50',lbl:'50'},{id:'badge_75',lbl:'75'},{id:'badge_100',lbl:'100'}]},
  ];
  const chainIds=new Set(CHAINS.flatMap(c=>c.milestones.map(m=>m.id)));

  function tGrad(t){return{bronze:'radial-gradient(circle at 38% 28%,#D07848,#8A3A14)',silver:'radial-gradient(circle at 38% 28%,#7A9CB8,#355070)',gold:'radial-gradient(circle at 38% 28%,#F0B430,#A86010)',platinum:'radial-gradient(circle at 38% 28%,#4898D8,#165090)',legendary:'radial-gradient(circle at 38% 28%,#C050E8,#5010A8)'}[t]||'radial-gradient(circle at 38% 28%,#444,#1C1C1C)';}
  function tColor(t){return TIER_COLORS[t]||'#888';}
  function tLabel(t){return{bronze:'Bronze',silver:'Silver',gold:'Gold',platinum:'Platinum',legendary:'Legendary'}[t]||t;}

  const lockSVG=`<svg viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="5" y="10" width="14" height="11" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`;

  function gem(def,isE,sz,idx=0){
    const hidden=def.hidden&&!isE;
    const icon=hidden?lockSVG:(BADGE_ICONS[def.id]||'');
    const tc=isE?`t-${def.tier}`:'t-locked';
    const st=isE?`background:${tGrad(def.tier)};--sd:${((idx*0.41)%4).toFixed(2)}s`:'';
    return `<div class="badge-gem ${sz} ${tc}" style="${st}">${icon}</div>`;
  }

  // Featured: highest-tier earned badge
  const tierOrder=['legendary','platinum','gold','silver','bronze'];
  let featuredDef=null;
  for(const t of tierOrder){featuredDef=defs.find(d=>earned.has(d.id)&&d.tier===t);if(featuredDef)break;}

  // Recently unlocked: last 5 by earnedAt timestamp
  const recent=defs
    .filter(d=>earned.has(d.id)&&earnedAt[d.id])
    .sort((a,b)=>(earnedAt[b.id]||0)-(earnedAt[a.id]||0))
    .slice(0,5);

  // Legendary badges — always shown separately
  const legendaryDefs=defs.filter(d=>d.tier==='legendary');

  // Collection: non-chain, non-legendary
  const tierRank={legendary:0,platinum:1,gold:2,silver:3,bronze:4};
  const collDefs=defs
    .filter(d=>!chainIds.has(d.id)&&d.tier!=='legendary')
    .sort((a,b)=>{
      const ae=earned.has(a.id)?0:1,be=earned.has(b.id)?0:1;
      if(ae!==be)return ae-be;
      return(tierRank[a.tier]??5)-(tierRank[b.tier]??5);
    });
  const collEarned=collDefs.filter(d=>earned.has(d.id));
  const collLocked=collDefs.filter(d=>!earned.has(d.id));

  let html='';

  // Header + progress
  html+=`<div class="ach-header">
    <span class="ach-header-title">Achievements</span>
    <span class="ach-header-count">${earnedCount}&thinsp;/&thinsp;${total}</span>
  </div>
  <div class="ach-progress-bar"><div class="ach-progress-fill" style="width:${pct}%"></div></div>`;

  // Featured
  if(featuredDef){
    const c=tColor(featuredDef.tier);
    const ed=fmtDate(earnedAt[featuredDef.id]);
    const isLeg=featuredDef.tier==='legendary';
    html+=`<div class="ach-featured${isLeg?' featured-legendary':''}" style="border-color:${c}26" onclick="window.showBadgeDetail('${featuredDef.id}')">
      ${gem(featuredDef,true,'badge-gem-lg',0)}
      <div class="ach-featured-info">
        <div class="ach-featured-tier" style="color:${c}">${tLabel(featuredDef.tier)}</div>
        <div class="ach-featured-name">${featuredDef.name}</div>
        <div class="ach-featured-desc">${featuredDef.desc}</div>
        ${ed?`<div class="ach-featured-date">Earned ${ed}</div>`:''}
      </div>
    </div>`;
  }

  // Recently Unlocked
  if(recent.length){
    html+=`<div class="ach-section-label">Recently Unlocked</div>
    <div class="ach-recent-strip">`;
    recent.forEach((def,i)=>{
      html+=`<div class="ach-recent-badge" onclick="window.showBadgeDetail('${def.id}')">
        ${gem(def,true,'badge-gem-md',i)}
        <div class="ach-recent-name">${dName(def)}</div>
        <div class="ach-recent-date">${fmtDateShort(earnedAt[def.id])}</div>
      </div>`;
    });
    html+=`</div>`;
  }

  // Progression chains
  html+=`<div class="ach-section-label">Progression</div>`;
  CHAINS.forEach(chain=>{
    const app=chain.milestones.filter(m=>defs.some(d=>d.id===m.id));
    if(!app.length)return;
    const en=app.filter(m=>earned.has(m.id)).length;
    html+=`<div class="prog-chain">
      <div class="prog-chain-header">
        <span class="prog-chain-name">${chain.label}</span>
        <span class="prog-chain-progress">${en}/${app.length}</span>
      </div>
      <div class="prog-chain-row">`;
    app.forEach((m,i)=>{
      const def=defs.find(d=>d.id===m.id);if(!def)return;
      const isE=earned.has(def.id);
      const prevE=i===0||earned.has(app[i-1]?.id);
      const isNext=!isE&&prevE;
      html+=`<div class="prog-milestone${isE?' pm-earned':''}${isNext?' pm-next':''}" onclick="window.showBadgeDetail('${def.id}')">
        ${gem(def,isE,'badge-gem-sm',i)}
        <div class="prog-milestone-label">${m.lbl}</div>
        ${isNext?`<div class="prog-next-pip"></div>`:''}
      </div>`;
      if(i<app.length-1){
        const nxtE=earned.has(app[i+1]?.id);
        const cls=isE&&nxtE?'c-earned':isE?'c-partial':'';
        html+=`<div class="prog-connector${cls?' '+cls:''}"></div>`;
      }
    });
    html+=`</div></div>`;
  });

  // Legendary — trophy case
  if(legendaryDefs.length){
    html+=`<div class="ach-section-label">Legendary</div>
    <div class="ach-legendary-grid">`;
    legendaryDefs.forEach((def,i)=>{
      const isE=earned.has(def.id);
      const hidden=def.hidden&&!isE;
      html+=`<div class="ach-legendary-item${isE?'':' lg-locked'}" onclick="window.showBadgeDetail('${def.id}')">
        ${gem(def,isE,'badge-gem-md',i)}
        <div class="ach-legendary-name">${hidden?'???':def.name}</div>
      </div>`;
    });
    html+=`</div>`;
  }

  // Collection
  if(collDefs.length){
    html+=`<div class="ach-section-label">Collection <span style="font-size:8px;letter-spacing:0.06em;opacity:0.55">${collEarned.length}/${collDefs.length}</span></div>`;
    if(collEarned.length){
      html+=`<div class="ach-compact-grid">`;
      collEarned.forEach((def,i)=>{
        html+=`<div class="compact-badge cb-earned" onclick="window.showBadgeDetail('${def.id}')">
          ${gem(def,true,'badge-gem-xs',i)}
          <div class="compact-badge-name">${dName(def)}</div>
        </div>`;
      });
      html+=`</div>`;
    }
    if(collLocked.length){
      html+=`<div class="ach-locked-toggle" onclick="window.toggleAchLocked(this)">
        <span>Locked · ${collLocked.length}</span>
        <span class="ach-locked-chevron">▾</span>
      </div>
      <div class="ach-compact-grid" id="achLockedGrid" style="display:none">`;
      collLocked.forEach((def,i)=>{
        html+=`<div class="compact-badge" onclick="window.showBadgeDetail('${def.id}')">
          ${gem(def,false,'badge-gem-xs',i)}
          <div class="compact-badge-name">${def.hidden?'???':dName(def)}</div>
        </div>`;
      });
      html+=`</div>`;
    }
  }

  html+=`<div style="height:16px"></div>`;
  document.getElementById('main').innerHTML=html;
}

window.showBadgeDetail=function(id){
  const earned=new Set(getEarnedBadges());
  const earnedAt=getEarnedAt();
  const defs=getApplicableBadgeDefs();
  const def=defs.find(d=>d.id===id);
  if(!def)return;
  const isE=earned.has(id);
  const isHidden=def.hidden&&!isE;
  const color=TIER_COLORS[def.tier]||'#888';
  const displayName=isHidden?'???':def.name;
  const displayDesc=isHidden?'Unlock to reveal this hidden achievement':def.desc;
  const earnedDate=isE&&earnedAt[id]?new Date(earnedAt[id]).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):'';

  function tGrad2(tier){return{bronze:'radial-gradient(circle at 38% 28%,#D07848,#8A3A14)',silver:'radial-gradient(circle at 38% 28%,#7A9CB8,#355070)',gold:'radial-gradient(circle at 38% 28%,#F0B430,#A86010)',platinum:'radial-gradient(circle at 38% 28%,#4898D8,#165090)',legendary:'radial-gradient(circle at 38% 28%,#C050E8,#5010A8)'}[tier]||'radial-gradient(circle at 38% 28%,#444,#1C1C1C)';}
  const lockIcon=`<svg viewBox="0 0 24 24" width="36" height="36" fill="none"><rect x="5" y="10" width="14" height="11" rx="2" stroke="white" stroke-width="1.8" fill="white" fill-opacity="0.1"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  const icon=isHidden?lockIcon:(BADGE_ICONS[id]||'');
  const tierCls=isE?`t-${def.tier}`:'t-locked';
  const bgStyle=isE?`background:${tGrad2(def.tier)};--sd:0.15s`:'';
  const tierLabel={bronze:'Bronze',silver:'Silver',gold:'Gold',platinum:'Platinum',legendary:'Legendary'}[def.tier]||def.tier;

  const existing=document.getElementById('badgeDetailOverlay');
  if(existing)existing.remove();
  const overlay=document.createElement('div');
  overlay.id='badgeDetailOverlay';
  overlay.className='badge-detail-overlay';
  overlay.innerHTML=`<div class="badge-detail-sheet">
    <div class="badge-detail-handle"></div>
    <div class="badge-gem badge-gem-lg ${tierCls}" style="${bgStyle}">${icon}</div>
    <div class="badge-detail-tier" style="color:${color}">${tierLabel}</div>
    <div class="badge-detail-name">${displayName}</div>
    <div class="badge-detail-desc">${displayDesc}</div>
    <div class="badge-detail-meta${isE?' dm-earned':''}">${isE?'✓ Earned':'Locked'}${earnedDate?` · ${earnedDate}`:''}</div>
  </div>`;
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  document.body.appendChild(overlay);
};

window.toggleAchLocked=function(el){
  const grid=document.getElementById('achLockedGrid');
  const chevron=el.querySelector('.ach-locked-chevron');
  if(!grid)return;
  const open=grid.style.display!=='none';
  grid.style.display=open?'none':'grid';
  if(chevron)chevron.textContent=open?'▾':'▴';
};

// ── Heatmap month detail sheet ────────────────────────────────────────────
function _buildHeatmapDetailHTML(cardKey,month){
  const data=window._heatmapMonthDetails&&window._heatmapMonthDetails[`${cardKey}_${month}`];
  if(!data) return '';
  const {cardLabel,monthLabel,items,totalClaimed,totalAvailable}=data;
  const claimed=items.filter(i=>i.claimed);
  const unclaimed=items.filter(i=>!i.claimed);
  const claimedRows=claimed.length ? claimed.map(i=>{
    const rdKey=`${cardKey}__${i.id}__${i.pk}`;
    const rd=state.redemptionDates[rdKey];
    const dateLabel=rd?MONTHS[rd.month]:'Set date';
    const dateColor=rd?'var(--text-tertiary)':'var(--blue)';
    return `<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;color:var(--text)">${escapeHtml(i.name)}</span>
        <span style="font-size:13px;font-family:var(--mono);color:var(--green)">+$${i.amount.toFixed(0)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
        <span style="font-size:10px;color:var(--text-tertiary);font-family:var(--mono)">Redeemed:</span>
        <button id="rdDate_${cardKey}_${i.id}" onclick="toggleHeatmapDatePicker('${cardKey}','${escapeHtml(i.id)}','${escapeHtml(i.pk)}')" style="background:none;border:none;cursor:pointer;font-size:10px;font-family:var(--mono);color:${dateColor};padding:0;text-decoration:underline;text-underline-offset:2px">${dateLabel}</button>
      </div>
      <div id="rdPicker_${cardKey}_${i.id}" style="display:none;flex-wrap:wrap;gap:4px;margin-top:6px">
        ${MONTHS.map((m,idx)=>`<button onclick="setHeatmapRedemptionDate('${cardKey}','${escapeHtml(i.id)}','${escapeHtml(i.pk)}',${CY},${idx})" style="background:${rd&&rd.month===idx?'var(--blue)':'var(--surface)'};border:1px solid var(--border);border-radius:4px;color:${rd&&rd.month===idx?'#fff':'var(--text)'};font-size:10px;font-family:var(--mono);padding:3px 6px;cursor:pointer">${m}</button>`).join('')}
      </div>
    </div>`;
  }).join('')
  : `<div style="font-size:12px;color:var(--text-tertiary);padding:8px 0">Nothing redeemed this month</div>`;
  const unclaimedRows=unclaimed.length
    ? `<div style="margin-top:12px"><div style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Missed</div>${unclaimed.map(i=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04)"><span style="font-size:12px;color:var(--text-tertiary)">${escapeHtml(i.name)}</span><span style="font-size:12px;font-family:var(--mono);color:var(--red)">−$${i.amount.toFixed(0)}</span></div>`).join('')}</div>`
    : '';
  return `<div style="background:#111116;border:1px solid rgba(255,255,255,0.1);border-radius:20px 20px 0 0;padding:8px 24px 44px;width:100%;max-height:80vh;overflow-y:auto;animation:bdSlideUp 0.22s ease">
    <div style="width:36px;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;margin:8px auto 16px"></div>
    <div style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px">${escapeHtml(cardLabel)}</div>
    <div style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:16px">${monthLabel} Redeemed</div>
    <div style="font-size:10px;font-family:var(--mono);color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Redeemed</div>
    ${claimedRows}
    ${unclaimedRows}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1)">
      <span style="font-size:12px;font-family:var(--mono);color:var(--text-tertiary)">Total redeemed</span>
      <span style="font-size:16px;font-weight:700;font-family:var(--mono);color:${totalClaimed>0?'var(--green)':'var(--text-tertiary)'}">$${totalClaimed.toFixed(0)} <span style="font-size:11px;font-weight:400;color:var(--text-tertiary)">/ $${totalAvailable.toFixed(0)}</span></span>
    </div>
  </div>`;
}

window.showHeatmapMonthDetail=function(cardKey,month){
  const existing=document.getElementById('heatmapMonthOverlay');
  if(existing) existing.remove();
  const html=_buildHeatmapDetailHTML(cardKey,month);
  if(!html) return;
  const overlay=document.createElement('div');
  overlay.id='heatmapMonthOverlay';
  overlay.dataset.card=cardKey;
  overlay.dataset.month=month;
  overlay.style.cssText='position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.72);display:flex;align-items:flex-end;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);animation:bdFadeIn 0.15s ease';
  overlay.innerHTML=html;
  overlay.addEventListener('click',e=>{ if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

window.toggleHeatmapDatePicker=function(cardKey,id,pk){
  const picker=document.getElementById(`rdPicker_${cardKey}_${id}`);
  if(!picker) return;
  picker.style.display=picker.style.display==='none'?'flex':'none';
};

window.setHeatmapRedemptionDate=function(cardKey,id,pk,year,month){
  setRedemptionMonth(cardKey,id,pk,year,month);
  // close sheet and re-render heatmap — benefit has moved to a new month cell
  const overlay=document.getElementById('heatmapMonthOverlay');
  if(overlay) overlay.remove();
  render();
};

// ── More page ─────────────────────────────────────────────────────────────
function renderMore(){
  const items=[
    {view:'net-value',label:'Portfolio Value'},
    {view:'points-redemptions',label:'Points Redeemed'},
    {view:'card-simulator',label:'Card Simulator'},
    {view:'upgrade-advisor',label:'Upgrade Advisor'},
    {view:'ai-advisor',label:'AI Advisor'},
    {view:'wrap',label:'Report Card'},
    {view:'benefit-alerts',label:'Benefit Alerts'},
    {view:'renewal-calendar',label:'Renewal Calendar'},
    {view:'compare',label:'Compare Cards'},
    {view:'performance',label:'Performance'},
    {view:'heatmap',label:'Heatmap'},
    {view:'history-log',label:'History'},
    {view:'recap',label:'Annual Recap'},
    {view:'settings',label:'Settings'},
  ];
  let html='<div class="more-grid">';
  items.forEach(item=>{
    const icon=_DRAWER_ICONS[item.view]||'';
    html+=`<button class="more-pill" onclick="setActiveView('${item.view}')"><span class="more-pill-icon">${icon}</span><span>${item.label}</span></button>`;
  });
  html+='</div>';
  document.getElementById('main').innerHTML=html;
}

// ── Drawer icons + home button IIFE ──────────────────────────────────────
(function(){
  const title=document.querySelector('.app-title');
  if(title){ title.style.cursor='pointer'; title.addEventListener('click',()=>setActiveView('all-cards')); }

  const drawerIconMap=_DRAWER_ICONS;
  Object.entries(drawerIconMap).forEach(([primary,svg])=>{
    [`.drawer-item[data-primary="${primary}"]`].forEach(sel=>{
      const btn=document.querySelector(sel);
      if(!btn) return;
      const icon=btn.querySelector('.drawer-icon');
      if(icon) icon.innerHTML=svg;
    });
  });

  const menuBtn=document.getElementById('menuBtn');
  if(menuBtn) menuBtn.innerHTML=`<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><line x1="2" y1="4.5" x2="16" y2="4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="2" y1="9" x2="16" y2="9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="2" y1="13.5" x2="16" y2="13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

  const isDarkNow=document.documentElement.getAttribute('data-theme')==='dark';
  const darkIconEl=document.getElementById('darkIcon');
  if(darkIconEl) darkIconEl.innerHTML=isDarkNow
    ?`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="1" x2="8" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="8" y1="13" x2="8" y2="15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="8" x2="3" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="13" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="3.05" y1="3.05" x2="4.46" y2="4.46" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="11.54" y1="11.54" x2="12.95" y2="12.95" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="12.95" y1="3.05" x2="11.54" y2="4.46" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="4.46" y1="11.54" x2="3.05" y2="12.95" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`
    :`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const drawerTitle=document.querySelector('.drawer-title');
  if(drawerTitle){
    drawerTitle.innerHTML=`<img src="icon-192.png" style="width:24px;height:24px;border-radius:6px;vertical-align:middle;margin-right:8px;"> Perks Ledger`;
    drawerTitle.style.cursor='pointer';
    drawerTitle.addEventListener('click',()=>{ closeDrawer(); setActiveView('all-cards'); });
  }
  const signOutBtn=document.getElementById('signOutBtn');
  if(signOutBtn){
    signOutBtn.style.cssText='display:inline-flex;align-items:center;gap:6px;background:rgba(220,60,60,0.12);color:var(--red);border:1px solid rgba(220,60,60,0.25);border-radius:100px;padding:7px 16px;font-size:12px;font-family:var(--mono);cursor:pointer;width:auto';
    signOutBtn.innerHTML='<span style="font-size:13px">→</span> Sign Out';
  }
  const drawerBottom=document.querySelector('#navExtras > div:last-child');
  if(drawerBottom){
    const credit=document.createElement('div');
    credit.textContent='jhuey · 2026 · v2.0';
    credit.style.cssText='font-size:10px;font-family:var(--mono);color:var(--text-tertiary);margin-top:10px;padding:0 12px;opacity:0.4;user-select:none';
    drawerBottom.appendChild(credit);
    const deployLine=document.createElement('div');
    deployLine.textContent=`updated ${DEPLOY_DATE}`;
    deployLine.style.cssText='font-size:9px;font-family:var(--mono);color:var(--text-tertiary);margin-top:2px;padding:0 12px;opacity:0.3;user-select:none';
    drawerBottom.appendChild(deployLine);
  }
})();

// ── Snooze modal ──────────────────────────────────────────────────────────
function openSnoozeModal(cardKey, benefitId, benefitName){
  state._snoozeCtx={cardKey,benefitId};
  document.getElementById('snoozeModalTitle').textContent=benefitName;
  const isGE=benefitId.endsWith('_ge');
  document.getElementById('snoozeGEPreset').style.display=isGE?'':'none';
  const now=new Date();
  const curYYYYMM=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('snoozeFromInput').value=curYYYYMM;
  document.getElementById('snoozeMonthInput').value=curYYYYMM;
  document.getElementById('snoozeMonthInput').min=curYYYYMM;
  if(isGE){
    const yr4=now.getFullYear()+4;
    const m4=String(now.getMonth()+1).padStart(2,'0');
    document.getElementById('snooze4yrBtn').dataset.until=`${yr4}-${m4}`;
    document.getElementById('snooze4yrBtn').textContent=`⏸︎ Snooze 4 years — eligible again ${yr4}`;
  }
  document.getElementById('snoozeModal').classList.remove('hidden');
}
function closeSnoozeModal(){ document.getElementById('snoozeModal').classList.add('hidden'); state._snoozeCtx=null; }
function saveSnooze(){
  if(!state._snoozeCtx) return;
  const from=document.getElementById('snoozeFromInput').value;
  const until=document.getElementById('snoozeMonthInput').value;
  if(!until) return;
  setSnoozedBenefit(state._snoozeCtx.cardKey,state._snoozeCtx.benefitId,from||until,until);
  closeSnoozeModal();
  render();
}
document.getElementById('snoozeSave').addEventListener('click',saveSnooze);
document.getElementById('snoozeCancel').addEventListener('click',closeSnoozeModal);
document.getElementById('snoozeModal').addEventListener('click',e=>{ if(e.target===e.currentTarget) closeSnoozeModal(); });
document.getElementById('snooze4yrBtn').addEventListener('click',()=>{
  const until=document.getElementById('snooze4yrBtn').dataset.until;
  if(until){ document.getElementById('snoozeMonthInput').value=until; }
});

// ── Confetti ──────────────────────────────────────────────────────────────
const confettiCanvas=document.getElementById('confettiCanvas');
let _confettiRunning=false;
function launchConfetti(){
  if(/Mobi|Android/i.test(navigator.userAgent)) return;
  if(_confettiRunning) return;
  _confettiRunning=true;
  const ctx=confettiCanvas.getContext('2d');
  confettiCanvas.width=window.innerWidth;
  confettiCanvas.height=window.innerHeight;
  confettiCanvas.style.cssText='position:fixed;top:0;left:0;pointer-events:none;z-index:9999';
  const colors=['#4caf7d','#f0b429','#3b82f6','#e03030','#a78bfa','#fb923c'];
  const pieces=Array.from({length:120},()=>({
    x:Math.random()*confettiCanvas.width,
    y:Math.random()*-confettiCanvas.height-10,
    r:Math.random()*6+3,
    d:Math.random()*4+2,
    color:colors[Math.floor(Math.random()*colors.length)],
    tilt:Math.random()*10-5,
    tiltSpd:Math.random()*0.08-0.04,
    rot:Math.random()*360,
  }));
  let frame=0;
  function step(){
    if(frame++>220){ ctx.clearRect(0,0,confettiCanvas.width,confettiCanvas.height); _confettiRunning=false; return; }
    ctx.clearRect(0,0,confettiCanvas.width,confettiCanvas.height);
    pieces.forEach(p=>{
      p.y+=p.d; p.tilt+=p.tiltSpd; p.rot+=2;
      if(p.y>confettiCanvas.height){ p.y=-10; p.x=Math.random()*confettiCanvas.width; }
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot*Math.PI/180);
      ctx.fillStyle=p.color; ctx.globalAlpha=Math.max(0,(220-frame)/80);
      ctx.fillRect(-p.r/2,-p.r/2,p.r,p.r*1.6);
      ctx.restore();
    });
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
let _wasInProfit=false;
function checkProfitConfetti(){
  if(/Mobi|Android/i.test(navigator.userAgent)) return;
  try{
    const keys=getVisibleCardKeys();
    const anyProfit=keys.some(ck=>{
      const {captured}=calcStats(ck,c=>getCardYearPeriods(ck,c),isPCurrent);
      return getFee(ck,CY)-captured<=0;
    });
    if(anyProfit&&!_wasInProfit){ launchConfetti(); }
    _wasInProfit=anyProfit;
  }catch(e){}
}

// ── Home tab card carousel (desktop) ─────────────────────────────────────
let _carouselId=null,_carouselPaused=false;
function startCarousel(){
  const sel=document.getElementById('cardSelector');
  if(!sel||window.innerWidth<768) return;
  const max=sel.scrollWidth-sel.clientWidth;
  if(max<10) return;
  if(_carouselId) cancelAnimationFrame(_carouselId);
  function tick(){
    if(!_carouselPaused){
      sel.scrollLeft+=0.5;
      if(sel.scrollLeft>=max) sel.scrollLeft=0;
    }
    _carouselId=requestAnimationFrame(tick);
  }
  tick();
}
function stopCarousel(){ if(_carouselId){ cancelAnimationFrame(_carouselId); _carouselId=null; } }


initCardSelector();
window.addEventListener('resize',sizeCardSelector);
const _carouselSel=document.getElementById('cardSelector');
_carouselSel.addEventListener('mouseenter',()=>{ _carouselPaused=true; });
_carouselSel.addEventListener('mouseleave',()=>{ _carouselPaused=false; });
_carouselSel.addEventListener('touchstart',()=>{ stopCarousel(); },{passive:true});
// mouse drag scroll
let _mDragActive=false,_mDragX=0,_mDragSL=0;
_carouselSel.addEventListener('mousedown',e=>{ if(e.button!==0) return; _mDragActive=true; _mDragX=e.pageX; _mDragSL=_carouselSel.scrollLeft; stopCarousel(); e.preventDefault(); });
window.addEventListener('mousemove',e=>{ if(!_mDragActive) return; _carouselSel.scrollLeft=_mDragSL-(_mDragX-e.pageX); });
window.addEventListener('mouseup',()=>{ if(_mDragActive){ _mDragActive=false; startCarousel(); } });

// ── Service worker ────────────────────────────────────────────────────────
if('serviceWorker' in navigator&&location.hostname!=='www.claudeusercontent.com'){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('sw.js',{scope:'./'})
      .then(reg=>console.log('SW registered:',reg.scope))
      .catch(err=>console.log('SW registration failed:',err));
  });
  // Force reload when SW updates so stale cached HTML is replaced
  let _swRefreshing=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(!_swRefreshing){ _swRefreshing=true; window.location.reload(); }
  });
}

// ── iOS PWA standalone mode ──────────────────────────────────────────────
if(window.navigator.standalone===true||window.matchMedia('(display-mode:standalone)').matches){
  document.body.classList.add('pwa-mode');
}

// ── window.* exports for inline onclick handlers ──────────────────────────
window.setActiveView=setActiveView;
window.openFeeDateModal=openFeeDateModal;
window.closeFeeDateModal=closeFeeDateModal;
window.goToCardPeriod=goToCardPeriod;
window.skipBenefit=skipBenefit;
window.unskipBenefit=unskipBenefit;
window.backfill2025Badges=()=>{ localStorage.removeItem('perks-badges-2025-backfill'); localStorage.removeItem('perks-badges-2025-backfill-v2'); checkBadges(); backfill2025Badges(); renderBadgesView(); };
window.clearAllSkipped=clearAllSkipped;
window.requestNotifications=requestNotifications;
window.setSelectedYear=(y)=>{ state.selectedYear=y; };
window.switchPerfTab=(t)=>{ state._performanceTab=t; render(); };
window.openNoteModal=openNoteModal;
window.closeNoteModal=closeNoteModal;
window.setPartialUsed=setPartialUsed;
window.toggleCredited=toggleCredited;
window.openCardSheet=openCardSheet;
window.closeCardSheet=closeCardSheet;
window.toggleCPCard=toggleCPCard;
window.filterCPCards=filterCPCards;
window.filterMCCards=filterMCCards;
window.confirmCardPick=confirmCardPick;
window.saveCardDates=saveCardDates;
window.handleAuth=handleAuth;
window.handleForgotPassword=handleForgotPassword;
window.switchAuthTab=switchAuthTab;
window.toggleDark=toggleDark;
window.signOut=signOut;
window.openMyCards=openMyCards;
window.closeMyCards=closeMyCards;
window.saveMyCards=saveMyCards;
window.saveSettingsProfile=saveSettingsProfile;
window.saveSettingsPassword=saveSettingsPassword;
window.saveSettingsCards=saveSettingsCards;
window.filterSettingsCards=filterSettingsCards;
window.scheduleMonthlyReminder=scheduleMonthlyReminder;
window.disableNotifications=disableNotifications;
window.toggleNotifType=toggleNotifType;
window.togglePush=togglePush;
window.toggleDigestEmail=toggleDigestEmail;
window.isSkipped=isSkipped;
window.renderRecap=renderRecap;
window.setSnoozedBenefit=setSnoozedBenefit;
window.openSnoozeModal=openSnoozeModal;
window.closeSnoozeModal=closeSnoozeModal;
function updateMonthTabLabel(){
  const offset=state._periodOffset||0;
  const absM=CY*12+CM+offset;
  const viewM=absM%12;
  const el=document.getElementById('currentTab');
  const nextBtn=document.getElementById('monthNextBtn');
  if(el) el.textContent=offset===0?'Month':MONTHS[viewM];
  if(nextBtn) nextBtn.style.visibility=offset<0?'visible':'hidden';
}
window.setPeriodOffset=(offset)=>{ state._periodOffset=offset; updateMonthTabLabel(); renderCurrent(); };

// ── Alert badge ───────────────────────────────────────────────────────────
function updateAlertBadge(){
  const seen=new Set(JSON.parse(localStorage.getItem('perks-alerts-seen')||'[]'));
  const unseen=computeAlerts(new Set(getVisibleCardKeys())).filter(a=>!seen.has(a.id)).length;
  const dot=document.getElementById('alertBadgeDot');
  if(dot) dot.style.display=unseen>0?'block':'none';
}
function markAlertsSeen(){
  const alerts=computeAlerts(new Set(getVisibleCardKeys()));
  localStorage.setItem('perks-alerts-seen',JSON.stringify(alerts.map(a=>a.id)));
  updateAlertBadge();
}

// ── Points balance helpers ─────────────────────────────────────────────────
window.savePointsBalance=function(progId,value){
  const data=JSON.parse(localStorage.getItem('perks-points-balances')||'{}');
  const v=parseFloat(value)||0;
  if(v>0) data[progId]=v; else delete data[progId];
  localStorage.setItem('perks-points-balances',JSON.stringify(data));
  scheduleSave();
};
window.savePointsValuation=function(progId,value){
  const data=JSON.parse(localStorage.getItem('perks-points-valuations')||'{}');
  const v=parseFloat(value);
  if(v>0) data[progId]=v; else delete data[progId];
  localStorage.setItem('perks-points-valuations',JSON.stringify(data));
};

window.savePointsRedeemedEntry=function(cardKey,monthKey,amount){
  setPointsRedeemed(cardKey,monthKey,amount);
  renderPointsRedemptions();
};
window.setPtsRY=function(y){ window._ptsRY=y; renderPointsRedemptions(); };

// ── AI Advisor helpers ─────────────────────────────────────────────────────
window.askAdvisor=async function(question){
  if(state._advisorLoading) return;
  if(!question?.trim()) return;
  state._advisorLoading=true;
  if(!state._advisorHistory) state._advisorHistory=[];

  const responseEl=document.getElementById('adv-response');
  if(responseEl) responseEl.innerHTML='<div class="adv-loading"><span class="adv-dot"></span><span class="adv-dot"></span><span class="adv-dot"></span></div>';

  try{
    const context=buildAdvisorContext();
    const {data:sessionData}=await sb.auth.getSession();
    const token=sessionData?.session?.access_token;
    const resp=await fetch(`${SUPABASE_URL}/functions/v1/ask-perks-advisor`,{
      method:'POST',
      headers:{
        'Authorization':`Bearer ${token}`,
        'Content-Type':'application/json',
        'apikey':SUPABASE_KEY,
      },
      body:JSON.stringify({question,context}),
    });
    if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result=await resp.json();
    if(result.error) throw new Error(result.error);
    const answer=result.answer||'No response received.';
    state._advisorHistory.push({q:question,a:answer});
  }catch(e){
    state._advisorHistory.push({q:question,a:`Error: ${e.message||'Could not reach AI advisor.'}`});
  }finally{
    state._advisorLoading=false;
  }

  if(state.activeView==='ai-advisor'){
    const el=document.getElementById('adv-response');
    if(el){
      el.innerHTML=state._advisorHistory.map(({q,a})=>`
        <div class="adv-q">${escapeHtml(q)}</div>
        <div class="adv-a">${formatAdvisorMarkdown(a)}</div>
      `).join('');
      el.scrollTop=el.scrollHeight;
    }
  }
};

window.sendAdvisor=function(){
  const inp=document.getElementById('adv-input');
  if(!inp||!inp.value.trim()) return;
  const q=inp.value.trim();
  inp.value='';
  window.askAdvisor(q);
};
