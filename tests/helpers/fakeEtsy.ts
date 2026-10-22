// An in-memory Etsy Open API v3 for the main-process tests: serves the same
// endpoints and response shapes as the real one (see tests/fixtures/*.json),
// over a mutable list of listings, through a fake fetch.

import listingFx from '../fixtures/listing.json'
import imageFx from '../fixtures/listingImage.json'
import shopFx from '../fixtures/shop.json'
import pingFx from '../fixtures/ping.json'
import { fakeFetch, type FakeReply } from './fakeFetch'
import {
  createEtsyClient,
  type EtsyClient,
  type EtsyClientOptions,
  type EtsyListingImage,
  type EtsyListingWithAssociations,
  type EtsyShop
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

/** A ShopListing shaped like the fixture, with its images attached (served by /batch only). */
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
    images: [mkEtsyImage(id, 2), mkEtsyImage(id, 1)],
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
}

export class FakeEtsy {
  shop: EtsyShop = { ...(shopFx as unknown as EtsyShop) }
  listings: EtsyListingWithAssociations[] = []
  /** Every request URL, in order. */
  requests: URL[] = []
  intercept: FakeEtsyOptions['intercept']
  batchUnknown: NonNullable<FakeEtsyOptions['batchUnknown']>

  readonly fetch = fakeFetch((url) => this.handle(url))

  constructor(count = 0, opts: FakeEtsyOptions = {}) {
    for (let i = 1; i <= count; i++) this.listings.push(mkEtsyListing(i))
    this.intercept = opts.intercept
    this.batchUnknown = opts.batchUnknown ?? 'skip'
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

  private strip(l: EtsyListingWithAssociations): EtsyListingWithAssociations {
    // /listings/active has no `includes` — it never returns images.
    const { images: _drop, ...rest } = l
    return rest as EtsyListingWithAssociations
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
      const withImages = (url.searchParams.get('includes') ?? '').split(',').includes('Images')
      if (this.batchUnknown === '404' && ids.some((id) => !this.listings.some((l) => l.listing_id === id))) {
        return { status: 404, body: { error: 'Could not find listings' } }
      }
      const found = this.listings
        .filter((l) => ids.includes(l.listing_id))
        .map((l) => (withImages ? l : this.strip(l)))
      return { body: { count: found.length, results: found } }
    }
    const oneM = p.match(/^\/v3\/application\/listings\/(\d+)$/)
    if (oneM) {
      const l = this.listings.find((x) => x.listing_id === Number(oneM[1]))
      if (!l) return { status: 404, body: { error: 'Listing not found' } }
      const withImages = (url.searchParams.get('includes') ?? '').split(',').includes('Images')
      return { body: withImages ? l : this.strip(l) }
    }
    return { status: 404, body: { error: `no route ${p}` } }
  }
}
