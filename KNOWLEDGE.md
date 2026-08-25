# Perks Ledger — Knowledge & Changelog

## Overview
Vanilla JS SPA deployed via **Vercel** (with `vercel.json` cache headers) at **perks.hueyventures.org**. No build step, no framework. ES modules loaded directly in the browser. Supabase for auth and cloud sync.

## Architecture

### Module Map
| File | Role |
|---|---|
| `js/cards.js` | All card benefit data — `CARDS`, `PREMIUM_CARD_CATALOG`, `CARD_LABELS`, `POINTS_MULTIPLIERS`, `BENEFIT_CATEGORIES` |
| `js/state.js` | Shared mutable `state` object, Supabase client (`sb`), date constants (`CY`, `CM`, `CD`) |
| `js/storage.js` | localStorage + Supabase sync, toggle, partial use, notes, snooze, credited, skipped |
| `js/periods.js` | Period math, stats, ROI calculations, streak logic |
| `js/badges.js` | 100+ achievement badge definitions (`BADGE_DEFS`), tier system (bronze→legendary), `checkBadges()`, `getEarnedBadges()`, `backfill2025Badges()`, `TIER_COLORS` |
| `js/views.js` | All render functions — `render()`, `renderCurrent()`, `renderAllCards()`, `renderDigest()`, `renderNetValue()`, `renderFeeOptimizer()`, `renderCardSimulator()`, `renderRenewalCalendar()`, `renderRecap()`, etc. |
| `js/report-model.js` | **Pure** report calculation + narrative templates — no DOM, no storage, no period math. Unit tested under `node --test` |
| `js/report.js` | Adapter: live state → report model input; Markdown / CSV / JSON serializers |
| `js/report-view.js` | Export & Reports view, config modal, report HTML, `REPORT_CSS` (shared by preview and print doc) |
| `js/main.js` | Event listeners, auth flow, navigation, modal logic, `renderBadgesView()`, email digest toggle, push subscribe, `window.*` exports for inline handlers |

### Key Patterns
- **Inline onclick handlers** in rendered HTML must use `window.*` exports (set at bottom of `main.js`)
- **Custom events** decouple storage from rendering: `perks:benefit-toggled`, `perks:rerender`, `perks:benefit-skipped`
- **`set(html, onReady?)`** in `views.js` applies a 180ms fade transition before inserting HTML; pass `onReady` callback for post-DOM event binding. It also records the focused control before the swap and re-focuses its replacement after — without that, keyboard users lose focus to the top of the page on every re-render
- **`state` object** is a single mutable export — mutations propagate across modules
- **Dark mode** applied via inline `<head>` script (runs before module deferred execution)
- **Colour tokens** (see v2.8) — `--gold` is a *fill*; text on it uses `--on-gold`, gold *as text* uses `--gold-text`, and card brand colours as text use their `-text` variant. The base brand tokens have no dark-theme override, so using one as a text colour is how you ship invisible text
- **`:focus-visible` rules live at the very end of `styles.css`** so they override the `outline: none` declarations scattered earlier in the file — don't move that block

### Cadence Types
| Cadence | Period Key Format | Example |
|---|---|---|
| `monthly` | `2025-m4` | May 2025 |
| `quarterly` | `2025-q1` | Q2 2025 |
| `cal-semi-annual` | `2025-h0` / `2025-h1` | Jan–Jun / Jul–Dec |
| `semi-annual` | `cy-2025-4-h1` | Card-year based half |
| `annual` | `cy-2025-4-annual` | Card-year based |
| `cal-annual` | `2025-annual` | Calendar year |
| `feb-annual` | `feb-2025` | Feb–Jan travel year |

### Data Shape
All benefit usage stored in `state.DATA[cardKey][benefitId__periodKey] = true/false`.
Extras stored separately in localStorage: `_customAmounts`, `_partial`, `_notes`, `_credited`, `_skipped`, `_snoozed`, `_feeOverrides`, `_cardOrder`.
Everything bundled into one Supabase row per user in `tracker_data`.

---

## Deployment
Push to `origin main` → Vercel auto-deploys to perks.hueyventures.org. `vercel.json` sets `no-cache` headers on `index.html`, `sw.js`, and all JS/CSS files.
Cache-bust: three markers must move together — `DEPLOY_DATE` in `js/main.js`, the `?v=...` query strings in `index.html`, and `CACHE_NAME` in `sw.js` (currently `benefits-tracker-v55`). Don't edit them by hand: `scripts/bump-version.sh` does all three and the `pre-push` hook calls it. The hook commits *during* the push, so that commit needs a second `git push --no-verify` if it doesn't ride along with the first.

---

## Tests

No build step, so tests are plain `node --test` files with no dependencies:

```bash
cd Perks-Ledger && node --test 'tests/*.test.mjs'
```

- `tests/report-model.test.mjs` — the pure status / missed-value / narrative ruleset
- `tests/report-integration.test.mjs` — drives the real `CARDS` catalog and `periods.js` with stubbed browser globals; includes an assertion that report totals match `calcStats()` so the report can't silently drift from the rest of the app
- `tests/sync-queue.test.mjs` — stubs the Supabase client and drives the real `storage.js` save/pull paths; pins the offline retry queue and the three-way merge (see v2.9)

`js/package.json` (`{"type":"module"}`) exists only so Node treats `js/*.js` as ES modules. It is not used at runtime.

---

## Changelog

### v2.9 (current, 2026-08-24)
Offline-safe cloud sync. `saveToStorage()` had two faults that between them
could lose a benefit toggle silently:

1. It advanced the **local timestamp before it knew the write had landed**. On
   failure the local copy therefore looked newer than the cloud row, and
   `syncFromSupabase()` — which pulls only when remote > local — stopped
   pulling on that device permanently.
2. **Nothing retried.** The "cloud sync failed" message cleared itself after
   3s and the change stayed on one device until the user happened to toggle
   something else.

Now: the timestamp moves only after a confirmed write; a failure records a
pending marker (`perks-pending-sync-<uid>`), shows a standing "⚠ unsynced —
will retry", and retries on `online`, on foreground, on load, and on a
5s→5min backoff. `syncFromSupabase()` flushes a pending write before it will
consider pulling.

**Flushing rebases rather than clobbers.** A blind flush would push this
device's whole payload over anything another device wrote while it was
offline. `perks-synced-base-<uid>` stores the payload as the cloud last
confirmed it; `diffPayload(base, current)` therefore yields exactly this
device's own edits, and `mergePayload(remote, changes)` lays them over the
current remote row. Both devices' changes survive, including an un-toggle.
The baseline is recorded on **every** confirmed read, not only when the pull
changed something — otherwise a device already in step with the cloud has no
baseline and its first rebase falls back to a wholesale overwrite.

Saves are serialised (`_saveInFlight`) so a retry firing mid-toggle cannot
race its own rebase. `applyPayloadLocally()` is now shared by the pull path
and the rebase, so the two cannot drift on which `_extras` they know about.

`tests/sync-queue.test.mjs` (15 tests) stubs the Supabase client and pins all
of the above, including the two original faults as named regressions.

**Known limitation:** the cloud row is still a single JSON blob with no
per-entry timestamps, so the merge resolves conflicts by "this device's edits
win over the remote value for keys this device changed." Two devices editing
the *same* benefit while both offline still resolves last-writer-wins.

### v2.8 (2026-08-24)
UI/UX review and accessibility pass. No feature or data changes — every fix is
presentational, semantic, or asset weight.

**Colour tokens — read this before adding any gold to the UI.**
Three conventions now hold, and breaking them is what caused the dark-mode bugs
below:
- `--gold` is the **brand fill only** (`#C8922A` light / `#E0A93A` dark). Text
  placed *on* a gold fill uses `--on-gold`, which is ink in both themes. White
  on gold measured 2.76:1 and failed AA in 13 rules; ink on the same gold is
  6.46:1, so the brand colour never had to change.
- Gold used **as text** uses `--gold-text` (`#7A4F0A` / `#E8B84A`), never
  `--gold`. 32 rules were converted.
- The 20 card brand colours (`--hilton`, `--csr`, …) have **no dark-theme
  override**. As text they must use the `-text` variant. `.all-cards-card-name`
  used the raw tokens, which put Hilton navy on near-black at **1.21:1** —
  invisible. `.wfpremier` had no rule at all.

**Contrast — both themes now clear WCAG AA (4.5:1) everywhere measured.**
`--text-tertiary` was 2.32:1 light / 2.40:1 dark while being used 220 times,
almost always on the app's *smallest* text; now 4.58 / 4.97. `--text-secondary`
4.16 → 5.20. `--green` 3.50 → 4.66. New per-theme `--danger-bg` /
`--danger-text` / `--cat-dining-text` / `--cat-ent-text` replace hardcoded
values: `.badge-captured` was light-green text on a hardcoded light-green pill
(2.0:1 in dark) and `.cat-entertainment` was 2.9:1.

**Keyboard and screen reader.** There were **zero** `:focus-visible` rules and
`outline: none` on 12 elements — tabbing was invisible. Added rings (via
`--focus-ring`) that follow each element's own `border-radius`; the block is
appended at the end of `styles.css` deliberately, so it wins over those
`outline: none` declarations. `.check-btn`, the most-used control in the app,
was an **empty `<button>`** with no accessible name or state — now
`aria-label` + `aria-pressed`. The note / credit / unsnooze controls were
`div`/`span` with `cursor:pointer` and are now real `<button>`s (`.linkish`,
`.benefit-note`, `.add-note` strip the UA chrome). Added landmarks
(`<header>`, `<main>`, labelled `<nav>`), `aria-current` on the active nav
item, labels on icon-only buttons, and `prefers-reduced-motion` support
(confetti is gated in JS, in both `views.js` and `main.js`). Removed
`user-scalable=no` / `maximum-scale=1.0`, which had disabled pinch-zoom.

**`set()` now restores keyboard focus.** Rebuilding `#main` destroyed the
focused element, so a keyboard user was thrown to the top of the page on *every*
benefit toggle. `focusFingerprint()` records the control by its data attributes
and re-focuses its replacement after the swap.

**Interaction fixes.** Escape closed only the drawer — the six modals and the
card sheet ignored it; a `_LAYERS` list now closes the topmost layer, and
deliberately excludes the card picker since that's a required first-run step.
Click-outside added to `myCardsModal` and `cardDateModal` (the others already
had it). Shortcuts `1/2/3/4/m` were firing *through* open modals. Enlarged the
snooze control (was `opacity: 0.25`, ~1.1:1, on a ~22×16px target), close
buttons and month arrows. Dropped the centred text + `0.1em` letter-spacing
from `.splash-input` — a leftover from the old password splash that was being
applied to the email field.

**Card art: 2.2 MB → 516 KB.** `assets/` was loading eagerly for a 150px-wide
carousel, with `platinum-card.png` alone at 819 KB. Ten PNGs converted to WebP
at display-appropriate width (600px max), quality chosen per image against a
PSNR target and the low-scoring ones checked visually before committing. The
three files that were *already* WebP were left alone rather than re-encoded
lossy-to-lossy. `sw.js` precaches only `/` and `/index.html`, so no manifest
needed updating.

**Known gap:** the month `‹ ›` arrows are `role="button"` spans, not real
buttons. They sit *inside* the tab `<button>`, so promoting them would nest
interactive elements and the parser would hoist them out. ARIA gets them
keyboard-reachable and named; the real fix is restructuring that tab.

### v2.7 (2026-07-28)
Corrections to the Detailed Report after reviewing the first generated PDF.
- **Benefit value and points value are now separate.** The old "Net Value After Fees" silently folded points redemptions into benefit value. Six named metrics replace it: Available / Redeemed / Expired / Still Claimable Benefit Value, Recorded Points Redemption Value, Net Benefit Value After Fees (`redeemed − fees`) and Total Tracked Value After Fees (`redeemed + points − fees`).
- **`windowPhase()` is the single authority on period status.** Root cause of the expired-benefit bug: `isYTDCurrent()` in `periods.js` has no branch for `annual`/`cal-annual` and falls through to `return false`, so every *unused* calendar-year credit looked like a closed window. Instances now carry real ISO `periodStart`/`periodEnd` and status is derived from those vs `reportDate`. Bounds are inclusive. The printed expiry and the status read the same field, so they cannot disagree.
- **Utilization ≠ break-even.** `assessCard()` only returns "Benefits Underutilized" when value was actually left unclaimed. AMEX Gold at 100% utilization and −$36 net now reads "Near Break-Even", not "Underutilized".
- New statuses `snoozed`, `not-eligible`; labels reworded (Available — Unused, Expired — Unused, Intentionally Excluded, Data Missing).
- Duplicate benefit names (two DoorDash grocery credits) get a distinguishing `displayName`; records are never merged.
- Face value vs personal value reported side by side, reusing the existing custom-amounts store — **no migration**.
- Points redemption sources (`perks-points-sources`) are user-declared only, never inferred; first-year cards carry a welcome-bonus non-recurrence caveat.
- Print density tightened: **12 pages → 7**.
- Tests: 76 passing, incl. `tests/report-regression-2026.test.mjs` pinning the real 2026 figures against `tests/fixtures/report-2026.mjs`.

### v2.6 (~Jul 2026)
- **Export & Reports** (nav `export-report`) — replaces the raw per-card table as the primary export. Three options: **Detailed Report**, **CSV / Raw Data** (scorecard + one row per benefit-period), **JSON Backup** (raw records + computed report).
  - **Detailed Report** is an 11-section written review: header stats, executive summary, portfolio scorecard, card-by-card narrative, per-benefit activity timeline, used benefits, missed/unused benefits, expiration & upcoming opportunities, annual fee analysis, recommendations, methodology.
  - Config modal (period, cards, section toggles, group-by, format) persisted to `perks-report-options`.
  - Formats: in-app preview, print/PDF via a standalone popup window, downloadable HTML, Markdown.
  - **Status model** (`report-model.js`): `fully-used`, `partially-used`, `unused`, `expired-unused`, `expired-partially-used`, `upcoming`, `not-yet-available`, `excluded`, `unknown`. Missed value comes **only** from closed windows; open windows report "remaining opportunity". Skipped/snoozed periods are `excluded` and leave the utilization denominator. Periods before a card was opened are `unknown`, never `unused`.
  - `REPORT_CSS` in `report-view.js` is the single source of truth for report styling — injected into the app for the preview and inlined into the standalone print document.
  - The Annual Recap view's original CSV + print export is unchanged.
- SW cache bumped to v44.

### v2.5 (~May 2026)
- **Achievements / Badges** (`js/badges.js`, `renderBadgesView()` in `main.js`) — 100+ badges across 5 tiers: Bronze, Silver, Gold, Platinum, Legendary. Categories: streaks, portfolio size, total value captured, single-card value, fee mastery (profit milestone + simultaneous profit count), card-specific mastery, claim volume, completionist (grand slam, all-in, perfect rate), category specialists (Uber, dining, travel loyalty), and brand/bank loyalty badges. Flip-card UI with locked/unlocked visuals. `checkBadges()` runs on sign-in and every toggle; `backfill2025Badges()` retroactively awards 2025 badges on first sign-in. Badges persisted to `user_profiles` (JSON column). Toast notification on unlock.
- **Benefit Digest** (`renderDigest()` in `views.js`, nav `digest`) — merged Use It Now + per-deadline buckets. "Act now" urgency-ranked list with dismiss (×) and Restore. Collapsed "By Deadline" buckets (monthly / quarterly / semi-annual / annual). Collapsed "Dismissed" section with per-item Restore + "Restore all". Hero total of at-risk value.
- **Portfolio Value** (`renderNetValue()` in `views.js`, nav `net-value`) — portfolio-level hero: net captured now vs projected, layered progress bar (projected behind captured). Per-card breakdown sorted by capture %, each row with captured/projected/fee bar.
- **Fee Optimizer** (`renderFeeOptimizer()` in `views.js`, nav `fee-optimizer`) — cancel-impact per card (fee − projected), sorted highest-impact first. Verdict: "Cancel and save $X", "Borderline", or "Keep". Portfolio net + coverage bar.
- **Card flip** (`buildCardBack()` in `views.js`) — tap card image to flip to back side showing points multipliers per category and current capture progress.
- **Email Digest** — opt-in weekly email via Supabase Edge Function `send-weekly-digest` (uses Resend with verified domain). Toggle in Settings → Notifications → "Weekly digest email". `buildDigestCache()` + `saveDigestCache()` in `main.js` keeps `digest_cache` in `user_profiles` fresh. Requires `RESEND_API_KEY` secret on the function.
- **Landscape side-rail nav** — on landscape orientation, bottom tab bar becomes a vertical side rail.
- SW cache bumped to v35.

### v2.4 (~May 2026)
- **Export Report** (`renderExport()` in `views.js`, nav `export-report`) — per-card year-end report (Captured / Missed / Net vs Fee / Capture % / ROI grade), reuses `calcStats` + `getYTDPeriods` + `getROIGrade` with the recap pattern of `selectedYear` save/restore. `window.downloadBenefitsCSV` builds a CSV blob and downloads `perks-ledger-{year}.csv`. Print/PDF via `window.print()` + `@media print` rules that hide everything except `.export-report`.
- **Fee Tracker** integrated into Renewal Calendar — `feeHistory(ck)` derives the timeline from `historicalFees` + `card.fee`, `feeSparkline()` renders a compact bar chart; top alert lists cards that raised fees this year; each calendar row gets a `▲` (`.rc-up`) indicator with prior fee in the title.
- **Web Push** (background, app-closed) — opt-in toggle in Settings → Notifications. SW handles `push` (showNotification) + `notificationclick` (focus/open). Subscribe flow in `enablePush()`/`disablePush()` writes to `push_subscriptions` and flips `user_profiles.push_enabled`. Edge Function `send-push` reuses each user's `digest_cache` (no second cache column needed) to send via `npm:web-push`, pruning 404/410 subs. Cron runs daily at 16:00 UTC. **Requires manual setup** — see "Web Push setup" below.
- SW cache bumped to v32.

### v2.3 (~May 2026)
- **Renewal Calendar** (`renderRenewalCalendar()` in `views.js`, nav `renewal-calendar`) — 12-month timeline of every visible card's fee/anniversary date (via `getCardFeeMonth/Day` + `daysUntilFee`-style calc), grouped by month from the current month forward, sorted by days-until; shows fee + urgency color (≤30d / ≤60d). Rows tap through to that card (`goToCardPeriod`). Wired into `render()` dispatch, `_analyticsViews`, `setActiveView`, More grid, `_DRAWER_ICONS`. CSS: `.rc-*` classes.
- **Per-benefit reminders** (`firePerBenefitReminders()` in `main.js`) — opt-in (`notif-perbenefit`, default off). For each unclaimed, non-snoozed, non-skipped, available benefit whose current period is within its cadence's expiry window (monthly 3d / quarterly 7d / semi 14d / annual 30d), fires one local notification, capped at 6, deduped per `notifb-{card}-{benefit}-{pk}`. Fires on load, on enable, and when the toggle is switched on.
- SW cache bumped to v31.

### v2.2 (~May 2026)
- **Card Simulator** (`renderCardSimulator()` in `views.js`, nav `card-simulator`) — projects annual value for any unowned card using the user's real per-category capture rates derived from existing card history (e.g. dining at 80% applies 80%, not 100%). Renders grade A–D, net projected vs fee, layered max-vs-projected bar, per-category behavior profile, and per-benefit breakdown with claim-rate annotation. `window.setSimCard(k)` switches the simulated card. Added to desktop drawer + mobile bottom sheet nav. SW cache bumped to v27.

### v2.1 (~May 2026)
- PWA lock to portrait orientation
- More page as pill grid
- Collapsible Security section in Settings
- Heatmap card label fixes
- Bottom sheet scroll lock on iOS

### v2.0
- Split `app.js` into 6 ES modules (cards, state, storage, periods, views, main)
- Settings screen (replaced My Cards modal) — profile name, password change, card picker
- Hi [name] greeting in drawer and bottom sheet
- Drawer icons mapped from `_DRAWER_ICONS`

### v1.x (earlier)
- Auth system (Supabase email/password + demo mode)
- Card year view, YTD view, history dots, summary donut
- Snooze system (per-benefit, date-range, legacy format auto-upgrade)
- Skip / undo / shake-to-undo
- Partial use tracking + partial bar
- Notes per benefit per period
- Credited toggle (credit pending / posted)
- Pull to refresh (Supabase sync)
- Confetti on full card claim + profit milestone
- ROI grades (A/B/C/D), projections, trends
- Priority queue ("Use It Now") with urgency scoring
- Streaks leaderboard
- Missed money heatmap
- Annual recap view
- History log (from `benefit_log` table)
- Notifications (end-of-month monthly benefit reminder)
- Service worker / PWA manifest / iOS standalone mode
- Keyboard shortcuts (1/2/3/4/m/Escape)
- Card carousel (desktop auto-scroll)
- Drag-to-reorder cards (card selector + ROI/trends/heatmap rows)
- Fee date overrides per card
- Dark/light mode toggle with system preference detection

---

## Bug Fixes Applied (2026-05-20)

### 1. Note/partial/credit listeners never fired
**Root cause:** `set(html)` queued DOM update 180ms later, but `querySelectorAll('.add-note')` etc. in `renderCurrent()` ran immediately against the OLD DOM. Listeners attached to old nodes were destroyed with the DOM swap.
**Fix:** Added optional `onReady` callback to `set()`. `renderCurrent()` now passes all post-DOM event binding inside this callback, guaranteeing they run after the new HTML is inserted.

### 2. Category breakdown counted all cards, not user's cards
**Root cause:** `buildCategoryBreakdown()` iterated `Object.keys(CARDS)` — the full card catalog — instead of `getVisibleCardKeys()`.
**Fix:** Changed to `getVisibleCardKeys()`.

### 3. Card drag reorder never synced to cloud
**Root cause:** Reordering cards in the card selector only wrote to `localStorage('perks-card-order')` but didn't call `scheduleSave()`, so the order was lost on other devices until the next benefit toggle triggered a save.
**Fix:** Added `scheduleSave()` after the `localStorage.setItem` call in the drop handler.

### 4. Benefit history used hardcoded card name map
**Root cause:** `renderHistoryLog()` had a hardcoded `cardNames` object that was missing newer cards (`wf_premier_autograph`, etc.).
**Fix:** Replaced with `CARD_LABELS[entry.card_key]` — always up to date.

### 5. Summary view showed hardcoded "ends Jun 2026"
**Root cause:** `renderSummBase()` expiry tag was hardcoded to `"ends Jun 2026"` for all benefits with an `expiresAfter` field.
**Fix:** Now dynamically renders `"ends Jun/Dec YYYY"` using `b.expiresAfter.h` and `b.expiresAfter.y`.

---

## Supabase Schema

| Table | Purpose |
|---|---|
| `tracker_data` | One row per user — all benefit usage + extras in a single JSON column |
| `user_profiles` | `user_id`, `cards[]`, `digest_enabled`, `digest_cache` (JSON), `push_enabled`, `badges` (JSON array of earned badge IDs + timestamps) — card selection, digest, push opt-in, achievements |
| `benefit_log` | Append-only toggle history (used by History Log view) |
| `perks_push_subscriptions` | One row per device — VAPID push subscription JSON, RLS-scoped to user (named with prefix to avoid collision with the Monitor app's `push_subscriptions` table in the same project) |

RLS: users can only access their own rows. Anon/publishable key is safe to expose in frontend.

---

## Email Digest setup

The weekly digest Edge Function (`send-weekly-digest`) uses [Resend](https://resend.com) to email unclaimed benefits per user.

1. **Verify a sending domain** in the Resend dashboard and note the FROM address.
2. **Set the function secret** (Supabase Dashboard → Edge Functions → `send-weekly-digest` → Secrets):
   - `RESEND_API_KEY`
3. **Run the migration** `supabase/digest_migration.sql` to add `digest_enabled` + `digest_cache` to `user_profiles`.
4. **Deploy the function:**
   ```bash
   supabase functions deploy send-weekly-digest --project-ref rsbvddlhismetljqoqre
   ```
5. **Schedule the cron** by running `supabase/cron_schedule.sql` in the SQL editor (weekly, Monday 09:00 UTC by default).

Users opt in from Settings → Notifications → "Weekly digest email". The frontend saves a `digest_cache` JSON snapshot to `user_profiles` on toggle and after each benefit change, so the function doesn't need to re-fetch live data.

---

## Web Push setup

The Web Push code is shipped but inactive until you complete these steps:

1. **Generate VAPID keys** (one time):
   ```bash
   npx web-push generate-vapid-keys
   ```
   Note the `Public Key` and `Private Key` (base64url strings).

2. **Frontend:** paste the public key into `VAPID_PUBLIC_KEY` at the top of `js/main.js`, then bump the `?v=` query string and SW cache.

3. **Run the SQL migration** in the Supabase SQL editor:
   ```
   supabase/push_migration.sql
   ```

4. **Set the function secrets** (Supabase Dashboard → Edge Functions → `send-push` → Secrets):
   - `VAPID_PUBLIC_KEY` — same value as the frontend constant
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` — e.g. `mailto:jason.huey1@gmail.com`

5. **Deploy the function:**
   ```bash
   supabase functions deploy send-push --project-ref rsbvddlhismetljqoqre
   ```

6. **Schedule the cron** by running `supabase/push_cron.sql` in the SQL editor (daily at 16:00 UTC by default).

7. **Test on a device:** Settings → Notifications → enable notifications → toggle "Background push". Then fire the function manually from the SQL editor (see the test snippet in `push_cron.sql`).

iOS PWAs require the app installed to the Home Screen and iOS ≥16.4 for Web Push.

---

## Feature Roadmap Ideas

### High Value
- **Auto-detection via Plaid/bank feed** — detect when a statement credit posts and auto-mark it used
- **"Best card for this purchase" widget** — enter a merchant/category and see which card earns most

### Medium Value
- **Google / Apple Sign-In** — reduce signup friction; still uses Supabase Auth under the hood
- **Household / shared mode** — two users on the same Supabase row (need row-level locking)
- **Points value tracker** — alongside dollar credits, track points balances and estimated value
- **Benefit category filter on All Cards** — filter the all-cards view to just "dining" or "travel" benefits
- **Snooze calendar picker** — replace plain `<input type="month">` with a proper calendar UI
- **Custom benefit names** — rename "Dining Credit" to "Grubhub" for faster scanning
- **Card upgrade advisor** — "You're using 95% of Sapphire Preferred benefits — consider upgrading to Reserve"

### Lower Priority / Nice to Have
- **Offline-first improvements** — currently falls back to localStorage, but explicit offline queuing of toggle actions
- **Deep links** — `perks.hueyventures.org/#priority` opens directly to Use It Now
- **iOS Lock Screen widget** — not currently possible with PWA, but a reference shortcut app could bridge it
- **Apple Pay / Wallet integration** — show recommended card when tapping to pay (requires native app)
- **AI assistant** — natural language: "What should I use this month?" uses benefit data + urgency scoring
- **Confetti on mobile** — currently disabled for Mobi user agents; re-enable with a lighter particle count
- **Keyboard navigation for cards** — arrow keys to switch active card, Enter to expand
- **Swipe between months** — currently swipe switches primary tabs; add vertical swipe or dedicated gesture for month navigation in This Period view

---

## Known Limitations
- **Partial input on mobile** — number inputs can be awkward; a slider or stepper might be better UX
- **Benefit categories** — `BENEFIT_CATEGORIES` in `cards.js` is a manual map; adding new benefits requires updating it

## Fixed (2026-05-27)
- **Snooze from/until reversed range** — `setSnoozedBenefit()` now swaps `from`/`until` when reversed (YYYY-MM strings sort lexically) so a backwards range is no longer a silent no-op
- **Semi-annual & feb-annual trends double-count** — removed the prior-year spillover pushes (`cy-${y-1}-${fm}-h2` and `feb-${y-1}`) in `capturedForYear()`; each card-year period now counts only toward its card-year-start calendar year
