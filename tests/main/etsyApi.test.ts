import { describe, expect, it, vi } from 'vitest'
import {
  BATCH_LIMIT,
  FIND_SHOP_MAX_PAGES,
  EtsyApiError,
  REVIEW_EPOCH_MIN,
  buildUrl,
  createEtsyClient,
  formBody,
  parseQuota,
  parseRetryAfter
} from '../../src/main/etsyApi'
import findShopsFx from '../fixtures/findShops.json'
import error403 from '../fixtures/error-403.json'
import { fakeFetch, queuedFetch, type FakeReply } from '../helpers/fakeFetch'
import { FakeEtsy, SHOP_ID, mkEtsyListing, mkEtsyReview, reviewCreated } from '../helpers/fakeEtsy'

function client(fetch: typeof globalThis.fetch, over = {}) {
  const sleep = vi.fn(async (_ms: number) => {})
  const c = createEtsyClient({
    getApiKey: () => 'mykeystring:mysecret',
    fetch,
    sleep,
    random: () => 0,
    minIntervalMs: 0,
    ...over
  })
  return { c, sleep }
}

const range = (a: number, b: number): number[] =>
  Array.from({ length: b - a + 1 }, (_, i) => a + i)

async function err(p: Promise<unknown>): Promise<EtsyApiError> {
  try {
    await p
  } catch (e) {
    return e as EtsyApiError
  }
  throw new Error('expected a rejection')
}

describe('request basics', () => {
  it('sends x-api-key as keystring:shared_secret to openapi.etsy.com', async () => {
    const f = queuedFetch([{ body: { application_id: 7 } }])
    const { c } = client(f)
    expect(await c.ping()).toEqual({ application_id: 7 })
    const call = f.calls[0]
    expect(call.url.toString()).toBe('https://openapi.etsy.com/v3/application/openapi-ping')
    expect(call.headers['x-api-key']).toBe('mykeystring:mysecret')
  })

  it('ping can use an explicit unsaved key', async () => {
    const f = queuedFetch([{ body: { application_id: 7 } }])
    const { c } = client(f)
    await c.ping('other:key')
    expect(f.calls[0].headers['x-api-key']).toBe('other:key')
  })

  it('fails with no_key without any request when the key is missing', async () => {
    const f = queuedFetch([{ body: {} }])
    const { c } = client(f, { getApiKey: () => null })
    const e = await err(c.ping())
    expect(e.kind).toBe('no_key')
    expect(e.message).toMatch(/Налаштування/)
    expect(f.calls).toHaveLength(0)
  })

  it('joins array params with commas, no brackets', () => {
    expect(buildUrl('https://openapi.etsy.com', '/v3/application/listings/batch', {
      listing_ids: [1, 2, 3],
      includes: ['Images'],
      skip: undefined
    })).toBe('https://openapi.etsy.com/v3/application/listings/batch?listing_ids=1%2C2%2C3&includes=Images')
  })

  it('keeps a minimum gap between requests', async () => {
    let t = 1000
    const f = queuedFetch([{ body: { application_id: 1 } }])
    const { c, sleep } = client(f, { minIntervalMs: 200, now: () => t })
    sleep.mockImplementation(async (ms: number) => {
      t += ms
    })
    await c.ping()
    await c.ping()
    expect(sleep).toHaveBeenCalledWith(200)
  })

  it('runs requests strictly one at a time', async () => {
    let inFlight = 0
    let max = 0
    const f = fakeFetch(async () => {
      inFlight++
      max = Math.max(max, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return { body: { application_id: 1 } }
    })
    const { c } = client(f)
    await Promise.all([c.ping(), c.ping(), c.ping()])
    expect(max).toBe(1)
    expect(f.calls).toHaveLength(3)
  })
})

describe('errors', () => {
  it.each([401, 403])('%i → auth error with Etsy detail and request id', async (status) => {
    const f = queuedFetch([
      { status, body: error403, headers: { 'x-etsy-request-uuid': 'req-123' } }
    ])
    const e = await err(client(f).c.ping())
    expect(e).toBeInstanceOf(EtsyApiError)
    expect(e.kind).toBe('auth')
    expect(e.status).toBe(status)
    expect(e.requestId).toBe('req-123')
    expect(e.detail).toBe(error403.error)
    expect(e.message).toMatch(/API-ключ/)
    expect(f.calls).toHaveLength(1)
  })

  it('404 → not_found', async () => {
    const f = queuedFetch([{ status: 404, body: { error: 'Shop not found' } }])
    const e = await err(client(f).c.getShop(1))
    expect(e.kind).toBe('not_found')
    expect(e.message).toMatch(/не знайшов/)
  })

  it('400 → bad_request (not retried)', async () => {
    const f = queuedFetch([{ status: 400, body: { error: 'bad' } }])
    const e = await err(client(f).c.getShop(1))
    expect(e.kind).toBe('bad_request')
    expect(f.calls).toHaveLength(1)
  })

  it('non-JSON error body still yields a typed error', async () => {
    const f = queuedFetch([{ status: 403, body: '<html>nope</html>' }])
    const e = await err(client(f).c.ping())
    expect(e.kind).toBe('auth')
    expect(e.detail).toBeUndefined()
  })

  it('invalid JSON on 200 → bad_response', async () => {
    const f = queuedFetch([{ status: 200, body: 'not json' }])
    expect((await err(client(f).c.ping())).kind).toBe('bad_response')
  })

  it('a paged endpoint without results[] → bad_response', async () => {
    const f = queuedFetch([{ body: { count: 1 } }])
    expect((await err(client(f).c.findShopByName('x'))).kind).toBe('bad_response')
  })
})

describe('retries', () => {
  it('429 waits Retry-After seconds then succeeds', async () => {
    const f = queuedFetch([
      { status: 429, body: { error: 'rate' }, headers: { 'retry-after': '2' } },
      { body: { application_id: 1 } }
    ])
    const { c, sleep } = client(f)
    expect(await c.ping()).toEqual({ application_id: 1 })
    expect(sleep).toHaveBeenCalledWith(2000)
    expect(f.calls).toHaveLength(2)
  })

  it('429 without Retry-After uses exponential backoff', async () => {
    const f = queuedFetch([
      { status: 429, body: {} },
      { status: 429, body: {} },
      { body: { application_id: 1 } }
    ])
    const { c, sleep } = client(f, { backoffBaseMs: 100 })
    await c.ping()
    expect(sleep.mock.calls.map((a) => a[0])).toEqual([100, 200])
  })

  it('429 exhaustion → rate_limit after maxRetries + 1 attempts', async () => {
    const f = queuedFetch([{ status: 429, body: {}, headers: { 'retry-after': '1' } }])
    const e = await err(client(f, { maxRetries: 2 }).c.ping())
    expect(e.kind).toBe('rate_limit')
    expect(f.calls).toHaveLength(3)
  })

  it('a Retry-After beyond the cap (daily quota) fails fast', async () => {
    const f = queuedFetch([{ status: 429, body: {}, headers: { 'retry-after': '7200' } }])
    const { c, sleep } = client(f)
    expect((await err(c.ping())).kind).toBe('rate_limit')
    expect(sleep).not.toHaveBeenCalled()
    expect(f.calls).toHaveLength(1)
  })

  it('5xx is retried, then succeeds', async () => {
    const f = queuedFetch([{ status: 503, body: {} }, { body: { application_id: 1 } }])
    expect(await client(f).c.ping()).toEqual({ application_id: 1 })
  })

  it('5xx exhaustion → server error', async () => {
    const f = queuedFetch([{ status: 500, body: { error: 'boom' } }])
    const e = await err(client(f, { maxRetries: 1 }).c.ping())
    expect(e.kind).toBe('server')
    expect(e.status).toBe(500)
    expect(f.calls).toHaveLength(2)
  })

  it('network errors are retried, then reported', async () => {
    const replies: FakeReply[] = [{ throws: new TypeError('fetch failed') }]
    const f = queuedFetch(replies)
    const e = await err(client(f, { maxRetries: 1 }).c.ping())
    expect(e.kind).toBe('network')
    expect(e.message).toMatch(/fetch failed/)
    expect(f.calls).toHaveLength(2)
  })
})

describe('quota headers', () => {
  it('parses the rate-limit headers and reports them', async () => {
    const onQuota = vi.fn()
    const f = queuedFetch([
      {
        body: { application_id: 1 },
        headers: {
          'x-limit-per-second': '10',
          'x-remaining-this-second': '9',
          'x-limit-per-day': '10000',
          'x-remaining-today': '9876'
        }
      }
    ])
    await client(f, { onQuota, now: () => 42 }).c.ping()
    expect(onQuota).toHaveBeenCalledWith({
      limitPerSecond: 10,
      remainingThisSecond: 9,
      limitPerDay: 10000,
      remainingToday: 9876,
      at: 42
    })
  })

  it('also reads quota from error responses', async () => {
    const onQuota = vi.fn()
    const f = queuedFetch([{ status: 404, body: {}, headers: { 'x-remaining-today': '5' } }])
    await err(client(f, { onQuota }).c.getShop(1))
    expect(onQuota).toHaveBeenCalledWith(expect.objectContaining({ remainingToday: 5 }))
  })

  it('returns null without any quota header', () => {
    expect(parseQuota(new Headers({ 'content-type': 'x' }), 0)).toBeNull()
    expect(parseQuota(new Headers({ 'x-remaining-today': 'abc' }), 0)).toBeNull()
  })

  it('parseRetryAfter handles seconds, HTTP dates and junk', () => {
    expect(parseRetryAfter('3', 0)).toBe(3000)
    expect(parseRetryAfter(null, 0)).toBeNull()
    expect(parseRetryAfter('soon', 0)).toBeNull()
    const now = Date.parse('2026-10-22T10:00:00Z')
    expect(parseRetryAfter('Thu, 22 Oct 2026 10:00:05 GMT', now)).toBe(5000)
  })
})

describe('findShopByName', () => {
  it('asks with limit=100 and keeps only the exact case-insensitive match', async () => {
    const f = queuedFetch([{ body: findShopsFx }])
    const shop = await client(f).c.findShopByName('ceramicstudioua')
    expect(shop?.shop_id).toBe(20987654)
    expect(shop?.shop_name).toBe('CeramicStudioUA')
    expect(f.calls[0].url.searchParams.get('shop_name')).toBe('ceramicstudioua')
    expect(f.calls[0].url.searchParams.get('limit')).toBe('100')
  })

  it('returns null when only fuzzy matches come back', async () => {
    const f = queuedFetch([{ body: findShopsFx }])
    expect(await client(f).c.findShopByName('CeramicStudio')).toBeNull()
  })

  it('returns null on count: 0', async () => {
    const f = queuedFetch([{ body: { count: 0, results: [] } }])
    expect(await client(f).c.findShopByName('Nope')).toBeNull()
  })

  it('keeps paging when the exact match is not on the first page', async () => {
    const fuzzy = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ ...findShopsFx.results[1], shop_id: from + i, shop_name: `Art${from + i}` }))
    const exact = { ...findShopsFx.results[0], shop_id: 777, shop_name: 'Art' }
    const f = fakeFetch((url) =>
      url.searchParams.get('offset') === '100'
        ? { body: { count: 150, results: [...fuzzy(49, 100), exact] } }
        : { body: { count: 150, results: fuzzy(100, 0) } }
    )
    const shop = await client(f).c.findShopByName('art')
    expect(shop?.shop_id).toBe(777)
    expect(f.calls.map((c) => c.url.searchParams.get('offset'))).toEqual([null, '100'])
  })

  it('stops paging at the page budget or when the results end', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ ...findShopsFx.results[1], shop_name: `X${i}` }))
    const f = fakeFetch(() => ({ body: { count: 100_000, results: page } }))
    expect(await client(f).c.findShopByName('Art')).toBeNull()
    expect(f.calls).toHaveLength(FIND_SHOP_MAX_PAGES)

    const g = queuedFetch([{ body: findShopsFx }])
    expect(await client(g).c.findShopByName('Nope')).toBeNull()
    expect(g.calls).toHaveLength(1)
  })
})

describe('getAllActiveListings', () => {
  it('pages with limit=100 until offset >= count', async () => {
    const etsy = new FakeEtsy(250)
    const onPage = vi.fn()
    const res = await etsy.client().getAllActiveListings(etsy.shop.shop_id, onPage)
    expect(res.listings).toHaveLength(250)
    expect(res.count).toBe(250)
    expect(res.truncated).toBe(false)
    const pages = etsy.requests.map((u) => [u.searchParams.get('limit'), u.searchParams.get('offset')])
    expect(pages).toEqual([
      ['100', '0'],
      ['100', '100'],
      ['100', '200']
    ])
    expect(onPage.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3]
    ])
  })

  it('stops on an empty page even if count says more', async () => {
    const f = fakeFetch((url) =>
      url.searchParams.get('offset') === '0'
        ? { body: { count: 500, results: [mkEtsyListing(1)] } }
        : { body: { count: 500, results: [] } }
    )
    const res = await client(f).c.getAllActiveListings(1)
    expect(res.listings).toHaveLength(1)
    expect(f.calls).toHaveLength(2)
  })

  it('dedupes listings that shift between pages', async () => {
    const f = fakeFetch((url) => {
      // A new listing was added at the front while we read: page 2 repeats #100.
      const off = Number(url.searchParams.get('offset'))
      const ids = off === 0 ? range(1, 100) : range(100, 150)
      return { body: { count: 151, results: ids.map((i) => mkEtsyListing(i)) } }
    })
    const res = await client(f).c.getAllActiveListings(1)
    expect(res.listings).toHaveLength(150)
    expect(new Set(res.listings.map((l) => l.listing_id)).size).toBe(150)
  })

  it('never asks for offset > 12000 and flags truncation', async () => {
    const f = fakeFetch(() => ({
      body: {
        count: 20000,
        results: Array.from({ length: 100 }, (_, i) => mkEtsyListing(Math.random() * 1e9 + i))
      }
    }))
    const res = await client(f).c.getAllActiveListings(1)
    const offsets = f.calls.map((c) => Number(c.url.searchParams.get('offset')))
    expect(Math.max(...offsets)).toBe(12000)
    expect(offsets).toHaveLength(121)
    expect(res.truncated).toBe(true)
  })
})

describe('getListingsByIds', () => {
  it('chunks ids by 100 and asks for Images, Videos and Personalization', async () => {
    const etsy = new FakeEtsy(230)
    const onChunk = vi.fn()
    const ids = etsy.listings.map((l) => l.listing_id)
    const map = await etsy.client().getListingsByIds([...ids, ids[0]], onChunk)
    expect(map.size).toBe(230)
    const batches = etsy.requests.filter((u) => u.pathname.endsWith('/listings/batch'))
    expect(batches).toHaveLength(3)
    for (const b of batches) {
      expect(b.searchParams.get('listing_ids')!.split(',').length).toBeLessThanOrEqual(BATCH_LIMIT)
      expect(b.searchParams.get('includes')).toBe('Images,Videos,Personalization')
    }
    expect(map.get(1)?.images).toHaveLength(2)
    expect(map.get(1)?.videos).toEqual([])
    expect(map.get(1)?.views).toBe(101)
    expect(onChunk.mock.calls).toEqual([
      [100, 230],
      [200, 230],
      [230, 230]
    ])
  })

  it('makes no request for an empty id list', async () => {
    const etsy = new FakeEtsy(3)
    expect((await etsy.client().getListingsByIds([])).size).toBe(0)
    expect(etsy.requests).toHaveLength(0)
  })

  it('when the batch 404s on an unknown id, bisects and drops only the dead id', async () => {
    const etsy = new FakeEtsy(100, { batchUnknown: '404' })
    const ids = etsy.listings.map((l) => l.listing_id)
    etsy.listings.splice(41, 1) // #42 deleted on Etsy
    const map = await etsy.client().getListingsByIds(ids)
    expect(map.size).toBe(99)
    expect(map.has(42)).toBe(false)
    expect(map.get(41)?.images).toHaveLength(2)
    // A single dead id costs a handful of requests, not one per listing.
    expect(etsy.requests.length).toBeLessThan(20)
    expect(etsy.count('/v3/application/listings/42')).toBe(1)
  })

  it('a batch 404 for every id yields an empty map, not an error', async () => {
    const etsy = new FakeEtsy(0, { batchUnknown: '404' })
    expect((await etsy.client().getListingsByIds([1, 2, 3])).size).toBe(0)
  })

  it('still fails on errors a single-listing GET also returns', async () => {
    const etsy = new FakeEtsy(3, { intercept: () => ({ status: 400, body: { error: 'bad ids' } }) })
    const e = await err(etsy.client().getListingsByIds([1, 2, 3]))
    expect(e.kind).toBe('bad_request')
    const etsy500 = new FakeEtsy(3, { intercept: () => ({ status: 500, body: {} }) })
    expect((await err(etsy500.client({ maxRetries: 0 }).getListingsByIds([1]))).kind).toBe('server')
  })
})

describe('getListing', () => {
  it('returns the listing with images, or null on 404', async () => {
    const etsy = new FakeEtsy(2)
    const c = etsy.client()
    expect((await c.getListing(2))?.images).toHaveLength(2)
    expect(etsy.requests[0].searchParams.get('includes')).toBe('Images,Videos,Personalization')
    expect(await c.getListing(999)).toBeNull()
  })
})

describe('detail includes fallback', () => {
  it('when Etsy refuses Videos/Personalization (403) but Images works, falls back to Images for good', async () => {
    const etsy = new FakeEtsy(150, { refuseIncludes: ['Videos', 'Personalization'] })
    const c = etsy.client()
    const map = await c.getListingsByIds(etsy.listings.map((l) => l.listing_id))
    expect(map.size).toBe(150)
    expect(map.get(1)?.images).toHaveLength(2)
    expect(map.get(1)?.videos).toBeUndefined()
    expect(c.detailIncludes()).toEqual(['Images'])
    const batches = etsy.requests.filter((u) => u.pathname.endsWith('/listings/batch'))
    // refused once, then Images-only for that chunk and every later one
    expect(batches.map((u) => u.searchParams.get('includes'))).toEqual([
      'Images,Videos,Personalization',
      'Images',
      'Images'
    ])
    expect((await c.getListing(3))?.images).toHaveLength(2)
    expect(etsy.requests.at(-1)!.searchParams.get('includes')).toBe('Images')
  })

  it('a key that is rejected outright still fails with the auth error', async () => {
    const etsy = new FakeEtsy(3, { intercept: () => ({ status: 403, body: { error: 'bad key' } }) })
    const c = etsy.client()
    expect((await err(c.getListingsByIds([1, 2]))).kind).toBe('auth')
    expect(c.detailIncludes()).toEqual(['Images', 'Videos', 'Personalization'])
  })
})

describe('request timeout', () => {
  /** A fetch that never answers until its signal aborts (a stalled connection). */
  const hanging = () =>
    vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('This operation was aborted', 'AbortError'))
          )
        })
    )

  it('aborts a stalled request, retries once, then fails with a Ukrainian timeout error', async () => {
    const f = hanging()
    const { c } = client(f as unknown as typeof fetch, { requestTimeoutMs: 20 })
    const e = await err(c.ping())
    expect(e).toBeInstanceOf(EtsyApiError)
    expect(e.kind).toBe('network')
    expect(e.message).toMatch(/не відповідає.*тайм-аут/)
    expect(f).toHaveBeenCalledTimes(2)
    expect(f.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('a timed-out request succeeds on the retry, and the queue moves on', async () => {
    let n = 0
    const ok = fakeFetch(() => ({ body: { application_id: 9 } }))
    const f = vi.fn((url: RequestInfo | URL, init?: RequestInit) =>
      n++ === 0 ? hanging()(url, init) : ok(url, init)
    )
    const { c } = client(f as unknown as typeof fetch, { requestTimeoutMs: 20 })
    expect(await c.ping()).toEqual({ application_id: 9 })
    expect(await c.ping()).toEqual({ application_id: 9 })
  })
})

describe('client.getShopReviews', () => {
  it('asks for 100 per page with the created bounds, clamped to the OAS minimum', async () => {
    const etsy = new FakeEtsy(0)
    etsy.reviews.push(mkEtsyReview(1))
    const page = await etsy.client().getShopReviews(SHOP_ID, { minCreated: 5, maxCreated: reviewCreated(2), offset: 0 })
    expect(page.count).toBe(1)
    const u = etsy.requests[0]
    expect(u.pathname).toBe(`/v3/application/shops/${SHOP_ID}/reviews`)
    expect(u.searchParams.get('limit')).toBe('100')
    expect(u.searchParams.get('offset')).toBeNull()
    expect(u.searchParams.get('min_created')).toBe(String(REVIEW_EPOCH_MIN))
    expect(u.searchParams.get('max_created')).toBe(String(reviewCreated(2)))
  })
})

describe('client.getShopReviews errors', () => {
  it('403 is an auth error, 404 not_found, 400 bad_request — the caller decides', async () => {
    const etsy = new FakeEtsy(0)
    for (const [status, kind] of [[403, 'auth'], [404, 'not_found'], [400, 'bad_request']] as const) {
      etsy.reviewsStatus = status
      const e = await err(etsy.client().getShopReviews(SHOP_ID))
      expect(e.kind).toBe(kind)
    }
  })
  it('the fake refuses offsets beyond the v3 cap like Etsy does', async () => {
    const etsy = new FakeEtsy(0)
    expect((await err(etsy.client().getShopReviews(SHOP_ID, { offset: 12100 }))).kind).toBe('bad_request')
  })
})

describe('buyer prices (includes=BuyerPrice + buyer_country)', () => {
  const batches = (etsy: FakeEtsy) => etsy.requests.filter((u) => u.pathname.endsWith('/listings/batch'))

  it('asks /listings/batch for BuyerPrice with the buyer country — no extra requests', async () => {
    const etsy = new FakeEtsy(150)
    etsy.listings[0].price = { amount: 250, divisor: 100, currency_code: 'USD' }
    etsy.promotions[1] = { percentage: 60, start: 1_759_276_800, end: 1_761_868_800 }
    const c = etsy.client()
    const map = await c.getListingsByIds(etsy.listings.map((l) => l.listing_id), undefined, { buyerCountry: 'UA' })
    expect(batches(etsy)).toHaveLength(2)
    for (const b of batches(etsy)) {
      expect(b.searchParams.get('includes')).toBe('Images,Videos,Personalization,BuyerPrice')
      expect(b.searchParams.get('buyer_country')).toBe('UA')
    }
    // OAS ListingBuyerPrice: 2.50 USD + 20 % VAT = 3.00, −60 % = 1.20.
    expect(map.get(1)!.buyer_price).toEqual({
      base_price: { amount: 300, divisor: 100, currency_code: 'USD' },
      shipping_cost: null,
      is_free_shipping: false,
      original_price: { amount: 300, divisor: 100, currency_code: 'USD' },
      discounted_price: { amount: 120, divisor: 100, currency_code: 'USD' },
      discount_amount: { amount: 180, divisor: 100, currency_code: 'USD' },
      discount_percentage: 60,
      has_discount: true,
      discount_start_epoch: 1_759_276_800,
      discount_end_epoch: 1_761_868_800
    })
    expect(map.get(2)!.buyer_price).toMatchObject({ has_discount: false, discounted_price: null, discount_percentage: null })
    expect(c.buyerPriceRefused('UA')).toBe(false)
    expect(c.detailIncludes()).toEqual(['Images', 'Videos', 'Personalization'])
  })

  it('without a buyer country neither BuyerPrice nor buyer_country is sent', async () => {
    const etsy = new FakeEtsy(2)
    const map = await etsy.client().getListingsByIds([1, 2], undefined, { buyerCountry: null })
    expect(batches(etsy)[0].searchParams.get('includes')).toBe('Images,Videos,Personalization')
    expect(batches(etsy)[0].searchParams.has('buyer_country')).toBe(false)
    expect('buyer_price' in map.get(1)!).toBe(false)
  })

  it('GET /listings/{id} passes BuyerPrice + buyer_country too', async () => {
    const etsy = new FakeEtsy(2)
    etsy.singleBuyerPrice = true
    const one = await etsy.client().getListing(2, { buyerCountry: 'DE' })
    expect(etsy.requests[0].searchParams.get('includes')).toBe('Images,Videos,Personalization,BuyerPrice')
    expect(etsy.requests[0].searchParams.get('buyer_country')).toBe('DE')
    expect(one!.buyer_price).toMatchObject({ original_price: { amount: Math.round(1002 * 1.19) } })
  })

  for (const status of [403, 401, 400]) {
    it(`Etsy refusing BuyerPrice (${status}) drops just that include, for good, and records it`, async () => {
      const etsy = new FakeEtsy(250, { refuseIncludes: ['BuyerPrice'], refuseStatus: status })
      const c = etsy.client()
      const map = await c.getListingsByIds(etsy.listings.map((l) => l.listing_id), undefined, { buyerCountry: 'UA' })
      expect(map.size).toBe(250)
      expect(map.get(1)!.images).toHaveLength(2)
      expect(map.get(1)!.videos).toEqual([])
      expect('buyer_price' in map.get(1)!).toBe(false)
      expect(batches(etsy).map((u) => u.searchParams.get('includes'))).toEqual([
        'Images,Videos,Personalization,BuyerPrice',
        'Images,Videos,Personalization',
        'Images,Videos,Personalization',
        'Images,Videos,Personalization'
      ])
      expect(batches(etsy).slice(1).every((u) => !u.searchParams.has('buyer_country'))).toBe(true)
      expect(c.buyerPriceRefused('UA')).toBe(true)
      expect(c.detailIncludes()).toEqual(['Images', 'Videos', 'Personalization'])
      // Never asked again by this client (getListing included).
      await c.getListing(3, { buyerCountry: 'UA' })
      expect(etsy.requests.at(-1)!.searchParams.get('includes')).toBe('Images,Videos,Personalization')
    })
  }

  it('BuyerPrice and Videos both refused: ends on Images only, buyer prices recorded as unavailable', async () => {
    const etsy = new FakeEtsy(3, { refuseIncludes: ['BuyerPrice', 'Videos'] })
    const c = etsy.client()
    const map = await c.getListingsByIds([1, 2, 3], undefined, { buyerCountry: 'UA' })
    expect(map.size).toBe(3)
    expect(batches(etsy).map((u) => u.searchParams.get('includes'))).toEqual([
      'Images,Videos,Personalization,BuyerPrice',
      'Images,Videos,Personalization',
      'Images,BuyerPrice',
      'Images'
    ])
    expect(c.detailIncludes()).toEqual(['Images'])
    expect(c.buyerPriceRefused('UA')).toBe(true)
  })

  it('a refused Videos (BuyerPrice not yet proven) falls back to Images+BuyerPrice — buyer prices kept', async () => {
    const etsy = new FakeEtsy(150, { refuseIncludes: ['Videos'] })
    etsy.promotions[1] = { percentage: 60, start: 100, end: 200 }
    const c = etsy.client()
    const map = await c.getListingsByIds(etsy.listings.map((l) => l.listing_id), undefined, { buyerCountry: 'UA' })
    expect(map.size).toBe(150)
    expect(batches(etsy).map((u) => u.searchParams.get('includes'))).toEqual([
      'Images,Videos,Personalization,BuyerPrice',
      'Images,Videos,Personalization',
      'Images,BuyerPrice',
      'Images,BuyerPrice'
    ])
    expect(batches(etsy).slice(2).every((u) => u.searchParams.get('buyer_country') === 'UA')).toBe(true)
    expect(map.get(1)!.buyer_price).toMatchObject({ has_discount: true, discount_percentage: 60 })
    expect(map.get(150)!.buyer_price).toMatchObject({ has_discount: false })
    expect(c.buyerPriceRefused('UA')).toBe(false)
    expect(c.detailIncludes()).toEqual(['Images'])
    // Proven by that batch: a later 400 (unknown id) bisects at once.
    etsy.requests.length = 0
    etsy.intercept = (url) =>
      url.pathname.endsWith('/listings/batch') && (url.searchParams.get('listing_ids') ?? '').includes('3')
        ? { status: 400, body: { error: 'listing_ids contains an invalid id' } }
        : null
    await c.getListingsByIds([2, 3], undefined, { buyerCountry: 'UA' })
    expect(etsy.requests.every((u) => u.searchParams.get('includes') === 'Images,BuyerPrice')).toBe(true)
  })

  it('a single GET whose Videos is refused falls back to Images+BuyerPrice too, deciding nothing about batches', async () => {
    const etsy = new FakeEtsy(2, { refuseIncludes: ['Videos'] })
    etsy.singleBuyerPrice = true
    const c = etsy.client()
    const one = await c.getListing(1, { buyerCountry: 'UA' })
    expect(one!.buyer_price).toMatchObject({ has_discount: false })
    expect(etsy.requests.map((u) => u.searchParams.get('includes'))).toEqual([
      'Images,Videos,Personalization,BuyerPrice',
      'Images,Videos,Personalization',
      'Images,BuyerPrice'
    ])
    expect(c.detailIncludes()).toEqual(['Images'])
    expect(c.buyerPriceRefused('UA')).toBe(false)
  })

  it('a single GET refusing BuyerPrice and Videos ends on Images only, still refusing nothing', async () => {
    const etsy = new FakeEtsy(2, { refuseIncludes: ['Videos', 'BuyerPrice'] })
    const c = etsy.client()
    expect((await c.getListing(1, { buyerCountry: 'UA' }))!.listing_id).toBe(1)
    expect(etsy.requests.map((u) => u.searchParams.get('includes'))).toEqual([
      'Images,Videos,Personalization,BuyerPrice',
      'Images,Videos,Personalization',
      'Images,BuyerPrice',
      'Images'
    ])
    expect(c.detailIncludes()).toEqual(['Images'])
    expect(c.buyerPriceRefused('UA')).toBe(false)
  })

  it('a refusal is per buyer country: the next country is asked afresh', async () => {
    const etsy = new FakeEtsy(2, {
      intercept: (url) =>
        url.searchParams.get('buyer_country') === 'AQ' ? { status: 400, body: { error: 'Invalid buyer_country' } } : null
    })
    const c = etsy.client()
    const aq = await c.getListingsByIds([1, 2], undefined, { buyerCountry: 'AQ' })
    expect(aq.size).toBe(2)
    expect(c.buyerPriceRefused('AQ')).toBe(true)
    expect(c.buyerPriceRefused('UA')).toBe(false)
    expect(c.buyerPriceRefused(null)).toBe(false)
    const ua = await c.getListingsByIds([1, 2], undefined, { buyerCountry: 'UA' })
    expect(etsy.requests.at(-1)!.searchParams.get('includes')).toBe('Images,Videos,Personalization,BuyerPrice')
    expect(etsy.requests.at(-1)!.searchParams.get('buyer_country')).toBe('UA')
    expect(ua.get(1)!.buyer_price).toMatchObject({ original_price: { amount: Math.round(1001 * 1.2) } })
    expect(c.buyerPriceRefused('UA')).toBe(false)
    // AQ stays refused for this client: asked without BuyerPrice, one request.
    etsy.requests.length = 0
    await c.getListingsByIds([1], undefined, { buyerCountry: 'AQ' })
    expect(etsy.requests.map((u) => u.searchParams.get('includes'))).toEqual(['Images,Videos,Personalization'])
    expect(etsy.requests[0].searchParams.has('buyer_country')).toBe(false)
  })

  it('BuyerPrice not yet proven + a 400 for an unknown id: one retry without it, then bisects — nothing refused', async () => {
    const etsy = new FakeEtsy(4)
    etsy.intercept = (url) =>
      url.pathname.endsWith('/listings/batch') && (url.searchParams.get('listing_ids') ?? '').split(',').includes('4')
        ? { status: 400, body: { error: 'listing_ids contains an invalid id' } }
        : null
    etsy.listings.splice(3, 1) // #4 is unknown to Etsy
    const c = etsy.client()
    const map = await c.getListingsByIds([1, 2, 3, 4], undefined, { buyerCountry: 'UA' })
    expect([...map.keys()].sort()).toEqual([1, 2, 3])
    expect(etsy.requests.map((u) => [u.pathname.replace('/v3/application', ''), u.searchParams.get('listing_ids'), u.searchParams.get('includes')])).toEqual([
      ['/listings/batch', '1,2,3,4', 'Images,Videos,Personalization,BuyerPrice'],
      // the one extra try without BuyerPrice — it fails too, so the original 400 bisects
      ['/listings/batch', '1,2,3,4', 'Images,Videos,Personalization'],
      ['/listings/batch', '1,2', 'Images,Videos,Personalization,BuyerPrice'],
      // [1,2] proved BuyerPrice: from here a 400 bisects without the extra try
      ['/listings/batch', '3,4', 'Images,Videos,Personalization,BuyerPrice'],
      ['/listings/batch', '3', 'Images,Videos,Personalization,BuyerPrice'],
      ['/listings/batch', '4', 'Images,Videos,Personalization,BuyerPrice'],
      ['/listings/4', null, 'Images,Videos,Personalization,BuyerPrice']
    ])
    expect(map.get(1)!.buyer_price).toMatchObject({ has_discount: false })
    expect(c.buyerPriceRefused('UA')).toBe(false)
  })

  it('once BuyerPrice worked, Images-only fallback keeps it', async () => {
    const etsy = new FakeEtsy(3)
    const c = etsy.client()
    await c.getListingsByIds([1], undefined, { buyerCountry: 'UA' })
    etsy.refuseIncludes = ['Videos']
    const map = await c.getListingsByIds([2], undefined, { buyerCountry: 'UA' })
    expect(batches(etsy).map((u) => u.searchParams.get('includes'))).toEqual([
      'Images,Videos,Personalization,BuyerPrice',
      'Images,Videos,Personalization,BuyerPrice',
      'Images,BuyerPrice'
    ])
    expect(map.get(2)!.buyer_price).toMatchObject({ has_discount: false })
    expect(c.buyerPriceRefused('UA')).toBe(false)
  })

  it('once BuyerPrice worked, a 400 (an unknown id) bisects without retrying without BuyerPrice', async () => {
    const etsy = new FakeEtsy(4)
    const c = etsy.client()
    await c.getListingsByIds([1], undefined, { buyerCountry: 'UA' })
    etsy.requests.length = 0
    etsy.intercept = (url) =>
      url.pathname.endsWith('/listings/batch') && (url.searchParams.get('listing_ids') ?? '').includes('4')
        ? { status: 400, body: { error: 'listing_ids contains an invalid id' } }
        : null
    const map = await c.getListingsByIds([1, 2, 3, 4], undefined, { buyerCountry: 'UA' })
    expect(map.size).toBe(4) // #4 came from the single GET
    expect(etsy.requests.every((u) => u.searchParams.get('includes')!.endsWith('BuyerPrice'))).toBe(true)
    expect(etsy.requests.every((u) => u.searchParams.get('buyer_country') === 'UA')).toBe(true)
    expect(c.buyerPriceRefused('UA')).toBe(false)
  })

  it('a single GET answering 400 to BuyerPrice is retried without it, without refusing it for batches', async () => {
    const etsy = new FakeEtsy(2, {
      intercept: (url) =>
        /\/listings\/\d+$/.test(url.pathname) && url.searchParams.get('includes')!.includes('BuyerPrice')
          ? { status: 400, body: { error: 'BuyerPrice is only supported on /listings/batch' } }
          : null
    })
    const c = etsy.client()
    const one = await c.getListing(1, { buyerCountry: 'UA' })
    expect(one!.listing_id).toBe(1)
    expect(etsy.requests.map((u) => u.searchParams.get('includes'))).toEqual([
      'Images,Videos,Personalization,BuyerPrice',
      'Images,Videos,Personalization'
    ])
    expect(c.buyerPriceRefused('UA')).toBe(false)
    await c.getListingsByIds([2], undefined, { buyerCountry: 'UA' })
    expect(etsy.requests.at(-1)!.searchParams.get('includes')).toBe('Images,Videos,Personalization,BuyerPrice')
  })

  it('a key rejected outright still fails with the auth error and refuses nothing', async () => {
    const etsy = new FakeEtsy(3, { intercept: () => ({ status: 403, body: { error: 'bad key' } }) })
    const c = etsy.client()
    expect((await err(c.getListingsByIds([1, 2], undefined, { buyerCountry: 'UA' }))).kind).toBe('auth')
    expect(c.buyerPriceRefused('UA')).toBe(false)
    expect(c.detailIncludes()).toEqual(['Images', 'Videos', 'Personalization'])
  })

  it('a batch 404 bisects down to single GETs that still carry buyer_country', async () => {
    const etsy = new FakeEtsy(4, { batchUnknown: '404' })
    const ids = etsy.listings.map((l) => l.listing_id)
    etsy.listings.splice(1, 1) // #2 deleted
    const map = await etsy.client().getListingsByIds(ids, undefined, { buyerCountry: 'PL' })
    expect(map.size).toBe(3)
    expect(etsy.requests.every((u) => u.searchParams.get('buyer_country') === 'PL')).toBe(true)
    expect(etsy.count('/v3/application/listings/2')).toBe(1)
  })
})

describe('own-shop calls (OAuth)', () => {
  const ok = (body: unknown = {}): FakeReply => ({ body })

  it('a signed call sends the API key and the bearer token', async () => {
    const f = queuedFetch([ok({ user_id: 555, shop_id: 77 })])
    const { c } = client(f, { getAccessToken: async () => '555.tok' })
    expect(await c.getMe()).toEqual({ user_id: 555, shop_id: 77 })
    expect(f.calls[0].url.pathname).toBe('/v3/application/users/me')
    expect(f.calls[0].headers).toMatchObject({ 'x-api-key': 'mykeystring:mysecret', authorization: 'Bearer 555.tok' })
    expect(f.calls[0].method).toBe('GET')
  })

  it('an explicit token (right after sign-in) is used as is', async () => {
    const f = queuedFetch([ok({ user_id: 1 })])
    const getAccessToken = vi.fn(async () => 'stored')
    const { c } = client(f, { getAccessToken })
    await c.getMe('fresh')
    expect(f.calls[0].headers.authorization).toBe('Bearer fresh')
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('unsigned calls never carry a bearer token', async () => {
    const f = queuedFetch([ok({ shop_id: 1, shop_name: 'X' })])
    const { c } = client(f, { getAccessToken: async () => 'tok' })
    await c.getShop(1)
    expect(f.calls[0].headers.authorization).toBeUndefined()
  })

  it('signed out: a clear error, no request', async () => {
    const f = queuedFetch([ok()])
    const { c } = client(f, { getAccessToken: async () => null })
    const e = await err(c.getMe())
    expect(e.kind).toBe('not_signed_in')
    expect(e.message).toContain('Увійдіть в Etsy')
    expect(f.calls).toHaveLength(0)
    expect((await err(client(f).c.getMe())).kind).toBe('not_signed_in')
  })

  it('updateListing: PATCH with a form body (arrays comma-separated)', async () => {
    const f = queuedFetch([ok({ listing_id: 9, title: 'New' })])
    const { c } = client(f, { getAccessToken: async () => 'tok' })
    expect(await c.updateListing(77, 9, { title: 'New & better', tags: ['a b', 'c'], should_auto_renew: false })).toEqual({
      listing_id: 9,
      title: 'New'
    })
    expect(f.calls[0].method).toBe('PATCH')
    expect(f.calls[0].url.pathname).toBe('/v3/application/shops/77/listings/9')
    expect(f.calls[0].headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(Object.fromEntries(new URLSearchParams(f.calls[0].body!))).toEqual({
      title: 'New & better',
      tags: 'a b,c',
      should_auto_renew: 'false'
    })
  })

  it('updateShop: PUT with a form body', async () => {
    const f = queuedFetch([ok({ shop_id: 77 })])
    const { c } = client(f, { getAccessToken: async () => 'tok' })
    await c.updateShop(77, { announcement: 'Hi' })
    expect(f.calls[0].method).toBe('PUT')
    expect(f.calls[0].url.pathname).toBe('/v3/application/shops/77')
    expect(f.calls[0].body).toBe('announcement=Hi')
  })

  it('getShopListingsByState: any state, with images, paged', async () => {
    const f = queuedFetch([ok({ count: 1, results: [{ listing_id: 1 }] })])
    const { c } = client(f, { getAccessToken: async () => 'tok' })
    expect((await c.getShopListingsByState(77, 'draft', 100)).count).toBe(1)
    const q = Object.fromEntries(f.calls[0].url.searchParams)
    expect(f.calls[0].url.pathname).toBe('/v3/application/shops/77/listings')
    expect(q).toEqual({ state: 'draft', limit: '100', offset: '100', includes: 'Images' })
    await expect(client(queuedFetch([ok({})]), { getAccessToken: async () => 't' }).c.getShopListingsByState(1, 'active')).rejects.toThrow()
  })

  it('a refused token (401) is refreshed once and the call retried', async () => {
    const f = queuedFetch([{ status: 401, body: { error: 'invalid_token' } }, ok({ user_id: 1 })])
    const refreshAccessToken = vi.fn(async () => 'new')
    const { c } = client(f, { getAccessToken: async () => 'old', refreshAccessToken })
    expect(await c.getMe()).toEqual({ user_id: 1 })
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(f.calls.map((x) => x.headers.authorization)).toEqual(['Bearer old', 'Bearer new'])
  })

  it('still 401 after the refresh, or no refresh possible: "sign in again"', async () => {
    const f = queuedFetch([{ status: 401, body: { error: 'invalid_token' } }])
    const { c } = client(f, { getAccessToken: async () => 'old', refreshAccessToken: async () => 'new' })
    const e = await err(c.getMe())
    expect(e.kind).toBe('oauth')
    expect(e.message).toContain('увійдіть ще раз')
    const g = queuedFetch([{ status: 401 }])
    expect((await err(client(g, { getAccessToken: async () => 'old', refreshAccessToken: async () => null }).c.getMe())).kind).toBe('oauth')
    expect(g.calls).toHaveLength(1)
  })

  it('403 while signed in is "not allowed", not "bad API key"', async () => {
    const f = queuedFetch([{ status: 403, body: { error: 'Insufficient scope' } }])
    const { c } = client(f, { getAccessToken: async () => 'tok' })
    const e = await err(c.updateShop(1, { title: 'x' }))
    expect(e.kind).toBe('forbidden')
    expect(e.message).toContain('Insufficient scope')
    expect(e.message).not.toContain('API-ключ')
  })

  it('PATCH/PUT are retried on 5xx (idempotent); POST is not (it could create twice)', async () => {
    const f = queuedFetch([{ status: 503 }, ok({ shop_id: 1 })])
    const { c } = client(f, { getAccessToken: async () => 'tok' })
    await c.updateShop(1, { title: 'x' })
    expect(f.calls).toHaveLength(2)
    const g = queuedFetch([{ status: 503 }, ok({})])
    const { c: c2 } = client(g, { getAccessToken: async () => 'tok' })
    expect((await err(c2.call('/v3/application/shops/1/listings', { method: 'POST', oauth: true, form: { title: 'x' } }))).kind).toBe(
      'server'
    )
    expect(g.calls).toHaveLength(1)
    const h = queuedFetch([{ throws: new TypeError('reset') }, ok({})])
    const { c: c3 } = client(h, { getAccessToken: async () => 'tok' })
    expect((await err(c3.call('/x', { method: 'POST', oauth: true }))).kind).toBe('network')
    expect(h.calls).toHaveLength(1)
  })

  it('formBody: arrays comma-joined, undefined skipped, booleans as text', () => {
    expect(formBody({ a: ['x', 'y'], b: undefined, c: true, d: 5, e: '' })).toBe('a=x%2Cy&c=true&d=5&e=')
  })
})

describe('creating listings (OAuth)', () => {
  const signed = (f: typeof globalThis.fetch) => client(f, { getAccessToken: async () => 'tok' }).c

  it('createDraftListing: a POST form to the shop', async () => {
    const f = queuedFetch([{ body: { listing_id: 99, state: 'draft' } }])
    expect((await signed(f).createDraftListing(77, { title: 'T', price: 5.99, tags: ['a', 'b'] })).listing_id).toBe(99)
    expect(f.calls[0].method).toBe('POST')
    expect(f.calls[0].url.pathname).toBe('/v3/application/shops/77/listings')
    expect(f.calls[0].body).toBe('title=T&price=5.99&tags=a%2Cb')
  })

  it('uploads are multipart: the image with its rank, the file with its name', async () => {
    const f = queuedFetch([{ body: { listing_image_id: 1 } }, { body: { listing_file_id: 2 } }])
    const c = signed(f)
    await c.uploadListingImage(77, 99, { data: new Uint8Array([1, 2, 3]), name: 'a.jpg', type: 'image/jpeg', rank: 2 })
    await c.uploadListingFile(77, 99, { data: new Uint8Array([4]), name: 'Planner.xlsx', type: 'application/zip', rank: 1 })
    expect(f.calls.map((x) => [x.method, x.url.pathname])).toEqual([
      ['POST', '/v3/application/shops/77/listings/99/images'],
      ['POST', '/v3/application/shops/77/listings/99/files']
    ])
    const img = f.calls[0].rawBody as FormData
    expect(img.get('rank')).toBe('2')
    const blob = img.get('image') as File
    expect(blob.name).toBe('a.jpg')
    expect(blob.type).toBe('image/jpeg')
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3])
    const file = f.calls[1].rawBody as FormData
    expect(file.get('name')).toBe('Planner.xlsx')
    expect((file.get('file') as File).name).toBe('Planner.xlsx')
    expect(f.calls[0].headers['content-type']).toBeUndefined() // fetch sets the multipart boundary
  })

  it('an upload is never retried after a 5xx (it could duplicate the photo)', async () => {
    const f = queuedFetch([{ status: 502 }, { body: {} }])
    const e = await err(signed(f).uploadListingImage(1, 2, { data: new Uint8Array([1]), name: 'a.png', type: 'image/png', rank: 1 }))
    expect(e.kind).toBe('server')
    expect(f.calls).toHaveLength(1)
  })

  it('taxonomy (API key only), shipping and processing profiles (OAuth)', async () => {
    const f = queuedFetch([
      { body: { count: 1, results: [{ id: 1, name: 'Paper', children: [] }] } },
      { body: { count: 1, results: [{ shipping_profile_id: 5, title: 'Std' }] } },
      { body: { count: 1, results: [{ readiness_state_id: 6 }] } }
    ])
    const c = signed(f)
    expect(await c.getSellerTaxonomy()).toEqual([{ id: 1, name: 'Paper', children: [] }])
    expect(f.calls[0].headers.authorization).toBeUndefined()
    expect((await c.getShippingProfiles(77))[0].shipping_profile_id).toBe(5)
    expect(f.calls[1].url.pathname).toBe('/v3/application/shops/77/shipping-profiles')
    expect(f.calls[1].headers.authorization).toBe('Bearer tok')
    expect((await c.getProcessingProfiles(77))[0].readiness_state_id).toBe(6)
    expect(f.calls[2].url.pathname).toBe('/v3/application/shops/77/readiness-state-definitions')
  })
})

describe('501 Not Implemented', () => {
  it('is not retried (an endpoint that does not exist yet)', async () => {
    const f = queuedFetch([{ status: 501, body: { error: 'Not implemented' } }, { body: {} }])
    const e = await err(client(f).c.request('/v3/application/listings/1/properties/2'))
    expect(e.kind).toBe('server')
    expect(e.status).toBe(501)
    expect(f.calls).toHaveLength(1)
  })
})
