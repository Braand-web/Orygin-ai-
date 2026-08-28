-- Run after saas_foundation.sql inside a transaction that is rolled back.
do $test$
declare
  v_user_id uuid;
  v_plan_id bigint;
  v_run_id uuid;
  v_attempt_id uuid;
  v_reservation_id uuid;
  v_workspace_id uuid;
  v_session_id uuid;
  v_before bigint;
  v_after bigint;
begin
  if has_schema_privilege('anon', 'app_private', 'usage')
    or has_schema_privilege('authenticated', 'billing_private', 'usage')
    or has_table_privilege('anon', 'app_private.workspaces', 'select')
    or has_table_privilege('authenticated', 'billing_private.credit_accounts', 'select') then
    raise exception 'private SaaS schemas are exposed to browser roles';
  end if;

  if (select count(*) from billing_private.plan_versions) <> 4 then
    raise exception 'expected exactly four initial plan versions';
  end if;
  if exists (
    select 1 from billing_private.plan_versions
    where cost_budget_micros_per_credit <> 20000 or provider_funding_fee_bps <> 550
  ) then
    raise exception 'unexpected credit cost budget';
  end if;

  perform public.ingest_paddle_event(
    'evt_test', 'transaction.completed', now(), repeat('a', 64), '{"id":"evt_test"}'::jsonb
  );
  perform public.ingest_paddle_event(
    'evt_test', 'transaction.completed', now(), repeat('a', 64), '{"id":"evt_test"}'::jsonb
  );
  if (select count(*) from billing_private.payment_events where provider_event_id = 'evt_test') <> 1 then
    raise exception 'Paddle event idempotence failed';
  end if;
  begin
    perform public.ingest_paddle_event(
      'evt_test', 'transaction.completed', now(), repeat('b', 64), '{"id":"changed"}'::jsonb
    );
    raise exception 'Paddle event payload collision unexpectedly succeeded';
  exception when sqlstate 'P0001' then
    null;
  end;

  select id into v_user_id from auth.users where email_confirmed_at is not null limit 1;
  if v_user_id is null then return; end if;
  select id into v_plan_id from billing_private.plan_versions where code = 'free' and version = 1;

  if not exists (
    select 1 from public.billing_get_policy(v_user_id, v_user_id)
    where plan_code = 'free'
      and cost_budget_micros_per_credit = '20000'
      and max_run_credits = '5'
      and max_concurrent_runs = 1
  ) then
    raise exception 'active billing policy lookup failed';
  end if;

  v_workspace_id := gen_random_uuid();
  insert into app_private.workspaces (
    id, tenant_id, created_by, name, source, storage_quota_bytes
  ) values (
    v_workspace_id, v_user_id, v_user_id, 'Authorization test', 'empty', 1048576
  );
  v_session_id := gen_random_uuid();
  insert into app_private.sessions (
    id, tenant_id, workspace_id, created_by
  ) values (
    v_session_id, v_user_id, v_workspace_id, v_user_id
  );
  if not public.authorize_tenant_resource(
    v_user_id, v_user_id, 'session', v_session_id, 'read'
  ) then
    raise exception 'tenant owner could not authorize its own session';
  end if;
  if public.authorize_tenant_resource(
    gen_random_uuid(), v_user_id, 'session', v_session_id, 'read'
  ) or public.authorize_tenant_resource(
    v_user_id, v_user_id, 'session', v_session_id, 'invalid-action'
  ) then
    raise exception 'tenant authorization accepted an invalid scope';
  end if;

  select available_credits into v_before
  from billing_private.credit_accounts where tenant_id = v_user_id;

  perform billing_private.grant_credits(
    v_user_id, 20, 'bonus', now() + interval '1 day',
    'test:grant', v_plan_id, null, v_user_id
  );
  perform billing_private.grant_credits(
    v_user_id, 20, 'bonus', now() + interval '1 day',
    'test:grant', v_plan_id, null, v_user_id
  );
  select available_credits into v_after
  from billing_private.credit_accounts where tenant_id = v_user_id;
  if v_after <> v_before + 20 then raise exception 'grant idempotence failed'; end if;

  v_run_id := gen_random_uuid();
  perform public.billing_reserve_run(
    v_user_id, v_user_id, v_run_id, null, null, 'orygin', 'test/model',
    5, 5, 20000, now() + interval '10 minutes', 'test:run'
  );
  select id into v_reservation_id from billing_private.credit_reservations
  where tenant_id = v_user_id and run_id = v_run_id;
  if v_reservation_id is null then raise exception 'reservation failed'; end if;

  perform billing_private.extend_reservation(v_user_id, v_run_id, 2, 'test:extend');
  perform billing_private.extend_reservation(v_user_id, v_run_id, 2, 'test:extend');
  if (select reserved_credits from billing_private.credit_reservations where id = v_reservation_id) <> 7 then
    raise exception 'reservation extension idempotence failed';
  end if;

  v_attempt_id := gen_random_uuid();
  perform public.billing_record_provider_usage(
    v_user_id, v_run_id, v_run_id, v_attempt_id, 'openrouter', 'test/model',
    'generation-test', 'agent', 'orygin', 10, 0, 10, 0, 105000, 100000
  );
  perform public.billing_record_provider_usage(
    v_user_id, v_run_id, v_run_id, v_attempt_id, 'openrouter', 'test/model',
    'generation-test', 'agent', 'orygin', 10, 0, 10, 0, 105000, 100000
  );
  perform public.billing_settle_run(v_run_id, 'test:settle');
  if (select charged_credits from billing_private.billable_runs where id = v_run_id) <> 6 then
    raise exception 'settlement debit failed';
  end if;
  if (select reserved_credits from billing_private.credit_accounts where tenant_id = v_user_id) <> 0 then
    raise exception 'settlement leaked reserved credits';
  end if;
  if (select available_credits from billing_private.credit_accounts where tenant_id = v_user_id) <> v_before + 14 then
    raise exception 'settlement balance is incorrect';
  end if;
  if (select count(*) from billing_private.usage_events where attempt_id = v_attempt_id) <> 1 then
    raise exception 'provider usage idempotence failed';
  end if;

  begin
    update billing_private.credit_ledger_entries
    set reason = 'mutated'
    where tenant_id = v_user_id and idempotency_key = 'test:settle';
    raise exception 'ledger update unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;
end;
$test$;
