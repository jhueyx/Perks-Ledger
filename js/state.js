import { CARDS, CARD_LABELS, FEE_MONTHS } from './cards.js';

export const NOW = new Date();
export const CY = NOW.getFullYear();
export const CM = NOW.getMonth();
export const CD = NOW.getDate();
export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const STORAGE_KEY = 'card-benefits-tracker-v1';
export const SUPABASE_URL = 'https://rsbvddlhismetljqoqre.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_uLJlvYnd-7MiGHMK9SEaww_JwIBveov';
// supabase is a global provided by the CDN script loaded before this module
export const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

export function freshDATA(){ return Object.fromEntries(Object.keys(CARDS).map(k=>[k,{}])); }
export function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;'); }
export const FEE_DATES = Object.fromEntries(Object.keys(CARDS).map(k=>[k,{month:CARDS[k].feeMonth??0,day:CARDS[k].feeDay??1}]));

export const state = {
  DATA: freshDATA(),
  currentUser: null,
  userCards: null,
  activeCard: 'csr',
  activeView: 'all-cards',
  activePrimary: 'all-cards',
  activeSecondary: { 'card-year': 'history', 'ytd': 'ytd-history' },
  selectedYear: CY,
  saveTimer: null,
  _sessionHandled: false,
  _authTab: 'login',
  _collapsedSections: new Set(['cal-semi-annual','semi-annual','feb-annual','cal-annual','annual']),
  _collapsedCurrentSections: new Set(['semi-annual','cal-semi-annual','feb-annual','cal-annual','annual'].flatMap(c=>['csr','gold','platinum'].map(k=>`current-${k}-${c}`))),
  _userExpandedSections: new Set(),
  _cpSelected: new Set(),
  _mcSelected: new Set(),
  _undoStack: null,
  _undoTimer: null,
  _noteCtx: {},
  redemptionDates: {},
  _feeDateEditCard: null,
  cardMeta: {},
  _periodOffset: 0,
  _feeOverrides: null,
  touchStartX: 0,
  touchStartY: 0,
  ptrStartY: 0,
  ptrActive: false,
  dragSrc: null,
};
