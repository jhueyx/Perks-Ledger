// Regression fixture: the real 2026 portfolio behind the "2026 Credit Card
// Benefits Review" PDF generated on 2026-07-28.
//
// Reconstructed from that report's own per-benefit tables, so the portfolio
// totals it produces are the ones a reader actually saw:
//   redeemed benefit value            $3,547.07
//   recorded points redemption value  $2,555.46
//   total annual fees                 $2,110.00
//   net benefit value after fees      $1,437.07
//   total tracked value after fees    $3,992.53
//
// The fixture is expressed in the report model's own input shape rather than in
// app storage keys, so it exercises the calculation and narrative layers without
// depending on the browser or on cards.js staying frozen.

export const REPORT_DATE = '2026-07-28';

const pad = n => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Calendar-month windows for Jan..Jul 2026 (the elapsed part of the year). */
function monthly(amount, usedMonths, months = 7, opts = {}) {
  return Array.from({ length: months }, (_, i) => ({
    periodKey: `2026-m${i}`,
    periodLabel: MONTHS[i],
    sortKey: 2026 * 12 + i,
    amount,
    used: usedMonths.includes(i),
    periodStart: `2026-${pad(i + 1)}-01`,
    periodEnd: `2026-${pad(i + 1)}-${pad(lastDay(2026, i))}`,
    reportDate: REPORT_DATE,
    ...opts,
  }));
}

/** A single window, e.g. a calendar-year or half-year credit. */
function period(periodKey, periodLabel, amount, start, end, over = {}) {
  return {
    periodKey, periodLabel, amount,
    sortKey: Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1,
    periodStart: start, periodEnd: end, reportDate: REPORT_DATE,
    used: false, partialUsed: 0,
    ...over,
  };
}

const calYear = (key, label, amount, over) =>
  period(key, label, amount, '2026-01-01', '2026-12-31', over);

function benefit(benefitId, benefitName, category, frequency, instances, over = {}) {
  return { benefitId, benefitName, category, frequency, instances, ...over };
}

export const CARDS_2026 = [
  {
    cardId: 'csr',
    cardName: 'Chase Sapphire Reserve',
    annualFee: 795,
    renewalDate: 'May 1, 2027',
    pointsRedeemed: 705.17,
    benefits: [
      benefit('c_dd_restaurant', 'DoorDash Restaurant Credit', 'dining', 'monthly',
        monthly(5, [0, 1, 2, 3, 4, 5, 6])),
      // Two genuinely separate $10 grocery credits — same published name.
      benefit('c_dd_nonrest1', 'DoorDash $10 Grocery Credit', 'shopping', 'monthly',
        monthly(10, [0, 1, 2, 3, 4, 5, 6])),
      benefit('c_dd_nonrest2', 'DoorDash $10 Grocery Credit', 'shopping', 'monthly',
        monthly(10, [0, 1, 2, 3, 4, 5, 6])),
      // Jan unclaimed, Feb–Jul claimed.
      benefit('c_lyft', 'Lyft Credit', 'travel', 'monthly',
        monthly(10, [1, 2, 3, 4, 5, 6])),
      benefit('c_peloton', 'Peloton Credit', 'fitness', 'monthly',
        monthly(10, [], 7, { isExcluded: true, excludeReason: 'Marked skipped' })),
      benefit('c_dining', 'Exclusive Tables Dining Credit', 'dining', 'cal-semi-annual', [
        period('2026-h0', 'H1 (Jan–Jun 2026)', 150, '2026-01-01', '2026-06-30', { used: true }),
        period('2026-h1', 'H2 (Jul–Dec 2026)', 150, '2026-07-01', '2026-12-31', { used: true }),
      ]),
      benefit('c_stub', 'StubHub / Viagogo Credit', 'entertainment', 'cal-semi-annual', [
        period('2026-h0', 'H1 (Jan–Jun 2026)', 150, '2026-01-01', '2026-06-30', { used: true }),
        period('2026-h1', 'H2 (Jul–Dec 2026)', 150, '2026-07-01', '2026-12-31', { used: true }),
      ]),
      benefit('c_edit1', 'The Edit Hotel Credit (H1)', 'travel', 'cal-semi-annual', [
        period('2026-h0', 'H1 (Jan–Jun 2026)', 250, '2026-01-01', '2026-06-30',
          { isExcluded: true, excludeReason: 'Snoozed for this period', isSnoozed: true }),
      ]),
      benefit('c_edit2', 'The Edit Hotel Credit (H2)', 'travel', 'cal-semi-annual', [
        period('2026-h1', 'H2 (Jul–Dec 2026)', 250, '2026-07-01', '2026-12-31',
          { isExcluded: true, excludeReason: 'Snoozed for this period', isSnoozed: true }),
      ]),
      // The three that the old model wrongly called Expired — windows run to Dec 31.
      benefit('c_selecthotel', 'Select Hotel Credit (2026 only)', 'travel', 'cal-annual',
        [calYear('2026-annual', '2026', 250)]),
      benefit('c_ge', 'Global Entry / TSA PreCheck / NEXUS', 'travel', 'cal-annual',
        [calYear('2026-annual', '2026', 120)]),
      benefit('c_apple', 'Apple TV+ & Apple Music', 'entertainment', 'cal-annual',
        [calYear('2026-annual', '2026', 288, { used: true })]),
      benefit('c_travel', 'Travel Credit', 'travel', 'feb-annual',
        [period('feb-2026', 'Feb 2026–Jan 2027', 300, '2026-02-01', '2027-01-31', { used: true })]),
    ],
  },
  {
    cardId: 'gold',
    cardName: 'AMEX Gold',
    annualFee: 325,
    renewalDate: 'May 24, 2027',
    pointsRedeemed: 0,
    benefits: [
      benefit('g_dining', 'Dining Credit', 'dining', 'monthly', monthly(10, [0, 1, 2, 3, 4, 5, 6])),
      benefit('g_uber', 'Uber Cash', 'dining', 'monthly', monthly(10, [0, 1, 2, 3, 4, 5, 6])),
      benefit('g_dunkin', "Dunkin' Credit", 'dining', 'monthly', monthly(7, [0, 1, 2, 3, 4, 5, 6])),
      benefit('g_resy', 'Resy Dining Credit', 'dining', 'cal-semi-annual', [
        period('2026-h0', 'H1 (Jan–Jun 2026)', 50, '2026-01-01', '2026-06-30', { used: true }),
        period('2026-h1', 'H2 (Jul–Dec 2026)', 50, '2026-07-01', '2026-12-31', { used: true }),
      ]),
    ],
  },
  {
    cardId: 'platinum',
    cardName: 'AMEX Platinum',
    annualFee: 895,
    renewalDate: 'Sep 17, 2026',
    openedLabel: 'Jan 2025',
    pointsRedeemed: 786.61,
    benefits: [
      benefit('p_uber', 'Uber Cash', 'travel', 'monthly', monthly(15, [0, 1, 2, 3, 4, 5, 6])),
      benefit('p_digital', 'Digital Entertainment', 'entertainment', 'monthly',
        monthly(25, [0, 1, 2, 3, 4, 5, 6])),
      // Jan–Jun unclaimed, July claimed.
      benefit('p_walmart', 'Walmart+ Credit', 'shopping', 'monthly', monthly(14.07, [6])),
      benefit('p_resy', 'Resy Dining Credit', 'dining', 'quarterly', [
        period('2026-q0', 'Q1', 100, '2026-01-01', '2026-03-31', { used: true }),
        period('2026-q1', 'Q2', 100, '2026-04-01', '2026-06-30', { used: true }),
        period('2026-q2', 'Q3', 100, '2026-07-01', '2026-09-30', { used: true }),
      ]),
      benefit('p_lulu', 'Lululemon Credit', 'shopping', 'quarterly', [
        period('2026-q0', 'Q1', 75, '2026-01-01', '2026-03-31', { used: true }),
        period('2026-q1', 'Q2', 75, '2026-04-01', '2026-06-30', { used: true }),
        period('2026-q2', 'Q3', 75, '2026-07-01', '2026-09-30', { used: true }),
      ]),
      benefit('p_saks', 'Saks Fifth Avenue', 'shopping', 'cal-semi-annual', [
        period('2026-h1', 'H2 (Jul–Dec 2026)', 50, '2026-07-01', '2026-12-31', { used: true }),
      ]),
      benefit('p_hotel', 'Hotel Credit', 'travel', 'cal-semi-annual', [
        period('2026-h0', 'H1 (Jan–Jun 2026)', 300, '2026-01-01', '2026-06-30',
          { isExcluded: true, isSnoozed: true, excludeReason: 'Snoozed for this period' }),
        period('2026-h1', 'H2 (Jul–Dec 2026)', 300, '2026-07-01', '2026-12-31',
          { isExcluded: true, isSnoozed: true, excludeReason: 'Snoozed for this period' }),
      ]),
      benefit('p_uberone', 'Uber One Membership Credit', 'travel', 'cal-annual',
        [calYear('2026-annual', '2026', 96, { used: true })]),
      benefit('p_airline', 'Airline Fee Credit', 'travel', 'cal-annual',
        [calYear('2026-annual', '2026', 200, { used: true })]),
      benefit('p_ge', 'Global Entry / TSA PreCheck', 'travel', 'cal-annual',
        [calYear('2026-annual', '2026', 120, { isExcluded: true, excludeReason: 'Marked skipped' })]),
      // Window runs to Dec 31 — must not read as Expired on Jul 28.
      benefit('p_clear', 'CLEAR Plus Credit', 'travel', 'cal-annual',
        [calYear('2026-annual', '2026', 189)]),
      benefit('p_equinox', 'Equinox Credit', 'fitness', 'cal-annual',
        [calYear('2026-annual', '2026', 300, { used: true })]),
      benefit('p_oura', 'Oura Ring Credit', 'fitness', 'cal-annual',
        [calYear('2026-annual', '2026', 200, { used: true })]),
    ],
  },
  {
    cardId: 'wf_premier_autograph',
    cardName: 'WF Premier Autograph',
    annualFee: 95,
    renewalDate: 'Jun 1, 2027',
    openedLabel: 'May 2026',
    isFirstYear: true,
    pointsRedeemed: 1063.68,
    pointsBreakdown: { total: 1063.68, bySource: { unknown: 1063.68 }, hasDeclaredSource: false },
    benefits: [
      benefit('wfpa_ge', 'Global Entry / TSA PreCheck', 'travel', 'cal-annual',
        [calYear('2026-annual', '2026', 120, { used: true })]),
      benefit('wfpa_airline', 'Airline Credit', 'travel', 'cal-annual',
        [calYear('2026-annual', '2026', 50, { used: true })]),
    ],
  },
];

export const REPORT_INPUT_2026 = {
  title: '2026 Credit Card Benefits Review',
  periodLabel: '2026 year to date',
  periodStart: 'January 1, 2026',
  periodEnd: 'July 2026 (in progress)',
  generatedAt: '2026-07-28T18:31:00.000Z',
  isPartialPeriod: true,
  cards: CARDS_2026,
  options: { groupBy: 'card', includeUnused: true, includeExpired: true, includeUpcoming: true },
};

/** The figures a reader of the PDF saw, and which must not silently move. */
export const EXPECTED_2026 = {
  totalAnnualFees: 2110,
  redeemedBenefitValue: 3547.07,
  recordedPointsRedemptionValue: 2555.46,
  netBenefitValueAfterFees: 1437.07,
  totalTrackedValueAfterFees: 3992.53,
};
