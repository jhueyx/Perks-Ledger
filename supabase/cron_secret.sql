-- Applied 2026-11-04 (migration "perks_cron_secret"). Idempotent.
-- Locks send-push and send-weekly-digest to pg_cron: the jobs send a shared
-- secret kept in Supabase Vault, and the functions ask the database to check
-- it (perks_check_cron_secret, callable by service_role only). The secret is
-- generated in the database and never leaves it.
-- This supersedes the cron.schedule calls in cron_schedule.sql / push_cron.sql.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'perks_cron_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'perks_cron_secret',
      'Perks Ledger: pg_cron -> edge function shared secret');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.perks_check_cron_secret(candidate text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT candidate IS NOT NULL AND EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'perks_cron_secret' AND decrypted_secret = candidate)
$$;
REVOKE ALL ON FUNCTION public.perks_check_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.perks_check_cron_secret(text) TO service_role;

-- Keep each command on ONE line (see the note in cron_schedule.sql).
SELECT cron.schedule('daily-perks-push', '0 16 * * *',
  $job$select net.http_post(url := 'https://rsbvddlhismetljqoqre.supabase.co/functions/v1/send-push', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'perks_cron_secret')), body := '{}'::jsonb) as request_id;$job$);
SELECT cron.schedule('send-weekly-digest', '0 18 * * 0',
  $job$select net.http_post(url := 'https://rsbvddlhismetljqoqre.supabase.co/functions/v1/send-weekly-digest', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'perks_cron_secret')), body := '{}'::jsonb) as request_id;$job$);

-- To fire a job by hand (really sends to opted-in users), run its command:
-- select command from cron.job where jobname = 'daily-perks-push';
