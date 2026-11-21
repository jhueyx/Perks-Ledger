// Daily call caps for user-triggered Claude calls.
//
// Sign-up on this shared project is open, so a per-user cap alone can be
// dodged by making more accounts. Each feature therefore has two caps over a
// rolling 24 hours: one per user and one across all users (the spend ceiling).
// A call is counted when it is *reserved*, before Claude is called, so
// concurrent requests can't all slip under the cap.
//
// Rows go into public.ai_usage (feature = the name passed here) through a
// service-role client, which is needed to count other users' rows for the
// global cap. Override the defaults per feature with env secrets, e.g.
// AI_CAP_NEXUS_CHAT_USER=150 / AI_CAP_NEXUS_CHAT_GLOBAL=400.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type QuotaResult = { ok: true } | { ok: false; status: 429 | 500; error: string }

const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

function cap(feature: string, kind: 'USER' | 'GLOBAL', fallback: number): number {
  const key = `AI_CAP_${feature.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${kind}`
  const n = Number(Deno.env.get(key))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export async function reserveAiCall(
  userId: string,
  feature: string,
  defaults: { perUser: number; global: number },
): Promise<QuotaResult> {
  const db = admin()
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const perUser = cap(feature, 'USER', defaults.perUser)
  const global = cap(feature, 'GLOBAL', defaults.global)

  const [mine, all] = await Promise.all([
    db.from('ai_usage').select('id', { count: 'exact', head: true })
      .eq('feature', feature).eq('user_id', userId).gte('created_at', since),
    db.from('ai_usage').select('id', { count: 'exact', head: true })
      .eq('feature', feature).gte('created_at', since),
  ])
  // Fail closed: if the counter can't be read, don't spend money blind.
  if (mine.error || all.error) return { ok: false, status: 500, error: 'Usage check failed — try again shortly.' }
  if ((mine.count ?? 0) >= perUser) {
    return { ok: false, status: 429, error: `Daily AI limit reached (${perUser} per 24 hours). Try again tomorrow.` }
  }
  if ((all.count ?? 0) >= global) {
    return { ok: false, status: 429, error: 'The AI assistant has hit its daily limit. Try again tomorrow.' }
  }

  const { error } = await db.from('ai_usage').insert({ user_id: userId, feature })
  if (error) return { ok: false, status: 500, error: 'Usage check failed — try again shortly.' }
  return { ok: true }
}
