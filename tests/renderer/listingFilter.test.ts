import { describe, expect, it } from 'vitest'
import { filterListings } from '../../src/renderer/src/listingFilter'
import { mkListing } from './helpers'

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
  it('does not mutate the input', () => {
    const copy = [...ls]
    filterListings(ls, '', 'price-asc')
    expect(ls).toEqual(copy)
  })
})
