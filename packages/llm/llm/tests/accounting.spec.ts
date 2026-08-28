import { describe, expect, it } from 'vitest'
import { creditsForVariableCost, usdToMicros } from '@orygin-ai/dsh-llm'

describe('LLM accounting money boundary', () => {
  it('converts provider dollars into integer micro-USD', () => {
    expect(usdToMicros(0)).toBe(0n)
    expect(usdToMicros(0.035)).toBe(35_000n)
    expect(usdToMicros(1.2345674)).toBe(1_234_567n)
    expect(() => usdToMicros(-0.01)).toThrow(/non-negative/)
    expect(() => usdToMicros(Number.NaN)).toThrow(/finite/)
  })

  it('rounds aggregate root-run cost exactly once', () => {
    expect(creditsForVariableCost(0n, 20_000n)).toBe(0n)
    expect(creditsForVariableCost(1n, 20_000n)).toBe(1n)
    expect(creditsForVariableCost(20_000n, 20_000n)).toBe(1n)
    expect(creditsForVariableCost(20_001n, 20_000n)).toBe(2n)
    expect(creditsForVariableCost(700_000n, 20_000n)).toBe(35n)
  })

  it('rejects invalid integer budgets', () => {
    expect(() => creditsForVariableCost(-1n, 20_000n)).toThrow(/negative/)
    expect(() => creditsForVariableCost(1n, 0n)).toThrow(/positive/)
  })
})
