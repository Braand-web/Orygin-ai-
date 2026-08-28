/**
 * Server-only commercial accounting capability seam.
 * @module @orygin-ai/dsh-billing
 */

import { Context, Service } from '@orygin-ai/cordis'
import type { LlmAccountingContext, ProviderUsageReceipt } from '@orygin-ai/dsh-llm'

/** Stable public billing error vocabulary. */
export type BillingErrorCode =
  | 'insufficient-credits'
  | 'entitlement-required'
  | 'run-spend-limit'
  | 'concurrency-limit'
  | 'billing-unavailable'
  | 'usage-reconciliation-pending'

/** Typed commercial failure safe to translate at the API boundary. */
export class BillingError extends Error {
  /** Stable public error code. */
  readonly code: BillingErrorCode

  /**
   * @param code - stable public billing error code.
   * @param message - opaque operator-safe explanation.
   * @param options - optional error cause.
   */
  constructor(code: BillingErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BillingError'
    this.code = code
  }
}

/** A root-run estimate expressed only in public credits and integer money. */
export interface RunEstimate {
  readonly estimatedCredits: bigint
  readonly maximumCredits: bigint
  readonly estimatedVariableCostMicros: bigint
  readonly requiresConfirmation: boolean
}

/** Server-authoritative commercial limits for one active tenant member. */
export interface BillingPolicy {
  readonly planVersionId: string
  readonly planCode: 'free' | 'pro' | 'power' | 'ultra'
  readonly costBudgetMicrosPerCredit: bigint
  readonly runLimitCredits: bigint
  readonly maxConcurrentRuns: number
  readonly byokOpenRouter: boolean
}

/** Active wallet reservation for one root run. */
export interface CreditReservation {
  readonly id: string
  readonly tenantId: string
  readonly runId: string
  readonly reservedCredits: bigint
  readonly expiresAt: string
  readonly status: 'active' | 'pending_reconciliation'
}

/** Final root-run debit after all attempts and infrastructure costs are aggregated. */
export interface RunSettlement {
  readonly runId: string
  readonly totalVariableCostMicros: bigint
  readonly creditsCharged: bigint
  readonly creditsReleased: bigint
  readonly status: 'settled' | 'pending_reconciliation'
}

/** Append-only compensating credit entry. */
export interface LedgerEntry {
  readonly id: string
  readonly tenantId: string
  readonly amountCredits: bigint
  readonly reason: string
  readonly createdAt: string
}

/** Inputs to estimate and reserve one root run. */
export interface BillingRunInput extends LlmAccountingContext {
  readonly modelId: string
  readonly estimatedVariableCostMicros: bigint
  readonly maximumVariableCostMicros: bigint
  readonly maximumOutputTokens?: number
  readonly toolNames: readonly string[]
  readonly costBudgetMicrosPerCredit: bigint
  readonly runLimitCredits: bigint
  readonly reservationTtlSeconds?: number
}

/** Incremental, directly attributable non-LLM cost. */
export interface InfrastructureUsageReceipt {
  readonly tenantId: string
  readonly rootRunId: string
  readonly runId: string
  readonly attemptId: string
  readonly kind: 'sandbox' | 'paid-tool'
  readonly costMicros: bigint
  readonly idempotencyKey: string
}

/** Reservation extension input used before a retry or sub-agent starts. */
export interface ReservationExtension {
  readonly tenantId: string
  readonly runId: string
  readonly additionalCredits: bigint
  readonly idempotencyKey: string
}

/** Compensating refund input; the original debit is never mutated. */
export interface RefundInput {
  readonly tenantId: string
  readonly runId: string
  readonly credits: bigint
  readonly reason: string
  readonly idempotencyKey: string
  readonly actorUserId?: string
}

declare module '@orygin-ai/cordis' {
  interface Context {
    billing: BillingService
  }
}

/**
 * Billing implementations own durability, idempotency, and wallet locking.
 * Provider adapters only emit receipts; they never mutate balances directly.
 */
export abstract class BillingService extends Service {
  /* v8 ignore next -- concrete providers exercise construction. */
  constructor(ctx: Context) {
    super(ctx, 'billing')
  }

  /**
   * Resolve current plan limits at the same durable boundary that enforces them.
   * @param identity - server-derived tenant membership.
   * @returns the active immutable plan version and its limits.
   */
  abstract policy(identity: {
    readonly tenantId: string
    readonly userId: string
  }): Promise<BillingPolicy>

  /**
   * Estimate a bounded root run before any paid provider call.
   * @param input - attributed run and commercial limits.
   * @returns public credits and the maximum permitted variable cost.
   */
  abstract estimate(input: BillingRunInput): Promise<RunEstimate>
  /**
   * Atomically reserve credits before the first paid attempt.
   * @param input - attributed run, limits, and unique operation key.
   * @returns the active durable reservation.
   */
  abstract reserve(input: BillingRunInput & { readonly idempotencyKey: string }): Promise<CreditReservation>
  /**
   * Extend the existing reservation before a retry or sub-agent.
   * @param input - additional credits and unique operation key.
   * @returns the updated durable reservation.
   */
  abstract extend(input: ReservationExtension): Promise<CreditReservation>
  /**
   * Persist one idempotent provider attempt receipt.
   * @param receipt - provider usage for one attributed attempt.
   */
  abstract recordProviderUsage(receipt: ProviderUsageReceipt): Promise<void>
  /**
   * Persist one idempotent sandbox or paid-tool receipt.
   * @param receipt - infrastructure usage for one attributed attempt.
   */
  abstract recordInfrastructureUsage(receipt: InfrastructureUsageReceipt): Promise<void>
  /**
   * Aggregate and settle the root run, rounding credits exactly once.
   * @param runId - root run to settle.
   * @returns final debit or pending reconciliation state.
   */
  abstract settle(runId: string): Promise<RunSettlement>
  /**
   * Append a compensating entry without mutating financial history.
   * @param input - original run, amount, reason, and unique operation key.
   * @returns the compensating ledger entry.
   */
  abstract refund(input: RefundInput): Promise<LedgerEntry>
}

export default BillingService
