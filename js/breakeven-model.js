// Break-even model — pure. No DOM, no storage, no period math.
//
// The app has always been able to say "you have captured $X of your $Y fee."
// What it could not say is whether $X is *good for the date* — 62% is ahead of
// pace in May and behind it in November. Everything here works on a plain list
// of {month, amount} claims plus the fee, so it is unit-testable and cannot
// drift with the rendering.
//
// Months are 0-indexed positions within the card year, not calendar months:
// position 0 is the month the card year starts. The caller does that mapping.

export const MONTHS_IN_YEAR = 12;

function r2(n) { return Math.round(n * 100) / 100; }

// Cumulative captured value at the end of each month position.
export function cumulativeByMonth(claims, monthCount = MONTHS_IN_YEAR) {
  const perMonth = new Array(monthCount).fill(0);
  for (const c of claims || []) {
    const m = Number(c.month);
    if (!Number.isInteger(m) || m < 0 || m >= monthCount) continue;
    perMonth[m] += Number(c.amount) || 0;
  }
  const out = [];
  let running = 0;
  for (let m = 0; m < monthCount; m++) {
    running += perMonth[m];
    out.push(r2(running));
  }
  return out;
}

// The month position where cumulative capture first covers the fee.
// `fraction` interpolates within that month so the marker can sit between
// gridlines rather than snapping to the end of it.
export function breakEvenPoint(cumulative, fee) {
  if (!(fee > 0)) return { month: 0, fraction: 0, reached: true };
  for (let m = 0; m < cumulative.length; m++) {
    if (cumulative[m] >= fee) {
      const prev = m > 0 ? cumulative[m - 1] : 0;
      const gained = cumulative[m] - prev;
      const fraction = gained > 0 ? Math.min(1, Math.max(0, (fee - prev) / gained)) : 0;
      return { month: m, fraction: r2(fraction), reached: true };
    }
  }
  return { month: null, fraction: 0, reached: false };
}

// Is capture keeping up with the calendar? `monthsElapsed` is how many month
// positions have completed (1 = the first month is done).
export function paceStatus({ cumulative, fee, monthsElapsed, monthCount = MONTHS_IN_YEAR }) {
  const elapsed = Math.min(Math.max(monthsElapsed, 0), monthCount);
  const captured = elapsed > 0 ? cumulative[elapsed - 1] : 0;
  // Straight-line target: an even share of the fee per month.
  const target = r2((fee * elapsed) / monthCount);
  const remainingMonths = monthCount - elapsed;
  const shortfall = r2(Math.max(0, fee - captured));

  // Projection assumes the rate so far continues.
  const perMonth = elapsed > 0 ? captured / elapsed : 0;
  const projectedTotal = r2(captured + perMonth * remainingMonths);

  return {
    captured: r2(captured),
    target,
    aheadBy: r2(captured - target),
    onPace: captured >= target,
    remainingMonths,
    shortfall,
    // What the remaining months must average to still clear the fee.
    requiredPerMonth: remainingMonths > 0 ? r2(shortfall / remainingMonths) : 0,
    actualPerMonth: r2(perMonth),
    projectedTotal,
    projectedNet: r2(projectedTotal - fee),
    willClear: projectedTotal >= fee,
  };
}

// Everything a break-even chart needs, from claims + fee + where we are.
export function buildBreakEven({ claims, fee, monthsElapsed, monthCount = MONTHS_IN_YEAR, label = '' }) {
  const cumulative = cumulativeByMonth(claims, monthCount);
  const pace = paceStatus({ cumulative, fee, monthsElapsed, monthCount });
  const crossed = breakEvenPoint(cumulative, fee);

  // Only the elapsed part of the line is real; the rest is a projection.
  const elapsed = Math.min(Math.max(monthsElapsed, 0), monthCount);
  const actual = cumulative.slice(0, elapsed);
  const projected = [];
  for (let m = elapsed; m < monthCount; m++) {
    projected.push(r2(pace.captured + pace.actualPerMonth * (m - elapsed + 1)));
  }

  return {
    label,
    fee: r2(fee),
    monthCount,
    monthsElapsed: elapsed,
    cumulative,
    actual,
    projected,
    crossed,
    pace,
    // Chart headroom: never let the fee line sit flush against the top.
    ceiling: r2(Math.max(fee, cumulative[monthCount - 1] || 0, pace.projectedTotal) * 1.08) || 1,
  };
}

// One-line verdict. Kept here rather than in the view so the wording is
// covered by the same tests as the numbers behind it.
export function breakEvenVerdict(model) {
  const { pace, crossed, fee } = model;
  if (fee <= 0) return { tone: 'good', text: 'No annual fee — everything captured is profit.' };
  if (crossed.reached && pace.captured >= fee) {
    return { tone: 'good', text: `Fee cleared — $${r2(pace.captured - fee).toFixed(0)} ahead so far.` };
  }
  if (pace.willClear) {
    return { tone: 'ok', text: `On track — $${pace.shortfall.toFixed(0)} to go, about $${pace.requiredPerMonth.toFixed(0)}/mo.` };
  }
  return {
    tone: 'bad',
    text: `Behind pace — needs $${pace.requiredPerMonth.toFixed(0)}/mo to clear, currently averaging $${pace.actualPerMonth.toFixed(0)}/mo.`,
  };
}
