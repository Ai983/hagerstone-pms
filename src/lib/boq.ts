import type { MarginMode } from './types'

// ─── Margin calculation ───────────────────────────────────────────────────────

export function applyMargin(params: {
  internalPrice: number
  mode: MarginMode
  value: number
}): number {
  const { internalPrice, mode, value } = params
  switch (mode) {
    case 'flat_pct':
    case 'per_line_pct':
      return internalPrice * (1 + value / 100)
    case 'per_line_abs':
      return value
    default:
      return internalPrice
  }
}

export function computeBOQTotal(
  lines: Array<{ quantity: number | null; unit_price: number | null }>
): number {
  return lines.reduce((sum, line) => {
    const qty = line.quantity ?? 0
    const price = line.unit_price ?? 0
    return sum + qty * price
  }, 0)
}

export function formatCurrency(amount: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}
