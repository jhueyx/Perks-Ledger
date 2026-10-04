// Sends a Web Push notification to every device of users who have push enabled
// and have unclaimed benefits in their digest_cache that expire within days.
// Triggered daily by cron, but each period alerts at most once (push_sent_keys).
//
// Required function secrets (Dashboard → Edge Functions → send-push → Secrets):
//   VAPID_PUBLIC_KEY   — base64url public key  (same value the frontend uses)
//   VAPID_PRIVATE_KEY  — base64url private key
//   VAPID_SUBJECT      — e.g. "mailto:jason.huey1@gmail.com"
// Generate the pair locally with:  npx web-push generate-vapid-keys
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT')!,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

interface BucketItem { card: string; name: string; amt: number; }
interface DigestCache {
  total_unclaimed?: number;
  monthly?: BucketItem[];
  quarterly?: BucketItem[];
  semiannual?: BucketItem[];
  annual?: BucketItem[];
  updated_at?: string;
}
// Mirrors the Settings → Notifications toggles; a missing key means on.
type PushPrefs = { monthly?: boolean; quarterly?: boolean; semiannual?: boolean };
type Payload = { title: string; body: string; url: string; tag: string };

const DAY = 86400000;

// Mirrors the in-app reminders (scheduleMonthlyReminder in js/main.js): a bucket
// only alerts in the final days of its period, and only once per period. This
// used to fire every day for anything unclaimed, which meant a daily push since
// there is almost always some monthly credit still open.
// Annual is left out on purpose — card-year anniversaries vary, and the cache
// does not carry period end dates.
function windows(now: Date) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const today = Date.UTC(y, m, now.getUTCDate());
  const daysTo = (endY: number, endM: number) =>
    Math.round((Date.UTC(endY, endM + 1, 0) - today) / DAY); // last day of endM
  const q = Math.floor(m / 3), h = m < 6 ? 0 : 1;
  return [
    { key: 'monthly' as const,    when: 'this month',     id: `m-${y}-${m}`, daysLeft: daysTo(y, m),           thresh: 2,  same: (d: Date) => d.getUTCFullYear() === y && d.getUTCMonth() === m },
    { key: 'quarterly' as const,  when: 'this quarter',   id: `q-${y}-${q}`, daysLeft: daysTo(y, q * 3 + 2),   thresh: 4,  same: (d: Date) => d.getUTCFullYear() === y && Math.floor(d.getUTCMonth() / 3) === q },
    { key: 'semiannual' as const, when: 'this half-year', id: `h-${y}-${h}`, daysLeft: daysTo(y, h * 6 + 5),   thresh: 13, same: (d: Date) => d.getUTCFullYear() === y && (d.getUTCMonth() < 6 ? 0 : 1) === h },
  ];
}

// Returns a single notification covering every bucket that is in its expiry
// window and has not been pushed yet this period, plus the period ids it covers.
function buildPayload(cache: DigestCache, sent: string[], prefs: PushPrefs, now: Date): { payload: Payload; ids: string[] } | null {
  // The cache only refreshes when the app is opened. One from an earlier period
  // describes benefits that have already reset, so it must not be announced.
  const cachedAt = cache.updated_at ? new Date(cache.updated_at) : null;
  const due = windows(now).filter(w =>
    prefs[w.key] !== false &&
    w.daysLeft >= 0 && w.daysLeft <= w.thresh &&
    !sent.includes(w.id) &&
    cachedAt !== null && w.same(cachedAt) &&
    ((cache[w.key] as BucketItem[] | undefined) ?? []).length > 0,
  );
  if (!due.length) return null;

  const items = due.flatMap(w => cache[w.key] as BucketItem[]).sort((a, b) => b.amt - a.amt);
  const total = items.reduce((s, i) => s + i.amt, 0);
  const lead = items.slice(0, 2).map(i => `${i.name} $${i.amt}`).join(', ');
  const more = items.length > 2 ? ` +${items.length - 2} more` : '';
  // Soonest-expiring bucket names the period ("this month" before "this quarter").
  const first = [...due].sort((a, b) => a.daysLeft - b.daysLeft)[0];
  return {
    payload: {
      title: `$${total} in benefits expiring ${first.when}`,
      body: `${lead}${more}`,
      url: '/#priority',
      tag: `perks-${first.key}`,
    },
    ids: due.map(w => w.id),
  };
}

Deno.serve(async () => {
  const now = new Date();
  const { data: profiles, error } = await supabase
    .from('user_profiles')
    .select('user_id, digest_cache, push_sent_keys, push_prefs')
    .eq('push_enabled', true)
    .not('digest_cache', 'is', null);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let sent = 0, skipped = 0, failed = 0, pruned = 0;

  for (const profile of profiles ?? []) {
    const already = (profile.push_sent_keys ?? []) as string[];
    const built = buildPayload((profile.digest_cache ?? {}) as DigestCache, already, (profile.push_prefs ?? {}) as PushPrefs, now);
    if (!built) { skipped++; continue; }

    const { data: subs } = await supabase
      .from('perks_push_subscriptions')
      .select('id, subscription')
      .eq('user_id', profile.user_id);

    let delivered = false;
    for (const row of subs ?? []) {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify(built.payload));
        sent++;
        delivered = true;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410 mean the subscription is dead — remove it.
        if (status === 404 || status === 410) {
          await supabase.from('perks_push_subscriptions').delete().eq('id', row.id);
          pruned++;
        } else {
          console.error('push failed', profile.user_id, status, e);
          failed++;
        }
      }
    }

    // Only mark the periods done once a device actually got the alert, so a
    // transient failure retries tomorrow instead of silently skipping.
    if (delivered) {
      const keys = [...already, ...built.ids].slice(-12);
      await supabase.from('user_profiles').update({ push_sent_keys: keys }).eq('user_id', profile.user_id);
    }
  }

  return new Response(
    JSON.stringify({ sent, skipped, failed, pruned, users: profiles?.length ?? 0 }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
