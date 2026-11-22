// CSR $75K-spend credits ($500 Southwest, $250 Shops at Chase): earned by
// prior-year spend the app can't see, so the user marks the unlock per year.
//
//   node --test 'tests/*.test.mjs'
//
// Guards:
//  - locked credits add no available / missed value
//  - once unlocked they count fully, including as missed if unused
//  - the unlock is per period (2027 doesn't unlock 2028)
//  - editing the card open date doesn't wipe the unlock

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
// Pin "now" to mid-2028 so the 2027 period is past (state.js reads the clock
// at import). Each test file runs in its own process, so this stays local.
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [2028, 5, 15])); }
  static now() { return new RealDate(2028, 5, 15).getTime(); }
};

let CARDS, state, calcStats, isCondLocked, isBNotAvailable, isUnlocked, setUnlocked, setCardOpenedDate;

before(async () => {
  ({ CARDS } = await import('../js/cards.js'));
  ({ state } = await import('../js/state.js'));
  ({ isUnlocked, setUnlocked, setCardOpenedDate } = await import('../js/storage.js'));
  ({ calcStats, isCondLocked, isBNotAvailable } = await import('../js/periods.js'));
});

const csr = id => CARDS.csr.sections.flatMap(s => s.benefits).find(b => b.id === id);
const PK = '2027-annual';
// One past (non-current) 2027 calendar-year period, so unused = missed.
const periods = c => (c === 'cal-annual' ? [{ m: 0, y: 2027, pk: PK, lbl: '2027', calM: 0, calY: 2027 }] : []);
const notCurrent = () => false;

function fresh() {
  store.clear();
  state.DATA = Object.fromEntries(Object.keys(CARDS).map(k => [k, {}]));
  state.cardMeta = {};
  state.selectedYear = 2027;
}

test('both credits exist, start 2027, and share the c_75k unlock', () => {
  for (const [id, amt] of [['c_75k_southwest', 500], ['c_75k_shops', 250]]) {
    const b = csr(id);
    assert.ok(b, id);
    assert.equal(b.amount, amt);
    assert.equal(b.unlock, 'c_75k');
    assert.equal(isBNotAvailable(b, 2026, { calY: 2026, calM: 0 }), true);
    assert.equal(isBNotAvailable(b, 2027, { calY: 2027, calM: 0 }), false);
  }
});

test('locked: no value, nothing missed', () => {
  fresh();
  assert.equal(isCondLocked('csr', csr('c_75k_southwest'), PK), true);
  const s = calcStats('csr', periods, notCurrent);
  assert.equal(s.total, 0);
  assert.equal(s.missed, 0);
});

test('unlocked: $750 available, and unused counts as missed', () => {
  fresh();
  setUnlocked('csr', 'c_75k', PK, true);
  assert.equal(isUnlocked('csr', 'c_75k', PK), true);
  assert.equal(isCondLocked('csr', csr('c_75k_shops'), PK), false);
  assert.equal(state.cardMeta.csr.unlocks[`c_75k__${PK}`], 'Jun 2028', 'records the month it was marked');
  const s = calcStats('csr', periods, notCurrent);
  assert.equal(s.total, 750);
  assert.equal(s.missed, 750);
  state.DATA.csr[`c_75k_southwest__${PK}`] = true;
  const s2 = calcStats('csr', periods, notCurrent);
  assert.equal(s2.captured, 500);
  assert.equal(s2.missed, 250);
});

test('unlock is per period and can be undone', () => {
  fresh();
  setUnlocked('csr', 'c_75k', PK, true);
  assert.equal(isUnlocked('csr', 'c_75k', '2028-annual'), false);
  setUnlocked('csr', 'c_75k', PK, false);
  assert.equal(isUnlocked('csr', 'c_75k', PK), false);
  assert.deepEqual(state.cardMeta, {});
});

test('changing the open date keeps the unlock (and vice versa)', () => {
  fresh();
  setCardOpenedDate('csr', 2020, 3);
  setUnlocked('csr', 'c_75k', PK, true);
  setCardOpenedDate('csr', 2021, 5);
  assert.equal(isUnlocked('csr', 'c_75k', PK), true);
  assert.equal(state.cardMeta.csr.openedYear, 2021);
  setCardOpenedDate('csr', null);
  assert.equal(isUnlocked('csr', 'c_75k', PK), true);
  assert.equal(state.cardMeta.csr.openedYear, undefined);
});
