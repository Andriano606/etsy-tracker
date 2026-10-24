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
  const tools = createMcpTools({
    db,
    now: () => t,
    readImage: async (url) => {
      const res = await handler(new Request(url))
      if (!res.ok) return null
      return { data: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get('content-type') ?? '' }
    }
  })
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
    cdnCalls: cdn.calls
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
    const cdn = ['get_product_image', 'get_store_logo', 'get_product_video_preview', 'get_review_photo']
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
    expect(MCP_INSTRUCTIONS).toMatch(/Local data — no Etsy request/)
    expect(MCP_INSTRUCTIONS).toMatch(/Live Etsy tools/)
    expect(MCP_INSTRUCTIONS).toContain('is_mine')
    expect(MCP_INSTRUCTIONS).toContain('$0.20')
    expect(MCP_INSTRUCTIONS).toContain('prepare_product')
    expect(MCP_INSTRUCTIONS).not.toMatch(/marketplace/i)
    // every tool name the instructions use is a real tool
    const names = new Set(w.tools.map((t) => t.name))
    const fields = new Set(['finished_at', 'latest_snapshot', 'customer_country', 'sales_count', 'featured_position', 'is_mine', 'shop_id', 'listing_id', 'category_id'])
    const mentioned = (MCP_INSTRUCTIONS.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []).filter((m) => !fields.has(m))
    expect(mentioned.length).toBeGreaterThan(30)
    for (const m of mentioned) expect(names, m).toContain(m)
  })

  it('instructions: the gated writes (incl. consolidate_my_return_policies) and the local-draft exception', () => {
    const para = MCP_INSTRUCTIONS.split('\n\n').find((p) => p.startsWith('Changing the shop'))!
    for (const n of ['create_product', 'update_my_product', 'add_product_media', 'update_my_store', 'send_prepared_product', 'mark_my_order_shipped', 'update_my_order', 'consolidate_my_return_policies']) {
      expect(para, n).toContain(n)
    }
    expect(para).toMatch(/exception: prepare_product and delete_prepared_product change only drafts kept inside the app/)
    expect(para).toContain('need neither the sign-in nor the switch')
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
