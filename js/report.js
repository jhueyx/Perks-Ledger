// ── Perks Ledger — report adapter ─────────────────────────────────────────
// Bridges live app state (CARDS + state.DATA + localStorage extras) into the
// dependency-free report model in report-model.js, and serializes the result
// to Markdown / CSV / JSON.
//
// All period math is delegated to periods.js so the report can never drift
// from what the rest of the app shows.

import { CARDS, CARD_LABELS, BENEFIT_CATEGORIES, MONTHS, MONTHS_FULL } from './cards.js';
import { state, CY, CM } from './state.js';
import {
  isUsed, isSkipped, isMonthSnoozed, getPartialUsed, getNote,
  bName, getCardFeeMonth, getCardFeeDay, loadRedemptionMonths, getPointsRedeemedYTD,
  loadCustomAmounts, loadCustomNames, loadPartial, loadNotes, loadCredited,
  loadSkipped, loadSnoozed, loadCardMeta, loadPointsRedeemed, getFeeOverrides, loadPointsSources,
  loadBadges,
} from './storage.js';
import {
  getYTDPeriods, getBAmount, getFee, isBExpired, isBNotAvailable,
} from './periods.js';
import {
  buildPortfolioReport, STATUS, STATUS_LABELS, fmtMoney, fmtPct, fmtSignedMoney,
  generatePortfolioSummary, generateCardNarrative, generateUsagePatternNarrative,
  generateMissedValueNarrative, generateOpportunityNarrative, generateRecommendations,
  generateMethodology, frequencyLabelFor, disambiguateBenefitNames, r2,
} from './report-model.js';

export { STATUS, STATUS_LABELS, fmtMoney, fmtPct, fmtSignedMoney, disambiguateBenefitNames };

// ── Options ────────────────────────────────────────────────────────────────
export const DEFAULT_OPTIONS = {
  year: CY,
  cardIds: null,          // null = every visible card
  includeUnused: true,
  includeExpired: true,
  includeUpcoming: true,
  includeFeeAnalysis: true,
  includeRecommendations: true,
  includeActivity: true,
  includeNotes: true,
  includeEstimated: true,
  includeArtwork: true,   // inline card images (HTML / PDF only)
  groupBy: 'card',        // 'card' | 'category'
  format: 'print',        // 'print' | 'html' | 'markdown'
};

export function normalizeOptions(opts) {
  return { ...DEFAULT_OPTIONS, ...(opts || {}) };
}

/**
 * Collapses a card selection to `null` ("follow my card list") when it covers
 * every card the user currently holds. Storing the keys instead would freeze
 * the selection, so a card added in Settings later would silently stay out of
 * the report. An explicit subset is preserved; keys for cards no longer held
 * are dropped.
 */
export function normalizeCardSelection(cardIds, visible) {
  if (!cardIds || !cardIds.length) return null;
  const picked = cardIds.filter(k => visible.includes(k));
  if (!picked.length) return null;
  return visible.every(k => picked.includes(k)) ? null : picked;
}

/** Years that have any tracked data, plus the current year, newest first. */
export function getReportYears() {
  const years = new Set([CY, CY - 1]);
  Object.values(state.DATA || {}).forEach(byBenefit => {
    Object.entries(byBenefit || {}).forEach(([k, v]) => {
      if (!v) return;
      const m = /__(?:cy-)?(\d{4})/.exec(k) || /__feb-(\d{4})/.exec(k);
      if (m) years.add(Number(m[1]));
    });
  });
  return [...years].filter(y => y >= CY - 6 && y <= CY).sort((a, b) => b - a);
}

// ── Period geometry helpers ────────────────────────────────────────────────
// Absolute month index (year*12 + month) for the first and last calendar month
// a period covers. Used for chronological sorting, expiry dates, and deciding
// whether a card was even held when the period ran.
function periodStartAbs(p) { return p.calY * 12 + p.calM; }

function periodEndAbs(cadence, p) {
  if (p.endY !== undefined && p.endM !== undefined) return p.endY * 12 + p.endM;
  if (p.endM !== undefined) return p.calY * 12 + p.endM;
  if (cadence === 'monthly') return p.calY * 12 + p.calM;
  if (cadence === 'quarterly') return p.calY * 12 + p.calM + 2;
  if (cadence === 'semi-annual' || cadence === 'cal-semi-annual') return p.calY * 12 + p.calM + 5;
  if (cadence === 'feb-annual') return p.calY * 12 + 12;
  return p.calY * 12 + 11;
}

const pad = n => String(n).padStart(2, '0');

/** ISO date of the first day of an absolute month index. */
function absToISOStart(abs) {
  return `${Math.floor(abs / 12)}-${pad((abs % 12) + 1)}-01`;
}
/** ISO date of the last day of an absolute month index. */
function absToISOEnd(abs) {
  const y = Math.floor(abs / 12), m = abs % 12;
  return `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;
}
/** Human label for an ISO date, e.g. 'Dec 31, 2026'. */
export function isoToLabel(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthLabel(y, m) { return `${MONTHS[m]} ${y}`; }

function cardOpenedAbs(cardKey) {
  const meta = (state.cardMeta && state.cardMeta[cardKey]) || loadCardMeta()[cardKey];
  if (meta && meta.openedYear) return meta.openedYear * 12 + (meta.openedMonth ?? 0);
  const y = CARDS[cardKey] && CARDS[cardKey].openedYear;
  return y ? y * 12 : null;
}

function cardClosedAbs(cardKey) {
  const meta = (state.cardMeta && state.cardMeta[cardKey]) || loadCardMeta()[cardKey];
  if (meta && meta.closedYear) return meta.closedYear * 12 + (meta.closedMonth ?? 11);
  return null;
}

function renewalDateLabel(cardKey) {
  const fm = getCardFeeMonth(cardKey), fd = getCardFeeDay(cardKey);
  const now = new Date();
  let year = now.getFullYear();
  if (new Date(year, fm, fd) <= now) year++;
  return `${MONTHS[fm]} ${fd}, ${year}`;
}

// ── Personal value ─────────────────────────────────────────────────────────
// The app already stores per-card+benefit amount overrides ("custom amounts").
// Those are exactly a personal valuation, so the report reuses them rather than
// introducing a second, competing field — no migration required. Face value
// always remains the issuer-published amount from cards.js.
export function getPersonalValue(cardKey, benefitId) {
  const v = loadCustomAmounts()[`${cardKey}__${benefitId}`];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ── Points redemption sources ──────────────────────────────────────────────
export const POINTS_SOURCES = {
  WELCOME_BONUS: 'welcome-bonus',
  ONGOING_SPEND: 'ongoing-spend',
  REFERRAL: 'referral',
  ADJUSTMENT: 'adjustment',
  UNKNOWN: 'unknown',
};

export const POINTS_SOURCE_LABELS = {
  [POINTS_SOURCES.WELCOME_BONUS]: 'Welcome Bonus',
  [POINTS_SOURCES.ONGOING_SPEND]: 'Ongoing Spend',
  [POINTS_SOURCES.REFERRAL]: 'Referral',
  [POINTS_SOURCES.ADJUSTMENT]: 'Adjustment',
  [POINTS_SOURCES.UNKNOWN]: 'Other / Unknown',
};

/**
 * Splits a card's recorded points redemptions by declared source. The app has
 * no way to know where points came from, so nothing is inferred: undeclared
 * entries land in `unknown` and the report carries an explicit caveat rather
 * than presenting first-year value as if it recurs.
 */
export function pointsBreakdownFor(cardKey, year) {
  const byMonth = loadPointsRedeemed()[cardKey] || {};
  const sources = loadPointsSources();
  const out = { total: 0, bySource: {}, hasDeclaredSource: false, welcomeBonusValue: 0, ongoingValue: 0, undeclaredValue: 0 };
  Object.entries(byMonth).forEach(([ym, amt]) => {
    if (!ym.startsWith(`${year}-`)) return;
    const declared = sources[`${cardKey}__${ym}`];
    const src = declared || POINTS_SOURCES.UNKNOWN;
    if (declared) out.hasDeclaredSource = true;
    out.bySource[src] = r2((out.bySource[src] || 0) + amt);
    out.total = r2(out.total + amt);
    // One-off value must be separable from value that plausibly recurs.
    if (src === POINTS_SOURCES.WELCOME_BONUS) out.welcomeBonusValue = r2(out.welcomeBonusValue + amt);
    else if (src === POINTS_SOURCES.ONGOING_SPEND || src === POINTS_SOURCES.REFERRAL) out.ongoingValue = r2(out.ongoingValue + amt);
    else out.undeclaredValue = r2(out.undeclaredValue + amt);
  });
  return out;
}

// ── Input snapshot ─────────────────────────────────────────────────────────
/**
 * Walks every selected card / section / benefit / period and produces the flat
 * snapshot consumed by buildPortfolioReport(). Period enumeration mirrors
 * calcStats() (getYTDPeriods under a temporarily-set state.selectedYear) so the
 * report agrees with the Annual Recap view, but open/closed status comes from
 * each period's real ISO bounds rather than isYTDCurrent(), which has no branch
 * for the annual cadences.
 */
export function buildReportInput(opts, visibleCardKeys) {
  const o = normalizeOptions(opts);
  const year = o.year;
  const cardIds = (o.cardIds && o.cardIds.length ? o.cardIds : visibleCardKeys).filter(k => !!CARDS[k]);
  const redemptions = loadRedemptionMonths();
  const isCurrentYear = year === CY;
  // A completed year is reported as of the day after it ended, so December's
  // window reads as closed too — window bounds are inclusive, so reporting a
  // finished year "as of Dec 31" would leave December looking still open.
  const reportDate = isCurrentYear ? toISODate(new Date()) : `${year + 1}-01-01`;

  const savedYear = state.selectedYear;
  state.selectedYear = year;
  let cards;
  try {
    cards = cardIds.map(cardKey => {
      const card = CARDS[cardKey];
      const openedAbs = cardOpenedAbs(cardKey);
      const closedAbs = cardClosedAbs(cardKey);

      const benefits = [];
      card.sections.forEach(section => {
        const periods = getYTDPeriods(section.cadence);
        section.benefits.forEach(b => {
          const instances = periods.map(p => {
            const faceAmount = getBAmount(b, p);
            const override = getPersonalValue(cardKey, b.id);
            const amount = o.includeEstimated && override !== null ? override : faceAmount;
            const startAbs = periodStartAbs(p);
            const endAbs = periodEndAbs(section.cadence, p);
            const notOffered = isBNotAvailable(b, year, p);
            const retired = isBExpired(b, p);
            const skipped = isSkipped(cardKey, b.id, p.pk);
            const snoozed = isMonthSnoozed(cardKey, b.id, p.calY, p.calM);
            const rd = redemptions[`${cardKey}__${b.id}__${p.pk}`];
            return {
              periodKey: p.pk,
              periodLabel: p.lbl,
              sortKey: startAbs,
              amount,
              faceAmount,
              used: isUsed(cardKey, b.id, p.pk),
              partialUsed: getPartialUsed(cardKey, b.id, p.pk),
              // Real window bounds — the single source of open/closed truth.
              // Clamped to the reporting period so a card-year credit spilling
              // past Dec 31 is not reported as claimable outside the period.
              periodStart: absToISOStart(startAbs),
              periodEnd: absToISOEnd(endAbs),
              reportDate,
              isNotYetAvailable: notOffered || retired,
              isOutsideCardOwnership: (openedAbs !== null && openedAbs > endAbs)
                || (closedAbs !== null && closedAbs < startAbs),
              isExcluded: skipped || snoozed,
              isSnoozed: snoozed && !skipped,
              excludeReason: skipped ? 'Marked skipped' : snoozed ? 'Snoozed for this period' : '',
              usageDate: rd ? monthLabel(rd.year, rd.month) : null,
              note: o.includeNotes ? getNote(cardKey, b.id, p.pk) : '',
              isEstimated: o.includeEstimated && override !== null,
            };
          });

          benefits.push({
            benefitId: b.id,
            benefitName: bName(cardKey, b),
            description: b.desc || '',
            category: BENEFIT_CATEGORIES[b.id] || 'other',
            frequency: section.cadence,
            frequencyLabel: frequencyLabelFor(section.cadence),
            instances,
          });
        });
      });

      return {
        cardId: cardKey,
        cardName: CARD_LABELS[cardKey] || card.name,
        annualFee: getFee(cardKey, year),
        renewalDate: renewalDateLabel(cardKey),
        openedLabel: openedAbs !== null ? monthLabel(Math.floor(openedAbs / 12), openedAbs % 12) : null,
        closedLabel: closedAbs !== null ? monthLabel(Math.floor(closedAbs / 12), closedAbs % 12) : null,
        // A card opened inside the reporting period is in its first year, so any
        // points value on it may be non-recurring welcome-bonus value.
        isFirstYear: openedAbs !== null && openedAbs >= year * 12,
        pointsRedeemed: getPointsRedeemedYTD(cardKey, year),
        pointsBreakdown: pointsBreakdownFor(cardKey, year),
        benefits,
      };
    });
  } finally {
    state.selectedYear = savedYear;
  }

  const periodEndLabel = isCurrentYear ? `${MONTHS_FULL[CM]} ${CY}` : `December ${year}`;
  return {
    title: `${year} Credit Card Benefits Review`,
    periodLabel: isCurrentYear ? `${year} year to date` : `${year}`,
    periodStart: `January 1, ${year}`,
    periodEnd: isCurrentYear ? `${periodEndLabel} (in progress)` : `December 31, ${year}`,
    generatedAt: new Date().toISOString(),
    isPartialPeriod: isCurrentYear,
    cards,
    options: o,
  };
}

/** Build the full report plus every narrative string, ready to render. */
export function generateReport(opts, visibleCardKeys) {
  const input = buildReportInput(opts, visibleCardKeys);
  const report = buildPortfolioReport(input);
  report.narratives = {
    summary: generatePortfolioSummary(report),
    usage: generateUsagePatternNarrative(report),
    missed: generateMissedValueNarrative(report),
    opportunity: generateOpportunityNarrative(report),
  };
  report.cardSummaries.forEach(c => { c.narrative = generateCardNarrative(c); });
  report.recommendations = generateRecommendations(report);
  report.methodology = generateMethodology(report);
  return report;
}

// ── Visibility filter shared by every renderer ─────────────────────────────
/** Should this benefit appear in the detailed activity tables? */
export function benefitVisible(b, o) {
  if (b.status === STATUS.UNUSED && !o.includeUnused) return false;
  if ((b.status === STATUS.EXPIRED_UNUSED || b.status === STATUS.EXPIRED_PARTIALLY_USED) && !o.includeExpired) return false;
  if ((b.status === STATUS.UPCOMING || b.status === STATUS.NOT_YET_AVAILABLE) && !o.includeUpcoming) return false;
  if ((b.status === STATUS.EXCLUDED || b.status === STATUS.SNOOZED) && !o.includeUnused) return false;
  return true;
}

/** Group a card's benefits either by section cadence or by benefit category. */
export function groupBenefits(benefits, groupBy) {
  const map = new Map();
  benefits.forEach(b => {
    const key = groupBy === 'category' ? (b.category || 'other') : b.frequencyLabel;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(b);
  });
  return [...map.entries()].map(([label, items]) => ({
    label: groupBy === 'category' ? label.charAt(0).toUpperCase() + label.slice(1) : label,
    items: items.slice().sort((a, b) => (a.instances[0]?.sortKey ?? 0) - (b.instances[0]?.sortKey ?? 0)),
  }));
}

// ══════════════════════════════════════════════════════════════════════════
// Serializers
// ══════════════════════════════════════════════════════════════════════════

export function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Row-per-benefit-period CSV — the auditable raw record behind the report. */
export function reportToCSV(report) {
  const header = ['Card', 'Annual Fee', 'Benefit', 'Category', 'Frequency', 'Period',
    'Available', 'Used', 'Remaining', 'Missed', 'Status', 'Usage Date', 'Expires', 'Estimated', 'Note'];
  const lines = [header.join(',')];
  report.cardSummaries.forEach(c => {
    c.benefits.forEach(b => {
      b.instances.forEach(i => {
        lines.push([
          csvCell(c.cardName), c.annualFee, csvCell(b.displayName || b.benefitName), csvCell(b.category),
          csvCell(b.frequencyLabel), csvCell(i.periodLabel),
          i.availableValue.toFixed(2), i.usedValue.toFixed(2),
          i.remainingValue.toFixed(2), i.missedValue.toFixed(2),
          csvCell(STATUS_LABELS[i.status] || i.status),
          csvCell(i.usageDate || ''), csvCell(i.expirationDate || ''),
          i.isEstimated ? 'yes' : 'no', csvCell(i.note || ''),
        ].join(','));
      });
    });
  });
  return lines.join('\n');
}

/** Card-level summary CSV — the portfolio scorecard as a spreadsheet. */
export function scorecardToCSV(report) {
  const header = ['Card', 'Annual Fee', 'Available Benefit Value', 'Redeemed Benefit Value',
    'Expired Benefit Value', 'Still Claimable Value', 'Recorded Points Redemption Value',
    'Net Benefit Value After Fees', 'Total Tracked Value After Fees',
    'Benefit Utilization Rate', 'Benefits Used', 'Benefits Missed', 'Overall Status'];
  const lines = [header.join(',')];
  report.cardSummaries.forEach(c => {
    lines.push([
      csvCell(c.cardName), c.annualFee.toFixed(2), c.availableValue.toFixed(2),
      c.usedValue.toFixed(2), c.missedValue.toFixed(2), c.remainingAvailableValue.toFixed(2),
      c.recordedPointsRedemptionValue.toFixed(2),
      c.netBenefitValueAfterFees.toFixed(2), c.totalTrackedValueAfterFees.toFixed(2),
      `${Math.round(c.utilizationRate * 100)}%`,
      c.benefitsUsed, c.benefitsMissed, csvCell(c.assessment),
    ].join(','));
  });
  lines.push([
    'TOTAL', report.totalAnnualFees.toFixed(2), report.totalAvailableValue.toFixed(2),
    report.redeemedBenefitValue.toFixed(2), report.totalMissedValue.toFixed(2),
    report.totalRemainingAvailableValue.toFixed(2), report.recordedPointsRedemptionValue.toFixed(2),
    report.netBenefitValueAfterFees.toFixed(2), report.totalTrackedValueAfterFees.toFixed(2),
    `${Math.round(report.utilizationRate * 100)}%`, '', '', '',
  ].join(','));
  return lines.join('\n');
}

export function reportToMarkdown(report) {
  const o = report.options;
  const L = [];
  const gen = new Date(report.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  L.push(`# ${report.title}`, '');
  L.push('**Perks Ledger**', '');
  L.push(`| | |`, `|---|---|`);
  L.push(`| Reporting period | ${report.periodStart} – ${report.periodEnd} |`);
  L.push(`| Report generated | ${gen} |`);
  L.push(`| Active cards | ${report.cardCount} |`);
  L.push(`| Total annual fees | ${fmtMoney(report.totalAnnualFees)} |`);
  L.push(`| Total available benefit value | ${fmtMoney(report.totalAvailableValue)} |`);
  L.push(`| Redeemed benefit value | ${fmtMoney(report.redeemedBenefitValue)} |`);
  L.push(`| Expired benefit value | ${fmtMoney(report.totalMissedValue)} |`);
  L.push(`| Still claimable benefit value | ${fmtMoney(report.totalRemainingAvailableValue)} |`);
  L.push(`| Recorded points redemption value | ${fmtMoney(report.recordedPointsRedemptionValue)} |`);
  L.push(`| Net benefit value after fees | ${fmtSignedMoney(report.netBenefitValueAfterFees)} |`);
  L.push(`| Total tracked value after fees | ${fmtSignedMoney(report.totalTrackedValueAfterFees)} |`, '');

  L.push('## Executive Summary', '', report.narratives.summary, '');

  L.push('## Portfolio Scorecard', '');
  L.push('| Card | Annual Fee | Available | Redeemed | Expired | Still Claimable | Points | Net Benefit | Total Tracked | Utilization | Status |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  report.cardSummaries.forEach(c => {
    L.push(`| ${c.cardName} | ${fmtMoney(c.annualFee)} | ${fmtMoney(c.availableValue)} | ${fmtMoney(c.usedValue)} | ${fmtMoney(c.missedValue)} | ${fmtMoney(c.remainingAvailableValue)} | ${fmtMoney(c.recordedPointsRedemptionValue)} | ${fmtSignedMoney(c.netBenefitValueAfterFees)} | ${fmtSignedMoney(c.totalTrackedValueAfterFees)} | ${fmtPct(c.utilizationRate)} | ${c.assessment} |`);
  });
  L.push(`| **Total** | **${fmtMoney(report.totalAnnualFees)}** | **${fmtMoney(report.totalAvailableValue)}** | **${fmtMoney(report.redeemedBenefitValue)}** | **${fmtMoney(report.totalMissedValue)}** | **${fmtMoney(report.totalRemainingAvailableValue)}** | **${fmtMoney(report.recordedPointsRedemptionValue)}** | **${fmtSignedMoney(report.netBenefitValueAfterFees)}** | **${fmtSignedMoney(report.totalTrackedValueAfterFees)}** | **${fmtPct(report.utilizationRate)}** | |`, '');

  L.push('## Card-by-Card Review', '');
  report.cardSummaries.forEach(c => {
    L.push(`### ${c.cardName}`, '');
    L.push(`- Annual fee: ${fmtMoney(c.annualFee)}`);
    if (c.renewalDate) L.push(`- Next renewal: ${c.renewalDate}`);
    if (c.openedLabel) L.push(`- Card opened: ${c.openedLabel}`);
    L.push(`- Available benefit value: ${fmtMoney(c.availableValue)}`);
    L.push(`- Redeemed benefit value: ${fmtMoney(c.usedValue)}`);
    L.push(`- Expired benefit value: ${fmtMoney(c.missedValue)}`);
    L.push(`- Still claimable benefit value: ${fmtMoney(c.remainingAvailableValue)}`);
    L.push(`- Recorded points redemption value: ${fmtMoney(c.recordedPointsRedemptionValue)}`);
    L.push(`- Net benefit value after fee: ${fmtSignedMoney(c.netBenefitValueAfterFees)}`);
    L.push(`- Total tracked value after fee: ${fmtSignedMoney(c.totalTrackedValueAfterFees)}`);
    L.push(`- Utilization: ${fmtPct(c.utilizationRate)}`);
    L.push(`- Assessment: **${c.assessment}**`, '');
    L.push(c.narrative, '');

    if (o.includeActivity) {
      const visible = c.benefits.filter(b => benefitVisible(b, o));
      if (visible.length) {
        L.push('#### Benefit activity', '');
        groupBenefits(visible, o.groupBy).forEach(g => {
          L.push(`**${g.label}**`, '');
          L.push('| Benefit | Category | Available | Used | Remaining | Status | Used on | Expires |');
          L.push('|---|---|---:|---:|---:|---|---|---|');
          g.items.forEach(b => {
            L.push(`| ${(b.displayName || b.benefitName)}${b.isEstimated ? ' *(personal value)*' : ''} | ${b.category} | ${fmtMoney(b.availableValue)} | ${fmtMoney(b.usedValue)} | ${fmtMoney(b.remainingValue)} | ${STATUS_LABELS[b.status]} | ${b.usageDates.join(', ') || '—'} | ${isoToLabel(b.statusExpiration || b.nextExpiration || b.expirationDate) || '—'} |`);
          });
          L.push('');
          if (o.includeNotes) {
            g.items.filter(b => b.notes.length).forEach(b => {
              b.notes.forEach(n => L.push(`> *${b.benefitName} — ${n.period}:* ${n.note}`));
            });
            if (g.items.some(b => b.notes.length)) L.push('');
          }
        });
      }
    }
  });

  L.push('## Used Benefits', '', report.narratives.usage, '');
  const used = report.cardSummaries.flatMap(c => c.benefits).filter(b => b.usedValue > 0);
  if (used.length) {
    L.push('| Benefit | Card | Category | Used | Periods used | Status |');
    L.push('|---|---|---|---:|:---:|---|');
    used.sort((a, b) => b.usedValue - a.usedValue).forEach(b => {
      const card = report.cardSummaries.find(c => c.cardId === b.cardId);
      L.push(`| ${b.displayName || b.benefitName} | ${card ? card.cardName : ''} | ${b.category} | ${fmtMoney(b.usedValue)} | ${b.periodsUsed} | ${STATUS_LABELS[b.status]} |`);
    });
    L.push('');
  }
  L.push('**Usage by category**', '');
  L.push('| Category | Available | Used | Utilization |', '|---|---:|---:|---:|');
  report.usageByCategory.forEach(c => L.push(`| ${c.label} | ${fmtMoney(c.availableValue)} | ${fmtMoney(c.usedValue)} | ${fmtPct(c.utilizationRate)} |`));
  L.push('');

  L.push('## Missed and Unused Benefits', '', report.narratives.missed, '');
  const missed = report.cardSummaries.flatMap(c => c.benefits).filter(b => b.missedValue > 0);
  if (missed.length) {
    L.push('| Benefit | Card | Category | Missed | Periods missed | Status |');
    L.push('|---|---|---|---:|:---:|---|');
    missed.sort((a, b) => b.missedValue - a.missedValue).forEach(b => {
      const card = report.cardSummaries.find(c => c.cardId === b.cardId);
      L.push(`| ${b.displayName || b.benefitName} | ${card ? card.cardName : ''} | ${b.category} | ${fmtMoney(b.missedValue)} | ${b.periodsMissed} | ${STATUS_LABELS[b.status]} |`);
    });
    L.push('');
  }

  L.push('## Expiration and Upcoming Opportunities', '', report.narratives.opportunity, '');
  if (report.openOpportunities.length) {
    L.push('| Benefit | Card | Remaining | Expires |', '|---|---|---:|---|');
    report.openOpportunities.forEach(b => {
      const card = report.cardSummaries.find(c => c.cardId === b.cardId);
      L.push(`| ${b.displayName || b.benefitName} | ${card ? card.cardName : ''} | ${fmtMoney(b.remainingValue)} | ${isoToLabel(b.nextExpiration) || '—'} |`);
    });
    L.push('');
  }

  if (o.includeFeeAnalysis) {
    L.push('## Annual Fee Analysis', '');
    L.push('| Card | Annual Fee | Redeemed Benefit Value | Points Redemption Value | Net Benefit After Fees | Total Tracked After Fees | Still Claimable | Break-even Gap |');
    L.push('|---|---:|---:|---:|---:|---:|---:|---:|');
    report.cardSummaries.forEach(c => {
      L.push(`| ${c.cardName} | ${fmtMoney(c.annualFee)} | ${fmtMoney(c.usedValue)} | ${fmtMoney(c.recordedPointsRedemptionValue)} | ${fmtSignedMoney(c.netBenefitValueAfterFees)} | ${fmtSignedMoney(c.totalTrackedValueAfterFees)} | ${fmtMoney(c.remainingAvailableValue)} | ${c.breakEvenGap > 0 ? fmtMoney(c.breakEvenGap) : 'covered'} |`);
    });
    L.push('');
    L.push('Objective statement credits and reimbursements are counted at face value. Values you overrode with a custom amount are your own estimates. Untracked value — points multipliers, purchase and travel protections, elite status, lounge access, and transfer partners — is not included, so a card below break-even here may still be worth keeping.', '');
  }

  if (o.includeRecommendations) {
    L.push('## Recommendations', '');
    report.recommendations.forEach((r, i) => L.push(`${i + 1}. **${r.title}** — ${r.detail}`));
    L.push('');
  }

  L.push('## Methodology and Assumptions', '');
  report.methodology.forEach(m => L.push(`**${m.heading}.** ${m.body}`, ''));
  L.push('---', '', `*Generated by Perks Ledger on ${gen}. Informational only — not financial advice.*`);
  return L.join('\n');
}

/** Full JSON backup: the raw tracked records plus the computed report. */
export function buildJSONBackup(report) {
  return {
    app: 'Perks Ledger',
    schema: 1,
    exportedAt: new Date().toISOString(),
    reportPeriod: { label: report.periodLabel, start: report.periodStart, end: report.periodEnd },
    raw: {
      benefitData: state.DATA,
      customAmounts: loadCustomAmounts(),
      customNames: loadCustomNames(),
      partial: loadPartial(),
      notes: loadNotes(),
      credited: loadCredited(),
      skipped: loadSkipped(),
      snoozed: loadSnoozed(),
      cardMeta: loadCardMeta(),
      badges: loadBadges(),
      redemptionMonths: loadRedemptionMonths(),
      pointsRedeemed: loadPointsRedeemed(),
      pointsSources: loadPointsSources(),
      feeOverrides: getFeeOverrides(),
      cardOrder: JSON.parse(localStorage.getItem('perks-card-order') || '[]'),
    },
    report: {
      ...report,
      cardSummaries: report.cardSummaries.map(c => ({ ...c, narrative: c.narrative })),
    },
  };
}

// ── Download helper ────────────────────────────────────────────────────────
export function downloadFile(filename, contents, mime) {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
