import { describe, expect, it } from 'vitest'
import { filterListings } from '../../src/shared/listingFilter'
import * as helpers from '../renderer/helpers'
import { mkListing } from '../renderer/helpers'

const ls = [
  mkListing(1, { title: 'Blue Mug', priceAmount: 3000, etsyCreatedAt: 10 }),
  mkListing(2, { title: 'Plate', tags: ['Kitchen'], priceAmount: 100, priceDivisor: 10, etsyCreatedAt: 30 }),
  mkListing(3, { title: 'Bowl', priceAmount: 2000, etsyCreatedAt: 20 })
]
const ids = (x: { listingId: number }[]) => x.map((l) => l.listingId)

describe('filterListings', () => {
  it('sorts newest by Etsy creation time', () => {
    expect(ids(filterListings(ls, '', 'newest'))).toEqual([2, 3, 1])
  })
  it('sorts by price value across divisors', () => {
    expect(ids(filterListings(ls, '', 'price-asc'))).toEqual([2, 3, 1])
    expect(ids(filterListings(ls, '', 'price-desc'))).toEqual([1, 3, 2])
  })
  it('searches title and tags case-insensitively', () => {
    expect(ids(filterListings(ls, 'mug', 'newest'))).toEqual([1])
    expect(ids(filterListings(ls, 'kitch', 'newest'))).toEqual([2])
    expect(ids(filterListings(ls, '  ', 'newest'))).toHaveLength(3)
  })
  it('searches descriptions only when asked (the MCP product search)', () => {
    expect(ids(filterListings(ls, 'description 3', 'newest'))).toEqual([])
    expect(ids(filterListings(ls, 'DESCRIPTION 3', 'newest', { searchDescription: true }))).toEqual([3])
  })
  it('does not mutate the input', () => {
    const copy = [...ls]
    filterListings(ls, '', 'price-asc')
    expect(ls).toEqual(copy)
  })
})

describe('popularity sorts', () => {
  const pop = [
    mkListing(1, { numFavorers: 5, views: 900, favorersDelta: 0 }),
    mkListing(2, { numFavorers: 50, views: 100, favorersDelta: 3 }),
    mkListing(3, { numFavorers: null, views: null, favorersDelta: null }),
    mkListing(4, { numFavorers: 20, views: 500, favorersDelta: 12 })
  ]
  it('Найпопулярніші (обране): most favorited first, unknown last', () => {
    expect(ids(filterListings(pop, '', 'favorites'))).toEqual([2, 4, 1, 3])
  })
  it('Перегляди: most viewed first', () => {
    expect(ids(filterListings(pop, '', 'views'))).toEqual([1, 4, 2, 3])
  })
  it('Ріст обраного: biggest growth since the previous scan first', () => {
    expect(ids(filterListings(pop, '', 'favorites-growth'))).toEqual([4, 2, 1, 3])
  })
})

describe('review sorts', () => {
  const rv = [
    mkListing(1, { reviewCount: 3, reviewsNew: 0 }),
    mkListing(2, { reviewCount: 120, reviewsNew: 2 }),
    mkListing(3, { reviewCount: null, reviewsNew: null }),
    mkListing(4, { reviewCount: 40, reviewsNew: 7 })
  ]
  it('Найбільше відгуків: most reviews first, never-synced last', () => {
    expect(ids(filterListings(rv, '', 'reviews'))).toEqual([2, 4, 1, 3])
  })
  it('Ріст відгуків: most new reviews since the previous scan first', () => {
    expect(ids(filterListings(rv, '', 'reviews-growth'))).toEqual([4, 2, 1, 3])
  })
})

describe('filterListings: buyer prices and discounts', () => {
  const { mkBuyerPrice } = helpers
  // #1: seller 30.00, but 20.00 for the buyer with a 60 % sale (shown: sale price)
  // #2: seller 10.00, no buyer price (shown: base 10.00)
  // #3: seller 20.00, 24.00 with VAT, no sale (shown: 24.00)
  // #4: seller 50.00, 25 % sale → 45.00
  const bl = [
    mkListing(1, {
      priceAmount: 3000,
      buyerPrice: mkBuyerPrice({
        original: { amount: 3600, divisor: 100 },
        discounted: { amount: 1440, divisor: 100 },
        discountPercentage: 60
      })
    }),
    mkListing(2, { priceAmount: 1000 }),
    mkListing(3, { priceAmount: 2000, buyerPrice: mkBuyerPrice({ discount: false, original: { amount: 2400, divisor: 100 } }) }),
    mkListing(4, {
      priceAmount: 5000,
      buyerPrice: mkBuyerPrice({
        original: { amount: 6000, divisor: 100 },
        discounted: { amount: 4500, divisor: 100 },
        discountPercentage: 25
      })
    })
  ]

  it('price sorts use the price the card shows (sale > VAT-inclusive > base)', () => {
    expect(ids(filterListings(bl, '', 'price-asc'))).toEqual([2, 1, 3, 4])
    expect(ids(filterListings(bl, '', 'price-desc'))).toEqual([4, 3, 1, 2])
  })

  it('"Найбільша знижка": biggest discount first, no discount / unknown last', () => {
    expect(ids(filterListings(bl, '', 'discount'))).toEqual([1, 4, 3, 2])
  })

  it('a fixed-amount discount sorts by its derived percentage', () => {
    const fixed = mkListing(9, {
      buyerPrice: mkBuyerPrice({
        discountPercentage: null,
        original: { amount: 1000, divisor: 100 },
        discounted: { amount: 500, divisor: 100 },
        discountAmount: { amount: 500, divisor: 100 }
      })
    })
    expect(ids(filterListings([...bl, fixed], '', 'discount'))).toEqual([1, 9, 4, 3, 2])
  })

  it('"Зі знижкою" keeps only listings with an active discount, combined with search', () => {
    expect(ids(filterListings(bl, '', 'newest', { discountOnly: true })).sort()).toEqual([1, 4])
    expect(ids(filterListings(bl, 'Listing 4', 'newest', { discountOnly: true }))).toEqual([4])
    expect(ids(filterListings(bl, '', 'newest', { discountOnly: false }))).toHaveLength(4)
  })
})
