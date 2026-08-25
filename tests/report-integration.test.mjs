// Integration tests for the report adapter (js/report.js).
//
//   node --test 'tests/*.test.mjs'
//
// These drive the real CARDS catalog and the real period math in periods.js,
// so they catch wiring breakage that the pure model tests cannot. The browser
// globals those modules touch at import time are stubbed below.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ── Browser stubs (must be installed before the modules are imported) ──────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
globalThis.supabase = { createClient: () => ({ from: () => ({}) }) };

let CARDS, state, CY, generateReport, reportToMarkdown, reportToCSV, scorecardToCSV,
  buildJSONBackup, getReportYears, calcStats, getYTDPeriods, isYTDCurrent, getFee, STATUS,
  normalizeCardSelection, r2;

before(async () => {
  ({ CARDS } = await import('../js/cards.js'));
  ({ state, CY } = await import('../js/state.js'));
  ({ calcStats, getYTDPeriods, isYTDCurrent, getFee } = await import('../js/periods.js'));
  ({ generateReport, reportToMarkdown, reportToCSV, scorecardToCSV, buildJSONBackup, getReportYears, STATUS,
    normalizeCardSelection } = await import('../js/report.js'));
  ({ r2 } = await import('../js/report-model.js'));
});

// A fully-elapsed year keeps every period closed, so results do not depend on
// what month the suite happens to run in.
const YEAR = () => CY - 1;
const CARD_KEYS = ['gold', 'csr'];

/** Mark the first N monthly periods of every monthly benefit on a card as used. */
function markMonthlyUsed(cardKey, months) {
  state.DATA[cardKey] = state.DATA[cardKey] || {};
  CARDS[cardKey].sections.filter(s => s.cadence === 'monthly').forEach(s => {
    s.benefits.forEach(b => months.forEach(m => { state.DATA[cardKey][`${b.id}__${YEAR()}-m${m}`] = true; }));
  });
}

function freshState() {
  store.clear();
  state.DATA = Object.fromEntries(Object.keys(CARDS).map(k => [k, {}]));
  state.userCards = [...CARD_KEYS];
  state.cardMeta = {};
  state._feeOverrides = null;
  state.selectedYear = CY;
}

function run(opts = {}) {
  return generateReport({ year: YEAR(), cardIds: CARD_KEYS, ...opts }, CARD_KEYS);
}

test('builds a complete report from live app state', () => {
  freshState();
  markMonthlyUsed('gold', [0, 1, 2, 3, 4, 5]);
  const rep = run();

  assert.equal(rep.cardCount, 2);
  assert.equal(rep.cardSummaries.map(c => c.cardId).join(','), 'gold,csr');
  assert.ok(rep.totalAvailableValue > 0, 'the real catalog should yield trackable value');
  assert.ok(rep.totalUsedValue > 0);
  assert.equal(rep.title, `${YEAR()} Credit Card Benefits Review`);
  assert.match(rep.periodStart, /^January 1, \d{4}$/);

  // Every narrative renders, and none leak placeholder junk.
  const text = [rep.narratives.summary, rep.narratives.usage, rep.narratives.missed,
    rep.narratives.opportunity, ...rep.cardSummaries.map(c => c.narrative),
    ...rep.recommendations.map(r => `${r.title} ${r.detail}`)].join(' ');
  assert.doesNotMatch(text, /undefined|NaN|\[object/);
  assert.ok(rep.methodology.length >= 9);
});

test('report totals reconcile: available = used + missed + remaining', () => {
  freshState();
  markMonthlyUsed('csr', [0, 2, 4, 6, 8, 10]);
  const rep = run();
  const round = n => Math.round(n * 100) / 100;

  rep.cardSummaries.forEach(c => {
    assert.equal(round(c.availableValue),
      round(c.usedValue + c.missedValue + c.remainingAvailableValue),
      `${c.cardName} should reconcile`);
  });
  assert.equal(round(rep.totalAvailableValue),
    round(rep.totalUsedValue + rep.totalMissedValue + rep.totalRemainingAvailableValue));
  assert.equal(round(rep.netTrackedValue),
    round(rep.totalUsedValue + rep.totalPointsRedeemed - rep.totalAnnualFees));
});

test('captured and available value agree with calcStats, the app-wide calculation', () => {
  // With no skips, snoozes, partial amounts or custom values in play, the
  // report must produce exactly the numbers the Annual Recap view shows.
  freshState();
  markMonthlyUsed('gold', [0, 1, 2]);
  markMonthlyUsed('csr', [5, 6, 7]);
  const rep = run();

  const saved = state.selectedYear;
  state.selectedYear = YEAR();
  try {
    CARD_KEYS.forEach(k => {
      const { captured, total } = calcStats(k, c => getYTDPeriods(c), isYTDCurrent);
      const c = rep.cardSummaries.find(x => x.cardId === k);
      assert.equal(Math.round(c.usedValue), Math.round(captured), `${k} captured`);
      assert.equal(Math.round(c.availableValue), Math.round(total), `${k} total`);
      assert.equal(c.annualFee, getFee(k, YEAR()), `${k} fee`);
    });
  } finally { state.selectedYear = saved; }
});

test('generating a report does not mutate the app\'s selected year', () => {
  freshState();
  state.selectedYear = CY;
  run();
  assert.equal(state.selectedYear, CY, 'selectedYear must be restored after the traversal');
});

test('skipped benefits are excluded rather than counted as missed', () => {
  freshState();
  const before = run();
  const monthly = CARDS.gold.sections.find(s => s.cadence === 'monthly').benefits[0];
  store.set('perks-skipped', JSON.stringify(
    Object.fromEntries(Array.from({ length: 12 }, (_, m) => [`gold__${monthly.id}__${YEAR()}-m${m}`, true]))));
  const after = run();

  assert.ok(after.totalExcludedValue > 0, 'skipped value is reported as excluded');
  assert.ok(after.totalMissedValue < before.totalMissedValue, 'and drops out of missed value');
  assert.ok(after.totalAvailableValue < before.totalAvailableValue, 'and out of the denominator');
  const b = after.cardSummaries.find(c => c.cardId === 'gold').benefits.find(x => x.benefitId === monthly.id);
  assert.equal(b.status, STATUS.EXCLUDED);
});

test('partial redemptions are credited instead of being written off entirely', () => {
  freshState();
  const monthly = CARDS.gold.sections.find(s => s.cadence === 'monthly').benefits[0];
  const before = run();
  store.set('perks-partial', JSON.stringify({ [`gold__${monthly.id}__${YEAR()}-m0`]: 4 }));
  const after = run();

  assert.equal(Math.round((after.totalUsedValue - before.totalUsedValue) * 100), 400);
  assert.equal(Math.round((before.totalMissedValue - after.totalMissedValue) * 100), 400);
  const b = after.cardSummaries.find(c => c.cardId === 'gold').benefits.find(x => x.benefitId === monthly.id);
  assert.equal(b.status, STATUS.EXPIRED_PARTIALLY_USED);
});

test('a card opened after the reporting period contributes no missed value', () => {
  freshState();
  state.cardMeta = { gold: { openedYear: CY + 5, openedMonth: 0 } };
  const rep = run();
  const gold = rep.cardSummaries.find(c => c.cardId === 'gold');
  assert.equal(gold.availableValue, 0);
  assert.equal(gold.missedValue, 0);
  assert.equal(gold.utilizationRate, 0);
  state.cardMeta = {};
});

test('custom amounts are used and flagged as estimates, and can be turned off', () => {
  freshState();
  const monthly = CARDS.gold.sections.find(s => s.cadence === 'monthly').benefits[0];
  store.set('perks-custom-amounts', JSON.stringify({ [`gold__${monthly.id}`]: 25 }));

  const on = run({ includeEstimated: true });
  assert.equal(on.hasEstimates, true);
  const bOn = on.cardSummaries.find(c => c.cardId === 'gold').benefits.find(x => x.benefitId === monthly.id);
  assert.equal(bOn.isEstimated, true);
  assert.equal(bOn.availableValue, 25 * bOn.instances.filter(i => i.availableValue > 0).length);

  const off = run({ includeEstimated: false });
  assert.equal(off.hasEstimates, false);
  assert.ok(off.totalAvailableValue < on.totalAvailableValue);
});

test('points redemptions are summed and reported separately from benefit value', () => {
  // Regression: pointsBreakdownFor() used r2() without importing it, which threw
  // only once a card actually had points recorded — no fixture had any.
  freshState();
  markMonthlyUsed('gold', [0, 1, 2]);
  store.set('perks-points-redeemed', JSON.stringify({
    csr: { [`${YEAR()}-3`]: 400.5, [`${YEAR()}-7`]: 100.25 },
  }));
  const rep = run();
  const csr = rep.cardSummaries.find(c => c.cardId === 'csr');
  assert.equal(csr.recordedPointsRedemptionValue, 500.75);
  assert.equal(csr.pointsBreakdown.total, 500.75);
  assert.equal(csr.pointsBreakdown.bySource.unknown, 500.75, 'source is never inferred');
  assert.equal(csr.pointsBreakdown.hasDeclaredSource, false);
  assert.equal(rep.recordedPointsRedemptionValue, 500.75);
  // Points must not leak into benefit value.
  assert.equal(csr.netBenefitValueAfterFees, r2(csr.usedValue - csr.annualFee));
  assert.equal(csr.totalTrackedValueAfterFees, r2(csr.usedValue + 500.75 - csr.annualFee));
});

test('selecting a single card scopes the whole report', () => {
  freshState();
  const rep = generateReport({ year: YEAR(), cardIds: ['csr'] }, CARD_KEYS);
  assert.equal(rep.cardCount, 1);
  assert.equal(rep.cardSummaries[0].cardId, 'csr');
  assert.ok(rep.usageByCard.every(c => c.cardId === 'csr'));
});

test('an empty card selection still produces a valid, honest report', () => {
  freshState();
  const rep = generateReport({ year: YEAR(), cardIds: [] }, []);
  assert.equal(rep.cardCount, 0);
  assert.equal(rep.totalAvailableValue, 0);
  assert.equal(rep.netTrackedValue, 0);
  assert.match(rep.narratives.summary, /No cards were selected/);
  assert.doesNotThrow(() => reportToMarkdown(rep));
});

test('a full card selection is stored as "all", so cards added later are included', () => {
  const held = ['csr', 'gold', 'platinum'];
  // Every card selected => null, i.e. follow the live card list.
  assert.equal(normalizeCardSelection(held, held), null);
  assert.equal(normalizeCardSelection(null, held), null);
  assert.equal(normalizeCardSelection([], held), null);

  // A card added in Settings afterwards is picked up automatically.
  const saved = normalizeCardSelection(held, held);
  const nowHeld = [...held, 'cap1_venture_x'];
  assert.deepEqual(normalizeCardSelection(saved, nowHeld) || nowHeld, nowHeld);

  // An explicit subset is respected, and a new card stays out until chosen.
  assert.deepEqual(normalizeCardSelection(['csr'], nowHeld), ['csr']);

  // Keys for cards no longer held are dropped; an empty result falls back to all.
  assert.deepEqual(normalizeCardSelection(['csr', 'amex_green'], nowHeld), ['csr']);
  assert.equal(normalizeCardSelection(['amex_green'], nowHeld), null);
});

test('reporting-period years are offered newest first and never in the future', () => {
  freshState();
  state.DATA.gold[`g_dining__${CY - 2}-m3`] = true;
  const years = getReportYears();
  assert.ok(years.includes(CY) && years.includes(CY - 1) && years.includes(CY - 2));
  assert.deepEqual(years, [...years].sort((a, b) => b - a));
  assert.ok(years.every(y => y <= CY), 'never offer a future reporting period');
});

// ── Serializers ───────────────────────────────────────────────────────────
test('markdown export contains every required report section', () => {
  freshState();
  markMonthlyUsed('gold', [0, 1, 2]);
  const md = reportToMarkdown(run());
  ['# ', '## Executive Summary', '## Portfolio Scorecard', '## Card-by-Card Review',
    '## Used Benefits', '## Missed and Unused Benefits', '## Expiration and Upcoming Opportunities',
    '## Annual Fee Analysis', '## Recommendations', '## Methodology and Assumptions']
    .forEach(h => assert.ok(md.includes(h), `markdown should include "${h}"`));
  assert.doesNotMatch(md, /undefined|NaN/);
});

test('optional sections can be switched off', () => {
  freshState();
  const md = reportToMarkdown(run({ includeFeeAnalysis: false, includeRecommendations: false, includeActivity: false }));
  assert.ok(!md.includes('## Annual Fee Analysis'));
  assert.ok(!md.includes('## Recommendations'));
  assert.ok(!md.includes('#### Benefit activity'));
  assert.ok(md.includes('## Executive Summary'), 'core sections always render');
});

test('CSV exports are well-formed and quote embedded commas', () => {
  freshState();
  markMonthlyUsed('csr', [0, 1]);
  const rep = run();

  const scorecard = scorecardToCSV(rep).split('\n');
  assert.match(scorecard[0], /^Card,Annual Fee,/);
  assert.equal(scorecard.length, rep.cardSummaries.length + 2, 'header + one row per card + total');
  assert.match(scorecard[scorecard.length - 1], /^TOTAL,/);

  const raw = reportToCSV(rep).split('\n');
  assert.match(raw[0], /^Card,Annual Fee,Benefit,/);
  const expectedRows = rep.cardSummaries.reduce((a, c) =>
    a + c.benefits.reduce((n, b) => n + b.instances.length, 0), 0);
  assert.equal(raw.length, expectedRows + 1);
  // Every data row must have the same column count as the header.
  const cols = s => (s.match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g) || []).length + 1;
  raw.slice(1).forEach((r, i) => assert.equal(cols(r), cols(raw[0]), `row ${i} column count`));
});

test('JSON backup covers every store the app syncs to the cloud', () => {
  // The backup silently omitted the new points-source tags, so tagging a
  // welcome bonus and then restoring would have lost it. storage.js's cloud
  // payload is the definition of "all my data"; the backup must not fall behind.
  freshState();
  const storageSrc = readFileSync(new URL('../js/storage.js', import.meta.url), 'utf8');
  // `let` since the flush path rebases onto a newer remote row; match either
  // binding, and fail loudly rather than silently slicing if neither is found.
  const at = storageSrc.search(/(?:const|let) payload=\{\.\.\.state\.DATA,/);
  assert.notEqual(at, -1, 'could not locate the cloud payload literal in storage.js');
  const payload = storageSrc.slice(at);
  const synced = [...payload.slice(0, payload.indexOf('};')).matchAll(/_([A-Za-z]+):/g)]
    .map(m => m[1]).filter(k => k !== 'cardOrder');
  const backup = buildJSONBackup(run()).raw;
  const backupKeys = Object.keys(backup).map(k => k.toLowerCase());
  const missing = synced.filter(k => !backupKeys.includes(k.toLowerCase()));
  assert.deepEqual(missing, [], 'every synced store should appear in the JSON backup');
  assert.ok(synced.includes('pointsSources'), 'sanity: the check is reading the real payload');
});

test('JSON backup carries both the raw records and the computed report', () => {
  freshState();
  markMonthlyUsed('gold', [0]);
  const backup = JSON.parse(JSON.stringify(buildJSONBackup(run())));
  assert.equal(backup.app, 'Perks Ledger');
  assert.equal(backup.schema, 1);
  ['benefitData', 'customAmounts', 'partial', 'notes', 'skipped', 'snoozed', 'cardMeta', 'pointsRedeemed']
    .forEach(k => assert.ok(k in backup.raw, `backup.raw should include ${k}`));
  assert.equal(backup.raw.benefitData.gold[`g_dining__${YEAR()}-m0`], true);
  assert.ok(backup.report.cardSummaries.length === 2);
  assert.ok(backup.report.cardSummaries[0].narrative.length > 0);
});
