// Tests for the pending-write queue in js/storage.js.
//
//   node --test 'tests/*.test.mjs'
//
// These pin the failure path that used to lose data silently:
//
//   1. saveToStorage() advanced the local timestamp before it knew whether the
//      cloud write had landed. On failure the local copy therefore looked
//      NEWER than the cloud row, so syncFromSupabase() -- which pulls only
//      when remote > local -- refused to pull, permanently.
//   2. Nothing retried. The "cloud sync failed" message cleared after 3s and
//      the change lived on one device until the user happened to toggle
//      something else.
//
// The browser globals the modules touch at import time are stubbed below.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Browser stubs (must be installed before the modules are imported) ──────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

// A controllable stand-in for the Supabase client. `mode` decides whether the
// cloud accepts writes; `rows` is the single tracker_data row.
const cloud = { mode: 'ok', rows: null, updates: 0 };
function resetCloud() { cloud.mode = 'ok'; cloud.rows = null; cloud.updates = 0; }

const failure = { message: 'network', code: 'ENOTFOUND' };

globalThis.supabase = {
  createClient: () => ({
    from: table => {
      if (table === 'benefit_log') {
        // Fire-and-forget audit insert; never part of these assertions.
        return { insert: () => Promise.resolve({ error: null }) };
      }
      return {
        select: () => ({
          eq: () => ({
            single: () => cloud.mode === 'ok'
              ? Promise.resolve({ data: cloud.rows, error: null })
              : Promise.resolve({ data: null, error: failure }),
          }),
        }),
        update: payload => ({
          eq: () => ({
            select: () => {
              if (cloud.mode !== 'ok') return Promise.resolve({ data: null, error: failure });
              cloud.updates++;
              cloud.rows = { data: payload.data, updated_at: payload.updated_at };
              return Promise.resolve({ data: [{ user_id: 'u1' }], error: null });
            },
          }),
        }),
        insert: () => Promise.resolve({ error: null }),
      };
    },
  }),
};

// setSave() reads the DOM; give it somewhere harmless to write.
const saveEl = { className: '', textContent: '' };
globalThis.document = {
  getElementById: id => (id === 'saveStatus' ? saveEl : null),
  dispatchEvent: () => true,
  addEventListener: () => {},
};
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o); } };

let state, STORAGE_KEY, saveToStorage, syncFromSupabase, hasPendingSync, diffPayload, mergePayload;

before(async () => {
  ({ state, STORAGE_KEY } = await import('../js/state.js'));
  ({ saveToStorage, syncFromSupabase, hasPendingSync, diffPayload, mergePayload } = await import('../js/storage.js'));
});

const TS_KEY = () => `${STORAGE_KEY}-ts-u1`;
const PENDING_KEY = 'perks-pending-sync-u1';

beforeEach(() => {
  store.clear();
  resetCloud();
  state.currentUser = { id: 'u1' };
  state.DATA = { csr: {} };
});

test('a successful save advances the local timestamp and leaves nothing pending', async () => {
  await saveToStorage();
  assert.equal(cloud.updates, 1);
  assert.ok(store.get(TS_KEY()), 'local timestamp should be set');
  assert.equal(hasPendingSync(), false);
});

test('a failed save does NOT advance the local timestamp', async () => {
  // This is the corruption at the root of the bug: a local clock that ran
  // ahead of a write that never landed.
  cloud.mode = 'down';
  await saveToStorage();
  assert.equal(store.get(TS_KEY()), undefined, 'timestamp must not move on failure');
  assert.equal(hasPendingSync(), true);
});

test('a failed save leaves a standing message, not one that clears itself', async () => {
  cloud.mode = 'down';
  await saveToStorage();
  assert.match(saveEl.textContent, /unsynced/i);
  assert.match(saveEl.className, /error/);
});

test('a pending write is flushed before syncFromSupabase pulls', async () => {
  cloud.mode = 'down';
  await saveToStorage();
  assert.equal(hasPendingSync(), true);

  cloud.mode = 'ok';
  await syncFromSupabase();
  assert.equal(hasPendingSync(), false, 'reconnecting should flush the queued write');
  assert.ok(cloud.updates >= 1, 'the queued write should reach the cloud');
});

test('while still offline, syncFromSupabase does not pull over the unsynced change', async () => {
  state.DATA = { csr: { 'dining__2026-m1': true } };
  cloud.mode = 'down';
  await saveToStorage();

  // Cloud comes back holding an OLDER row that lacks the local change.
  cloud.rows = { data: { csr: {} }, updated_at: '2020-01-01T00:00:00.000Z' };
  cloud.mode = 'down';
  await syncFromSupabase();

  assert.equal(state.DATA.csr['dining__2026-m1'], true, 'local change must survive');
  assert.equal(hasPendingSync(), true);
});

test('the failed write is not lost — it reaches the cloud once it recovers', async () => {
  state.DATA = { csr: { 'uber__2026-m1': true } };
  cloud.mode = 'down';
  await saveToStorage();

  cloud.mode = 'ok';
  await saveToStorage();

  assert.equal(hasPendingSync(), false);
  assert.equal(cloud.rows.data.csr['uber__2026-m1'], true, 'the change should be in the cloud row');
  assert.ok(store.get(TS_KEY()), 'timestamp advances once the write lands');
});

test('regression: a stale local clock no longer wedges the pull shut', async () => {
  // Before the fix the failed save below stamped a fresh local timestamp, so
  // every later remote row read as older and was never pulled again.
  cloud.mode = 'down';
  await saveToStorage();
  cloud.mode = 'ok';
  await saveToStorage();                       // recovers, clears pending

  // Another device now writes something newer.
  cloud.rows = { data: { csr: { 'saks__2026-m1': true } }, updated_at: '2099-01-01T00:00:00.000Z' };
  await syncFromSupabase();
  assert.equal(state.DATA.csr['saks__2026-m1'], true, 'newer remote data should arrive');
});

test('flushing rebases onto a newer remote row instead of overwriting it', async () => {
  // Establish a confirmed baseline both devices share.
  state.DATA = { csr: { 'dining__2026-m1': true } };
  await saveToStorage();

  // This device goes offline and records one more benefit.
  cloud.mode = 'down';
  state.DATA = { csr: { 'dining__2026-m1': true, 'uber__2026-m1': true } };
  await saveToStorage();
  assert.equal(hasPendingSync(), true);

  // Meanwhile the other device records a different one.
  cloud.rows = {
    data: { csr: { 'dining__2026-m1': true, 'saks__2026-m1': true } },
    updated_at: '2099-01-01T00:00:00.000Z',
  };

  cloud.mode = 'ok';
  await saveToStorage();

  assert.equal(hasPendingSync(), false);
  assert.equal(cloud.rows.data.csr['uber__2026-m1'], true, 'this device\'s offline edit survives');
  assert.equal(cloud.rows.data.csr['saks__2026-m1'], true, 'the other device\'s edit is not clobbered');
  assert.equal(state.DATA.csr['saks__2026-m1'], true, 'and the merge is reflected locally');
});

test('a rebase keeps an un-toggle made on this device', async () => {
  state.DATA = { csr: { 'dining__2026-m1': true } };
  await saveToStorage();

  cloud.mode = 'down';
  state.DATA = { csr: { 'dining__2026-m1': false } };   // un-toggled here
  await saveToStorage();

  cloud.rows = {
    data: { csr: { 'dining__2026-m1': true, 'saks__2026-m1': true } },
    updated_at: '2099-01-01T00:00:00.000Z',
  };
  cloud.mode = 'ok';
  await saveToStorage();

  assert.equal(cloud.rows.data.csr['dining__2026-m1'], false, 'the local un-toggle wins over the stale remote value');
  assert.equal(cloud.rows.data.csr['saks__2026-m1'], true, 'unrelated remote entries are preserved');
});

test('diffPayload reports only what this device changed', () => {
  const base = { csr: { a: true, b: false }, _notes: { n1: 'x' } };
  const cur  = { csr: { a: true, b: true  }, _notes: { n1: 'x', n2: 'y' } };
  assert.deepEqual(diffPayload(base, cur), { csr: { b: true }, _notes: { n2: 'y' } });
});

test('mergePayload layers changes over the remote without dropping remote keys', () => {
  const remote  = { csr: { a: true, z: true } };
  const changes = { csr: { b: true } };
  assert.deepEqual(mergePayload(remote, changes), { csr: { a: true, z: true, b: true } });
});

test('demo accounts never queue a cloud write', async () => {
  state.currentUser = { id: 'demo' };
  await saveToStorage();
  assert.equal(hasPendingSync(), false);
  assert.equal(store.get(PENDING_KEY), undefined);
});

test('a pull records the merge baseline even when nothing changed', async () => {
  // Without this, a device already in step with the cloud has no baseline, so
  // its first rebase would fall back to overwriting the remote row wholesale.
  state.DATA = { csr: {} };
  cloud.rows = { data: { csr: {} }, updated_at: '2099-01-01T00:00:00.000Z' };
  await syncFromSupabase();
  assert.ok(store.get('perks-synced-base-u1'), 'baseline should be recorded');
});

test('with no baseline yet, a rebase still does not lose the remote row', async () => {
  // Fresh device, never synced: diffPayload has nothing to measure against, so
  // it reports the whole payload. The remote keys it does not mention survive.
  cloud.mode = 'down';
  state.DATA = { csr: { 'uber__2026-m1': true } };
  await saveToStorage();
  cloud.rows = { data: { gold: { 'dining__2026-m1': true } }, updated_at: '2099-01-01T00:00:00.000Z' };
  cloud.mode = 'ok';
  await saveToStorage();
  assert.equal(cloud.rows.data.csr['uber__2026-m1'], true);
  assert.equal(cloud.rows.data.gold['dining__2026-m1'], true, 'untouched remote card survives');
});

test('concurrent saves are serialised, not raced', async () => {
  // A retry timer firing while the user toggles must not let two rebases read
  // the same remote row and race each other's write.
  state.DATA = { csr: { 'a__2026-m1': true } };
  const [r1, r2, r3] = await Promise.all([saveToStorage(), saveToStorage(), saveToStorage()]);
  assert.equal(cloud.updates, 1, 'only one write should reach the cloud');
  assert.equal(hasPendingSync(), false);
});
