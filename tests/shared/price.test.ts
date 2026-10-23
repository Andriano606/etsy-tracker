import { describe, expect, it } from 'vitest'
import type { BuyerPrice } from '../../src/shared/types'
import {
  buyerPriceIncludes,
  discountLabel,
  discountPercent,
  formatMoney,
  hasActiveDiscount,
  shownPrice,
  shownPriceValue
} from '../../src/shared/price'
import { formatPromoPeriod } from '../../src/shared/format'

const bp = (over: Partial<BuyerPrice> = {}): BuyerPrice => ({
  country: 'UA',
  currency: 'USD',
  base: { amount: 300, divisor: 100 },
  original: { amount: 300, divisor: 100 },
  discounted: { amount: 120, divisor: 100 },
  discountAmount: { amount: 180, divisor: 100 },
  discountPercentage: 60,
  hasDiscount: true,
  discountStart: null,
  discountEnd: null,
  shipping: null,
  isFreeShipping: null,
  ...over
})
const seller = { priceAmount: 250, priceDivisor: 100, currency: 'USD' }

describe('shownPrice — what the card shows and price sorts use', () => {
  it('a promotion: the sale price', () => {
    expect(shownPrice({ ...seller, buyerPrice: bp() })).toEqual({ amount: 120, divisor: 100, currency: 'USD', kind: 'discounted' })
    expect(shownPriceValue({ ...seller, buyerPrice: bp() })).toBe(1.2)
  })

  it('no promotion: the VAT-inclusive original price', () => {
    const none = bp({ hasDiscount: false, discounted: null, discountAmount: null, discountPercentage: null })
    expect(shownPrice({ ...seller, buyerPrice: none })).toEqual({ amount: 300, divisor: 100, currency: 'USD', kind: 'buyer' })
    // has_discount without a sale price is no promotion either.
    expect(shownPrice({ ...seller, buyerPrice: bp({ discounted: null }) }).kind).toBe('buyer')
  })

  it('no buyer price (unknown, or no original_price): the seller base price', () => {
    expect(shownPrice({ ...seller, buyerPrice: null })).toEqual({ amount: 250, divisor: 100, currency: 'USD', kind: 'base' })
    expect(shownPrice(seller).kind).toBe('base')
    expect(shownPrice({ ...seller, buyerPrice: bp({ hasDiscount: false, original: null }) }).kind).toBe('base')
  })
})

describe('discounts', () => {
  it('hasActiveDiscount needs has_discount and a sale price', () => {
    expect(hasActiveDiscount(bp())).toBe(true)
    expect(hasActiveDiscount(bp({ hasDiscount: false }))).toBe(false)
    expect(hasActiveDiscount(bp({ discounted: null }))).toBe(false)
    expect(hasActiveDiscount(null)).toBe(false)
  })

  it('discountPercent: Etsy’s percentage, else derived for a fixed-amount promotion', () => {
    expect(discountPercent(bp())).toBe(60)
    expect(discountPercent(bp({ discountPercentage: null }))).toBe(60)
    expect(discountPercent(bp({ discountPercentage: null, discountAmount: null }))).toBe(60)
    expect(discountPercent(bp({ discountPercentage: null, original: null }))).toBeNull()
    expect(discountPercent(bp({ hasDiscount: false }))).toBeNull()
    expect(discountPercent(undefined)).toBeNull()
  })

  it('discountLabel: "−60%", or the amount for a fixed-amount promotion', () => {
    expect(discountLabel(bp())).toBe('−60%')
    expect(discountLabel(bp({ discountPercentage: null }))).toBe(`−${formatMoney({ amount: 180, divisor: 100 }, 'USD')}`)
    expect(discountLabel(bp({ discountPercentage: null, discountAmount: null }))).toBe('−60%')
    expect(discountLabel(bp({ hasDiscount: false }))).toBe('')
    expect(discountLabel(null)).toBe('')
  })

  it('formatMoney: "—" for none', () => {
    expect(formatMoney(null, 'USD')).toBe('—')
    expect(formatMoney({ amount: 120, divisor: 100 }, 'USD')).toMatch(/1,20/)
  })
})

describe('formatPromoPeriod', () => {
  const now = new Date(2026, 9, 15).getTime()
  const sec = (y: number, m: number, d: number) => Math.floor(new Date(y, m, d, 12).getTime() / 1000)
  it('"з 01.10 до 31.10" in the current year, with the year otherwise', () => {
    expect(formatPromoPeriod(sec(2026, 9, 1), sec(2026, 9, 31), now)).toBe('з 01.10 до 31.10')
    expect(formatPromoPeriod(sec(2026, 11, 20), sec(2027, 0, 5), now)).toBe('з 20.12.2026 до 05.01.2027')
  })
  it('one side only, or nothing', () => {
    expect(formatPromoPeriod(null, sec(2026, 9, 31), now)).toBe('до 31.10')
    expect(formatPromoPeriod(sec(2026, 9, 1), null, now)).toBe('з 01.10')
    expect(formatPromoPeriod(null, undefined, now)).toBe('')
  })
})

describe('buyerPriceIncludes — what a buyer price adds to the base price', () => {
  it('VAT only where the country has one; UK shipping; the discount when asked', () => {
    expect(buyerPriceIncludes({ country: 'UA' })).toBe('з ПДВ (якщо він є в цій країні)')
    expect(buyerPriceIncludes({ country: 'US' }, true)).toBe('з ПДВ (якщо він є в цій країні) і знижкою')
    expect(buyerPriceIncludes({ country: 'GB' })).toBe('з ПДВ (якщо він є в цій країні) і доставкою')
    expect(buyerPriceIncludes({ country: 'GB' }, true)).toBe('з ПДВ (якщо він є в цій країні), доставкою і знижкою')
  })
})
