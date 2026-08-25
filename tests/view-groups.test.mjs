// Navigation wiring for the consolidated view groups.
//
//   node --test 'tests/*.test.mjs'
//
// The grouping moved ten drawer entries behind three tab strips. Every tab is
// still its own view id, so it needs a render dispatch AND a setActiveView
// branch — miss either and the tab renders blank or the nav highlight sticks
// on the wrong entry, neither of which throws. These read the real sources.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

let VIEW_GROUPS, VIEW_GROUP_OF, GROUP_ENTRY, viewsSrc, mainSrc, htmlSrc;

before(async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  };
  globalThis.supabase = { createClient: () => ({ from: () => ({}) }) };
  // views.js touches these at module scope for the carousel / media queries.
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {} };
  globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  ({ VIEW_GROUPS, VIEW_GROUP_OF, GROUP_ENTRY } = await import('../js/views.js'));
  viewsSrc = src('js/views.js');
  mainSrc = src('js/main.js');
  htmlSrc = src('index.html');
});

const allTabs = () => Object.values(VIEW_GROUPS).flatMap(g => g.tabs);

test('every tab has a render dispatch', () => {
  const missing = allTabs()
    .filter(t => !viewsSrc.includes(`state.activeView==='${t.view}'`))
    .map(t => t.view);
  assert.deepEqual(missing, [], 'these tabs would render blank');
});

test('every tab has a setActiveView branch', () => {
  const missing = allTabs()
    .filter(t => !mainSrc.includes(`primary==='${t.view}'`))
    .map(t => t.view);
  assert.deepEqual(missing, [], 'these tabs are unreachable from nav');
});

test('every tab counts as an analytics view, so the card chrome hides', () => {
  const line = viewsSrc.slice(viewsSrc.indexOf('const _analyticsViews='));
  const list = line.slice(0, line.indexOf('];'));
  const missing = allTabs().filter(t => !list.includes(`'${t.view}'`)).map(t => t.view);
  assert.deepEqual(missing, [], 'these would render under the card carousel');
});

test('no view belongs to two groups', () => {
  const seen = new Set(), dupes = [];
  for (const t of allTabs()) {
    if (seen.has(t.view)) dupes.push(t.view);
    seen.add(t.view);
  }
  assert.deepEqual(dupes, []);
});

test('each group entry points at one of its own tabs', () => {
  for (const [g, entry] of Object.entries(GROUP_ENTRY)) {
    assert.ok(VIEW_GROUPS[g].tabs.some(t => t.view === entry), `${g} entry is not one of its tabs`);
  }
});

test('VIEW_GROUP_OF is the exact inverse of VIEW_GROUPS', () => {
  for (const [g, { tabs }] of Object.entries(VIEW_GROUPS)) {
    for (const t of tabs) assert.equal(VIEW_GROUP_OF[t.view], g);
  }
  assert.equal(Object.keys(VIEW_GROUP_OF).length, allTabs().length);
});

test('grouped views no longer have their own drawer entry', () => {
  // A leftover entry would route straight past the tab strip, so the view
  // would render with no way back to its siblings.
  const orphans = allTabs()
    .filter(t => htmlSrc.includes(`data-primary="${t.view}"`))
    .map(t => t.view);
  assert.deepEqual(orphans, [], 'these bypass their group');
});

test('every group has a drawer entry of its own', () => {
  for (const g of Object.keys(VIEW_GROUPS)) {
    assert.ok(htmlSrc.includes(`data-primary="${g}"`), `${g} is not reachable from the drawer`);
  }
});

test('every group has a drawer icon', () => {
  for (const g of Object.keys(VIEW_GROUPS)) {
    assert.ok(mainSrc.includes(`'${g}':\``), `${g} would render with a blank icon`);
  }
});

test('the More grid offers groups, not the views inside them', () => {
  const grid = mainSrc.slice(mainSrc.indexOf('function renderMore()'));
  const body = grid.slice(0, grid.indexOf('];'));
  for (const g of Object.keys(VIEW_GROUPS)) {
    assert.ok(body.includes(`view:'${g}'`), `More grid is missing ${g}`);
  }
  const leaked = allTabs().filter(t => body.includes(`view:'${t.view}'`)).map(t => t.view);
  assert.deepEqual(leaked, [], 'these bypass their group from the More grid');
});

test('the break-even view is wired end to end', () => {
  // The one genuinely new view in the group — easy to half-connect.
  assert.ok(VIEW_GROUP_OF['break-even'], 'should belong to a group');
  assert.ok(viewsSrc.includes('renderBreakEven'), 'render function should exist');
  assert.ok(viewsSrc.includes("state.activeView==='break-even'"), 'should be dispatched');
  assert.ok(mainSrc.includes("primary==='break-even'"), 'should be routable');
});

test('bottom tab bar addresses groups, not views inside them', () => {
  // updateBottomTabBar() compares against the group id, so a tab pointing at
  // a grouped view would simply never highlight.
  const tabs = [...htmlSrc.matchAll(/data-bottom="([a-z-]+)"/g)].map(m => m[1]);
  const leaked = tabs.filter(t => VIEW_GROUP_OF[t]);
  assert.deepEqual(leaked, [], 'these tabs would never light up');
  assert.ok(tabs.length, 'sanity: found some bottom tabs');
});
