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
  UNKNOWN: 'unknown',
};

export const STATUS_LABELS = {
  [STATUS.FULLY_USED]: 'Fully Used',
  [STATUS.PARTIALLY_USED]: 'Partially Used',
  [STATUS.UNUSED]: 'Unused',
  [STATUS.EXPIRED_UNUSED]: 'Expired Unused',
  [STATUS.EXPIRED_PARTIALLY_USED]: 'Expired Partially Used',
  [STATUS.UPCOMING]: 'Upcoming',
  [STATUS.NOT_YET_AVAILABLE]: 'Not Yet Available',
  [STATUS.EXCLUDED]: 'Excluded',
  [STATUS.UNKNOWN]: 'Unknown',
};

// Statuses whose value has been definitively forfeited.
const MISSED_STATUSES = new Set([STATUS.EXPIRED_UNUSED, STATUS.EXPIRED_PARTIALLY_USED]);
// Statuses that still carry a usable balance.
const OPEN_STATUSES = new Set([STATUS.UNUSED, STATUS.PARTIALLY_USED]);

export const ASSESSMENTS = {
  EXCELLENT: 'Excellent Value',
  POSITIVE: 'Positive Value',
  BREAK_EVEN: 'Near Break-Even',
  UNDERUSED: 'Underutilized',
  REVIEW: 'Review Before Renewal',
  NO_DATA: 'No Tracked Benefits',
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
//   isFuture, isCurrent            — is the redemption window ahead / still open
//   isExcluded, excludeReason      — user skipped or snoozed this period
//   isNotYetAvailable              — benefit does not exist yet in this period
//   isOutsideCardOwnership         — card not held during this period
//   usageDate, expirationDate, note, isEstimated
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
    expirationDate: inst.expirationDate || null,
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
    return { ...base, status: STATUS.EXCLUDED, excludedValue: amount, reason: inst.excludeReason || 'Excluded by you' };
  }
  // The window hasn't opened yet. Future credits are never counted as missed.
  if (inst.isFuture) {
    return { ...base, status: STATUS.UPCOMING, upcomingValue: amount };
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

  if (inst.isCurrent) {
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
function rollupStatus(t, instances) {
  const considered = instances.filter(i =>
    i.status !== STATUS.EXCLUDED && i.status !== STATUS.NOT_YET_AVAILABLE && i.status !== STATUS.UNKNOWN);
  if (!considered.length) {
    if (instances.some(i => i.status === STATUS.EXCLUDED)) return STATUS.EXCLUDED;
    if (instances.some(i => i.status === STATUS.NOT_YET_AVAILABLE)) return STATUS.NOT_YET_AVAILABLE;
    return STATUS.UNKNOWN;
  }
  // A $0 / non-monetary benefit the user actually claimed still reads as used —
  // only an unclaimed one is genuinely unknown.
  if (considered.every(i => i.status === STATUS.FULLY_USED)) return STATUS.FULLY_USED;
  if (t.availableValue === 0 && t.upcomingValue > 0) return STATUS.UPCOMING;
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
    notes,
    isEstimated: instances.some(i => i.isEstimated),
    periodsTotal: instances.length,
    periodsUsed: usedInstances.length,
    periodsMissed: missedInstances.length,
    missedPeriodLabels: missedInstances.map(i => i.periodLabel),
    instances,
  };
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
export function assessCard(s) {
  if (s.availableValue === 0 && s.upcomingValue === 0 && s.usedValue === 0) return ASSESSMENTS.NO_DATA;
  const fee = s.annualFee || 0;
  const net = s.netTrackedValue;
  if (fee <= 0) return s.usedValue > 0 ? ASSESSMENTS.EXCELLENT : ASSESSMENTS.UNDERUSED;
  if (net >= fee * 0.25) return ASSESSMENTS.EXCELLENT;
  if (net > 0) return ASSESSMENTS.POSITIVE;
  if (net >= -fee * 0.1) return ASSESSMENTS.BREAK_EVEN;
  if (s.utilizationRate < 0.5) return ASSESSMENTS.REVIEW;
  return ASSESSMENTS.UNDERUSED;
}

function buildCardSummary(card) {
  const benefits = (card.benefits || []).map(b => buildBenefitItem(card.cardId, b));

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
    pointsRedeemed,
    utilizationRate: availableValue > 0 ? usedValue / availableValue : 0,
    netTrackedValue: r2(usedValue + pointsRedeemed - annualFee),
    breakEvenGap: r2(annualFee - usedValue - pointsRedeemed),
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
  const totalPointsRedeemed = sum('pointsRedeemed');

  const withValue = cardSummaries.filter(c => c.availableValue > 0 || c.usedValue > 0);
  const bestCard = withValue.slice().sort((a, b) =>
    (b.netTrackedValue - a.netTrackedValue) || (b.usedValue - a.usedValue))[0] || null;
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
    parts.push(`Your strongest-performing card was the ${report.bestCard.cardName}, which returned ${fmtMoney(report.bestCard.usedValue)} in tracked value against a ${fmtMoney(report.bestCard.annualFee)} annual fee.`);
  }
  if (report.worstCard && report.worstCard.missedValue > 0) {
    const same = report.bestCard && report.worstCard.cardId === report.bestCard.cardId;
    parts.push(`${same ? 'That same card' : `The ${report.worstCard.cardName}`} had the highest amount of unused value at ${fmtMoney(report.worstCard.missedValue)}.`);
  } else if (report.totalMissedValue === 0) {
    parts.push('No tracked benefit expired unused — nothing was forfeited during this period.');
  }

  if (report.totalAnnualFees > 0) {
    const net = report.netTrackedValue;
    parts.push(net >= 0
      ? `After accounting for ${fmtMoney(report.totalAnnualFees)} in annual fees, your tracked benefits produced an estimated net value of ${fmtMoney(net)}.`
      : `After accounting for ${fmtMoney(report.totalAnnualFees)} in annual fees, tracked benefits fall ${fmtMoney(Math.abs(net))} short of covering the fees.`);
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

  if (card.pointsRedeemed > 0) {
    parts.push(`You also recorded ${fmtMoney(card.pointsRedeemed)} in points redemptions on this card.`);
  }

  if (card.annualFee > 0) {
    const realized = r2(card.usedValue + card.pointsRedeemed);
    parts.push(card.netTrackedValue >= 0
      ? `Based on tracked benefits alone, the card returned ${fmtMoney(realized)} against its ${fmtMoney(card.annualFee)} annual fee — a net of ${fmtSignedMoney(card.netTrackedValue)}.`
      : `Based on tracked benefits alone, the card returned ${fmtMoney(realized)} against its ${fmtMoney(card.annualFee)} annual fee, leaving it ${fmtMoney(Math.abs(card.netTrackedValue))} below break-even.`);
  } else {
    parts.push(`This card carries no annual fee, so all ${fmtMoney(card.usedValue)} of tracked value is net positive.`);
  }

  parts.push('Additional value from points earnings, travel protections, lounge access, or transfer partners is not included unless explicitly tracked.');
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
      parts.push(`The largest remaining opportunity is the ${top.benefitName} on the ${card ? card.cardName : 'your card'} at ${fmtMoney(top.remainingValue)}${top.nextExpiration ? `, which expires ${top.nextExpiration}` : ''}.`);
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
      detail: `${fmtMoney(b.remainingValue)} is still available on the ${card ? card.cardName : 'card'}${b.nextExpiration ? `, expiring ${b.nextExpiration}` : ''}. Consider claiming it before the period closes.`,
    });
  });

  // 2. Repeatedly missed recurring credits — reminder or reassignment.
  report.repeatOffenders.slice(0, 3).forEach(b => {
    const card = report.cardSummaries.find(c => c.cardId === b.cardId);
    recs.push({
      priority: 'habit',
      title: `Add a reminder for the ${b.benefitName}`,
      detail: `You missed this ${b.frequencyLabel.toLowerCase()} credit in ${pluralize(b.periodsMissed, 'period')} (${fmtMoney(b.missedValue)} forfeited) on the ${card ? card.cardName : 'card'}. Consider a recurring reminder, or reassigning a regular purchase to this card so the credit clears automatically.`,
    });
  });

  // 3. Cards worth a look before renewal — only where the data supports it.
  report.cardSummaries
    .filter(c => c.annualFee > 0 && (c.assessment === ASSESSMENTS.REVIEW || c.assessment === ASSESSMENTS.UNDERUSED))
    .sort((a, b) => b.breakEvenGap - a.breakEvenGap)
    .slice(0, 3)
    .forEach(c => {
      recs.push({
        priority: 'review',
        title: `Review the ${c.cardName}${c.renewalDate ? ` before its ${c.renewalDate} renewal` : ''}`,
        detail: `You used ${fmtPct(c.utilizationRate)} of its tracked benefits and left ${fmtMoney(c.missedValue)} unused. The card may still be worthwhile if untracked value — lounge access, points earning, protections, or status — is worth at least ${fmtMoney(Math.max(0, c.breakEvenGap))} to you personally.`,
      });
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
    { heading: 'Missed value', body: 'Only value from periods whose redemption window has closed is counted as missed. Current and future periods are never counted as missed; their unclaimed balance is reported as remaining opportunity instead.' },
    { heading: 'Excluded benefits', body: `Benefits you skipped or snoozed are reported as Excluded and are removed from both the utilization denominator and missed value — an intentional pass is not a miss. ${report.totalExcludedValue > 0 ? `${fmtMoney(report.totalExcludedValue)} was excluded on this basis.` : 'Nothing was excluded on this basis in this period.'}` },
    { heading: 'Annual fees', body: `Net tracked value is used value plus recorded points redemptions minus the annual fee that applied in ${report.periodLabel}. Where a card's fee changed, the historical fee for that year is used.` },
    { heading: 'Estimated values', body: report.hasEstimates ? 'Benefits whose value you overrode with a custom amount are marked as estimated in the benefit tables. These reflect your own valuation, not a fixed statement credit.' : 'No benefit values in this report were overridden with custom estimates; all figures use the published credit amounts.' },
    { heading: 'What is excluded', body: 'Points and miles earned from spending, travel and purchase protections, lounge access, elite status, companion certificates, and transfer-partner value are not included. A card can therefore be below break-even here and still be worth keeping.' },
    { heading: 'Report options', body: `Generated with: unused ${opts.includeUnused === false ? 'hidden' : 'shown'}, expired ${opts.includeExpired === false ? 'hidden' : 'shown'}, upcoming ${opts.includeUpcoming === false ? 'hidden' : 'shown'}, notes ${opts.includeNotes === false ? 'hidden' : 'shown'}, grouped by ${opts.groupBy === 'category' ? 'benefit category' : 'card'}.` },
  ];
}
