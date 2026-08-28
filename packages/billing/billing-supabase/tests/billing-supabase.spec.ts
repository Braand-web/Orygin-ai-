import { Context } from '@orygin-ai/cordis'
import { BillingError, type BillingRunInput } from '@orygin-ai/dsh-billing'
import { describe, expect, it } from 'vitest'
import { SupabaseBillingService } from '../src/index.ts'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '33333333-3333-4333-8333-333333333333'
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444'
const RESERVATION_ID = '55555555-5555-4555-8555-555555555555'

function runInput(overrides: Partial<BillingRunInput> = {}): BillingRunInput {
  return {
    tenantId: TENANT_ID,
    userId: USER_ID,
    rootRunId: RUN_ID,
    runId: RUN_ID,
    attemptId: ATTEMPT_ID,
    purpose: 'agent',
    billingMode: 'orygin',
    modelId: 'openai/gpt-test',
    estimatedVariableCostMicros: 40_001n,
    maximumVariableCostMicros: 100_000n,
    maximumOutputTokens: 2048,
    toolNames: [],
    costBudgetMicrosPerCredit: 20_000n,
    runLimitCredits: 50n,
    ...overrides,
  }
}

function serviceWith(
  respond: (url: URL, body: Readonly<Record<string, unknown>>) => unknown,
): { service: SupabaseBillingService; calls: Array<{ url: URL; body: Readonly<Record<string, unknown>> }> } {
  const calls: Array<{ url: URL; body: Readonly<Record<string, unknown>> }> = []
  const transport = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (typeof init?.body !== 'string') throw new Error('expected a JSON string body')
    const body = JSON.parse(init.body) as Readonly<Record<string, unknown>>
    calls.push({ url, body })
    return Response.json(respond(url, body))
  }
  return {
    service: new SupabaseBillingService(new Context(), {
      url: 'https://project.supabase.co',
      serviceRoleKey: 'server-secret',
      fetch: transport,
      now: () => new Date('2026-08-27T00:00:00.000Z'),
    }),
    calls,
  }
}

describe('SupabaseBillingService', () => {
  it('loads the active plan policy from the server boundary', async () => {
    const { service, calls } = serviceWith(() => [{
      plan_version_id: '7',
      plan_code: 'power',
      cost_budget_micros_per_credit: '20000',
      max_run_credits: '200',
      max_concurrent_runs: 5,
      entitlements: { byokOpenRouter: true },
    }])

    await expect(service.policy({ tenantId: TENANT_ID, userId: USER_ID })).resolves.toEqual({
      planVersionId: '7',
      planCode: 'power',
      costBudgetMicrosPerCredit: 20_000n,
      runLimitCredits: 200n,
      maxConcurrentRuns: 5,
      byokOpenRouter: true,
    })
    expect(calls[0]?.url.pathname).toBe('/rest/v1/rpc/billing_get_policy')
  })

  it('rounds once and reserves the maximum bounded cost', async () => {
    const { service, calls } = serviceWith(() => [{
      reservation_id: RESERVATION_ID,
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      reserved_credits: '5',
      expires_at: '2026-08-27T00:15:00.000Z',
      reservation_status: 'active',
    }])

    await expect(service.estimate(runInput())).resolves.toEqual({
      estimatedCredits: 3n,
      maximumCredits: 5n,
      estimatedVariableCostMicros: 40_001n,
      requiresConfirmation: false,
    })
    await expect(service.reserve({ ...runInput(), idempotencyKey: 'run:test' }))
      .resolves.toMatchObject({ id: RESERVATION_ID, reservedCredits: 5n })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url.pathname).toBe('/rest/v1/rpc/billing_reserve_run')
    expect(calls[0]?.body).toMatchObject({
      p_tenant_id: TENANT_ID,
      p_user_id: USER_ID,
      p_estimated_credits: 3,
      p_reserve_credits: '5',
      p_cost_budget_micros_per_credit: 20000,
      p_idempotency_key: 'run:test',
    })
  })

  it('rejects a maximum estimate beyond the plan-approved run limit before transport', async () => {
    const { service, calls } = serviceWith(() => [])
    expect(() => service.estimate(runInput({ maximumVariableCostMicros: 1_020_000n })))
      .toThrow(BillingError)
    try {
      void service.estimate(runInput({ maximumVariableCostMicros: 1_020_000n }))
    } catch (error) {
      expect(error).toMatchObject<Partial<BillingError>>({ code: 'run-spend-limit' })
    }
    expect(calls).toHaveLength(0)
  })

  it('persists a provider receipt before reporting success', async () => {
    const { service, calls } = serviceWith(() => '66666666-6666-4666-8666-666666666666')
    await service.recordProviderUsage({
      tenantId: TENANT_ID,
      userId: USER_ID,
      rootRunId: RUN_ID,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      purpose: 'agent',
      billingMode: 'orygin',
      provider: 'openrouter',
      modelId: 'openai/gpt-test',
      providerRequestId: 'generation-1',
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 4,
      reasoningTokens: 1,
      openrouterDebitMicros: 1234n,
      currency: 'USD',
    })
    expect(calls[0]?.url.pathname).toBe('/rest/v1/rpc/billing_record_provider_usage')
    expect(calls[0]?.body).toMatchObject({
      p_attempt_id: ATTEMPT_ID,
      p_openrouter_debit_micros: '1234',
      p_provider_request_id: 'generation-1',
    })
  })

  it('keeps an unresolved settlement explicit', async () => {
    const { service } = serviceWith(() => [{
      tenant_id: TENANT_ID,
      total_variable_cost_micros: '0',
      credits_charged: '0',
      credits_released: '0',
      settlement_status: 'pending_reconciliation',
    }])
    await expect(service.settle(RUN_ID)).resolves.toEqual({
      runId: RUN_ID,
      totalVariableCostMicros: 0n,
      creditsCharged: 0n,
      creditsReleased: 0n,
      status: 'pending_reconciliation',
    })
  })
})
