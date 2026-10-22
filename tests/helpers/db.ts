import type { Listing, Shop } from '../../src/shared/types'
import { type Db, type ListingInput, insertShop, openDb } from '../../src/main/db'

/** A fresh, migrated, real SQLite database in memory. */
export function memDb(): Db {
  return openDb(':memory:')
}

export const mkShop = (over: Partial<Shop> = {}): Shop => ({
  id: 20987654,
  shopName: 'CeramicStudioUA',
  title: 'Handmade ceramics',
  url: 'https://www.etsy.com/shop/CeramicStudioUA',
  iconUrl: null,
  currency: 'UAH',
  etsyActiveCount: 3,
  addedAt: 1000,
  ...over
})

export function seedShop(db: Db, over: Partial<Shop> = {}): Shop {
  const s = mkShop(over)
  insertShop(db, s)
  return s
}

export const mkInput = (id: number, over: Partial<ListingInput> = {}): ListingInput => ({
  listingId: id,
  shopId: 20987654,
  title: `Listing ${id}`,
  description: `Description ${id}`,
  priceAmount: 1000 + id,
  priceDivisor: 100,
  currency: 'UAH',
  url: `https://www.etsy.com/listing/${id}/x`,
  tags: ['a'],
  quantity: 1,
  etsyCreatedAt: 1_700_000_000 + id,
  etsyUpdatedAt: 1_700_000_000 + id,
  images: [],
  ...over
})

export const mkListing = (id: number, over: Partial<Listing> = {}): Listing => ({
  ...mkInput(id),
  images: [],
  firstSeenAt: 0,
  lastSeenAt: 0,
  removedAt: null,
  ...over
})
