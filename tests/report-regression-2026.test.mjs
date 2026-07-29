// Regression tests against the real 2026 portfolio behind the generated PDF.
//
//   node --test 'tests/*.test.mjs'
//
// These pin the figures a reader actually saw, and lock in the four defects the
// 2026-07-28 report exhibited: points folded into "net value", AMEX Gold called
// Underutilized at 100% utilization, calendar-year credits marked Expired while
// their window ran to Dec 31, and two identically-named DoorDash credits.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATUS, ASSESSMENTS, buildPortfolioReport, windowPhase,
  generatePortfolioSummary, generateCardNarrative, generateRecommendations,
  disambiguateBenefitNames,
} from '../js/report-model.js';
import { REPORT_INPUT_2026, EXPECTED_2026, REPORT_DATE } from './fixtures/report-2026.mjs';

const report = buildPortfolioReport(REPORT_INPUT_2026);
const card = id => report.cardSummaries.find(c => c.cardId === id);
const benefitOn = (cardId, benefitId) => card(cardId).benefits.find(b => b.benefitId === benefitId);

// ── Portfolio totals ───────────────────────────────────────────────────────
test('portfolio headline figures match the generated report', () => {
  assert.equal(report.totalAnnualFees, EXPECTED_2026.totalAnnualFees);
  assert.equal(report.redeemedBenefitValue, EXPECTED_2026.redeemedBenefitValue);
  assert.equal(report.recordedPointsRedemptionValue, EXPECTED_2026.recordedPointsRedemptionValue);
  assert.equal(report.netBenefitValueAfterFees, EXPECTED_2026.netBenefitValueAfterFees);
  assert.equal(report.totalTrackedValueAfterFees, EXPECTED_2026.totalTrackedValueAfterFees);
});

test('benefit value and points value stay separate', () => {
  // The old report published $3,992.53 under the label "Net Value After Fees",
  // which silently included points. Both figures now exist under their own names.
  // Rounded because the raw JS arithmetic here drifts (3547.07 - 2110 is
  // 1437.0700000000002) — which is exactly what the model's r2() prevents.
  const round = n => Math.round(n * 100) / 100;
  assert.equal(
    report.netBenefitValueAfterFees,
    round(report.redeemedBenefitValue - report.totalAnnualFees));
  assert.equal(
    report.totalTrackedValueAfterFees,
    round(report.redeemedBenefitValue + report.recordedPointsRedemptionValue - report.totalAnnualFees));
  assert.notEqual(report.netBenefitValueAfterFees, report.totalTrackedValueAfterFees);
});

test('portfolio value identity holds: available = redeemed + expired + still claimable', () => {
  const round = n => Math.round(n * 100) / 100;
  assert.equal(round(report.totalAvailableValue),
    round(report.redeemedBenefitValue + report.totalMissedValue + report.totalRemainingAvailableValue));
});

test('card-level totals sum to the portfolio totals', () => {
  const round = n => Math.round(n * 100) / 100;
  const sum = k => round(report.cardSummaries.reduce((a, c) => a + c[k], 0));
  assert.equal(sum('annualFee'), report.totalAnnualFees);
  assert.equal(sum('usedValue'), report.redeemedBenefitValue);
  assert.equal(sum('recordedPointsRedemptionValue'), report.recordedPointsRedemptionValue);
  assert.equal(sum('netBenefitValueAfterFees'), report.netBenefitValueAfterFees);
  assert.equal(sum('totalTrackedValueAfterFees'), report.totalTrackedValueAfterFees);
});

// ── AMEX Gold status ───────────────────────────────────────────────────────
test('AMEX Gold is not labelled underutilized at 100% utilization', () => {
  const gold = card('gold');
  assert.equal(gold.utilizationRate, 1, 'every tracked Gold credit was claimed');
  assert.equal(gold.missedValue, 0);
  assert.equal(gold.usedValue, 289);
  assert.equal(gold.netBenefitValueAfterFees, -36);

  assert.notEqual(gold.assessment, ASSESSMENTS.UNDERUSED);
  assert.ok([ASSESSMENTS.BREAK_EVEN, ASSESSMENTS.REVIEW].includes(gold.assessment),
    `expected Near Break-Even or Review at Renewal, got "${gold.assessment}"`);
});

test('AMEX Gold narrative explains full usage and the $36 shortfall without inventing perks', () => {
  const n = generateCardNarrative(card('gold'));
  assert.match(n, /100%/);
  assert.match(n, /\$36 short of covering it/);
  assert.match(n, /No points redemptions were recorded/);
  assert.doesNotMatch(n, /lounge/i, 'AMEX Gold has no tracked lounge benefit');
  assert.doesNotMatch(n, /underutilis|underutiliz/i);
});

test('AMEX Gold recommendation asks about earn rate, not about using the card more', () => {
  const rec = generateRecommendations(report).find(r => /AMEX Gold/.test(r.title));
  assert.ok(rec, 'a card below break-even should surface a renewal review');
  assert.match(rec.detail, /claimed every tracked credit/);
  assert.match(rec.detail, /\$36/, 'names the actual gap');
  assert.match(rec.detail, /\bconsider\b/i, 'hedged, not definitive advice');
});

// ── Expired classification ─────────────────────────────────────────────────
test('no benefit whose window ends after the report date is labelled expired', () => {
  const offenders = report.cardSummaries.flatMap(c =>
    c.benefits.flatMap(b => b.instances
      .filter(i => (i.status === STATUS.EXPIRED_UNUSED || i.status === STATUS.EXPIRED_PARTIALLY_USED)
        && i.periodEnd && i.periodEnd > REPORT_DATE)
      .map(i => `${c.cardName} / ${b.benefitName} / ${i.periodLabel} ends ${i.periodEnd}`)));
  assert.deepEqual(offenders, [], 'a future expiry date can never accompany an Expired status');
});

test('the three calendar-year credits are still claimable, not expired', () => {
  for (const [cardId, benefitId, amount] of [
    ['csr', 'c_selecthotel', 250],
    ['csr', 'c_ge', 120],
    ['platinum', 'p_clear', 189],
  ]) {
    const b = benefitOn(cardId, benefitId);
    assert.equal(b.status, STATUS.UNUSED, `${b.benefitName} should be Available — Unused`);
    assert.equal(b.missedValue, 0, `${b.benefitName} must not count as missed value`);
    assert.equal(b.remainingValue, amount, `${b.benefitName} is still claimable in full`);
    assert.equal(b.instances[0].expirationDate, '2026-12-31');
  }
});

test('genuinely closed windows are still reported as missed', () => {
  // January's Lyft credit and Jan–Jun of the Walmart+ credit really did expire.
  const lyft = benefitOn('csr', 'c_lyft');
  assert.equal(lyft.missedValue, 10);
  assert.equal(lyft.periodsMissed, 1);

  const walmart = benefitOn('platinum', 'p_walmart');
  assert.equal(walmart.periodsMissed, 6);
  assert.equal(Math.round(walmart.missedValue * 100) / 100, 84.42);
});

test('fixing the expiry bug moves value from missed to still-claimable, not into thin air', () => {
  // $559 = Select Hotel 250 + Global Entry 120 + CLEAR Plus 189.
  assert.equal(report.totalRemainingAvailableValue >= 559, true);
  assert.equal(Math.round(report.totalMissedValue * 100) / 100, 94.42,
    'only the Lyft month and the Walmart+ months genuinely expired');
});

test('the date shown beside a status always belongs to that status\'s window', () => {
  // A semi-annual credit whose first half expired but whose second half is open
  // must not print "Expired" next to the second half's future end date.
  const offenders = report.cardSummaries.flatMap(c => c.benefits
    .filter(b => (b.status === STATUS.EXPIRED_UNUSED || b.status === STATUS.EXPIRED_PARTIALLY_USED)
      && b.statusExpiration && b.statusExpiration > REPORT_DATE)
    .map(b => `${c.cardName} / ${b.benefitName} shows ${b.statusExpiration}`));
  assert.deepEqual(offenders, []);

  const stillOpen = report.cardSummaries.flatMap(c => c.benefits
    .filter(b => b.status === STATUS.UNUSED && b.statusExpiration && b.statusExpiration < REPORT_DATE)
    .map(b => `${c.cardName} / ${b.benefitName} shows ${b.statusExpiration}`));
  assert.deepEqual(stillOpen, [], 'a claimable benefit never shows a past expiry');
});

test('window boundaries are inclusive at both ends', () => {
  assert.equal(windowPhase('2026-01-01', '2026-01-01', '2026-01-31'), 'open', 'start date is inside');
  assert.equal(windowPhase('2026-01-31', '2026-01-01', '2026-01-31'), 'open', 'end date is inside');
  assert.equal(windowPhase('2026-02-01', '2026-01-01', '2026-01-31'), 'after', 'day after is closed');
  assert.equal(windowPhase('2025-12-31', '2026-01-01', '2026-01-31'), 'before', 'day before has not opened');
  assert.equal(windowPhase('2026-07-28', null, null), 'open', 'an undated window is treated as claimable');
});

// ── Intentional exclusions ─────────────────────────────────────────────────
test('skipped and snoozed benefits are excluded and never become missed value', () => {
  const peloton = benefitOn('csr', 'c_peloton');
  assert.equal(peloton.status, STATUS.EXCLUDED);
  assert.equal(peloton.missedValue, 0);

  const edit = benefitOn('csr', 'c_edit1');
  assert.equal(edit.status, STATUS.SNOOZED, 'snoozed is distinguishable from skipped');
  assert.equal(edit.missedValue, 0);
  assert.equal(edit.availableValue, 0, 'excluded value leaves the utilization denominator');

  assert.equal(report.totalExcludedValue, 1290,
    'Peloton 70 + Edit H1/H2 500 + Platinum Hotel 600 + Platinum Global Entry 120');
});

test('no reminder is recommended for an intentionally excluded benefit', () => {
  const recs = generateRecommendations(report);
  const reminders = recs.filter(r => /Add a reminder/.test(r.title));
  reminders.forEach(r => {
    assert.doesNotMatch(r.title, /Peloton|The Edit|Hotel Credit/,
      'excluded benefits must never generate a nag');
  });
});

test('every benefit row reconciles: available = redeemed + expired + claimable', () => {
  // The per-benefit table showed Available / Used / Remaining but not Expired,
  // so a monthly credit with missed months looked like broken arithmetic
  // ($70 available, $30 used, $10 remaining). Any renderer must be able to
  // account for the whole of availableValue from the item's own fields.
  const round = n => Math.round(n * 100) / 100;
  const broken = [];
  report.cardSummaries.forEach(c => c.benefits.forEach(b => {
    const parts = round(b.usedValue + b.missedValue + b.remainingValue);
    if (parts !== round(b.availableValue)) {
      broken.push(`${c.cardName} / ${b.benefitName}: available ${b.availableValue} != ${parts}`);
    }
  }));
  assert.deepEqual(broken, []);
});

test('a partly-missed monthly credit exposes its expired value', () => {
  const lyft = benefitOn('csr', 'c_lyft');
  assert.equal(lyft.availableValue, 70);
  assert.equal(lyft.usedValue, 60);
  assert.equal(lyft.missedValue, 10, 'the January miss must be visible, not implied');
  assert.equal(lyft.remainingValue, 0);
  assert.equal(lyft.usedValue + lyft.missedValue + lyft.remainingValue, lyft.availableValue);
});

// ── Duplicate benefit names ────────────────────────────────────────────────
test('the two DoorDash grocery credits get distinguishing display labels', () => {
  const bs = disambiguateBenefitNames([
    { benefitName: 'DoorDash $10 Grocery Credit', description: '' },
    { benefitName: 'DoorDash $10 Grocery Credit', description: '' },
    { benefitName: 'Lyft Credit', description: 'Monthly in-app credit' },
  ]);
  assert.equal(bs[0].displayName, 'DoorDash $10 Grocery Credit — Benefit 1');
  assert.equal(bs[1].displayName, 'DoorDash $10 Grocery Credit — Benefit 2');
  assert.equal(bs[0].disambiguatedBy, 'sequence');
  assert.equal(bs[2].displayName, undefined, 'a unique name is left alone');
});

test('a real distinguishing description is preferred over a sequence number', () => {
  const bs = disambiguateBenefitNames([
    { benefitName: 'Hotel Credit', description: 'Available Jan–Jun only' },
    { benefitName: 'Hotel Credit', description: 'Available Jul–Dec only' },
  ]);
  assert.equal(bs[0].displayName, 'Hotel Credit — Available Jan–Jun only');
  assert.equal(bs[0].disambiguatedBy, 'description');
});

test('records are never merged when names collide', () => {
  const grocery = card('csr').benefits.filter(b => /Grocery Credit/.test(b.benefitName));
  assert.equal(grocery.length, 2, 'both credits survive as separate records');
  assert.equal(grocery[0].usedValue + grocery[1].usedValue, 140);
});

// ── Welcome bonus ──────────────────────────────────────────────────────────
test('first-year points value carries a non-recurrence caveat', () => {
  const wf = card('wf_premier_autograph');
  assert.equal(wf.isFirstYear, true);
  assert.equal(wf.recordedPointsRedemptionValue, 1063.68);
  const n = generateCardNarrative(wf);
  assert.match(n, /should not be assumed to recur/);
  // The card must not be presented as a normal recurring return on a $95 fee.
  assert.match(n, /Tracked statement credits produced \$170/);
  assert.match(n, /Recorded points redemptions added \$1,063\.68/);
});

test('points source is never inferred', () => {
  const wf = card('wf_premier_autograph');
  assert.equal(wf.pointsBreakdown.hasDeclaredSource, false);
  assert.equal(wf.pointsBreakdown.bySource.unknown, 1063.68);
  assert.equal(wf.pointsBreakdown.bySource['welcome-bonus'], undefined,
    'nothing is guessed from the data');
});

test('a declared welcome bonus is split out of recurring value', () => {
  const wf = { ...card('wf_premier_autograph') };
  wf.pointsBreakdown = { total: 1063.68, bySource: { 'welcome-bonus': 950, 'ongoing-spend': 113.68 },
    hasDeclaredSource: true, welcomeBonusValue: 950, ongoingValue: 113.68, undeclaredValue: 0 };
  const n = generateCardNarrative(wf);
  assert.match(n, /\$950 was a welcome bonus and will not recur/);
  assert.match(n, /\$113\.68 came from ongoing activity/);
  // 170 credits + 113.68 ongoing - 95 fee = 188.68
  assert.match(n, /recurring value alone the card returned \+\$188\.68/);
  assert.doesNotMatch(n, /should not be assumed to recur/,
    'once the source is declared the blanket caveat is replaced by real numbers');
});

test('an undeclared redemption keeps the non-recurrence caveat', () => {
  const n = generateCardNarrative(card('wf_premier_autograph'));
  assert.match(n, /should not be assumed to recur/);
  assert.match(n, /tag each redemption/i, 'points the user at where to fix it');
});

// ── Face vs personal value ─────────────────────────────────────────────────
test('with no overrides, personal value equals published face value', () => {
  assert.equal(report.hasPersonalOverrides, false);
  assert.equal(report.faceAvailableValue, report.totalAvailableValue);
  assert.equal(report.faceUsedValue, report.redeemedBenefitValue);
  assert.equal(report.faceNetBenefitValueAfterFees, report.netBenefitValueAfterFees);
});

// ── Consistency across sections ────────────────────────────────────────────
test('the same metric reads the same in the summary narrative and the totals', () => {
  const s = generatePortfolioSummary(report);
  assert.match(s, /\$3,547\.07/, 'redeemed benefit value');
  assert.match(s, /\$2,555\.46/, 'points redemption value');
  assert.match(s, /\$2,110/, 'annual fees');
  assert.match(s, /\$1,437\.07/, 'net benefit value after fees');
  assert.match(s, /\$3,992\.53/, 'total tracked value after fees');
  assert.doesNotMatch(s, /undefined|NaN/);
});

test('the summary states plainly that points are not benefit value', () => {
  const s = generatePortfolioSummary(report);
  assert.match(s, /different kind of value/);
  assert.match(s, /reported alongside benefit value, not inside it/);
});
