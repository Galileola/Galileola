-- Numbers entered on the "Numbers and loan calculator" screen (src/lib/finance/inputs.ts).
-- Empty object = not filled in yet. Results are calculated in the app, not stored.
alter table public.plans
  add column finance jsonb not null default '{}'::jsonb;
