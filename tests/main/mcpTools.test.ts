import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../../src/main/db'
import { handleMcpMessage, type McpTool, type McpToolResult } from '../../src/main/mcpProtocol'
import { createMcpTools, imageMime, mcpServerInfo, MCP_INSTRUCTIONS, changeFields } from '../../src/main/mcpTools'
import { finishScanError, finishScanOk, insertRunningScan, upsertListing } from '../../src/main/db'
import { createImageProtocolHandler } from '../../src/main/imageProtocol'
import { createReviewSyncer } from '../../src/main/reviewSync'
import { createScanner } from '../../src/main/scanner'
import { MCP_TOOL_SUMMARY } from '../../src/shared/mcpConfig'
import type { ScanOutcome } from '../../src/shared/types'
import { FakeEtsy, SHOP_ID, mkEtsyListing, mkEtsyReview } from '../helpers/fakeEtsy'
import { cdnBytes, fakeCdn } from '../helpers/fakeImageStore'
import { memDb, mkInput, seedShop } from '../helpers/db'
import { routedFetch, signedIn, signedOut, testClient } from '../helpers/features'
import { saveDraft } from '../../src/main/drafts'
import { EMPTY_DRAFT_FIELDS } from '../../src/shared/myShop'
import { draftPhotoRef, draftRef, photoRef, productRef, reviewPhotoRef, storeImageRef, storeRef, videoRef } from '../../src/shared/claudeRef'
import { mkEtsyImage } from '../helpers/fakeEtsy'
import { getListing as getDbListing, listListingReviews, listNewReviews, listScanPromotions, listShopSummaries } from '../../src/main/db'
import { listDrafts } from '../../src/main/drafts'
import { shopStatsPayload } from '../../src/main/shopStats'
// The renderer's own gallery builder (cards and the listing window), so the test checks what is really copied.
import { listingGallery } from '../../src/renderer/src/components/ListingCard'

function ok(o: ScanOutcome) {
  if (!o.ok) throw new Error(`scan failed: ${o.error}`)
  return o.scan
}

const PROMO = { percentage: 60, start: 1_759_276_800, end: 1_861_868_800 }

/**
 * A shop with three successful scans and a review history:
 *  1 baseline: listings 1, 2, 3
 *  2: + 4, − 3, 2 renamed, a −60 % promotion on 1, +5 favorites on 1
 *  3: + 5, − 4, 3 back; one review new since the backfill
 * Text mentioning Etsy (and etsy.com links) is planted in a description, tags,
 * the shop announcement, a policy and a review to prove it reaches a client
 * exactly as stored.
 */
interface World {
  db: Db
  tools: McpTool[]
  scans: number[]
  photoReviewId: number
  plainReviewId: number
  cdnCalls: string[]
  readImage: (url: string) => Promise<{ data: Buffer; mimeType: string } | null>
}

async function buildWorld(): Promise<World> {
  const db = memDb()
  seedShop(db, { id: SHOP_ID })
  const etsy = new FakeEtsy(3)
  etsy.listings[0].description = 'Hand made. More at https://www.etsy.com/shop/CeramicStudioUA or etsy.me/abc — thanks, Etsy shoppers! #etsyfinds'
  etsy.listings[0].tags = ['mug', 'Etsy gift']
  etsy.shop.announcement = 'Welcome to our Etsy shop!'
  etsy.shop.policy_refunds = 'Contact us via Etsy messages: https://www.etsy.com/conversations/new'
  etsy.listings[0].videos = [
    {
      video_id: 91_234_567,
      height: 1080,
      width: 1920,
      thumbnail_url: 'https://v.etsystatic.com/video/upload/ac_none,so_0/thumb.jpg',
      video_url: 'https://v.etsystatic.com/video/upload/ac_none/video.mp4',
      video_state: 'active'
    }
  ]
  let t = 1_760_000_000_000
  const now = (): number => (t += 60_000)
  const scanner = createScanner({ db, client: etsy.client({ maxRetries: 1 }), now, getBuyerCountry: () => 'UA' })
  const syncer = createReviewSyncer({ db, client: etsy.client(), now: () => t })
  const scans: number[] = []

  scans.push(ok(await scanner.scanShop(SHOP_ID)).id)
  etsy.reviews = [1, 2, 3, 4, 5, 6].map((n) => mkEtsyReview(n))
  etsy.reviews[0].review = 'Best Etsy purchase ever'
  etsy.reviews[1].image_url_fullxfull = 'https://i.etsystatic.com/r/il_fullxfull.777.jpg'
  await syncer.sync(SHOP_ID, { scanId: scans[0] })

  etsy.listings.push(mkEtsyListing(4, { title: 'Brand new mug' }))
  const three = etsy.listings.find((l) => l.listing_id === 3)!
  etsy.listings = etsy.listings.filter((l) => l.listing_id !== 3)
  etsy.listings.find((l) => l.listing_id === 2)!.title = 'Renamed 2'
  etsy.listings.find((l) => l.listing_id === 1)!.num_favorers += 5
  etsy.promotions[1] = PROMO
  scans.push(ok(await scanner.scanShop(SHOP_ID)).id)

  etsy.listings = etsy.listings.filter((l) => l.listing_id !== 4)
  etsy.listings.push(three, mkEtsyListing(5, { title: 'Fifth' }))
  const fresh = Math.floor(t / 1000) + 5
  etsy.reviews.push(mkEtsyReview(7, { listing_id: 5, rating: 2, review: 'Arrived broken', created_timestamp: fresh, create_timestamp: fresh }))
  t += 120_000
  scans.push(ok(await scanner.scanShop(SHOP_ID)).id)
  await syncer.sync(SHOP_ID, { scanId: scans[2] })

  const cdn = fakeCdn()
  const handler = createImageProtocolHandler({ db, getStore: async () => null, fetch: cdn })
  const readImage = async (url: string) => {
    const res = await handler(new Request(url))
    if (!res.ok) return null
    return { data: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get('content-type') ?? '' }
  }
  const tools = createMcpTools({ db, now: () => t, readImage })
  const reviewIds = db.prepare('SELECT id, image_url_fullxfull FROM reviews ORDER BY id').all() as Array<{
    id: number
    image_url_fullxfull: string | null
  }>
  return {
    db,
    tools,
    scans,
    photoReviewId: reviewIds.find((r) => r.image_url_fullxfull)!.id,
    plainReviewId: reviewIds.find((r) => !r.image_url_fullxfull)!.id,
    cdnCalls: cdn.calls,
    readImage
  }
}

let w: World
beforeAll(async () => {
  w = await buildWorld()
})

/** Every text a client got, for the honesty sweep. */
const seen: string[] = []

async function call(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
  const res = await handleMcpMessage(
    { info: mcpServerInfo('0.1.0'), tools: w.tools },
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
  )
  if (!res || res.error) throw new Error(`rpc error: ${JSON.stringify(res)}`)
  const result = res.result as McpToolResult
  for (const c of result.content) if (c.type === 'text') seen.push(c.text)
  return result
}

/** A successful tool call's JSON. */
async function data<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await call(name, args)
  if (r.isError) throw new Error(`tool error: ${(r.content[0] as { text: string }).text}`)
  return JSON.parse((r.content[0] as { text: string }).text) as T
}

async function toolError(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const r = await call(name, args)
  expect(r.isError).toBe(true)
  return (r.content[0] as { text: string }).text
}

describe('the tool set', () => {
  it('matches the list the MCP modal shows', () => {
    expect(w.tools.map((t) => t.name)).toEqual(MCP_TOOL_SUMMARY.map((t) => t.name))
  })

  it('every tool has a title, a description and a closed object schema', () => {
    for (const t of w.tools) {
      expect(t.title).toBeTruthy()
      expect(t.description.length).toBeGreaterThan(40)
      expect(t.inputSchema.type).toBe('object')
      expect(t.inputSchema.additionalProperties).toBe(false)
      for (const r of t.inputSchema.required ?? []) expect(t.inputSchema.properties).toHaveProperty(r)
    }
  })

  it('core tools: only the image tools reach outside the app (openWorldHint), the database reads do not', async () => {
    const res = await handleMcpMessage(
      { info: mcpServerInfo('0.1.0'), tools: w.tools },
      { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    )
    const ann = new Map(
      (res!.result as { tools: Array<{ name: string; annotations: Record<string, boolean> }> }).tools.map((t) => [t.name, t.annotations])
    )
    const cdn = ['open_link', 'get_product_image', 'get_store_logo', 'get_product_video_preview', 'get_review_photo']
    const local = ['list_stores', 'get_store', 'search_products', 'get_product', 'get_product_history', 'list_snapshots', 'get_snapshot_changes', 'list_reviews', 'get_store_stats']
    for (const n of cdn) expect(ann.get(n), n).toMatchObject({ readOnlyHint: true, openWorldHint: true })
    for (const n of local) expect(ann.get(n), n).toMatchObject({ readOnlyHint: true, openWorldHint: false })
  })
})

describe('list_stores / get_store', () => {
  it('lists the store with its headline numbers and latest snapshot', async () => {
    const d = await data('list_stores')
    expect(d.count).toBe(1)
    const s = d.stores[0]
    expect(s).toMatchObject({
      id: SHOP_ID,
      name: 'CeramicStudioUA',
      active_products: 4,
      new_products_in_latest_snapshot: 1,
      latest_update_failed: false,
      latest_update_error: null
    })
    expect(s.url).toMatch(/^https:\/\/www\.etsy\.com\/shop\/CeramicStudioUA/)
    expect(s.latest_snapshot).toMatchObject({ id: w.scans[2], status: 'ok', added: 1, removed: 1, returned: 1 })
    expect(s.latest_snapshot.finished_at).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/)
  })

  it('the profile: policies, announcement exactly as on Etsy, stored reviews, the shop page', async () => {
    const s = await data('get_store', { store_id: SHOP_ID })
    expect(s.announcement).toBe('Welcome to our Etsy shop!')
    expect(s.policies.refunds).toBe('Contact us via Etsy messages: https://www.etsy.com/conversations/new')
    expect(s.policies.shipping).toBe('Ships in 1-3 days.')
    expect(s.stored_reviews).toMatchObject({ count: 7, complete: true, new_in_latest_snapshot: 1 })
    expect(s.url).toMatch(/^https:\/\/www\.etsy\.com\/shop\/CeramicStudioUA/)
    expect(s.latest_update_error).toBeNull()
    expect(s).not.toHaveProperty('icon_url')
    expect(s).not.toHaveProperty('banner_url')
  })

  it('an unknown store is a tool error that says where to find ids', async () => {
    expect(await toolError('get_store', { store_id: 999 })).toContain('list_stores')
    expect(await toolError('get_store', {})).toContain('Missing required argument "store_id"')
  })
})

describe('search_products', () => {
  it('active products, newest first, with compact summaries', async () => {
    const d = await data('search_products', { store_id: SHOP_ID })
    expect(d.total).toBe(4)
    expect(d.products.map((p: { id: number }) => p.id)).toEqual([5, 3, 2, 1])
    const p5 = d.products[0]
    expect(p5).toMatchObject({
      id: 5,
      store_id: SHOP_ID,
      title: 'Fifth',
      url: 'https://www.etsy.com/listing/5/item',
      status: 'active',
      new_in_latest_snapshot: true
    })
    expect(d.products[1].new_in_latest_snapshot).toBe(false)
  })

  it('removed products and all products', async () => {
    const removed = await data('search_products', { status: 'removed' })
    expect(removed.products.map((p: { id: number }) => p.id)).toEqual([4])
    expect(removed.products[0].status).toBe('removed')
    expect(removed.products[0].removed_at).toMatch(/Z$/)
    expect((await data('search_products', { status: 'all' })).total).toBe(5)
  })

  it('text search: title and tags; descriptions only when asked', async () => {
    expect((await data('search_products', { query: 'renamed' })).products.map((p: { id: number }) => p.id)).toEqual([2])
    expect((await data('search_products', { query: 'GIFT' })).total).toBe(1)
    expect((await data('search_products', { query: 'hand made' })).total).toBe(0)
    expect((await data('search_products', { query: 'hand made', search_description: true })).total).toBe(1)
  })

  it('on sale only, new only, sorting and paging', async () => {
    const sale = await data('search_products', { on_sale_only: true })
    expect(sale.products.map((p: { id: number }) => p.id)).toEqual([1])
    expect(sale.products[0].price).toMatchObject({ on_sale: true, discount_percent: 60, customer_country: 'UA' })
    expect((await data('search_products', { new_only: true })).products.map((p: { id: number }) => p.id)).toEqual([5])
    const fav = await data('search_products', { sort: 'most_favorited' })
    expect(fav.products[0].id).toBe(1)
    const cheap = await data('search_products', { sort: 'price_low' })
    expect(cheap.products[0].id).toBe(1)
    const page = await data('search_products', { limit: 2, offset: 1 })
    expect(page).toMatchObject({ total: 4, offset: 1 })
    expect(page.products.map((p: { id: number }) => p.id)).toEqual([3, 2])
  })

  it('bad arguments are tool errors', async () => {
    expect(await toolError('search_products', { sort: 'cheapest' })).toContain('must be one of')
    expect(await toolError('search_products', { limit: 1000 })).toContain('≤ 200')
    expect(await toolError('search_products', { store_id: 5 })).toContain('No store with id 5')
  })
})

describe('get_product', () => {
  it('prices like the store page: base, with tax, the sale price and the discount dates', async () => {
    const p = await data('get_product', { product_id: 1 })
    // 10.01 base → +20 % tax = 12.01 → −60 % = 4.80
    expect(p.price).toMatchObject({
      base: 10.01,
      base_currency: 'UAH',
      regular: 12.01,
      price_with_tax: 12.01,
      current: 4.8,
      currency: 'UAH',
      on_sale: true,
      discount_percent: 60,
      discount_amount: 7.21,
      customer_country: 'UA',
      discount_starts_at: new Date(PROMO.start * 1000).toISOString(),
      discount_ends_at: new Date(PROMO.end * 1000).toISOString()
    })
  })

  it('everything about the product: text exactly as on Etsy, the listing page, no photo URLs', async () => {
    const p = await data('get_product', { product_id: 1 })
    expect(p).toMatchObject({
      id: 1,
      store_name: 'CeramicStudioUA',
      status: 'active',
      state: 'active',
      url: 'https://www.etsy.com/listing/1/item'
    })
    expect(p.description).toBe(
      'Hand made. More at https://www.etsy.com/shop/CeramicStudioUA or etsy.me/abc — thanks, Etsy shoppers! #etsyfinds'
    )
    expect(p.tags).toEqual(['mug', 'Etsy gift'])
    expect(p.images).toHaveLength(2)
    expect(p.images[0]).toMatchObject({ position: 1 })
    expect(Object.keys(p.images[0])).not.toContain('url')
    expect(p).not.toHaveProperty('raw_json')
    expect(p.attributes).toHaveProperty('product_type')
    expect(p.favorites_change).toBe(0)
    expect(p.reviews).toMatchObject({ complete: true })
    expect(JSON.stringify(p)).not.toMatch(/etsystatic/i)
  })

  it('an unknown product is a tool error', async () => {
    expect(await toolError('get_product', { product_id: 424242 })).toContain('search_products')
  })
})

describe('get_product_history', () => {
  it('popularity and prices per snapshot, the discount and every change', async () => {
    const h = await data('get_product_history', { product_id: 1 })
    expect(h.snapshot_count).toBe(3)
    expect(h.snapshots.map((s: { snapshot_id: number }) => s.snapshot_id)).toEqual(w.scans)
    expect(h.snapshots[0]).toMatchObject({ base_price: 10.01, current_price: 12.01, discount_percent: null })
    expect(h.snapshots[2]).toMatchObject({ current_price: 4.8, discount_percent: 60, currency: 'UAH' })
    expect(h.snapshots[1].favorites - h.snapshots[0].favorites).toBe(5)
    expect(h.discounts).toHaveLength(1)
    expect(h.discounts[0]).toMatchObject({ discount_percent: 60, status: 'running', how_it_started: 'started between two snapshots' })
    const limited = await data('get_product_history', { product_id: 1, limit: 1 })
    expect(limited.snapshots.map((s: { snapshot_id: number }) => s.snapshot_id)).toEqual([w.scans[2]])
  })

  it('a renamed product shows the old and the new title', async () => {
    const h = await data('get_product_history', { product_id: 2 })
    expect(h.changes).toEqual([
      {
        snapshot_id: w.scans[1],
        at: expect.stringMatching(/Z$/),
        kind: 'changed',
        changed_fields: ['title'],
        before: { title: 'Listing 2' },
        after: { title: 'Renamed 2' }
      }
    ])
  })

  it('a product that left and came back', async () => {
    const h = await data('get_product_history', { product_id: 3 })
    expect(h.changes.map((c: { kind: string }) => c.kind)).toEqual(['removed', 'returned'])
  })
})

describe('snapshots', () => {
  it('list_snapshots: newest first', async () => {
    const d = await data('list_snapshots', { store_id: SHOP_ID })
    expect(d.snapshots.map((s: { id: number }) => s.id)).toEqual([...w.scans].reverse())
    expect(d.snapshots[2]).toMatchObject({ is_first: true, products: 3 })
  })

  it('get_snapshot_changes: the latest by default — "what is new"', async () => {
    const d = await data('get_snapshot_changes', { store_id: SHOP_ID })
    expect(d.snapshot.id).toBe(w.scans[2])
    expect(d.added.items.map((p: { id: number }) => p.id)).toEqual([5])
    expect(d.removed.items.map((p: { id: number }) => p.id)).toEqual([4])
    expect(d.returned.items.map((p: { id: number }) => p.id)).toEqual([3])
    expect(d.new_reviews.total).toBe(1)
    expect(d.new_reviews.items[0]).toMatchObject({ product_id: 5, rating: 2, text: 'Arrived broken', is_new: true })
  })

  it('an older snapshot: edits with old → new and the discounts that started', async () => {
    const d = await data('get_snapshot_changes', { store_id: SHOP_ID, snapshot_id: w.scans[1] })
    expect(d.changed.items).toEqual([
      {
        product_id: 2,
        title: 'Renamed 2',
        changed_fields: ['title'],
        before: { title: 'Listing 2' },
        after: { title: 'Renamed 2' }
      }
    ])
    expect(d.discounts_started.total).toBe(1)
    expect(d.discounts_started.items[0]).toMatchObject({ product_id: 1, discount_percent: 60, sale_price: 4.8 })
    expect(d.added.total).toBe(1)
  })

  it('caps every group at `limit` but keeps exact totals', async () => {
    const d = await data('get_snapshot_changes', { store_id: SHOP_ID, limit: 1 })
    expect(d.added).toMatchObject({ total: 1 })
    expect(d.new_reviews.items).toHaveLength(1)
  })

  it('a snapshot of another store / an unknown one is a tool error', async () => {
    expect(await toolError('get_snapshot_changes', { store_id: SHOP_ID, snapshot_id: 999 })).toContain('has no snapshot 999')
  })
})

describe('list_reviews', () => {
  it('all reviews, newest first, with the reviewed product', async () => {
    const d = await data('list_reviews', { store_id: SHOP_ID })
    expect(d.total).toBe(7)
    expect(d.reviews[0]).toMatchObject({ text: 'Arrived broken', product_id: 5, product_title: 'Fifth', rating: 2 })
    expect(d.reviews[0].created_at).toMatch(/Z$/)
  })

  it('filters: product, rating, dates, text, with text only; sorting; paging', async () => {
    const byProduct = await data('list_reviews', { product_id: 5 })
    expect(byProduct.total).toBe(1)
    const low = await data('list_reviews', { max_rating: 2 })
    expect(low.reviews.every((r: { rating: number }) => r.rating <= 2)).toBe(true)
    const high = await data('list_reviews', { min_rating: 5 })
    expect(high.reviews.every((r: { rating: number }) => r.rating === 5)).toBe(true)
    const day3 = new Date((1_700_000_000 + 3 * 86_400) * 1000).toISOString()
    const day4 = new Date((1_700_000_000 + 4 * 86_400) * 1000).toISOString()
    expect((await data('list_reviews', { since: day3, until: day4 })).total).toBe(2)
    const text = await data('list_reviews', { query: 'purchase' })
    expect(text.reviews.map((r: { text: string }) => r.text)).toEqual(['Best Etsy purchase ever'])
    expect((await data('list_reviews', { query: '100%' })).total).toBe(0)
    const sorted = await data('list_reviews', { sort: 'lowest_rating', limit: 2, offset: 0 })
    expect(sorted.reviews[0].rating).toBeLessThanOrEqual(sorted.reviews[1].rating)
    expect(sorted.reviews).toHaveLength(2)
  })

  it('a bad date is a tool error', async () => {
    expect(await toolError('list_reviews', { since: 'last tuesday' })).toContain('ISO date')
  })
})

describe('get_store_stats', () => {
  it('per snapshot numbers, intervals and review buckets', async () => {
    const d = await data('get_store_stats', { store_id: SHOP_ID })
    expect(d.period).toBe('all')
    expect(d.snapshots).toHaveLength(3)
    expect(d.snapshots[2]).toMatchObject({ snapshot_id: w.scans[2], discounted_products: 1 })
    expect(d.intervals).toHaveLength(2)
    expect(d.reviews).toMatchObject({ loaded: true, grouped_by: 'month', total: 7 })
    expect(d.reviews.buckets.length).toBeGreaterThan(0)
    const weekly = await data('get_store_stats', { store_id: SHOP_ID, period: '7d' })
    expect(weekly.reviews.grouped_by).toBe('week')
    expect(await toolError('get_store_stats', { store_id: SHOP_ID, period: '1y' })).toContain('must be one of')
  })
})

describe('photos', () => {
  it('get_product_image: the main photo as an image (medium = the 570 px size)', async () => {
    const r = await call('get_product_image', { product_id: 1 })
    expect(r.isError).toBeFalsy()
    const meta = JSON.parse((r.content[0] as { text: string }).text)
    expect(meta).toMatchObject({ product_id: 1, position: 1, of: 2 })
    const img = r.content[1] as { type: string; data: string; mimeType: string }
    expect(img.type).toBe('image')
    expect(img.mimeType).toBe('image/jpeg')
    const url = w.cdnCalls[w.cdnCalls.length - 1]
    expect(url).toContain('570xN')
    expect(Buffer.from(img.data, 'base64')).toEqual(cdnBytes(url))
  })

  it('by image id, by position, full size; out-of-range is a tool error', async () => {
    const p = await data('get_product', { product_id: 1 })
    const second = p.images[1].image_id
    const r = await call('get_product_image', { product_id: 1, image_id: second, size: 'full' })
    expect(JSON.parse((r.content[0] as { text: string }).text)).toMatchObject({ image_id: second, position: 2 })
    expect(w.cdnCalls[w.cdnCalls.length - 1]).toContain('fullxfull')
    expect(await toolError('get_product_image', { product_id: 1, position: 3 })).toContain('has 2 photo(s)')
    expect(await toolError('get_product_image', { product_id: 1, image_id: 1 })).toContain('has no photo 1')
  })

  it('get_review_photo: the buyer photo; a review without one is a tool error', async () => {
    const r = await call('get_review_photo', { review_id: w.photoReviewId })
    const img = r.content[1] as { data: string }
    expect(Buffer.from(img.data, 'base64')).toEqual(cdnBytes('https://i.etsystatic.com/r/il_fullxfull.777.jpg'))
    expect(await toolError('get_review_photo', { review_id: w.plainReviewId })).toContain('has no photo')
    expect(await toolError('get_review_photo', { review_id: 99_999 })).toContain('No review')
  })

  it('get_store_logo: the logo (default) and the banner; flags in list_stores / get_store', async () => {
    const stores = await data('list_stores')
    expect(stores.stores[0].has_logo).toBe(true)
    const store = await data('get_store', { store_id: SHOP_ID })
    expect(store).toMatchObject({ has_logo: true, has_banner: true, reported_active_products: expect.any(Number) })
    expect((await data('get_product', { product_id: 1 })).attributes).toHaveProperty('non_taxable')

    const logo = await call('get_store_logo', { store_id: SHOP_ID })
    expect(JSON.parse((logo.content[0] as { text: string }).text)).toMatchObject({ store_id: SHOP_ID, kind: 'logo' })
    const img = logo.content[1] as { type: string; data: string; mimeType: string }
    expect(img).toMatchObject({ type: 'image', mimeType: 'image/jpeg' })
    expect(Buffer.from(img.data, 'base64')).toEqual(
      cdnBytes('https://i.etsystatic.com/isla/bb22cc/12345678/isla_fullxfull.12345678_efgh.jpg')
    )
    const banner = await call('get_store_logo', { store_id: SHOP_ID, kind: 'banner' })
    expect(Buffer.from((banner.content[1] as { data: string }).data, 'base64')).toEqual(
      cdnBytes('https://i.etsystatic.com/isbl/aa11bb/12345678/isbl_760x100.12345678_abcd.jpg')
    )
    expect(await toolError('get_store_logo', { store_id: 999 })).toContain('999')
    expect(await toolError('get_store_logo', { store_id: SHOP_ID, kind: 'icon' })).toContain('must be one of')
  })

  it('get_store_logo: a store without a logo/banner is a tool error', async () => {
    const db = memDb()
    seedShop(db, { id: 7, iconUrl: null })
    const tools = createMcpTools({ db, readImage: async () => ({ data: Buffer.from('x'), mimeType: 'image/png' }) })
    const run = async (args: Record<string, unknown>) => {
      const res = await handleMcpMessage(
        { info: mcpServerInfo('0.1.0'), tools },
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_store_logo', arguments: args } }
      )
      const r = res!.result as McpToolResult
      expect(r.isError).toBe(true)
      return (r.content[0] as { text: string }).text
    }
    expect(await run({ store_id: 7 })).toContain('has no logo')
    expect(await run({ store_id: 7, kind: 'banner' })).toContain('has no banner')
  })

  it('get_product_video_preview: the video frame; the product lists its videos', async () => {
    const p = await data('get_product', { product_id: 1 })
    expect(p.video_count).toBe(1)
    expect(p.videos).toEqual([{ video_id: 91_234_567, position: 1, width: 1920, height: 1080, state: 'active', has_preview: true }])
    const r = await call('get_product_video_preview', { product_id: 1 })
    expect(JSON.parse((r.content[0] as { text: string }).text)).toMatchObject({ product_id: 1, video_id: 91_234_567, of: 1 })
    expect(Buffer.from((r.content[1] as { data: string }).data, 'base64')).toEqual(
      cdnBytes('https://v.etsystatic.com/video/upload/ac_none,so_0/thumb.jpg')
    )
    const byId = await call('get_product_video_preview', { product_id: 1, video_id: 91_234_567 })
    expect(byId.isError).toBeFalsy()
    expect(await toolError('get_product_video_preview', { product_id: 2 })).toContain('has no videos')
    expect(await toolError('get_product_video_preview', { product_id: 1, position: 2 })).toContain('has 1 video(s)')
    expect(await toolError('get_product_video_preview', { product_id: 1, video_id: 5 })).toContain('has no video 5')
  })

  describe('formats a client can show (Etsy\'s CDN sends Chromium AVIF/WebP for some 570 px copies)', () => {
    /** Tools whose photo reads answer per size: `mime` or null (missing). */
    function toolsWith(bySize: Record<string, string | null>) {
      const asked: string[] = []
      const tools = createMcpTools({
        db: w.db,
        readImage: async (url) => {
          asked.push(url)
          const size = url.split('/').pop()!
          const mime = bySize[size]
          return mime ? { data: Buffer.from(`${size}-bytes`), mimeType: mime } : null
        }
      })
      const run = (args: Record<string, unknown>) => tools.find((t) => t.name === 'get_product_image')!.run({ product_id: 1, ...args })
      return { run, asked }
    }
    const image = (r: McpToolResult) => r.content[1] as { data: string; mimeType: string }

    it('an AVIF medium copy is replaced by the JPEG original', async () => {
      const { run, asked } = toolsWith({ '570xN': 'image/avif', fullxfull: 'image/jpeg' })
      const r = await run({})
      expect(r.isError).toBeFalsy()
      expect(image(r).mimeType).toBe('image/jpeg')
      expect(Buffer.from(image(r).data, 'base64').toString()).toBe('fullxfull-bytes')
      expect(asked.map((u) => u.split('/').pop())).toEqual(['570xN', 'fullxfull'])
    })

    it('a WebP medium copy is fine as it is', async () => {
      const { run, asked } = toolsWith({ '570xN': 'image/webp', fullxfull: 'image/jpeg' })
      expect(image(await run({})).mimeType).toBe('image/webp')
      expect(asked).toHaveLength(1)
    })

    it('a missing medium copy falls back to the original too', async () => {
      const { run } = toolsWith({ '570xN': null, fullxfull: 'image/jpeg' })
      expect(Buffer.from(image(await run({})).data, 'base64').toString()).toBe('fullxfull-bytes')
    })

    it('content types are normalized (case, parameters, image/jpg)', async () => {
      const { run } = toolsWith({ '570xN': 'Image/JPG; charset=binary' })
      expect(image(await run({})).mimeType).toBe('image/jpeg')
      expect(imageMime('image/PNG')).toBe('image/png')
    })

    it('nothing showable: a tool error naming the format', async () => {
      const { run } = toolsWith({ '570xN': 'image/avif', fullxfull: 'image/avif' })
      const r = await run({})
      expect(r.isError).toBe(true)
      expect((r.content[0] as { text: string }).text).toContain('image/avif')
      const full = toolsWith({ '570xN': 'image/jpeg', fullxfull: 'image/heic' })
      const r2 = await full.run({ size: 'full' })
      expect(r2.isError).toBe(true)
      expect(full.asked.map((u) => u.split('/').pop())).toEqual(['fullxfull'])
    })
  })

  it('a photo that cannot be read is a tool error, not a crash', async () => {
    const tools = createMcpTools({ db: w.db, readImage: async () => null })
    const t = tools.find((x) => x.name === 'get_product_image')!
    const res = await t.run({ product_id: 1 })
    expect(res.isError).toBe(true)
    const big = createMcpTools({
      db: w.db,
      readImage: async () => ({ data: Buffer.alloc(5 * 1024 * 1024 + 1), mimeType: 'image/jpeg' })
    })
    const r2 = await big.find((x) => x.name === 'get_product_image')!.run({ product_id: 1, size: 'full' })
    expect((r2.content[0] as { text: string }).text).toBe('The image is larger than 5 MB and cannot be returned. Ask for size "medium".')
  })

  it('messages fit the tool: the "medium" hint only for get_product_image size full; CDN-only images never mention a local copy', async () => {
    const big = createMcpTools({
      db: w.db,
      readImage: async () => ({ data: Buffer.alloc(5 * 1024 * 1024 + 1), mimeType: 'image/jpeg' })
    })
    const text = async (tools: McpTool[], name: string, args: Record<string, unknown>) => {
      const r = await tools.find((x) => x.name === name)!.run(args)
      expect(r.isError).toBe(true)
      return (r.content[0] as { text: string }).text
    }
    const plain = 'The image is larger than 5 MB and cannot be returned.'
    expect(await text(big, 'get_product_image', { product_id: 1 })).toBe(plain)
    expect(await text(big, 'get_review_photo', { review_id: w.photoReviewId })).toBe(plain)
    expect(await text(big, 'get_store_logo', { store_id: SHOP_ID })).toBe(plain)
    expect(await text(big, 'get_product_video_preview', { product_id: 1 })).toBe(plain)

    const none = createMcpTools({ db: w.db, readImage: async () => null })
    const local = "The image is not available right now (no local copy, and it could not be downloaded from Etsy's image CDN)."
    const cdnOnly = "The image could not be downloaded from Etsy's image CDN right now."
    expect(await text(none, 'get_product_image', { product_id: 1 })).toBe(local)
    expect(await text(none, 'get_review_photo', { review_id: w.photoReviewId })).toBe(local)
    expect(await text(none, 'get_store_logo', { store_id: SHOP_ID })).toBe(cdnOnly)
    expect(await text(none, 'get_product_video_preview', { product_id: 1 })).toBe(cdnOnly)
  })
})

describe('open_link', () => {
  /** An Etsy listing the app doesn't store, served live. */
  const LIVE_ID = 777_000_111
  const liveListing = (id: number, over: Record<string, unknown> = {}) => ({
    listing_id: id,
    shop_id: 4242,
    title: 'Live &amp; well',
    url: `https://www.etsy.com/listing/${id}/live-and-well`,
    state: 'active',
    price: { amount: 500, divisor: 100, currency_code: 'USD' },
    quantity: 3,
    num_favorers: 4,
    views: 9,
    featured_rank: -1,
    description: 'Hand made &quot;live&quot;. https://www.etsy.com/shop/Other',
    tags: ['a&amp;b', 'Etsy gift'],
    materials: ['paper'],
    listing_type: 'download',
    created_timestamp: 1_760_000_000,
    original_creation_timestamp: 1_750_000_000,
    updated_timestamp: 1_760_100_000,
    images: [mkEtsyImage(id, 2), mkEtsyImage(id, 1)],
    ...over
  })

  function liveWorld(
    opts: {
      listings?: Record<number, Record<string, unknown>>
      /** Listings Etsy shows only to their owner (a bearer token): drafts, inactive … */
      ownerOnly?: Record<number, Record<string, unknown>>
      /** How Etsy hides an owner-only listing from the API key alone (404, or 403). */
      hiddenStatus?: number
      signedIn?: boolean
      hasApiKey?: boolean
      client?: boolean
      cdn?: boolean
    } = {}
  ) {
    const listings: Record<number, Record<string, unknown>> = opts.listings ?? { [LIVE_ID]: liveListing(LIVE_ID) }
    const ownerOnly = opts.ownerOnly ?? {}
    const bearer = (init?: RequestInit) => !!new Headers(init?.headers as HeadersInit).get('authorization')
    const hidden = () => ({ status: opts.hiddenStatus ?? 404, body: { error: 'Listing not found' } })
    const fetch = routedFetch({
      'GET /v3/application/listings/{id}': (url, init) => {
        const id = Number(url.pathname.split('/').pop())
        if (ownerOnly[id]) return bearer(init) ? { status: 200, body: ownerOnly[id] } : hidden()
        const l = listings[id]
        return l ? { status: 200, body: l } : { status: 404, body: { error: 'Listing not found' } }
      },
      'GET /v3/application/listings/{id}/videos/{video}': (url, init) => {
        const id = Number(url.pathname.split('/')[4])
        if (ownerOnly[id] && !bearer(init)) return hidden()
        return url.pathname.endsWith('/videos/55')
          ? {
              status: 200,
              body: { video_id: 55, width: 640, height: 360, video_state: 'active', thumbnail_url: 'https://v.etsystatic.com/video/thumb55.jpg' }
            }
          : { status: 404, body: { error: 'Video not found' } }
      }
    })
    const cdn = fakeCdn()
    const fetched: string[] = []
    const tools = createMcpTools({
      db: w.db,
      readImage: w.readImage,
      own: opts.client === false
        ? undefined
        : {
            client: testClient(fetch, opts.signedIn ? 'tok' : null),
            status: () => (opts.signedIn ? signedIn() : signedOut),
            writesAllowed: () => false,
            taxonomy: async () => []
          },
      ...(opts.hasApiKey === undefined ? {} : { hasApiKey: () => opts.hasApiKey! }),
      fetchCdnImage:
        opts.cdn === false
          ? undefined
          : async (url) => {
              fetched.push(url)
              const r = await cdn(url)
              return { data: Buffer.from(await r.arrayBuffer()), mimeType: r.headers.get('content-type') ?? '' }
            }
    })
    const open = async (args: Record<string, unknown>) => {
      const res = await handleMcpMessage(
        { info: mcpServerInfo('0.1.0'), tools },
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'open_link', arguments: args } }
      )
      const r = res!.result as McpToolResult
      for (const c of r.content) if (c.type === 'text') seen.push(c.text)
      return r
    }
    return { open, fetch, fetched }
  }
  const json = (r: McpToolResult) => JSON.parse((r.content[0] as { text: string }).text)
  const bytesOf = (r: McpToolResult) => Buffer.from((r.content[1] as { data: string }).data, 'base64')
  const errText = (r: McpToolResult) => {
    expect(r.isError).toBe(true)
    return (r.content[0] as { text: string }).text
  }

  it('is the first tool', () => {
    expect(w.tools[0].name).toBe('open_link')
    expect(MCP_TOOL_SUMMARY[0]).toEqual({ name: 'open_link', text: 'відкрити посилання чи адресу з програми: товар, фото, відгук, магазин, чернетку' })
  })

  it('a product reference or an Etsy listing link → the same JSON as get_product', async () => {
    const product = await data('get_product', { product_id: 2 })
    expect(await data('open_link', { link: productRef(2) })).toEqual({ opened: 'product', source: 'local', ...product })
    // inside a sentence, with a locale and a slug/query
    const d = await data('open_link', { link: 'глянь цей товар https://www.etsy.com/uk/listing/2/renamed-2?ref=shop_home, що скажеш?' })
    expect(d).toEqual({ opened: 'product', source: 'local', ...product })
  })

  it('a photo reference in a sentence → the image + where it is; full size; a second photo by id', async () => {
    const p = await data('get_product', { product_id: 1 })
    const second = p.images[1].image_id
    const r = await call('open_link', { link: `подивись на цю картинку з товару: ${photoRef(1, second)} — що на ній?` })
    expect(r.isError).toBeFalsy()
    expect(json(r)).toEqual({
      opened: 'photo',
      source: 'local',
      product_id: 1,
      title: p.title,
      image_id: second,
      position: 2,
      of: 2,
      alt_text: p.images[1].alt_text
    })
    expect(r.content[1]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' })
    expect(w.cdnCalls[w.cdnCalls.length - 1]).toContain('570xN')
    expect(bytesOf(r)).toEqual(cdnBytes(w.cdnCalls[w.cdnCalls.length - 1]))
    await call('open_link', { link: photoRef(1, second), size: 'full' })
    expect(w.cdnCalls[w.cdnCalls.length - 1]).toContain('fullxfull')
  })

  it('a photo the stored listing does not have, without a live client: the refusal names it', async () => {
    expect(errText(await call('open_link', { link: photoRef(1, 5) }))).toContain('has no photo 5')
  })

  it('a video reference → its preview frame', async () => {
    const r = await call('open_link', { link: videoRef(1, 91_234_567) })
    expect(json(r)).toMatchObject({ opened: 'video_preview', source: 'local', product_id: 1, video_id: 91_234_567, position: 1, of: 1 })
    expect(bytesOf(r)).toEqual(cdnBytes('https://v.etsystatic.com/video/upload/ac_none,so_0/thumb.jpg'))
  })

  it('a review photo → the image + the review (rating, text, date, listing)', async () => {
    const row = w.db.prepare('SELECT listing_id, rating, review, created_timestamp FROM reviews WHERE id = ?').get(w.photoReviewId) as {
      listing_id: number
      rating: number
      review: string
      created_timestamp: number
    }
    const r = await call('open_link', { link: `this one: ${reviewPhotoRef(w.photoReviewId)}` })
    expect(json(r)).toMatchObject({
      opened: 'review_photo',
      review_id: w.photoReviewId,
      store_id: SHOP_ID,
      product_id: row.listing_id,
      rating: row.rating,
      text: row.review,
      created_at: new Date(row.created_timestamp * 1000).toISOString()
    })
    expect(bytesOf(r)).toEqual(cdnBytes('https://i.etsystatic.com/r/il_fullxfull.777.jpg'))
    // get_review_photo carries the same review facts
    const g = await call('get_review_photo', { review_id: w.photoReviewId })
    expect(json(g)).toMatchObject({ review_id: w.photoReviewId, rating: row.rating, product_id: row.listing_id })
    expect(json(g)).not.toHaveProperty('opened')
    expect(errText(await call('open_link', { link: reviewPhotoRef(w.plainReviewId) }))).toContain('has no photo')
    expect(errText(await call('open_link', { link: reviewPhotoRef(99_999) }))).toContain('No review')
  })

  it('a store reference, a shop link (any case) → like get_store; logo and banner → the image', async () => {
    const store = await data('get_store', { store_id: SHOP_ID })
    expect(await data('open_link', { link: storeRef(SHOP_ID) })).toEqual({ opened: 'store', ...store })
    expect(await data('open_link', { link: 'що це за магазин? https://www.etsy.com/shop/ceramicstudioua?ref=x' })).toEqual({ opened: 'store', ...store })
    const logo = await call('open_link', { link: storeImageRef(SHOP_ID) })
    expect(json(logo)).toEqual({ opened: 'store_logo', store_id: SHOP_ID, name: 'CeramicStudioUA', kind: 'logo' })
    expect(bytesOf(logo)).toEqual(cdnBytes('https://i.etsystatic.com/isla/bb22cc/12345678/isla_fullxfull.12345678_efgh.jpg'))
    const banner = await call('open_link', { link: storeImageRef(SHOP_ID, 'banner') })
    expect(json(banner)).toMatchObject({ opened: 'store_banner', kind: 'banner' })
    expect(errText(await call('open_link', { link: storeRef(999) }))).toContain('No tracked store with id 999')
    expect(errText(await call('open_link', { link: storeImageRef(999) }))).toContain('No tracked store with id 999')
  })

  it('a shop that is not tracked: says so and where to go', async () => {
    const t = errText(await call('open_link', { link: 'https://www.etsy.com/shop/NobodyTracksMe' }))
    expect(t).toContain('"NobodyTracksMe" is not tracked in the app')
    expect(t).toContain('search_market')
    expect(t).toContain('+ Додати магазин')
  })

  it('a draft → as list_prepared_products shows it; its photo → the image; a file or a foreign photo is refused', async () => {
    const mk = (title: string) =>
      saveDraft(
        w.db,
        {
          source: 'mcp',
          fields: { ...EMPTY_DRAFT_FIELDS, title },
          photos: [
            { name: 'cover.jpg', data: new Uint8Array(Buffer.from('COVER-BYTES')) },
            { name: 'back.png', data: new Uint8Array(Buffer.from('BACK-BYTES')) }
          ],
          files: [{ name: 'planner.pdf', data: new Uint8Array(Buffer.from('PDF')) }]
        },
        1_760_000_000_000
      )
    const d = mk('Draft mug')
    const other = mk('Other draft')
    const listed = createMcpTools({ db: w.db }).find((t) => t.name === 'list_prepared_products')!
    const all = JSON.parse(((await listed.run({})).content[0] as { text: string }).text)
    const shown = all.drafts.find((x: { draft_id: number }) => x.draft_id === d.id)
    expect(await data('open_link', { link: draftRef(d.id) })).toEqual({ opened: 'draft', ...shown })

    const r = await call('open_link', { link: `ось фото чернетки ${draftPhotoRef(d.id, d.photos[1].id)}` })
    expect(json(r)).toEqual({
      opened: 'draft_photo',
      draft_id: d.id,
      title: 'Draft mug',
      photo_id: d.photos[1].id,
      position: 2,
      of: 2,
      name: 'back.png'
    })
    expect(r.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' })
    expect(bytesOf(r).toString()).toBe('BACK-BYTES')

    expect(errText(await call('open_link', { link: draftPhotoRef(d.id, d.files[0].id) }))).toContain('is a buyer file, not a photo')
    expect(errText(await call('open_link', { link: draftPhotoRef(d.id, other.photos[0].id) }))).toContain(`Draft ${d.id} has no photo`)
    expect(errText(await call('open_link', { link: draftRef(99_999) }))).toContain('No draft 99999')
    expect(errText(await call('open_link', { link: draftPhotoRef(99_999, 1) }))).toContain('No draft 99999')
  })

  it('every reference the app\'s "Копіювати для Claude" buttons copy opens — built from the data the renderer gets', async () => {
    // A draft with photos, as the drafts window lists it.
    const draft = saveDraft(
      w.db,
      {
        source: 'app',
        fields: { ...EMPTY_DRAFT_FIELDS, title: 'Round-trip draft' },
        photos: [
          { name: 'a.jpg', data: new Uint8Array(Buffer.from('A-BYTES')) },
          { name: 'b.png', data: new Uint8Array(Buffer.from('B-BYTES')) }
        ]
      },
      1_760_000_000_000
    )
    const refs: Array<{ ref: string; opened: string; expect: Record<string, unknown> }> = []
    // Shop header logo (ShopView: storeImageRef(shop.id, 'logo') while the shop has an icon).
    for (const s of listShopSummaries(w.db))
      if (s.iconUrl) refs.push({ ref: storeImageRef(s.id, 'logo'), opened: 'store_logo', expect: { store_id: s.id } })
    // Every listing the app stores (active, removed, returned): the card / listing window gallery
    // (the renderer's own listingGallery), the main-photo icon, and its videos.
    const ids = (w.db.prepare('SELECT listing_id FROM listings ORDER BY listing_id').all() as Array<{ listing_id: number }>).map((r) => r.listing_id)
    expect(ids.length).toBeGreaterThan(3)
    for (const id of ids) {
      const l = getDbListing(w.db, id)!
      expect(l.images.length).toBeGreaterThan(0)
      listingGallery(l.images, l.title, l.listingId).forEach((g, i) =>
        refs.push({ ref: g.ref!, opened: 'photo', expect: { product_id: l.listingId, image_id: l.images[i].id, position: i + 1 } })
      )
      expect(listingGallery(l.images, l.title, l.listingId)[0].ref).toBe(photoRef(l.listingId, l.images[0].id))
      for (const v of l.videos) refs.push({ ref: videoRef(l.listingId, v.id), opened: 'video_preview', expect: { product_id: l.listingId, video_id: v.id } })
      // Review photos in the listing window.
      for (const r of listListingReviews(w.db, id, 0, 100).reviews)
        if (r.hasImage) refs.push({ ref: reviewPhotoRef(r.id), opened: 'review_photo', expect: { review_id: r.id } })
    }
    // Scan results: new reviews (listing thumbnail + buyer photo) and the "Акції" rows of every scan.
    for (const scanId of w.scans) {
      for (const r of listNewReviews(w.db, scanId)) {
        if (r.listingId != null && r.listingImageId != null)
          refs.push({ ref: photoRef(r.listingId, r.listingImageId), opened: 'photo', expect: { product_id: r.listingId, image_id: r.listingImageId } })
        if (r.hasImage) refs.push({ ref: reviewPhotoRef(r.id), opened: 'review_photo', expect: { review_id: r.id } })
      }
      const promos = listScanPromotions(w.db, scanId)
      for (const p of [...promos.started, ...promos.ended])
        if (p.listingImageId != null)
          refs.push({ ref: photoRef(p.listingId, p.listingImageId), opened: 'photo', expect: { product_id: p.listingId, image_id: p.listingImageId } })
    }
    // Statistics → "Топ товарів за ростом".
    const stats = shopStatsPayload(w.db, SHOP_ID, 'all', Date.now())!
    for (const r of [...stats.top.views, ...stats.top.favorers, ...stats.top.reviews])
      if (r.imageId != null) refs.push({ ref: photoRef(r.listingId, r.imageId), opened: 'photo', expect: { product_id: r.listingId, image_id: r.imageId } })
    // Drafts window: every saved photo of every draft.
    for (const d of listDrafts(w.db))
      for (const m of d.photos) refs.push({ ref: draftPhotoRef(d.id, m.id), opened: 'draft_photo', expect: { draft_id: d.id, photo_id: m.id } })

    const kinds = new Set(refs.map((r) => r.opened))
    expect([...kinds].sort()).toEqual(['draft_photo', 'photo', 'review_photo', 'store_logo', 'video_preview'])
    expect(refs.some((r) => r.ref === draftPhotoRef(draft.id, draft.photos[1].id))).toBe(true)
    for (const { ref, opened, expect: want } of refs) {
      // the reference alone and pasted into a sentence
      for (const link of [ref, `подивись на цю картинку: ${ref}, що скажеш?`]) {
        const r = await call('open_link', { link })
        expect(r.isError, `${link}: ${(r.content[0] as { text: string }).text}`).toBeFalsy()
        expect(json(r)).toMatchObject({ opened, ...want })
        expect(r.content[1]).toMatchObject({ type: 'image' })
      }
    }
  })

  it('nothing recognised: an error listing the accepted forms', async () => {
    for (const link of ['подивись на це', 'etsy-tracker://product/abc', 'https://example.com/listing/123456', 'https://evil-etsy.com/listing/1234567']) {
      const t = errText(await call('open_link', { link }))
      expect(t).toContain('No link or reference found')
      expect(t).toContain('etsy-tracker://product/<id>/photo/<image_id>')
      expect(t).toContain('https://www.etsy.com/listing/<id>')
    }
    expect(await toolError('open_link', { link: '' })).toBeTruthy()
    expect(await toolError('open_link', {})).toContain('link')
    expect(await toolError('open_link', { link: 'x'.repeat(2001) })).toBeTruthy()
  })

  it('a listing the app does not store, without a live client: a clear refusal', async () => {
    const t = errText(await call('open_link', { link: `https://www.etsy.com/listing/${LIVE_ID}` }))
    expect(t).toContain(`Product ${LIVE_ID} is not in the app's database`)
    expect(t).toContain('+ Додати магазин')
    expect(errText(await call('open_link', { link: photoRef(LIVE_ID, 1) }))).toContain("is not in the app's database")
  })

  describe('live fallbacks (Etsy API key, the CDN)', () => {
    it('a listing the app does not store → a compact live summary, one request with includes=Images', async () => {
      const { open, fetch } = liveWorld()
      const r = await open({ link: String(LIVE_ID) })
      expect(r.isError).toBeFalsy()
      const d = json(r)
      expect(d).toMatchObject({
        opened: 'product',
        source: 'live',
        id: LIVE_ID,
        store_id: 4242,
        store_tracked: false,
        title: 'Live & well',
        url: `https://www.etsy.com/listing/${LIVE_ID}/live-and-well`,
        state: 'active',
        price: { base: 5, base_currency: 'USD' },
        quantity: 3,
        favorites: 4,
        views: 9,
        featured_position: null,
        description: 'Hand made "live". https://www.etsy.com/shop/Other',
        tags: ['a&b', 'Etsy gift'],
        materials: ['paper'],
        product_type: 'digital',
        created_at: new Date(1_750_000_000_000).toISOString(),
        listed_at: new Date(1_760_000_000_000).toISOString()
      })
      // photos in rank order, each with the reference that opens it
      expect(d.images.map((i: { image_id: number; position: number; link: string }) => [i.image_id, i.position, i.link])).toEqual([
        [LIVE_ID * 10 + 1, 1, photoRef(LIVE_ID, LIVE_ID * 10 + 1)],
        [LIVE_ID * 10 + 2, 2, photoRef(LIVE_ID, LIVE_ID * 10 + 2)]
      ])
      expect(d.note).toContain('read live from Etsy')
      expect(fetch.calls).toHaveLength(1)
      const u = new URL(fetch.calls[0].url)
      expect(u.pathname).toBe(`/v3/application/listings/${LIVE_ID}`)
      expect(u.searchParams.get('includes')).toBe('Images')
      expect(fetch.calls[0].headers['x-api-key']).toBe('keystring:secret')
      expect(fetch.calls[0].headers).not.toHaveProperty('authorization')
    })

    it('a stored listing never goes live', async () => {
      const { open, fetch } = liveWorld()
      expect(json(await open({ link: productRef(2) }))).toMatchObject({ source: 'local', id: 2 })
      expect(fetch.calls).toHaveLength(0)
    })

    it('a listing Etsy does not have (404): a tool error saying so', async () => {
      const { open } = liveWorld()
      expect(errText(await open({ link: productRef(123_456_789) }))).toContain('Etsy has no listing 123456789')
    })

    it('another Etsy failure: the Etsy error text, not a crash', async () => {
      const fetch = routedFetch({ 'GET /v3/application/listings/{id}': { status: 403, body: { error: 'nope' } } })
      const tools = createMcpTools({
        db: w.db,
        own: { client: testClient(fetch, null), status: () => signedOut, writesAllowed: () => false, taxonomy: async () => [] }
      })
      const r = await tools[0].run({ link: productRef(LIVE_ID) })
      expect(r.isError).toBe(true)
      expect((r.content[0] as { text: string }).text).toMatch(/Etsy/)
    })

    it('a photo of a listing the app does not store → the image from the CDN (570 px, else full)', async () => {
      const { open, fetch, fetched } = liveWorld()
      const id = LIVE_ID * 10 + 2
      const r = await open({ link: `what is in ${photoRef(LIVE_ID, id)}?` })
      expect(json(r)).toEqual({
        opened: 'photo',
        source: 'live',
        product_id: LIVE_ID,
        title: 'Live & well',
        image_id: id,
        position: 2,
        of: 2,
        alt_text: expect.anything()
      })
      expect(fetched).toEqual([`https://i.etsystatic.com/1/il_570xN.${id}.jpg`])
      expect(bytesOf(r)).toEqual(cdnBytes(fetched[0]))
      expect(fetch.calls).toHaveLength(1)
      await open({ link: photoRef(LIVE_ID, id), size: 'full' })
      expect(fetched[1]).toBe(`https://i.etsystatic.com/1/il_fullxfull.${id}.jpg`)
      expect(errText(await open({ link: photoRef(LIVE_ID, 5) }))).toContain(`Etsy listing ${LIVE_ID} has no photo 5 now (it has 2 photo(s)`)
    })

    it('a photo added after the latest scan of a stored listing → read live', async () => {
      const added = mkEtsyImage(1, 3)
      const { open, fetched } = liveWorld({ listings: { 1: liveListing(1, { images: [mkEtsyImage(1, 1), added] }) } })
      const r = await open({ link: photoRef(1, added.listing_image_id) })
      expect(json(r)).toMatchObject({ source: 'live', product_id: 1, image_id: added.listing_image_id, position: 2, of: 2 })
      expect(fetched).toEqual([added.url_570xN])
    })

    it('never downloads a URL that is not on the Etsy CDN', async () => {
      const id = LIVE_ID * 10 + 1
      const img = mkEtsyImage(LIVE_ID, 1, { url_570xN: 'https://evil.example/il_570xN.jpg', url_fullxfull: 'file:///etc/passwd' })
      const { open, fetched } = liveWorld({ listings: { [LIVE_ID]: liveListing(LIVE_ID, { images: [img] }) } })
      const r = await open({ link: photoRef(LIVE_ID, id) })
      expect(errText(r)).toBe("The image could not be downloaded from Etsy's image CDN right now.")
      expect(fetched).toEqual([])

      const half = mkEtsyImage(LIVE_ID, 1, { url_570xN: 'https://evil.example/il_570xN.jpg' })
      const second = liveWorld({ listings: { [LIVE_ID]: liveListing(LIVE_ID, { images: [half] }) } })
      expect((await second.open({ link: photoRef(LIVE_ID, id) })).isError).toBeFalsy()
      expect(second.fetched).toEqual([half.url_fullxfull])
    })

    it('without a CDN reader: a clear error, not a crash', async () => {
      const { open } = liveWorld({ cdn: false })
      expect(errText(await open({ link: photoRef(LIVE_ID, LIVE_ID * 10 + 1) }))).toBe(
        "The image could not be downloaded from Etsy's image CDN right now."
      )
    })

    it('the same MIME and 5 MB rules as the other image tools', async () => {
      const mk = (img: { data: Buffer; mimeType: string }) =>
        createMcpTools({
          db: w.db,
          own: {
            client: testClient(routedFetch({ 'GET /v3/application/listings/{id}': { status: 200, body: liveListing(LIVE_ID) } }), null),
            status: () => signedOut,
            writesAllowed: () => false,
            taxonomy: async () => []
          },
          fetchCdnImage: async () => img
        })[0]
      const link = photoRef(LIVE_ID, LIVE_ID * 10 + 1)
      const avif = await mk({ data: Buffer.from('x'), mimeType: 'image/avif' }).run({ link })
      expect((avif.content[0] as { text: string }).text).toContain('image/avif')
      const big = await mk({ data: Buffer.alloc(5 * 1024 * 1024 + 1), mimeType: 'image/jpeg' }).run({ link, size: 'full' })
      expect((big.content[0] as { text: string }).text).toBe('The image is larger than 5 MB and cannot be returned. Ask for size "medium".')
      const jpg = await mk({ data: Buffer.from('ok'), mimeType: 'Image/JPG' }).run({ link })
      expect(jpg.content[1]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' })
    })

    describe("the user's own listings Etsy shows only to the owner (drafts, inactive, expired)", () => {
      const DRAFT_ID = 777_000_222
      for (const hiddenStatus of [404, 403]) {
        it(`signed in: a ${hiddenStatus} for the API key alone → read once more as the owner (OAuth)`, async () => {
          const { open, fetch, fetched } = liveWorld({
            ownerOnly: { [DRAFT_ID]: liveListing(DRAFT_ID, { state: 'draft' }) },
            hiddenStatus,
            signedIn: true
          })
          const id = DRAFT_ID * 10 + 2
          const r = await open({ link: photoRef(DRAFT_ID, id) })
          expect(r.isError, JSON.stringify(r.content[0])).toBeFalsy()
          expect(json(r)).toMatchObject({ opened: 'photo', source: 'live', product_id: DRAFT_ID, image_id: id, position: 2 })
          expect(fetched).toEqual([`https://i.etsystatic.com/1/il_570xN.${id}.jpg`])
          expect(fetch.calls.map((c) => !!c.headers.authorization)).toEqual([false, true])
          expect(fetch.calls[1].headers.authorization).toBe('Bearer tok')
          expect(new URL(fetch.calls[1].url).searchParams.get('includes')).toBe('Images')

          expect(json(await open({ link: productRef(DRAFT_ID) }))).toMatchObject({ opened: 'product', source: 'live', state: 'draft' })

          const v = await open({ link: videoRef(DRAFT_ID, 55) })
          expect(json(v)).toEqual({ opened: 'video_preview', source: 'live', product_id: DRAFT_ID, video_id: 55 })
          expect(fetch.calls.slice(-2).map((c) => [new URL(c.url).pathname, !!c.headers.authorization])).toEqual([
            [`/v3/application/listings/${DRAFT_ID}/videos/55`, false],
            [`/v3/application/listings/${DRAFT_ID}/videos/55`, true]
          ])
        })
      }

      it('signed out: no owner retry, and the 404 text', async () => {
        const { open, fetch } = liveWorld({ ownerOnly: { [DRAFT_ID]: liveListing(DRAFT_ID, { state: 'draft' }) } })
        expect(errText(await open({ link: photoRef(DRAFT_ID, DRAFT_ID * 10 + 1) }))).toContain(`Etsy has no listing ${DRAFT_ID}`)
        expect(fetch.calls).toHaveLength(1)
      })

      it('signed in, but not found as the owner either: the 404 text', async () => {
        const { open, fetch } = liveWorld({ signedIn: true })
        expect(errText(await open({ link: photoRef(123_456_789, 1) }))).toContain('Etsy has no listing 123456789')
        expect(fetch.calls.map((c) => !!c.headers.authorization)).toEqual([false, true])
        expect(errText(await open({ link: videoRef(123_456_789, 56) }))).toContain('Etsy has no video 56 of listing 123456789')
      })

      it('a listing Etsy shows publicly is never re-read with the token', async () => {
        const { open, fetch } = liveWorld({ signedIn: true })
        expect((await open({ link: photoRef(LIVE_ID, LIVE_ID * 10 + 1) })).isError).toBeFalsy()
        expect(fetch.calls).toHaveLength(1)
        expect(fetch.calls[0].headers).not.toHaveProperty('authorization')
      })
    })

    it('a stored listing whose copied photo is gone, and Etsy no longer has the listing: says it is stored', async () => {
      const { open, fetch } = liveWorld({ listings: {} })
      const stored = getDbListing(w.db, 1)!
      const t = errText(await open({ link: photoRef(1, 5) }))
      expect(t).toContain("Product 1 is in the app's database but has no photo 5 there")
      expect(t).toContain(`(it has ${stored.images.length} photo(s): ${stored.images.map((i) => i.id).join(', ')})`)
      expect(t).toContain('Etsy has no listing 1 now')
      expect(t).not.toContain("doesn't have it either")
      expect(fetch.calls).toHaveLength(1)
      const v = errText(await open({ link: videoRef(1, 56) }))
      expect(v).toContain('Etsy has no video 56 of listing 1')
      expect(v).toContain(`The app's database has listing 1 without that video (its videos: ${stored.videos.map((x) => x.id).join(', ')})`)
    })

    it('no API key saved: no live request — the database answers or a clear refusal', async () => {
      const { open, fetch } = liveWorld({ hasApiKey: false })
      const t = errText(await open({ link: `https://www.etsy.com/listing/${LIVE_ID}` }))
      expect(t).toContain(`Product ${LIVE_ID} is not in the app's database`)
      expect(t).toContain('no API key')
      expect(errText(await open({ link: photoRef(LIVE_ID, 1) }))).toContain("is not in the app's database")
      expect(errText(await open({ link: videoRef(LIVE_ID, 55) }))).toContain("is not in the app's database")
      // a stored listing, a photo / video it doesn't have: the local answer
      expect(errText(await open({ link: photoRef(1, 5) }))).toContain('has no photo 5')
      expect((await open({ link: videoRef(1, 56) })).isError).toBe(true)
      expect(fetch.calls).toHaveLength(0)
      // with a key, the same tools go live
      const keyed = liveWorld({ hasApiKey: true })
      expect((await keyed.open({ link: String(LIVE_ID) })).isError).toBeFalsy()
      expect(keyed.fetch.calls).toHaveLength(1)
    })

    it("the owner's Etsy editor link (\"Редагувати на Etsy\", edit_url) opens the listing", async () => {
      const { open } = liveWorld()
      expect(json(await open({ link: `https://www.etsy.com/your/shops/me/listing-editor/edit/${LIVE_ID}` }))).toMatchObject({
        opened: 'product',
        id: LIVE_ID
      })
      expect(json(await open({ link: '«https://www.etsy.com/your/shops/me/listing-editor/edit/2»' }))).toMatchObject({ source: 'local', id: 2 })
    })

    it('an etsy.me share link: says to paste the full address', async () => {
      const { open, fetch } = liveWorld()
      const t = errText(await open({ link: 'глянь https://etsy.me/3AbCdEf' }))
      expect(t).toContain('short etsy.me share link')
      expect(t).toContain('full address')
      expect(t).not.toContain('No link or reference found')
      expect(fetch.calls).toHaveLength(0)
    })

    it('a video of a listing the app does not store → its preview frame, live', async () => {
      const { open, fetch, fetched } = liveWorld()
      const r = await open({ link: videoRef(LIVE_ID, 55) })
      expect(json(r)).toEqual({ opened: 'video_preview', source: 'live', product_id: LIVE_ID, video_id: 55 })
      expect(fetched).toEqual(['https://v.etsystatic.com/video/thumb55.jpg'])
      expect(new URL(fetch.calls[0].url).pathname).toBe(`/v3/application/listings/${LIVE_ID}/videos/55`)
      expect(errText(await open({ link: videoRef(LIVE_ID, 56) }))).toContain(`Etsy has no video 56 of listing ${LIVE_ID}`)
      // a stored video stays local
      const local = await open({ link: videoRef(1, 91_234_567) })
      expect(json(local)).toMatchObject({ source: 'local', video_id: 91_234_567 })
    })
  })
})

describe('marks (set_product_mark, list_marked_products, mark in product output)', () => {
  const annotations = async (name: string) => {
    const res = await handleMcpMessage({ info: mcpServerInfo('0.1.0'), tools: w.tools }, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const t = (res!.result as { tools: Array<{ name: string; annotations: Record<string, boolean> }> }).tools.find((x) => x.name === name)!
    return t.annotations
  }

  it('set_product_mark is a local write (no Etsy, no sign-in, no "allow changes"); list_marked_products a local read', async () => {
    expect(await annotations('set_product_mark')).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false })
    expect(await annotations('list_marked_products')).toMatchObject({ readOnlyHint: true, openWorldHint: false })
  })

  it('products start unmarked: mark is null in get_product, search_products and open_link', async () => {
    expect((await data('get_product', { product_id: 2 })).mark).toBeNull()
    expect((await data('search_products', { store_id: SHOP_ID })).products.every((p: { mark: unknown }) => p.mark === null)).toBe(true)
    expect((await data('open_link', { link: productRef(2) })).mark).toBeNull()
  })

  it('sets a mark with a draft, keeps absent fields, clears with null, removes with none; every product output shows it', async () => {
    const draft = saveDraft(w.db, { source: 'mcp', fields: { ...EMPTY_DRAFT_FIELDS, title: 'Our mug' } }, 1)
    const heard: number[][] = []
    const tools = createMcpTools({ db: w.db, now: () => 1_760_500_000_000, onMarksChanged: (ids) => heard.push(ids) })
    const run = async (args: Record<string, unknown>) => {
      const r = await handleMcpMessage(
        { info: mcpServerInfo('0.1.0'), tools },
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'set_product_mark', arguments: args } }
      )
      const out = r!.result as McpToolResult
      for (const c of out.content) if (c.type === 'text') seen.push(c.text)
      return { isError: !!out.isError, json: JSON.parse((out.content[0] as { text: string }).text) }
    }
    const first = await run({ product_id: 2, status: 'in_progress', note: 'Our take on the Etsy bestseller', our_draft_id: draft.id })
    expect(first).toEqual({
      isError: false,
      json: {
        product_id: 2,
        title: 'Renamed 2',
        store_id: SHOP_ID,
        mark: {
          status: 'in_progress',
          note: 'Our take on the Etsy bestseller',
          our_product_id: null,
          our_draft_id: draft.id,
          set_by: 'assistant',
          updated_at: new Date(1_760_500_000_000).toISOString()
        }
      }
    })
    expect(heard).toEqual([[2]])
    const shown = { status: 'in_progress', note: 'Our take on the Etsy bestseller', our_draft_id: draft.id, set_by: 'assistant' }
    expect((await data('get_product', { product_id: 2 })).mark).toMatchObject(shown)
    expect((await data('open_link', { link: 'https://www.etsy.com/listing/2/renamed' })).mark).toMatchObject(shown)
    expect((await data('search_products', { store_id: SHOP_ID, mark: 'in_progress' })).products.map((p: { id: number }) => p.id)).toEqual([2])

    expect((await run({ product_id: 2, status: 'done', our_product_id: 4242 })).json.mark).toMatchObject({ status: 'done', note: 'Our take on the Etsy bestseller', our_product_id: 4242, our_draft_id: draft.id })
    expect((await run({ product_id: 2, status: 'done', note: null, our_draft_id: null })).json.mark).toMatchObject({ note: null, our_product_id: 4242, our_draft_id: null })
    expect((await run({ product_id: 5, status: 'in_progress', note: '' })).json.mark).toMatchObject({ status: 'in_progress', note: null })
    expect((await run({ product_id: 5, status: 'none' })).json).toMatchObject({ product_id: 5, mark: null })
    expect((await data('get_product', { product_id: 5 })).mark).toBeNull()
    expect(heard).toHaveLength(5)
  })

  it('refuses an unknown product or draft, a bad status and a long note (nothing written)', async () => {
    expect(await toolError('set_product_mark', { product_id: 999_999, status: 'done' })).toMatch(/No product with id 999999/)
    expect(await toolError('set_product_mark', { product_id: 1, status: 'done', our_draft_id: 98_765 })).toMatch(/No draft 98765 in the app/)
    expect(await toolError('set_product_mark', { product_id: 1, status: 'maybe' })).toMatch(/must be one of: in_progress, done, none/)
    expect(await toolError('set_product_mark', { product_id: 1, status: 'done', note: 'x'.repeat(501) })).toMatch(/at most 500/)
    expect(await toolError('set_product_mark', { product_id: 1 })).toMatch(/Missing required argument "status"/)
    expect((await data('get_product', { product_id: 1 })).mark).toBeNull()
  })

  it('search_products: mark filter (any/none/in_progress/done) and sort marked_first (done, in progress, then the rest — each newest first)', async () => {
    await data('set_product_mark', { product_id: 1, status: 'in_progress' })
    // product 2 is done (above)
    const ids = async (args: Record<string, unknown>) =>
      (await data('search_products', { store_id: SHOP_ID, ...args })).products.map((p: { id: number }) => p.id)
    const newest = await ids({})
    expect(await ids({ mark: 'any' })).toEqual(newest)
    expect(await ids({ mark: 'done' })).toEqual([2])
    expect(await ids({ mark: 'in_progress' })).toEqual([1])
    expect(await ids({ mark: 'none' })).toEqual(newest.filter((id: number) => id !== 1 && id !== 2))
    expect(await ids({ sort: 'marked_first' })).toEqual([2, 1, ...newest.filter((id: number) => id !== 1 && id !== 2)])
    expect(await toolError('search_products', { mark: 'yes' })).toMatch(/must be one of: any, none, in_progress, done/)
  })

  it('list_marked_products: newest change first, filters, paging; refuses an unknown store', async () => {
    const all = await data('list_marked_products', {})
    expect(all.total).toBe(2)
    // Product 2's mark was set at 1_760_500_000_000 — later than product 1's (the world's clock).
    expect(all.products.map((p: { id: number }) => p.id)).toEqual([2, 1])
    expect(all.products[0]).toEqual({
      id: 2,
      store_id: SHOP_ID,
      store_name: 'CeramicStudioUA',
      title: 'Renamed 2',
      url: expect.stringMatching(/^https:\/\/www\.etsy\.com\/listing\/2/),
      status: 'active',
      mark: expect.objectContaining({ status: 'done', our_product_id: 4242, set_by: 'assistant' })
    })
    expect((await data('list_marked_products', { status: 'done' })).products.map((p: { id: number }) => p.id)).toEqual([2])
    expect((await data('list_marked_products', { store_id: SHOP_ID, limit: 1, offset: 1 })).products.map((p: { id: number }) => p.id)).toEqual([1])
    expect(await toolError('list_marked_products', { store_id: 123 })).toMatch(/No store with id 123/)
  })

  it('a mark set in the app reads as set_by user', async () => {
    const { setListingMark } = await import('../../src/main/db')
    setListingMark(w.db, 3, { status: 'done', source: 'app' }, 1_760_600_000_000)
    expect((await data('get_product', { product_id: 3 })).mark).toMatchObject({ status: 'done', set_by: 'user' })
    setListingMark(w.db, 3, { status: null, source: 'app' }, 1)
  })
})

describe('honesty: data reaches a client as stored, secrets and CDN URLs never do', () => {
  it('every tool, the tool list and initialize: Etsy text unchanged; no etsystatic URL, raw_json or key', async () => {
    // Make sure the sweep covers every tool, whatever ran before.
    const stores = await data('list_stores')
    const store = await data('get_store', { store_id: SHOP_ID })
    await data('search_products', { status: 'all', search_description: true, query: 'a' })
    const products = []
    for (const id of [1, 2, 3, 4, 5]) {
      products.push(await data('get_product', { product_id: id }))
      await data('get_product_history', { product_id: id })
    }
    await data('list_snapshots', { store_id: SHOP_ID })
    for (const s of w.scans) await data('get_snapshot_changes', { store_id: SHOP_ID, snapshot_id: s })
    const reviews = await data('list_reviews', {})
    await data('get_store_stats', { store_id: SHOP_ID })
    await call('get_product_image', { product_id: 1 })
    await call('get_review_photo', { review_id: w.photoReviewId })
    await call('get_store_logo', { store_id: SHOP_ID })
    await call('get_store_logo', { store_id: SHOP_ID, kind: 'banner' })
    await call('get_product_video_preview', { product_id: 1 })
    await call('get_product', { product_id: 0 })
    for (const link of [productRef(1), photoRef(1, 11), videoRef(1, 91_234_567), reviewPhotoRef(w.photoReviewId), storeRef(SHOP_ID), storeImageRef(SHOP_ID, 'banner'), 'nothing here']) {
      await call('open_link', { link })
    }

    // (a) text from the data is passed through unchanged
    expect(store.announcement).toBe('Welcome to our Etsy shop!')
    expect(products[0].description).toContain('https://www.etsy.com/shop/CeramicStudioUA or etsy.me/abc')
    expect(products[0].tags).toContain('Etsy gift')
    expect(reviews.reviews.map((r: { text: string | null }) => r.text)).toContain('Best Etsy purchase ever')
    expect(stores.stores[0].url).toMatch(/^https:\/\/www\.etsy\.com\//)

    const list = await handleMcpMessage(
      { info: mcpServerInfo('0.1.0'), tools: w.tools },
      { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    )
    const init = await handleMcpMessage(
      { info: mcpServerInfo('0.1.0'), tools: w.tools },
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }
    )
    const everything = [JSON.stringify(list), JSON.stringify(init), ...seen].join('\n')
    expect(seen.length).toBeGreaterThan(30)
    // (b) never: CDN image URLs, raw API JSON, the API key
    expect(everything).not.toMatch(/etsystatic\.com/i)
    expect(everything).not.toMatch(/raw_json/)
    expect(everything).not.toContain('keystring:secret')
    expect(everything).not.toMatch(/Bearer /)
    // every URL a client gets is an Etsy page
    for (const u of everything.match(/https?:\/\/[^\s"\\)]+/g) ?? []) expect(u).toMatch(/^https:\/\/(www\.)?etsy\.com\//)
  })

  it('the server presents itself as Etsy Tracker and explains what is local and what is live', () => {
    expect(mcpServerInfo('1.0.0')).toMatchObject({ name: 'etsy-tracker', title: 'Etsy Tracker', instructions: MCP_INSTRUCTIONS })
    expect(MCP_INSTRUCTIONS).toContain('Etsy Open API v3')
    expect(MCP_INSTRUCTIONS).toContain('https://www.etsy.com/listing/<id>')
    expect(MCP_INSTRUCTIONS).toMatch(/means product_id = <id> — call get_product/)
    const refs = MCP_INSTRUCTIONS.split('\n\n').find((p) => p.startsWith('References from the app'))!
    expect(refs).toContain('etsy-tracker://product/<id>/photo/<image_id>')
    expect(refs).toContain('"Копіювати для Claude"')
    expect(refs).toContain('call open_link with what they pasted right away')
    expect(MCP_INSTRUCTIONS).toMatch(/Local data — no Etsy request/)
    expect(MCP_INSTRUCTIONS).toMatch(/Live Etsy tools/)
    expect(MCP_INSTRUCTIONS).toContain('is_mine')
    expect(MCP_INSTRUCTIONS).toContain('$0.20')
    expect(MCP_INSTRUCTIONS).toContain('prepare_product')
    expect(MCP_INSTRUCTIONS).not.toMatch(/marketplace/i)
    // every tool name the instructions use is a real tool
    const names = new Set(w.tools.map((t) => t.name))
    const fields = new Set(['image_id', 'video_id', 'review_id', 'photo_id', 'finished_at', 'latest_snapshot', 'customer_country', 'sales_count', 'featured_position', 'is_mine', 'shop_id', 'listing_id', 'category_id', 'also_on_etsy', 'overwrite_etsy_changes', 'product_id', 'in_progress', 'our_product_id', 'our_draft_id', 'set_by', 'marked_first', 'draft_id'])
    const mentioned = (MCP_INSTRUCTIONS.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []).filter((m) => !fields.has(m))
    expect(mentioned.length).toBeGreaterThan(30)
    for (const m of mentioned) expect(names, m).toContain(m)
  })

  it('instructions: the gated writes (incl. consolidate_my_return_policies) and the local-draft exception', () => {
    const para = MCP_INSTRUCTIONS.split('\n\n').find((p) => p.startsWith('Changing the shop'))!
    for (const n of ['create_product', 'update_my_product', 'add_product_media', 'update_my_store', 'send_prepared_product', 'mark_my_order_shipped', 'update_my_order', 'consolidate_my_return_policies']) {
      expect(para, n).toContain(n)
    }
    // Deleting a draft is gated only when it deletes the Etsy listing too.
    expect(para).toContain('delete_prepared_product with also_on_etsy')
    expect(para).toMatch(
      /exception: prepare_product, unlink_prepared_product and delete_prepared_product \(without also_on_etsy\) change only drafts kept inside the app/
    )
    expect(para).toContain('need neither the sign-in nor the switch')
    // Pulling Etsy drafts reads Etsy (sign-in) but writes only the app.
    expect(para).toMatch(/sync_prepared_products reads Etsy \(sign-in needed\) and writes only the app's drafts/)
  })

  it('instructions: linked drafts — editing, updating the same listing, conflicts, unlink, delete on Etsy', () => {
    const para = MCP_INSTRUCTIONS.split('\n\n').find((p) => p.startsWith('New listings'))!
    expect(para).toContain('prepare_product can edit its linked draft too')
    expect(para).toContain('updates that same listing, never a second one')
    expect(para).toContain('conflict: true and writes nothing: ask the user before sending again with overwrite_etsy_changes')
    expect(para).toContain('sync_prepared_products')
    expect(para).toContain('unlink_prepared_product forgets the link')
    expect(para).toContain('with also_on_etsy the Etsy listing too, which can\'t be undone, so confirm with the user first')
  })

  it('instructions: the fee is for publishing a draft or renewing an expired/sold-out listing, not reactivating', () => {
    expect(MCP_INSTRUCTIONS).toContain('before publishing a draft')
    expect(MCP_INSTRUCTIONS).toContain('renewing an expired or sold-out listing')
    expect(MCP_INSTRUCTIONS).toContain('Reactivating an inactive listing costs no fee.')
    expect(MCP_INSTRUCTIONS).not.toMatch(/publishing or activating/)
  })

  it('instructions: where photos come from, live tools without sign-in, cached category trees', () => {
    expect(MCP_INSTRUCTIONS).toContain('get_product_image and get_review_photo return the app\'s local copy when there is one')
    expect(MCP_INSTRUCTIONS).toContain('get_store_logo and get_product_video_preview always download from Etsy\'s image CDN')
    expect(MCP_INSTRUCTIONS).toContain('CDN downloads cost no API quota')
    const live = MCP_INSTRUCTIONS.split('\n\n').find((p) => p.startsWith('Live Etsy tools'))!
    expect(live).toContain('no Etsy sign-in needed')
    expect(live).toContain('find_categories')
    expect(live).toContain('get_category_attributes')
    expect(live).toContain('read from Etsy once per app run and then matched locally')
    expect(MCP_INSTRUCTIONS).not.toMatch(/each call makes/)
  })

  it('instructions: holidays are public-holiday processing, not vacation mode; text is entity-decoded, descriptions in changes are excerpts', () => {
    expect(MCP_INSTRUCTIONS).toContain('public-holiday processing preferences (get_my_holidays, set_my_holiday')
    expect(MCP_INSTRUCTIONS).toContain('not vacation mode, which no tool changes')
    expect(MCP_INSTRUCTIONS).not.toMatch(/holiday mode/)
    expect(MCP_INSTRUCTIONS).toContain('HTML entities decoded')
    expect(MCP_INSTRUCTIONS).toContain('excerpts of at most 1000 characters')
    expect(MCP_INSTRUCTIONS).not.toMatch(/exactly what Etsy returned/)
  })

  it('tool texts: description excerpts in change records, the Ukrainian scan error', () => {
    const desc = (n: string) => w.tools.find((t) => t.name === n)!.description
    expect(desc('get_snapshot_changes')).toContain('excerpts of at most 1000 characters, get_product has the full current text')
    expect(desc('get_product_history')).toContain('excerpts of at most 1000 characters, get_product has the full current text')
    expect(desc('list_stores')).toContain("latest_update_error = the app's error message, in Ukrainian")
  })
})

describe('url / latest_update_error', () => {
  function tinyWorld(shopUrl: string, listingUrl: string) {
    const db = memDb()
    seedShop(db, { id: 7, url: shopUrl })
    upsertListing(db, mkInput(1, { shopId: 7, url: listingUrl }), 1000)
    return { db, tools: createMcpTools({ db }) }
  }
  const run = async (tools: McpTool[], name: string, args: Record<string, unknown> = {}) => {
    const res = await handleMcpMessage(
      { info: mcpServerInfo('0.1.0'), tools },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
    )
    const r = res!.result as McpToolResult
    expect(r.isError).toBeFalsy()
    return JSON.parse((r.content[0] as { text: string }).text)
  }

  it('Etsy page URLs are given as stored', async () => {
    const { tools } = tinyWorld('https://www.etsy.com/shop/Seven', 'https://www.etsy.com/listing/1/x')
    expect((await run(tools, 'list_stores')).stores[0].url).toBe('https://www.etsy.com/shop/Seven')
    expect((await run(tools, 'get_store', { store_id: 7 })).url).toBe('https://www.etsy.com/shop/Seven')
    expect((await run(tools, 'search_products', { store_id: 7 })).products[0].url).toBe('https://www.etsy.com/listing/1/x')
    expect((await run(tools, 'get_product', { product_id: 1 })).url).toBe('https://www.etsy.com/listing/1/x')
  })

  it('a URL that is not an https etsy.com page is null', async () => {
    for (const [shopUrl, listingUrl] of [
      ['http://www.etsy.com/shop/Seven', 'https://evil.example/listing/1'],
      ['https://user:pw@www.etsy.com/shop/Seven', 'javascript:alert(1)'],
      ['', 'https://i.etsystatic.com/1/il_fullxfull.1.jpg']
    ]) {
      const { tools } = tinyWorld(shopUrl, listingUrl)
      expect((await run(tools, 'list_stores')).stores[0].url).toBeNull()
      expect((await run(tools, 'get_product', { product_id: 1 })).url).toBeNull()
    }
  })

  it('get_snapshot_changes of a running or a failed scan: a note saying which', async () => {
    const { db, tools } = tinyWorld('https://www.etsy.com/shop/Seven', 'https://www.etsy.com/listing/1/x')
    const failed = insertRunningScan(db, 7, 2000)
    finishScanError(db, failed, 3000, 'boom')
    const running = insertRunningScan(db, 7, 4000)
    const r = await run(tools, 'get_snapshot_changes', { store_id: 7, snapshot_id: running })
    expect(r.snapshot).toMatchObject({ id: running, status: 'running' })
    expect(r.note).toBe('This snapshot is still running; its changes are recorded when it finishes.')
    const f = await run(tools, 'get_snapshot_changes', { store_id: 7, snapshot_id: failed })
    expect(f.snapshot).toMatchObject({ id: failed, status: 'failed' })
    expect(f.note).toBe('This snapshot did not succeed; it recorded no changes.')
  })

  it('a failed latest scan: latest_update_failed with the error text; ok again → null', async () => {
    const { db, tools } = tinyWorld('https://www.etsy.com/shop/Seven', 'https://www.etsy.com/listing/1/x')
    const scan = insertRunningScan(db, 7, 2000)
    finishScanError(db, scan, 3000, 'Etsy не відповідає (тайм-аут 30 с)')
    const s = (await run(tools, 'list_stores')).stores[0]
    expect(s).toMatchObject({ latest_update_failed: true, latest_update_error: 'Etsy не відповідає (тайм-аут 30 с)' })
    expect(await run(tools, 'get_store', { store_id: 7 })).toMatchObject({ latest_update_failed: true })
    const next = insertRunningScan(db, 7, 4000)
    finishScanOk(db, next, 5000, { isBaseline: true, truncated: false, total: 1, added: 0, removed: 0, changed: 0, returned: 0 })
    expect((await run(tools, 'list_stores')).stores[0]).toMatchObject({ latest_update_failed: false, latest_update_error: null })
  })
})

describe('changeFields', () => {
  it('passes text fields through unchanged', () => {
    expect(changeFields({ title: 'Etsy mug', description: 'See https://www.etsy.com/shop/x', tags: ['Etsy gift'] })).toEqual({
      title: 'Etsy mug',
      description: 'See https://www.etsy.com/shop/x',
      tags: ['Etsy gift']
    })
  })

  it('maps tracked change fields to the output names', () => {
    expect(
      changeFields({
        priceAmount: 250,
        priceDivisor: 100,
        currency: 'USD',
        taxonomyId: 7,
        shopSectionId: 3,
        listingType: 'download',
        processingMin: 1,
        processingMax: 3,
        images: [1, 2],
        whoMade: 'i_did'
      })
    ).toEqual({
      base_price: 2.5,
      base_currency: 'USD',
      category_id: 7,
      section_id: 3,
      product_type: 'digital',
      processing_days: { min: 1, max: 3 },
      image_ids: [1, 2],
      made_by: 'i_did'
    })
    expect(changeFields(null)).toBeNull()
  })
})
