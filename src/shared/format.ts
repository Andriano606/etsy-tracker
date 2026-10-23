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

/** An average rating: 4.8666 → "4,87"; "—" when unknown. */
export function formatRating(avg: number | null | undefined): string {
  if (avg == null || !Number.isFinite(avg)) return '—'
  return avg.toLocaleString('uk-UA', { maximumFractionDigits: 2 })
}

/** A 1–5 rating as stars: 4 → "★★★★☆"; '' when unknown. */
export function ratingStars(rating: number | null | undefined): string {
  if (rating == null || !Number.isFinite(rating)) return ''
  const n = Math.max(0, Math.min(5, Math.round(rating)))
  return '★'.repeat(n) + '☆'.repeat(5 - n)
}

/** A review count, "≥ 12" while the shop's history is still being loaded. */
export function formatReviewCount(n: number | null | undefined, partial: boolean | null | undefined): string {
  if (n == null) return '—'
  return partial ? `≥ ${formatCount(n)}` : formatCount(n)
}

/** First `max` characters of a text, cut at a word boundary when possible, with "…". */
export function textExcerpt(text: string | null | undefined, max = 280): string {
  const t = (text ?? '').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`
}

/**
 * A promotion's Etsy period: "з 01.10 до 31.10" (the year is added when
 * either end is not in the current year); '' when Etsy gave neither epoch.
 */
export function formatPromoPeriod(
  startSec: number | null | undefined,
  endSec: number | null | undefined,
  now: number = Date.now()
): string {
  const year = new Date(now).getFullYear()
  const otherYear = [startSec, endSec].some((s) => s != null && new Date(s * 1000).getFullYear() !== year)
  const day = (sec: number): string =>
    new Date(sec * 1000).toLocaleDateString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      ...(otherYear ? { year: 'numeric' } : {})
    })
  const parts: string[] = []
  if (startSec != null) parts.push(`з ${day(startSec)}`)
  if (endSec != null) parts.push(`до ${day(endSec)}`)
  return parts.join(' ')
}
