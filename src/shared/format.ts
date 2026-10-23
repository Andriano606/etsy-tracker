// Display helpers shared by the renderer (and its tests).

/** Format Etsy Money (amount / divisor in `currency`) with Intl, e.g. "1 250,00 грн". */
export function formatPrice(amount: number, divisor: number, currency: string): string {
  const value = divisor > 0 ? amount / divisor : amount
  try {
    return new Intl.NumberFormat('uk-UA', { style: 'currency', currency }).format(value)
  } catch {
    // Unknown/blank currency code — fall back to a plain number + code.
    return `${value.toFixed(2)} ${currency}`.trim()
  }
}

/** Price as a comparable number (for sorting across listings). */
export function priceValue(amount: number, divisor: number): number {
  return divisor > 0 ? amount / divisor : amount
}

/** Epoch ms → "22.10.2026, 14:05". */
export function formatDateTime(ms: number | null | undefined): string {
  if (ms == null) return '—'
  return new Date(ms).toLocaleString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Etsy epoch seconds → "22.10.2026". */
export function formatEtsyDate(sec: number | null | undefined): string {
  if (sec == null) return '—'
  return new Date(sec * 1000).toLocaleDateString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

/** "5 хв тому" / "3 год тому" / "2 дн тому" relative to `now`. */
export function formatAgo(ms: number | null | undefined, now: number = Date.now()): string {
  if (ms == null) return 'ніколи'
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'щойно'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} хв тому`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} год тому`
  return `${Math.floor(h / 24)} дн тому`
}

/** Etsy API terms: listing content shown must be at most 6 hours old. */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000

export function isStale(lastScanAt: number | null | undefined, now: number = Date.now()): boolean {
  return lastScanAt == null || now - lastScanAt > STALE_AFTER_MS
}

/** 12345 → "12 345" (uk-UA grouping). */
export function formatCount(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('uk-UA')
}

/** A change vs. the previous scan: "+12", "−3", "" for 0/unknown. */
export function formatDelta(n: number | null | undefined, digits = 0): string {
  if (n == null || n === 0 || !Number.isFinite(n)) return ''
  const abs = Math.abs(n).toLocaleString('uk-UA', { maximumFractionDigits: digits })
  return n > 0 ? `+${abs}` : `−${abs}`
}
