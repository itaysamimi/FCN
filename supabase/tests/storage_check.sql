-- storage_check.sql
-- Smoke test for 0002_storage.sql. Paste into the Supabase SQL Editor and run.
--
-- Creates two fake users (A = admin, B = regular), impersonates them with
-- `set local role` + request.jwt.claims, and prints one PASS / FAIL row per check.
--
-- Nothing is left behind: every change happens inside a block that is always
-- rolled back at the end (same approach as rls_check.sql, because the SQL
-- Editor only shows the result of the last statement).

-- Impersonate a user (p_user = null means anon).
create or replace function pg_temp.storage_login(p_user uuid)
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

create or replace function pg_temp.storage_run()
returns table (n int, result text, test text)
language plpgsql
as $$
declare
  user_a constant uuid := 'a0000000-0000-4000-8000-0000000000a1';
  user_b constant uuid := 'b0000000-0000-4000-8000-0000000000b1';
  names text[] := '{}';
  oks boolean[] := '{}';
  this_month date := date_trunc('month', now() at time zone 'utc')::date;
  fn text;
  used_before bigint;
  used_after bigint;
  cnt bigint;
  ok boolean;
  err text;
begin
  begin
    -- -----------------------------------------------------------------------
    -- Setup (as the SQL Editor user)
    -- -----------------------------------------------------------------------
    insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
    values
      ('00000000-0000-0000-0000-000000000000', user_a, 'authenticated', 'authenticated',
       'storage-test-a@example.invalid', '{"display_name":"Admin A"}', '{}', now(), now()),
      ('00000000-0000-0000-0000-000000000000', user_b, 'authenticated', 'authenticated',
       'storage-test-b@example.invalid', '{"display_name":"User B"}', '{}', now(), now());
    update public.profiles set is_admin = true where id = user_a;

    -- Known starting point for this test (rolled back at the end).
    update public.app_settings
      set storage_limit_bytes = 10737418240, class_a_limit = 900000, class_b_limit = 9000000;
    delete from public.r2_usage where month = this_month;

    names := array_append(names, 'Setup: app_settings has exactly one row');
    oks := array_append(oks, (select count(*) from public.app_settings) = 1);

    -- -----------------------------------------------------------------------
    -- app_settings
    -- -----------------------------------------------------------------------
    perform pg_temp.storage_login(user_b);
    select count(*) into cnt from public.app_settings;
    names := array_append(names, 'B (regular user) can read app_settings');
    oks := array_append(oks, cnt = 1);

    begin
      update public.app_settings set storage_limit_bytes = 1;
      get diagnostics cnt = row_count;
      ok := cnt = 0;
    exception when insufficient_privilege then
      ok := true;
    end;
    names := array_append(names, 'B cannot change the storage cap');
    oks := array_append(oks, ok);

    perform pg_temp.storage_login(user_a);
    begin
      update public.app_settings set storage_limit_bytes = 21474836480;
      get diagnostics cnt = row_count;
      ok := cnt = 1;
    exception when insufficient_privilege then
      ok := false;
    end;
    names := array_append(names, 'A (admin) can change the storage cap');
    oks := array_append(oks, ok);

    begin
      insert into public.app_settings (id) values (2);
      ok := false;
    exception when insufficient_privilege or check_violation or unique_violation then
      ok := true;
    end;
    names := array_append(names, 'Nobody can insert a second app_settings row');
    oks := array_append(oks, ok);

    -- -----------------------------------------------------------------------
    -- reserve_upload / storage_used_bytes / pending_uploads
    -- -----------------------------------------------------------------------
    reset role;
    update public.app_settings set storage_limit_bytes = 1000;

    perform pg_temp.storage_login(user_b);
    begin
      perform public.reserve_upload(user_b::text || '/ok-1', 600);
      ok := true;
    exception when others then
      ok := false;
    end;
    names := array_append(names, 'B can reserve space under the cap');
    oks := array_append(oks, ok);

    err := null;
    begin
      perform public.reserve_upload(user_b::text || '/too-big', 500);
    exception when others then
      err := sqlerrm;
    end;
    names := array_append(names, 'reserve_upload fails with storage_full above the cap');
    oks := array_append(oks, err = 'storage_full');

    err := null;
    begin
      perform public.reserve_upload(user_a::text || '/not-mine', 10);
    exception when others then
      err := sqlerrm;
    end;
    names := array_append(names, 'reserve_upload rejects a key that does not start with the caller''s id');
    oks := array_append(oks, err = 'invalid_storage_key');

    begin
      select count(*) into cnt from public.pending_uploads;
      ok := cnt = 0;
    exception when insufficient_privilege then
      ok := true;
    end;
    names := array_append(names, 'B cannot read pending_uploads directly');
    oks := array_append(oks, ok);

    begin
      insert into public.pending_uploads (storage_key, owner_id, size_bytes)
        values (user_b::text || '/sneaky', user_b, 1);
      ok := false;
    exception when insufficient_privilege then
      ok := true;
    end;
    names := array_append(names, 'B cannot write pending_uploads directly');
    oks := array_append(oks, ok);

    names := array_append(names, 'pending_upload_size returns B''s own reservation');
    oks := array_append(oks, public.pending_upload_size(user_b::text || '/ok-1') = 600);

    perform pg_temp.storage_login(user_a);
    names := array_append(names, 'pending_upload_size hides other users'' reservations');
    oks := array_append(oks, public.pending_upload_size(user_b::text || '/ok-1') is null);

    perform public.release_upload(user_b::text || '/ok-1');
    perform pg_temp.storage_login(user_b);
    names := array_append(names, 'release_upload cannot drop another user''s reservation');
    oks := array_append(oks, public.pending_upload_size(user_b::text || '/ok-1') = 600);

    perform public.release_upload(user_b::text || '/ok-1');
    names := array_append(names, 'release_upload drops the caller''s own reservation');
    oks := array_append(oks, public.pending_upload_size(user_b::text || '/ok-1') is null);

    -- Expired reservations are not counted.
    used_before := public.storage_used_bytes();
    reset role;
    insert into public.pending_uploads (storage_key, owner_id, size_bytes, expires_at)
      values (user_b::text || '/expired', user_b, 900, now() - interval '1 minute');
    perform pg_temp.storage_login(user_b);
    used_after := public.storage_used_bytes();
    names := array_append(names, 'An expired reservation is not counted');
    oks := array_append(oks, used_after = used_before);

    begin
      perform public.reserve_upload(user_b::text || '/after-expired', 900);
      ok := true;
    exception when others then
      ok := false;
    end;
    names := array_append(names, 'An expired reservation does not block new uploads');
    oks := array_append(oks, ok);

    -- Stored items are counted.
    perform public.release_upload(user_b::text || '/after-expired');
    used_before := public.storage_used_bytes();
    insert into public.items (owner_id, workspace, kind, title, storage_key, mime_type, size_bytes)
      values (user_b, 'personal', 'file', 'test.bin', user_b::text || '/item-1', 'application/octet-stream', 250);
    names := array_append(names, 'Stored items are counted in storage_used_bytes');
    oks := array_append(oks, public.storage_used_bytes() = used_before + 250);

    -- -----------------------------------------------------------------------
    -- consume_r2_ops / r2_usage
    -- -----------------------------------------------------------------------
    reset role;
    update public.app_settings set class_a_limit = 5, class_b_limit = 5;

    perform pg_temp.storage_login(user_b);
    begin
      perform public.consume_r2_ops('a', 3);
      ok := true;
    exception when others then
      ok := false;
    end;
    names := array_append(names, 'consume_r2_ops counts operations under the limit');
    oks := array_append(oks, ok);

    err := null;
    begin
      perform public.consume_r2_ops('a', 3);
    exception when others then
      err := sqlerrm;
    end;
    names := array_append(names, 'consume_r2_ops raises ops_limit above the limit');
    oks := array_append(oks, err = 'ops_limit');

    reset role;
    names := array_append(names, 'A rejected consume_r2_ops does not change the counter');
    oks := array_append(oks, (select class_a from public.r2_usage where month = this_month) = 3);

    perform pg_temp.storage_login(user_b);
    err := null;
    begin
      perform public.consume_r2_ops('c', 1);
    exception when others then
      err := sqlerrm;
    end;
    names := array_append(names, 'consume_r2_ops rejects an unknown class');
    oks := array_append(oks, err = 'invalid_class');

    err := null;
    begin
      perform public.consume_r2_ops('b', 1001);
    exception when others then
      err := sqlerrm;
    end;
    names := array_append(names, 'consume_r2_ops rejects a count above 1000');
    oks := array_append(oks, err = 'invalid_count');

    begin
      select count(*) into cnt from public.r2_usage;
      ok := cnt = 0;
    exception when insufficient_privilege then
      ok := true;
    end;
    names := array_append(names, 'B (regular user) cannot see r2_usage');
    oks := array_append(oks, ok);

    begin
      update public.r2_usage set class_a = 0;
      get diagnostics cnt = row_count;
      ok := cnt = 0;
    exception when insufficient_privilege then
      ok := true;
    end;
    names := array_append(names, 'B cannot reset r2_usage');
    oks := array_append(oks, ok);

    perform pg_temp.storage_login(user_a);
    select count(*) into cnt from public.r2_usage where month = this_month;
    names := array_append(names, 'A (admin) can see r2_usage');
    oks := array_append(oks, cnt = 1);

    -- -----------------------------------------------------------------------
    -- anon
    -- -----------------------------------------------------------------------
    perform pg_temp.storage_login(null);
    foreach fn in array array[
      'select public.storage_used_bytes()',
      'select public.reserve_upload(''x/y'', 1)',
      'select public.release_upload(''x/y'')',
      'select public.pending_upload_size(''x/y'')',
      'select public.consume_r2_ops(''b'', 1)'
    ] loop
      -- Must be refused by the EXECUTE privilege itself, not only by the
      -- function's own auth.uid() check.
      begin
        execute fn;
        ok := false;
      exception when insufficient_privilege then
        ok := sqlerrm like 'permission denied for function%';
      end;
      names := array_append(names, format('anon cannot run: %s', fn));
      oks := array_append(oks, ok);
    end loop;

    begin
      execute 'select count(*) from public.app_settings' into cnt;
      ok := cnt = 0;
    exception when insufficient_privilege then
      ok := true;
    end;
    names := array_append(names, 'anon cannot read app_settings');
    oks := array_append(oks, ok);

    -- Undo everything above.
    raise exception 'storage_check_rollback';
  exception when others then
    if sqlerrm <> 'storage_check_rollback' then
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

grant execute on function pg_temp.storage_login(uuid) to public;

select * from pg_temp.storage_run() order by n;
