# 计费

[English](billing.md) | 中文

`@orygin-ai/dsh-billing` 定义 SaaS 部署专用的服务端商业计费能力。具体实现会估算有界的根运行，在付费工作前预留积分，记录幂等的模型供应商与基础设施回执，在所有步骤结束后只结算一次，并通过补偿式账本条目退款。

金额使用微美元整数，积分也使用整数。`TokenUsage` 继续作为供应商无关的模型计量；商业成本和钱包状态使用独立的计费记录。CLI 本地配置可以不提供该服务，而付费云配置必须在任何供应商调用前提供它。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbilling--billingservice-abstract-seam"></a>

### `ctx.billing` — `BillingService` (abstract seam)

Billing implementations own durability, idempotency, and wallet locking. Provider adapters only emit receipts; they never mutate balances directly.

```ts cordis-catalog
/**
 * Resolve current plan limits at the same durable boundary that enforces them.
 * @param identity - server-derived tenant membership.
 * @returns the active immutable plan version and its limits.
 */
abstract policy(identity: { readonly tenantId: string readonly userId: string }): Promise<BillingPolicy>

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
```

Source: [`packages/billing/billing/src/index.ts`](../../packages/billing/billing/src/index.ts)
<!-- END GENERATED cordis-surface -->
