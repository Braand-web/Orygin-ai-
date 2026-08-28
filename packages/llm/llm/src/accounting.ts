/** Exact money conversion helpers for provider usage accounting. */

/**
 * Convert a provider USD decimal into integer micro-USD at ingestion.
 * @param value - finite non-negative USD amount.
 * @returns nearest integer micro-USD.
 */
export function usdToMicros(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError('provider USD cost must be a finite non-negative number')
  }
  const micros = Math.round(value * 1_000_000)
  if (!Number.isSafeInteger(micros)) throw new RangeError('provider USD cost exceeds safe conversion range')
  return BigInt(micros)
}

/**
 * Convert one root run's aggregate variable cost into public credits, rounding once.
 * @param totalVariableCostMicros - complete attributable root-run cost.
 * @param costBudgetMicrosPerCredit - versioned cost budget for one public credit.
 * @returns the ceiling division in whole credits.
 */
export function creditsForVariableCost(
  totalVariableCostMicros: bigint,
  costBudgetMicrosPerCredit: bigint,
): bigint {
  if (totalVariableCostMicros < 0n) throw new RangeError('variable cost cannot be negative')
  if (costBudgetMicrosPerCredit <= 0n) throw new RangeError('credit cost budget must be positive')
  if (totalVariableCostMicros === 0n) return 0n
  return (totalVariableCostMicros + costBudgetMicrosPerCredit - 1n) / costBudgetMicrosPerCredit
}
