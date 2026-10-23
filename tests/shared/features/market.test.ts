import { describe, expect, it } from 'vitest'
import { MARKET_SORTS, MARKET_SORT_KEYS, marketPriceStats, type MarketListing } from '../../../src/shared/features/market'

const mk = (id: number, amount: number | null, currency: string | null, divisor: number | null = 100): MarketListing => ({
  listingId: id,
  shopId: 1,
  title: `L${id}`,
  priceAmount: amount,
  priceDivisor: divisor,
  currency,
  url: null,
  tags: [],
  numFavorers: null,
  views: null,
  createdAt: null,
  imageUrl: null
})

describe('market shared', () => {
  it('every sort maps onto the OAS enums of findAllListingsActive', () => {
    expect(MARKET_SORT_KEYS).toEqual(['relevance', 'newest', 'oldest', 'price_low', 'price_high', 'updated'])
    for (const k of MARKET_SORT_KEYS) {
      expect(['created', 'price', 'updated', 'score']).toContain(MARKET_SORTS[k].sortOn)
      expect(['asc', 'desc']).toContain(MARKET_SORTS[k].sortOrder)
    }
    // score is always descending on Etsy's side
    expect(MARKET_SORTS.relevance).toMatchObject({ sortOn: 'score', sortOrder: 'desc' })
  })

  it('price stats per currency: min / median / max; most results first; unknown prices skipped', () => {
    const stats = marketPriceStats([
      mk(1, 500, 'USD'),
      mk(2, 100, 'USD'),
      mk(3, 300, 'USD'),
      mk(4, 1000, 'USD'),
      mk(5, 2000, 'EUR'),
      mk(6, null, 'USD'),
      mk(7, 100, null),
      mk(8, 100, 'USD', 0)
    ])
    expect(stats).toEqual([
      { currency: 'USD', count: 4, min: 1, median: 4, max: 10 },
      { currency: 'EUR', count: 1, min: 20, median: 20, max: 20 }
    ])
    expect(marketPriceStats([mk(1, 100, 'USD'), mk(2, 300, 'USD'), mk(3, 200, 'USD')])[0].median).toBe(2)
    expect(marketPriceStats([])).toEqual([])
  })

  it('equal counts are ordered by currency code', () => {
    expect(marketPriceStats([mk(1, 100, 'USD'), mk(2, 100, 'EUR')]).map((s) => s.currency)).toEqual(['EUR', 'USD'])
  })
})
