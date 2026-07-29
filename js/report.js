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
  isUsed, isSkipped, isMonthSnoozed, getPartialUsed, getNote, getEffectiveAmount,
  bName, getCardFeeMonth, getCardFeeDay, loadRedemptionMonths, getPointsRedeemedYTD,
  loadCustomAmounts, loadCustomNames, loadPartial, loadNotes, loadCredited,
  loadSkipped, loadSnoozed, loadCardMeta, loadPointsRedeemed, getFeeOverrides,
} from './storage.js';
import {
  getYTDPeriods, isPFuture, isYTDCurrent, getBAmount, getFee, isBExpired, isBNotAvailable,
} from './periods.js';
import {
  buildPortfolioReport, STATUS, STATUS_LABELS, fmtMoney, fmtPct, fmtSignedMoney,
  generatePortfolioSummary, generateCardNarrative, generateUsagePatternNarrative,
  generateMissedValueNarrative, generateOpportunityNarrative, generateRecommendations,
  generateMethodology, frequencyLabelFor,
} from './report-model.js';

export { STATUS, STATUS_LABELS, fmtMoney, fmtPct, fmtSignedMoney };

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

function absToDateLabel(abs) {
  const y = Math.floor(abs / 12), m = abs % 12;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return `${MONTHS[m]} ${lastDay}, ${y}`;
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

// ── Input snapshot ─────────────────────────────────────────────────────────
/**
 * Walks every selected card / section / benefit / period and produces the flat
 * snapshot consumed by buildPortfolioReport(). Mirrors calcStats()'s traversal
 * (getYTDPeriods + isYTDCurrent under a temporarily-set state.selectedYear) so
 * the report agrees with the Annual Recap view.
 */
export function buildReportInput(opts, visibleCardKeys) {
  const o = normalizeOptions(opts);
  const year = o.year;
  const cardIds = (o.cardIds && o.cardIds.length ? o.cardIds : visibleCardKeys).filter(k => !!CARDS[k]);
  const redemptions = loadRedemptionMonths();
  const isCurrentYear = year === CY;

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
            const rawAmount = getBAmount(b, p);
            const amount = o.includeEstimated ? getEffectiveAmount(cardKey, b.id, rawAmount) : rawAmount;
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
              used: isUsed(cardKey, b.id, p.pk),
              partialUsed: getPartialUsed(cardKey, b.id, p.pk),
              isFuture: isPFuture(p),
              isCurrent: isYTDCurrent(section.cadence, p),
              isNotYetAvailable: notOffered || retired,
              isOutsideCardOwnership: (openedAbs !== null && openedAbs > endAbs)
                || (closedAbs !== null && closedAbs < startAbs),
              isExcluded: skipped || snoozed,
              excludeReason: skipped ? 'Marked skipped' : snoozed ? 'Snoozed for this period' : '',
              usageDate: rd ? monthLabel(rd.year, rd.month) : null,
              expirationDate: absToDateLabel(endAbs),
              note: o.includeNotes ? getNote(cardKey, b.id, p.pk) : '',
              isEstimated: amount !== rawAmount,
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
        pointsRedeemed: getPointsRedeemedYTD(cardKey, year),
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
  if (b.status === STATUS.EXCLUDED && !o.includeUnused) return false;
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
          csvCell(c.cardName), c.annualFee, csvCell(b.benefitName), csvCell(b.category),
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
  const header = ['Card', 'Annual Fee', 'Available Benefit Value', 'Used Value', 'Missed Value',
    'Remaining Value', 'Utilization Rate', 'Net Value', 'Benefits Used', 'Benefits Missed', 'Overall Status'];
  const lines = [header.join(',')];
  report.cardSummaries.forEach(c => {
    lines.push([
      csvCell(c.cardName), c.annualFee.toFixed(2), c.availableValue.toFixed(2),
      c.usedValue.toFixed(2), c.missedValue.toFixed(2), c.remainingAvailableValue.toFixed(2),
      `${Math.round(c.utilizationRate * 100)}%`, c.netTrackedValue.toFixed(2),
      c.benefitsUsed, c.benefitsMissed, csvCell(c.assessment),
    ].join(','));
  });
  lines.push([
    'TOTAL', report.totalAnnualFees.toFixed(2), report.totalAvailableValue.toFixed(2),
    report.totalUsedValue.toFixed(2), report.totalMissedValue.toFixed(2),
    report.totalRemainingAvailableValue.toFixed(2), `${Math.round(report.utilizationRate * 100)}%`,
    report.netTrackedValue.toFixed(2), '', '', '',
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
  L.push(`| Total redeemed value | ${fmtMoney(report.totalUsedValue)} |`);
  L.push(`| Total unused or expired value | ${fmtMoney(report.totalMissedValue)} |`);
  L.push(`| Still available (not expired) | ${fmtMoney(report.totalRemainingAvailableValue)} |`);
  L.push(`| Net value after annual fees | ${fmtSignedMoney(report.netTrackedValue)} |`, '');

  L.push('## Executive Summary', '', report.narratives.summary, '');

  L.push('## Portfolio Scorecard', '');
  L.push('| Card | Annual Fee | Available | Used | Missed | Utilization | Net Value | Used / Missed | Status |');
  L.push('|---|---:|---:|---:|---:|---:|---:|:---:|---|');
  report.cardSummaries.forEach(c => {
    L.push(`| ${c.cardName} | ${fmtMoney(c.annualFee)} | ${fmtMoney(c.availableValue)} | ${fmtMoney(c.usedValue)} | ${fmtMoney(c.missedValue)} | ${fmtPct(c.utilizationRate)} | ${fmtSignedMoney(c.netTrackedValue)} | ${c.benefitsUsed} / ${c.benefitsMissed} | ${c.assessment} |`);
  });
  L.push(`| **Total** | **${fmtMoney(report.totalAnnualFees)}** | **${fmtMoney(report.totalAvailableValue)}** | **${fmtMoney(report.totalUsedValue)}** | **${fmtMoney(report.totalMissedValue)}** | **${fmtPct(report.utilizationRate)}** | **${fmtSignedMoney(report.netTrackedValue)}** | | |`, '');

  L.push('## Card-by-Card Review', '');
  report.cardSummaries.forEach(c => {
    L.push(`### ${c.cardName}`, '');
    L.push(`- Annual fee: ${fmtMoney(c.annualFee)}`);
    if (c.renewalDate) L.push(`- Next renewal: ${c.renewalDate}`);
    if (c.openedLabel) L.push(`- Card opened: ${c.openedLabel}`);
    L.push(`- Available benefit value: ${fmtMoney(c.availableValue)}`);
    L.push(`- Realized value: ${fmtMoney(c.usedValue)}${c.pointsRedeemed > 0 ? ` (+ ${fmtMoney(c.pointsRedeemed)} points redeemed)` : ''}`);
    L.push(`- Unused / expired value: ${fmtMoney(c.missedValue)}`);
    L.push(`- Still available: ${fmtMoney(c.remainingAvailableValue)}`);
    L.push(`- Net value after annual fee: ${fmtSignedMoney(c.netTrackedValue)}`);
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
            L.push(`| ${b.benefitName}${b.isEstimated ? ' *(est.)*' : ''} | ${b.category} | ${fmtMoney(b.availableValue)} | ${fmtMoney(b.usedValue)} | ${fmtMoney(b.remainingValue)} | ${STATUS_LABELS[b.status]} | ${b.usageDates.join(', ') || '—'} | ${b.nextExpiration || b.expirationDate || '—'} |`);
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
      L.push(`| ${b.benefitName} | ${card ? card.cardName : ''} | ${b.category} | ${fmtMoney(b.usedValue)} | ${b.periodsUsed} | ${STATUS_LABELS[b.status]} |`);
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
      L.push(`| ${b.benefitName} | ${card ? card.cardName : ''} | ${b.category} | ${fmtMoney(b.missedValue)} | ${b.periodsMissed} | ${STATUS_LABELS[b.status]} |`);
    });
    L.push('');
  }

  L.push('## Expiration and Upcoming Opportunities', '', report.narratives.opportunity, '');
  if (report.openOpportunities.length) {
    L.push('| Benefit | Card | Remaining | Expires |', '|---|---|---:|---|');
    report.openOpportunities.forEach(b => {
      const card = report.cardSummaries.find(c => c.cardId === b.cardId);
      L.push(`| ${b.benefitName} | ${card ? card.cardName : ''} | ${fmtMoney(b.remainingValue)} | ${b.nextExpiration || '—'} |`);
    });
    L.push('');
  }

  if (o.includeFeeAnalysis) {
    L.push('## Annual Fee Analysis', '');
    L.push('| Card | Annual Fee | Realized Tracked Value | Net Tracked Value | Still Claimable | Break-even Gap |');
    L.push('|---|---:|---:|---:|---:|---:|');
    report.cardSummaries.forEach(c => {
      L.push(`| ${c.cardName} | ${fmtMoney(c.annualFee)} | ${fmtMoney(c.usedValue + c.pointsRedeemed)} | ${fmtSignedMoney(c.netTrackedValue)} | ${fmtMoney(c.remainingAvailableValue)} | ${c.breakEvenGap > 0 ? fmtMoney(c.breakEvenGap) : 'covered'} |`);
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
      pointsRedeemed: loadPointsRedeemed(),
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
