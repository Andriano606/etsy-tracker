import { describe, expect, it } from 'vitest'
import {
  STALE_AFTER_MS,
  formatAgo,
  formatCount,
  formatDelta,
  formatPrice,
  isStale,
  priceValue
} from '../../src/shared/format'

describe('formatPrice', () => {
  it('formats amount/divisor with the currency', () => {
    const s = formatPrice(125000, 100, 'UAH')
    expect(s.replace(/\s/g, ' ')).toMatch(/1 250,00/)
    expect(s).toMatch(/грн|UAH|₴/)
  })
  it('handles other divisors', () => {
    expect(formatPrice(1999, 1000, 'USD')).toMatch(/2,00|1,99/)
  })
  it('falls back for an invalid currency code', () => {
    expect(formatPrice(500, 100, '??')).toBe('5.00 ??')
  })
})

describe('priceValue', () => {
  it('divides', () => expect(priceValue(1250, 100)).toBe(12.5))
  it('survives a zero divisor', () => expect(priceValue(7, 0)).toBe(7))
})

describe('formatAgo / isStale', () => {
  const now = 1_000_000_000_000
  it('formats relative times', () => {
    expect(formatAgo(null, now)).toBe('ніколи')
    expect(formatAgo(now - 10_000, now)).toBe('щойно')
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5 хв тому')
    expect(formatAgo(now - 3 * 3600_000, now)).toBe('3 год тому')
    expect(formatAgo(now - 49 * 3600_000, now)).toBe('2 дн тому')
  })
  it('marks data older than 6 hours stale (Etsy API terms)', () => {
    expect(isStale(null, now)).toBe(true)
    expect(isStale(now - STALE_AFTER_MS + 1000, now)).toBe(false)
    expect(isStale(now - STALE_AFTER_MS - 1000, now)).toBe(true)
  })
})

describe('formatCount / formatDelta', () => {
  it('groups thousands; unknown is a dash', () => {
    expect(formatCount(12345).replace(/\s/g, ' ')).toBe('12 345')
    expect(formatCount(null)).toBe('—')
  })
  it('signs the delta; 0 and unknown render nothing', () => {
    expect(formatDelta(12)).toBe('+12')
    expect(formatDelta(-3)).toBe('−3')
    expect(formatDelta(-0.05, 2)).toBe('−0,05')
    expect(formatDelta(0)).toBe('')
    expect(formatDelta(null)).toBe('')
  })
})
