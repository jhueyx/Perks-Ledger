// The popup auto-print bootstrap.
//
// Symptom: "Print / Save as PDF" did nothing on the first attempt and only
// worked on a second try. Two independent causes, both reproduced below:
//   1. The popup's initial about:blank fires `load` while the artwork embed is
//      still awaited, so a plain load listener registers too late and never
//      fires.
//   2. A popup that has not been painted receives no animation frames, so
//      scheduling the print through requestAnimationFrame silently never ran.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

// report-view.js pulls in views.js, which assigns to window at module scope.
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.supabase = { createClient: () => ({ from: () => ({}) }) };
globalThis.document = {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){} }, appendChild(){}, addEventListener(){}, setAttribute(){} }),
  head: { appendChild(){} }, body: { appendChild(){} }, addEventListener: () => {},
  documentElement: { getAttribute: () => null, setAttribute: () => {} },
};

let AUTO_PRINT_JS;
before(async () => { ({ AUTO_PRINT_JS } = await import('../js/report-view.js')); });

/**
 * Runs the bootstrap against a fake popup.
 * @param {object} opts readyState when the script runs, whether images are
 *   already decoded, and whether the frame gets animation frames at all.
 */
async function runBootstrap({ readyState = 'loading', imagesComplete = true, animationFrames = true } = {}) {
  let printCalls = 0, imagesCompleteAtPrint = null, loadHandler = null;
  const images = [{
    complete: imagesComplete,
    addEventListener(ev, cb) {
      if (ev !== 'load') return;
      setTimeout(() => { this.complete = true; cb(); }, 5);
    },
  }];
  const sandbox = {
    document: {
      get readyState() { return readyState; },
      images,
      fonts: { ready: Promise.resolve() },
    },
    setTimeout, clearTimeout, Promise,
    // An unpainted popup never invokes the callback.
    requestAnimationFrame: animationFrames ? (cb => setTimeout(cb, 5)) : (() => {}),
  };
  sandbox.window = sandbox;
  sandbox.window.focus = () => {};
  sandbox.window.print = () => { printCalls++; imagesCompleteAtPrint = images.every(i => i.complete); };
  sandbox.window.addEventListener = (ev, cb) => { if (ev === 'load') loadHandler = cb; };

  vm.createContext(sandbox);
  vm.runInContext(AUTO_PRINT_JS, sandbox);
  // The document finishes parsing after the inline script runs.
  if (loadHandler) { readyState = 'complete'; images.forEach(i => { i.complete = true; }); loadHandler(); }
  await new Promise(r => setTimeout(r, 200));
  return { printCalls, imagesCompleteAtPrint };
}

test('prints once when the load event still arrives', async () => {
  const r = await runBootstrap({ readyState: 'loading' });
  assert.equal(r.printCalls, 1);
  assert.equal(r.imagesCompleteAtPrint, true, 'never prints before the artwork has decoded');
});

test('prints when the document is already complete — the about:blank race', async () => {
  // about:blank loaded and fired `load` while the artwork embed was awaited, so
  // there is no load event left to listen for.
  const r = await runBootstrap({ readyState: 'complete' });
  assert.equal(r.printCalls, 1, 'must not depend on a load event that already fired');
});

test('prints in a popup that receives no animation frames', async () => {
  const r = await runBootstrap({ readyState: 'complete', animationFrames: false });
  assert.equal(r.printCalls, 1, 'an unpainted popup gets no rAF; the print must still happen');
});

test('waits for images that have not decoded yet', async () => {
  const r = await runBootstrap({ readyState: 'complete', imagesComplete: false });
  assert.equal(r.printCalls, 1);
  assert.equal(r.imagesCompleteAtPrint, true);
});

test('never prints twice', async () => {
  let printCalls = 0;
  const sandbox = {
    document: { readyState: 'complete', images: [], fonts: { ready: Promise.resolve() } },
    setTimeout, clearTimeout, Promise, requestAnimationFrame: cb => setTimeout(cb, 5),
  };
  sandbox.window = sandbox;
  sandbox.window.focus = () => {};
  sandbox.window.print = () => { printCalls++; };
  sandbox.window.addEventListener = (ev, cb) => { if (ev === 'load') setTimeout(cb, 10); };
  vm.createContext(sandbox);
  vm.runInContext(AUTO_PRINT_JS, sandbox);
  vm.runInContext(AUTO_PRINT_JS, sandbox); // a second copy must not double-fire this one
  await new Promise(r => setTimeout(r, 250));
  assert.equal(printCalls, 2, 'each bootstrap fires exactly once');
});

test('does not schedule the print through requestAnimationFrame', () => {
  // The identifier appears in an explanatory comment; what must not exist is a
  // call, since rAF is starved in an unpainted popup.
  const code = AUTO_PRINT_JS.replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /requestAnimationFrame\s*\(/,
    'rAF is starved in an unpainted popup — that is what broke the first print');
  assert.match(AUTO_PRINT_JS, /readyState/, 'must not assume the load event is still coming');
});
