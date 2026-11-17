// Deep link to a card: https://perks.hueyventures.org/#card=<id or name>
// opens This Period on that card. Nexus's Daily Briefing links here from
// "Check your card" and "Evaluate this transfer bonus" signals, and it sends
// a card name or issuer ("Sapphire Reserve", "Amex", "Membership Rewards"),
// not a Perks id, so this resolves names too.
//
// Pure: no DOM or storage, tested in tests/deep-link.test.mjs. Only cards the
// user holds are ever selected; anything else returns null and the app opens
// normally.

const ISSUER_ALIASES = {
  'amex': 'American Express', 'american express': 'American Express', 'membership rewards': 'American Express',
  'chase': 'Chase', 'ultimate rewards': 'Chase',
  'wells fargo': 'Wells Fargo', 'wf': 'Wells Fargo',
  'citi': 'Citi', 'thankyou': 'Citi', 'thank you': 'Citi',
  'capital one': 'Capital One', 'cap one': 'Capital One',
  'bank of america': 'Bank of America', 'boa': 'Bank of America',
  'bilt': 'Bilt', 'apple': 'Apple',
};

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The raw value of #card=… (URL-decoded), or null. */
export function cardFromHash(hash) {
  const m = /(?:^#|&)card=([^&]*)/.exec(String(hash ?? ''));
  if (!m) return null;
  let v;
  try { v = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch { return null; }
  v = v.trim();
  return v && v.length <= 80 ? v : null;
}

/**
 * Resolve a link value to a card id the user holds.
 * Order: exact id → exact name → name contains / is contained → issuer or
 * rewards program. Ties go to the order of the user's cards.
 * catalog: [{ id, issuer, name }]; labels: optional { id: display label }.
 */
export function resolveCardLink(raw, catalog, userCards, labels = {}) {
  if (!raw || !Array.isArray(userCards) || !userCards.length) return null;
  const held = userCards.map(id => {
    const c = catalog.find(x => x.id === id);
    return { id, issuer: c?.issuer ?? '', names: [c?.name, labels[id]].filter(Boolean).map(norm) };
  });
  const q = norm(raw);
  if (!q) return null;

  const byId = held.find(c => c.id === raw.trim() || norm(c.id) === q);
  if (byId) return byId.id;

  const exact = held.find(c => c.names.includes(q));
  if (exact) return exact.id;

  // "Sapphire Reserve" ⊂ "Chase Sapphire Reserve"; "Autograph" ⊂ "Premier Autograph Visa Infinite".
  // Require 4+ characters so short words like "Gold" still match but "Amex" falls to the issuer step.
  const partial = held.find(c => c.names.some(n => (q.length >= 4 && n.includes(q)) || (n.length >= 4 && q.includes(n))));
  if (partial && q.length >= 4 && !ISSUER_ALIASES[q]) return partial.id;

  const issuer = ISSUER_ALIASES[q];
  if (issuer) {
    const byIssuer = held.find(c => c.issuer === issuer);
    if (byIssuer) return byIssuer.id;
  }
  return partial ? partial.id : null;
}

/** The URL without the card link, for history.replaceState. */
export function withoutCardHash(href) {
  const u = new URL(href);
  const rest = u.hash.replace(/^#/, '').split('&').filter(p => p && !p.startsWith('card=')).join('&');
  return u.pathname + u.search + (rest ? `#${rest}` : '');
}
