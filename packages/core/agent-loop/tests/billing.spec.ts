import { describe, expect, it } from 'vitest'
import { Context } from '@orygin-ai/cordis'
import AgentRegistry, { type Agent } from '@orygin-ai/dsh-agent'
import BillingService from '@orygin-ai/dsh-billing'
import type {
  BillingPolicy,
  BillingRunInput,
  CreditReservation,
  InfrastructureUsageReceipt,
  LedgerEntry,
  RefundInput,
  ReservationExtension,
  RunEstimate,
  RunSettlement,
} from '@orygin-ai/dsh-billing'
import LlmRuntime, { createUserMessage, type ProviderUsageReceipt } from '@orygin-ai/dsh-llm'
import SessionStore, { SessionId } from '@orygin-ai/dsh-session'
import SystemPrompt from '@orygin-ai/dsh-system-prompt'
import ToolRuntime from '@orygin-ai/dsh-tools'
import AgentLoop from '@orygin-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from './mock-adapter.ts'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const SESSION_ID = SessionId('33333333-3333-4333-8333-333333333333')

class BillingProbe extends BillingService {
  readonly operations: string[] = []
  reserveInput?: BillingRunInput & { readonly idempotencyKey: string }
  settledRunId?: string

  policy(): Promise<BillingPolicy> {
    this.operations.push('policy')
    return Promise.resolve({
      planVersionId: '44444444-4444-4444-8444-444444444444',
      planCode: 'pro',
      costBudgetMicrosPerCredit: 20_000n,
      runLimitCredits: 50n,
      maxConcurrentRuns: 2,
      byokOpenRouter: false,
    })
  }

  estimate(): Promise<RunEstimate> {
    throw new Error('agent loop delegates estimates to reserve')
  }

  reserve(input: BillingRunInput & { readonly idempotencyKey: string }): Promise<CreditReservation> {
    this.operations.push('reserve')
    this.reserveInput = input
    return Promise.resolve({
      id: '55555555-5555-4555-8555-555555555555',
      tenantId: input.tenantId,
      runId: input.runId,
      reservedCredits: input.runLimitCredits,
      expiresAt: '2026-08-28T12:00:00.000Z',
      status: 'active',
    })
  }

  extend(_input: ReservationExtension): Promise<CreditReservation> {
    throw new Error('unused')
  }

  recordProviderUsage(_receipt: ProviderUsageReceipt): Promise<void> {
    return Promise.resolve()
  }

  recordInfrastructureUsage(_receipt: InfrastructureUsageReceipt): Promise<void> {
    return Promise.resolve()
  }

  settle(runId: string): Promise<RunSettlement> {
    this.operations.push('settle')
    this.settledRunId = runId
    return Promise.resolve({
      runId,
      totalVariableCostMicros: 12_000n,
      creditsCharged: 1n,
      creditsReleased: 49n,
      status: 'settled',
    })
  }

  refund(_input: RefundInput): Promise<LedgerEntry> {
    throw new Error('unused')
  }
}

async function setup(): Promise<{ ctx: Context; adapter: MockAdapter; billing: BillingProbe }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter([textResponse('paid response')])
  ctx.llm.registerAdapter(['mock'], adapter)
  const billing = new BillingProbe(ctx)
  return { ctx, adapter, billing }
}

function send(agent: Agent): void {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'run paid task' }],
    source: { kind: 'user' },
  }))
}

describe('agent-loop billing boundary', () => {
  it('reserves before the model call, attributes the attempt, and settles once', async () => {
    const { ctx, adapter, billing } = await setup()
    const agent = ctx.agentLoop.create(SESSION_ID, {
      provider: 'mock',
      model: 'mock-model',
      billingIdentity: { tenantId: TENANT_ID, userId: USER_ID, billingMode: 'orygin' },
    })

    send(agent)
    await agent.whenIdle()

    expect(billing.operations).toEqual(['policy', 'reserve', 'settle'])
    expect(adapter.requests).toHaveLength(1)
    const accounting = adapter.requests[0]?.accounting
    expect(accounting).toMatchObject({
      tenantId: TENANT_ID,
      userId: USER_ID,
      sessionId: SESSION_ID,
      purpose: 'agent',
      billingMode: 'orygin',
    })
    expect(accounting?.rootRunId).toMatch(/^[0-9a-f-]{36}$/)
    expect(accounting?.runId).toMatch(/^[0-9a-f-]{36}$/)
    expect(accounting?.attemptId).toMatch(/^[0-9a-f-]{36}$/)
    expect(accounting?.runId).not.toBe(accounting?.rootRunId)
    expect(billing.reserveInput).toMatchObject({
      tenantId: TENANT_ID,
      userId: USER_ID,
      runId: accounting?.rootRunId,
      rootRunId: accounting?.rootRunId,
      modelId: 'mock-model',
      estimatedVariableCostMicros: 20_000n,
      maximumVariableCostMicros: 1_000_000n,
      runLimitCredits: 50n,
    })
    expect(billing.settledRunId).toBe(accounting?.rootRunId)
  })
})
