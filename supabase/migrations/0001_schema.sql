-- 0001_schema.sql
-- Initial FCN database schema: enums, the profiles / folders / items / item_shares
-- tables, integrity triggers, RLS helper functions and Row Level Security policies.
-- Meant to be pasted into the Supabase SQL Editor and run once on an empty project.
-- Only the `authenticated` role gets access; `anon` gets nothing.

-- ===========================================================================
-- Types
-- ===========================================================================

create type public.workspace_type as enum ('personal', 'shared');
create type public.item_kind as enum ('note', 'image', 'file');

-- ===========================================================================
-- Tables
-- ===========================================================================

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

create table public.folders (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  workspace  public.workspace_type not null,
  name       text not null,
  parent_id  uuid references public.folders (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint folders_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint folders_not_own_parent check (parent_id is null or parent_id <> id)
);

create table public.items (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  workspace       public.workspace_type not null,
  kind            public.item_kind not null,
  folder_id       uuid references public.folders (id) on delete cascade,
  title           text not null,
  content         text,
  storage_key     text unique,
  mime_type       text,
  size_bytes      bigint,
  shared_editable boolean not null default false,
  copied_from_id  uuid references public.items (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint items_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint items_size_not_negative check (size_bytes is null or size_bytes >= 0),
  constraint items_storage_matches_kind check (
    (kind = 'note' and storage_key is null)
    or (kind in ('image', 'file') and storage_key is not null and size_bytes is not null)
  )
);

create table public.item_shares (
  item_id     uuid not null references public.items (id) on delete cascade,
  shared_with uuid not null references public.profiles (id) on delete cascade,
  shared_by   uuid not null references public.profiles (id) on delete cascade,
  can_edit    boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (item_id, shared_with),
  constraint item_shares_not_self check (shared_with <> shared_by)
);

-- ===========================================================================
-- Indexes
-- ===========================================================================

create index items_owner_id_idx on public.items (owner_id);
create index items_workspace_idx on public.items (workspace);
create index items_folder_id_idx on public.items (folder_id);
create index items_kind_idx on public.items (kind);
create index folders_owner_id_idx on public.folders (owner_id);
create index folders_parent_id_idx on public.folders (parent_id);
create index item_shares_shared_with_idx on public.item_shares (shared_with);

-- ===========================================================================
-- Trigger functions
-- ===========================================================================

-- Creates a profile for every new auth user (invite or manual creation).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(new.email, '@', 1), ''),
      'משתמש'
    )
  );
  return new;
end;
$$;

-- Shared updated_at maintenance for every table that has the column.
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

-- Users may only change their own display_name. is_admin (and the key columns)
-- can only be changed outside a signed-in user context: SQL Editor or service role.
create function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.is_admin is distinct from old.is_admin then
    raise exception 'is_admin cannot be changed by a signed-in user'
      using errcode = 'insufficient_privilege';
  end if;

  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'only display_name can be changed'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- Editors who are not the owner may change title and content only. The owner may
-- change anything except ownership itself. SQL Editor / service role are not limited.
create function public.guard_item_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_uid uuid := auth.uid();
begin
  if current_uid is null then
    return new;
  end if;

  if old.owner_id = current_uid then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'item ownership cannot be transferred'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if (new.id, new.owner_id, new.workspace, new.kind, new.folder_id, new.storage_key,
      new.mime_type, new.size_bytes, new.shared_editable, new.copied_from_id, new.created_at)
     is distinct from
     (old.id, old.owner_id, old.workspace, old.kind, old.folder_id, old.storage_key,
      old.mime_type, old.size_bytes, old.shared_editable, old.copied_from_id, old.created_at)
  then
    raise exception 'only the owner can change this field; editors may change title and content only'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- Folder integrity: the parent is in the same workspace (and, for personal
-- folders, has the same owner), there are no cycles, and the folder's direct
-- contents stay in its workspace. Runs as a deferred constraint trigger, so a
-- whole subtree can be moved between workspaces inside a single transaction.
create function public.check_folder_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.folders%rowtype;
  p public.folders%rowtype;
begin
  -- Re-read the row: by the time a deferred check runs it may have changed or been deleted.
  select * into f from public.folders where id = new.id;
  if not found then
    return null;
  end if;

  if f.parent_id is not null then
    select * into p from public.folders where id = f.parent_id;
    if found then
      if p.workspace <> f.workspace then
        raise exception 'a folder must be in the same workspace as its parent folder'
          using errcode = 'check_violation';
      end if;
      if f.workspace = 'personal' and p.owner_id <> f.owner_id then
        raise exception 'a personal folder can only be placed inside a folder of the same owner'
          using errcode = 'check_violation';
      end if;
    end if;

    -- UNION (not UNION ALL) guarantees termination even if a cycle exists.
    if exists (
      with recursive ancestors (id) as (
        select f.parent_id
        union
        select a.parent_id
        from public.folders a
        join ancestors anc on a.id = anc.id
        where a.parent_id is not null
      )
      select 1 from ancestors where ancestors.id = f.id
    ) then
      raise exception 'a folder cannot be placed inside itself or one of its subfolders'
        using errcode = 'check_violation';
    end if;
  end if;

  if exists (
    select 1 from public.folders c
    where c.parent_id = f.id
      and (c.workspace <> f.workspace or (f.workspace = 'personal' and c.owner_id <> f.owner_id))
  ) or exists (
    select 1 from public.items i
    where i.folder_id = f.id
      and (i.workspace <> f.workspace or (f.workspace = 'personal' and i.owner_id <> f.owner_id))
  ) then
    raise exception 'folder contents must be in the same workspace as the folder'
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

-- Item integrity: an item inside a folder is in the folder's workspace (and,
-- for personal items, the folder has the same owner). Deferred, like the folder check.
create function public.check_item_folder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.items%rowtype;
  fo public.folders%rowtype;
begin
  select * into i from public.items where id = new.id;
  if not found or i.folder_id is null then
    return null;
  end if;

  select * into fo from public.folders where id = i.folder_id;
  if not found then
    return null;
  end if;

  if fo.workspace <> i.workspace then
    raise exception 'an item must be in the same workspace as its folder'
      using errcode = 'check_violation';
  end if;
  if i.workspace = 'personal' and fo.owner_id <> i.owner_id then
    raise exception 'a personal item can only be placed inside a folder of the same owner'
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

-- ===========================================================================
-- Triggers
-- ===========================================================================

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

create trigger folders_set_updated_at
  before update on public.folders
  for each row execute function public.set_updated_at();

create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

create trigger items_guard_update
  before update on public.items
  for each row execute function public.guard_item_update();

create constraint trigger folders_check_integrity
  after insert or update of parent_id, workspace, owner_id on public.folders
  deferrable initially deferred
  for each row execute function public.check_folder_integrity();

create constraint trigger items_check_folder
  after insert or update of folder_id, workspace, owner_id on public.items
  deferrable initially deferred
  for each row execute function public.check_item_folder();

-- ===========================================================================
-- RLS helper functions
-- security definer so they can read items / item_shares without triggering
-- RLS on those tables again (no policy recursion).
-- ===========================================================================

create function public.can_read_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.items i
    where i.id = p_item_id
      and (
        i.owner_id = auth.uid()
        or i.workspace = 'shared'
        or exists (
          select 1 from public.item_shares s
          where s.item_id = i.id and s.shared_with = auth.uid()
        )
      )
  );
$$;

create function public.can_edit_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.items i
    where i.id = p_item_id
      and (
        i.owner_id = auth.uid()
        or (i.workspace = 'shared' and i.shared_editable)
        or exists (
          select 1 from public.item_shares s
          where s.item_id = i.id and s.shared_with = auth.uid() and s.can_edit
        )
      )
  );
$$;

create function public.is_item_owner(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.items i
    where i.id = p_item_id and i.owner_id = auth.uid()
  );
$$;

-- ===========================================================================
-- Privileges
-- ===========================================================================

revoke all on public.profiles, public.folders, public.items, public.item_shares from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.folders to authenticated;
grant select, insert, update, delete on public.items to authenticated;
grant select, insert, delete on public.item_shares to authenticated;
grant update (can_edit) on public.item_shares to authenticated;

revoke execute on function
  public.can_read_item(uuid),
  public.can_edit_item(uuid),
  public.is_item_owner(uuid)
from public, anon;
grant execute on function
  public.can_read_item(uuid),
  public.can_edit_item(uuid),
  public.is_item_owner(uuid)
to authenticated;

-- Trigger functions are never called directly through the API.
revoke execute on function
  public.handle_new_user(),
  public.set_updated_at(),
  public.guard_profile_update(),
  public.guard_item_update(),
  public.check_folder_integrity(),
  public.check_item_folder()
from public, anon, authenticated;

-- ===========================================================================
-- Row Level Security
-- ===========================================================================

alter table public.profiles enable row level security;
alter table public.folders enable row level security;
alter table public.items enable row level security;
alter table public.item_shares enable row level security;

-- profiles: everyone signed in sees everyone (needed for sharing); users update
-- only their own row. No insert / delete through the API (no policies).
create policy profiles_select on public.profiles
  for select to authenticated
  using (true);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- folders
create policy folders_select on public.folders
  for select to authenticated
  using (owner_id = (select auth.uid()) or workspace = 'shared');

create policy folders_insert on public.folders
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy folders_update_owner on public.folders
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy folders_delete_owner on public.folders
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- items. The select / update policies are equivalent to can_read_item(id) /
-- can_edit_item(id); the owner and shared-workspace conditions are repeated
-- inline because the helper reads the table snapshot from before the current
-- statement, so on its own it would hide a row from `insert ... returning`.
create policy items_select on public.items
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or workspace = 'shared'
    or public.can_read_item(id)
  );

create policy items_insert on public.items
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy items_update on public.items
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    or (workspace = 'shared' and shared_editable)
    or public.can_edit_item(id)
  )
  with check (
    owner_id = (select auth.uid())
    or (workspace = 'shared' and shared_editable)
    or public.can_edit_item(id)
  );

create policy items_delete_owner on public.items
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- item_shares
create policy item_shares_select on public.item_shares
  for select to authenticated
  using (shared_with = (select auth.uid()) or shared_by = (select auth.uid()));

create policy item_shares_insert_owner on public.item_shares
  for insert to authenticated
  with check (shared_by = (select auth.uid()) and public.is_item_owner(item_id));

create policy item_shares_update_owner on public.item_shares
  for update to authenticated
  using (public.is_item_owner(item_id))
  with check (public.is_item_owner(item_id));

create policy item_shares_delete on public.item_shares
  for delete to authenticated
  using (public.is_item_owner(item_id) or shared_with = (select auth.uid()));
