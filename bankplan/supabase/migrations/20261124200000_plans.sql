-- Plans: one row per business plan. Each user can only see and change their own plans.
-- GDPR: we store only what the app needs. The user's email lives in Supabase Auth;
-- this table holds no names, ID codes or contact details.

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  country text not null default 'EE',          -- rule set to use (config/countries/<country>.ts)
  plan_type text not null default 'bank_loan', -- wizard to use (plan-types/<plan_type>/)
  company_type text not null,                  -- 'OU' or 'FIE' for Estonia; checked in the app
  answers jsonb not null default '{}'::jsonb,  -- wizard answers, filled from Phase 3
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plans_user_id_idx on public.plans (user_id);

alter table public.plans enable row level security;

create policy "Users can read their own plans"
  on public.plans for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own plans"
  on public.plans for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own plans"
  on public.plans for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own plans"
  on public.plans for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Keep updated_at current on every change.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

-- "Delete my account": removes the signed-in user's login.
-- Their plans are removed too (on delete cascade above).
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
