// Amex Platinum's Jan 2027 changes: the Hotel Credit becomes the Lodging
// Credit, and a conditional $250 Airbnb Experiences credit is added.
//
//   node --test 'tests/*.test.mjs'
//
// Guards three ways this went wrong before:
//  - the rename rewrote 2025/2026 history (and the report) to "Lodging Credit"
//  - the conditional $250 counted as guaranteed value / missed value
//  - a 2027 benefit was announced as available in 2026

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

let CARDS, state, bName, bDesc, calcStats, getYTDPeriods, isYTDCurrent, isBNotAvailable, isCondLocked;

before(async () => {
  ({ CARDS } = await import('../js/cards.js'));
  ({ state } = await import('../js/state.js'));
  ({ bName, bDesc } = await import('../js/storage.js'));
  ({ calcStats, getYTDPeriods, isYTDCurrent, isBNotAvailable, isCondLocked } = await import('../js/periods.js'));
});

const plat = id => CARDS.platinum.sections.flatMap(s => s.benefits).find(b => b.id === id);

function freshState(year) {
  store.clear();
  state.DATA = Object.fromEntries(Object.keys(CARDS).map(k => [k, {}]));
  state.selectedYear = year;
}

test('p_hotel keeps its pre-2027 name and description in earlier years', () => {
  store.clear();
  const b = plat('p_hotel');
  assert.equal(bName('platinum', b, 2025), 'Hotel Credit');
  assert.equal(bName('platinum', b, 2026), 'Hotel Credit');
  assert.equal(bName('platinum', b, 2027), 'Lodging Credit');
  assert.doesNotMatch(bDesc(b, 2026), /Airbnb/);
  assert.match(bDesc(b, 2027), /Airbnb Luxe/);
});

test('a custom name still wins over the era name', () => {
  store.clear();
  localStorage.setItem('perks-custom-names', JSON.stringify({ platinum__p_hotel: 'FHR' }));
  assert.equal(bName('platinum', plat('p_hotel'), 2026), 'FHR');
  store.clear();
});

test('Airbnb Experiences is not offered before 2027', () => {
  const b = plat('p_airbnb_exp');
  assert.equal(isBNotAvailable(b, 2026, { calY: 2026, calM: 11 }), true);
  assert.equal(isBNotAvailable(b, 2027, { calY: 2027, calM: 0 }), false);
});

test('Airbnb Experiences is excluded from 2026 Platinum value', () => {
  freshState(2026);
  const { total } = calcStats('platinum', c => getYTDPeriods(c), isYTDCurrent);
  freshState(2026);
  // Even a stray check-off in 2026 must not add it.
  const pk = getYTDPeriods('cal-annual')[0].pk;
  state.DATA.platinum[`p_airbnb_exp__${pk}`] = true;
  assert.equal(calcStats('platinum', c => getYTDPeriods(c), isYTDCurrent).total, total);
});

test('conditional $250 counts only once it is used', () => {
  freshState(2027);
  const b = plat('p_airbnb_exp');
  const pk = getYTDPeriods('cal-annual')[0].pk;
  assert.equal(isCondLocked('platinum', b, pk), true);

  const locked = calcStats('platinum', c => getYTDPeriods(c), isYTDCurrent);
  state.DATA.platinum[`p_airbnb_exp__${pk}`] = true;
  assert.equal(isCondLocked('platinum', b, pk), false);
  const unlocked = calcStats('platinum', c => getYTDPeriods(c), isYTDCurrent);

  assert.equal(unlocked.total - locked.total, 250, 'adds $250 of available value only when used');
  assert.equal(unlocked.captured - locked.captured, 250);
  assert.equal(unlocked.missed, locked.missed, 'never contributes missed value');
});
