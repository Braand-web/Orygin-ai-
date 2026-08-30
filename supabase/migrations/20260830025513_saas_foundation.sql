-- Orygin SaaS foundation: private multi-tenant product data and credit ledger.
-- This schema is server-only. Browser clients use Supabase Auth, never these tables.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app_private;
create schema if not exists billing_private;
create schema if not exists audit_private;

revoke all on schema app_private from public, anon, authenticated;
revoke all on schema billing_private from public, anon, authenticated;
revoke all on schema audit_private from public, anon, authenticated;

create type app_private.tenant_type as enum ('personal', 'organization');
create type app_private.resource_status as enum ('active', 'suspended', 'deleting', 'deleted');
create type app_private.membership_role as enum ('owner', 'admin', 'support');
create type app_private.membership_status as enum ('active', 'invited', 'suspended');
create type app_private.workspace_source as enum ('empty', 'github');
create type app_private.sandbox_status as enum ('pending', 'ready', 'sleeping', 'error', 'deleted');
create type billing_private.grant_source as enum ('free', 'subscription', 'topup', 'bonus', 'adjustment');
create type billing_private.subscription_status as enum ('trialing', 'active', 'past_due', 'paused', 'canceled');
create type billing_private.reservation_status as enum ('active', 'settled', 'released', 'expired', 'pending_reconciliation');
create type billing_private.run_status as enum ('estimated', 'reserved', 'running', 'pending_reconciliation', 'settled', 'refunded', 'failed', 'canceled');
create type billing_private.billing_mode as enum ('orygin', 'byok');
create type billing_private.payment_event_status as enum ('pending', 'processing', 'processed', 'failed');

create table app_private.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  locale text not null default 'fr',
  timezone text not null default 'Europe/Paris',
  status app_private.resource_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table app_private.tenants (
  id uuid primary key default gen_random_uuid(),
  type app_private.tenant_type not null,
  status app_private.resource_status not null default 'active',
  owner_user_id uuid not null references app_private.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deletion_scheduled_at timestamptz,
  constraint personal_tenant_uses_owner_id check (type <> 'personal' or id = owner_user_id)
);

create table app_private.tenant_members (
  tenant_id uuid not null references app_private.tenants(id) on delete cascade,
  user_id uuid not null references app_private.profiles(user_id) on delete cascade,
  role app_private.membership_role not null,
  status app_private.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table app_private.user_preferences (
  user_id uuid primary key references app_private.profiles(user_id) on delete cascade,
  preferred_model_id text,
  auto_router_enabled boolean not null default true,
  run_spend_limit_credits integer,
  ui_preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint positive_run_spend_limit check (run_spend_limit_credits is null or run_spend_limit_credits > 0)
);

create table app_private.workspaces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app_private.tenants(id),
  created_by uuid not null references app_private.profiles(user_id),
  name text not null,
  source app_private.workspace_source not null,
  repository_owner text,
  repository_name text,
  branch_name text,
  commit_sha text,
  sandbox_status app_private.sandbox_status not null default 'pending',
  sandbox_handle text,
  storage_quota_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  constraint workspace_repository_shape check (
    (source = 'empty' and repository_owner is null and repository_name is null)
    or (source = 'github' and repository_owner is not null and repository_name is not null)
  ),
  constraint workspace_quota_nonnegative check (storage_quota_bytes >= 0)
);

create index workspaces_tenant_updated_idx on app_private.workspaces (tenant_id, updated_at desc)
  where deleted_at is null;

create table app_private.sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  workspace_id uuid not null,
  created_by uuid not null references app_private.profiles(user_id),
  parent_session_id uuid,
  title text,
  status app_private.resource_status not null default 'active',
  model_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, workspace_id) references app_private.workspaces(tenant_id, id),
  foreign key (tenant_id, parent_session_id) references app_private.sessions(tenant_id, id)
);

create index sessions_tenant_workspace_updated_idx
  on app_private.sessions (tenant_id, workspace_id, updated_at desc)
  where deleted_at is null;

create table app_private.session_events (
  tenant_id uuid not null,
  session_id uuid not null,
  seq bigint not null,
  envelope jsonb not null,
  size_bytes integer not null,
  created_at timestamptz not null default now(),
  primary key (session_id, seq),
  foreign key (tenant_id, session_id) references app_private.sessions(tenant_id, id),
  constraint session_event_size_positive check (size_bytes > 0)
);

create index session_events_tenant_session_idx
  on app_private.session_events (tenant_id, session_id, seq);

create table app_private.attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  session_id uuid not null,
  content_hash text not null,
  size_bytes bigint not null,
  media_type text not null,
  r2_key text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (r2_key),
  foreign key (tenant_id, session_id) references app_private.sessions(tenant_id, id),
  constraint attachment_size_positive check (size_bytes > 0),
  constraint tenant_scoped_r2_key check (r2_key like tenant_id::text || '/%')
);

create table app_private.workspace_backups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  workspace_id uuid not null,
  backup_handle text not null,
  image_version text,
  commit_sha text,
  status text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (tenant_id, id),
  unique (backup_handle),
  foreign key (tenant_id, workspace_id) references app_private.workspaces(tenant_id, id),
  constraint backup_expiry_after_creation check (expires_at > created_at)
);

create table app_private.provider_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app_private.tenants(id),
  created_by uuid not null references app_private.profiles(user_id),
  provider text not null check (provider = 'openrouter'),
  vault_secret_id uuid not null,
  fingerprint text not null,
  last_four text not null,
  status app_private.resource_status not null default 'active',
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  deleted_at timestamptz,
  unique (tenant_id, provider),
  constraint credential_last_four_shape check (length(last_four) = 4)
);

create table app_private.github_installations (
  id bigint primary key,
  tenant_id uuid not null references app_private.tenants(id),
  installed_by uuid not null references app_private.profiles(user_id),
  account_login text not null,
  permissions jsonb not null default '{}'::jsonb,
  status app_private.resource_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table billing_private.plan_versions (
  id bigint generated always as identity primary key,
  code text not null check (code in ('free', 'pro', 'power', 'ultra')),
  version integer not null,
  display_name text not null,
  price_cents integer not null,
  currency text not null check (currency = 'USD'),
  included_credits integer not null,
  cost_budget_micros_per_credit integer not null,
  provider_funding_fee_bps integer not null default 550,
  max_run_credits integer not null,
  max_concurrent_runs integer not null,
  max_active_workspaces integer not null,
  entitlements jsonb not null,
  valid_from timestamptz not null,
  valid_until timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (code, version),
  constraint plan_amounts_nonnegative check (
    price_cents >= 0 and included_credits >= 0 and cost_budget_micros_per_credit > 0
    and provider_funding_fee_bps between 0 and 10000
    and max_run_credits > 0 and max_concurrent_runs > 0 and max_active_workspaces > 0
  ),
  constraint plan_validity check (valid_until is null or valid_until > valid_from)
);

insert into billing_private.plan_versions (
  code, version, display_name, price_cents, currency, included_credits,
  cost_budget_micros_per_credit, provider_funding_fee_bps, max_run_credits, max_concurrent_runs,
  max_active_workspaces, entitlements, valid_from, published_at
) values
  ('free', 1, 'Free', 0, 'USD', 15, 20000, 550, 5, 1, 1,
   '{"autoRouter":"economy","manualPremiumModels":false,"backgroundAgents":0,"subagents":false,"byokOpenRouter":false}'::jsonb,
   '2026-08-27T00:00:00Z', now()),
  ('pro', 1, 'Pro', 2000, 'USD', 200, 20000, 550, 50, 2, 5,
   '{"autoRouter":"standard","manualPremiumModels":true,"backgroundAgents":1,"subagents":true,"byokOpenRouter":false}'::jsonb,
   '2026-08-27T00:00:00Z', now()),
  ('power', 1, 'Power', 10000, 'USD', 1100, 20000, 550, 200, 5, 25,
   '{"autoRouter":"frontier","manualPremiumModels":true,"backgroundAgents":true,"subagents":true,"priority":"high","byokOpenRouter":true}'::jsonb,
   '2026-08-27T00:00:00Z', now()),
  ('ultra', 1, 'Ultra', 20000, 'USD', 2400, 20000, 550, 500, 10, 100,
   '{"autoRouter":"frontier","manualPremiumModels":true,"backgroundAgents":true,"subagents":true,"priority":"highest","extendedContext":true,"byokOpenRouter":true}'::jsonb,
   '2026-08-27T00:00:00Z', now());

create table billing_private.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references app_private.tenants(id),
  plan_version_id bigint not null references billing_private.plan_versions(id),
  paddle_customer_id text unique,
  paddle_subscription_id text unique,
  status billing_private.subscription_status not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table billing_private.paddle_catalog_items (
  paddle_price_id text primary key,
  paddle_product_id text not null,
  kind text not null check (kind in ('subscription', 'topup')),
  plan_version_id bigint references billing_private.plan_versions(id),
  topup_credits integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint paddle_catalog_target check (
    (kind = 'subscription' and plan_version_id is not null and topup_credits is null)
    or (kind = 'topup' and plan_version_id is null and topup_credits > 0)
  )
);

create table billing_private.credit_accounts (
  tenant_id uuid primary key references app_private.tenants(id),
  available_credits bigint not null default 0,
  reserved_credits bigint not null default 0,
  debt_credits bigint not null default 0,
  version bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint credit_account_nonnegative check (
    available_credits >= 0 and reserved_credits >= 0 and debt_credits >= 0
  )
);

create table billing_private.credit_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app_private.tenants(id),
  source billing_private.grant_source not null,
  plan_version_id bigint references billing_private.plan_versions(id),
  initial_credits bigint not null,
  remaining_credits bigint not null,
  expires_at timestamptz,
  external_reference text,
  idempotency_key text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, id),
  constraint grant_amounts_valid check (
    initial_credits > 0 and remaining_credits >= 0 and remaining_credits <= initial_credits
  )
);

create index credit_grants_spend_order_idx
  on billing_private.credit_grants (tenant_id, expires_at nulls last, created_at, id)
  where remaining_credits > 0;

create table billing_private.credit_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app_private.tenants(id),
  grant_id uuid,
  run_id uuid,
  amount_credits bigint not null check (amount_credits <> 0),
  reason text not null,
  idempotency_key text not null,
  reverses_entry_id uuid references billing_private.credit_ledger_entries(id),
  actor_user_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, grant_id) references billing_private.credit_grants(tenant_id, id)
);

create index credit_ledger_tenant_created_idx
  on billing_private.credit_ledger_entries (tenant_id, created_at, id);

create table billing_private.billable_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app_private.tenants(id),
  user_id uuid not null references app_private.profiles(user_id),
  workspace_id uuid,
  session_id uuid,
  root_run_id uuid,
  parent_run_id uuid,
  status billing_private.run_status not null default 'estimated',
  billing_mode billing_private.billing_mode not null,
  plan_version_id bigint not null references billing_private.plan_versions(id),
  model_id text,
  estimated_credits integer not null default 0,
  reserved_credits integer not null default 0,
  charged_credits integer not null default 0,
  total_variable_cost_micros bigint not null default 0,
  cost_budget_micros_per_credit integer not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  settled_at timestamptz,
  unique (tenant_id, idempotency_key),
  unique (tenant_id, id),
  foreign key (tenant_id, workspace_id) references app_private.workspaces(tenant_id, id),
  foreign key (tenant_id, session_id) references app_private.sessions(tenant_id, id),
  foreign key (tenant_id, parent_run_id) references billing_private.billable_runs(tenant_id, id),
  constraint run_amounts_nonnegative check (
    estimated_credits >= 0 and reserved_credits >= 0 and charged_credits >= 0
    and total_variable_cost_micros >= 0 and cost_budget_micros_per_credit > 0
  )
);

create index billable_runs_tenant_created_idx
  on billing_private.billable_runs (tenant_id, created_at desc);

create table billing_private.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  run_id uuid not null,
  reserved_credits bigint not null,
  consumed_credits bigint not null default 0,
  released_credits bigint not null default 0,
  status billing_private.reservation_status not null default 'active',
  idempotency_key text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, run_id),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, id),
  foreign key (tenant_id, run_id) references billing_private.billable_runs(tenant_id, id),
  constraint reservation_amounts_valid check (
    reserved_credits > 0 and consumed_credits >= 0 and released_credits >= 0
    and consumed_credits + released_credits <= reserved_credits
  ),
  constraint reservation_expiry_future check (expires_at > created_at)
);

create table billing_private.credit_reservation_allocations (
  tenant_id uuid not null,
  reservation_id uuid not null,
  grant_id uuid not null,
  allocated_credits bigint not null check (allocated_credits > 0),
  consumed_credits bigint not null default 0,
  primary key (reservation_id, grant_id),
  foreign key (tenant_id, reservation_id) references billing_private.credit_reservations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, grant_id) references billing_private.credit_grants(tenant_id, id),
  constraint allocation_consumption_valid check (
    consumed_credits >= 0 and consumed_credits <= allocated_credits
  )
);

create table billing_private.credit_reservation_extensions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app_private.tenants(id) on delete cascade,
  reservation_id uuid not null,
  additional_credits bigint not null check (additional_credits > 0),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, reservation_id)
    references billing_private.credit_reservations(tenant_id, id) on delete cascade
);

create table billing_private.usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  run_id uuid not null,
  root_run_id uuid not null,
  attempt_id uuid not null,
  provider text not null check (provider = 'openrouter'),
  model_id text not null,
  provider_request_id text,
  purpose text not null check (purpose in ('agent', 'compaction', 'session-title', 'subagent')),
  billing_mode billing_private.billing_mode not null,
  input_tokens bigint not null default 0,
  cached_input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  reasoning_tokens bigint not null default 0,
  openrouter_debit_micros bigint,
  upstream_inference_cost_micros bigint,
  sandbox_cost_micros bigint not null default 0,
  paid_tool_cost_micros bigint not null default 0,
  status text not null default 'recorded',
  recorded_at timestamptz not null default now(),
  unique (tenant_id, attempt_id),
  foreign key (tenant_id, run_id) references billing_private.billable_runs(tenant_id, id),
  constraint usage_values_nonnegative check (
    input_tokens >= 0 and cached_input_tokens >= 0 and output_tokens >= 0
    and reasoning_tokens >= 0 and coalesce(openrouter_debit_micros, 0) >= 0
    and coalesce(upstream_inference_cost_micros, 0) >= 0
    and sandbox_cost_micros >= 0 and paid_tool_cost_micros >= 0
  )
);

create table billing_private.infrastructure_usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app_private.tenants(id),
  run_id uuid not null,
  root_run_id uuid not null,
  attempt_id uuid not null,
  kind text not null check (kind in ('sandbox', 'paid-tool')),
  cost_micros bigint not null check (cost_micros >= 0),
  idempotency_key text not null,
  recorded_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, run_id) references billing_private.billable_runs(tenant_id, id),
  foreign key (tenant_id, root_run_id) references billing_private.billable_runs(tenant_id, id)
);

create index infrastructure_usage_root_run_idx
  on billing_private.infrastructure_usage_events (tenant_id, root_run_id, recorded_at);

create unique index usage_events_provider_request_idx
  on billing_private.usage_events (provider, provider_request_id)
  where provider_request_id is not null;

create table billing_private.provider_generations (
  provider text not null,
  provider_request_id text not null,
  tenant_id uuid not null references app_private.tenants(id),
  usage_event_id uuid references billing_private.usage_events(id),
  reconciliation_status text not null default 'pending',
  response_hash text,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (provider, provider_request_id)
);

create table billing_private.payment_events (
  provider_event_id text primary key,
  event_type text not null,
  occurred_at timestamptz not null,
  status billing_private.payment_event_status not null default 'pending',
  payload_hash text not null,
  payload jsonb,
  processing_attempts integer not null default 0,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table audit_private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table audit_private.audit_events (
  id bigint generated always as identity primary key,
  tenant_id uuid,
  actor_user_id uuid,
  request_id text not null,
  action text not null,
  resource_type text,
  resource_id text,
  justification text,
  ip_hash text,
  user_agent_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_tenant_created_idx
  on audit_private.audit_events (tenant_id, created_at desc);

create function audit_private.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'append-only relation % cannot be modified', tg_table_name
    using errcode = '55000';
end;
$$;

create trigger session_events_append_only
before update or delete on app_private.session_events
for each row execute function audit_private.reject_mutation();

create trigger credit_ledger_append_only
before update or delete on billing_private.credit_ledger_entries
for each row execute function audit_private.reject_mutation();

create trigger audit_events_append_only
before update or delete on audit_private.audit_events
for each row execute function audit_private.reject_mutation();

create function billing_private.reject_published_plan_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.published_at is not null then
    raise exception 'published plan versions are immutable' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger published_plan_versions_immutable
before update or delete on billing_private.plan_versions
for each row execute function billing_private.reject_published_plan_mutation();

create function billing_private.grant_credits(
  p_tenant_id uuid,
  p_amount bigint,
  p_source billing_private.grant_source,
  p_expires_at timestamptz,
  p_idempotency_key text,
  p_plan_version_id bigint default null,
  p_external_reference text default null,
  p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant_id uuid;
begin
  if p_amount <= 0 then raise exception 'credit grant must be positive' using errcode = '22023'; end if;

  select id into v_grant_id
  from billing_private.credit_grants
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if v_grant_id is not null then return v_grant_id; end if;

  insert into billing_private.credit_accounts (tenant_id)
  values (p_tenant_id)
  on conflict (tenant_id) do nothing;

  perform 1 from billing_private.credit_accounts where tenant_id = p_tenant_id for update;

  insert into billing_private.credit_grants (
    tenant_id, source, plan_version_id, initial_credits, remaining_credits,
    expires_at, external_reference, idempotency_key, created_by
  ) values (
    p_tenant_id, p_source, p_plan_version_id, p_amount, p_amount,
    p_expires_at, p_external_reference, p_idempotency_key, p_created_by
  ) returning id into v_grant_id;

  insert into billing_private.credit_ledger_entries (
    tenant_id, grant_id, amount_credits, reason, idempotency_key, actor_user_id
  ) values (
    p_tenant_id, v_grant_id, p_amount, p_source::text, p_idempotency_key || ':ledger', p_created_by
  );

  update billing_private.credit_accounts
  set available_credits = available_credits + p_amount,
      version = version + 1,
      updated_at = now()
  where tenant_id = p_tenant_id;

  return v_grant_id;
exception when unique_violation then
  select id into v_grant_id
  from billing_private.credit_grants
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  return v_grant_id;
end;
$$;

create function billing_private.reserve_credits(
  p_tenant_id uuid,
  p_run_id uuid,
  p_amount bigint,
  p_expires_at timestamptz,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation_id uuid;
  v_available bigint;
  v_remaining bigint := p_amount;
  v_grant record;
  v_take bigint;
begin
  if p_amount <= 0 or p_expires_at <= now() then
    raise exception 'invalid credit reservation' using errcode = '22023';
  end if;

  select id into v_reservation_id
  from billing_private.credit_reservations
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if v_reservation_id is not null then return v_reservation_id; end if;

  select available_credits into v_available
  from billing_private.credit_accounts
  where tenant_id = p_tenant_id
  for update;
  if v_available is null or v_available < p_amount then
    raise exception 'insufficient credits' using errcode = 'P0001';
  end if;

  insert into billing_private.credit_reservations (
    tenant_id, run_id, reserved_credits, idempotency_key, expires_at
  ) values (p_tenant_id, p_run_id, p_amount, p_idempotency_key, p_expires_at)
  returning id into v_reservation_id;

  for v_grant in
    select g.id, g.remaining_credits - coalesce((
      select sum(a.allocated_credits - a.consumed_credits)
      from billing_private.credit_reservation_allocations a
      join billing_private.credit_reservations r on r.id = a.reservation_id
      where a.grant_id = g.id and r.status = 'active'
    ), 0) as spendable
    from billing_private.credit_grants g
    where g.tenant_id = p_tenant_id
      and g.remaining_credits > 0
      and (g.expires_at is null or g.expires_at > now())
      and g.remaining_credits - coalesce((
        select sum(a.allocated_credits - a.consumed_credits)
        from billing_private.credit_reservation_allocations a
        join billing_private.credit_reservations r on r.id = a.reservation_id
        where a.grant_id = g.id and r.status = 'active'
      ), 0) > 0
    order by g.expires_at nulls last, g.created_at, g.id
    for update of g
  loop
    v_take := least(v_remaining, v_grant.spendable);
    insert into billing_private.credit_reservation_allocations (
      tenant_id, reservation_id, grant_id, allocated_credits
    ) values (p_tenant_id, v_reservation_id, v_grant.id, v_take);
    v_remaining := v_remaining - v_take;
    exit when v_remaining = 0;
  end loop;

  if v_remaining <> 0 then raise exception 'credit allocation invariant failed' using errcode = 'XX000'; end if;

  update billing_private.credit_accounts
  set available_credits = available_credits - p_amount,
      reserved_credits = reserved_credits + p_amount,
      version = version + 1,
      updated_at = now()
  where tenant_id = p_tenant_id;

  update billing_private.billable_runs
  set status = 'reserved', reserved_credits = p_amount
  where tenant_id = p_tenant_id and id = p_run_id;

  return v_reservation_id;
end;
$$;

create function billing_private.extend_reservation(
  p_tenant_id uuid,
  p_run_id uuid,
  p_additional_credits bigint,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_extension_id uuid;
  v_reservation billing_private.credit_reservations%rowtype;
  v_available bigint;
  v_remaining bigint := p_additional_credits;
  v_grant record;
  v_take bigint;
begin
  if p_additional_credits <= 0 then
    raise exception 'reservation extension must be positive' using errcode = '22023';
  end if;

  select id into v_extension_id
  from billing_private.credit_reservation_extensions
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if v_extension_id is not null then return v_extension_id; end if;

  select available_credits into v_available
  from billing_private.credit_accounts
  where tenant_id = p_tenant_id
  for update;

  -- Re-check after acquiring the account lock so concurrent retries carrying
  -- the same idempotency key cannot extend twice.
  select id into v_extension_id
  from billing_private.credit_reservation_extensions
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if v_extension_id is not null then return v_extension_id; end if;

  if v_available is null or v_available < p_additional_credits then
    raise exception 'insufficient credits' using errcode = 'P0001';
  end if;

  select * into v_reservation
  from billing_private.credit_reservations
  where tenant_id = p_tenant_id and run_id = p_run_id
  for update;
  if v_reservation.id is null or v_reservation.status <> 'active' then
    raise exception 'active reservation not found' using errcode = 'P0001';
  end if;

  insert into billing_private.credit_reservation_extensions (
    tenant_id, reservation_id, additional_credits, idempotency_key
  ) values (
    p_tenant_id, v_reservation.id, p_additional_credits, p_idempotency_key
  ) returning id into v_extension_id;

  for v_grant in
    select g.id, g.remaining_credits - coalesce((
      select sum(a.allocated_credits - a.consumed_credits)
      from billing_private.credit_reservation_allocations a
      join billing_private.credit_reservations r on r.id = a.reservation_id
      where a.grant_id = g.id and r.status = 'active'
    ), 0) as spendable
    from billing_private.credit_grants g
    where g.tenant_id = p_tenant_id
      and g.remaining_credits > 0
      and (g.expires_at is null or g.expires_at > now())
      and g.remaining_credits - coalesce((
        select sum(a.allocated_credits - a.consumed_credits)
        from billing_private.credit_reservation_allocations a
        join billing_private.credit_reservations r on r.id = a.reservation_id
        where a.grant_id = g.id and r.status = 'active'
      ), 0) > 0
    order by g.expires_at nulls last, g.created_at, g.id
    for update of g
  loop
    v_take := least(v_remaining, v_grant.spendable);
    insert into billing_private.credit_reservation_allocations (
      tenant_id, reservation_id, grant_id, allocated_credits
    ) values (p_tenant_id, v_reservation.id, v_grant.id, v_take)
    on conflict (reservation_id, grant_id) do update
      set allocated_credits = billing_private.credit_reservation_allocations.allocated_credits
        + excluded.allocated_credits;
    v_remaining := v_remaining - v_take;
    exit when v_remaining = 0;
  end loop;

  if v_remaining <> 0 then
    raise exception 'credit extension allocation invariant failed' using errcode = 'XX000';
  end if;

  update billing_private.credit_accounts
  set available_credits = available_credits - p_additional_credits,
      reserved_credits = reserved_credits + p_additional_credits,
      version = version + 1,
      updated_at = now()
  where tenant_id = p_tenant_id;

  update billing_private.credit_reservations
  set reserved_credits = reserved_credits + p_additional_credits,
      updated_at = now()
  where tenant_id = p_tenant_id and id = v_reservation.id;

  update billing_private.billable_runs
  set reserved_credits = reserved_credits + p_additional_credits
  where tenant_id = p_tenant_id and id = p_run_id;

  return v_extension_id;
end;
$$;

create function billing_private.settle_run(
  p_tenant_id uuid,
  p_run_id uuid,
  p_consumed_credits bigint,
  p_total_variable_cost_micros bigint,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation billing_private.credit_reservations%rowtype;
  v_allocation record;
  v_remaining bigint := p_consumed_credits;
  v_take bigint;
  v_released bigint;
  v_entry_id uuid;
begin
  select id into v_entry_id from billing_private.credit_ledger_entries
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if v_entry_id is not null then return v_entry_id; end if;

  select * into v_reservation
  from billing_private.credit_reservations
  where tenant_id = p_tenant_id and run_id = p_run_id
  for update;

  if v_reservation.id is null or v_reservation.status <> 'active' then
    raise exception 'active reservation not found' using errcode = 'P0001';
  end if;
  if p_consumed_credits <= 0 or p_consumed_credits > v_reservation.reserved_credits then
    raise exception 'settlement exceeds reservation' using errcode = '22023';
  end if;
  if p_total_variable_cost_micros < 0 then
    raise exception 'negative variable cost' using errcode = '22023';
  end if;

  for v_allocation in
    select * from billing_private.credit_reservation_allocations
    where tenant_id = p_tenant_id and reservation_id = v_reservation.id
    order by grant_id
    for update
  loop
    v_take := least(v_remaining, v_allocation.allocated_credits);
    if v_take > 0 then
      update billing_private.credit_grants
      set remaining_credits = remaining_credits - v_take
      where tenant_id = p_tenant_id and id = v_allocation.grant_id;
      update billing_private.credit_reservation_allocations
      set consumed_credits = v_take
      where reservation_id = v_reservation.id and grant_id = v_allocation.grant_id;
      v_remaining := v_remaining - v_take;
    end if;
  end loop;
  if v_remaining <> 0 then raise exception 'settlement allocation invariant failed' using errcode = 'XX000'; end if;

  v_released := v_reservation.reserved_credits - p_consumed_credits;

  insert into billing_private.credit_ledger_entries (
    tenant_id, run_id, amount_credits, reason, idempotency_key,
    metadata
  ) values (
    p_tenant_id, p_run_id, -p_consumed_credits, 'agent_usage', p_idempotency_key,
    jsonb_build_object('totalVariableCostMicros', p_total_variable_cost_micros)
  ) returning id into v_entry_id;

  update billing_private.credit_accounts
  set available_credits = available_credits + v_released,
      reserved_credits = reserved_credits - v_reservation.reserved_credits,
      version = version + 1,
      updated_at = now()
  where tenant_id = p_tenant_id;

  update billing_private.credit_reservations
  set consumed_credits = p_consumed_credits,
      released_credits = v_released,
      status = 'settled',
      updated_at = now()
  where id = v_reservation.id;

  update billing_private.billable_runs
  set status = 'settled', charged_credits = p_consumed_credits,
      total_variable_cost_micros = p_total_variable_cost_micros, settled_at = now()
  where tenant_id = p_tenant_id and id = p_run_id;

  return v_entry_id;
end;
$$;

create function billing_private.release_reservation(
  p_tenant_id uuid,
  p_run_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation billing_private.credit_reservations%rowtype;
begin
  select * into v_reservation
  from billing_private.credit_reservations
  where tenant_id = p_tenant_id and run_id = p_run_id
  for update;
  if v_reservation.id is null then return false; end if;
  if v_reservation.status <> 'active' then return true; end if;

  perform 1 from billing_private.credit_accounts where tenant_id = p_tenant_id for update;
  update billing_private.credit_accounts
  set available_credits = available_credits + v_reservation.reserved_credits,
      reserved_credits = reserved_credits - v_reservation.reserved_credits,
      version = version + 1,
      updated_at = now()
  where tenant_id = p_tenant_id;
  update billing_private.credit_reservations
  set released_credits = reserved_credits, status = 'released', updated_at = now()
  where id = v_reservation.id;
  update billing_private.billable_runs
  set status = 'canceled'
  where tenant_id = p_tenant_id and id = p_run_id and status <> 'settled';
  return true;
end;
$$;

create function billing_private.active_plan_version_id(p_tenant_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select s.plan_version_id
      from billing_private.subscriptions s
      where s.tenant_id = p_tenant_id
        and s.status in ('trialing', 'active')
        and (s.current_period_end is null or s.current_period_end > now())
      limit 1
    ),
    (
      select p.id
      from billing_private.plan_versions p
      where p.code = 'free'
        and p.published_at is not null
        and p.valid_from <= now()
        and (p.valid_until is null or p.valid_until > now())
      order by p.version desc
      limit 1
    )
  )
$$;

create function billing_private.begin_and_reserve_run(
  p_tenant_id uuid,
  p_user_id uuid,
  p_run_id uuid,
  p_workspace_id uuid,
  p_session_id uuid,
  p_billing_mode billing_private.billing_mode,
  p_model_id text,
  p_estimated_credits integer,
  p_reserve_credits bigint,
  p_cost_budget_micros_per_credit integer,
  p_expires_at timestamptz,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan billing_private.plan_versions%rowtype;
  v_existing billing_private.billable_runs%rowtype;
  v_active_runs integer;
  v_user_limit integer;
begin
  if p_run_id is null or p_estimated_credits < 0 or p_reserve_credits <= 0
    or p_idempotency_key = '' or p_expires_at <= now() then
    raise exception 'invalid billable run reservation' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from app_private.tenant_members m
    join app_private.tenants t on t.id = m.tenant_id and t.status = 'active'
    join app_private.profiles p on p.user_id = m.user_id and p.status = 'active'
    where m.tenant_id = p_tenant_id and m.user_id = p_user_id and m.status = 'active'
  ) then
    raise exception 'active tenant membership required' using errcode = '42501';
  end if;

  select * into v_plan
  from billing_private.plan_versions
  where id = billing_private.active_plan_version_id(p_tenant_id);
  if v_plan.id is null then raise exception 'active plan unavailable' using errcode = 'P0001'; end if;
  if p_cost_budget_micros_per_credit <> v_plan.cost_budget_micros_per_credit then
    raise exception 'billing plan version changed' using errcode = 'P0001';
  end if;
  if p_reserve_credits > v_plan.max_run_credits then
    raise exception 'run spend limit exceeded' using errcode = 'P0001';
  end if;
  if p_billing_mode = 'byok'
    and coalesce((v_plan.entitlements ->> 'byokOpenRouter')::boolean, false) is not true then
    raise exception 'BYOK entitlement required' using errcode = '42501';
  end if;

  select run_spend_limit_credits into v_user_limit
  from app_private.user_preferences where user_id = p_user_id;
  if v_user_limit is not null and p_reserve_credits > v_user_limit then
    raise exception 'user run spend limit exceeded' using errcode = 'P0001';
  end if;

  select * into v_existing
  from billing_private.billable_runs
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.id <> p_run_id or v_existing.user_id <> p_user_id
      or v_existing.billing_mode <> p_billing_mode then
      raise exception 'billable run idempotency collision' using errcode = 'P0001';
    end if;
    return billing_private.reserve_credits(
      p_tenant_id, p_run_id, p_reserve_credits, p_expires_at, p_idempotency_key || ':reservation'
    );
  end if;

  perform 1 from billing_private.credit_accounts
  where tenant_id = p_tenant_id for update;
  select count(*) into v_active_runs
  from billing_private.credit_reservations
  where tenant_id = p_tenant_id and status in ('active', 'pending_reconciliation');
  if v_active_runs >= v_plan.max_concurrent_runs then
    raise exception 'concurrency limit exceeded' using errcode = 'P0001';
  end if;

  insert into billing_private.billable_runs (
    id, tenant_id, user_id, workspace_id, session_id, root_run_id,
    status, billing_mode, plan_version_id, model_id, estimated_credits,
    cost_budget_micros_per_credit, idempotency_key, started_at
  ) values (
    p_run_id, p_tenant_id, p_user_id, p_workspace_id, p_session_id, p_run_id,
    'estimated', p_billing_mode, v_plan.id, p_model_id, p_estimated_credits,
    v_plan.cost_budget_micros_per_credit, p_idempotency_key, now()
  );

  return billing_private.reserve_credits(
    p_tenant_id, p_run_id, p_reserve_credits, p_expires_at, p_idempotency_key || ':reservation'
  );
end;
$$;

create function billing_private.ensure_child_run(
  p_tenant_id uuid,
  p_root_run_id uuid,
  p_run_id uuid,
  p_model_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_run_id = p_root_run_id then return; end if;
  insert into billing_private.billable_runs (
    id, tenant_id, user_id, workspace_id, session_id, root_run_id, parent_run_id,
    status, billing_mode, plan_version_id, model_id, estimated_credits,
    cost_budget_micros_per_credit, idempotency_key, started_at
  )
  select p_run_id, r.tenant_id, r.user_id, r.workspace_id, r.session_id, r.id, r.id,
         'running', r.billing_mode, r.plan_version_id, p_model_id, 0,
         r.cost_budget_micros_per_credit, 'child:' || p_run_id::text, now()
  from billing_private.billable_runs r
  where r.tenant_id = p_tenant_id and r.id = p_root_run_id
  on conflict (id) do nothing;
  if not exists (
    select 1 from billing_private.billable_runs
    where tenant_id = p_tenant_id and id = p_run_id and root_run_id = p_root_run_id
  ) then raise exception 'root run not found or child run collision' using errcode = 'P0001'; end if;
end;
$$;

create function billing_private.record_provider_usage(
  p_tenant_id uuid,
  p_root_run_id uuid,
  p_run_id uuid,
  p_attempt_id uuid,
  p_provider text,
  p_model_id text,
  p_provider_request_id text,
  p_purpose text,
  p_billing_mode billing_private.billing_mode,
  p_input_tokens bigint,
  p_cached_input_tokens bigint,
  p_output_tokens bigint,
  p_reasoning_tokens bigint,
  p_openrouter_debit_micros bigint,
  p_upstream_inference_cost_micros bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_existing billing_private.usage_events%rowtype;
  v_root billing_private.billable_runs%rowtype;
begin
  select * into v_root from billing_private.billable_runs
  where tenant_id = p_tenant_id and id = p_root_run_id;
  if v_root.id is null or v_root.billing_mode <> p_billing_mode then
    raise exception 'root run not found or billing mode mismatch' using errcode = 'P0001';
  end if;
  if p_provider <> 'openrouter' or p_attempt_id is null or p_model_id = ''
    or p_input_tokens < 0 or p_cached_input_tokens < 0 or p_output_tokens < 0
    or p_reasoning_tokens < 0 or coalesce(p_openrouter_debit_micros, 0) < 0
    or coalesce(p_upstream_inference_cost_micros, 0) < 0
    or (p_openrouter_debit_micros is null and p_provider_request_id is null) then
    raise exception 'invalid provider usage receipt' using errcode = '22023';
  end if;

  perform billing_private.ensure_child_run(p_tenant_id, p_root_run_id, p_run_id, p_model_id);
  insert into billing_private.usage_events (
    tenant_id, root_run_id, run_id, attempt_id, provider, model_id,
    provider_request_id, purpose, billing_mode, input_tokens, cached_input_tokens,
    output_tokens, reasoning_tokens, openrouter_debit_micros,
    upstream_inference_cost_micros,
    status
  ) values (
    p_tenant_id, p_root_run_id, p_run_id, p_attempt_id, p_provider, p_model_id,
    p_provider_request_id, p_purpose, p_billing_mode, p_input_tokens,
    p_cached_input_tokens, p_output_tokens, p_reasoning_tokens,
    p_openrouter_debit_micros, p_upstream_inference_cost_micros,
    case when p_openrouter_debit_micros is null then 'pending_reconciliation' else 'recorded' end
  ) on conflict (tenant_id, attempt_id) do nothing
  returning id into v_id;

  if v_id is null then
    select * into v_existing from billing_private.usage_events
    where tenant_id = p_tenant_id and attempt_id = p_attempt_id;
    if v_existing.root_run_id <> p_root_run_id or v_existing.run_id <> p_run_id
      or v_existing.provider <> p_provider or v_existing.model_id <> p_model_id
      or v_existing.provider_request_id is distinct from p_provider_request_id
      or v_existing.openrouter_debit_micros is distinct from p_openrouter_debit_micros then
      raise exception 'provider usage idempotency collision' using errcode = 'P0001';
    end if;
    return v_existing.id;
  end if;

  if p_provider_request_id is not null then
    insert into billing_private.provider_generations (
      provider, provider_request_id, tenant_id, usage_event_id,
      reconciliation_status, next_attempt_at
    ) values (
      p_provider, p_provider_request_id, p_tenant_id, v_id,
      case when p_openrouter_debit_micros is null then 'pending' else 'reconciled' end,
      case when p_openrouter_debit_micros is null then now() + interval '1 minute' else null end
    );
  end if;
  return v_id;
end;
$$;

create function billing_private.record_infrastructure_usage(
  p_tenant_id uuid,
  p_root_run_id uuid,
  p_run_id uuid,
  p_attempt_id uuid,
  p_kind text,
  p_cost_micros bigint,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_existing billing_private.infrastructure_usage_events%rowtype;
begin
  if p_kind not in ('sandbox', 'paid-tool') or p_cost_micros < 0 or p_idempotency_key = '' then
    raise exception 'invalid infrastructure usage receipt' using errcode = '22023';
  end if;
  perform billing_private.ensure_child_run(p_tenant_id, p_root_run_id, p_run_id, null);
  insert into billing_private.infrastructure_usage_events (
    tenant_id, root_run_id, run_id, attempt_id, kind, cost_micros, idempotency_key
  ) values (
    p_tenant_id, p_root_run_id, p_run_id, p_attempt_id, p_kind, p_cost_micros, p_idempotency_key
  ) on conflict (tenant_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then return v_id; end if;

  select * into v_existing from billing_private.infrastructure_usage_events
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if v_existing.root_run_id <> p_root_run_id or v_existing.run_id <> p_run_id
    or v_existing.attempt_id <> p_attempt_id or v_existing.kind <> p_kind
    or v_existing.cost_micros <> p_cost_micros then
    raise exception 'infrastructure usage idempotency collision' using errcode = 'P0001';
  end if;
  return v_existing.id;
end;
$$;

create function billing_private.settle_root_run(
  p_run_id uuid,
  p_idempotency_key text
)
returns table (
  tenant_id uuid,
  total_variable_cost_micros bigint,
  credits_charged bigint,
  credits_released bigint,
  settlement_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run billing_private.billable_runs%rowtype;
  v_reservation billing_private.credit_reservations%rowtype;
  v_plan billing_private.plan_versions%rowtype;
  v_provider_cost bigint := 0;
  v_infrastructure_cost bigint := 0;
  v_total bigint := 0;
  v_credits bigint := 0;
  v_has_provider_usage boolean := false;
begin
  select r.* into v_run from billing_private.billable_runs r where r.id = p_run_id for update;
  if v_run.id is null or v_run.root_run_id <> v_run.id then
    raise exception 'root billable run not found' using errcode = 'P0001';
  end if;
  select r.* into v_reservation from billing_private.credit_reservations r
  where r.tenant_id = v_run.tenant_id and r.run_id = v_run.id for update;
  if v_reservation.id is null then raise exception 'reservation not found' using errcode = 'P0001'; end if;
  if v_run.status = 'settled' then
    return query select v_run.tenant_id, v_run.total_variable_cost_micros,
      v_run.charged_credits::bigint, v_reservation.released_credits, 'settled'::text;
    return;
  end if;
  select p.* into v_plan from billing_private.plan_versions p where p.id = v_run.plan_version_id;

  select exists (
    select 1 from billing_private.usage_events u
    where u.tenant_id = v_run.tenant_id and u.root_run_id = v_run.id
  ) into v_has_provider_usage;

  if v_run.billing_mode = 'orygin' and exists (
    select 1 from billing_private.usage_events u
    where u.tenant_id = v_run.tenant_id and u.root_run_id = v_run.id
      and u.openrouter_debit_micros is null
  ) then
    update billing_private.billable_runs as r set status = 'pending_reconciliation'
      where r.tenant_id = v_run.tenant_id and r.id = v_run.id;
    update billing_private.credit_reservations as r set status = 'pending_reconciliation', updated_at = now()
      where r.tenant_id = v_run.tenant_id and r.id = v_reservation.id;
    return query select v_run.tenant_id, 0::bigint, 0::bigint, 0::bigint,
      'pending_reconciliation'::text;
    return;
  end if;

  select coalesce(sum(
    case when v_run.billing_mode = 'orygin'
      then (u.openrouter_debit_micros * (10000 + v_plan.provider_funding_fee_bps) + 9999) / 10000
      else 0 end
  ), 0) into v_provider_cost
  from billing_private.usage_events u
  where u.tenant_id = v_run.tenant_id and u.root_run_id = v_run.id;

  select coalesce(sum(i.cost_micros), 0) into v_infrastructure_cost
  from billing_private.infrastructure_usage_events i
  where i.tenant_id = v_run.tenant_id and i.root_run_id = v_run.id;
  v_total := v_provider_cost + v_infrastructure_cost;
  v_credits := case
    when v_total > 0 then (v_total + v_run.cost_budget_micros_per_credit - 1)
      / v_run.cost_budget_micros_per_credit
    when v_run.billing_mode = 'byok' and v_has_provider_usage then 1
    else 0
  end;

  if v_credits > v_reservation.reserved_credits then
    update billing_private.billable_runs as r set status = 'pending_reconciliation',
      total_variable_cost_micros = v_total where r.tenant_id = v_run.tenant_id and r.id = v_run.id;
    update billing_private.credit_reservations as r set status = 'pending_reconciliation', updated_at = now()
      where r.tenant_id = v_run.tenant_id and r.id = v_reservation.id;
    return query select v_run.tenant_id, v_total, v_credits, 0::bigint,
      'pending_reconciliation'::text;
    return;
  end if;

  if v_reservation.status = 'pending_reconciliation' then
    update billing_private.credit_reservations as r set status = 'active', updated_at = now()
      where r.tenant_id = v_run.tenant_id and r.id = v_reservation.id;
  elsif v_reservation.status <> 'active' then
    raise exception 'active reservation not found' using errcode = 'P0001';
  end if;

  if v_credits = 0 then
    perform billing_private.release_reservation(v_run.tenant_id, v_run.id);
    update billing_private.billable_runs as r set status = 'settled', charged_credits = 0,
      total_variable_cost_micros = 0, settled_at = now()
      where r.tenant_id = v_run.tenant_id and r.id = v_run.id;
  else
    perform billing_private.settle_run(
      v_run.tenant_id, v_run.id, v_credits, v_total, p_idempotency_key
    );
  end if;

  return query select v_run.tenant_id, v_total, v_credits,
    v_reservation.reserved_credits - v_credits, 'settled'::text;
end;
$$;

create function billing_private.reverse_ledger_entry(
  p_tenant_id uuid,
  p_entry_id uuid,
  p_idempotency_key text,
  p_reason text,
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original billing_private.credit_ledger_entries%rowtype;
  v_existing uuid;
  v_grant_id uuid;
  v_reversal_id uuid;
  v_amount bigint;
begin
  select id into v_existing from billing_private.credit_ledger_entries
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  select * into v_original from billing_private.credit_ledger_entries
  where tenant_id = p_tenant_id and id = p_entry_id for update;
  if v_original.id is null or v_original.amount_credits >= 0 then
    raise exception 'only a debit can be reversed' using errcode = '22023';
  end if;
  if exists (
    select 1 from billing_private.credit_ledger_entries
    where tenant_id = p_tenant_id and reverses_entry_id = p_entry_id
  ) then raise exception 'ledger entry is already reversed' using errcode = 'P0001'; end if;

  v_amount := -v_original.amount_credits;
  perform 1 from billing_private.credit_accounts where tenant_id = p_tenant_id for update;
  insert into billing_private.credit_grants (
    tenant_id, source, initial_credits, remaining_credits,
    idempotency_key, created_by
  ) values (
    p_tenant_id, 'adjustment', v_amount, v_amount,
    p_idempotency_key || ':grant', p_actor_user_id
  ) returning id into v_grant_id;
  insert into billing_private.credit_ledger_entries (
    tenant_id, grant_id, run_id, amount_credits, reason, idempotency_key,
    reverses_entry_id, actor_user_id
  ) values (
    p_tenant_id, v_grant_id, v_original.run_id, v_amount, p_reason,
    p_idempotency_key, p_entry_id, p_actor_user_id
  ) returning id into v_reversal_id;
  update billing_private.credit_accounts
  set available_credits = available_credits + v_amount,
      version = version + 1,
      updated_at = now()
  where tenant_id = p_tenant_id;
  return v_reversal_id;
end;
$$;

create function billing_private.expire_grants(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant record;
  v_expired integer := 0;
begin
  if p_limit < 1 or p_limit > 5000 then raise exception 'invalid expiration batch limit'; end if;
  for v_grant in
    select g.* from billing_private.credit_grants g
    where g.remaining_credits > 0 and g.expires_at <= now()
      and not exists (
        select 1 from billing_private.credit_reservation_allocations a
        join billing_private.credit_reservations r on r.id = a.reservation_id
        where a.grant_id = g.id and r.status in ('active', 'pending_reconciliation')
      )
    order by g.expires_at, g.id
    limit p_limit
    for update skip locked
  loop
    perform 1 from billing_private.credit_accounts
    where tenant_id = v_grant.tenant_id for update;
    insert into billing_private.credit_ledger_entries (
      tenant_id, grant_id, amount_credits, reason, idempotency_key
    ) values (
      v_grant.tenant_id, v_grant.id, -v_grant.remaining_credits,
      'grant_expired', 'expire:' || v_grant.id::text
    ) on conflict (tenant_id, idempotency_key) do nothing;
    update billing_private.credit_accounts
    set available_credits = greatest(available_credits - v_grant.remaining_credits, 0),
        version = version + 1,
        updated_at = now()
    where tenant_id = v_grant.tenant_id;
    update billing_private.credit_grants set remaining_credits = 0 where id = v_grant.id;
    v_expired := v_expired + 1;
  end loop;
  return v_expired;
end;
$$;

create function billing_private.rebuild_credit_account(p_tenant_id uuid)
returns table (available_credits bigint, reserved_credits bigint, debt_credits bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grants bigint;
  v_reserved bigint;
  v_debt bigint;
begin
  select coalesce(sum(remaining_credits), 0) into v_grants
  from billing_private.credit_grants
  where tenant_id = p_tenant_id and (expires_at is null or expires_at > now());
  select coalesce(sum(reserved_credits - consumed_credits - released_credits), 0) into v_reserved
  from billing_private.credit_reservations
  where tenant_id = p_tenant_id and status in ('active', 'pending_reconciliation');
  select coalesce(sum(-amount_credits), 0) into v_debt
  from billing_private.credit_ledger_entries
  where tenant_id = p_tenant_id and reason = 'credit_debt' and amount_credits < 0;

  insert into billing_private.credit_accounts (
    tenant_id, available_credits, reserved_credits, debt_credits
  ) values (p_tenant_id, greatest(v_grants - v_reserved, 0), v_reserved, v_debt)
  on conflict (tenant_id) do update
    set available_credits = excluded.available_credits,
        reserved_credits = excluded.reserved_credits,
        debt_credits = excluded.debt_credits,
        version = billing_private.credit_accounts.version + 1,
        updated_at = now();

  return query select greatest(v_grants - v_reserved, 0), v_reserved, v_debt;
end;
$$;

create function app_private.provision_confirmed_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_id bigint;
begin
  if new.email_confirmed_at is null then return new; end if;

  insert into app_private.profiles (user_id, locale, timezone)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'locale', 'fr'), 'Europe/Paris')
  on conflict (user_id) do nothing;

  insert into app_private.tenants (id, type, owner_user_id)
  values (new.id, 'personal', new.id)
  on conflict (id) do nothing;

  insert into app_private.tenant_members (tenant_id, user_id, role, status)
  values (new.id, new.id, 'owner', 'active')
  on conflict (tenant_id, user_id) do update set status = 'active';

  insert into app_private.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  select id into v_plan_id
  from billing_private.plan_versions
  where code = 'free' and published_at is not null and valid_from <= now()
    and (valid_until is null or valid_until > now())
  order by version desc limit 1;

  perform billing_private.grant_credits(
    new.id, 15, 'free', now() + interval '30 days',
    'welcome:' || new.id::text, v_plan_id, null, new.id
  );
  return new;
end;
$$;

create trigger provision_confirmed_user_after_insert
after insert on auth.users
for each row execute function app_private.provision_confirmed_user();

create trigger provision_confirmed_user_after_confirmation
after update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function app_private.provision_confirmed_user();

-- Narrow authenticated Data API surface used by Railway/Cloudflare to turn a
-- validated Supabase session into an active server-authoritative principal.
-- It never accepts an identity or tenant argument from the caller.
create or replace function public.resolve_auth_principal()
returns table (
  user_id uuid,
  tenant_id uuid,
  roles text[],
  email_verified boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id,
         m.tenant_id,
         array[m.role::text],
         u.email_confirmed_at is not null
  from auth.users u
  join app_private.tenant_members m
    on m.user_id = u.id and m.status = 'active'
  join app_private.tenants t
    on t.id = m.tenant_id and t.status = 'active'
  where u.id = auth.uid()
    and m.tenant_id = u.id
  limit 1
$$;

revoke all on function public.resolve_auth_principal() from public, anon;
grant execute on function public.resolve_auth_principal() to authenticated;

create or replace function public.ingest_paddle_event(
  p_provider_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_payload_hash text,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_hash text;
begin
  if p_provider_event_id = '' or p_event_type = ''
    or p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid Paddle event envelope' using errcode = '22023';
  end if;

  select payload_hash into v_existing_hash
  from billing_private.payment_events
  where provider_event_id = p_provider_event_id;
  if v_existing_hash is not null then
    if v_existing_hash <> p_payload_hash then
      raise exception 'Paddle event id reused with different payload' using errcode = 'P0001';
    end if;
    return false;
  end if;

  insert into billing_private.payment_events (
    provider_event_id, event_type, occurred_at, payload_hash, payload
  ) values (
    p_provider_event_id, p_event_type, p_occurred_at, p_payload_hash, p_payload
  );
  return true;
exception when unique_violation then
  select payload_hash into v_existing_hash
  from billing_private.payment_events
  where provider_event_id = p_provider_event_id;
  if v_existing_hash <> p_payload_hash then
    raise exception 'Paddle event id reused with different payload' using errcode = 'P0001';
  end if;
  return false;
end;
$$;

revoke all on function public.ingest_paddle_event(text, text, timestamptz, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_paddle_event(text, text, timestamptz, text, jsonb)
  to service_role;

create or replace function public.billing_get_policy(
  p_tenant_id uuid,
  p_user_id uuid
)
returns table (
  plan_version_id text,
  plan_code text,
  cost_budget_micros_per_credit text,
  max_run_credits text,
  max_concurrent_runs integer,
  entitlements jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan billing_private.plan_versions%rowtype;
begin
  if not exists (
    select 1
    from app_private.tenant_members m
    join app_private.tenants t on t.id = m.tenant_id and t.status = 'active'
    join app_private.profiles p on p.user_id = m.user_id and p.status = 'active'
    where m.tenant_id = p_tenant_id and m.user_id = p_user_id and m.status = 'active'
  ) then
    raise exception 'active tenant membership required' using errcode = '42501';
  end if;

  select * into v_plan
  from billing_private.plan_versions
  where id = billing_private.active_plan_version_id(p_tenant_id);
  if v_plan.id is null then
    raise exception 'active plan unavailable' using errcode = 'P0001';
  end if;

  return query select
    v_plan.id::text,
    v_plan.code,
    v_plan.cost_budget_micros_per_credit::text,
    v_plan.max_run_credits::text,
    v_plan.max_concurrent_runs,
    v_plan.entitlements;
end;
$$;

create or replace function public.authorize_tenant_resource(
  p_tenant_id uuid,
  p_user_id uuid,
  p_resource_kind text,
  p_resource_id uuid,
  p_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_resource_kind not in ('workspace', 'session', 'run', 'credential')
    or p_action not in ('read', 'write', 'delete', 'execute') then
    return false;
  end if;
  if not exists (
    select 1
    from app_private.tenant_members m
    join app_private.tenants t on t.id = m.tenant_id and t.status = 'active'
    join app_private.profiles p on p.user_id = m.user_id and p.status = 'active'
    where m.tenant_id = p_tenant_id and m.user_id = p_user_id and m.status = 'active'
  ) then
    return false;
  end if;

  return case p_resource_kind
    when 'workspace' then exists (
      select 1 from app_private.workspaces w
      where w.tenant_id = p_tenant_id and w.id = p_resource_id
        and w.deleted_at is null
    )
    when 'session' then exists (
      select 1 from app_private.sessions s
      where s.tenant_id = p_tenant_id and s.id = p_resource_id
        and s.status = 'active' and s.deleted_at is null
    )
    when 'run' then exists (
      select 1 from billing_private.billable_runs r
      where r.tenant_id = p_tenant_id and r.id = p_resource_id
    )
    when 'credential' then exists (
      select 1 from app_private.provider_credentials c
      where c.tenant_id = p_tenant_id and c.id = p_resource_id
        and c.status = 'active' and c.deleted_at is null
    )
    else false
  end;
end;
$$;

create or replace function public.billing_reserve_run(
  p_tenant_id uuid,
  p_user_id uuid,
  p_run_id uuid,
  p_workspace_id uuid,
  p_session_id uuid,
  p_billing_mode billing_private.billing_mode,
  p_model_id text,
  p_estimated_credits integer,
  p_reserve_credits bigint,
  p_cost_budget_micros_per_credit integer,
  p_expires_at timestamptz,
  p_idempotency_key text
)
returns table (
  reservation_id uuid,
  tenant_id uuid,
  run_id uuid,
  reserved_credits text,
  expires_at timestamptz,
  reservation_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation_id uuid;
begin
  v_reservation_id := billing_private.begin_and_reserve_run(
    p_tenant_id, p_user_id, p_run_id, p_workspace_id, p_session_id,
    p_billing_mode, p_model_id, p_estimated_credits, p_reserve_credits,
    p_cost_budget_micros_per_credit, p_expires_at, p_idempotency_key
  );
  return query
  select r.id, r.tenant_id, r.run_id, r.reserved_credits::text, r.expires_at, r.status::text
  from billing_private.credit_reservations r where r.id = v_reservation_id;
end;
$$;

create or replace function public.billing_extend_reservation(
  p_tenant_id uuid,
  p_run_id uuid,
  p_additional_credits bigint,
  p_idempotency_key text
)
returns table (
  reservation_id uuid,
  tenant_id uuid,
  run_id uuid,
  reserved_credits text,
  expires_at timestamptz,
  reservation_status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform billing_private.extend_reservation(
    p_tenant_id, p_run_id, p_additional_credits, p_idempotency_key
  );
  return query
  select r.id, r.tenant_id, r.run_id, r.reserved_credits::text, r.expires_at, r.status::text
  from billing_private.credit_reservations r
  where r.tenant_id = p_tenant_id and r.run_id = p_run_id;
end;
$$;

create or replace function public.billing_record_provider_usage(
  p_tenant_id uuid,
  p_root_run_id uuid,
  p_run_id uuid,
  p_attempt_id uuid,
  p_provider text,
  p_model_id text,
  p_provider_request_id text,
  p_purpose text,
  p_billing_mode billing_private.billing_mode,
  p_input_tokens bigint,
  p_cached_input_tokens bigint,
  p_output_tokens bigint,
  p_reasoning_tokens bigint,
  p_openrouter_debit_micros bigint,
  p_upstream_inference_cost_micros bigint
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select billing_private.record_provider_usage(
    p_tenant_id, p_root_run_id, p_run_id, p_attempt_id, p_provider,
    p_model_id, p_provider_request_id, p_purpose, p_billing_mode,
    p_input_tokens, p_cached_input_tokens, p_output_tokens, p_reasoning_tokens,
    p_openrouter_debit_micros, p_upstream_inference_cost_micros
  )
$$;

create or replace function public.billing_record_infrastructure_usage(
  p_tenant_id uuid,
  p_root_run_id uuid,
  p_run_id uuid,
  p_attempt_id uuid,
  p_kind text,
  p_cost_micros bigint,
  p_idempotency_key text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select billing_private.record_infrastructure_usage(
    p_tenant_id, p_root_run_id, p_run_id, p_attempt_id,
    p_kind, p_cost_micros, p_idempotency_key
  )
$$;

create or replace function public.billing_settle_run(
  p_run_id uuid,
  p_idempotency_key text
)
returns table (
  tenant_id uuid,
  total_variable_cost_micros text,
  credits_charged text,
  credits_released text,
  settlement_status text
)
language sql
security definer
set search_path = ''
as $$
  select settled.tenant_id,
    settled.total_variable_cost_micros::text,
    settled.credits_charged::text,
    settled.credits_released::text,
    settled.settlement_status
  from billing_private.settle_root_run(p_run_id, p_idempotency_key) settled
$$;

create or replace function public.billing_refund_run(
  p_tenant_id uuid,
  p_run_id uuid,
  p_credits bigint,
  p_reason text,
  p_idempotency_key text,
  p_actor_user_id uuid
)
returns table (
  ledger_entry_id uuid,
  tenant_id uuid,
  amount_credits text,
  entry_reason text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original billing_private.credit_ledger_entries%rowtype;
  v_reversal_id uuid;
begin
  select * into v_original
  from billing_private.credit_ledger_entries
  where tenant_id = p_tenant_id and run_id = p_run_id and reason = 'agent_usage'
  order by created_at desc limit 1;
  if v_original.id is null or p_credits <> -v_original.amount_credits then
    raise exception 'refund must reverse the exact settled run debit' using errcode = '22023';
  end if;
  v_reversal_id := billing_private.reverse_ledger_entry(
    p_tenant_id, v_original.id, p_idempotency_key, p_reason, p_actor_user_id
  );
  return query
  select e.id, e.tenant_id, e.amount_credits::text, e.reason, e.created_at
  from billing_private.credit_ledger_entries e where e.id = v_reversal_id;
end;
$$;

revoke all on function public.billing_reserve_run(uuid, uuid, uuid, uuid, uuid, billing_private.billing_mode, text, integer, bigint, integer, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.billing_get_policy(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.authorize_tenant_resource(uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.billing_extend_reservation(uuid, uuid, bigint, text)
  from public, anon, authenticated;
revoke all on function public.billing_record_provider_usage(uuid, uuid, uuid, uuid, text, text, text, text, billing_private.billing_mode, bigint, bigint, bigint, bigint, bigint, bigint)
  from public, anon, authenticated;
revoke all on function public.billing_record_infrastructure_usage(uuid, uuid, uuid, uuid, text, bigint, text)
  from public, anon, authenticated;
revoke all on function public.billing_settle_run(uuid, text)
  from public, anon, authenticated;
revoke all on function public.billing_refund_run(uuid, uuid, bigint, text, text, uuid)
  from public, anon, authenticated;

grant execute on function public.billing_reserve_run(uuid, uuid, uuid, uuid, uuid, billing_private.billing_mode, text, integer, bigint, integer, timestamptz, text)
  to service_role;
grant execute on function public.billing_get_policy(uuid, uuid)
  to service_role;
grant execute on function public.authorize_tenant_resource(uuid, uuid, text, uuid, text)
  to service_role;
grant execute on function public.billing_extend_reservation(uuid, uuid, bigint, text)
  to service_role;
grant execute on function public.billing_record_provider_usage(uuid, uuid, uuid, uuid, text, text, text, text, billing_private.billing_mode, bigint, bigint, bigint, bigint, bigint, bigint)
  to service_role;
grant execute on function public.billing_record_infrastructure_usage(uuid, uuid, uuid, uuid, text, bigint, text)
  to service_role;
grant execute on function public.billing_settle_run(uuid, text)
  to service_role;
grant execute on function public.billing_refund_run(uuid, uuid, bigint, text, text, uuid)
  to service_role;

do $$
declare
  v_table regclass;
begin
  foreach v_table in array array[
    'app_private.profiles'::regclass,
    'app_private.tenants'::regclass,
    'app_private.tenant_members'::regclass,
    'app_private.user_preferences'::regclass,
    'app_private.workspaces'::regclass,
    'app_private.sessions'::regclass,
    'app_private.session_events'::regclass,
    'app_private.attachments'::regclass,
    'app_private.workspace_backups'::regclass,
    'app_private.provider_credentials'::regclass,
    'app_private.github_installations'::regclass,
    'billing_private.plan_versions'::regclass,
    'billing_private.subscriptions'::regclass,
    'billing_private.paddle_catalog_items'::regclass,
    'billing_private.credit_accounts'::regclass,
    'billing_private.credit_grants'::regclass,
    'billing_private.credit_ledger_entries'::regclass,
    'billing_private.billable_runs'::regclass,
    'billing_private.credit_reservations'::regclass,
    'billing_private.credit_reservation_allocations'::regclass,
    'billing_private.credit_reservation_extensions'::regclass,
    'billing_private.usage_events'::regclass,
    'billing_private.infrastructure_usage_events'::regclass,
    'billing_private.provider_generations'::regclass,
    'billing_private.payment_events'::regclass,
    'audit_private.admin_users'::regclass,
    'audit_private.audit_events'::regclass
  ]
  loop
    execute format('alter table %s enable row level security', v_table);
    execute format('alter table %s force row level security', v_table);
  end loop;
end;
$$;

revoke all on all tables in schema app_private from public, anon, authenticated;
revoke all on all tables in schema billing_private from public, anon, authenticated;
revoke all on all tables in schema audit_private from public, anon, authenticated;
revoke all on all sequences in schema app_private from public, anon, authenticated;
revoke all on all sequences in schema billing_private from public, anon, authenticated;
revoke all on all sequences in schema audit_private from public, anon, authenticated;
revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke execute on all functions in schema billing_private from public, anon, authenticated;
revoke execute on all functions in schema audit_private from public, anon, authenticated;

grant usage on schema app_private, billing_private, audit_private to service_role;
grant select, insert, update, delete on all tables in schema app_private to service_role;
grant select, insert, update, delete on all tables in schema billing_private to service_role;
grant select, insert on all tables in schema audit_private to service_role;
grant usage, select on all sequences in schema app_private, billing_private, audit_private to service_role;
grant execute on function billing_private.grant_credits(uuid, bigint, billing_private.grant_source, timestamptz, text, bigint, text, uuid) to service_role;
grant execute on function billing_private.reserve_credits(uuid, uuid, bigint, timestamptz, text) to service_role;
grant execute on function billing_private.extend_reservation(uuid, uuid, bigint, text) to service_role;
grant execute on function billing_private.settle_run(uuid, uuid, bigint, bigint, text) to service_role;
grant execute on function billing_private.release_reservation(uuid, uuid) to service_role;
grant execute on function billing_private.rebuild_credit_account(uuid) to service_role;
grant execute on function billing_private.reverse_ledger_entry(uuid, uuid, text, text, uuid) to service_role;
grant execute on function billing_private.expire_grants(integer) to service_role;

-- Lock down the legacy browser-exposed table before its verified migration.
do $$
begin
  if to_regclass('public.user_model_settings') is not null then
    revoke all on table public.user_model_settings from anon, authenticated;
    alter table public.user_model_settings enable row level security;
    alter table public.user_model_settings force row level security;
  end if;
end;
$$;

insert into app_private.profiles (user_id)
select id from auth.users where email_confirmed_at is not null
on conflict (user_id) do nothing;

insert into app_private.tenants (id, type, owner_user_id)
select id, 'personal', id from auth.users where email_confirmed_at is not null
on conflict (id) do nothing;

insert into app_private.tenant_members (tenant_id, user_id, role, status)
select id, id, 'owner', 'active' from auth.users where email_confirmed_at is not null
on conflict (tenant_id, user_id) do nothing;

insert into app_private.user_preferences (user_id)
select id from auth.users where email_confirmed_at is not null
on conflict (user_id) do nothing;

do $$
declare
  v_user_id uuid;
  v_plan_id bigint;
begin
  select id into v_plan_id from billing_private.plan_versions
  where code = 'free' and version = 1;
  for v_user_id in select id from auth.users where email_confirmed_at is not null loop
    perform billing_private.grant_credits(
      v_user_id, 15, 'free', now() + interval '30 days',
      'welcome:' || v_user_id::text, v_plan_id, null, v_user_id
    );
  end loop;
end;
$$;
