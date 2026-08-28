/** Supabase-backed durable billing provider for Orygin cloud runs. @module @orygin-ai/dsh-billing-supabase */

import { Context } from '@orygin-ai/cordis'
import {
  BillingError,
  BillingService,
  type BillingPolicy,
  type BillingRunInput,
  type CreditReservation,
  type InfrastructureUsageReceipt,
  type LedgerEntry,
  type RefundInput,
  type ReservationExtension,
  type RunEstimate,
  type RunSettlement,
} from '@orygin-ai/dsh-billing'
import { creditsForVariableCost, type ProviderUsageReceipt } from '@orygin-ai/dsh-llm'

const DEFAULT_RESERVATION_TTL_SECONDS = 15 * 60
const HIGH_ESTIMATE_CONFIRMATION_CREDITS = 25n
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Server-only transport dependencies for the Supabase billing provider. */
export interface SupabaseBillingTransport {
  readonly url: string
  readonly serviceRoleKey: string
  readonly fetch: typeof globalThis.fetch
  readonly now: () => Date
}

interface ReservationRow {
  readonly reservation_id: unknown
  readonly tenant_id: unknown
  readonly run_id: unknown
  readonly reserved_credits: unknown
  readonly expires_at: unknown
  readonly reservation_status: unknown
}

interface PolicyRow {
  readonly plan_version_id: unknown
  readonly plan_code: unknown
  readonly cost_budget_micros_per_credit: unknown
  readonly max_run_credits: unknown
  readonly max_concurrent_runs: unknown
  readonly entitlements: unknown
}

interface SettlementRow {
  readonly tenant_id: unknown
  readonly total_variable_cost_micros: unknown
  readonly credits_charged: unknown
  readonly credits_released: unknown
  readonly settlement_status: unknown
}

interface LedgerRow {
  readonly ledger_entry_id: unknown
  readonly tenant_id: unknown
  readonly amount_credits: unknown
  readonly entry_reason: unknown
  readonly created_at: unknown
}

/** Stable Cordis plugin name. */
export const name = 'billing-supabase'

/** No service prerequisites; cloud assemblies mount this provider before LLM calls begin. */
export const inject: string[] = []

/**
 * Supabase implementation of the server-only billing seam.
 * All wallet mutations are delegated to service-role-only transactional RPCs.
 */
export class SupabaseBillingService extends BillingService {
  private readonly config: SupabaseBillingTransport

  /**
   * @param ctx - Cordis context receiving `ctx.billing`.
   * @param config - validated server-only Supabase transport.
   */
  constructor(ctx: Context, config: SupabaseBillingTransport) {
    super(ctx)
    this.config = config
  }

  /** @inheritdoc */
  async policy(identity: { readonly tenantId: string; readonly userId: string }): Promise<BillingPolicy> {
    assertUuid(identity.tenantId, 'tenantId')
    assertUuid(identity.userId, 'userId')
    const rows = await this.rpc<unknown>('billing_get_policy', {
      p_tenant_id: identity.tenantId,
      p_user_id: identity.userId,
    })
    const row = oneRow(rows, 'billing policy') as PolicyRow
    const planCode = requiredString(row.plan_code, 'plan_code')
    if (!isPlanCode(planCode)) {
      throw new BillingError('billing-unavailable', 'Supabase returned an invalid plan code')
    }
    const entitlements = requiredRecord(row.entitlements, 'entitlements')
    return Object.freeze({
      planVersionId: requiredPositiveIntegerString(row.plan_version_id, 'plan_version_id'),
      planCode,
      costBudgetMicrosPerCredit: requiredBigInt(
        row.cost_budget_micros_per_credit,
        'cost_budget_micros_per_credit',
      ),
      runLimitCredits: requiredBigInt(row.max_run_credits, 'max_run_credits'),
      maxConcurrentRuns: requiredSafeInteger(row.max_concurrent_runs, 'max_concurrent_runs'),
      byokOpenRouter: entitlements.byokOpenRouter === true,
    })
  }

  /** @inheritdoc */
  estimate(input: BillingRunInput): Promise<RunEstimate> {
    assertBillingInput(input)
    const estimatedCredits = creditsForVariableCost(
      input.estimatedVariableCostMicros,
      input.costBudgetMicrosPerCredit,
    )
    const maximumCredits = creditsForVariableCost(
      input.maximumVariableCostMicros,
      input.costBudgetMicrosPerCredit,
    )
    if (estimatedCredits > maximumCredits || maximumCredits > input.runLimitCredits) {
      throw new BillingError('run-spend-limit', 'Run estimate exceeds its server-approved credit limit')
    }
    return Promise.resolve(Object.freeze({
      estimatedCredits,
      maximumCredits,
      estimatedVariableCostMicros: input.estimatedVariableCostMicros,
      requiresConfirmation: estimatedCredits > HIGH_ESTIMATE_CONFIRMATION_CREDITS,
    }))
  }

  /** @inheritdoc */
  async reserve(
    input: BillingRunInput & { readonly idempotencyKey: string },
  ): Promise<CreditReservation> {
    assertUuid(input.tenantId, 'tenantId')
    assertUuid(input.userId, 'userId')
    assertUuid(input.rootRunId, 'rootRunId')
    assertUuid(input.runId, 'runId')
    if (input.rootRunId !== input.runId) {
      throw new BillingError('billing-unavailable', 'Only a root run can own a credit reservation')
    }
    const estimate = await this.estimate(input)
    if (estimate.maximumCredits <= 0n) {
      throw new BillingError('billing-unavailable', 'A paid run reservation must be positive')
    }
    const ttlSeconds = input.reservationTtlSeconds ?? DEFAULT_RESERVATION_TTL_SECONDS
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) {
      throw new BillingError('billing-unavailable', 'Reservation TTL is outside the accepted range')
    }
    const expiresAt = new Date(this.config.now().getTime() + ttlSeconds * 1000).toISOString()
    const rows = await this.rpc<unknown>('billing_reserve_run', {
      p_tenant_id: input.tenantId,
      p_user_id: input.userId,
      p_run_id: input.runId,
      p_workspace_id: optionalUuid(input.workspaceId, 'workspaceId'),
      p_session_id: optionalUuid(input.sessionId, 'sessionId'),
      p_billing_mode: input.billingMode,
      p_model_id: nonEmpty(input.modelId, 'modelId'),
      p_estimated_credits: integerJson(estimate.estimatedCredits, 'estimatedCredits'),
      p_reserve_credits: estimate.maximumCredits.toString(),
      p_cost_budget_micros_per_credit: integerJson(
        input.costBudgetMicrosPerCredit,
        'costBudgetMicrosPerCredit',
      ),
      p_expires_at: expiresAt,
      p_idempotency_key: nonEmpty(input.idempotencyKey, 'idempotencyKey'),
    })
    return reservationFromRows(rows)
  }

  /** @inheritdoc */
  async extend(input: ReservationExtension): Promise<CreditReservation> {
    assertUuid(input.tenantId, 'tenantId')
    assertUuid(input.runId, 'runId')
    if (input.additionalCredits <= 0n) {
      throw new BillingError('billing-unavailable', 'Reservation extension must be positive')
    }
    const rows = await this.rpc<unknown>('billing_extend_reservation', {
      p_tenant_id: input.tenantId,
      p_run_id: input.runId,
      p_additional_credits: input.additionalCredits.toString(),
      p_idempotency_key: nonEmpty(input.idempotencyKey, 'idempotencyKey'),
    })
    return reservationFromRows(rows)
  }

  /** @inheritdoc */
  async recordProviderUsage(receipt: ProviderUsageReceipt): Promise<void> {
    assertProviderReceipt(receipt)
    await this.rpc('billing_record_provider_usage', {
      p_tenant_id: receipt.tenantId,
      p_root_run_id: receipt.rootRunId,
      p_run_id: receipt.runId,
      p_attempt_id: receipt.attemptId,
      p_provider: receipt.provider,
      p_model_id: receipt.modelId,
      p_provider_request_id: receipt.providerRequestId ?? null,
      p_purpose: receipt.purpose,
      p_billing_mode: receipt.billingMode,
      p_input_tokens: integerString(receipt.inputTokens, 'inputTokens'),
      p_cached_input_tokens: integerString(receipt.cachedInputTokens, 'cachedInputTokens'),
      p_output_tokens: integerString(receipt.outputTokens, 'outputTokens'),
      p_reasoning_tokens: integerString(receipt.reasoningTokens, 'reasoningTokens'),
      p_openrouter_debit_micros: receipt.openrouterDebitMicros?.toString() ?? null,
      p_upstream_inference_cost_micros: receipt.upstreamInferenceCostMicros?.toString() ?? null,
    })
  }

  /** @inheritdoc */
  async recordInfrastructureUsage(receipt: InfrastructureUsageReceipt): Promise<void> {
    assertUuid(receipt.tenantId, 'tenantId')
    assertUuid(receipt.rootRunId, 'rootRunId')
    assertUuid(receipt.runId, 'runId')
    assertUuid(receipt.attemptId, 'attemptId')
    if (receipt.costMicros < 0n) throw new BillingError('billing-unavailable', 'Negative infrastructure cost')
    await this.rpc('billing_record_infrastructure_usage', {
      p_tenant_id: receipt.tenantId,
      p_root_run_id: receipt.rootRunId,
      p_run_id: receipt.runId,
      p_attempt_id: receipt.attemptId,
      p_kind: receipt.kind,
      p_cost_micros: receipt.costMicros.toString(),
      p_idempotency_key: nonEmpty(receipt.idempotencyKey, 'idempotencyKey'),
    })
  }

  /** @inheritdoc */
  async settle(runId: string): Promise<RunSettlement> {
    assertUuid(runId, 'runId')
    const rows = await this.rpc<unknown>('billing_settle_run', {
      p_run_id: runId,
      p_idempotency_key: `settle:${runId}`,
    })
    const row = oneRow(rows, 'settlement') as SettlementRow
    const status = requiredString(row.settlement_status, 'settlement_status')
    if (status !== 'settled' && status !== 'pending_reconciliation') {
      throw new BillingError('billing-unavailable', 'Supabase returned an invalid settlement status')
    }
    return Object.freeze({
      runId,
      totalVariableCostMicros: requiredBigInt(row.total_variable_cost_micros, 'total cost'),
      creditsCharged: requiredBigInt(row.credits_charged, 'credits charged'),
      creditsReleased: requiredBigInt(row.credits_released, 'credits released'),
      status,
    })
  }

  /** @inheritdoc */
  async refund(input: RefundInput): Promise<LedgerEntry> {
    assertUuid(input.tenantId, 'tenantId')
    assertUuid(input.runId, 'runId')
    if (input.credits <= 0n) throw new BillingError('billing-unavailable', 'Refund must be positive')
    const rows = await this.rpc<unknown>('billing_refund_run', {
      p_tenant_id: input.tenantId,
      p_run_id: input.runId,
      p_credits: input.credits.toString(),
      p_reason: nonEmpty(input.reason, 'reason'),
      p_idempotency_key: nonEmpty(input.idempotencyKey, 'idempotencyKey'),
      p_actor_user_id: optionalUuid(input.actorUserId, 'actorUserId'),
    })
    const row = oneRow(rows, 'refund') as LedgerRow
    return Object.freeze({
      id: requiredUuid(row.ledger_entry_id, 'ledger_entry_id'),
      tenantId: requiredUuid(row.tenant_id, 'tenant_id'),
      amountCredits: requiredBigInt(row.amount_credits, 'amount_credits'),
      reason: requiredString(row.entry_reason, 'entry_reason'),
      createdAt: requiredDate(row.created_at, 'created_at'),
    })
  }

  private async rpc<T>(name: string, body: Readonly<Record<string, unknown>>): Promise<T> {
    let response: Response
    try {
      response = await this.config.fetch(new URL(`/rest/v1/rpc/${name}`, this.config.url), {
        method: 'POST',
        headers: {
          apikey: this.config.serviceRoleKey,
          authorization: `Bearer ${this.config.serviceRoleKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (cause) {
      throw new BillingError('billing-unavailable', 'Supabase billing transport failed', { cause })
    }
    if (!response.ok) {
      const detail = await response.text()
      throw mapRpcError(response.status, detail)
    }
    return await response.json() as T
  }
}

/**
 * Mount the Supabase provider from server-only environment variables.
 * @param ctx - Cordis host context receiving the billing service.
 */
export function apply(ctx: Context): void {
  if (process.env.ORYGIN_SAAS_PROFILE !== '1') return
  const url = requiredEnvironment('SUPABASE_URL')
  const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY')
  if (url === undefined || serviceRoleKey === undefined) {
    throw new BillingError('billing-unavailable', 'Supabase billing environment is incomplete')
  }
  new SupabaseBillingService(ctx, { url, serviceRoleKey, fetch: globalThis.fetch, now: () => new Date() })
}

function assertBillingInput(input: BillingRunInput): void {
  if (input.estimatedVariableCostMicros < 0n || input.maximumVariableCostMicros < 0n
    || input.costBudgetMicrosPerCredit <= 0n || input.runLimitCredits <= 0n) {
    throw new BillingError('billing-unavailable', 'Billing estimate contains an invalid monetary bound')
  }
}

function assertProviderReceipt(receipt: ProviderUsageReceipt): void {
  assertUuid(receipt.tenantId, 'tenantId')
  assertUuid(receipt.rootRunId, 'rootRunId')
  assertUuid(receipt.runId, 'runId')
  assertUuid(receipt.attemptId, 'attemptId')
  nonEmpty(receipt.modelId, 'modelId')
  for (const [name, value] of [
    ['inputTokens', receipt.inputTokens],
    ['cachedInputTokens', receipt.cachedInputTokens],
    ['outputTokens', receipt.outputTokens],
    ['reasoningTokens', receipt.reasoningTokens],
  ] as const) integerString(value, name)
  if (receipt.openrouterDebitMicros !== undefined && receipt.openrouterDebitMicros < 0n) {
    throw new BillingError('billing-unavailable', 'Negative OpenRouter debit')
  }
  if (receipt.upstreamInferenceCostMicros !== undefined && receipt.upstreamInferenceCostMicros < 0n) {
    throw new BillingError('billing-unavailable', 'Negative upstream inference cost')
  }
  if (receipt.openrouterDebitMicros === undefined && receipt.providerRequestId === undefined) {
    throw new BillingError('usage-reconciliation-pending', 'Missing cost has no provider request id')
  }
}

function reservationFromRows(value: unknown): CreditReservation {
  const row = oneRow(value, 'reservation') as ReservationRow
  const status = requiredString(row.reservation_status, 'reservation_status')
  if (status !== 'active' && status !== 'pending_reconciliation') {
    throw new BillingError('billing-unavailable', 'Supabase returned an invalid reservation status')
  }
  return Object.freeze({
    id: requiredUuid(row.reservation_id, 'reservation_id'),
    tenantId: requiredUuid(row.tenant_id, 'tenant_id'),
    runId: requiredUuid(row.run_id, 'run_id'),
    reservedCredits: requiredBigInt(row.reserved_credits, 'reserved_credits'),
    expiresAt: requiredDate(row.expires_at, 'expires_at'),
    status,
  })
}

function oneRow(value: unknown, label: string): object {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new BillingError('billing-unavailable', `Supabase returned an invalid ${label} response`)
  }
  const row: unknown = value[0]
  if (typeof row !== 'object' || row === null) {
    throw new BillingError('billing-unavailable', `Supabase returned an invalid ${label} response`)
  }
  return row
}

function requiredBigInt(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    throw new BillingError('billing-unavailable', `Supabase returned invalid ${label}`)
  }
  return BigInt(value)
}

function requiredPositiveIntegerString(value: unknown, label: string): string {
  const result = requiredString(value, label)
  if (!/^[1-9]\d*$/.test(result)) {
    throw new BillingError('billing-unavailable', `Supabase returned invalid ${label}`)
  }
  return result
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new BillingError('billing-unavailable', `Supabase returned invalid ${label}`)
  }
  return value
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BillingError('billing-unavailable', `Supabase returned invalid ${label}`)
  }
  return value as Record<string, unknown>
}

function requiredSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new BillingError('billing-unavailable', `Supabase returned invalid ${label}`)
  }
  return value
}

function isPlanCode(value: string): value is BillingPolicy['planCode'] {
  return value === 'free' || value === 'pro' || value === 'power' || value === 'ultra'
}

function requiredUuid(value: unknown, label: string): string {
  const result = requiredString(value, label)
  assertUuid(result, label)
  return result
}

function requiredDate(value: unknown, label: string): string {
  const result = requiredString(value, label)
  if (!Number.isFinite(Date.parse(result))) {
    throw new BillingError('billing-unavailable', `Supabase returned invalid ${label}`)
  }
  return result
}

function nonEmpty(value: string, label: string): string {
  if (value === '') throw new BillingError('billing-unavailable', `${label} must not be empty`)
  return value
}

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new BillingError('billing-unavailable', `${label} must be a UUID`)
}

function optionalUuid(value: string | undefined, label: string): string | null {
  if (value === undefined) return null
  assertUuid(value, label)
  return value
}

function integerString(value: number, label: string): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BillingError('billing-unavailable', `${label} must be a non-negative safe integer`)
  }
  return String(value)
}

function integerJson(value: bigint, label: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BillingError('billing-unavailable', `${label} exceeds the JSON integer range`)
  }
  return Number(value)
}

function requiredEnvironment(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function mapRpcError(status: number, detail: string): BillingError {
  if (/insufficient credits/i.test(detail)) {
    return new BillingError('insufficient-credits', 'Insufficient Orygin credits')
  }
  if (/concurrency limit/i.test(detail)) {
    return new BillingError('concurrency-limit', 'Concurrent run limit reached')
  }
  if (/spend limit/i.test(detail)) {
    return new BillingError('run-spend-limit', 'Run spend limit reached')
  }
  if (/entitlement|required/i.test(detail) && status === 403) {
    return new BillingError('entitlement-required', 'The active plan does not include this capability')
  }
  return new BillingError('billing-unavailable', `Supabase billing RPC failed with HTTP ${String(status)}`)
}

export default SupabaseBillingService
