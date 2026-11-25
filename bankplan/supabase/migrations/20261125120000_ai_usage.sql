-- Daily AI limit per user, so that nobody can run up the AI bill.
-- Stores only: user id, day (Estonian time), number of AI requests. Deleted with the account.
create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  calls integer not null default 0,
  primary key (user_id, day)
);

-- Row-level security on, and no policies: users cannot read or change the table directly.
-- Only the function below (which runs as its owner) touches it.
alter table public.ai_usage enable row level security;

-- Counts one AI request for the signed-in user. Returns false when today's limit is used up.
create function public.use_ai_call(daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
begin
  if auth.uid() is null then
    return false;
  end if;
  insert into public.ai_usage as u (user_id, day, calls)
  values (auth.uid(), (now() at time zone 'Europe/Tallinn')::date, 1)
  on conflict (user_id, day) do update set calls = u.calls + 1
  returning u.calls into used;
  return used <= daily_limit;
end;
$$;

revoke execute on function public.use_ai_call(integer) from public, anon;
grant execute on function public.use_ai_call(integer) to authenticated;
