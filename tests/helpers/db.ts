import type { Listing, ListingDetails, Shop } from '../../src/shared/types'
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
  state: 'active',
  views: null,
  numFavorers: null,
  featuredRank: null,
  details: mkDetails(),
  detailsFetched: true,
  ...over
})

/** Every ListingDetails field empty — a listing read with schema v2. */
export const mkDetails = (over: Partial<ListingDetails> = {}): ListingDetails => ({
  userId: null,
  shopSectionId: null,
  taxonomyId: null,
  listingType: 'physical',
  whoMade: 'i_did',
  whenMade: 'made_to_order',
  isSupply: false,
  materials: [],
  styles: [],
  skus: [],
  processingMin: null,
  processingMax: null,
  isCustomizable: false,
  isPersonalizable: false,
  personalization: null,
  hasVariations: false,
  isPrivate: false,
  isTaxable: true,
  nonTaxable: false,
  shouldAutoRenew: true,
  fileData: null,
  language: 'en-US',
  shippingProfileId: null,
  returnPolicyId: null,
  readinessStateId: null,
  itemWeight: null,
  itemWeightUnit: null,
  itemLength: null,
  itemWidth: null,
  itemHeight: null,
  itemDimensionsUnit: null,
  originalCreatedAt: null,
  endingAt: null,
  stateAt: null,
  ...over
})

export const mkListing = (id: number, over: Partial<Listing> = {}): Listing => ({
  ...mkInput(id),
  images: [],
  videos: [],
  firstSeenAt: 0,
  lastSeenAt: 0,
  removedAt: null,
  ...over
})
