import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM = 'Perks Ledger <digest@hueyventures.org>';

Deno.serve(async (req) => {
  // Only pg_cron may run this: it sends the shared secret from Supabase Vault
  // (see supabase/cron_secret.sql), and the database checks it, so the value
  // never lives in this function. verify_jwt stays off because cron has no JWT.
  const { data: authorized, error: authErr } = await supabase.rpc('perks_check_cron_secret', {
    candidate: req.headers.get('x-cron-secret'),
  })
  if (authErr || authorized !== true) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 401 })
  }
  const { data: profiles, error } = await supabase
    .from('user_profiles')
    .select('user_id, digest_cache, digest_last_sent')
    .eq('digest_enabled', true)
    .not('digest_cache', 'is', null);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let sent = 0, skipped = 0, failed = 0;

  const now = new Date();
  for (const profile of profiles ?? []) {
    // Weekly at most: the function is publicly invokable (verify_jwt=false for
    // pg_cron), so a repeat call must not re-send.
    const last = profile.digest_last_sent ? new Date(profile.digest_last_sent).getTime() : 0;
    if (now.getTime() - last < MIN_GAP_MS) { skipped++; continue; }

    const raw = profile.digest_cache as DigestCache | null;
    const cache = raw ? freshOnly(raw, now) : null;
    if (!cache || cache.total_unclaimed <= 0) { skipped++; continue; }

    // Never trust a client-written address: send to the account's auth email.
    const { data: u } = await supabase.auth.admin.getUserById(profile.user_id);
    const to = u?.user?.email;
    if (!to) { skipped++; continue; }

    try {
      const html = buildEmailHTML(cache);
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM,
          to,
          subject: `$${cache.total_unclaimed} unclaimed — your weekly perks digest`,
          html,
        }),
      });

      if (res.ok) {
        await supabase
          .from('user_profiles')
          .update({ digest_last_sent: new Date().toISOString() })
          .eq('user_id', profile.user_id);
        sent++;
      } else {
        const body = await res.text();
        console.error(`Resend error for ${profile.user_id}:`, body);
        failed++;
      }
    } catch (e) {
      console.error('Send failed:', e);
      failed++;
    }
  }

  return new Response(
    JSON.stringify({ sent, skipped, failed, total: profiles?.length ?? 0 }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});

const MIN_GAP_MS = 6 * 86400000;

// The cache only refreshes when the app is opened, so drop any bucket whose
// period has already reset since then. Periods are computed in the user's
// local time (tz_offset_min from the client), not UTC.
function freshOnly(c: DigestCache, now: Date): DigestCache | null {
  if (!c.updated_at) return null;
  const off = (c.tz_offset_min ?? 0) * 60000;
  const local = (d: Date) => new Date(d.getTime() - off);
  const n = local(now), a = local(new Date(c.updated_at));
  const sameY = n.getUTCFullYear() === a.getUTCFullYear();
  const nm = n.getUTCMonth(), am = a.getUTCMonth();
  const out: DigestCache = {
    ...c,
    monthly: sameY && nm === am ? c.monthly ?? [] : [],
    quarterly: sameY && Math.floor(nm / 3) === Math.floor(am / 3) ? c.quarterly ?? [] : [],
    semiannual: sameY && (nm < 6) === (am < 6) ? c.semiannual ?? [] : [],
    // Annual buckets mix calendar and card-year periods; keep them for 31 days.
    annual: now.getTime() - new Date(c.updated_at).getTime() <= 31 * 86400000 ? c.annual ?? [] : [],
  };
  out.total_unclaimed = [...out.monthly, ...out.quarterly, ...out.semiannual, ...out.annual]
    .reduce((s, i) => s + (i.amt || 0), 0);
  return out;
}

interface BucketItem { card: string; name: string; amt: number; }
interface DigestCache {
  email: string;
  total_unclaimed: number;
  monthly: BucketItem[];
  quarterly: BucketItem[];
  semiannual: BucketItem[];
  annual: BucketItem[];
  updated_at: string;
  tz_offset_min?: number;
}

function buildEmailHTML(cache: DigestCache): string {
  const buckets = [
    { key: 'monthly' as const,     label: 'This month',     urgency: true  },
    { key: 'quarterly' as const,   label: 'This quarter',   urgency: false },
    { key: 'semiannual' as const,  label: 'This half-year', urgency: false },
    { key: 'annual' as const,      label: 'This year',      urgency: false },
  ];

  const bucketRows = buckets
    .filter(b => cache[b.key]?.length > 0)
    .map(b => {
      const items = cache[b.key];
      const total = items.reduce((s, i) => s + i.amt, 0);
      const rows = items
        .sort((a, b) => b.amt - a.amt)
        .map(i => `
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #222">
              <div style="font-size:13px;color:#f0f0f0;font-weight:500">${escHtml(i.name)}</div>
              <div style="font-size:11px;color:#666;font-family:monospace;margin-top:2px">${escHtml(i.card)}</div>
            </td>
            <td style="padding:10px 0;border-bottom:1px solid #222;text-align:right;font-size:14px;font-weight:700;font-family:monospace;color:#2A9B6A;white-space:nowrap">$${i.amt}</td>
          </tr>`).join('');

      const headerColor = b.urgency ? '#C8922A' : '#888';
      return `
        <div style="background:#141414;border-radius:10px;padding:16px 18px;margin-bottom:12px">
          <table style="width:100%;border-collapse:collapse;margin-bottom:8px"><tr>
            <td style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${headerColor};font-family:monospace;font-weight:600">${b.label}</td>
            <td style="font-size:13px;font-weight:700;font-family:monospace;color:#f0f0f0;text-align:right">$${total}</td>
          </tr></table>
          <table style="width:100%;border-collapse:collapse">${rows}</table>
        </div>`;
    }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Perks Ledger Digest</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="text-align:center;padding:32px 20px 28px;background:#141414;border-radius:14px;margin-bottom:20px">
      <div style="font-size:12px;font-family:monospace;color:#555;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:14px">Perks Ledger · Weekly Digest</div>
      <div style="font-size:52px;font-weight:700;color:#C8922A;font-family:monospace;line-height:1">$${cache.total_unclaimed}</div>
      <div style="font-size:14px;color:#888;margin-top:10px">unclaimed across all your cards</div>
    </div>
    ${bucketRows}
    <div style="text-align:center;margin-top:24px;margin-bottom:8px">
      <a href="https://perks.hueyventures.org" style="display:inline-block;background:#C8922A;color:#fff;text-decoration:none;padding:12px 32px;border-radius:100px;font-size:13px;font-weight:600;letter-spacing:0.02em">Open Perks Ledger →</a>
    </div>
    <div style="text-align:center;padding:16px;font-size:11px;color:#333;font-family:monospace">
      perks.hueyventures.org · <a href="https://perks.hueyventures.org" style="color:#444">turn off in Settings → Email Digest</a>
    </div>
  </div>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
