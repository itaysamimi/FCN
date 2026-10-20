-- rls_check.sql
-- RLS smoke test for 0001_schema.sql. Paste into the Supabase SQL Editor and run.
--
-- Creates three fake users (A, B, C), impersonates each of them with
-- `set local role` + request.jwt.claims, and prints one PASS / FAIL row per check.
--
-- Nothing is left behind: every change happens inside a block that is always
-- rolled back at the end (by raising an exception and catching it). That is used
-- instead of BEGIN ... ROLLBACK because the SQL Editor only displays the result
-- of the last statement, and that must be the SELECT that shows the results.
-- The helper functions live in pg_temp and disappear with the session.

-- Impersonate a user (p_user = null means anon).
create or replace function pg_temp.rls_login(p_user uuid)
returns void
language plpgsql
as $$
begin
  if p_user is null then
    set local role anon;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    set local role authenticated;
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', p_user, 'role', 'authenticated')::text,
      true
    );
  end if;
end;
$$;

create or replace function pg_temp.rls_run()
returns table (n int, result text, test text)
language plpgsql
as $$
declare
  user_a constant uuid := 'a0000000-0000-4000-8000-00000000000a';
  user_b constant uuid := 'b0000000-0000-4000-8000-00000000000b';
  user_c constant uuid := 'c0000000-0000-4000-8000-00000000000c';
  names text[] := '{}';
  oks boolean[] := '{}';
  a_personal uuid;
  a_shared uuid;
  a_to_b uuid;
  b_personal uuid;
  folder_1 uuid;
  folder_2 uuid;
  a_shared_folder uuid;
  table_name text;
  cnt int;
  ok boolean;
begin
  begin
    -- Run deferred constraint triggers at the end of each statement, so their
    -- errors can be caught per check.
    set constraints all immediate;

    -- -----------------------------------------------------------------------
    -- Setup (as the SQL Editor user)
    -- -----------------------------------------------------------------------
    insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
    values
      ('00000000-0000-0000-0000-000000000000', user_a, 'authenticated', 'authenticated',
       'rls-test-a@example.invalid', '{"display_name":"Test A"}', '{}', now(), now()),
      ('00000000-0000-0000-0000-000000000000', user_b, 'authenticated', 'authenticated',
       'rls-test-b@example.invalid', '{"display_name":"Test B"}', '{}', now(), now()),
      ('00000000-0000-0000-0000-000000000000', user_c, 'authenticated', 'authenticated',
       'rls-test-c@example.invalid', '{}', '{}', now(), now());

    select count(*) into cnt from public.profiles where id in (user_a, user_b, user_c);
    names := array_append(names, 'Setup: profiles were created for A, B and C');
    oks := array_append(oks, cnt = 3);

    names := array_append(names, 'Setup: display_name falls back to the email prefix');
    oks := array_append(oks, exists (
      select 1 from public.profiles where id = user_c and display_name = 'rls-test-c'));

    -- A creates items, a share and folders.
    perform pg_temp.rls_login(user_a);
    insert into public.items (owner_id, workspace, kind, title, content)
      values (user_a, 'personal', 'note', 'A personal', 'secret') returning id into a_personal;
    insert into public.items (owner_id, workspace, kind, title, content)
      values (user_a, 'shared', 'note', 'A shared', 'hello') returning id into a_shared;
    insert into public.items (owner_id, workspace, kind, title, content)
      values (user_a, 'personal', 'note', 'A to B', 'for B') returning id into a_to_b;
    insert into public.item_shares (item_id, shared_with, shared_by)
      values (a_to_b, user_b, user_a);
    insert into public.folders (owner_id, workspace, name)
      values (user_a, 'personal', 'Folder 1') returning id into folder_1;
    insert into public.folders (owner_id, workspace, name)
      values (user_a, 'shared', 'Family') returning id into a_shared_folder;

    -- B creates a personal item.
    perform pg_temp.rls_login(user_b);
    insert into public.items (owner_id, workspace, kind, title, content)
      values (user_b, 'personal', 'note', 'B personal', 'b secret') returning id into b_personal;

    -- -----------------------------------------------------------------------
    -- Visibility
    -- -----------------------------------------------------------------------
    perform pg_temp.rls_login(user_a);
    select count(*) into cnt from public.items where id = b_personal;
    names := array_append(names, 'A cannot see B''s personal item');
    oks := array_append(oks, cnt = 0);

    select count(*) into cnt from public.items where id = a_shared;
    names := array_append(names, 'A sees the shared item');
    oks := array_append(oks, cnt = 1);

    perform pg_temp.rls_login(user_b);
    select count(*) into cnt from public.items where id = a_shared;
    names := array_append(names, 'B sees the shared item');
    oks := array_append(oks, cnt = 1);

    select count(*) into cnt from public.items where id = a_to_b;
    names := array_append(names, 'B sees the item A shared with them');
    oks := array_append(oks, cnt = 1);

    select count(*) into cnt from public.items where id = a_personal;
    names := array_append(names, 'B cannot see A''s personal item');
    oks := array_append(oks, cnt = 0);

    perform pg_temp.rls_login(user_c);
    select count(*) into cnt from public.items where id = a_shared;
    names := array_append(names, 'C sees the shared item');
    oks := array_append(oks, cnt = 1);

    select count(*) into cnt from public.items where id = a_to_b;
    names := array_append(names, 'C cannot see the item A shared with B');
    oks := array_append(oks, cnt = 0);

    -- -----------------------------------------------------------------------
    -- Editing the shared item (shared_editable)
    -- -----------------------------------------------------------------------
    perform pg_temp.rls_login(user_b);
    begin
      update public.items set title = 'edited by B' where id = a_shared;
      get diagnostics cnt = row_count;
      ok := cnt = 0;
    exception when insufficient_privilege or check_violation then
      ok := true;
    end;
    names := array_append(names, 'B cannot edit a shared item when shared_editable = false');
    oks := array_append(oks, ok);

    perform pg_temp.rls_login(user_a);
    update public.items set shared_editable = true where id = a_shared;

    perform pg_temp.rls_login(user_b);
    begin
      update public.items set title = 'edited by B' where id = a_shared;
      get diagnostics cnt = row_count;
      ok := cnt = 1;
    exception when insufficient_privilege or check_violation then
      ok := false;
    end;
    names := array_append(names, 'B can edit a shared item when shared_editable = true');
    oks := array_append(oks, ok);

    begin
      update public.items set shared_editable = false where id = a_shared;
      get diagnostics cnt = row_count;
      ok := cnt = 0;
    exception when insufficient_privilege or check_violation then
      ok := true;
    end;
    names := array_append(names, 'B cannot change shared_editable of A''s item');
    oks := array_append(oks, ok);

    -- -----------------------------------------------------------------------
    -- Editing an item shared with B (can_edit)
    -- -----------------------------------------------------------------------
    begin
      update public.items set title = 'edited by B' where id = a_to_b;
      get diagnostics cnt = row_count;
      ok := cnt = 0;
    exception when insufficient_privilege or check_violation then
      ok := true;
    end;
    names := array_append(names, 'B cannot edit an item shared with them as view-only');
    oks := array_append(oks, ok);

    begin
      update public.item_shares set can_edit = true where item_id = a_to_b and shared_with = user_b;
      get diagnostics cnt = row_count;
      ok := cnt = 0;
    exception when insufficient_privilege or check_violation then
      ok := true;
    end;
    names := array_append(names, 'B cannot give themselves edit access');
    oks := array_append(oks, ok);

    perform pg_temp.rls_login(user_a);
    update public.item_shares set can_edit = true where item_id = a_to_b and shared_with = user_b;
    get diagnostics cnt = row_count;
    names := array_append(names, 'A (owner) can give B edit access');
    oks := array_append(oks, cnt = 1);

    perform pg_temp.rls_login(user_b);
    begin
      update public.items set title = 'edited by B' where id = a_to_b;
      get diagnostics cnt = row_count;
      ok := cnt = 1;
    exception when insufficient_privilege or check_violation then
      ok := false;
    end;
    names := array_append(names, 'B with can_edit = true can change the title');
    oks := array_append(oks, ok);

    begin
      update public.items set owner_id = user_b where id = a_to_b;
      get diagnostics cnt = row_count;
      ok := cnt = 0;
    exception when insufficient_privilege or check_violation then
      ok := true;
    end;
    names := array_append(names, 'B with can_edit = true cannot change owner_id');
    oks := array_append(oks, ok);

    begin
      update public.items set workspace = 'shared' where id = a_to_b;
      get diagnostics cnt = row_count;
      ok := cnt = 0;
    exception when insufficient_privilege or check_violation then
      ok := true;
    end;
    names := array_append(names, 'B with can_edit = true cannot change workspace');
    oks := array_append(oks, ok);

    -- -----------------------------------------------------------------------
    -- Deleting and sharing
    -- -----------------------------------------------------------------------
    begin
      delete from public.items where id in (a_to_b, a_shared, a_personal);
      get diagnostics cnt = row_count;
      ok := cnt = 0;
    exception when insufficient_privilege or check_violation then
      ok := true;
    end;
    names := array_append(names, 'B cannot delete A''s items');
    oks := array_append(oks, ok);

    perform pg_temp.rls_login(user_c);
    begin
      insert into public.item_shares (item_id, shared_with, shared_by) values (a_shared, user_b, user_c);
      get diagnostics cnt = row_count;
      ok := cnt = 0;
    exception when insufficient_privilege or check_violation then
      ok := true;
    end;
    names := array_append(names, 'C cannot share an item they do not own');
    oks := array_append(oks, ok);

    -- -----------------------------------------------------------------------
    -- Profiles
    -- -----------------------------------------------------------------------
    perform pg_temp.rls_login(user_b);
    select count(*) into cnt from public.profiles where id in (user_a, user_b, user_c);
    names := array_append(names, 'B sees all profiles');
    oks := array_append(oks, cnt = 3);

    begin
      update public.profiles set is_admin = true where id = user_b;
      get diagnostics cnt = row_count;
      ok := cnt = 0;
    exception when insufficient_privilege or check_violation then
      ok := true;
    end;
    names := array_append(names, 'A user cannot make themselves an admin');
    oks := array_append(oks, ok);

    begin
      update public.profiles set display_name = 'B renamed' where id = user_b;
      get diagnostics cnt = row_count;
      ok := cnt = 1;
    exception when insufficient_privilege or check_violation then
      ok := false;
    end;
    names := array_append(names, 'B can change their own display_name');
    oks := array_append(oks, ok);

    begin
      update public.profiles set display_name = 'renamed by B' where id = user_a;
      get diagnostics cnt = row_count;
      ok := cnt = 0;
    exception when insufficient_privilege or check_violation then
      ok := true;
    end;
    names := array_append(names, 'B cannot change A''s display_name');
    oks := array_append(oks, ok);

    -- -----------------------------------------------------------------------
    -- Folders
    -- -----------------------------------------------------------------------
    select count(*) into cnt from public.folders where id = folder_1;
    names := array_append(names, 'B cannot see A''s personal folder');
    oks := array_append(oks, cnt = 0);

    select count(*) into cnt from public.folders where id = a_shared_folder;
    names := array_append(names, 'B sees A''s shared folder');
    oks := array_append(oks, cnt = 1);

    begin
      insert into public.folders (owner_id, workspace, name, parent_id)
        values (user_b, 'shared', 'B subfolder', a_shared_folder);
      get diagnostics cnt = row_count;
      ok := cnt = 1;
    exception when insufficient_privilege or check_violation then
      ok := false;
    end;
    names := array_append(names, 'B can create a subfolder inside A''s shared folder');
    oks := array_append(oks, ok);

    begin
      insert into public.folders (owner_id, workspace, name, parent_id)
        values (user_b, 'personal', 'B sneaky', folder_1);
      get diagnostics cnt = row_count;
      ok := cnt = 0;
    exception when insufficient_privilege or check_violation then
      ok := true;
    end;
    names := array_append(names, 'B cannot create a folder inside A''s personal folder');
    oks := array_append(oks, ok);

    perform pg_temp.rls_login(user_a);
    begin
      update public.folders set parent_id = folder_1 where id = folder_1;
      get diagnostics cnt = row_count;
      ok := cnt = 0;
    exception when insufficient_privilege or check_violation then
      ok := true;
    end;
    names := array_append(names, 'A folder cannot be its own parent');
    oks := array_append(oks, ok);

    insert into public.folders (owner_id, workspace, name, parent_id)
      values (user_a, 'personal', 'Folder 2', folder_1) returning id into folder_2;
    begin
      update public.folders set parent_id = folder_2 where id = folder_1;
      get diagnostics cnt = row_count;
      ok := cnt = 0;
    exception when insufficient_privilege or check_violation then
      ok := true;
    end;
    names := array_append(names, 'A folder cannot be moved inside its own subfolder');
    oks := array_append(oks, ok);

    begin
      insert into public.items (owner_id, workspace, kind, title, folder_id)
        values (user_a, 'shared', 'note', 'wrong workspace', folder_1);
      get diagnostics cnt = row_count;
      ok := cnt = 0;
    exception when insufficient_privilege or check_violation then
      ok := true;
    end;
    names := array_append(names, 'An item must be in the same workspace as its folder');
    oks := array_append(oks, ok);

    -- -----------------------------------------------------------------------
    -- B removes the share from their own list
    -- -----------------------------------------------------------------------
    perform pg_temp.rls_login(user_b);
    delete from public.item_shares where item_id = a_to_b and shared_with = user_b;
    get diagnostics cnt = row_count;
    ok := cnt = 1 and not exists (select 1 from public.items where id = a_to_b);
    names := array_append(names, 'B can remove a shared item from their list (and loses access)');
    oks := array_append(oks, ok);

    -- -----------------------------------------------------------------------
    -- anon
    -- -----------------------------------------------------------------------
    -- Each table is checked on its own: "permission denied" or zero rows both pass.
    perform pg_temp.rls_login(null);
    foreach table_name in array array['profiles', 'folders', 'items', 'item_shares'] loop
      begin
        execute format('select count(*) from public.%I', table_name) into cnt;
        ok := cnt = 0;
      exception when insufficient_privilege then
        ok := true;
      end;
      names := array_append(names, format('anon sees nothing in %s', table_name));
      oks := array_append(oks, ok);
    end loop;

    -- Undo everything above.
    raise exception 'rls_check_rollback';
  exception when others then
    if sqlerrm <> 'rls_check_rollback' then
      names := array_append(names, 'Unexpected error, remaining checks skipped: ' || sqlerrm);
      oks := array_append(oks, false);
    end if;
  end;

  return query
    select s.i, case when oks[s.i] then 'PASS' else 'FAIL' end, names[s.i]
    from generate_subscripts(names, 1) as s (i);

  return query
    select coalesce(array_length(names, 1), 0) + 1,
           case when false = any (oks) then 'FAIL' else 'PASS' end,
           format('Summary: %s of %s checks passed',
                  (select count(*) from unnest(oks) as o (v) where o.v),
                  coalesce(array_length(oks, 1), 0));
end;
$$;

grant execute on function pg_temp.rls_login(uuid) to public;

select * from pg_temp.rls_run() order by n;
