// Regression: between the 1st of a card's fee month and its fee day, today sits
// just past the 12 card-year months (Oct 1 with an Oct 14 renewal → card year
// is Oct 2025–Sep 2026). getCurrentPK used to fall back to the last period in
// that window, so the This Period view showed Q3's already-claimed quarterly
// credits as the current quarter.
//
// CY/CM are fixed at module load, so the clock is pinned before importing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const RealDate = Date;
const FIXED = new RealDate(2026, 9, 1, 9, 0).getTime(); // Oct 1 2026, local
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [FIXED])); }
  static now() { return FIXED; }
};
globalThis.supabase = { createClient: () => ({ auth: {}, from: () => ({}) }) };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { addEventListener() {}, dispatchEvent() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
globalThis.CustomEvent = class {};

const { state } = await import('../js/state.js');
const { getCurrentPK, getCurrentLabel } = await import('../js/periods.js');
state._feeOverrides = { platinum: { feeMonth: 9, feeDay: 14 } };

test('quarterly current period is the calendar quarter before the renewal day', () => {
  assert.equal(getCurrentPK('platinum', 'quarterly'), '2026-q3');
  assert.equal(getCurrentLabel('platinum', 'quarterly'), 'Q4');
});

test('monthly and calendar-half current periods are today’s', () => {
  assert.equal(getCurrentPK('platinum', 'monthly'), '2026-m9');
  assert.equal(getCurrentPK('platinum', 'cal-semi-annual'), '2026-h1');
});
