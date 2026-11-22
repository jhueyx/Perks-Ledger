// DEV-190: a partly used credit must count what was used as captured and only
// the unused remainder as missed — not $0 captured / full amount missed.
//
//   node --test 'tests/*.test.mjs'

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
globalThis.supabase = { createClient: () => ({ from: () => ({}) }) };
globalThis.document = { getElementById: () => null, dispatchEvent: () => {} };
// Pin "now" to mid-2028 so the 2027 quarter below is in the past.
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [2028, 5, 15])); }
  static now() { return new RealDate(2028, 5, 15).getTime(); }
};

let CARDS, state, calcStats, capturedAmt, setPartialUsed;

before(async () => {
  ({ CARDS } = await import('../js/cards.js'));
  ({ state } = await import('../js/state.js'));
  ({ setPartialUsed } = await import('../js/storage.js'));
  ({ calcStats, capturedAmt } = await import('../js/periods.js'));
});

const PK = '2027-q0';
// Only Platinum's quarterly section, one past quarter: Resy $100 + lululemon $75.
const periods = c => (c === 'quarterly' ? [{ m: 0, y: 2027, pk: PK, lbl: 'Q1', calM: 0, calY: 2027 }] : []);
const notCurrent = () => false;
const resy = () => CARDS.platinum.sections.flatMap(s => s.benefits).find(b => b.id === 'p_resy');

function fresh() {
  store.clear();
  state.DATA = Object.fromEntries(Object.keys(CARDS).map(k => [k, {}]));
  state.cardMeta = {};
  state.selectedYear = 2027;
}

test('nothing used: all missed', () => {
  fresh();
  const s = calcStats('platinum', periods, notCurrent);
  assert.equal(s.total, 175);
  assert.equal(s.captured, 0);
  assert.equal(s.missed, 175);
});

test('$60 of $100 Resy: $60 captured, only $40 of it missed', () => {
  fresh();
  setPartialUsed('platinum', 'p_resy', PK, 60);
  assert.equal(capturedAmt('platinum', resy(), PK, 100), 60);
  const s = calcStats('platinum', periods, notCurrent);
  assert.equal(s.captured, 60);
  assert.equal(s.missed, 40 + 75, 'Resy remainder + unused lululemon');
});

test('checked off in full still counts the full amount', () => {
  fresh();
  state.DATA.platinum[`p_resy__${PK}`] = true;
  const s = calcStats('platinum', periods, notCurrent);
  assert.equal(s.captured, 100);
  assert.equal(s.missed, 75);
});

test('a partial amount above the cap is capped', () => {
  fresh();
  assert.equal(capturedAmt('platinum', { ...resy() }, PK, 100), 0);
  store.set('perks-partial', JSON.stringify({ [`platinum__p_resy__${PK}`]: 150 }));
  assert.equal(capturedAmt('platinum', resy(), PK, 100), 100);
});

test('non-partial benefits ignore stray partial values', () => {
  fresh();
  const b = { id: 'x', amount: 50 };
  store.set('perks-partial', JSON.stringify({ [`platinum__x__${PK}`]: 20 }));
  assert.equal(capturedAmt('platinum', b, PK, 50), 0);
});
