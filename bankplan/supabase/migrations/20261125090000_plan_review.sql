-- The bank officer check (src/lib/review/review.ts): the AI officer's summary, weak points
-- and questions, the owner's answers and their ratings. Null = no check made yet.
-- Covered by the existing row-level security on public.plans (owner only) and deleted with the plan.
alter table public.plans
  add column review jsonb;
