// Every shipped ES module must parse.
//
// The unit and integration suites never import report-view.js (it needs a DOM),
// so a stray backtick inside its REPORT_CSS template literal terminated the
// literal and broke the module while all 80 other tests still passed. This
// closes that hole by parsing every file the browser loads, DOM-dependent ones
// included, via `node --check` on an ESM copy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const JS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
const files = readdirSync(JS_DIR).filter(f => f.endsWith('.js')).sort();

test('js/ contains the modules the app loads', () => {
  ['report-model.js', 'report.js', 'report-view.js', 'views.js', 'main.js',
    'storage.js', 'periods.js', 'state.js', 'cards.js', 'badges.js']
    .forEach(f => assert.ok(files.includes(f), `${f} should exist in js/`));
});

test('every module in js/ parses as an ES module', () => {
  const dir = mkdtempSync(join(tmpdir(), 'perks-parse-'));
  const broken = [];
  try {
    for (const file of files) {
      // .mjs so `node --check` parses it as ESM rather than CommonJS.
      const copy = join(dir, file.replace(/\.js$/, '.mjs'));
      copyFileSync(join(JS_DIR, file), copy);
      try {
        execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
      } catch (e) {
        broken.push(`${file}: ${String(e.stderr || e.message).split('\n').slice(0, 3).join(' ')}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(broken, []);
});
