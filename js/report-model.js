// ── Perks Ledger — normalized report model ────────────────────────────────
// Pure calculation + narrative layer for the Detailed Report export.
//
// This module deliberately knows nothing about the DOM, localStorage, Supabase
// or the app's period math. It consumes a plain "report input" snapshot (built
// by report.js from the live app state) and produces a PortfolioReport plus the
// deterministic narrative strings rendered by report-view.js.
//
// Keeping it dependency-free is what lets the whole status/missed-value
// ruleset be unit tested under `node --test` — see tests/report-model.test.mjs.

// ── Status vocabulary ──────────────────────────────────────────────────────
export const STATUS = {
  FULLY_USED: 'fully-used',
  PARTIALLY_USED: 'partially-used',
  UNUSED: 'unused',
  EXPIRED_UNUSED: 'expired-unused',
  EXPIRED_PARTIALLY_USED: 'expired-partially-used',
  UPCOMING: 'upcoming',
  NOT_YET_AVAILABLE: 'not-yet-available',
  EXCLUDED: 'excluded',
  SNOOZED: 'snoozed',
  NOT_ELIGIBLE: 'not-eligible',
  UNKNOWN: 'unknown',
};

export const STATUS_LABELS = {
  [STATUS.FULLY_USED]: 'Fully Used',
  [STATUS.PARTIALLY_USED]: 'Partially Used — Still Available',
  [STATUS.UNUSED]: 'Available — Unused',
  [STATUS.EXPIRED_UNUSED]: 'Expired — Unused',
  [STATUS.EXPIRED_PARTIALLY_USED]: 'Expired — Partially Used',
  [STATUS.UPCOMING]: 'Not Yet Available',
  [STATUS.NOT_YET_AVAILABLE]: 'Not Yet Available',
  [STATUS.EXCLUDED]: 'Intentionally Excluded',
  [STATUS.SNOOZED]: 'Snoozed',
  [STATUS.NOT_ELIGIBLE]: 'Not Eligible',
  [STATUS.UNKNOWN]: 'Data Missing',
};

// Statuses whose value has been definitively forfeited.
const MISSED_STATUSES = new Set([STATUS.EXPIRED_UNUSED, STATUS.EXPIRED_PARTIALLY_USED]);
// Statuses that still carry a usable balance.
const OPEN_STATUSES = new Set([STATUS.UNUSED, STATUS.PARTIALLY_USED]);

/**
 * The single authoritative answer to "is this redemption window ahead, open, or
 * closed?", decided purely from ISO dates.
 *
 * This exists because the app's isYTDCurrent() has no branch for the annual and
 * cal-annual cadences and falls through to `return false`, which made every
 * *unused* calendar-year credit look like a closed window — a benefit could
 * print an expiry of Dec 31 while being labelled Expired in July. Status and
 * expiry date now come from the same two fields, so they cannot disagree.
 *
 * Bounds are inclusive: on periodStart and on periodEnd the window is open.
 * @returns {'before'|'open'|'after'}
 */
export function windowPhase(reportDate, periodStart, periodEnd) {
  if (!periodStart && !periodEnd) return 'open'; // undated => treat as claimable
  if (!reportDate) return 'open';
  if (periodStart && reportDate < periodStart) return 'before';
  if (periodEnd && reportDate > periodEnd) return 'after';
  return 'open';
}

export const ASSESSMENTS = {
  EXCELLENT: 'Excellent Value',
  POSITIVE: 'Positive Value',
  BREAK_EVEN: 'Near Break-Even',
  REVIEW: 'Review at Renewal',
  UNDERUSED: 'Benefits Underutilized',
  NO_DATA: 'Insufficient Data',
};

// ── Number + string helpers ────────────────────────────────────────────────
// Money is summed in floats but rounded to cents at every boundary so a run of
// $14.07 Walmart credits never surfaces as 168.83999999999997.
export function r2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function fmtMoney(n) {
  const v = r2(n);
  const frac = Number.isInteger(v) ? 0 : 2;
  return v.toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: frac, maximumFractionDigits: frac,
  });
}

export function fmtSignedMoney(n) {
  const v = r2(n);
  return (v < 0 ? '−' : '+') + fmtMoney(Math.abs(v));
}

export function fmtPct(rate) {
  if (!Number.isFinite(rate)) return '0%';
  return `${Math.round(rate * 100)}%`;
}

export function pluralize(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural || singular + 's'}`;
}

export function joinList(items, conjunction = 'and') {
  const a = items.filter(Boolean);
  if (!a.length) return '';
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} ${conjunction} ${a[1]}`;
  return `${a.slice(0, -1).join(', ')}, ${conjunction} ${a[a.length - 1]}`;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-12-31' -> 'Dec 31, 2026'. Dates are stored ISO so they can be compared. */
export function fmtDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTH_ABBR[m - 1]} ${d}, ${y}`;
}

function titleCase(s) {
  return String(s || '').replace(/(^|[\s-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

// ── Instance classification ────────────────────────────────────────────────
// One "instance" is one benefit in one period — e.g. the March slice of a
// monthly dining credit. This is where every status and every dollar of missed
// value originates; everything above it is summation.
//
// Input instance fields:
//   periodKey, periodLabel, sortKey, amount,
//   used (bool), partialUsed (number),
//   periodStart, periodEnd         — ISO 'YYYY-MM-DD' bounds of the redemption
//                                    window, inclusive; the ONLY source of
//                                    open/closed truth
//   reportDate                     — ISO 'YYYY-MM-DD' the report is run for
//   isExcluded, excludeReason      — user skipped or snoozed this period
//   isSnoozed                      — snoozed specifically (vs skipped)
//   isNotYetAvailable              — benefit does not exist yet in this period
//   isOutsideCardOwnership         — card not held during this period
//   usageDate, note, isEstimated
export function classifyInstance(inst) {
  const amount = Math.max(0, r2(inst.amount || 0));
  const base = {
    periodKey: inst.periodKey,
    periodLabel: inst.periodLabel || inst.periodKey,
    sortKey: inst.sortKey ?? 0,
    amount,
    availableValue: 0,
    usedValue: 0,
    missedValue: 0,
    remainingValue: 0,
    upcomingValue: 0,
    excludedValue: 0,
    usageDate: inst.usageDate || null,
    periodStart: inst.periodStart || null,
    periodEnd: inst.periodEnd || null,
    // The expiry a reader sees is the window end — same field the status is
    // derived from, so "expires Dec 31" can never sit next to "Expired" in July.
    expirationDate: inst.periodEnd || null,
    note: inst.note || '',
    isEstimated: !!inst.isEstimated,
    reason: '',
  };

  // The card wasn't held in this period — there was never anything to use, so
  // it is neither missed nor an opportunity. Never inferred as "unused".
  if (inst.isOutsideCardOwnership) {
    return { ...base, status: STATUS.UNKNOWN, reason: 'Card not held during this period' };
  }
  // Benefit hadn't launched (or its half-year window doesn't cover this period).
  if (inst.isNotYetAvailable) {
    return { ...base, status: STATUS.NOT_YET_AVAILABLE, reason: 'Benefit not offered in this period' };
  }
  // User explicitly skipped or snoozed — intentional, so it is excluded from
  // both the utilization denominator and missed value.
  if (inst.isExcluded) {
    return {
      ...base,
      status: inst.isSnoozed ? STATUS.SNOOZED : STATUS.EXCLUDED,
      excludedValue: amount,
      reason: inst.excludeReason || (inst.isSnoozed ? 'Snoozed by you' : 'Skipped by you'),
    };
  }

  const phase = windowPhase(inst.reportDate, inst.periodStart, inst.periodEnd);

  // The window hasn't opened yet. Future credits are never counted as missed.
  if (phase === 'before') {
    return { ...base, status: STATUS.NOT_YET_AVAILABLE, upcomingValue: amount, reason: 'Redemption window has not opened' };
  }

  const rawPartial = Number(inst.partialUsed) || 0;
  const partial = Math.max(0, Math.min(amount, r2(rawPartial)));
  const usedValue = inst.used ? amount : partial;
  const shortfall = r2(amount - usedValue);

  // Non-monetary / untracked-value benefit (e.g. lounge access recorded at $0).
  if (amount === 0) {
    return {
      ...base,
      status: usedValue > 0 || inst.used ? STATUS.FULLY_USED : STATUS.UNKNOWN,
      reason: usedValue > 0 || inst.used ? '' : 'No monetary value tracked',
    };
  }

  const out = { ...base, availableValue: amount, usedValue: r2(usedValue) };

  if (usedValue >= amount) return { ...out, status: STATUS.FULLY_USED };

  if (phase === 'open') {
    // Window still open — the shortfall is a remaining opportunity, not a miss.
    return {
      ...out,
      remainingValue: shortfall,
      status: usedValue > 0 ? STATUS.PARTIALLY_USED : STATUS.UNUSED,
    };
  }

  // Window closed — this is the only place value becomes "missed".
  return {
    ...out,
    missedValue: shortfall,
    status: usedValue > 0 ? STATUS.EXPIRED_PARTIALLY_USED : STATUS.EXPIRED_UNUSED,
  };
}

// ── Benefit rollup ─────────────────────────────────────────────────────────
// Skipped and snoozed are both deliberate passes; they never become missed value.
export const INTENTIONAL_STATUSES = new Set([STATUS.EXCLUDED, STATUS.SNOOZED]);

function rollupStatus(t, instances) {
  const considered = instances.filter(i =>
    !INTENTIONAL_STATUSES.has(i.status) && i.status !== STATUS.NOT_YET_AVAILABLE && i.status !== STATUS.UNKNOWN);
  if (!considered.length) {
    if (instances.some(i => i.status === STATUS.SNOOZED)) return STATUS.SNOOZED;
    if (instances.some(i => i.status === STATUS.EXCLUDED)) return STATUS.EXCLUDED;
    if (instances.some(i => i.status === STATUS.NOT_YET_AVAILABLE)) return STATUS.NOT_YET_AVAILABLE;
    return STATUS.UNKNOWN;
  }
  // A $0 / non-monetary benefit the user actually claimed still reads as used —
  // only an unclaimed one is genuinely unknown.
  if (considered.every(i => i.status === STATUS.FULLY_USED)) return STATUS.FULLY_USED;
  if (t.availableValue === 0 && t.upcomingValue > 0) return STATUS.NOT_YET_AVAILABLE;
  if (t.availableValue === 0 && t.usedValue === 0) return STATUS.UNKNOWN;
  if (t.usedValue > 0 && t.missedValue === 0 && t.remainingValue === 0) return STATUS.FULLY_USED;
  if (t.usedValue > 0 && t.remainingValue > 0) return STATUS.PARTIALLY_USED;
  if (t.usedValue > 0 && t.missedValue > 0) return STATUS.EXPIRED_PARTIALLY_USED;
  if (t.usedValue === 0 && t.missedValue > 0) return STATUS.EXPIRED_UNUSED;
  return STATUS.UNUSED;
}

function buildBenefitItem(cardId, b) {
  const instances = (b.instances || []).map(classifyInstance)
    .sort((x, y) => x.sortKey - y.sortKey);

  const t = { availableValue: 0, usedValue: 0, missedValue: 0, remainingValue: 0, upcomingValue: 0, excludedValue: 0 };
  instances.forEach(i => {
    t.availableValue = r2(t.availableValue + i.availableValue);
    t.usedValue = r2(t.usedValue + i.usedValue);
    t.missedValue = r2(t.missedValue + i.missedValue);
    t.remainingValue = r2(t.remainingValue + i.remainingValue);
    t.upcomingValue = r2(t.upcomingValue + i.upcomingValue);
    t.excludedValue = r2(t.excludedValue + i.excludedValue);
  });

  // Face value is what the issuer publishes; personal value is the user's own
  // override. Both are carried so neither silently replaces the other.
  const faceAvailable = r2(instances.reduce((a, i) =>
    a + (i.availableValue > 0 ? (i.faceAmount ?? i.amount) : 0), 0));
  const faceUsed = r2(instances.reduce((a, i) => {
    if (i.usedValue <= 0) return a;
    const face = i.faceAmount ?? i.amount;
    return a + (i.amount > 0 ? (i.usedValue / i.amount) * face : face);
  }, 0));

  const usageDates = instances.filter(i => i.usageDate && i.usedValue > 0).map(i => i.usageDate);
  const missedInstances = instances.filter(i => MISSED_STATUSES.has(i.status));
  const usedInstances = instances.filter(i => i.usedValue > 0);
  const notes = instances.filter(i => i.note).map(i => ({ period: i.periodLabel, note: i.note }));

  return {
    benefitId: b.benefitId,
    cardId,
    benefitName: b.benefitName,
    category: b.category || 'other',
    frequency: b.frequency || 'one-time',
    frequencyLabel: b.frequencyLabel || frequencyLabelFor(b.frequency),
    description: b.description || '',
    availableValue: t.availableValue,
    faceAvailableValue: faceAvailable,
    faceUsedValue: faceUsed,
    usedValue: t.usedValue,
    missedValue: t.missedValue,
    remainingValue: t.remainingValue,
    upcomingValue: t.upcomingValue,
    excludedValue: t.excludedValue,
    utilizationRate: t.availableValue > 0 ? t.usedValue / t.availableValue : 0,
    status: rollupStatus(t, instances),
    usageDates,
    expirationDate: instances.map(i => i.expirationDate).filter(Boolean).pop() || null,
    nextExpiration: instances.filter(i => OPEN_STATUSES.has(i.status) && i.expirationDate)
      .map(i => i.expirationDate)[0] || null,
    // The date shown next to a rolled-up status must belong to the window that
    // status describes. A semi-annual credit whose H1 expired but whose H2 is
    // open would otherwise print "Expired" beside H2's future end date.
    statusExpiration: (() => {
      const st = rollupStatus(t, instances);
      const pick = pred => instances.filter(pred).map(i => i.expirationDate).filter(Boolean);
      if (MISSED_STATUSES.has(st)) return pick(i => MISSED_STATUSES.has(i.status)).pop() || null;
      if (OPEN_STATUSES.has(st)) return pick(i => OPEN_STATUSES.has(i.status))[0] || null;
      if (st === STATUS.NOT_YET_AVAILABLE) return pick(i => i.upcomingValue > 0)[0] || null;
      return pick(() => true).pop() || null;
    })(),
    notes,
    isEstimated: instances.some(i => i.isEstimated),
    periodsTotal: instances.length,
    periodsUsed: usedInstances.length,
    periodsMissed: missedInstances.length,
    missedPeriodLabels: missedInstances.map(i => i.periodLabel),
    instances,
  };
}

/**
 * Two benefits on one card can legitimately share a name — the Sapphire
 * Reserve genuinely carries two separate $10 DoorDash grocery credits. Records
 * are never merged; a distinguishing suffix is added so the report does not
 * read as a duplicated row. Prefers real metadata, falls back to a sequence
 * number only when nothing else distinguishes them.
 */
export function disambiguateBenefitNames(benefits) {
  const byName = new Map();
  benefits.forEach(b => {
    const k = b.benefitName.toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(b);
  });
  byName.forEach(group => {
    if (group.length < 2) return;
    const descs = group.map(b => (b.description || '').trim());
    const descsDistinct = new Set(descs).size === group.length && descs.every(Boolean);
    group.forEach((b, i) => {
      b.duplicateOfName = true;
      b.displayName = descsDistinct
        ? `${b.benefitName} — ${descs[i]}`
        : `${b.benefitName} — Benefit ${i + 1}`;
      b.disambiguatedBy = descsDistinct ? 'description' : 'sequence';
    });
  });
  return benefits;
}

export function frequencyLabelFor(cadence) {
  const map = {
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    'semi-annual': 'Semi-annual (card year)',
    'cal-semi-annual': 'Semi-annual (calendar)',
    annual: 'Annual (card year)',
    'cal-annual': 'Annual (calendar year)',
    'cal-annual-overlap': 'Annual (calendar year)',
    'feb-annual': 'Annual (Feb–Jan)',
    'one-time': 'One-time',
  };
  return map[cadence] || titleCase(cadence || 'one-time');
}

const RECURRING_CADENCES = new Set(['monthly', 'quarterly']);

// ── Card rollup ────────────────────────────────────────────────────────────
/**
 * Utilization and break-even are separate questions and must not be conflated.
 * A card whose every tracked credit was claimed is not "underutilized" just
 * because the credits total slightly less than the fee — that is a pricing
 * question, not a usage one. Underutilization is therefore only claimed when
 * value was actually left on the table.
 *
 * Assessed on benefit value alone (`netBenefitValueAfterFees`), not on points:
 * points redemptions say nothing about how well the card's credits were used.
 */
export function assessCard(s) {
  if (s.availableValue === 0 && s.upcomingValue === 0 && s.usedValue === 0) return ASSESSMENTS.NO_DATA;

  const fee = s.annualFee || 0;
  const util = s.utilizationRate;

  // Only a genuine failure to claim available value earns the usage label.
  if (util < 0.6 && s.missedValue > 0) return ASSESSMENTS.UNDERUSED;

  if (fee <= 0) return s.usedValue > 0 ? ASSESSMENTS.EXCELLENT : ASSESSMENTS.NO_DATA;

  const net = s.netBenefitValueAfterFees;
  if (net >= fee * 0.25) return ASSESSMENTS.EXCELLENT;
  if (net > 0) return ASSESSMENTS.POSITIVE;
  if (net >= -fee * 0.15) return ASSESSMENTS.BREAK_EVEN;
  return ASSESSMENTS.REVIEW;
}

function buildCardSummary(card) {
  const benefits = disambiguateBenefitNames((card.benefits || []).map(b => buildBenefitItem(card.cardId, b)));

  const sum = key => r2(benefits.reduce((a, b) => a + b[key], 0));
  const availableValue = sum('availableValue');
  const usedValue = sum('usedValue');
  const missedValue = sum('missedValue');
  const remainingAvailableValue = sum('remainingValue');
  const upcomingValue = sum('upcomingValue');
  const excludedValue = sum('excludedValue');
  const pointsRedeemed = r2(card.pointsRedeemed || 0);
  const annualFee = r2(card.annualFee || 0);

  const summary = {
    cardId: card.cardId,
    cardName: card.cardName,
    annualFee,
    feeIsKnown: card.annualFee !== null && card.annualFee !== undefined,
    renewalDate: card.renewalDate || null,
    openedLabel: card.openedLabel || null,
    closedLabel: card.closedLabel || null,
    availableValue,
    usedValue,
    missedValue,
    remainingAvailableValue,
    upcomingValue,
    excludedValue,
    faceAvailableValue: sum('faceAvailableValue'),
    faceUsedValue: sum('faceUsedValue'),
    hasPersonalOverrides: benefits.some(b => b.isEstimated),
    // Points redemptions are reported alongside benefit value, never folded
    // into it. `netBenefitValueAfterFees` answers "did the statement credits
    // cover the fee?"; `totalTrackedValueAfterFees` adds points on top.
    recordedPointsRedemptionValue: pointsRedeemed,
    pointsBreakdown: card.pointsBreakdown || null,
    isFirstYear: !!card.isFirstYear,
    utilizationRate: availableValue > 0 ? usedValue / availableValue : 0,
    netBenefitValueAfterFees: r2(usedValue - annualFee),
    totalTrackedValueAfterFees: r2(usedValue + pointsRedeemed - annualFee),
    faceNetBenefitValueAfterFees: r2(sum('faceUsedValue') - annualFee),
    breakEvenGap: r2(annualFee - usedValue),
    // Legacy aliases, kept so nothing silently reads undefined mid-migration.
    pointsRedeemed,
    netTrackedValue: r2(usedValue + pointsRedeemed - annualFee),
    benefitsUsed: benefits.filter(b => b.usedValue > 0).length,
    benefitsFullyUsed: benefits.filter(b => b.status === STATUS.FULLY_USED).length,
    benefitsMissed: benefits.filter(b => b.missedValue > 0).length,
    benefitsTotal: benefits.filter(b => b.availableValue > 0 || b.upcomingValue > 0).length,
    hasEstimates: benefits.some(b => b.isEstimated),
    benefits,
  };
  summary.assessment = assessCard(summary);
  return summary;
}

// ── Portfolio report ───────────────────────────────────────────────────────
/**
 * @param {Object} input - snapshot produced by report.js
 * @returns {Object} PortfolioReport
 */
export function buildPortfolioReport(input) {
  const cardSummaries = (input.cards || []).map(buildCardSummary);

  const sum = key => r2(cardSummaries.reduce((a, c) => a + c[key], 0));
  const totalAnnualFees = sum('annualFee');
  const totalAvailableValue = sum('availableValue');
  const totalUsedValue = sum('usedValue');
  const totalMissedValue = sum('missedValue');
  const totalRemainingAvailableValue = sum('remainingAvailableValue');
  const totalUpcomingValue = sum('upcomingValue');
  const totalExcludedValue = sum('excludedValue');
  const totalPointsRedeemed = sum('recordedPointsRedemptionValue');

  const withValue = cardSummaries.filter(c => c.availableValue > 0 || c.usedValue > 0);
  // Ranked on benefit value, so a big one-off points redemption cannot crown a
  // card whose credits went unused.
  const bestCard = withValue.slice().sort((a, b) =>
    (b.netBenefitValueAfterFees - a.netBenefitValueAfterFees) || (b.usedValue - a.usedValue))[0] || null;
  const worstCard = cardSummaries.filter(c => c.missedValue > 0)
    .sort((a, b) => b.missedValue - a.missedValue)[0] || null;

  const allBenefits = cardSummaries.flatMap(c => c.benefits);

  const report = {
    title: input.title || `${input.periodLabel || ''} Credit Card Benefits Review`.trim(),
    periodLabel: input.periodLabel || '',
    periodStart: input.periodStart || '',
    periodEnd: input.periodEnd || '',
    generatedAt: input.generatedAt || new Date().toISOString(),
    isPartialPeriod: !!input.isPartialPeriod,
    cardCount: cardSummaries.length,
    totalAnnualFees,
    totalAvailableValue,
    totalUsedValue,
    totalMissedValue,
    totalRemainingAvailableValue,
    totalUpcomingValue,
    totalExcludedValue,
    // ── The six headline metrics, kept strictly separate ──────────────────
    redeemedBenefitValue: totalUsedValue,
    recordedPointsRedemptionValue: totalPointsRedeemed,
    netBenefitValueAfterFees: r2(totalUsedValue - totalAnnualFees),
    totalTrackedValueAfterFees: r2(totalUsedValue + totalPointsRedeemed - totalAnnualFees),
    faceAvailableValue: sum('faceAvailableValue'),
    faceUsedValue: sum('faceUsedValue'),
    faceNetBenefitValueAfterFees: r2(sum('faceUsedValue') - totalAnnualFees),
    hasPersonalOverrides: cardSummaries.some(c => c.hasPersonalOverrides),
    // Legacy aliases.
    totalPointsRedeemed,
    netTrackedValue: r2(totalUsedValue + totalPointsRedeemed - totalAnnualFees),
    utilizationRate: totalAvailableValue > 0 ? totalUsedValue / totalAvailableValue : 0,
    benefitsFullyUsed: allBenefits.filter(b => b.status === STATUS.FULLY_USED).length,
    benefitsPartiallyUsed: allBenefits.filter(b =>
      b.status === STATUS.PARTIALLY_USED || b.status === STATUS.EXPIRED_PARTIALLY_USED).length,
    benefitsUnused: allBenefits.filter(b =>
      b.status === STATUS.UNUSED || b.status === STATUS.EXPIRED_UNUSED).length,
    benefitsExcluded: allBenefits.filter(b => b.status === STATUS.EXCLUDED).length,
    hasEstimates: allBenefits.some(b => b.isEstimated),
    bestCard,
    worstCard,
    cardSummaries,
    options: input.options || {},
  };

  report.usageByCategory = aggregateByCategory(allBenefits);
  report.usageByCard = cardSummaries.map(c => ({
    cardId: c.cardId, cardName: c.cardName, usedValue: c.usedValue,
    missedValue: c.missedValue, utilizationRate: c.utilizationRate,
  }));
  report.repeatOffenders = allBenefits
    .filter(b => RECURRING_CADENCES.has(b.frequency) && b.periodsMissed >= 2)
    .sort((a, b) => b.missedValue - a.missedValue);
  report.consistentRecurring = allBenefits
    .filter(b => RECURRING_CADENCES.has(b.frequency) && b.periodsUsed >= 2 && b.periodsMissed === 0)
    .sort((a, b) => b.usedValue - a.usedValue);
  report.oneTimeRedeemed = allBenefits
    .filter(b => !RECURRING_CADENCES.has(b.frequency) && b.status === STATUS.FULLY_USED)
    .sort((a, b) => b.usedValue - a.usedValue);
  report.openOpportunities = allBenefits
    .filter(b => b.remainingValue > 0)
    .sort((a, b) => b.remainingValue - a.remainingValue);

  return report;
}

export function aggregateByCategory(benefits) {
  const map = new Map();
  benefits.forEach(b => {
    const key = b.category || 'other';
    if (!map.has(key)) map.set(key, { category: key, label: titleCase(key), availableValue: 0, usedValue: 0, missedValue: 0, remainingValue: 0, count: 0 });
    const e = map.get(key);
    e.availableValue = r2(e.availableValue + b.availableValue);
    e.usedValue = r2(e.usedValue + b.usedValue);
    e.missedValue = r2(e.missedValue + b.missedValue);
    e.remainingValue = r2(e.remainingValue + b.remainingValue);
    e.count++;
  });
  return [...map.values()]
    .map(e => ({ ...e, utilizationRate: e.availableValue > 0 ? e.usedValue / e.availableValue : 0 }))
    .sort((a, b) => b.usedValue - a.usedValue);
}

// ══════════════════════════════════════════════════════════════════════════
// Narrative generation — deterministic templates over calculated facts.
// No external API; every claim below must be traceable to a report field.
// ══════════════════════════════════════════════════════════════════════════

export function generatePortfolioSummary(report) {
  if (!report.cardCount) {
    return 'No cards were selected for this report, so there is nothing to summarize yet. Add a card in Settings to start tracking benefit value.';
  }
  if (report.totalAvailableValue === 0 && report.totalUpcomingValue === 0) {
    return `No trackable benefit value was available across your ${pluralize(report.cardCount, 'card')} during ${report.periodLabel}. This usually means the reporting period starts before the benefits you track became active.`;
  }

  const parts = [];
  const scope = report.isPartialPeriod ? 'So far this period' : 'During this reporting period';
  parts.push(
    `${scope}, you received ${fmtMoney(report.totalUsedValue)} in value from ${fmtMoney(report.totalAvailableValue)} in available benefits across ${pluralize(report.cardCount, 'card')} — an overall utilization rate of ${fmtPct(report.utilizationRate)}.`
  );

  const counts = [];
  if (report.benefitsFullyUsed) counts.push(`fully used ${pluralize(report.benefitsFullyUsed, 'benefit')}`);
  if (report.benefitsPartiallyUsed) counts.push(`partially used ${report.benefitsPartiallyUsed}`);
  if (report.benefitsUnused) counts.push(`left ${report.benefitsUnused} unused`);
  if (counts.length) parts.push(`You ${joinList(counts)}.`);

  if (report.bestCard && report.bestCard.usedValue > 0) {
    parts.push(`Your strongest-performing card was the ${report.bestCard.cardName}, which returned ${fmtMoney(report.bestCard.usedValue)} in redeemed benefit value against a ${fmtMoney(report.bestCard.annualFee)} annual fee.`);
  }
  if (report.worstCard && report.worstCard.missedValue > 0) {
    const same = report.bestCard && report.worstCard.cardId === report.bestCard.cardId;
    parts.push(`${same ? 'That same card' : `The ${report.worstCard.cardName}`} had the highest amount of unused value at ${fmtMoney(report.worstCard.missedValue)}.`);
  } else if (report.totalMissedValue === 0) {
    parts.push('No tracked benefit expired unused — nothing was forfeited during this period.');
  }

  if (report.totalAnnualFees > 0) {
    const net = report.netBenefitValueAfterFees;
    parts.push(net >= 0
      ? `Statement credits and tracked reimbursements alone produced ${fmtMoney(report.redeemedBenefitValue)} against ${fmtMoney(report.totalAnnualFees)} in annual fees — a net benefit value of ${fmtMoney(net)}.`
      : `Statement credits and tracked reimbursements alone produced ${fmtMoney(report.redeemedBenefitValue)} against ${fmtMoney(report.totalAnnualFees)} in annual fees, leaving benefit value ${fmtMoney(Math.abs(net))} short of the fees.`);
    if (report.recordedPointsRedemptionValue > 0) {
      parts.push(`Separately, you recorded ${fmtMoney(report.recordedPointsRedemptionValue)} in points and miles redemptions. These are a different kind of value — they come from spending and bonuses rather than from the cards' statement credits — so they are reported alongside benefit value, not inside it. Counting both, total tracked value after fees was ${fmtMoney(report.totalTrackedValueAfterFees)}.`);
    }
  }

  if (report.totalRemainingAvailableValue > 0) {
    parts.push(`A further ${fmtMoney(report.totalRemainingAvailableValue)} is still available and has not expired.`);
  }

  // Joined with semicolons rather than joinList(): each caveat already contains
  // commas, and comma-joining them runs the clauses together.
  const caveats = [];
  if (report.hasEstimates) caveats.push('some benefit values are your own estimates rather than fixed statement credits');
  caveats.push('points earnings, travel protections, lounge access, elite status, and transfer-partner value are not included unless you tracked them explicitly');
  if (report.totalExcludedValue > 0) caveats.push(`${fmtMoney(report.totalExcludedValue)} of benefits you marked skipped or snoozed is excluded from these totals`);
  parts.push(`Important caveats: ${caveats.join('; ')}.`);

  return parts.join(' ');
}

export function generateCardNarrative(card) {
  if (card.availableValue === 0 && card.upcomingValue === 0) {
    return `No trackable benefit value was available on the ${card.cardName} during this period, so no assessment can be made from tracked data alone.`;
  }

  const parts = [];
  const util = card.utilizationRate;
  const opener = util >= 0.9 ? 'was one of your most consistently used cards'
    : util >= 0.6 ? 'saw solid but incomplete use'
    : util >= 0.3 ? 'was used inconsistently'
    : 'went largely unused';
  parts.push(`The ${card.cardName} ${opener}, with ${fmtPct(util)} of ${fmtMoney(card.availableValue)} in available benefits redeemed.`);

  const full = card.benefits.filter(b => b.status === STATUS.FULLY_USED && b.usedValue > 0)
    .sort((a, b) => b.usedValue - a.usedValue);
  if (full.length) {
    const named = full.slice(0, 3).map(b => `the ${fmtMoney(b.availableValue)} ${b.benefitName}`);
    parts.push(`You fully used ${joinList(named)}${full.length > 3 ? `, plus ${pluralize(full.length - 3, 'other benefit')}` : ''}.`);
  }

  const missed = card.benefits.filter(b => b.missedValue > 0).sort((a, b) => b.missedValue - a.missedValue);
  if (missed.length) {
    const named = missed.slice(0, 2).map(b => b.benefitName);
    parts.push(`However, ${pluralize(missed.length, 'benefit')} expired with value unclaimed — ${joinList(named)}${missed.length > 2 ? ' among them' : ''} — leaving ${fmtMoney(card.missedValue)} in potential value forfeited.`);
  }

  const open = card.benefits.filter(b => b.remainingValue > 0).sort((a, b) => b.remainingValue - a.remainingValue);
  if (open.length) {
    parts.push(`${fmtMoney(card.remainingAvailableValue)} across ${pluralize(open.length, 'benefit')} is still available — the largest is the ${open[0].benefitName} at ${fmtMoney(open[0].remainingValue)}.`);
  }

  // Precise wording: the sentence names each component rather than calling a
  // points-inclusive figure "tracked benefits alone".
  if (card.annualFee > 0) {
    if (card.recordedPointsRedemptionValue > 0) {
      parts.push(`Tracked statement credits produced ${fmtMoney(card.usedValue)} in value. Recorded points redemptions added ${fmtMoney(card.recordedPointsRedemptionValue)}. Together, after the ${fmtMoney(card.annualFee)} annual fee, total tracked value was ${fmtSignedMoney(card.totalTrackedValueAfterFees)}.`);
      parts.push(card.netBenefitValueAfterFees >= 0
        ? `On statement credits alone the card was ${fmtMoney(card.netBenefitValueAfterFees)} ahead of its fee.`
        : `On statement credits alone the card was ${fmtMoney(Math.abs(card.netBenefitValueAfterFees))} below its fee.`);
    } else {
      parts.push(card.netBenefitValueAfterFees >= 0
        ? `Tracked statement credits produced ${fmtMoney(card.usedValue)} against the ${fmtMoney(card.annualFee)} annual fee — ${fmtMoney(card.netBenefitValueAfterFees)} ahead of the fee. No points redemptions were recorded on this card.`
        : `Tracked statement credits produced ${fmtMoney(card.usedValue)} against the ${fmtMoney(card.annualFee)} annual fee, ${fmtMoney(Math.abs(card.netBenefitValueAfterFees))} short of covering it. No points redemptions were recorded on this card.`);
    }
  } else {
    parts.push(`This card carries no annual fee, so all ${fmtMoney(card.usedValue)} of tracked benefit value is net positive.`);
  }

  if (card.isFirstYear && card.recordedPointsRedemptionValue > 0) {
    parts.push('This card was opened during the reporting period, so its points redemption value may include first-year or welcome-bonus value and should not be assumed to recur.');
  }

  // Only name untracked categories the card could plausibly carry — claiming
  // lounge access for a card that has no lounge benefit is simply wrong.
  parts.push(`Value not captured here${card.untrackedValueNote ? ` — ${card.untrackedValueNote}` : ''}: points earned on spend, and any protections or perks you do not track in Perks Ledger.`);
  return parts.join(' ');
}

export function generateUsagePatternNarrative(report) {
  if (report.totalUsedValue === 0) {
    return 'No benefit redemptions were recorded during this period, so there are no usage patterns to describe yet. Marking benefits as used — even retroactively — will make future reports far more useful.';
  }

  const parts = [];
  const cats = report.usageByCategory.filter(c => c.usedValue > 0);
  if (cats.length) {
    const top = cats.slice(0, 2);
    const share = report.totalUsedValue > 0
      ? Math.round(top.reduce((a, c) => a + c.usedValue, 0) / report.totalUsedValue * 100) : 0;
    parts.push(`${joinList(top.map(c => c.label))} ${top.length === 1 ? 'benefits represented' : 'benefits together represented'} ${share}% of the value you received (${fmtMoney(top.reduce((a, c) => a + c.usedValue, 0))}).`);
  }

  if (report.consistentRecurring.length) {
    const b = report.consistentRecurring[0];
    parts.push(`You used recurring benefits consistently — the ${b.benefitName} was claimed in all ${pluralize(b.periodsUsed, 'period')} it was available.`);
  }
  if (report.oneTimeRedeemed.length) {
    parts.push(`${pluralize(report.oneTimeRedeemed.length, 'one-time or annual benefit was', 'one-time or annual benefits were')} redeemed in full, including the ${report.oneTimeRedeemed[0].benefitName}.`);
  }
  if (report.repeatOffenders.length) {
    parts.push(`You were less consistent with ${joinList(report.repeatOffenders.slice(0, 2).map(b => b.benefitName))}, which ${report.repeatOffenders.length === 1 ? 'was' : 'were'} missed in more than one period.`);
  }

  const bestCards = report.usageByCard.filter(c => c.usedValue > 0).sort((a, b) => b.usedValue - a.usedValue);
  if (bestCards.length > 1) {
    parts.push(`By card, ${bestCards[0].cardName} delivered the most realized value at ${fmtMoney(bestCards[0].usedValue)}.`);
  }
  return parts.join(' ');
}

export function generateMissedValueNarrative(report) {
  if (report.totalMissedValue === 0) {
    return report.totalRemainingAvailableValue > 0
      ? `Nothing expired unused during this period. ${fmtMoney(report.totalRemainingAvailableValue)} remains available and can still be claimed before its deadline.`
      : 'Nothing expired unused during this period — every tracked benefit was either redeemed, is still available, or was intentionally excluded.';
  }

  const parts = [];
  parts.push(`You left ${fmtMoney(report.totalMissedValue)} in benefits unused — value that has expired and can no longer be claimed.`);

  const byCard = report.cardSummaries.filter(c => c.missedValue > 0).sort((a, b) => b.missedValue - a.missedValue);
  if (byCard.length) {
    const lead = byCard[0];
    const share = Math.round(lead.missedValue / report.totalMissedValue * 100);
    parts.push(`${share}% of it (${fmtMoney(lead.missedValue)}) came from the ${lead.cardName}${byCard.length > 1 ? `, followed by the ${byCard[1].cardName} at ${fmtMoney(byCard[1].missedValue)}` : ''}.`);
  }

  const missedCats = report.usageByCategory.filter(c => c.missedValue > 0).sort((a, b) => b.missedValue - a.missedValue);
  if (missedCats.length) {
    parts.push(`Most of the missed value came from ${joinList(missedCats.slice(0, 2).map(c => c.label.toLowerCase()))} benefits.`);
  }

  if (report.repeatOffenders.length) {
    const r = report.repeatOffenders;
    parts.push(`${pluralize(r.length, 'recurring credit was', 'recurring credits were')} missed more than once — ${joinList(r.slice(0, 3).map(b => `${b.benefitName} (${pluralize(b.periodsMissed, 'period')})`))} — suggesting these benefits may not fit your normal spending habits.`);
  }

  if (report.totalExcludedValue > 0) {
    parts.push(`Separately, ${fmtMoney(report.totalExcludedValue)} was marked skipped or snoozed and is treated as an intentional choice rather than a miss.`);
  }
  return parts.join(' ');
}

export function generateOpportunityNarrative(report) {
  if (report.totalRemainingAvailableValue === 0 && report.totalUpcomingValue === 0) {
    return 'There are no benefits with a remaining balance in this reporting period. Everything available has either been used or has already expired.';
  }
  const parts = [];
  if (report.totalRemainingAvailableValue > 0) {
    parts.push(`You still have ${fmtMoney(report.totalRemainingAvailableValue)} in currently available benefits that can be used before the end of the reporting period.`);
    const top = report.openOpportunities[0];
    if (top) {
      const card = report.cardSummaries.find(c => c.cardId === top.cardId);
      parts.push(`The largest remaining opportunity is the ${top.benefitName} on the ${card ? card.cardName : 'your card'} at ${fmtMoney(top.remainingValue)}${top.nextExpiration ? `, which expires ${fmtDate(top.nextExpiration)}` : ''}.`);
    }
  }
  if (report.totalUpcomingValue > 0) {
    parts.push(`Another ${fmtMoney(report.totalUpcomingValue)} has not become available yet and will unlock later in the period.`);
  }
  const renewals = report.cardSummaries.filter(c => c.renewalDate).slice(0, 3);
  if (renewals.length) {
    parts.push(`Upcoming renewals: ${joinList(renewals.map(c => `${c.cardName} (${c.renewalDate})`))}.`);
  }
  return parts.join(' ');
}

export function generateRecommendations(report) {
  const recs = [];

  // 1. Use what is still on the table, largest first.
  report.openOpportunities.slice(0, 3).forEach(b => {
    const card = report.cardSummaries.find(c => c.cardId === b.cardId);
    recs.push({
      priority: 'act-now',
      title: `Use the ${b.benefitName} before it resets`,
      detail: `${fmtMoney(b.remainingValue)} is still available on the ${card ? card.cardName : 'card'}${b.nextExpiration ? `, expiring ${fmtDate(b.nextExpiration)}` : ''}. Consider claiming it before the period closes.`,
    });
  });

  // 2. Repeatedly missed recurring credits — reminder or reassignment.
  //    Only for benefits genuinely missed while eligible: a skipped or snoozed
  //    credit was a deliberate choice and must never generate a nag.
  report.repeatOffenders
    .filter(b => b.missedValue > 0 && !INTENTIONAL_STATUSES.has(b.status))
    .slice(0, 3).forEach(b => {
    const card = report.cardSummaries.find(c => c.cardId === b.cardId);
    recs.push({
      priority: 'habit',
      title: `Add a reminder for the ${b.benefitName}`,
      detail: `You missed this ${b.frequencyLabel.toLowerCase()} credit in ${pluralize(b.periodsMissed, 'period')} (${fmtMoney(b.missedValue)} forfeited) on the ${card ? card.cardName : 'card'}. Consider a recurring reminder, or reassigning a regular purchase to this card so the credit clears automatically.`,
    });
  });

  // 3. Cards worth a look before renewal — only where the data supports it.
  report.cardSummaries
    .filter(c => c.annualFee > 0 && (c.assessment === ASSESSMENTS.REVIEW
      || c.assessment === ASSESSMENTS.UNDERUSED || c.assessment === ASSESSMENTS.BREAK_EVEN))
    .sort((a, b) => b.breakEvenGap - a.breakEvenGap)
    .slice(0, 3)
    .forEach(c => {
      const gap = Math.max(0, c.breakEvenGap);
      if (c.utilizationRate >= 0.95 && c.missedValue === 0) {
        // Fully used but priced above its credits: the question is earn rate,
        // not usage. Recommending "use it more" here would be nonsense.
        recs.push({
          priority: 'review',
          title: `Review the ${c.cardName}${c.renewalDate ? ` before its ${c.renewalDate} renewal` : ''}`,
          detail: `You claimed every tracked credit on this card — ${fmtPct(c.utilizationRate)} of ${fmtMoney(c.availableValue)} — so there is no usage problem to fix. The credits simply total ${fmtMoney(gap)} less than the ${fmtMoney(c.annualFee)} annual fee. Before renewing, consider reviewing your actual category spend on this card: if points earned there are worth at least ${fmtMoney(gap)} a year to you, the card still pays for itself.`,
        });
      } else {
        recs.push({
          priority: 'review',
          title: `Review the ${c.cardName}${c.renewalDate ? ` before its ${c.renewalDate} renewal` : ''}`,
          detail: `You used ${fmtPct(c.utilizationRate)} of its available credits and let ${fmtMoney(c.missedValue)} expire unclaimed. Consider whether the credits fit your normal spending, and whether points earned on this card cover the remaining ${fmtMoney(gap)} gap to the annual fee.`,
        });
      }
    });

  // 4. Face-value honesty check on large unused credits.
  const inflated = report.cardSummaries.flatMap(c => c.benefits)
    .filter(b => b.availableValue >= 100 && b.usedValue === 0 && b.missedValue > 0)
    .sort((a, b) => b.missedValue - a.missedValue).slice(0, 2);
  inflated.forEach(b => {
    const card = report.cardSummaries.find(c => c.cardId === b.cardId);
    recs.push({
      priority: 'valuation',
      title: `Re-value the ${b.benefitName}`,
      detail: `${fmtMoney(b.missedValue)} of this credit on the ${card ? card.cardName : 'card'} went unused. If it funds something you would not otherwise buy, consider lowering its tracked value so your net-value numbers reflect what the card is really worth to you.`,
    });
  });

  // 5. Data hygiene.
  const unknowns = report.cardSummaries.flatMap(c => c.benefits).filter(b => b.status === STATUS.UNKNOWN);
  if (unknowns.length) {
    recs.push({
      priority: 'data',
      title: 'Fill in missing usage information',
      detail: `${pluralize(unknowns.length, 'benefit has', 'benefits have')} no monetary value or usage record and could not be classified. Adding amounts or marking them used will make the next report more accurate.`,
    });
  }
  if (report.totalPointsRedeemed === 0 && report.cardSummaries.some(c => c.annualFee >= 395)) {
    recs.push({
      priority: 'data',
      title: 'Track lounge visits and points redemptions separately',
      detail: 'Premium cards in your portfolio carry value that statement credits do not capture. Recording points redemptions (and a personal value for lounge access) gives a fairer picture than credits alone.',
    });
  }

  if (!recs.length) {
    recs.push({
      priority: 'act-now',
      title: 'No action needed right now',
      detail: 'Every tracked benefit in this period was either redeemed or intentionally excluded. Keep an eye on the next reset dates listed above.',
    });
  }
  return recs;
}

export function generateMethodology(report) {
  const opts = report.options || {};
  return [
    { heading: 'Available value', body: `Each benefit is expanded into one entry per redemption period inside ${report.periodLabel}. The face value of each entry is summed to give available value. Periods that had not opened yet, benefits that had not launched, and periods before you held the card are excluded from this figure.` },
    { heading: 'Used value', body: 'A benefit marked used counts at full face value. A benefit with a partial-use amount counts only that amount. Partial amounts are clamped to the range $0–face value, so corrected or negative entries cannot inflate the total.' },
    { heading: 'Partial usage', body: 'Partially used benefits are split three ways: the amount realized, the amount still claimable (remaining opportunity), and the amount forfeited once the window closed. These three never overlap.' },
    { heading: 'Recurring credits', body: 'Monthly, quarterly, semi-annual, annual, anniversary-year (card-year) and Feb–Jan credits are each counted once per period they were actually offered. No period is counted twice, and a recurring credit contributes at most its face value per period.' },
    { heading: 'Missed value', body: `A period counts as missed only when its actual redemption window closed before ${fmtDate(report.reportDate) || 'the report date'} with value unclaimed. Window bounds are real dates and are inclusive at both ends, so a credit is claimable on its start date and on its final day. Because the status and the printed expiry date are both read from the same window end, a benefit can never show a future expiry while being labelled expired.` },
    { heading: 'Still claimable', body: 'Value in a window that is open on the report date is reported as Still Claimable, never as missed. This is a separate figure from missed value and the two never overlap.' },
    { heading: 'Benefit value vs points value', body: 'Redeemed Benefit Value counts statement credits and tracked reimbursements only. Recorded Points Redemption Value counts points and miles you redeemed, which come from spending and bonuses rather than from a card\'s credits. Net Benefit Value After Fees is benefit value less annual fees; Total Tracked Value After Fees adds points on top. The two are never combined under a single label.' },
    { heading: 'Face value vs personal value', body: report.hasPersonalOverrides ? 'Face value is the issuer-published amount. Where you set your own amount for a benefit, that personal value is used for the headline totals and the benefit is marked as a personal valuation; the face-value equivalents are reported alongside so neither silently replaces the other.' : 'Face value is the issuer-published amount, and personal value defaults to it. You have not overridden any benefit values, so personal value currently equals published face value throughout this report.' },
    { heading: 'Card status', body: 'Utilization and break-even are assessed separately. A card is only called Benefits Underutilized when value was actually left unclaimed; a card whose every credit was used but whose credits total less than the fee is reported as Near Break-Even or Review at Renewal, which is a pricing question rather than a usage one.' },
    { heading: 'Excluded benefits', body: `Benefits you skipped or snoozed are reported as Excluded and are removed from both the utilization denominator and missed value — an intentional pass is not a miss. ${report.totalExcludedValue > 0 ? `${fmtMoney(report.totalExcludedValue)} was excluded on this basis.` : 'Nothing was excluded on this basis in this period.'}` },
    { heading: 'Annual fees', body: `Net tracked value is used value plus recorded points redemptions minus the annual fee that applied in ${report.periodLabel}. Where a card's fee changed, the historical fee for that year is used.` },
    { heading: 'Estimated values', body: report.hasEstimates ? 'Benefits whose value you overrode with a custom amount are marked as estimated in the benefit tables. These reflect your own valuation, not a fixed statement credit.' : 'No benefit values in this report were overridden with custom estimates; all figures use the published credit amounts.' },
    { heading: 'Points redemption sources', body: 'Perks Ledger cannot tell where redeemed points came from, so nothing is inferred. Unless you declared a source, a redemption is reported as Other / Unknown. Points redemption value may include first-year or welcome-bonus value and should not be assumed to recur.' },
    { heading: 'What is excluded', body: 'Points and miles earned from spending, travel and purchase protections, lounge access, elite status, companion certificates, and transfer-partner value are not included. A card can therefore be below break-even here and still be worth keeping.' },
    { heading: 'Report options', body: `Generated with: unused ${opts.includeUnused === false ? 'hidden' : 'shown'}, expired ${opts.includeExpired === false ? 'hidden' : 'shown'}, upcoming ${opts.includeUpcoming === false ? 'hidden' : 'shown'}, notes ${opts.includeNotes === false ? 'hidden' : 'shown'}, grouped by ${opts.groupBy === 'category' ? 'benefit category' : 'card'}.` },
  ];
}
