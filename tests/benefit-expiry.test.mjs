// Benefit end dates: does the data encode what the copy promises?
//
//   node --test 'tests/*.test.mjs'
//
// Five benefits stated an end date in their description text and encoded
// nothing. isBExpired() returns false when `expiresAfter` is absent, so the
// engine kept them alive indefinitely — $406 of value that no longer exists
// would have shown up across 2027, inflating projections, the break-even
// chart and the keep/cancel verdict, silently and in the optimistic direction.
//
// These read the real catalog so the copy and the data cannot drift again.

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
// badges.js pulls in views.js, which touches these at module scope.
globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {} };
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };

let CARDS, isBExpired, expiryLastMonth, badges;

before(async () => {
  ({ CARDS } = await import('../js/cards.js'));
  ({ isBExpired, expiryLastMonth } = await import('../js/periods.js'));
  badges = await import('../js/badges.js');
});

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function everyBenefit() {
  const out = [];
  for (const [cardKey, card] of Object.entries(CARDS)) {
    for (const s of card.sections || []) {
      for (const b of s.benefits || []) out.push({ cardKey, cadence: s.cadence, b });
    }
  }
  return out;
}

// Pull an end date out of user-facing copy: "through Sep 2027", "Ends Jun
// 2026", "2026 only".
function statedEnd(text) {
  const t = String(text || '');
  let m = /(?:through|ends?|until)\s+([A-Za-z]{3})[a-z]*\.?\s+(20\d\d)/i.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3));
    if (mi >= 0) return { y: Number(m[2]), m: mi };
  }
  m = /(?:through|ends?|until)\s+(20\d\d)/i.exec(t);
  if (m) return { y: Number(m[1]), m: 11 };
  m = /\b(20\d\d)\s+only\b/i.exec(t);
  if (m) return { y: Number(m[1]), m: 11 };
  return null;
}

test('every benefit whose copy names an end date actually encodes it', () => {
  const drifted = [];
  for (const { b } of everyBenefit()) {
    const said = statedEnd(`${b.name} ${b.desc}`);
    if (!said) continue;
    const got = expiryLastMonth(b);
    if (!got) { drifted.push(`${b.id}: copy says ${said.y}-${said.m + 1}, encodes nothing`); continue; }
    if (got.y !== said.y || got.m !== said.m) {
      drifted.push(`${b.id}: copy says ${said.y}-${said.m + 1}, encodes ${got.y}-${got.m + 1}`);
    }
  }
  assert.deepEqual(drifted, [], 'benefit copy and expiry data disagree');
});

test('the five that were adrift are now pinned', () => {
  const expected = {
    c_selecthotel: { y: 2026, m: 11 },
    csp_apple:     { y: 2026, m: 11 },
    c_apple:       { y: 2027, m: 5 },
    c_lyft:        { y: 2027, m: 8 },
    csp_dashpass:  { y: 2027, m: 11 },
  };
  const byId = Object.fromEntries(everyBenefit().map(({ b }) => [b.id, b]));
  for (const [id, want] of Object.entries(expected)) {
    assert.ok(byId[id], `${id} should still exist in the catalog`);
    assert.deepEqual(expiryLastMonth(byId[id]), want, `${id} expiry`);
  }
});

test('month-granular expiry ends in the month named, not the half', () => {
  // The old {y,h} form could only say June or December, so "through Sep"
  // had to round — costing or inventing a quarter of a year.
  const sep2027 = { expiresAfter: { y: 2027, m: 8 } };
  assert.equal(isBExpired(sep2027, { calY: 2027, calM: 8 }), false, 'September itself is still live');
  assert.equal(isBExpired(sep2027, { calY: 2027, calM: 9 }), true, 'October is past it');
});

test('the half-year form still works, so existing data is unaffected', () => {
  const jun2026 = { expiresAfter: { y: 2026, h: 0 } };
  assert.equal(isBExpired(jun2026, { calY: 2026, calM: 5 }), false, 'June is the last live month');
  assert.equal(isBExpired(jun2026, { calY: 2026, calM: 6 }), true);
  const dec2026 = { expiresAfter: { y: 2026, h: 1 } };
  assert.equal(isBExpired(dec2026, { calY: 2026, calM: 11 }), false);
  assert.equal(isBExpired(dec2026, { calY: 2027, calM: 0 }), true);
});

test('a benefit with no end date never expires', () => {
  assert.equal(isBExpired({ id: 'x' }, { calY: 2099, calM: 11 }), false);
});

test('expired benefits actually drop out of a later calendar year', () => {
  // The end-to-end version of the bug: a 2026-only credit must not appear
  // in 2027.
  const byId = Object.fromEntries(everyBenefit().map(({ b }) => [b.id, b]));
  const jan2027 = { calY: 2027, calM: 0 };
  assert.equal(isBExpired(byId.c_selecthotel, jan2027), true, 'Select Hotel was 2026 only');
  assert.equal(isBExpired(byId.csp_apple, jan2027), true, 'CSP Apple TV+ ended Dec 2026');
  assert.equal(isBExpired(byId.csp_dashpass, jan2027), false, 'DashPass runs through 2027');
  assert.equal(isBExpired(byId.csp_dashpass, { calY: 2028, calM: 0 }), true, 'and stops in 2028');
});

test('a year badge exists for every year the ledger can track', () => {
  // The hardcoded list stopped at 2026, so come January no year badge could
  // unlock. And activeYears was capped at 2030, which would have silently
  // stopped counting years entirely.
  const { BADGE_DEFS, TRACKED_YEARS, TRACKING_LAST_YEAR } = badges;
  const ids = new Set(BADGE_DEFS.map(d => d.id));
  const thisYear = new Date().getFullYear();
  for (const y of [thisYear, thisYear + 1, thisYear + 5]) {
    assert.ok(TRACKED_YEARS.includes(y), `${y} should be a tracked year`);
    assert.ok(ids.has(`yr_${y}`), `missing yr_${y} badge`);
  }
  // Derived from the clock, so it is ahead of the calendar by construction --
  // this catches it being pinned back to a literal.
  assert.ok(TRACKING_LAST_YEAR >= thisYear + 5, 'upper bound should stay ahead of the calendar');
});

test('year badges carry a name, a tier and a description like every other badge', () => {
  const { BADGE_DEFS, TRACKED_YEARS } = badges;
  const tiers = new Set(['bronze', 'silver', 'gold', 'platinum', 'legendary']);
  for (const y of TRACKED_YEARS.slice(0, 4)) {
    const d = BADGE_DEFS.find(x => x.id === `yr_${y}`);
    assert.ok(d.name && d.desc, `yr_${y} should be presentable`);
    assert.ok(tiers.has(d.tier), `yr_${y} has an unknown tier: ${d.tier}`);
    assert.match(d.desc, new RegExp(String(y)), `yr_${y} description should name the year`);
  }
});

test('badge ids are unique', () => {
  const ids = badges.BADGE_DEFS.map(d => d.id);
  assert.equal(new Set(ids).size, ids.length, 'generated year badges must not collide with hand-written ones');
});
