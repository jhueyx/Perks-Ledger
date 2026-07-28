-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor)
-- Schedules the weekly digest every Sunday at 18:00 UTC.
--
-- IMPORTANT: keep the url on ONE line. The job that ran in production from
-- 2026-05-31 to 2026-07-26 was pasted with a line break wrapped into the middle
-- of the URL string ('.../send-weekly-di\n  gest'), so every one of its 9 runs
-- failed with "URL using bad/illegal format or missing URL" and no digest was
-- ever delivered. pg_cron stores the command verbatim, whitespace included.

select cron.unschedule('send-weekly-digest');

select cron.schedule(
  'send-weekly-digest',
  '0 18 * * 0',
  $job$select net.http_post(url := 'https://rsbvddlhismetljqoqre.supabase.co/functions/v1/send-weekly-digest', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb) as request_id;$job$
);

-- Verify it was created, and that the stored command has no stray newline:
-- select jobname, schedule, active, position(E'\n' in command) as newline_pos
-- from cron.job where jobname = 'send-weekly-digest';
--
-- Check whether recent runs actually succeeded:
-- select r.status, r.start_time, r.return_message
-- from cron.job_run_details r join cron.job j on j.jobid = r.jobid
-- where j.jobname = 'send-weekly-digest' order by r.start_time desc limit 10;

-- To remove it:
-- select cron.unschedule('send-weekly-digest');

-- To test immediately (fires the function right now — this really does send
-- the digest email to every opted-in user):
-- select net.http_post(
--   url := 'https://rsbvddlhismetljqoqre.supabase.co/functions/v1/send-weekly-digest',
--   headers := '{"Content-Type":"application/json"}'::jsonb,
--   body := '{}'::jsonb
-- );
