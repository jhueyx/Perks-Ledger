import { CARDS, PREMIUM_CARD_CATALOG, MONTHS_FULL } from './cards.js';
import { state, CY, CM } from './state.js';
import { isUsed, isGloballySnoozed, isMonthSnoozed, scheduleSave } from './storage.js';
import { calcStats, getCardYearPeriods, isPCurrent, getFee, getLongestStreak, getCurrentPK, isBExpired, isBNotAvailable } from './periods.js';
import { getVisibleCardKeys } from './views.js';

const BADGES_KEY = 'perks-badges';

// "Perfect Month" defs are generated per-year (rather than hardcoded) so they
// keep working past the year they were first written in.
const PERFECT_MONTH_START_YEAR = 2024;
function buildPerfectMonthDefs(){
  const defs=[];
  for(let year=PERFECT_MONTH_START_YEAR; year<=CY; year++){
    MONTHS_FULL.forEach((name,i)=>{
      defs.push({ id:`perf_${year}_${String(i+1).padStart(2,'0')}`, tier:'gold', name:`${name} ${year}`, desc:`All monthly benefits redeemed across every card — ${name} ${year}` });
    });
    defs.push({ id:`perf_sweep_${year}`, tier:'platinum', name:`${year} Perfect Run`, desc:`All monthly benefits redeemed every month so far in ${year} — not a single miss` });
  }
  return defs;
}

export const BADGE_DEFS = [
  // ── Streaks ──────────────────────────────────────────────────────────
  { id:'streak_3',        tier:'bronze',    name:'On Fire',                  desc:'3-month streak on any monthly benefit' },
  { id:'streak_6',        tier:'silver',    name:'Blazing',                  desc:'6-month streak on any monthly benefit' },
  { id:'streak_12',       tier:'gold',      name:'Unstoppable',              desc:'12-month streak on any monthly benefit' },
  { id:'streak_18',       tier:'platinum',  name:'Iron Streak',              desc:'18-month streak on any monthly benefit' },
  { id:'streak_24',       tier:'legendary', name:'Diamond Streak',           desc:'24-month streak — relentless, month after month' },

  // ── Portfolio size ───────────────────────────────────────────────────
  { id:'collector',       tier:'bronze',    name:'Collector',                desc:'Tracking 3 or more cards' },
  { id:'portfolio_pro',   tier:'silver',    name:'Portfolio Pro',            desc:'Tracking 5 or more cards' },
  { id:'card_shark',      tier:'silver',    name:'Card Shark',               desc:'Tracking 7 or more cards', minCards:7 },
  { id:'whale',           tier:'gold',      name:'Whale',                    desc:'Tracking 10 or more cards', minCards:10 },

  // ── Value captured — single card ─────────────────────────────────────
  { id:'big_win',         tier:'silver',    name:'Big Win',                  desc:'$1,000+ captured on a single card' },
  { id:'high_roller',     tier:'gold',      name:'High Roller',              desc:'$1,500+ captured on a single card' },
  { id:'elite_earner',    tier:'platinum',  name:'Elite Earner',             desc:'$2,000+ captured on a single card' },

  // ── Value captured — total portfolio ────────────────────────────────
  { id:'getting_started', tier:'bronze',    name:'Getting Started',          desc:'$100+ total value captured' },
  { id:'gaining_ground',  tier:'bronze',    name:'Gaining Ground',           desc:'$500+ total value captured' },
  { id:'high_achiever',   tier:'silver',    name:'High Achiever',            desc:'$1,000+ total value captured' },
  { id:'power_user',      tier:'silver',    name:'Power User',               desc:'$2,500+ total value captured' },
  { id:'maximizer',       tier:'platinum',  name:'Maximizer',                desc:'$5,000+ total value captured' },
  { id:'true_maximizer',  tier:'legendary', name:'True Maximizer',           desc:'$10,000+ total value captured — a rare achievement', minDollar:10000 },

  // ── Fee mastery ──────────────────────────────────────────────────────
  { id:'first_profit',    tier:'gold',      name:'Fee Slayer',               desc:'Offset a card\'s full annual fee' },
  { id:'double_dipper',   tier:'silver',    name:'Double Dipper',            desc:'2 cards simultaneously in profit' },
  { id:'triple_threat',   tier:'gold',      name:'Triple Threat',            desc:'3+ cards simultaneously in profit' },
  { id:'fee_crusher',     tier:'platinum',  name:'Fee Crusher',              desc:'All your cards are simultaneously in profit' },

  // ── Card mastery ─────────────────────────────────────────────────────
  { id:'gold_master',     tier:'silver',    name:'Gold Mastery',             desc:'Amex Gold annual fee fully offset',                        cards:['gold'] },
  { id:'plat_master',     tier:'gold',      name:'Platinum Mastery',         desc:'Amex Platinum annual fee fully offset',                    cards:['platinum'] },
  { id:'csr_master',      tier:'gold',      name:'Sapphire Master',          desc:'Chase Sapphire Reserve annual fee fully offset',           cards:['csr'] },

  // ── Claim volume ─────────────────────────────────────────────────────
  { id:'benefit_ninja',   tier:'bronze',    name:'Benefit Ninja',            desc:'25+ total benefit claims across all cards' },
  { id:'benefit_machine', tier:'silver',    name:'Benefit Machine',          desc:'50+ total benefit claims across all cards' },
  { id:'century',         tier:'gold',      name:'Century',                  desc:'100+ total benefit claims — a true maximizer' },

  // ── Completionist ────────────────────────────────────────────────────
  { id:'grand_slam',      tier:'gold',      name:'Grand Slam',               desc:'Every current benefit claimed across all cards' },
  { id:'early_bird',      tier:'bronze',    name:'Early Bird',               desc:'All monthly benefits claimed before the 15th' },
  { id:'all_in',          tier:'gold',      name:'All In',                   desc:'100% of all benefits claimed on any single card' },
  { id:'perfectionist',   tier:'gold',      name:'Perfectionist',            desc:'100% claim rate achieved on 2+ cards' },
  { id:'all_in_2',        tier:'platinum',  name:'Completionist',            desc:'100% on every single tracked card — nothing left behind' },

  // ── Category specialists ─────────────────────────────────────────────
  { id:'uber_loyalist',   tier:'bronze',    name:'Uber Loyalist',            desc:'6-month Uber credit streak',                               cards:['gold','platinum'] },
  { id:'doordash_devotee',tier:'bronze',    name:'DoorDash Devotee',         desc:'6-month DoorDash credit streak',                           cards:['csr','chase_sapphire_pref'] },
  { id:'dining_devotee',  tier:'silver',    name:'Dining Devotee',           desc:'6-month dining credit streak',                             cards:['gold'] },
  { id:'fitness_fan',     tier:'bronze',    name:'Fitness Fan',              desc:'Used a fitness credit (Peloton, Equinox, or Lululemon)',   cards:['platinum','csr'] },
  { id:'clear_member',    tier:'bronze',    name:'CLEAR Member',             desc:'Used a CLEAR Plus credit',                                 cards:['platinum','amex_green'] },
  { id:'global_traveler', tier:'bronze',    name:'Global Traveler',          desc:'Used a Global Entry / TSA PreCheck credit',                cards:['platinum','cap1_venture_x','csr','amex_hilton_honors','amex_marriott_brill','chase_united_quest','chase_united_club','wf_premier_autograph'] },
  { id:'hotel_hopper',    tier:'silver',    name:'Hotel Hopper',             desc:'Hotel credits used on 2+ different cards',                 cards:['platinum','cap1_venture_x','chase_sapphire_pref','csr','amex_hilton_honors','amex_marriott_brill'] },
  { id:'lounge_lizard',   tier:'silver',    name:'Lounge Lizard',            desc:'United Club membership benefit claimed',                   cards:['chase_united_club'] },
  { id:'jet_setter',      tier:'silver',    name:'Jet Setter',               desc:'Travel or airline credits used on 2+ cards',              cards:['cap1_venture_x','csr','platinum','amex_hilton_honors','wf_premier_autograph','chase_united_quest','chase_united_club'] },

  // ── Year-based ───────────────────────────────────────────────────────
  { id:'yr_2024',         tier:'bronze',    name:'Class of \'24',            desc:'Tracking benefits since 2024' },
  { id:'yr_2025',         tier:'silver',    name:'2025 Champion',            desc:'Active benefit tracker in 2025' },
  { id:'yr_2026',         tier:'bronze',    name:'2026 Active',              desc:'Tracking benefits in 2026' },
  { id:'multi_year',      tier:'gold',      name:'Multi-Year Veteran',       desc:'Active tracker in 3+ calendar years' },
  { id:'early_adopter',   tier:'silver',    name:'Early Adopter',            desc:'Using Perks Ledger since 2024 or earlier' },

  // ── Brand & bank loyalty ─────────────────────────────────────────────
  { id:'amex_loyalist',   tier:'gold',      name:'Amex Loyalist',            desc:'Tracking 3+ American Express cards',                       cards:['platinum','gold','amex_green','amex_biz_plat','amex_biz_gold','amex_hilton_honors','amex_marriott_brill'], minIssuer:{name:'American Express',count:3} },
  { id:'chase_loyalist',  tier:'gold',      name:'Chase Loyalist',           desc:'Tracking 3+ Chase cards',                                  cards:['csr','chase_sapphire_pref','chase_world_of_hyatt','chase_united_quest','chase_united_club'], minIssuer:{name:'Chase',count:3} },
  { id:'cap1_loyalist',   tier:'silver',    name:'Capital One Fan',          desc:'Tracking a Capital One card',                              cards:['cap1_venture_x'] },
  { id:'citi_loyalist',   tier:'bronze',    name:'Citi Cardmember',          desc:'Tracking any Citi card',                                   cards:['citi_strata_prem'] },
  { id:'wf_loyalist',     tier:'bronze',    name:'Wells Fargo Cardholder',   desc:'Tracking any Wells Fargo card',                            cards:['wf_premier_autograph'] },
  { id:'multi_bank',      tier:'platinum',  name:'Multi-Bank Master',        desc:'Cards from 3+ different banks in your portfolio' },
  { id:'amex_trifecta',   tier:'gold',      name:'Amex Trifecta',            desc:'Platinum + Gold + Green all tracked simultaneously',       cards:['platinum','gold','amex_green'], hidden:true },
  { id:'chase_trifecta',  tier:'gold',      name:'Chase Trifecta',           desc:'CSR + Sapphire Preferred + one more Chase card all tracked',cards:['csr','chase_sapphire_pref'], hidden:true },

  // ── Card-specific tracking ───────────────────────────────────────────
  { id:'hilton_devotee',  tier:'bronze',    name:'Hilton Devotee',           desc:'Tracking the Hilton Honors Aspire card',                   cards:['amex_hilton_honors'] },
  { id:'marriott_fan',    tier:'bronze',    name:'Marriott Fan',             desc:'Tracking the Marriott Bonvoy Brilliant card',              cards:['amex_marriott_brill'] },
  { id:'hyatt_explorer',  tier:'bronze',    name:'Hyatt Explorer',           desc:'Tracking the World of Hyatt card',                         cards:['chase_world_of_hyatt'] },
  { id:'hotel_portfolio', tier:'silver',    name:'Hotel Portfolio',          desc:'Tracking Hilton Aspire + Marriott Brilliant + Hyatt together', cards:['amex_hilton_honors','amex_marriott_brill','chase_world_of_hyatt'], hidden:true },
  { id:'csp_holder',      tier:'bronze',    name:'Preferred Member',         desc:'Tracking the Chase Sapphire Preferred card',               cards:['chase_sapphire_pref'] },
  { id:'green_carrier',   tier:'bronze',    name:'Going Green',              desc:'Tracking the Amex Green card',                             cards:['amex_green'] },
  { id:'venture_x_holder',tier:'bronze',    name:'Venture X Holder',         desc:'Tracking the Capital One Venture X card',                  cards:['cap1_venture_x'] },
  { id:'united_flyer',    tier:'bronze',    name:'United Flyer',             desc:'Tracking United Quest or United Club Infinite',            cards:['chase_united_quest','chase_united_club'] },
  { id:'strata_holder',   tier:'bronze',    name:'Strata Premier',           desc:'Tracking the Citi Strata Premier card',                    cards:['citi_strata_prem'] },

  // ── Specific benefits used ───────────────────────────────────────────
  { id:'saks_shopper',    tier:'bronze',    name:'Saks Fifth',               desc:'Used the Saks Fifth Avenue semi-annual credit',            cards:['platinum'] },
  { id:'lulu_fan',        tier:'bronze',    name:'Lulu Loyalist',            desc:'Used the Lululemon quarterly credit',                      cards:['platinum'] },
  { id:'oura_owner',      tier:'bronze',    name:'Oura Owner',               desc:'Used the Oura Ring annual credit',                         cards:['platinum'] },
  { id:'uber_one_club',   tier:'bronze',    name:'Uber One Member',          desc:'Claimed the annual Uber One membership credit',            cards:['platinum'] },
  { id:'equinox_devotee', tier:'bronze',    name:'Equinox Member',           desc:'Used the Equinox annual credit',                           cards:['platinum'] },
  { id:'resy_regular',    tier:'bronze',    name:'Resy Regular',             desc:'Used a Resy dining credit on any card',                    cards:['gold','platinum'] },
  { id:'dec_bonus',       tier:'gold',      name:'December Ace',             desc:'Claimed the $35 December Platinum Uber bonus',             cards:['platinum'], hidden:true },
  { id:'digital_devotee', tier:'silver',    name:'Digital Devotee',          desc:'6+ month streak on the Platinum Digital Entertainment credit', cards:['platinum'] },
  { id:'dunkin_addict',   tier:'silver',    name:'Dunkin\' Devotee',         desc:'6+ month streak on the Gold Dunkin\' credit',              cards:['gold'] },
  { id:'walmart_weekly',  tier:'silver',    name:'Walmart Warrior',          desc:'6+ month streak on the Platinum Walmart+ credit',          cards:['platinum'] },
  { id:'peloton_rider',   tier:'bronze',    name:'Peloton Rider',            desc:'Used the CSR Peloton credit 3+ consecutive months',        cards:['csr'] },
  { id:'uber_vip',        tier:'gold',      name:'Uber VIP',                 desc:'18+ total Uber Cash claims across all cards',              cards:['gold','platinum'] },
  { id:'doordash_pro',    tier:'silver',    name:'DoorDash Pro',             desc:'12+ total DoorDash credit claims',                         cards:['csr','chase_sapphire_pref'] },

  // ── Wellness ─────────────────────────────────────────────────────────
  { id:'wellness_stack',  tier:'silver',    name:'Wellness Stack',           desc:'Used 2+ different wellness credits (Equinox, Lululemon, Peloton, Oura)', cards:['platinum','csr'] },
  { id:'full_wellness',   tier:'gold',      name:'Wellness Maximizer',       desc:'Used all four wellness credits: Equinox, Lululemon, Peloton, and Oura', cards:['platinum','csr'], hidden:true },

  // ── Travel combos ────────────────────────────────────────────────────
  { id:'clear_and_ge',    tier:'silver',    name:'Double Cleared',           desc:'Both CLEAR Plus and Global Entry credits used',            cards:['platinum','amex_green'] },
  { id:'airport_royalty', tier:'gold',      name:'Airport Royalty',          desc:'CLEAR, Global Entry, and airport lounge — all three used', cards:['platinum','amex_green','chase_united_club'], hidden:true },
  { id:'airline_insider', tier:'silver',    name:'Airline Insider',          desc:'Airline fee credits used on 2+ different cards',           cards:['platinum','amex_hilton_honors','wf_premier_autograph','chase_united_quest','chase_united_club'] },
  { id:'hotel_connoisseur',tier:'gold',     name:'Hotel Connoisseur',        desc:'Hotel credits used on 3+ different cards',                 cards:['platinum','cap1_venture_x','chase_sapphire_pref','csr','amex_hilton_honors','amex_marriott_brill'] },
  { id:'first_class_combo',tier:'silver',   name:'First Class',              desc:'Both airline and hotel credits in your portfolio',         cards:['platinum','amex_hilton_honors','wf_premier_autograph','chase_united_quest'], hidden:true },
  { id:'lounge_regular',  tier:'gold',      name:'Lounge Regular',           desc:'United Club membership and CLEAR Plus both claimed',       cards:['chase_united_club'] },
  { id:'saks_both',       tier:'silver',    name:'Full Saks Season',         desc:'Claimed both H1 and H2 Saks credits in the same year',     cards:['platinum'], hidden:true },

  // ── Benefit combos ───────────────────────────────────────────────────
  { id:'food_combo',      tier:'bronze',    name:'Food Lover',               desc:'Both Uber Cash and DoorDash credits in your portfolio',    cards:['gold','platinum','csr','chase_sapphire_pref'] },
  { id:'commuter_pack',   tier:'bronze',    name:'Commuter',                 desc:'Both Uber and Lyft credits used',                          cards:['csr'], hidden:true },
  { id:'dining_trifecta', tier:'silver',    name:'Dining Trifecta',          desc:'Three or more distinct dining credit types used',          cards:['gold','platinum','csr','amex_marriott_brill'], hidden:true },
  { id:'entertainment_bundle', tier:'bronze', name:'Entertainment Bundle',   desc:'Both Digital Entertainment and Peloton credits used',      cards:['platinum','csr'] },

  // ── Dollar milestones ─────────────────────────────────────────────────
  { id:'silver_bullet',   tier:'bronze',    name:'Silver Bullet',            desc:'$750+ captured on a single card' },
  { id:'gold_mine',       tier:'silver',    name:'Gold Mine',                desc:'$3,000+ total value captured' },
  { id:'platinum_tier',   tier:'gold',      name:'Platinum Tier',            desc:'$7,000+ total value captured', minDollar:7000 },

  // ── High-volume claims ───────────────────────────────────────────────
  { id:'claim_addict',    tier:'bronze',    name:'Claim Addict',             desc:'150+ total benefit claims across all cards' },
  { id:'claim_machine',   tier:'silver',    name:'Claim Machine',            desc:'300+ total benefit claims — relentlessly consistent' },

  // ── Misc / seasonal ──────────────────────────────────────────────────
  { id:'new_year_start',  tier:'bronze',    name:'New Year Starter',         desc:'Claimed a benefit in January' },

  // ── Meta / progression ───────────────────────────────────────────────
  { id:'badge_20',        tier:'bronze',    name:'Decorated',                desc:'Earned 20 or more badges' },
  { id:'badge_35',        tier:'silver',    name:'Overachiever',             desc:'Earned 35 or more badges' },
  { id:'badge_50',        tier:'gold',      name:'Hall of Famer',            desc:'Earned 50 or more badges' },
  { id:'badge_75',        tier:'platinum',  name:'Legend Status',            desc:'Earned 75 or more badges' },
  { id:'badge_100',       tier:'legendary', name:'The Complete Package',     desc:'Earned 100 or more badges — truly the top 1%', hidden:true },

  // ── CSR-specific ─────────────────────────────────────────────────────
  { id:'stubhub_fan',        tier:'bronze',    name:'Live Nation',              desc:'Used the CSR StubHub/Viagogo event credit',                cards:['csr'] },
  { id:'csr_traveler',       tier:'bronze',    name:'Road Warrior',             desc:'Claimed the CSR $300 travel credit',                       cards:['csr'] },
  { id:'exclusive_tables',   tier:'bronze',    name:'Top Table',                desc:'Used the CSR Exclusive Tables dining credit',              cards:['csr'] },
  { id:'apple_insider',      tier:'bronze',    name:'Apple Insider',            desc:'Claimed the CSR Apple TV+ & Apple Music credit',           cards:['csr'] },
  { id:'the_edit_guest',     tier:'silver',    name:'The Edit',                 desc:'Stayed at a Chase Travel The Edit property via CSR',       cards:['csr'], hidden:true },
  { id:'lyft_rider',         tier:'silver',    name:'Lyft Regular',             desc:'6-month Lyft credit streak on the Sapphire Reserve',       cards:['csr'] },
  { id:'csr_month_sweep',    tier:'silver',    name:'CSR Sweep',                desc:'DoorDash, Lyft, and Peloton all claimed in the same month', cards:['csr'] },
  { id:'stub_season',        tier:'silver',    name:'Event Season',             desc:'StubHub credit claimed in both H1 and H2 of the same year', cards:['csr'], hidden:true },

  // ── Gold-specific ─────────────────────────────────────────────────────
  { id:'gold_sweep',         tier:'silver',    name:'Gold Sweep',               desc:'Dining, Uber, and Dunkin credits all claimed in one month', cards:['gold'] },
  { id:'dunkin_power',       tier:'gold',      name:'Coffee Connoisseur',       desc:'12+ consecutive months of the Dunkin credit on Amex Gold',  cards:['gold'] },

  // ── Platinum-specific ────────────────────────────────────────────────
  { id:'plat_trifecta_month',tier:'silver',    name:'Platinum Triple',          desc:'Uber, Digital Entertainment, and Walmart+ all in one month', cards:['platinum'] },
  { id:'hotel_twice',        tier:'silver',    name:'Fine Hotels Regular',      desc:'Platinum Fine Hotels + Resorts credit used 2+ times',      cards:['platinum'] },
  { id:'plat_mega',          tier:'platinum',  name:'Platinum Legend',          desc:'$3,000+ total captured on Amex Platinum alone',            cards:['platinum'] },

  // ── WF Premier Autograph-specific ────────────────────────────────────
  { id:'wf_airline_user',    tier:'bronze',    name:'WF Flyer',                 desc:'Used the WF Premier Autograph airline credit',             cards:['wf_premier_autograph'] },
  { id:'wf_ge_user',         tier:'bronze',    name:'WF Cleared',               desc:'Used the WF Premier Autograph Global Entry credit',        cards:['wf_premier_autograph'] },

  // ── Cross-card combos ────────────────────────────────────────────────
  { id:'chase_amex_duo',     tier:'bronze',    name:'Chase × Amex',             desc:'Both CSR and Amex Platinum in your portfolio',             cards:['csr','platinum'] },
  { id:'double_airline',     tier:'silver',    name:'Dual Runway',              desc:'Both Platinum and WF Premier airline credits claimed',     cards:['platinum','wf_premier_autograph'] },
  { id:'both_resy',          tier:'bronze',    name:'Resy Devotee',             desc:'Both Gold and Platinum Resy credits used',                 cards:['gold','platinum'], hidden:true },
  { id:'uber_double_month',  tier:'gold',      name:'Uber Everything',          desc:'Uber credits claimed on both Gold and Platinum in the same month', cards:['gold','platinum'], hidden:true },
  { id:'four_kings',         tier:'legendary', name:'The Quad',                 desc:'CSR, Gold, Platinum, and WF Premier — all four tracked',   cards:['csr','gold','platinum','wf_premier_autograph'], hidden:true },

  // ── Perfect month ────────────────────────────────────────────────────
  ...buildPerfectMonthDefs(),

  // ── Legendary ────────────────────────────────────────────────────────
  { id:'founder',         tier:'legendary', name:'Founder',                  desc:'Built this — no one else gets this badge', special:true },
  { id:'hacker',          tier:'legendary', name:'Benefit Hacker',           desc:'Mastered the art of extracting every dollar from every card', special:true },
  { id:'obsessive',       tier:'legendary', name:'Obsessive',                desc:'Tracks, optimizes, and agonizes over every single benefit', special:true },
];

// Cadence -> occurrences per year, used to project each held card's max
// possible annual capture (for gating dollar-milestone badges that would
// otherwise sit permanently stuck below the portfolio's actual ceiling).
const ANNUAL_MULT={monthly:12,quarterly:4,'semi-annual':2,'cal-semi-annual':2};

export function getApplicableBadgeDefs(){
  const cardKeys=new Set(getVisibleCardKeys());

  const issuerMap=Object.fromEntries(PREMIUM_CARD_CATALOG.map(c=>[c.id,c.issuer]));
  const issuerCounts={};
  cardKeys.forEach(ck=>{ const iss=issuerMap[ck]; if(iss) issuerCounts[iss]=(issuerCounts[iss]||0)+1; });

  const maxAnnual=[...cardKeys].reduce((sum,ck)=>{
    const card=CARDS[ck];
    if(!card) return sum;
    return sum+card.sections.reduce((s,sec)=>
      s+sec.benefits.reduce((bs,b)=>bs+b.amount*(ANNUAL_MULT[sec.cadence]??1),0)
    ,0);
  },0);

  return BADGE_DEFS.filter(def=>{
    if(def.cards&&!def.cards.some(k=>cardKeys.has(k))) return false;
    if(def.minCards&&cardKeys.size<def.minCards) return false;
    if(def.minIssuer&&(issuerCounts[def.minIssuer.name]||0)<def.minIssuer.count) return false;
    if(def.minDollar&&maxAnnual<def.minDollar) return false;
    return true;
  });
}

export const TIER_COLORS = {
  bronze:   '#CD7F32',
  silver:   '#A0A8B0',
  gold:     '#C8922A',
  platinum: '#4A7FA5',
  legendary:'#9B59B6',
};

function loadState(){ try{ const s=JSON.parse(localStorage.getItem(BADGES_KEY)||'{}'); return {earned:s.earned||[],seen:s.seen||[],earnedAt:s.earnedAt||{}}; }catch(e){ return {earned:[],seen:[],earnedAt:{}}; } }
function saveState(s){ localStorage.setItem(BADGES_KEY,JSON.stringify(s)); scheduleSave(); }

export function getEarnedBadges(){ return loadState().earned; }
export function getEarnedAt(){ return loadState().earnedAt; }
export function getUnseenBadges(){ const s=loadState(); const seen=new Set(s.seen); return s.earned.filter(id=>!seen.has(id)); }
export function markAllSeen(){ const s=loadState(); s.seen=[...s.earned]; saveState(s); }

export function awardBadges(ids, approxDates){
  const s=loadState();
  const prev=new Set(s.earned);
  const earned=new Set(prev);
  const now=Date.now();
  ids.forEach(id=>{
    if(!earned.has(id)){
      earned.add(id);
      s.earnedAt[id]=approxDates&&approxDates[id] ? approxDates[id] : now;
    }
  });
  s.earned=[...earned];
  saveState(s);
  return ids.filter(id=>!new Set(loadState().seen).has(id));
}

export function backfill2025Badges(){
  const FLAG='perks-badges-2025-backfill-v2';
  if(localStorage.getItem(FLAG)) return [];
  const approx={
    getting_started: new Date('2025-02-01').getTime(),
    gaining_ground:  new Date('2025-04-01').getTime(),
    collector:       new Date('2025-03-01').getTime(),
    portfolio_pro:   new Date('2025-06-01').getTime(),
    streak_3:        new Date('2025-04-01').getTime(),
    streak_6:        new Date('2025-07-01').getTime(),
    streak_12:       new Date('2026-01-01').getTime(),
    first_profit:    new Date('2025-06-01').getTime(),
    big_win:         new Date('2025-12-01').getTime(),
    high_achiever:   new Date('2025-09-01').getTime(),
    uber_loyalist:   new Date('2025-07-01').getTime(),
    dining_devotee:  new Date('2025-07-01').getTime(),
    yr_2025:         new Date('2026-01-01').getTime(),
    yr_2026:         new Date('2026-01-15').getTime(),
    multi_year:      new Date('2026-01-15').getTime(),
    founder:         new Date('2025-01-01').getTime(),
    hacker:          new Date('2025-01-01').getTime(),
    obsessive:       new Date('2025-01-01').getTime(),
  };
  const newOnes=awardBadges(Object.keys(approx), approx);
  localStorage.setItem(FLAG,'1');
  return newOnes;
}

export function unlockReviewedBadges(){
  const FLAG='perks-badges-reviewed-unlock-2026-05-24';
  if(localStorage.getItem(FLAG)) return [];
  const ids=[
    'streak_3','streak_6','streak_12','streak_18','streak_24',
    'collector',
    'big_win','high_roller','elite_earner',
    'getting_started','gaining_ground','high_achiever','power_user','gold_mine','silver_bullet',
    'first_profit','double_dipper','gold_master','plat_master',
    'benefit_ninja','benefit_machine','century','claim_addict',
    'all_in',
    'uber_loyalist','doordash_devotee','dining_devotee',
    'fitness_fan','clear_member','jet_setter',
    'yr_2024','yr_2025','yr_2026','multi_year','early_adopter',
    'saks_shopper','lulu_fan','oura_owner','uber_one_club','equinox_devotee','resy_regular',
    'digital_devotee','dunkin_addict','uber_vip','doordash_pro',
    'wellness_stack',
    'food_combo','commuter_pack','dining_trifecta',
    'stubhub_fan','csr_traveler','exclusive_tables','apple_insider',
    'gold_sweep','dunkin_power',
    'chase_amex_duo','both_resy','uber_double_month',
    'badge_20','badge_35','badge_50',
  ];
  const now=Date.now();
  const approx=Object.fromEntries(ids.map(id=>[id,now]));
  const newOnes=awardBadges(ids, approx);
  localStorage.setItem(FLAG,'1');
  return newOnes;
}

// Check if a benefit ID was ever claimed on a given card (any period)
function everUsed(cardKey, benefitId){
  const d=state.DATA[cardKey]||{};
  return Object.entries(d).some(([k,v])=>k.startsWith(benefitId+'__')&&v===true);
}

export function checkBadges(){
  const s=loadState();
  const prev=new Set(s.earned);
  const cardKeys=getVisibleCardKeys();

  let anyProfit=false, profitCount=0, allProfit=cardKeys.length>0;
  let totalCaptured=0, maxSingleCard=0, maxStreak=0;
  let allCurrentClaimed=cardKeys.length>0, anyBigWin=false;
  const perCardFullYear=[];

  let uberMaxStreak=0, ddMaxStreak=0, diningMaxStreak=0;
  let fitnessUsed=false, clearUsed=false, geUsed=false, loungeUsed=false;
  let travelCardCount=0, hotelCardCount=0, airlineCardCount=0;
  let goldProfit=false, platProfit=false, csrProfit=false;
  let uberEverUsed=false, ddEverUsed=false, lyftUsed=false, anyAirlineUsed=false;
  let uberTotalUses=0, ddTotalUses=0;
  const wellnessTypes=new Set();
  const diningTypes=new Set();

  // Brand/bank loyalty — count by issuer
  const issuerMap=Object.fromEntries(PREMIUM_CARD_CATALOG.map(c=>[c.id,c.issuer]));
  const issuerCounts={};
  cardKeys.forEach(ck=>{ const iss=issuerMap[ck]; if(iss) issuerCounts[iss]=(issuerCounts[iss]||0)+1; });
  const uniqueIssuers=Object.keys(issuerCounts).length;

  // Dec bonus: Platinum Uber claimed in any December
  const decBonus=Object.entries(state.DATA['platinum']||{})
    .some(([k,v])=>k.startsWith('p_uber__')&&k.endsWith('-12')&&v===true);

  // Saks both halves in same year
  const saksBoth=(()=>{
    const byYr={};
    Object.entries(state.DATA['platinum']||{}).forEach(([k,v])=>{
      if(!v||!k.startsWith('p_saks__')) return;
      const yr=k.split('__')[1].split('-')[0]; byYr[yr]=(byYr[yr]||0)+1;
    });
    return Object.values(byYr).some(c=>c>=2);
  })();

  // Has January data in any year
  const hasJanData=Object.values(state.DATA).some(d=>
    Object.entries(d).some(([k,v])=>v===true&&/^\d{4}-01$/.test((k.split('__')[1])||''))
  );

  const airlineBenefitIds=['p_airline','ah_airline','wfpa_airline','uq_miles'];

  // ── Card-specific pre-computed checks ────────────────────────────────
  const monthSweep=(cardKey,ids)=>{
    const d=state.DATA[cardKey]||{};
    const pks=new Set(Object.entries(d).filter(([,v])=>v).map(([k])=>k.split('__')[1]));
    return [...pks].some(pk=>ids.every(id=>d[`${id}__${pk}`]===true));
  };
  const csrMonthFull=monthSweep('csr',['c_dd_restaurant','c_lyft','c_peloton']);
  const goldMonthFull=monthSweep('gold',['g_dining','g_uber','g_dunkin']);
  const platMonthFull=monthSweep('platinum',['p_uber','p_digital','p_walmart']);
  const platHotelCount=Object.entries(state.DATA['platinum']||{}).filter(([k,v])=>v&&k.startsWith('p_hotel__')).length;
  const stubBoth=(()=>{
    const byYr={};
    Object.entries(state.DATA['csr']||{}).forEach(([k,v])=>{
      if(!v||!k.startsWith('c_stub__')) return;
      const yr=k.split('__')[1].split('-')[0]; byYr[yr]=(byYr[yr]||0)+1;
    });
    return Object.values(byYr).some(c=>c>=2);
  })();
  const uberDoubleMonth=(()=>{
    const gd=state.DATA['gold']||{};
    const pd=state.DATA['platinum']||{};
    const gPks=new Set(Object.entries(gd).filter(([k,v])=>v&&k.startsWith('g_uber__')).map(([k])=>k.split('__')[1]));
    return [...gPks].some(pk=>pd[`p_uber__${pk}`]===true);
  })();
  const wfAirlineUsed=everUsed('wf_premier_autograph','wfpa_airline');
  const wfGeUsed=everUsed('wf_premier_autograph','wfpa_ge');

  // Count total benefit claims across all state.DATA
  let totalClaims=0;
  Object.values(state.DATA).forEach(d=>{
    Object.values(d).forEach(v=>{ if(v===true) totalClaims++; });
  });

  // Detect active years from all tracked data (true entries only)
  const activeYears=new Set();
  Object.values(state.DATA).forEach(d=>{
    Object.entries(d).forEach(([k,v])=>{
      if(!v) return;
      const pk=(k.split('__')[1])||'';
      const yr=parseInt(pk.substring(0,4));
      if(yr>=2020&&yr<=2030) activeYears.add(yr);
    });
  });

  const travelBenefitIds=['vx_travel','c_travel','p_airline','ah_airline','wfpa_airline','uq_miles'];
  const hotelBenefitIds=['p_hotel','vx_hotel','csp_hotel','ah_resort','amb_propcredit','amb_freenight'];

  let platCaptured=0;
  cardKeys.forEach(ck=>{
    const fee=getFee(ck,CY);
    const {captured}=calcStats(ck,c=>getCardYearPeriods(ck,c),isPCurrent);
    totalCaptured+=captured;
    if(ck==='platinum') platCaptured=captured;
    if(captured>=fee&&fee>0){
      anyProfit=true; profitCount++;
      if(ck==='gold') goldProfit=true;
      if(ck==='platinum') platProfit=true;
      if(ck==='csr') csrProfit=true;
    } else if(fee>0){
      allProfit=false;
    }
    if(captured>maxSingleCard) maxSingleCard=captured;
    if(captured>=1000) anyBigWin=true;

    // Grand slam: every current benefit claimed
    CARDS[ck].sections.forEach(sec=>{
      const pk=getCurrentPK(ck,sec.cadence);
      const p={calY:CY,calM:CM,m:CM};
      sec.benefits.forEach(b=>{
        if(isBExpired(b,p)||isBNotAvailable(b,CY,p)||isGloballySnoozed(ck,b.id)) return;
        if(!isUsed(ck,b.id,pk)) allCurrentClaimed=false;
      });
    });

    // All-in: 100% across all historical periods for this card
    let cardYearAll=true;
    CARDS[ck].sections.forEach(sec=>{
      getCardYearPeriods(ck,sec.cadence).forEach(p=>{
        if(p.calY>CY||(p.calY===CY&&p.calM>CM)) return;
        sec.benefits.forEach(b=>{
          if(isBExpired(b,p)||isBNotAvailable(b,CY,p)||isGloballySnoozed(ck,b.id)) return;
          if(!isUsed(ck,b.id,p.pk)) cardYearAll=false;
        });
      });
    });
    if(cardYearAll) perCardFullYear.push(ck);

    // Streaks — monthly benefits
    CARDS[ck].sections.forEach(sec=>{
      if(sec.cadence!=='monthly') return;
      sec.benefits.forEach(b=>{
        const st=getLongestStreak(ck,b.id);
        if(st>maxStreak) maxStreak=st;
        if(['g_uber','p_uber'].includes(b.id)&&st>uberMaxStreak) uberMaxStreak=st;
        if(['c_dd_restaurant','c_dd_nonrest1','c_dd_nonrest2'].includes(b.id)&&st>ddMaxStreak) ddMaxStreak=st;
        if(['g_dining'].includes(b.id)&&st>diningMaxStreak) diningMaxStreak=st;
      });
    });

    // Category: fitness
    if(['c_peloton','p_lulu','p_equinox'].some(id=>everUsed(ck,id))) fitnessUsed=true;

    // Category: CLEAR
    if(['p_clear','ag_clear'].some(id=>everUsed(ck,id))) clearUsed=true;

    // Category: Global Entry
    CARDS[ck].sections.forEach(sec=>{
      sec.benefits.forEach(b=>{ if(b.id.endsWith('_ge')&&everUsed(ck,b.id)) geUsed=true; });
    });

    // Category: lounge
    if(everUsed(ck,'uc_club')) loungeUsed=true;

    // Category: travel cards
    if(travelBenefitIds.some(id=>everUsed(ck,id))) travelCardCount++;

    // Category: hotel cards
    if(hotelBenefitIds.some(id=>everUsed(ck,id))) hotelCardCount++;

    // Airline cards
    if(airlineBenefitIds.some(id=>everUsed(ck,id))){ anyAirlineUsed=true; airlineCardCount++; }

    // Uber/DD ever used + total count
    if(['g_uber','p_uber'].some(id=>everUsed(ck,id))) uberEverUsed=true;
    if(['c_dd_restaurant','c_dd_nonrest1','c_dd_nonrest2'].some(id=>everUsed(ck,id))) ddEverUsed=true;
    if(everUsed(ck,'c_lyft')) lyftUsed=true;
    const d=state.DATA[ck]||{};
    Object.entries(d).forEach(([k,v])=>{
      if(!v) return;
      if(k.startsWith('g_uber__')||k.startsWith('p_uber__')) uberTotalUses++;
      if(k.startsWith('c_dd_restaurant__')||k.startsWith('c_dd_nonrest1__')||k.startsWith('c_dd_nonrest2__')) ddTotalUses++;
    });

    // Wellness types
    if(everUsed(ck,'p_equinox')) wellnessTypes.add('equinox');
    if(everUsed(ck,'p_lulu'))    wellnessTypes.add('lulu');
    if(everUsed(ck,'c_peloton')) wellnessTypes.add('peloton');
    if(everUsed(ck,'p_oura'))    wellnessTypes.add('oura');

    // Dining types
    if(everUsed(ck,'g_dining'))   diningTypes.add('g_dining');
    if(everUsed(ck,'g_resy'))     diningTypes.add('g_resy');
    if(everUsed(ck,'p_resy'))     diningTypes.add('p_resy');
    if(everUsed(ck,'c_dining'))   diningTypes.add('c_dining');
    if(everUsed(ck,'amb_dining')) diningTypes.add('amb_dining');
  });

  const day=new Date().getDate();
  const now=Date.now();
  const earned=[...prev];
  function maybe(id,cond){ if(cond&&!prev.has(id)){ earned.push(id); if(!s.earnedAt[id]) s.earnedAt[id]=now; } }

  // Streaks
  maybe('streak_3',          maxStreak>=3);
  maybe('streak_6',          maxStreak>=6);
  maybe('streak_12',         maxStreak>=12);
  maybe('streak_18',         maxStreak>=18);
  maybe('streak_24',         maxStreak>=24);

  // Portfolio size
  maybe('collector',         cardKeys.length>=3);
  maybe('portfolio_pro',     cardKeys.length>=5);
  maybe('card_shark',        cardKeys.length>=7);
  maybe('whale',             cardKeys.length>=10);

  // Single-card capture
  maybe('big_win',           anyBigWin);
  maybe('high_roller',       maxSingleCard>=1500);
  maybe('elite_earner',      maxSingleCard>=2000);

  // Portfolio capture
  maybe('getting_started',   totalCaptured>=100);
  maybe('gaining_ground',    totalCaptured>=500);
  maybe('high_achiever',     totalCaptured>=1000);
  maybe('power_user',        totalCaptured>=2500);
  maybe('maximizer',         totalCaptured>=5000);
  maybe('true_maximizer',    totalCaptured>=10000);

  // Fee mastery
  maybe('first_profit',      anyProfit);
  maybe('double_dipper',     profitCount>=2);
  maybe('triple_threat',     profitCount>=3);
  maybe('fee_crusher',       allProfit&&cardKeys.length>=2);

  // Card mastery
  maybe('gold_master',       goldProfit);
  maybe('plat_master',       platProfit);
  maybe('csr_master',        csrProfit);

  // Claim volume
  maybe('benefit_ninja',     totalClaims>=25);
  maybe('benefit_machine',   totalClaims>=50);
  maybe('century',           totalClaims>=100);

  // Completionist
  maybe('grand_slam',        allCurrentClaimed&&cardKeys.length>0);
  maybe('early_bird',        allCurrentClaimed&&day<15&&cardKeys.length>0);
  maybe('all_in',            perCardFullYear.length>0);
  maybe('perfectionist',     perCardFullYear.length>=2);
  maybe('all_in_2',          perCardFullYear.length>=cardKeys.length&&cardKeys.length>=2);

  // Category specialists
  maybe('uber_loyalist',     uberMaxStreak>=6);
  maybe('doordash_devotee',  ddMaxStreak>=6);
  maybe('dining_devotee',    diningMaxStreak>=6);
  maybe('fitness_fan',       fitnessUsed);
  maybe('clear_member',      clearUsed);
  maybe('global_traveler',   geUsed);
  maybe('hotel_hopper',      hotelCardCount>=2);
  maybe('lounge_lizard',     loungeUsed);
  maybe('jet_setter',        travelCardCount>=2);

  // Year-based
  maybe('yr_2024',           activeYears.has(2024));
  maybe('yr_2025',           activeYears.has(2025));
  maybe('yr_2026',           activeYears.has(2026));
  maybe('multi_year',        activeYears.size>=3);
  maybe('early_adopter',     activeYears.has(2024)||activeYears.has(2023));

  // Brand & bank loyalty
  maybe('amex_loyalist',     (issuerCounts['American Express']||0)>=3);
  maybe('chase_loyalist',    (issuerCounts['Chase']||0)>=3);
  maybe('cap1_loyalist',     (issuerCounts['Capital One']||0)>=1);
  maybe('citi_loyalist',     (issuerCounts['Citi']||0)>=1);
  maybe('wf_loyalist',       (issuerCounts['Wells Fargo']||0)>=1);
  maybe('multi_bank',        uniqueIssuers>=3);
  maybe('amex_trifecta',     ['platinum','gold','amex_green'].every(k=>cardKeys.includes(k)));
  maybe('chase_trifecta',    ['csr','chase_sapphire_pref'].every(k=>cardKeys.includes(k))&&(issuerCounts['Chase']||0)>=3);

  // Card-specific tracking
  maybe('hilton_devotee',    cardKeys.includes('amex_hilton_honors'));
  maybe('marriott_fan',      cardKeys.includes('amex_marriott_brill'));
  maybe('hyatt_explorer',    cardKeys.includes('chase_world_of_hyatt'));
  maybe('hotel_portfolio',   ['amex_hilton_honors','amex_marriott_brill','chase_world_of_hyatt'].every(k=>cardKeys.includes(k)));
  maybe('csp_holder',        cardKeys.includes('chase_sapphire_pref'));
  maybe('green_carrier',     cardKeys.includes('amex_green'));
  maybe('venture_x_holder',  cardKeys.includes('cap1_venture_x'));
  maybe('united_flyer',      cardKeys.includes('chase_united_quest')||cardKeys.includes('chase_united_club'));
  maybe('strata_holder',     cardKeys.includes('citi_strata_prem'));

  // Specific benefits — one-time use
  maybe('saks_shopper',      everUsed('platinum','p_saks'));
  maybe('lulu_fan',          everUsed('platinum','p_lulu'));
  maybe('oura_owner',        everUsed('platinum','p_oura'));
  maybe('uber_one_club',     everUsed('platinum','p_uberone'));
  maybe('equinox_devotee',   everUsed('platinum','p_equinox'));
  maybe('resy_regular',      everUsed('gold','g_resy')||everUsed('platinum','p_resy'));
  maybe('dec_bonus',         decBonus);

  // Specific benefits — streaks
  maybe('digital_devotee',   getLongestStreak('platinum','p_digital')>=6);
  maybe('dunkin_addict',     getLongestStreak('gold','g_dunkin')>=6);
  maybe('walmart_weekly',    getLongestStreak('platinum','p_walmart')>=6);
  maybe('peloton_rider',     getLongestStreak('csr','c_peloton')>=3);

  // Specific benefits — volume
  maybe('uber_vip',          uberTotalUses>=18);
  maybe('doordash_pro',      ddTotalUses>=12);

  // Wellness
  maybe('wellness_stack',    wellnessTypes.size>=2);
  maybe('full_wellness',     wellnessTypes.size>=4);

  // Travel combos
  maybe('clear_and_ge',      clearUsed&&geUsed);
  maybe('airport_royalty',   clearUsed&&geUsed&&loungeUsed);
  maybe('airline_insider',   airlineCardCount>=2);
  maybe('hotel_connoisseur', hotelCardCount>=3);
  maybe('first_class_combo', anyAirlineUsed&&hotelCardCount>=1);
  maybe('lounge_regular',    loungeUsed&&clearUsed);
  maybe('saks_both',         saksBoth);

  // Benefit combos
  maybe('food_combo',        uberEverUsed&&ddEverUsed);
  maybe('commuter_pack',     uberEverUsed&&lyftUsed);
  maybe('dining_trifecta',   diningTypes.size>=3);
  maybe('entertainment_bundle', everUsed('platinum','p_digital')&&everUsed('csr','c_peloton'));

  // Dollar milestones
  maybe('silver_bullet',     maxSingleCard>=750);
  maybe('gold_mine',         totalCaptured>=3000);
  maybe('platinum_tier',     totalCaptured>=7000);

  // Volume milestones
  maybe('claim_addict',      totalClaims>=150);
  maybe('claim_machine',     totalClaims>=300);

  // Misc
  maybe('new_year_start',    hasJanData);

  // CSR-specific
  maybe('stubhub_fan',       everUsed('csr','c_stub'));
  maybe('csr_traveler',      everUsed('csr','c_travel'));
  maybe('exclusive_tables',  everUsed('csr','c_dining'));
  maybe('apple_insider',     everUsed('csr','c_apple'));
  maybe('the_edit_guest',    everUsed('csr','c_edit1')||everUsed('csr','c_edit2'));
  maybe('lyft_rider',        getLongestStreak('csr','c_lyft')>=6);
  maybe('csr_month_sweep',   csrMonthFull);
  maybe('stub_season',       stubBoth);

  // Gold-specific
  maybe('gold_sweep',        goldMonthFull);
  maybe('dunkin_power',      getLongestStreak('gold','g_dunkin')>=12);

  // Platinum-specific
  maybe('plat_trifecta_month', platMonthFull);
  maybe('hotel_twice',       platHotelCount>=2);
  maybe('plat_mega',         platCaptured>=3000);

  // WF Premier-specific
  maybe('wf_airline_user',   wfAirlineUsed);
  maybe('wf_ge_user',        wfGeUsed);

  // Cross-card combos
  maybe('chase_amex_duo',    cardKeys.includes('csr')&&cardKeys.includes('platinum'));
  maybe('double_airline',    everUsed('platinum','p_airline')&&wfAirlineUsed);
  maybe('both_resy',         everUsed('gold','g_resy')&&everUsed('platinum','p_resy'));
  maybe('uber_double_month', uberDoubleMonth);
  maybe('four_kings',        ['csr','gold','platinum','wf_premier_autograph'].every(k=>cardKeys.includes(k)));

  // Perfect month — check each elapsed month of the current year
  let allPerfect=CM>=0;
  for(let m=0;m<=CM;m++){
    const mId=`perf_${CY}_${String(m+1).padStart(2,'0')}`;
    const pk=`${CY}-m${m}`;
    const p={calY:CY,calM:m,m};
    let perfect=cardKeys.length>0;
    outer: for(const ck of cardKeys){
      for(const sec of CARDS[ck].sections){
        if(sec.cadence!=='monthly') continue;
        for(const b of sec.benefits){
          if(isBExpired(b,p)||isBNotAvailable(b,CY,p)) continue;
          if(isGloballySnoozed(ck,b.id)||isMonthSnoozed(ck,b.id,CY,m)) continue;
          if(!isUsed(ck,b.id,pk)){perfect=false;break outer;}
        }
      }
    }
    maybe(mId,perfect);
    if(!perfect) allPerfect=false;
  }
  maybe(`perf_sweep_${CY}`,allPerfect&&CM>=0);

  // Meta — must come last, uses current earned count
  const earnedCount=earned.length;
  maybe('badge_20',  earnedCount>=20);
  maybe('badge_35',  earnedCount>=35);
  maybe('badge_50',  earnedCount>=50);
  maybe('badge_75',  earnedCount>=75);
  maybe('badge_100', earnedCount>=100);

  s.earned=earned;
  saveState(s);
  return earned.filter(id=>!prev.has(id));
}
