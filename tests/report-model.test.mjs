// Unit tests for the Detailed Report calculation + narrative model.
//
//   node --test 'tests/*.test.mjs'
//
// report-model.js is deliberately dependency-free (no DOM, no localStorage, no
// period math), so the whole status / missed-value ruleset can be exercised
// here with hand-built snapshots.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATUS, ASSESSMENTS, buildPortfolioReport, classifyInstance, assessCard,
  r2, fmtMoney, fmtSignedMoney, fmtPct, pluralize, joinList,
  generatePortfolioSummary, generateCardNarrative, generateUsagePatternNarrative,
  generateMissedValueNarrative, generateOpportunityNarrative, generateRecommendations,
  generateMethodology,
} from '../js/report-model.js';

// ── Fixture builders ───────────────────────────────────────────────────────
let seq = 0;

// Every fixture is dated relative to this, because window open/closed is now
// decided purely from periodStart/periodEnd vs reportDate.
export const REPORT_DATE = '2026-07-28';
const CLOSED = { periodStart: '2026-01-01', periodEnd: '2026-01-31' };   // ended
const OPEN = { periodStart: '2026-07-01', periodEnd: '2026-07-31' };     // in progress
const FUTURE = { periodStart: '2026-11-01', periodEnd: '2026-11-30' };   // not started

/** One benefit-period slice. Defaults to "window closed, nothing used". */
function inst(over = {}) {
  return {
    periodKey: `p${seq++}`, periodLabel: 'Jan', sortKey: 0, amount: 100,
    used: false, partialUsed: 0,
    ...CLOSED, reportDate: REPORT_DATE,
    ...over,
  };
}

function benefit(over = {}) {
  return {
    benefitId: `b${seq++}`, benefitName: 'Test Credit', category: 'travel',
    frequency: 'cal-annual', instances: [inst()],
    ...over,
  };
}

function card(over = {}) {
  return {
    cardId: `c${seq++}`, cardName: 'Test Card', annualFee: 100,
    pointsRedeemed: 0, benefits: [benefit()],
    ...over,
  };
}

function report(cards, options = {}) {
  return buildPortfolioReport({
    title: '2026 Credit Card Benefits Review',
    periodLabel: '2026', periodStart: 'January 1, 2026', periodEnd: 'December 31, 2026',
    generatedAt: '2026-07-28T00:00:00.000Z',
    cards, options: { groupBy: 'card', ...options },
  });
}

const onlyBenefit = rep => rep.cardSummaries[0].benefits[0];

/** Twelve monthly slices; `usedMonths` are fully used, `openFrom` stays current. */
function monthlyInstances({ amount = 10, usedMonths = [], monthsElapsed = 12, year = 2026 } = {}) {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = n => String(n).padStart(2, '0');
  const lastDay = m => new Date(year, m + 1, 0).getDate();
  // Real calendar month windows. Against a July 28 report date this makes
  // Jan–Jun closed, July open, and Aug onward not yet started — no flags.
  return M.slice(0, monthsElapsed).map((label, i) => inst({
    periodKey: `${year}-m${i}`, periodLabel: label, sortKey: year * 12 + i, amount,
    used: usedMonths.includes(i),
    periodStart: `${year}-${pad(i + 1)}-01`,
    periodEnd: `${year}-${pad(i + 1)}-${pad(lastDay(i))}`,
  }));
}

// ══════════════════════════════════════════════════════════════════════════
// Instance classification
// ══════════════════════════════════════════════════════════════════════════
test('fully used benefit counts entirely as realized value', () => {
  const rep = report([card({ benefits: [benefit({ instances: [inst({ amount: 300, used: true })] })] })]);
  const b = onlyBenefit(rep);
  assert.equal(b.status, STATUS.FULLY_USED);
  assert.equal(b.usedValue, 300);
  assert.equal(b.missedValue, 0);
  assert.equal(b.remainingValue, 0);
  assert.equal(b.utilizationRate, 1);
});

test('partially used benefit in an open window splits realized vs remaining, never missed', () => {
  const rep = report([card({ benefits: [benefit({ instances: [inst({ amount: 120, partialUsed: 70, ...OPEN })] })] })]);
  const b = onlyBenefit(rep);
  assert.equal(b.status, STATUS.PARTIALLY_USED);
  assert.equal(b.usedValue, 70);
  assert.equal(b.remainingValue, 50);
  assert.equal(b.missedValue, 0, 'an open window can never produce missed value');
});

test('partially used benefit in a closed window forfeits the shortfall', () => {
  const rep = report([card({ benefits: [benefit({ instances: [inst({ amount: 120, partialUsed: 70, ...CLOSED })] })] })]);
  const b = onlyBenefit(rep);
  assert.equal(b.status, STATUS.EXPIRED_PARTIALLY_USED);
  assert.equal(b.usedValue, 70);
  assert.equal(b.missedValue, 50);
  assert.equal(b.remainingValue, 0);
});

test('unused benefit whose window closed is missed value', () => {
  const rep = report([card({ benefits: [benefit({ instances: [inst({ amount: 50 })] })] })]);
  const b = onlyBenefit(rep);
  assert.equal(b.status, STATUS.EXPIRED_UNUSED);
  assert.equal(b.missedValue, 50);
  assert.equal(rep.totalMissedValue, 50);
});

test('unused benefit that has not expired is a remaining opportunity, not a miss', () => {
  const rep = report([card({ benefits: [benefit({ instances: [inst({ amount: 75, ...OPEN })] })] })]);
  const b = onlyBenefit(rep);
  assert.equal(b.status, STATUS.UNUSED);
  assert.equal(b.remainingValue, 75);
  assert.equal(b.missedValue, 0);
  assert.equal(rep.totalMissedValue, 0);
  assert.equal(rep.totalRemainingAvailableValue, 75);
});

test('future benefit is upcoming and excluded from available value and missed value', () => {
  const rep = report([card({ benefits: [benefit({ instances: [inst({ amount: 250, ...FUTURE })] })] })]);
  const b = onlyBenefit(rep);
  assert.equal(b.status, STATUS.NOT_YET_AVAILABLE);
  assert.equal(b.availableValue, 0, 'future value is not yet "available"');
  assert.equal(b.upcomingValue, 250);
  assert.equal(rep.totalMissedValue, 0);
  assert.equal(rep.utilizationRate, 0);
});

test('benefit not yet offered is excluded from every total', () => {
  const rep = report([card({ benefits: [benefit({ instances: [inst({ amount: 250, isNotYetAvailable: true })] })] })]);
  const b = onlyBenefit(rep);
  assert.equal(b.status, STATUS.NOT_YET_AVAILABLE);
  assert.equal(b.availableValue, 0);
  assert.equal(b.upcomingValue, 0);
  assert.equal(b.missedValue, 0);
});

test('skipped or snoozed benefit is excluded, not counted as unused', () => {
  const rep = report([card({
    benefits: [benefit({ instances: [inst({ amount: 200, isExcluded: true, excludeReason: 'Marked skipped' })] })],
  })]);
  const b = onlyBenefit(rep);
  assert.equal(b.status, STATUS.EXCLUDED);
  assert.equal(b.availableValue, 0, 'excluded value leaves the utilization denominator');
  assert.equal(b.missedValue, 0);
  assert.equal(b.excludedValue, 200);
  assert.equal(rep.totalExcludedValue, 200);
});

test('missing usage information is classified unknown rather than assumed unused', () => {
  const rep = report([card({
    benefits: [benefit({ instances: [inst({ amount: 0 })] })],
  })]);
  const b = onlyBenefit(rep);
  assert.equal(b.status, STATUS.UNKNOWN);
  assert.equal(b.missedValue, 0);
  assert.equal(rep.totalAvailableValue, 0);
});

test('non-monetary benefit marked used still reads as fully used', () => {
  const rep = report([card({ benefits: [benefit({ instances: [inst({ amount: 0, used: true })] })] })]);
  assert.equal(onlyBenefit(rep).status, STATUS.FULLY_USED);
});

test('negative or over-face partial amounts are clamped', () => {
  const neg = classifyInstance(inst({ amount: 100, partialUsed: -40 }));
  assert.equal(neg.usedValue, 0);
  assert.equal(neg.missedValue, 100);

  const over = classifyInstance(inst({ amount: 100, partialUsed: 250 }));
  assert.equal(over.usedValue, 100);
  assert.equal(over.missedValue, 0);
  assert.equal(over.status, STATUS.FULLY_USED);
});

test('a benefit used across multiple transactions sums to one period value', () => {
  // Partial tracking stores a running total, so the model must never add the
  // face value on top of it.
  const rep = report([card({ benefits: [benefit({ instances: [inst({ amount: 300, partialUsed: 300 })] })] })]);
  const b = onlyBenefit(rep);
  assert.equal(b.usedValue, 300);
  assert.equal(b.availableValue, 300);
});

// ══════════════════════════════════════════════════════════════════════════
// Cadences
// ══════════════════════════════════════════════════════════════════════════
test('monthly credit with multiple missed months counts each month once', () => {
  const rep = report([card({
    annualFee: 0,
    benefits: [benefit({
      benefitName: 'Monthly Dining Credit', frequency: 'monthly',
      instances: monthlyInstances({ year: 2025, amount: 10, usedMonths: [0, 1, 2, 3, 4, 5, 6] }),
    })],
  })]);
  const b = onlyBenefit(rep);
  assert.equal(b.availableValue, 120, '12 months x $10, no double counting');
  assert.equal(b.usedValue, 70);
  assert.equal(b.missedValue, 50);
  assert.equal(b.periodsUsed, 7);
  assert.equal(b.periodsMissed, 5);
  assert.equal(b.status, STATUS.EXPIRED_PARTIALLY_USED);
  assert.equal(rep.repeatOffenders.length, 1, 'missed in >1 period => repeat offender');
});

test('monthly credit with the current month still open reports remaining, not missed', () => {
  const rep = report([card({
    annualFee: 0,
    benefits: [benefit({
      frequency: 'monthly',
      instances: monthlyInstances({ amount: 10, usedMonths: [0, 1], monthsElapsed: 7 }),
    })],
  })]);
  const b = onlyBenefit(rep);
  assert.equal(b.availableValue, 70, 'Jan–Jul only; Aug onward has not started');
  assert.equal(b.usedValue, 20, 'Jan + Feb claimed');
  assert.equal(b.missedValue, 40, 'Mar–Jun closed unused…');
  assert.equal(b.remainingValue, 10, '…and July is still open, so still claimable');
  assert.equal(b.status, STATUS.PARTIALLY_USED);
  assert.equal(b.availableValue, b.usedValue + b.missedValue + b.remainingValue);
});

test('quarterly credit tracks per-quarter status', () => {
  const rep = report([card({
    annualFee: 0,
    benefits: [benefit({
      benefitName: 'Quarterly Resy Credit', frequency: 'quarterly',
      instances: [
        inst({ periodLabel: 'Q1', sortKey: 1, amount: 100, used: true }),
        inst({ periodLabel: 'Q2', sortKey: 2, amount: 100, partialUsed: 40 }),
        inst({ periodLabel: 'Q3', sortKey: 3, amount: 100, ...OPEN }),
        inst({ periodLabel: 'Q4', sortKey: 4, amount: 100, ...FUTURE }),
      ],
    })],
  })]);
  const b = onlyBenefit(rep);
  assert.equal(b.availableValue, 300, 'Q4 is future, so not yet available');
  assert.equal(b.usedValue, 140);
  assert.equal(b.missedValue, 60);
  assert.equal(b.remainingValue, 100);
  assert.equal(b.upcomingValue, 100);
  assert.deepEqual(b.instances.map(i => i.status), [
    STATUS.FULLY_USED, STATUS.EXPIRED_PARTIALLY_USED, STATUS.UNUSED, STATUS.NOT_YET_AVAILABLE,
  ]);
});

test('semi-annual credit reports the closed half as missed and the open half as remaining', () => {
  const rep = report([card({
    annualFee: 0,
    benefits: [benefit({
      benefitName: 'Saks Credit', frequency: 'cal-semi-annual',
      instances: [
        inst({ periodLabel: 'Jan–Jun', sortKey: 1, amount: 50, periodStart: '2026-01-01', periodEnd: '2026-06-30' }),
        inst({ periodLabel: 'Jul–Dec', sortKey: 2, amount: 50, periodStart: '2026-07-01', periodEnd: '2026-12-31' }),
      ],
    })],
  })]);
  const b = onlyBenefit(rep);
  assert.equal(b.missedValue, 50);
  assert.equal(b.remainingValue, 50);
  assert.equal(b.status, STATUS.EXPIRED_UNUSED, 'nothing used yet, and value was already forfeited');
  assert.equal(b.nextExpiration, '2026-12-31');
});

test('anniversary-year and Feb–Jan cadences roll up like any other single-period benefit', () => {
  const rep = report([card({
    annualFee: 0,
    benefits: [
      benefit({ benefitName: 'Travel Credit', frequency: 'feb-annual', instances: [inst({ amount: 300, used: true })] }),
      benefit({ benefitName: 'Anniversary Miles', frequency: 'annual', instances: [inst({ amount: 100 })] }),
    ],
  })]);
  const c = rep.cardSummaries[0];
  assert.equal(c.availableValue, 400);
  assert.equal(c.usedValue, 300);
  assert.equal(c.missedValue, 100);
});

// ══════════════════════════════════════════════════════════════════════════
// Card ownership edges
// ══════════════════════════════════════════════════════════════════════════
test('card opened midyear does not count pre-ownership months as missed', () => {
  const all = monthlyInstances({ year: 2025, amount: 10, usedMonths: [6, 7, 8, 9, 10, 11] });
  all.slice(0, 6).forEach(i => { i.isOutsideCardOwnership = true; });
  const rep = report([card({ annualFee: 0, benefits: [benefit({ frequency: 'monthly', instances: all })] })]);
  const b = onlyBenefit(rep);
  assert.equal(b.availableValue, 60, 'only the months the card was held');
  assert.equal(b.usedValue, 60);
  assert.equal(b.missedValue, 0);
  assert.equal(b.status, STATUS.FULLY_USED);
  assert.equal(rep.cardSummaries[0].utilizationRate, 1);
});

test('card closed midyear does not count post-closure months as missed', () => {
  const all = monthlyInstances({ year: 2025, amount: 10, usedMonths: [0, 1, 2] });
  all.slice(3).forEach(i => { i.isOutsideCardOwnership = true; });
  const rep = report([card({ annualFee: 0, benefits: [benefit({ frequency: 'monthly', instances: all })] })]);
  const b = onlyBenefit(rep);
  assert.equal(b.availableValue, 30);
  assert.equal(b.missedValue, 0);
  assert.equal(b.status, STATUS.FULLY_USED);
});

// ══════════════════════════════════════════════════════════════════════════
// Estimates, rounding, aggregation
// ══════════════════════════════════════════════════════════════════════════
test('estimated benefit values are flagged and surface on the report', () => {
  const rep = report([card({
    benefits: [benefit({ instances: [inst({ amount: 40, used: true, isEstimated: true })] })],
  })]);
  assert.equal(onlyBenefit(rep).isEstimated, true);
  assert.equal(rep.hasEstimates, true);
  assert.equal(rep.cardSummaries[0].hasEstimates, true);
  assert.match(generatePortfolioSummary(rep), /your own estimates/);
});

test('repeated fractional amounts do not produce floating point drift', () => {
  const rep = report([card({
    annualFee: 0,
    benefits: [benefit({
      frequency: 'monthly',
      instances: Array.from({ length: 12 }, (_, i) => inst({ periodLabel: `M${i}`, sortKey: i, amount: 14.07, used: true })),
    })],
  })]);
  assert.equal(rep.totalUsedValue, 168.84);
  assert.equal(fmtMoney(rep.totalUsedValue), '$168.84');
  assert.equal(r2(0.1 + 0.2), 0.3);
});

test('card and portfolio totals aggregate consistently', () => {
  const rep = report([
    card({
      cardId: 'csr', cardName: 'Chase Sapphire Reserve', annualFee: 795, pointsRedeemed: 0,
      benefits: [
        benefit({ benefitName: 'Travel Credit', category: 'travel', instances: [inst({ amount: 300, used: true })] }),
        benefit({ benefitName: 'Dining Credit', category: 'dining', frequency: 'monthly', instances: monthlyInstances({ year: 2025, amount: 10, usedMonths: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }) }),
      ],
    }),
    card({
      cardId: 'plat', cardName: 'AMEX Platinum', annualFee: 895, pointsRedeemed: 50,
      benefits: [benefit({ benefitName: 'Saks Credit', category: 'shopping', instances: [inst({ amount: 100 })] })],
    }),
  ]);

  const csr = rep.cardSummaries[0], plat = rep.cardSummaries[1];
  assert.equal(csr.availableValue, 420);
  assert.equal(csr.usedValue, 410);
  assert.equal(csr.missedValue, 10);
  assert.equal(csr.netTrackedValue, 410 - 795);
  assert.equal(csr.breakEvenGap, 385);
  assert.equal(plat.netBenefitValueAfterFees, 0 - 895, 'benefit value only');
  assert.equal(plat.totalTrackedValueAfterFees, 0 + 50 - 895, 'points counted separately, on top');

  assert.equal(rep.totalAnnualFees, 1690);
  assert.equal(rep.totalAvailableValue, 520);
  assert.equal(rep.totalUsedValue, 410);
  assert.equal(rep.totalMissedValue, 110);
  assert.equal(rep.netBenefitValueAfterFees, 410 - 1690, 'credits vs fees, points excluded');
  assert.equal(rep.totalTrackedValueAfterFees, 410 + 50 - 1690, 'credits + points vs fees');
  assert.equal(rep.redeemedBenefitValue, 410);
  assert.equal(rep.recordedPointsRedemptionValue, 50);
  assert.equal(rep.cardCount, 2);

  // Sums must reconcile: available = used + missed + remaining.
  assert.equal(rep.totalAvailableValue,
    r2(rep.totalUsedValue + rep.totalMissedValue + rep.totalRemainingAvailableValue));

  assert.equal(rep.bestCard.cardId, 'csr');
  assert.equal(rep.worstCard.cardId, 'plat');

  const cats = Object.fromEntries(rep.usageByCategory.map(c => [c.category, c]));
  assert.equal(cats.travel.usedValue, 300);
  assert.equal(cats.dining.usedValue, 110);
  assert.equal(cats.shopping.missedValue, 100);
});

test('assessment ladder reflects net tracked value and utilization', () => {
  const base = { availableValue: 1000, usedValue: 500, upcomingValue: 0, utilizationRate: 0.5, missedValue: 0, annualFee: 100 };
  assert.equal(assessCard({ ...base, netBenefitValueAfterFees: 400 }), ASSESSMENTS.EXCELLENT);
  assert.equal(assessCard({ ...base, netBenefitValueAfterFees: 10 }), ASSESSMENTS.POSITIVE);
  assert.equal(assessCard({ ...base, netBenefitValueAfterFees: -5 }), ASSESSMENTS.BREAK_EVEN);
  assert.equal(assessCard({ ...base, netBenefitValueAfterFees: -60, utilizationRate: 0.3, missedValue: 400 }), ASSESSMENTS.UNDERUSED);
  assert.equal(assessCard({ ...base, netBenefitValueAfterFees: -60, utilizationRate: 0.8 }), ASSESSMENTS.REVIEW);
  assert.equal(assessCard({ ...base, annualFee: 0, netBenefitValueAfterFees: 500 }), ASSESSMENTS.EXCELLENT);
  assert.equal(assessCard({ availableValue: 0, usedValue: 0, upcomingValue: 0, utilizationRate: 0, missedValue: 0, annualFee: 0, netBenefitValueAfterFees: 0 }), ASSESSMENTS.NO_DATA);
});

test('missing annual fee is treated as zero rather than NaN', () => {
  const rep = report([card({ annualFee: undefined, benefits: [benefit({ instances: [inst({ amount: 100, used: true })] })] })]);
  const c = rep.cardSummaries[0];
  assert.equal(c.annualFee, 0);
  assert.equal(c.feeIsKnown, false);
  assert.equal(c.netBenefitValueAfterFees, 100);
  assert.equal(rep.totalAnnualFees, 0);
});

test('missing expiration date does not break the opportunity list', () => {
  const rep = report([card({ benefits: [benefit({ instances: [inst({ amount: 60, periodStart: null, periodEnd: null })] })] })]);
  assert.equal(onlyBenefit(rep).nextExpiration, null);
  assert.doesNotThrow(() => generateOpportunityNarrative(rep));
  assert.doesNotThrow(() => generateRecommendations(rep));
});

// ══════════════════════════════════════════════════════════════════════════
// Formatting helpers
// ══════════════════════════════════════════════════════════════════════════
test('money uses en-US conventions and drops empty cents', () => {
  assert.equal(fmtMoney(1240), '$1,240');
  assert.equal(fmtMoney(1240.5), '$1,240.50');
  assert.equal(fmtMoney(0), '$0');
  assert.equal(fmtSignedMoney(345), '+$345');
  assert.equal(fmtSignedMoney(-385), '−$385');
  assert.equal(fmtPct(0.7368), '74%');
  assert.equal(fmtPct(NaN), '0%');
});

test('grammar helpers pluralize and join correctly', () => {
  assert.equal(pluralize(1, 'benefit'), '1 benefit');
  assert.equal(pluralize(3, 'benefit'), '3 benefits');
  assert.equal(pluralize(1, 'card'), '1 card');
  assert.equal(joinList(['a']), 'a');
  assert.equal(joinList(['a', 'b']), 'a and b');
  assert.equal(joinList(['a', 'b', 'c']), 'a, b, and c');
  assert.equal(joinList([]), '');
});

// ══════════════════════════════════════════════════════════════════════════
// Narratives
// ══════════════════════════════════════════════════════════════════════════
test('portfolio summary names real cards and reconciles with the totals', () => {
  const rep = report([
    card({ cardId: 'csr', cardName: 'Chase Sapphire Reserve', annualFee: 795, benefits: [benefit({ instances: [inst({ amount: 500, used: true })] })] }),
    card({ cardId: 'plat', cardName: 'AMEX Platinum', annualFee: 895, benefits: [benefit({ instances: [inst({ amount: 400 })] })] }),
  ]);
  const s = generatePortfolioSummary(rep);
  assert.match(s, /\$900 in available benefits/);
  assert.match(s, /\$500 in value/);
  assert.match(s, /2 cards/);
  assert.match(s, /strongest-performing card was the Chase Sapphire Reserve/);
  assert.match(s, /AMEX Platinum had the highest amount of unused value/);
  assert.match(s, /\$1,190 short of the fees/, '$1,690 in fees less $500 realized');
  assert.match(s, /lounge access/, 'untracked-value caveat is always present');
  assert.doesNotMatch(s, /undefined|NaN|\$NaN/);
});

test('narratives handle the empty portfolio gracefully', () => {
  const rep = report([]);
  assert.match(generatePortfolioSummary(rep), /No cards were selected/);
  assert.match(generateUsagePatternNarrative(rep), /No benefit redemptions were recorded/);
  assert.match(generateMissedValueNarrative(rep), /Nothing expired unused/);
  assert.match(generateOpportunityNarrative(rep), /no benefits with a remaining balance/i);
  const recs = generateRecommendations(rep);
  assert.equal(recs.length, 1);
  assert.match(recs[0].title, /No action needed/);
  assert.ok(generateMethodology(rep).length >= 9);
});

test('narratives handle a fully-used portfolio without claiming misses', () => {
  const rep = report([card({ annualFee: 0, benefits: [benefit({ instances: [inst({ amount: 200, used: true })] })] })]);
  const s = generatePortfolioSummary(rep);
  assert.match(s, /No tracked benefit expired unused/);
  assert.doesNotMatch(s, /highest amount of unused value/);
  assert.match(generateMissedValueNarrative(rep), /Nothing expired unused/);
  assert.match(generateCardNarrative(rep.cardSummaries[0]), /no annual fee/);
});

test('card narrative never claims profit the numbers do not support', () => {
  const c = report([card({
    cardName: 'AMEX Platinum', annualFee: 895,
    benefits: [benefit({ instances: [inst({ amount: 300, used: true })] })],
  })]).cardSummaries[0];
  const n = generateCardNarrative(c);
  assert.match(n, /\$595 short of covering it/);
  assert.doesNotMatch(n, /net of \+/);
  assert.match(n, /Value not captured here/, 'untracked-value caveat is always present');
  assert.doesNotMatch(n, /lounge/i, 'never claims a lounge benefit the card may not have');
});

test('card narrative reports both wins and misses with correct grammar', () => {
  const c = report([card({
    cardName: 'Chase Sapphire Reserve', annualFee: 795,
    benefits: [
      benefit({ benefitName: 'Travel Credit', instances: [inst({ amount: 300, used: true })] }),
      benefit({ benefitName: 'Peloton Credit', instances: [inst({ amount: 35 })] }),
    ],
  })]).cardSummaries[0];
  const n = generateCardNarrative(c);
  assert.match(n, /You fully used the \$300 Travel Credit\./);
  assert.match(n, /1 benefit expired/, 'singular, not "1 benefits"');
  assert.match(n, /\$35 in potential value forfeited/);
});

test('missed-value narrative attributes share by card and flags repeat offenders', () => {
  const rep = report([card({
    cardName: 'AMEX Gold', annualFee: 325,
    benefits: [benefit({
      benefitName: 'Dunkin Credit', category: 'dining', frequency: 'monthly',
      instances: monthlyInstances({ year: 2025, amount: 7, usedMonths: [0] }),
    })],
  })]);
  const n = generateMissedValueNarrative(rep);
  assert.match(n, /You left \$77 in benefits unused/);
  assert.match(n, /100% of it \(\$77\) came from the AMEX Gold/);
  assert.match(n, /1 recurring credit was missed more than once/, 'singular verb agreement');
  assert.match(n, /Dunkin Credit \(11 periods\)/);
});

test('recommendations are specific, evidence-based, and hedged', () => {
  const rep = report([card({
    cardId: 'plat', cardName: 'AMEX Platinum', annualFee: 895,
    benefits: [
      benefit({ benefitName: 'Hotel Credit', instances: [inst({ amount: 300, ...OPEN, expirationDate: 'Dec 31, 2026' })] }),
      benefit({ benefitName: 'Digital Entertainment', category: 'entertainment', frequency: 'monthly', instances: monthlyInstances({ year: 2025, amount: 25, usedMonths: [0, 1] }) }),
    ],
  })]);
  const recs = generateRecommendations(rep);
  const titles = recs.map(r => r.title);

  assert.ok(titles.some(t => /Use the Hotel Credit before it resets/.test(t)));
  assert.ok(titles.some(t => /Add a reminder for the Digital Entertainment/.test(t)));
  assert.ok(titles.some(t => /Review the AMEX Platinum/.test(t)));

  const review = recs.find(r => /Review the AMEX Platinum/.test(r.title));
  assert.ok(review, 'a card below break-even should prompt a renewal review');
  assert.match(review.detail, /You used \d+% of its available credits/);
  assert.match(review.detail, /\b(consider|may|review)\b/i, 'hedged, not definitive advice');
  recs.forEach(r => assert.doesNotMatch(`${r.title} ${r.detail}`, /undefined|NaN/));
});

test('recommendations flag benefits whose tracked value may be inflated', () => {
  const rep = report([card({
    cardName: 'AMEX Platinum', annualFee: 895,
    benefits: [benefit({ benefitName: 'Equinox Credit', instances: [inst({ amount: 300 })] })],
  })]);
  const rec = generateRecommendations(rep).find(r => /Re-value the Equinox Credit/.test(r.title));
  assert.ok(rec, 'a $300 credit that went entirely unused should prompt a re-valuation');
  assert.match(rec.detail, /would not otherwise buy/);
});

test('methodology explains every classification rule the report relies on', () => {
  const m = generateMethodology(report([card()]));
  const headings = m.map(x => x.heading);
  ['Available value', 'Used value', 'Partial usage', 'Recurring credits', 'Missed value',
    'Still claimable', 'Benefit value vs points value', 'Face value vs personal value',
    'Card status', 'Excluded benefits', 'Annual fees', 'Points redemption sources',
    'Estimated values', 'What is excluded']
    .forEach(h => assert.ok(headings.includes(h), `methodology should cover "${h}"`));
  assert.match(m.find(x => x.heading === 'Missed value').body, /can never show a future expiry/);
  assert.match(m.find(x => x.heading === 'Still claimable').body, /never as missed/);
  assert.match(m.find(x => x.heading === 'Card status').body, /Utilization and break-even are assessed separately/);
});
