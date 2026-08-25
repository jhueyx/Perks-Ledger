// Tests for the pure break-even model (js/breakeven-model.js).
//
//   node --test 'tests/*.test.mjs'
//
// No browser globals needed — the module is deliberately free of DOM and
// storage so the chart can never disagree with the numbers under it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cumulativeByMonth, breakEvenPoint, paceStatus, buildBreakEven, breakEvenVerdict,
} from '../js/breakeven-model.js';

const claims = ms => ms.map(([month, amount]) => ({ month, amount }));

test('cumulative capture only ever climbs', () => {
  const c = cumulativeByMonth(claims([[0, 50], [1, 25], [3, 100]]));
  assert.deepEqual(c.slice(0, 5), [50, 75, 75, 175, 175]);
  assert.equal(c.length, 12);
});

test('several claims in one month sum into that month', () => {
  const c = cumulativeByMonth(claims([[2, 10], [2, 15], [2, 5]]));
  assert.equal(c[2], 30);
  assert.equal(c[1], 0);
});

test('claims outside the year are ignored rather than throwing', () => {
  const c = cumulativeByMonth(claims([[-1, 100], [12, 100], [0, 20]]));
  assert.equal(c[11], 20);
});

test('fractional amounts do not drift', () => {
  const c = cumulativeByMonth(claims(Array.from({ length: 12 }, (_, m) => [m, 10.1])));
  assert.equal(c[11], 121.2);
});

test('break-even is found and interpolated inside the crossing month', () => {
  // 0 → 60 → 140 against a 100 fee: crosses halfway through month 1.
  const c = cumulativeByMonth(claims([[0, 60], [1, 80]]));
  const p = breakEvenPoint(c, 100);
  assert.equal(p.reached, true);
  assert.equal(p.month, 1);
  assert.equal(p.fraction, 0.5);
});

test('break-even reports not-reached rather than guessing', () => {
  const c = cumulativeByMonth(claims([[0, 10]]));
  assert.deepEqual(breakEvenPoint(c, 500), { month: null, fraction: 0, reached: false });
});

test('a no-fee card is break-even from the start', () => {
  assert.equal(breakEvenPoint(cumulativeByMonth([]), 0).reached, true);
});

test('pace compares capture against an even share of the fee', () => {
  // Half the year gone, half the fee captured — exactly on pace.
  const c = cumulativeByMonth(claims([[0, 50], [1, 50], [2, 50], [3, 50], [4, 50], [5, 50]]));
  const p = paceStatus({ cumulative: c, fee: 600, monthsElapsed: 6 });
  assert.equal(p.captured, 300);
  assert.equal(p.target, 300);
  assert.equal(p.onPace, true);
  assert.equal(p.aheadBy, 0);
});

test('pace flags falling behind and says what it would take to recover', () => {
  const c = cumulativeByMonth(claims([[0, 10], [1, 10], [2, 10]]));
  const p = paceStatus({ cumulative: c, fee: 600, monthsElapsed: 3 });
  assert.equal(p.onPace, false);
  assert.equal(p.shortfall, 570);
  assert.equal(p.requiredPerMonth, 63.33);   // 570 over the 9 remaining months
  assert.equal(p.willClear, false);
});

test('a finished year has no remaining months and no divide-by-zero', () => {
  const c = cumulativeByMonth(claims([[0, 100]]));
  const p = paceStatus({ cumulative: c, fee: 600, monthsElapsed: 12 });
  assert.equal(p.remainingMonths, 0);
  assert.equal(p.requiredPerMonth, 0);
  assert.equal(Number.isFinite(p.projectedTotal), true);
});

test('a year that has not started yet reports zero rather than NaN', () => {
  const p = paceStatus({ cumulative: cumulativeByMonth([]), fee: 400, monthsElapsed: 0 });
  assert.equal(p.captured, 0);
  assert.equal(p.actualPerMonth, 0);
  assert.equal(Number.isFinite(p.projectedTotal), true);
});

test('the model splits the line into what happened and what is projected', () => {
  const m = buildBreakEven({ claims: claims([[0, 100], [1, 100], [2, 100]]), fee: 600, monthsElapsed: 3 });
  assert.equal(m.actual.length, 3, 'three months have actually happened');
  assert.equal(m.projected.length, 9, 'the rest is projection');
  assert.deepEqual(m.actual, [100, 200, 300]);
  assert.equal(m.projected[8], 1200, 'projecting 100/mo to year end');
});

test('the chart ceiling always leaves the fee line headroom', () => {
  const m = buildBreakEven({ claims: [], fee: 550, monthsElapsed: 1 });
  assert.ok(m.ceiling > m.fee, 'fee line must not sit flush against the top');
});

test('ceiling is never zero, even with no fee and no claims', () => {
  const m = buildBreakEven({ claims: [], fee: 0, monthsElapsed: 0 });
  assert.ok(m.ceiling > 0, 'a zero ceiling would divide by zero when scaling the chart');
});

test('verdict: cleared', () => {
  const m = buildBreakEven({ claims: claims([[0, 700]]), fee: 600, monthsElapsed: 1 });
  const v = breakEvenVerdict(m);
  assert.equal(v.tone, 'good');
  assert.match(v.text, /cleared/i);
  assert.match(v.text, /100/);
});

test('verdict: on track but not there yet', () => {
  const m = buildBreakEven({ claims: claims([[0, 100], [1, 100]]), fee: 600, monthsElapsed: 2 });
  const v = breakEvenVerdict(m);
  assert.equal(v.tone, 'ok');
  assert.match(v.text, /on track/i);
});

test('verdict: behind, and states the rate needed', () => {
  const m = buildBreakEven({ claims: claims([[0, 5]]), fee: 600, monthsElapsed: 6 });
  const v = breakEvenVerdict(m);
  assert.equal(v.tone, 'bad');
  assert.match(v.text, /behind pace/i);
});

test('verdict on a no-fee card does not claim a shortfall', () => {
  const m = buildBreakEven({ claims: [], fee: 0, monthsElapsed: 5 });
  assert.equal(breakEvenVerdict(m).tone, 'good');
});

test('the model agrees with itself: cumulative end == actual + projected end', () => {
  const m = buildBreakEven({ claims: claims([[0, 40], [1, 60], [2, 80]]), fee: 300, monthsElapsed: 3 });
  assert.equal(m.actual[m.actual.length - 1], m.pace.captured);
  assert.equal(m.projected[m.projected.length - 1], m.pace.projectedTotal);
});
