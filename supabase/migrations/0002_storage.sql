-- 0002_storage.sql
-- Storage accounting for Cloudflare R2: the family storage cap and monthly
-- operation limits (app_settings), monthly operation counters (r2_usage),
-- upload reservations (pending_uploads), and the functions the server calls
-- before issuing presigned URLs. Paste into the Supabase SQL Editor and run
-- once, after 0001_schema.sql.

-- ===========================================================================
-- app_settings: a single row of admin-controlled limits
-- ===========================================================================

create table public.app_settings (
  id                  int primary key default 1,
  storage_limit_bytes bigint not null default 10737418240, -- 10 GB (R2 free tier)
  class_a_limit       bigint not null default 900000,      -- free tier: 1,000,000 / month
  class_b_limit       bigint not null default 9000000,     -- free tier: 10,000,000 / month
  updated_at          timestamptz not null default now(),
  constraint app_settings_single_row check (id = 1),
  constraint app_settings_storage_limit_positive check (storage_limit_bytes > 0),
  constraint app_settings_ops_limits_not_negative check (class_a_limit >= 0 and class_b_limit >= 0)
);

insert into public.app_settings (id) values (1);

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- r2_usage: operations counted per calendar month (UTC)
-- ===========================================================================

create table public.r2_usage (
  month   date primary key,
  class_a bigint not null default 0,
  class_b bigint not null default 0,
  constraint r2_usage_first_of_month check (extract(day from month) = 1)
);

-- ===========================================================================
-- pending_uploads: space reserved for uploads that have not completed yet
-- ===========================================================================

create table public.pending_uploads (
  storage_key text primary key,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  size_bytes  bigint not null check (size_bytes > 0),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '2 hours'
);

create index pending_uploads_owner_id_idx on public.pending_uploads (owner_id);

-- ===========================================================================
-- Functions
-- ===========================================================================

-- Counts presigned URLs / direct R2 calls against this month's limit.
-- p_class: 'a' (writes: PUT, parts, multipart create/complete/abort, delete)
-- or 'b' (reads: GET, HEAD). Raises 'ops_limit' instead of exceeding the limit.
create function public.consume_r2_ops(p_class text, p_count int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_month date := date_trunc('month', now() at time zone 'utc')::date;
  month_usage public.r2_usage%rowtype;
  limits public.app_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_class is null or p_class not in ('a', 'b') then
    raise exception 'invalid_class' using errcode = 'invalid_parameter_value';
  end if;
  if p_count is null or p_count < 1 or p_count > 1000 then
    raise exception 'invalid_count' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.r2_usage (month) values (current_month) on conflict (month) do nothing;
  -- Row lock: concurrent calls for the same month are serialized here.
  select * into month_usage from public.r2_usage where month = current_month for update;
  select * into limits from public.app_settings where id = 1;

  if p_class = 'a' then
    if month_usage.class_a + p_count > limits.class_a_limit then
      raise exception 'ops_limit';
    end if;
    update public.r2_usage set class_a = class_a + p_count where month = current_month;
  else
    if month_usage.class_b + p_count > limits.class_b_limit then
      raise exception 'ops_limit';
    end if;
    update public.r2_usage set class_b = class_b + p_count where month = current_month;
  end if;
end;
$$;

-- Bytes counted against the family cap: every stored item plus live reservations.
create function public.storage_used_bytes()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(i.size_bytes) from public.items i), 0)::bigint
    + coalesce((select sum(p.size_bytes) from public.pending_uploads p where p.expires_at > now()), 0)::bigint;
$$;

-- Reserves space for an upload, or raises 'storage_full'.
create function public.reserve_upload(p_storage_key text, p_size bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_uid uuid := auth.uid();
  storage_limit bigint;
begin
  if current_uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_storage_key is null or left(p_storage_key, 37) <> current_uid::text || '/'
     or char_length(p_storage_key) <= 37 then
    raise exception 'invalid_storage_key' using errcode = 'insufficient_privilege';
  end if;
  if p_size is null or p_size <= 0 then
    raise exception 'invalid_size' using errcode = 'invalid_parameter_value';
  end if;

  -- One reservation at a time, so parallel uploads cannot overshoot the cap.
  perform pg_advisory_xact_lock(hashtextextended('fcn.reserve_upload', 0));

  delete from public.pending_uploads where expires_at <= now();

  select s.storage_limit_bytes into storage_limit from public.app_settings s where s.id = 1;
  if public.storage_used_bytes() + p_size > storage_limit then
    raise exception 'storage_full';
  end if;

  insert into public.pending_uploads (storage_key, owner_id, size_bytes)
  values (p_storage_key, current_uid, p_size);
end;
$$;

-- Returns the reserved size of one of the caller's uploads (null if none) and,
-- if p_extend, pushes its expiry 2 hours ahead so long uploads stay reserved.
create function public.pending_upload_size(p_storage_key text, p_extend boolean default false)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  reserved bigint;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  if p_extend then
    update public.pending_uploads
      set expires_at = greatest(expires_at, now() + interval '2 hours')
      where storage_key = p_storage_key and owner_id = auth.uid() and expires_at > now()
      returning size_bytes into reserved;
  else
    select size_bytes into reserved
      from public.pending_uploads
      where storage_key = p_storage_key and owner_id = auth.uid();
  end if;

  return reserved;
end;
$$;

-- Drops one of the caller's reservations (after completing or aborting).
create function public.release_upload(p_storage_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  delete from public.pending_uploads
    where storage_key = p_storage_key and owner_id = auth.uid();
end;
$$;

-- ===========================================================================
-- Privileges
-- ===========================================================================

revoke all on public.app_settings, public.r2_usage, public.pending_uploads from anon, authenticated;

grant select on public.app_settings to authenticated;
grant update (storage_limit_bytes, class_a_limit, class_b_limit) on public.app_settings to authenticated;
grant select on public.r2_usage to authenticated;
-- pending_uploads: no grants at all; only the functions above touch it.

revoke execute on function
  public.consume_r2_ops(text, int),
  public.storage_used_bytes(),
  public.reserve_upload(text, bigint),
  public.pending_upload_size(text, boolean),
  public.release_upload(text)
from public, anon;
grant execute on function
  public.consume_r2_ops(text, int),
  public.storage_used_bytes(),
  public.reserve_upload(text, bigint),
  public.pending_upload_size(text, boolean),
  public.release_upload(text)
to authenticated;

-- ===========================================================================
-- Row Level Security
-- ===========================================================================

alter table public.app_settings enable row level security;
alter table public.r2_usage enable row level security;
alter table public.pending_uploads enable row level security;

create policy app_settings_select on public.app_settings
  for select to authenticated
  using (true);

create policy app_settings_update_admin on public.app_settings
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

create policy r2_usage_select_admin on public.r2_usage
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

-- pending_uploads: RLS on and no policies, so the API cannot read or write it.
