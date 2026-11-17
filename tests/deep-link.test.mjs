// Tests for the #card= deep link resolver (js/deepLink.js).
//
//   node --test 'tests/*.test.mjs'

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cardFromHash, resolveCardLink, withoutCardHash } from '../js/deepLink.js';
import { PREMIUM_CARD_CATALOG, CARD_LABELS } from '../js/cards.js';

const mine = ['gold', 'platinum', 'csr', 'wf_premier_autograph'];
const r = raw => resolveCardLink(raw, PREMIUM_CARD_CATALOG, mine, CARD_LABELS);

test('reads #card= values, decoded', () => {
  assert.equal(cardFromHash('#card=csr'), 'csr');
  assert.equal(cardFromHash('#card=Sapphire%20Reserve'), 'Sapphire Reserve');
  assert.equal(cardFromHash('#x=1&card=Amex'), 'Amex');
  assert.equal(cardFromHash('#other'), null);
  assert.equal(cardFromHash(''), null);
  assert.equal(cardFromHash('#card=%E0%A4%A'), null);
});

test('resolves ids, names and partial names to held cards', () => {
  assert.equal(r('csr'), 'csr');
  assert.equal(r('Amex Platinum'), 'platinum');
  assert.equal(r('Sapphire Reserve'), 'csr');
  assert.equal(r('Autograph'), 'wf_premier_autograph');
  assert.equal(r('Gold'), 'gold');
});

test('resolves issuers and rewards programs (Nexus sends these)', () => {
  assert.equal(r('Amex'), 'gold');                 // first held Amex card
  assert.equal(r('Membership Rewards'), 'gold');
  assert.equal(r('Chase'), 'csr');
  assert.equal(r('Wells Fargo'), 'wf_premier_autograph');
});

test('never selects a card the user does not hold', () => {
  assert.equal(r('Venture X'), null);
  assert.equal(r('Capital One'), null);
  assert.equal(r('World of Hyatt'), null);
  assert.equal(r('<script>'), null);
  assert.equal(resolveCardLink('csr', PREMIUM_CARD_CATALOG, [], CARD_LABELS), null);
});

test('strips only the card link from the URL', () => {
  assert.equal(withoutCardHash('https://p.example/#card=csr'), '/');
  assert.equal(withoutCardHash('https://p.example/?a=1#card=csr&x=2'), '/?a=1#x=2');
});
