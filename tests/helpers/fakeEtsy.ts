// An in-memory Etsy Open API v3 for the main-process tests: serves the same
// endpoints and response shapes as the real one (see tests/fixtures/*.json),
// over a mutable list of listings, through a fake fetch.

import listingFx from '../fixtures/listing.json'
import imageFx from '../fixtures/listingImage.json'
import shopFx from '../fixtures/shop.json'
import pingFx from '../fixtures/ping.json'
import reviewFx from '../fixtures/transactionReview.json'
import { fakeFetch, type FakeReply } from './fakeFetch'
import {
  createEtsyClient,
  type EtsyClient,
  type EtsyClientOptions,
  type EtsyListingImage,
  type EtsyListingWithAssociations,
  type EtsyShop,
  type EtsyTransactionReview
} from '../../src/main/etsyApi'

export const SHOP_ID = shopFx.shop_id
export const SHOP_NAME = shopFx.shop_name

export function mkEtsyImage(
  listingId: number,
  rank: number,
  over: Partial<EtsyListingImage> = {}
): EtsyListingImage {
  const id = listingId * 10 + rank
  return {
    ...imageFx,
    listing_id: listingId,
    listing_image_id: id,
    rank,
    url_75x75: `https://i.etsystatic.com/1/il_75x75.${id}.jpg`,
    url_170x135: `https://i.etsystatic.com/1/il_170x135.${id}.jpg`,
    url_570xN: `https://i.etsystatic.com/1/il_570xN.${id}.jpg`,
    url_fullxfull: `https://i.etsystatic.com/1/il_fullxfull.${id}.jpg`,
    ...over
  }
}

/**
 * Keys of ShopListingWithAssociations that the /listings/active page items do
 * not have. Verified live (2026-10): pages DO carry `views`, `skus` and
 * `production_partners` (with the same values as /listings/batch), only the
 * associations are missing.
 */
export const ASSOCIATION_KEYS = [
  'shipping_profile',
  'user',
  'shop',
  'images',
  'videos',
  'inventory',
  'translations',
  'personalization',
  'buyer_price'
] as const

/** includes value → the key it attaches. */
const INCLUDE_KEY: Record<string, string> = {
  Images: 'images',
  Videos: 'videos',
  Personalization: 'personalization',
  Shop: 'shop',
  User: 'user',
  Translations: 'translations',
  BuyerPrice: 'buyer_price'
}

/**
 * A ShopListingWithAssociations shaped like the fixture: two images (served
 * with includes=Images), no videos, no personalization, views/favorers derived
 * from the id. Pages strip every association key.
 */
export function mkEtsyListing(
  id: number,
  over: Partial<EtsyListingWithAssociations> = {}
): EtsyListingWithAssociations {
  return {
    ...(listingFx as unknown as EtsyListingWithAssociations),
    listing_id: id,
    shop_id: SHOP_ID,
    title: `Listing ${id}`,
    description: `Description of ${id}`,
    url: `https://www.etsy.com/listing/${id}/item`,
    created_timestamp: 1_700_000_000 + id,
    creation_timestamp: 1_700_000_000 + id,
    updated_timestamp: 1_700_000_000 + id,
    last_modified_timestamp: 1_700_000_000 + id,
    price: { amount: 1000 + id, divisor: 100, currency_code: 'UAH' },
    num_favorers: 10 + id,
    featured_rank: -1,
    images: [mkEtsyImage(id, 2), mkEtsyImage(id, 1)],
    videos: [],
    personalization: null,
    skus: [],
    views: 100 + id,
    ...over
  }
}

/** Created time of review `n` (1-based; one day apart, newest = highest n). */
export const reviewCreated = (n: number): number => 1_700_000_000 + n * 86_400

/**
 * A TransactionReview shaped like the fixture (every OAS field): transaction
 * 5000+n, listing `listingId` (default 1 + n % 3), rating 1–5 cycling, no photo
 * unless `over` gives one.
 */
export function mkEtsyReview(n: number, over: Partial<EtsyTransactionReview> = {}): EtsyTransactionReview {
  const created = reviewCreated(n)
  return {
    ...(reviewFx as unknown as EtsyTransactionReview),
    shop_id: SHOP_ID,
    listing_id: 1 + (n % 3),
    transaction_id: 5000 + n,
    buyer_user_id: 7000 + n,
    rating: 1 + (n % 5),
    review: `Review number ${n}`,
    image_url_fullxfull: null,
    create_timestamp: created,
    created_timestamp: created,
    update_timestamp: created,
    updated_timestamp: created,
    ...over
  }
}

export interface FakeEtsyOptions {
  /** Return a reply to override the normal answer for this request (nth = 1-based). */
  intercept?: (url: URL, nth: number) => FakeReply | null | undefined
  /**
   * How /listings/batch treats ids it does not know (deleted listings):
   * 'skip' leaves them out (the optimistic reading), '404' fails the whole
   * batch with 404 — the spec documents a 404 for this endpoint.
   */
  batchUnknown?: 'skip' | '404'
  /** includes values answered with 403 (an association an API-key-only app may not read). */
  refuseIncludes?: string[]
}

/**
 * Order of /shops/{id}/reviews results. The OAS documents none; 'desc'
 * (newest first) is the likely live one, 'asc'/'shuffle' prove the sync does
 * not depend on it ('shuffle' = a fixed pseudo-random order, not by date).
 * 'unstable' = newest first, but reviews of the same second come in a
 * different order on every request (a sort by created time alone).
 */
export type ReviewOrder = 'desc' | 'asc' | 'shuffle' | 'unstable'

export class FakeEtsy {
  shop: EtsyShop = { ...(shopFx as unknown as EtsyShop) }
  listings: EtsyListingWithAssociations[] = []
  /** Every request URL, in order. */
  requests: URL[] = []
  intercept: FakeEtsyOptions['intercept']
  batchUnknown: NonNullable<FakeEtsyOptions['batchUnknown']>
  refuseIncludes: string[]
  /** The shop's reviews (GET /shops/{id}/reviews). */
  reviews: EtsyTransactionReview[] = []
  reviewOrder: ReviewOrder = 'desc'
  /** Answer every reviews request with this HTTP status (e.g. 403, 404). */
  reviewsStatus: number | null = null

  readonly fetch = fakeFetch((url) => this.handle(url))

  constructor(count = 0, opts: FakeEtsyOptions = {}) {
    for (let i = 1; i <= count; i++) this.listings.push(mkEtsyListing(i))
    this.intercept = opts.intercept
    this.batchUnknown = opts.batchUnknown ?? 'skip'
    this.refuseIncludes = opts.refuseIncludes ?? []
  }

  client(over: Partial<EtsyClientOptions> = {}): EtsyClient {
    return createEtsyClient({
      getApiKey: () => 'keystring:secret',
      fetch: this.fetch,
      sleep: async () => {},
      random: () => 0,
      minIntervalMs: 0,
      ...over
    })
  }

  count(path: string): number {
    return this.requests.filter((u) => u.pathname === path).length
  }

  private active(): EtsyListingWithAssociations[] {
    return this.listings.filter((l) => l.state === 'active')
  }

  /** As a ShopListing: /listings/active has no `includes` and no `views`. */
  private strip(l: EtsyListingWithAssociations): EtsyListingWithAssociations {
    const out: Record<string, unknown> = { ...l }
    for (const k of ASSOCIATION_KEYS) delete out[k]
    return out as EtsyListingWithAssociations
  }

  /** As a ShopListingWithAssociations with only the requested associations attached. */
  private withIncludes(l: EtsyListingWithAssociations, includes: string[]): EtsyListingWithAssociations {
    const out: Record<string, unknown> = { ...l }
    for (const [inc, key] of Object.entries(INCLUDE_KEY)) {
      if (!includes.includes(inc)) delete out[key]
    }
    return out as EtsyListingWithAssociations
  }

  private refused(url: URL): FakeReply | null {
    const inc = (url.searchParams.get('includes') ?? '').split(',').filter(Boolean)
    return inc.some((i) => this.refuseIncludes.includes(i))
      ? { status: 403, body: { error: 'This include requires OAuth' } }
      : null
  }

  private handle(url: URL): FakeReply {
    this.requests.push(url)
    const hijack = this.intercept?.(url, this.requests.length)
    if (hijack) return hijack

    const p = url.pathname
    if (p === '/v3/application/openapi-ping') return { body: pingFx }
    if (p === '/v3/application/shops') {
      const name = url.searchParams.get('shop_name') ?? ''
      const hit = this.shop.shop_name.toLowerCase().includes(name.toLowerCase())
      return { body: { count: hit ? 1 : 0, results: hit ? [this.shop] : [] } }
    }
    const revM = p.match(/^\/v3\/application\/shops\/(\d+)\/reviews$/)
    if (revM) return this.reviewsPage(Number(revM[1]), url)
    const shopM = p.match(/^\/v3\/application\/shops\/(\d+)(\/listings\/active)?$/)
    if (shopM) {
      if (Number(shopM[1]) !== this.shop.shop_id) {
        return { status: 404, body: { error: 'Shop not found' } }
      }
      if (!shopM[2]) return { body: { ...this.shop, listing_active_count: this.active().length } }
      const limit = Number(url.searchParams.get('limit') ?? 25)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      if (limit > 100 || offset > 12000) return { status: 400, body: { error: 'bad paging' } }
      const all = this.active()
      return {
        body: { count: all.length, results: all.slice(offset, offset + limit).map((l) => this.strip(l)) }
      }
    }
    if (p === '/v3/application/listings/batch') {
      const ids = (url.searchParams.get('listing_ids') ?? '').split(',').filter(Boolean).map(Number)
      if (ids.length > 100) return { status: 400, body: { error: 'Limit 100 ids maximum per query' } }
      const includes = (url.searchParams.get('includes') ?? '').split(',').filter(Boolean)
      const refused = this.refused(url)
      if (refused) return refused
      if (this.batchUnknown === '404' && ids.some((id) => !this.listings.some((l) => l.listing_id === id))) {
        return { status: 404, body: { error: 'Could not find listings' } }
      }
      const found = this.listings
        .filter((l) => ids.includes(l.listing_id))
        .map((l) => this.withIncludes(l, includes))
      return { body: { count: found.length, results: found } }
    }
    const oneM = p.match(/^\/v3\/application\/listings\/(\d+)$/)
    if (oneM) {
      const l = this.listings.find((x) => x.listing_id === Number(oneM[1]))
      if (!l) return { status: 404, body: { error: 'Listing not found' } }
      const refused = this.refused(url)
      if (refused) return refused
      const includes = (url.searchParams.get('includes') ?? '').split(',').filter(Boolean)
      return { body: this.withIncludes(l, includes) }
    }
    return { status: 404, body: { error: `no route ${p}` } }
  }

  /** getReviewsByShop: limit ≤ 100, offset ≤ 12000, inclusive min/max_created, `count` = matches. */
  private reviewsPage(shopId: number, url: URL): FakeReply {
    if (this.reviewsStatus) return { status: this.reviewsStatus, body: { error: 'Reviews unavailable' } }
    if (shopId !== this.shop.shop_id) return { status: 404, body: { error: 'Shop not found' } }
    const limit = Number(url.searchParams.get('limit') ?? 25)
    const offset = Number(url.searchParams.get('offset') ?? 0)
    if (limit > 100 || limit < 1 || offset > 12000) return { status: 400, body: { error: 'bad paging' } }
    const min = url.searchParams.get('min_created')
    const max = url.searchParams.get('max_created')
    for (const v of [min, max]) {
      if (v != null && Number(v) < 946684800) return { status: 400, body: { error: 'min_created below minimum' } }
    }
    const created = (r: EtsyTransactionReview): number => Number(r.created_timestamp ?? r.create_timestamp)
    const all = this.reviews.filter(
      (r) => (min == null || created(r) >= Number(min)) && (max == null || created(r) <= Number(max))
    )
    if (this.reviewOrder === 'unstable') {
      const salt = this.requests.length * 31
      const tie = (r: EtsyTransactionReview): number => (Number(r.transaction_id) * 7919 + salt) % 97
      all.sort((a, b) => created(b) - created(a) || tie(a) - tie(b))
    } else if (this.reviewOrder === 'shuffle') {
      // Pseudo-random but stable (the same for every offset), not by date.
      all.sort((a, b) => ((Number(a.transaction_id) * 7919) % 101) - ((Number(b.transaction_id) * 7919) % 101) || created(a) - created(b))
    } else {
      all.sort((a, b) => (this.reviewOrder === 'asc' ? 1 : -1) * (created(a) - created(b)) || Number(a.transaction_id) - Number(b.transaction_id))
    }
    return { body: { count: all.length, results: all.slice(offset, offset + limit) } }
  }
}
