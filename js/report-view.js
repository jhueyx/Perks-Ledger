// ── Perks Ledger — Export & Reports view ──────────────────────────────────
// Renders the export hub, the Detailed Report configuration modal, and the
// print-optimized report document. All numbers come from report.js /
// report-model.js — nothing is recalculated here.

import { CARDS, CARD_LABELS } from './cards.js';
import { state, escapeHtml, CY } from './state.js';
import { set, getVisibleCardKeys } from './views.js';
import {
  normalizeOptions, normalizeCardSelection, getReportYears, generateReport,
  reportToMarkdown, reportToCSV, scorecardToCSV, buildJSONBackup, downloadFile,
  benefitVisible, groupBenefits, STATUS, STATUS_LABELS, fmtMoney, fmtPct, fmtSignedMoney, isoToLabel,
} from './report.js';

const E = escapeHtml;

// ── Report options (persisted so the modal remembers your last run) ────────
const OPTS_KEY = 'perks-report-options';

export function getReportOptions() {
  if (!state._reportOpts) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}'); } catch (e) { saved = {}; }
    state._reportOpts = normalizeOptions({ ...saved, year: saved.year && saved.year <= CY ? saved.year : CY });
  }
  return state._reportOpts;
}

function saveReportOptions(o) {
  const next = normalizeOptions(o);
  next.cardIds = normalizeCardSelection(next.cardIds, getVisibleCardKeys());
  state._reportOpts = next;
  try { localStorage.setItem(OPTS_KEY, JSON.stringify(next)); } catch (e) {}
  return next;
}

function selectedCardKeys(o) {
  const visible = getVisibleCardKeys();
  return normalizeCardSelection(o.cardIds, visible) || visible;
}

// ══════════════════════════════════════════════════════════════════════════
// Export hub view
// ══════════════════════════════════════════════════════════════════════════
export function renderExportReport() {
  const o = getReportOptions();
  const cards = getVisibleCardKeys();

  const html = `
    <div class="banner"><strong>Export &amp; Reports</strong> — turn your tracked benefits into a shareable review, or take your raw data with you.</div>

    <div class="rpt-choices">
      <button class="rpt-choice rpt-choice-primary" onclick="openReportConfig()">
        <div class="rpt-choice-title">Detailed Report</div>
        <div class="rpt-choice-desc">A written benefits review — executive summary, portfolio scorecard, card-by-card narrative, missed value, and recommendations. Print-ready.</div>
        <div class="rpt-choice-tag">HTML · PDF · Markdown</div>
      </button>
      <button class="rpt-choice" onclick="downloadReportCSV()">
        <div class="rpt-choice-title">CSV / Raw Data</div>
        <div class="rpt-choice-desc">Every benefit period as a spreadsheet row — available, used, remaining, missed, status, dates, and notes.</div>
        <div class="rpt-choice-tag">2 files · .csv</div>
      </button>
      <button class="rpt-choice" onclick="downloadReportJSON()">
        <div class="rpt-choice-title">JSON Backup</div>
        <div class="rpt-choice-desc">A complete snapshot of your tracked usage, custom amounts, notes, skips, snoozes, and computed report.</div>
        <div class="rpt-choice-tag">.json</div>
      </button>
    </div>

    <div class="rpt-hint" id="reportHint">${hintHTML(o, cards)}</div>

    <div id="reportPreview"></div>
  `;
  set(html);
}

function hintHTML(o, cards) {
  const n = (o.cardIds && o.cardIds.length ? o.cardIds : cards).length;
  return `Reporting period: <strong>${o.year === CY ? `${CY} year to date` : o.year}</strong> · ${n} card${n === 1 ? '' : 's'} included`;
}

// ══════════════════════════════════════════════════════════════════════════
// Configuration modal
// ══════════════════════════════════════════════════════════════════════════
const TOGGLES = [
  ['includeUnused', 'Unused benefits', 'Benefits still available with nothing claimed yet'],
  ['includeExpired', 'Expired benefits', 'Windows that closed with value left unclaimed'],
  ['includeUpcoming', 'Upcoming benefits', 'Credits that have not become available yet'],
  ['includeActivity', 'Detailed benefit activity', 'Per-period tables inside each card section'],
  ['includeFeeAnalysis', 'Annual fee analysis', 'Fee vs realized value and break-even gap'],
  ['includeRecommendations', 'Recommendations', 'Evidence-based suggestions drawn from your data'],
  ['includeNotes', 'My notes', 'Notes you recorded against individual redemptions'],
  ['includeEstimated', 'Estimated / custom values', 'Use your overridden amounts instead of face value'],
  ['includeArtwork', 'Card artwork', 'Show each card’s image (HTML and PDF only, not Markdown)'],
];

export function openReportConfig() {
  const o = getReportOptions();
  const years = getReportYears();
  const cards = getVisibleCardKeys();
  const chosen = new Set(o.cardIds && o.cardIds.length ? o.cardIds : cards);

  let overlay = document.getElementById('reportConfigModal');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'reportConfigModal';
  overlay.innerHTML = `
    <div class="modal rpt-config" style="max-width:560px;max-height:86vh;overflow-y:auto">
      <div class="modal-title">Detailed Report</div>
      <div class="modal-sub">Choose what to include. The defaults produce a complete review.</div>

      <div class="rpt-cfg-group">
        <div class="rpt-cfg-label">Reporting period</div>
        <div class="rpt-cfg-chips" id="rptYears">
          ${years.map(y => `<button class="rpt-chip${y === o.year ? ' active' : ''}" data-year="${y}">${y === CY ? `${y} YTD` : y}</button>`).join('')}
        </div>
      </div>

      <div class="rpt-cfg-group">
        <div class="rpt-cfg-label">Cards <button class="rpt-mini" id="rptAllCards">Select all</button></div>
        <div class="rpt-cfg-chips" id="rptCards">
          ${cards.map(k => `<button class="rpt-chip${chosen.has(k) ? ' active' : ''}" data-card="${E(k)}">${E(CARD_LABELS[k] || CARDS[k].name)}</button>`).join('')}
        </div>
      </div>

      <div class="rpt-cfg-group">
        <div class="rpt-cfg-label">Include</div>
        ${TOGGLES.map(([key, label, desc]) => `
          <label class="rpt-cfg-row">
            <input type="checkbox" data-opt="${key}" ${o[key] ? 'checked' : ''}>
            <span><span class="rpt-cfg-row-title">${label}</span><span class="rpt-cfg-row-desc">${desc}</span></span>
          </label>`).join('')}
      </div>

      <div class="rpt-cfg-group">
        <div class="rpt-cfg-label">Group benefits by</div>
        <div class="rpt-cfg-chips" id="rptGroup">
          <button class="rpt-chip${o.groupBy === 'card' ? ' active' : ''}" data-group="card">Cadence within card</button>
          <button class="rpt-chip${o.groupBy === 'category' ? ' active' : ''}" data-group="category">Benefit category</button>
        </div>
      </div>

      <div class="rpt-cfg-group">
        <div class="rpt-cfg-label">Export format</div>
        <div class="rpt-cfg-chips" id="rptFormat">
          <button class="rpt-chip${o.format === 'print' ? ' active' : ''}" data-format="print">Print / PDF</button>
          <button class="rpt-chip${o.format === 'html' ? ' active' : ''}" data-format="html">HTML file</button>
          <button class="rpt-chip${o.format === 'markdown' ? ' active' : ''}" data-format="markdown">Markdown</button>
        </div>
      </div>

      <div class="modal-actions">
        <button class="modal-btn" id="rptCancel">Cancel</button>
        <button class="modal-btn" id="rptPreview">Preview in app</button>
        <button class="modal-btn primary" id="rptGenerate">Generate</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const draft = { ...o, cardIds: [...chosen] };

  overlay.querySelector('#rptYears').addEventListener('click', e => {
    const b = e.target.closest('[data-year]'); if (!b) return;
    draft.year = Number(b.dataset.year);
    overlay.querySelectorAll('#rptYears .rpt-chip').forEach(x => x.classList.toggle('active', x === b));
  });
  overlay.querySelector('#rptCards').addEventListener('click', e => {
    const b = e.target.closest('[data-card]'); if (!b) return;
    const k = b.dataset.card;
    const i = draft.cardIds.indexOf(k);
    if (i >= 0) { if (draft.cardIds.length === 1) return; draft.cardIds.splice(i, 1); }
    else draft.cardIds.push(k);
    b.classList.toggle('active', draft.cardIds.includes(k));
  });
  overlay.querySelector('#rptAllCards').addEventListener('click', e => {
    e.preventDefault();
    draft.cardIds = [...cards];
    overlay.querySelectorAll('#rptCards .rpt-chip').forEach(x => x.classList.add('active'));
  });
  overlay.querySelector('#rptGroup').addEventListener('click', e => {
    const b = e.target.closest('[data-group]'); if (!b) return;
    draft.groupBy = b.dataset.group;
    overlay.querySelectorAll('#rptGroup .rpt-chip').forEach(x => x.classList.toggle('active', x === b));
  });
  overlay.querySelector('#rptFormat').addEventListener('click', e => {
    const b = e.target.closest('[data-format]'); if (!b) return;
    draft.format = b.dataset.format;
    overlay.querySelectorAll('#rptFormat .rpt-chip').forEach(x => x.classList.toggle('active', x === b));
  });
  overlay.querySelectorAll('[data-opt]').forEach(cb => {
    cb.addEventListener('change', () => { draft[cb.dataset.opt] = cb.checked; });
  });

  const close = () => overlay.remove();
  overlay.querySelector('#rptCancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#rptPreview').addEventListener('click', () => {
    saveReportOptions(draft); close(); previewReport();
  });
  overlay.querySelector('#rptGenerate').addEventListener('click', () => {
    const o2 = saveReportOptions(draft); close();
    if (o2.format === 'markdown') downloadReportMarkdown();
    else if (o2.format === 'html') downloadReportHTML();
    else openPrintableReport();
  });
}

// ══════════════════════════════════════════════════════════════════════════
// Report generation entry points
// ══════════════════════════════════════════════════════════════════════════
async function build({ artwork = true } = {}) {
  const o = getReportOptions();
  const report = generateReport({ ...o, cardIds: selectedCardKeys(o) }, getVisibleCardKeys());
  if (artwork && o.includeArtwork) await embedCardArtwork(report);
  return report;
}

// ── Card artwork ───────────────────────────────────────────────────────────
/**
 * cardKey → absolute image URL, read straight off the card selector so the
 * mapping can never drift from the <img> tags in index.html.
 */
function cardArtworkSources() {
  const map = {};
  document.querySelectorAll('.card-btn[data-card] img').forEach(img => {
    const host = img.closest('[data-card]');
    if (host && img.src) map[host.dataset.card] = img.src; // .src is absolute
  });
  return map;
}

/**
 * Downscales each card image and inlines it as a data URI. The report has to be
 * self-contained: the print window is written into about:blank and the HTML
 * export may be opened from disk, so relative asset paths would not resolve.
 * Artwork is decorative — a card whose image fails to load simply renders
 * without one.
 */
async function embedCardArtwork(report) {
  const sources = cardArtworkSources();
  await Promise.all(report.cardSummaries.map(async c => {
    const src = sources[c.cardId];
    if (!src) return;
    try { c.artwork = await imageToDataURI(src, 420); } catch (e) { /* decorative only */ }
  }));
}

function imageToDataURI(src, maxWidth) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const scale = Math.min(1, maxWidth / (img.naturalWidth || maxWidth));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.naturalWidth * scale));
        cv.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; // flatten transparency — the target is JPEG
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/jpeg', 0.85));
      } catch (e) { reject(e); }
    };
    img.onerror = reject;
    img.src = src;
  });
}

function fileStem(report) {
  return `perks-ledger-report-${report.options.year}`;
}

export async function previewReport() {
  const report = await build();
  state._lastReport = report;
  const host = document.getElementById('reportPreview');
  // The hub's period line is rendered from the saved options, so refresh it
  // whenever a report is generated with different ones.
  const hint = document.getElementById('reportHint');
  if (hint) hint.innerHTML = hintHTML(getReportOptions(), getVisibleCardKeys());
  const body = `
    <div class="rpt-preview-actions">
      <button class="settings-btn settings-btn-primary" onclick="openPrintableReport()">Print / Save as PDF</button>
      <button class="settings-btn" onclick="downloadReportHTML()">Download HTML</button>
      <button class="settings-btn" onclick="downloadReportMarkdown()">Download Markdown</button>
      <button class="settings-btn" onclick="openReportConfig()">Change options</button>
    </div>
    <div class="rpt-paper">${reportToHTML(report)}</div>`;
  if (host) { host.innerHTML = body; host.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  else set(body);
}

export async function openPrintableReport() {
  // The popup must be opened synchronously inside the click handler — opening
  // it after the artwork await would trip the popup blocker.
  const w = window.open('', '_blank');
  const report = await build();
  state._lastReport = report;
  if (!w) { // popup blocked — fall back to a download so the work isn't lost
    downloadFile(`${fileStem(report)}.html`, buildStandaloneHTML(report, { autoPrint: false }), 'text/html');
    return;
  }
  w.document.open();
  w.document.write(buildStandaloneHTML(report, { autoPrint: true }));
  w.document.close();
}

export async function downloadReportHTML() {
  const report = await build();
  state._lastReport = report;
  downloadFile(`${fileStem(report)}.html`, buildStandaloneHTML(report, { autoPrint: false }), 'text/html');
}

// Markdown, CSV and JSON are text formats — embedding megabytes of base64
// artwork in them would bloat the file for no benefit.
export async function downloadReportMarkdown() {
  const report = await build({ artwork: false });
  downloadFile(`${fileStem(report)}.md`, reportToMarkdown(report), 'text/markdown');
}

export async function downloadReportCSV() {
  const report = await build({ artwork: false });
  downloadFile(`perks-ledger-scorecard-${report.options.year}.csv`, scorecardToCSV(report), 'text/csv');
  setTimeout(() => downloadFile(`perks-ledger-benefits-${report.options.year}.csv`, reportToCSV(report), 'text/csv'), 400);
}

export async function downloadReportJSON() {
  const report = await build({ artwork: false });
  downloadFile(`perks-ledger-backup-${report.options.year}.json`,
    JSON.stringify(buildJSONBackup(report), null, 2), 'application/json');
}

// ══════════════════════════════════════════════════════════════════════════
// HTML rendering
// ══════════════════════════════════════════════════════════════════════════
const STATUS_CLS = {
  [STATUS.FULLY_USED]: 'ok',
  [STATUS.PARTIALLY_USED]: 'warn',
  [STATUS.UNUSED]: 'warn',
  [STATUS.EXPIRED_UNUSED]: 'bad',
  [STATUS.EXPIRED_PARTIALLY_USED]: 'bad',
  [STATUS.UPCOMING]: 'info',
  [STATUS.NOT_YET_AVAILABLE]: 'mute',
  [STATUS.EXCLUDED]: 'mute',
  [STATUS.UNKNOWN]: 'mute',
};

const ASSESS_CLS = {
  'Excellent Value': 'ok', 'Positive Value': 'ok', 'Near Break-Even': 'warn',
  'Underutilized': 'bad', 'Review Before Renewal': 'bad', 'No Tracked Benefits': 'mute',
};

function pill(status) {
  return `<span class="rpt-pill ${STATUS_CLS[status] || 'mute'}">${E(STATUS_LABELS[status] || status)}</span>`;
}

function money(n) { return E(fmtMoney(n)); }
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
function bLabel(b) { return b.displayName || b.benefitName; }
/** "Jan 2026, Feb 2026, …" for a monthly credit was the widest cell in the
 *  table and adds nothing the timeline row below does not already show. */
function usageSummary(b) {
  const ds = b.usageDates;
  if (!ds.length) return '—';
  if (ds.length <= 2) return ds.join(', ');
  return `${ds.length} periods · ${ds[0]}–${ds[ds.length - 1]}`;
}
// Window bounds are stored as ISO so they can be compared; humanised at render.
function dateLabel(iso) { return isoToLabel(iso) || '—'; }
function signed(n) { return `<span class="${n >= 0 ? 'rpt-pos' : 'rpt-neg'}">${E(fmtSignedMoney(n))}</span>`; }

function statBlock(label, value, cls = '') {
  return `<div class="rpt-stat"><div class="rpt-stat-label">${E(label)}</div><div class="rpt-stat-val ${cls}">${value}</div></div>`;
}

function tableWrap(inner) { return `<div class="rpt-table-wrap">${inner}</div>`; }

/** The report body — shared by the in-app preview and the standalone document. */
export function reportToHTML(report) {
  const o = report.options;
  const gen = new Date(report.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const H = [];

  // ── 1. Header ────────────────────────────────────────────────────────────
  H.push(`<header class="rpt-head">
    <div class="rpt-brand">Perks Ledger</div>
    <h1 class="rpt-title">${E(report.title)}</h1>
    <div class="rpt-period">${E(report.periodStart)} – ${E(report.periodEnd)} · generated ${E(gen)}</div>
    <div class="rpt-stats">
      ${statBlock('Active cards', String(report.cardCount))}
      ${statBlock('Total annual fees', money(report.totalAnnualFees))}
      ${statBlock('Available benefit value', money(report.totalAvailableValue))}
      ${statBlock('Redeemed benefit value', money(report.redeemedBenefitValue), 'rpt-pos')}
      ${statBlock('Expired benefit value', money(report.totalMissedValue), report.totalMissedValue > 0 ? 'rpt-neg' : '')}
      ${statBlock('Still claimable', money(report.totalRemainingAvailableValue))}
      ${statBlock('Recorded points redemption value', money(report.recordedPointsRedemptionValue))}
      ${statBlock('Net benefit value after fees', fmtSignedMoney(report.netBenefitValueAfterFees), report.netBenefitValueAfterFees >= 0 ? 'rpt-pos' : 'rpt-neg')}
      ${statBlock('Total tracked value after fees', fmtSignedMoney(report.totalTrackedValueAfterFees), report.totalTrackedValueAfterFees >= 0 ? 'rpt-pos' : 'rpt-neg')}
    </div>
    <p class="rpt-head-note"><b>Benefit value and points value are counted separately.</b>
      Net benefit value after fees is ${money(report.redeemedBenefitValue)} in statement credits and reimbursements
      less ${money(report.totalAnnualFees)} in annual fees. Total tracked value after fees adds the
      ${money(report.recordedPointsRedemptionValue)} you recorded in points and miles redemptions on top.</p>
  </header>`);

  // ── 2. Executive summary ─────────────────────────────────────────────────
  H.push(`<section class="rpt-section rpt-summary">
    <h2>Executive Summary</h2>
    <p class="rpt-lede">${E(report.narratives.summary)}</p>
  </section>`);

  // ── 3. Portfolio scorecard ───────────────────────────────────────────────
  H.push(`<section class="rpt-section">
    <h2>Portfolio Scorecard</h2>
    ${tableWrap(`<table class="rpt-table">
      <thead><tr>
        <th>Card</th><th class="r">Annual<br>fee</th><th class="r">Available</th><th class="r">Redeemed</th>
        <th class="r">Expired</th><th class="r">Still<br>claimable</th><th class="r">Points</th>
        <th class="r">Net<br>benefit</th><th class="r">Total<br>tracked</th>
        <th class="r">Util.</th><th>Status</th>
      </tr></thead>
      <tbody>
        ${report.cardSummaries.map(c => `<tr>
          <td class="rpt-strong">${E(c.cardName)}</td>
          <td class="r">${money(c.annualFee)}</td>
          <td class="r">${money(c.availableValue)}</td>
          <td class="r">${money(c.usedValue)}</td>
          <td class="r">${money(c.missedValue)}</td>
          <td class="r">${money(c.remainingAvailableValue)}</td>
          <td class="r">${money(c.recordedPointsRedemptionValue)}</td>
          <td class="r">${signed(c.netBenefitValueAfterFees)}</td>
          <td class="r">${signed(c.totalTrackedValueAfterFees)}</td>
          <td class="r">${E(fmtPct(c.utilizationRate))}</td>
          <td><span class="rpt-pill ${ASSESS_CLS[c.assessment] || 'mute'}">${E(c.assessment)}</span></td>
        </tr>`).join('')}
        <tr class="rpt-total">
          <td>Total</td>
          <td class="r">${money(report.totalAnnualFees)}</td>
          <td class="r">${money(report.totalAvailableValue)}</td>
          <td class="r">${money(report.redeemedBenefitValue)}</td>
          <td class="r">${money(report.totalMissedValue)}</td>
          <td class="r">${money(report.totalRemainingAvailableValue)}</td>
          <td class="r">${money(report.recordedPointsRedemptionValue)}</td>
          <td class="r">${signed(report.netBenefitValueAfterFees)}</td>
          <td class="r">${signed(report.totalTrackedValueAfterFees)}</td>
          <td class="r">${E(fmtPct(report.utilizationRate))}</td>
          <td></td>
        </tr>
      </tbody>
    </table>`)}
    ${report.hasPersonalOverrides
      ? `<p class="rpt-note">Totals use your personal valuations where you set one. At published face value the same benefits total ${money(report.faceAvailableValue)} available and ${money(report.faceUsedValue)} redeemed, for a face-value net of ${E(fmtSignedMoney(report.faceNetBenefitValueAfterFees))} after fees.</p>`
      : `<p class="rpt-note">You have not overridden any benefit values, so personal value currently equals published face value throughout this report.</p>`}
  </section>`);

  // ── 4 & 5. Card-by-card narrative + benefit activity timeline ────────────
  H.push(`<section class="rpt-section"><h2>Card-by-Card Review</h2>`);
  if (!report.cardSummaries.length) {
    H.push(`<p class="rpt-empty">No cards were selected for this report.</p>`);
  }
  report.cardSummaries.forEach(c => {
    H.push(`<article class="rpt-card">
      <div class="rpt-card-head">
        ${c.artwork ? `<img class="rpt-card-art" src="${c.artwork}" alt="">` : ''}
        <div class="rpt-card-id">
          <h3>${E(c.cardName)}</h3>
          <div class="rpt-card-meta">
            <span>Annual fee <b>${money(c.annualFee)}</b></span>
            ${c.renewalDate ? `<span>Renews <b>${E(c.renewalDate)}</b></span>` : ''}
            ${c.openedLabel ? `<span>Opened <b>${E(c.openedLabel)}</b></span>` : ''}
            ${c.closedLabel ? `<span>Closed <b>${E(c.closedLabel)}</b></span>` : ''}
          </div>
        </div>
        <span class="rpt-pill ${ASSESS_CLS[c.assessment] || 'mute'}">${E(c.assessment)}</span>
      </div>
      <div class="rpt-card-stats">
        ${statBlock('Available', money(c.availableValue))}
        ${statBlock('Realized', money(c.usedValue), 'rpt-pos')}
        ${statBlock('Unused / expired', money(c.missedValue), c.missedValue > 0 ? 'rpt-neg' : '')}
        ${statBlock('Still available', money(c.remainingAvailableValue))}
        ${statBlock('Utilization', E(fmtPct(c.utilizationRate)))}
        ${statBlock('Net benefit after fee', fmtSignedMoney(c.netBenefitValueAfterFees), c.netBenefitValueAfterFees >= 0 ? 'rpt-pos' : 'rpt-neg')}
        ${statBlock('Points redeemed', money(c.recordedPointsRedemptionValue))}
        ${statBlock('Total tracked after fee', fmtSignedMoney(c.totalTrackedValueAfterFees), c.totalTrackedValueAfterFees >= 0 ? 'rpt-pos' : 'rpt-neg')}
      </div>
      <p class="rpt-narrative">${E(c.narrative)}</p>
      ${c.hasPersonalOverrides ? `<p class="rpt-note"><b>Personal vs published value.</b>
        Figures above use your own valuations. At published face value this card offered
        ${money(c.faceAvailableValue)} and returned ${money(c.faceUsedValue)}, a face-value net of
        ${E(fmtSignedMoney(c.faceNetBenefitValueAfterFees))} after its ${money(c.annualFee)} fee.</p>` : ''}`);

    if (o.includeActivity) {
      const visible = c.benefits.filter(b => benefitVisible(b, o));
      if (!visible.length) {
        H.push(`<p class="rpt-empty">No benefit activity matches the selected filters for this card.</p>`);
      } else {
        groupBenefits(visible, o.groupBy).forEach(g => {
          H.push(`<div class="rpt-group"><div class="rpt-group-label">${E(g.label)}</div>
            ${tableWrap(`<table class="rpt-table rpt-table-sm">
              <thead><tr>
                <th>Benefit</th><th>Category</th><th class="r">Available</th><th class="r">Redeemed</th>
                <th class="r">Expired</th><th class="r">Still<br>claimable</th>
                <th>Status</th><th>Redeemed<br>on</th><th>Expires</th>
              </tr></thead>
              <tbody>${g.items.map(b => benefitRows(b, o)).join('')}</tbody>
            </table>`)}
          </div>`);
        });
      }
    }
    H.push(`</article>`);
  });
  H.push(`</section>`);

  // ── 6. Used benefits ─────────────────────────────────────────────────────
  const allBenefits = report.cardSummaries.flatMap(c => c.benefits);
  const usedBenefits = allBenefits.filter(b => b.usedValue > 0).sort((a, b) => b.usedValue - a.usedValue);
  H.push(`<section class="rpt-section">
    <h2>Used Benefits</h2>
    <p class="rpt-narrative">${E(report.narratives.usage)}</p>
    ${usedBenefits.length
      ? `<p class="rpt-note">${usedBenefits.length} benefit${usedBenefits.length === 1 ? '' : 's'} contributed value this period; each is itemised in its card section above.</p>`
      : `<p class="rpt-empty">No benefits were recorded as used in this period.</p>`}
    <div class="rpt-split">
      <div>
        <div class="rpt-group-label">Usage by category</div>
        ${tableWrap(`<table class="rpt-table rpt-table-sm">
          <thead><tr><th>Category</th><th class="r">Available</th><th class="r">Used</th><th class="r">Rate</th></tr></thead>
          <tbody>${report.usageByCategory.map(c => `<tr><td>${E(c.label)}</td><td class="r">${money(c.availableValue)}</td><td class="r">${money(c.usedValue)}</td><td class="r">${E(fmtPct(c.utilizationRate))}</td></tr>`).join('') || '<tr><td colspan="4">—</td></tr>'}</tbody>
        </table>`)}
      </div>
      <div>
        <div class="rpt-group-label">Usage by card</div>
        ${tableWrap(`<table class="rpt-table rpt-table-sm">
          <thead><tr><th>Card</th><th class="r">Used</th><th class="r">Missed</th><th class="r">Rate</th></tr></thead>
          <tbody>${report.usageByCard.map(c => `<tr><td>${E(c.cardName)}</td><td class="r">${money(c.usedValue)}</td><td class="r">${money(c.missedValue)}</td><td class="r">${E(fmtPct(c.utilizationRate))}</td></tr>`).join('') || '<tr><td colspan="4">—</td></tr>'}</tbody>
        </table>`)}
      </div>
    </div>
    ${report.consistentRecurring.length ? `<p class="rpt-note"><b>Recurring benefits used consistently:</b> ${E(report.consistentRecurring.map(b => `${bLabel(b)} (${b.periodsUsed} periods)`).join(', '))}.</p>` : ''}
    ${report.oneTimeRedeemed.length ? `<p class="rpt-note"><b>One-time benefits redeemed in full:</b> ${E(report.oneTimeRedeemed.map(b => bLabel(b)).join(', '))}.</p>` : ''}
  </section>`);

  // ── 7. Missed and unused ─────────────────────────────────────────────────
  const missedBenefits = allBenefits.filter(b => b.missedValue > 0).sort((a, b) => b.missedValue - a.missedValue);
  // Count by where the value actually landed, not by rollup status: a monthly
  // credit skipped in one month out of twelve still contributes excluded value
  // while rolling up as partially used.
  const excludedBenefits = allBenefits.filter(b => b.excludedValue > 0);
  const upcomingBenefits = allBenefits.filter(b => b.upcomingValue > 0);
  const notOffered = allBenefits.filter(b => b.status === STATUS.NOT_YET_AVAILABLE);
  const unknown = allBenefits.filter(b => b.status === STATUS.UNKNOWN);
  H.push(`<section class="rpt-section rpt-section-alert">
    <h2>Missed and Unused Benefits</h2>
    <p class="rpt-narrative">${E(report.narratives.missed)}</p>
    ${missedBenefits.length ? tableWrap(`<table class="rpt-table rpt-table-sm">
      <thead><tr><th>Benefit</th><th>Card</th><th>Category</th><th class="r">Missed</th><th class="c">Periods missed</th><th>Missed in</th><th>Status</th></tr></thead>
      <tbody>${missedBenefits.map(b => {
        const card = report.cardSummaries.find(c => c.cardId === b.cardId);
        return `<tr><td class="rpt-strong">${E(bLabel(b))}</td><td>${E(card ? card.cardName : '')}</td><td>${E(b.category)}</td><td class="r rpt-neg">${money(b.missedValue)}</td><td class="c">${b.periodsMissed}</td><td class="rpt-dim">${E(b.missedPeriodLabels.join(', '))}</td><td>${pill(b.status)}</td></tr>`;
      }).join('')}</tbody></table>`) : `<p class="rpt-empty">Nothing expired unused in this period.</p>`}
    <div class="rpt-split">
      <div>
        <div class="rpt-group-label">Missed value by card</div>
        ${tableWrap(`<table class="rpt-table rpt-table-sm"><thead><tr><th>Card</th><th class="r">Missed</th></tr></thead>
          <tbody>${report.cardSummaries.filter(c => c.missedValue > 0).sort((a, b) => b.missedValue - a.missedValue).map(c => `<tr><td>${E(c.cardName)}</td><td class="r">${money(c.missedValue)}</td></tr>`).join('') || '<tr><td colspan="2">None</td></tr>'}</tbody></table>`)}
      </div>
      <div>
        <div class="rpt-group-label">Missed value by category</div>
        ${tableWrap(`<table class="rpt-table rpt-table-sm"><thead><tr><th>Category</th><th class="r">Missed</th></tr></thead>
          <tbody>${report.usageByCategory.filter(c => c.missedValue > 0).sort((a, b) => b.missedValue - a.missedValue).map(c => `<tr><td>${E(c.label)}</td><td class="r">${money(c.missedValue)}</td></tr>`).join('') || '<tr><td colspan="2">None</td></tr>'}</tbody></table>`)}
      </div>
    </div>
    <div class="rpt-callout">
      <div class="rpt-group-label">How the remaining benefits are classified</div>
      <ul class="rpt-list">
        <li><b>Available but unused</b> — ${money(report.totalRemainingAvailableValue)} across ${plural(report.openOpportunities.length, 'benefit')}. Still claimable, so not counted as missed.</li>
        <li><b>Not yet available</b> — ${money(report.totalUpcomingValue)} across ${plural(upcomingBenefits.length, 'benefit')} whose window has not opened${notOffered.length ? `, plus ${plural(notOffered.length, 'benefit')} not offered at all during this period` : ''}.</li>
        <li><b>Intentionally excluded</b> — ${money(report.totalExcludedValue)} across ${plural(excludedBenefits.length, 'benefit')} you skipped or snoozed.</li>
        <li><b>Usage data missing</b> — ${plural(unknown.length, 'benefit')} with no monetary value or no ownership history; excluded from all totals rather than assumed unused.</li>
      </ul>
    </div>
  </section>`);

  // ── 8. Expiration and upcoming opportunities ─────────────────────────────
  H.push(`<section class="rpt-section">
    <h2>Expiration and Upcoming Opportunities</h2>
    <p class="rpt-narrative">${E(report.narratives.opportunity)}</p>
    ${report.openOpportunities.length ? tableWrap(`<table class="rpt-table rpt-table-sm">
      <thead><tr><th>Benefit</th><th>Card</th><th>Frequency</th><th class="r">Remaining</th><th>Expires</th></tr></thead>
      <tbody>${report.openOpportunities.map(b => {
        const card = report.cardSummaries.find(c => c.cardId === b.cardId);
        return `<tr><td class="rpt-strong">${E(bLabel(b))}</td><td>${E(card ? card.cardName : '')}</td><td>${E(b.frequencyLabel)}</td><td class="r">${money(b.remainingValue)}</td><td>${E(dateLabel(b.nextExpiration))}</td></tr>`;
      }).join('')}</tbody></table>`) : `<p class="rpt-empty">No benefits currently carry a claimable balance.</p>`}
    ${tableWrap(`<table class="rpt-table rpt-table-sm">
      <thead><tr><th>Card</th><th>Next renewal / anniversary</th><th class="r">Annual fee</th><th class="r">Still claimable</th></tr></thead>
      <tbody>${report.cardSummaries.map(c => `<tr><td>${E(c.cardName)}</td><td>${E(c.renewalDate || '—')}</td><td class="r">${money(c.annualFee)}</td><td class="r">${money(c.remainingAvailableValue)}</td></tr>`).join('') || '<tr><td colspan="4">—</td></tr>'}</tbody>
    </table>`)}
  </section>`);

  // ── 9. Annual fee analysis ───────────────────────────────────────────────
  if (o.includeFeeAnalysis) {
    H.push(`<section class="rpt-section">
      <h2>Annual Fee Analysis</h2>
      ${tableWrap(`<table class="rpt-table">
        <thead><tr><th>Card</th><th class="r">Annual<br>fee</th><th class="r">Redeemed<br>benefit value</th><th class="r">Points<br>redeemed</th><th class="r">Net benefit<br>after fees</th><th class="r">Total tracked<br>after fees</th><th class="r">Still<br>claimable</th><th class="r">Break-even<br>gap</th></tr></thead>
        <tbody>${report.cardSummaries.map(c => `<tr>
          <td class="rpt-strong">${E(c.cardName)}</td>
          <td class="r">${money(c.annualFee)}</td>
          <td class="r">${money(c.usedValue)}</td>
          <td class="r">${money(c.recordedPointsRedemptionValue)}</td>
          <td class="r">${signed(c.netBenefitValueAfterFees)}</td>
          <td class="r">${signed(c.totalTrackedValueAfterFees)}</td>
          <td class="r">${money(c.remainingAvailableValue)}</td>
          <td class="r">${c.breakEvenGap > 0 ? money(c.breakEvenGap) : '<span class="rpt-pos">covered</span>'}</td>
        </tr>`).join('')}</tbody>
      </table>`)}
      ${tableWrap(`<table class="rpt-table rpt-table-sm">
        <thead><tr><th>Valuation basis</th><th class="r">Benefit value available</th><th class="r">Benefit value redeemed</th><th class="r">Net after fees</th></tr></thead>
        <tbody>
          <tr><td>Published face value</td><td class="r">${money(report.faceAvailableValue)}</td><td class="r">${money(report.faceUsedValue)}</td><td class="r">${signed(report.faceNetBenefitValueAfterFees)}</td></tr>
          <tr><td>Your personal value</td><td class="r">${money(report.totalAvailableValue)}</td><td class="r">${money(report.redeemedBenefitValue)}</td><td class="r">${signed(report.netBenefitValueAfterFees)}</td></tr>
        </tbody>
      </table>`)}
      <p class="rpt-note">${report.hasPersonalOverrides
        ? 'Face value is the amount the issuer publishes. Personal value is what you told Perks Ledger the benefit is actually worth to you. Neither replaces the other — utilization is measured against the basis shown, and both nets are reported here.'
        : 'You have not set a personal value for any benefit, so personal value currently equals published face value and the two rows above are identical.'}</p>
      <div class="rpt-callout">
        <p><b>What these numbers do and do not include.</b> Objective statement credits and reimbursements are counted at face value once recorded. Values you overrode with your own amount are <i>estimates</i> and reflect your personal valuation. Untracked value — points and miles earned on spend, purchase and travel protections, elite status, lounge access, companion certificates, and transfer-partner value — is <b>not</b> included anywhere in this report.</p>
        <p>A card can therefore sit below break-even here and still be worth keeping. Annual fee minus statement credits is one lens, not the only valid way to evaluate a card.</p>
        ${report.cardSummaries.filter(c => c.breakEvenGap > 0).map(c => `<p class="rpt-note">Based only on tracked benefits, the ${E(c.cardName)} is ${money(c.breakEvenGap)} below its annual fee. This does not include points earnings, insurance protections, lounge visits, or other untracked benefits.</p>`).join('')}
      </div>
    </section>`);
  }

  // ── 10. Recommendations ──────────────────────────────────────────────────
  if (o.includeRecommendations) {
    H.push(`<section class="rpt-section">
      <h2>Recommendations</h2>
      <ol class="rpt-recs">
        ${report.recommendations.map(r => `<li><b>${E(r.title)}</b><span>${E(r.detail)}</span></li>`).join('')}
      </ol>
      <p class="rpt-note">These are informational prompts generated from your own tracked records, not financial advice.</p>
    </section>`);
  }

  // ── 11. Methodology ──────────────────────────────────────────────────────
  H.push(`<section class="rpt-section rpt-method rpt-page-break">
    <h2>Methodology and Assumptions</h2>
    <dl>${report.methodology.map(m => `<dt>${E(m.heading)}</dt><dd>${E(m.body)}</dd>`).join('')}</dl>
  </section>`);

  H.push(`<footer class="rpt-foot">Perks Ledger · ${E(report.title)} · generated ${E(gen)}</footer>`);
  return H.join('\n');
}

/** One summary row per benefit, plus a per-period timeline when it recurs. */
function benefitRows(b, o) {
  const estimate = b.isEstimated
    ? ` <span class="rpt-est" title="Your personal valuation; published face value ${E(fmtMoney(b.faceAvailableValue))}">personal ${E(fmtMoney(b.availableValue))} · face ${E(fmtMoney(b.faceAvailableValue))}</span>`
    : '';
  // Every dollar of Available is accounted for across these four columns, so a
  // row always reconciles: available = redeemed + expired + claimable (+ any
  // upcoming). Without the Expired column a partly-missed monthly credit read
  // as though its arithmetic were broken.
  const rows = [`<tr class="rpt-b-row">
    <td class="rpt-strong">${E(bLabel(b))}${estimate}</td>
    <td class="rpt-dim">${E(b.category)}</td>
    <td class="r">${money(b.availableValue)}</td>
    <td class="r">${money(b.usedValue)}</td>
    <td class="r${b.missedValue > 0 ? ' rpt-neg' : ''}">${money(b.missedValue)}</td>
    <td class="r">${money(b.remainingValue)}</td>
    <td>${pill(b.status)}</td>
    <td class="rpt-dim">${E(usageSummary(b))}</td>
    <td class="rpt-dim">${E(dateLabel(b.statusExpiration || b.nextExpiration || b.expirationDate))}</td>
  </tr>`];

  // Chronological detail for benefits that recur — this is where a monthly
  // credit's individual misses become visible.
  const detail = b.instances.filter(i => i.status !== STATUS.NOT_YET_AVAILABLE);
  const informative = b.missedValue > 0 || b.remainingValue > 0 || b.excludedValue > 0;
  if (detail.length > 1 && informative) {
    rows.push(`<tr class="rpt-b-detail"><td colspan="9">
      <div class="rpt-timeline">${detail.map(i =>
        `<span class="rpt-tl ${STATUS_CLS[i.status] || 'mute'}" title="${E(`${i.periodLabel}: ${STATUS_LABELS[i.status]} · ${fmtMoney(i.usedValue)} of ${fmtMoney(i.amount)}`)}">${E(i.periodLabel)}<b>${money(i.usedValue)}</b></span>`).join('')}</div>
    </td></tr>`);
  }

  if (o.includeNotes && b.notes.length) {
    rows.push(`<tr class="rpt-b-detail"><td colspan="9">${b.notes.map(n =>
      `<div class="rpt-benefit-note"><b>${E(n.period)}</b> ${E(n.note)}</div>`).join('')}</td></tr>`);
  }
  return rows.join('');
}

// Auto-print bootstrap for the popup. Injected as a string so it runs inside
// the new window rather than this one.
//
// The naive version — addEventListener('load', … setTimeout(print, 350)) —
// printed blank on the first attempt and only worked on a second try. Two
// reasons: the popup's initial about:blank fires `load` while we are still
// awaiting the artwork embed, so by the time the script is written that event
// is already gone and the listener never fires; and a fixed 350ms guess does
// not actually wait for the embedded card images to decode.
//
// So: check readyState instead of assuming the event is still coming, wait on
// the real signals (images + fonts) rather than a timer, and hand off with
// setTimeout — an unpainted popup receives no animation frames, so scheduling
// the print via requestAnimationFrame silently never ran.
export const AUTO_PRINT_JS = `
(function(){
  var printed = false;
  function go(){
    if (printed) return;
    printed = true;
    try { window.focus(); } catch (e) {}
    window.print();
  }
  function whenPainted(){
    var waits = [];
    Array.prototype.forEach.call(document.images, function(img){
      if (!img.complete) {
        waits.push(new Promise(function(res){
          img.addEventListener('load', res, { once: true });
          img.addEventListener('error', res, { once: true });
        }));
      }
    });
    if (document.fonts && document.fonts.ready) waits.push(document.fonts.ready);
    // Never hang: print anyway if something stalls.
    var settled = Promise.all(waits).catch(function(){});
    var timeout = new Promise(function(res){ setTimeout(res, 3000); });
    // A setTimeout, not requestAnimationFrame: a popup that has not been
    // painted yet gets no animation frames, so rAF here simply never fired and
    // the first print did nothing.
    Promise.race([settled, timeout]).then(function(){ setTimeout(go, 60); });
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') whenPainted();
  else window.addEventListener('load', whenPainted, { once: true });
})();
`;

// ── Standalone / print document ────────────────────────────────────────────
export function buildStandaloneHTML(report, { autoPrint } = {}) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${E(report.title)} · Perks Ledger</title>
<style>${REPORT_CSS}</style>
</head><body class="rpt-standalone">
<div class="rpt-toolbar no-print">
  <span>Use your browser's print dialog to save this as a PDF. Page numbers come from the print dialog's header/footer setting.</span>
  <button onclick="window.print()">Print / Save as PDF</button>
</div>
<main class="rpt-paper">${reportToHTML(report)}</main>
${autoPrint ? `<script>${AUTO_PRINT_JS}<\/script>` : ''}
</body></html>`;
}

// Single source of truth for report styling: injected into the app for the
// in-app preview, and inlined into the standalone/print document. The report
// intentionally renders as a light "paper" surface in both themes — it is a
// document, and it has to print without a dark background.
export const REPORT_CSS = `
.rpt-paper{--rp-ink:#1a1a1a;--rp-dim:#5f6470;--rp-line:#d9dce3;--rp-line-soft:#eceef2;--rp-bg:#fff;--rp-tint:#f6f7f9;
  --rp-ok:#1d7a4f;--rp-bad:#b3261e;--rp-warn:#9a6a05;--rp-info:#2b5f9e;
  background:var(--rp-bg);color:var(--rp-ink);border-radius:10px;padding:26px 24px;margin-top:14px;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55;
  border:1px solid var(--rp-line);overflow-wrap:break-word;}
.rpt-paper *{box-sizing:border-box;}
.rpt-brand{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--rp-dim);font-weight:700;}
.rpt-title{font-size:26px;line-height:1.2;margin:6px 0 4px;font-weight:700;letter-spacing:-.01em;}
.rpt-period{color:var(--rp-dim);font-size:12px;}
.rpt-head{border-bottom:2px solid var(--rp-ink);padding-bottom:16px;margin-bottom:20px;}
/* Six stats, so a fixed 3x2 (or 2x3) grid beats auto-fit's ragged last row. */
.rpt-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:16px;}
@media (min-width:560px){.rpt-stats{grid-template-columns:repeat(3,1fr);}}
.rpt-stat{border:1px solid var(--rp-line);border-radius:7px;padding:9px 11px;background:var(--rp-tint);}
.rpt-stat-label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--rp-dim);font-weight:600;}
.rpt-stat-val{font-size:17px;font-weight:700;margin-top:3px;}
.rpt-pos{color:var(--rp-ok);} .rpt-neg{color:var(--rp-bad);} .rpt-dim{color:var(--rp-dim);}
.rpt-section{margin:26px 0;}
.rpt-section h2{font-size:16px;font-weight:700;letter-spacing:-.01em;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid var(--rp-line);}
.rpt-section h3{font-size:15px;font-weight:700;margin:0;}
.rpt-lede{font-size:14px;line-height:1.65;margin:0;}
.rpt-narrative{margin:10px 0;line-height:1.65;}
.rpt-note{font-size:12px;color:var(--rp-dim);margin:8px 0 0;}
.rpt-empty{font-size:12px;color:var(--rp-dim);font-style:italic;margin:8px 0;}
.rpt-summary .rpt-lede{background:var(--rp-tint);border-left:3px solid var(--rp-ink);padding:12px 14px;border-radius:0 6px 6px 0;}
.rpt-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:10px 0;}
.rpt-table{width:100%;border-collapse:collapse;font-size:12px;min-width:520px;}
.rpt-table-sm{font-size:11.5px;min-width:460px;}
.rpt-table th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--rp-dim);
  font-weight:700;padding:7px 8px;border-bottom:1.5px solid var(--rp-line);white-space:nowrap;}
.rpt-table td{padding:7px 8px;border-bottom:1px solid var(--rp-line-soft);vertical-align:top;}
.rpt-table th.r,.rpt-table td.r{text-align:right;} .rpt-table th.c,.rpt-table td.c{text-align:center;}
.rpt-strong{font-weight:600;}
.rpt-total td{font-weight:700;border-top:1.5px solid var(--rp-ink);border-bottom:none;background:var(--rp-tint);}
.rpt-pill{display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;white-space:nowrap;border:1px solid;}
.rpt-pill.ok{color:var(--rp-ok);border-color:var(--rp-ok);}
.rpt-pill.bad{color:var(--rp-bad);border-color:var(--rp-bad);}
.rpt-pill.warn{color:var(--rp-warn);border-color:var(--rp-warn);}
.rpt-pill.info{color:var(--rp-info);border-color:var(--rp-info);}
.rpt-pill.mute{color:var(--rp-dim);border-color:var(--rp-line);}
.rpt-card{border:1px solid var(--rp-line);border-radius:9px;padding:16px;margin:14px 0;}
.rpt-card-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.rpt-card-id{flex:1 1 200px;min-width:0;}
.rpt-card-art{width:78px;height:auto;flex-shrink:0;border-radius:5px;border:1px solid var(--rp-line);display:block;}
.rpt-card-meta{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--rp-dim);margin-top:5px;}
.rpt-card-meta b{color:var(--rp-ink);}
.rpt-card-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:12px 0;}
@media (min-width:560px){.rpt-card-stats{grid-template-columns:repeat(3,1fr);}}
@media (min-width:820px){.rpt-card-stats{grid-template-columns:repeat(6,1fr);}}
.rpt-card-stats .rpt-stat-val{font-size:14px;}
.rpt-group{margin-top:12px;}
.rpt-group-label{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--rp-dim);font-weight:700;margin-bottom:4px;}
.rpt-b-detail td{padding-top:0;border-bottom:1px solid var(--rp-line-soft);}
.rpt-timeline{display:flex;flex-wrap:wrap;gap:4px;padding:2px 0 6px;}
.rpt-tl{font-size:9.5px;border:1px solid var(--rp-line);border-radius:4px;padding:2px 5px;display:inline-flex;gap:4px;align-items:baseline;color:var(--rp-dim);}
.rpt-tl b{font-weight:700;}
.rpt-tl.ok{border-color:var(--rp-ok);color:var(--rp-ok);}
.rpt-tl.bad{border-color:var(--rp-bad);color:var(--rp-bad);}
.rpt-tl.warn{border-color:var(--rp-warn);color:var(--rp-warn);}
.rpt-tl.info{border-color:var(--rp-info);color:var(--rp-info);}
.rpt-est{font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:var(--rp-warn);border:1px solid var(--rp-warn);border-radius:3px;padding:0 3px;}
.rpt-benefit-note{font-size:11px;color:var(--rp-dim);padding:2px 0;}
.rpt-benefit-note b{color:var(--rp-ink);margin-right:5px;}
.rpt-split{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-top:12px;}
/* The 2–4 column summary tables in a split live in a narrow column, so the
   wide-table min-width would force a scrollbar and clip their values. */
.rpt-split .rpt-table{min-width:0;}
.rpt-callout{border:1px solid var(--rp-line);border-radius:8px;background:var(--rp-tint);padding:12px 14px;margin-top:14px;}
.rpt-callout p{margin:0 0 8px;} .rpt-callout p:last-child{margin-bottom:0;}
.rpt-list{margin:6px 0 0;padding-left:18px;} .rpt-list li{margin-bottom:4px;}
.rpt-recs{margin:0;padding-left:20px;}
.rpt-recs li{margin-bottom:10px;} .rpt-recs li b{display:block;} .rpt-recs li span{color:var(--rp-dim);}
.rpt-method dl{columns:2;column-gap:22px;}
.rpt-method dt{font-weight:700;margin-top:9px;break-after:avoid;}
.rpt-method dd{break-inside:avoid;} .rpt-method dd{margin:2px 0 0;color:var(--rp-dim);}
.rpt-foot{margin-top:26px;padding-top:12px;border-top:1px solid var(--rp-line);font-size:11px;color:var(--rp-dim);text-align:center;}
@media (max-width:600px){
  .rpt-paper{padding:18px 14px;} .rpt-title{font-size:21px;}
  .rpt-card{padding:12px;}
}
body.rpt-standalone{margin:0;padding:20px;background:#eef0f3;}
body.rpt-standalone .rpt-paper{max-width:8.5in;margin:0 auto;box-shadow:0 2px 14px rgba(0,0,0,.08);}
.rpt-toolbar{max-width:8.5in;margin:0 auto 14px;display:flex;gap:12px;align-items:center;justify-content:space-between;
  font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#5f6470;flex-wrap:wrap;}
.rpt-toolbar button{padding:8px 16px;border-radius:7px;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;font-weight:600;cursor:pointer;font-size:13px;}
@media print{
  @page{size:letter;margin:0.6in;}
  /* The standalone body's 20px padding outranks a bare body selector, so the
     whole page was being shifted right and pushed past the margin. */
  html,body,body.rpt-standalone{background:#fff !important;margin:0 !important;padding:0 !important;}
  .no-print,.rpt-toolbar{display:none !important;}
  .rpt-paper{border:none !important;box-shadow:none !important;border-radius:0;padding:0;margin:0;max-width:none;font-size:10.5pt;}
  /* Keep headings with their content and never orphan a table header. */
  .rpt-section h2,.rpt-section h3,.rpt-group-label{break-after:avoid;page-break-after:avoid;}
  /* Page structure. Page 1 carries the header, summary and scorecard; each of
     the remaining top-level sections starts on a fresh page so a card review is
     never split from its heading. Card sections themselves may flow. */
  .rpt-page-break{break-before:page;page-break-before:always;}
  .rpt-section:last-of-type{break-after:avoid;page-break-after:avoid;}
  .rpt-head,.rpt-summary,.rpt-callout,.rpt-stat,.rpt-group{break-inside:avoid;page-break-inside:avoid;}
  .rpt-card{break-inside:auto;page-break-inside:auto;border-color:#c9ccd3;}
  .rpt-card-head,.rpt-card-meta,.rpt-card-stats{break-inside:avoid;page-break-inside:avoid;}
  .rpt-card-art{width:64px;}
  .rpt-card-head{break-after:avoid;page-break-after:avoid;}
  tr,.rpt-b-row,.rpt-recs li,.rpt-method dt,.rpt-method dd{break-inside:avoid;page-break-inside:avoid;}
  .rpt-b-row{break-after:avoid;page-break-after:avoid;}
  thead{display:table-header-group;}
  tfoot{display:table-footer-group;}
  .rpt-table-wrap{overflow:visible !important;}
  /* Sized so the widest table (the 11-column scorecard) fits the 7.3in content
     box. Measured, not guessed: at 8pt/4px it came to 881px against a 701px
     page and the right-hand columns were silently clipped off the paper. */
  .rpt-table,.rpt-table-sm{min-width:0 !important;width:100% !important;font-size:7.5pt;}
  .rpt-table th,.rpt-table td{padding:2px 2.5px;}
  .rpt-table td.r,.rpt-table td.c{white-space:nowrap;}
  /* Headers set the minimum column width, and long ones like "STILL
     CLAIMABLE" reserved 108px to show "$370". Explicit breaks in the header
     text cost height once per table instead of on every row. */
  .rpt-table th{line-height:1.15;}
  /* width:100% cannot shrink a table below its min-content width, so the wide
     scorecard (11 cols) and benefit tables (10) used to spill past the page box
     and get clipped. Letting headers wrap is what makes them fit; numeric cells
     stay nowrap so a money value never breaks across lines. */

  /* Minimal ink: drop tinted fills, keep hairline rules. */
  .rpt-stat,.rpt-total td,.rpt-callout,.rpt-summary .rpt-lede{background:transparent !important;}
  /* Density: the first draft ran to 12 pages, most of it whitespace. */
  .rpt-section{margin:9pt 0;}
  .rpt-section h2{font-size:11pt;margin-bottom:5pt;padding-bottom:3pt;}
  .rpt-section h3{font-size:10.5pt;}
  .rpt-card{padding:7pt;margin:7pt 0;}
  .rpt-card-stats{gap:4px;margin:6pt 0;}
  .rpt-stat{padding:4px 6px;}
  .rpt-stat-val{font-size:10pt;margin-top:1px;}
  .rpt-stat-label{font-size:6.5pt;}
  .rpt-narrative,.rpt-lede{margin:5pt 0;line-height:1.45;}
  .rpt-summary .rpt-lede{padding:6pt 8pt;}
  .rpt-callout{padding:6pt 8pt;margin-top:7pt;}
  .rpt-split{gap:10pt;margin-top:7pt;}
  .rpt-recs li{margin-bottom:5pt;}
  .rpt-method dt{margin-top:5pt;}
  .rpt-head{padding-bottom:8pt;margin-bottom:10pt;}
  .rpt-title{font-size:17pt;}
  /* The bordered month chips are the single bulkiest element; in print they
     collapse to a tight inline run that still colour-codes each period. */
  .rpt-timeline{gap:0;padding:0 0 2px;display:block;line-height:1.35;}
  .rpt-tl{font-size:6.5pt;padding:0;border:none !important;display:inline;white-space:nowrap;}
  .rpt-tl::after{content:"  ";}
  .rpt-tl b{font-weight:600;margin-left:1px;}
  .rpt-group{margin-top:6pt;}
  .rpt-foot{position:fixed;bottom:0;left:0;right:0;border-top:1px solid #d9dce3;background:#fff;margin:0;padding:2pt 0;font-size:7pt;}
  body{padding-bottom:16pt;}
}`;

/** Injects REPORT_CSS into the app document once, for the in-app preview. */
export function ensureReportStyles() {
  if (document.getElementById('rptStyles')) return;
  const el = document.createElement('style');
  el.id = 'rptStyles';
  el.textContent = REPORT_CSS;
  document.head.appendChild(el);
}
