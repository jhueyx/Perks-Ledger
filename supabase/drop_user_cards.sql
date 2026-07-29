-- Drops `user_cards`, a dead table from an early schema attempt (rows created
-- 2026-05-04). Nothing in any HueyVentures app references it — the live app
-- keeps the owned-card list in `user_profiles.cards`, and card-year start dates
-- come from `feeMonth`/`feeDay` in js/cards.js plus the `_feeOverrides` extras.
--
-- It had RLS enabled with zero policies, so it was already unreachable from the
-- browser client and was showing up in Supabase's security linter.
--
-- The three rows it held are preserved below so this is reversible.

create table if not exists user_cards_archive (
  id                    uuid,
  user_id               uuid,
  card_id               text,
  annual_fee            numeric,
  card_opened_date      date,
  card_year_start_month int,
  card_year_start_day   int,
  created_at            timestamp
);

insert into user_cards_archive
select id, user_id, card_id, annual_fee, card_opened_date,
       card_year_start_month, card_year_start_day, created_at
from user_cards
on conflict do nothing;

drop table if exists user_cards;
