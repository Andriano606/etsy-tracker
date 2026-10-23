import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../../src/main/db'
import { handleMcpMessage, type McpTool, type McpToolResult } from '../../src/main/mcpProtocol'
import { createMcpTools, imageMime, mcpServerInfo, MCP_INSTRUCTIONS, neutralFields, neutralText } from '../../src/main/mcpTools'
import { createImageProtocolHandler } from '../../src/main/imageProtocol'
import { createReviewSyncer } from '../../src/main/reviewSync'
import { createScanner } from '../../src/main/scanner'
import { MCP_TOOL_SUMMARY } from '../../src/shared/mcpConfig'
import type { ScanOutcome } from '../../src/shared/types'
import { FakeEtsy, SHOP_ID, mkEtsyListing, mkEtsyReview } from '../helpers/fakeEtsy'
import { cdnBytes, fakeCdn } from '../helpers/fakeImageStore'
import { memDb, seedShop } from '../helpers/db'

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
 * Text mentioning the marketplace is planted in a description, the shop
 * announcement and a review to prove it never reaches a client.
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

/** Every text a client got, for the neutrality sweep. */
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
      latest_update_failed: false
    })
    expect(s.latest_snapshot).toMatchObject({ id: w.scans[2], status: 'ok', added: 1, removed: 1, returned: 1 })
    expect(s.latest_snapshot.finished_at).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/)
  })

  it('the profile: policies, announcement (neutralized), stored reviews', async () => {
    const s = await data('get_store', { store_id: SHOP_ID })
    expect(s.announcement).toBe('Welcome to our marketplace shop!')
    expect(s.policies.shipping).toBe('Ships in 1-3 days.')
    expect(s.stored_reviews).toMatchObject({ count: 7, complete: true, new_in_latest_snapshot: 1 })
    expect(s).not.toHaveProperty('url')
    expect(s).not.toHaveProperty('icon_url')
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
    expect(p5).toMatchObject({ id: 5, store_id: SHOP_ID, title: 'Fifth', status: 'active', new_in_latest_snapshot: true })
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

  it('everything about the product, neutral and without links', async () => {
    const p = await data('get_product', { product_id: 1 })
    expect(p).toMatchObject({ id: 1, store_name: 'CeramicStudioUA', status: 'active', state: 'active' })
    expect(p.description).toBe(
      'Hand made. More at [link] or [link] — thanks, marketplace shoppers! #marketplacefinds'
    )
    expect(p.tags).toEqual(['mug', 'marketplace gift'])
    expect(p.images).toHaveLength(2)
    expect(p.images[0]).toMatchObject({ position: 1 })
    expect(Object.keys(p.images[0])).not.toContain('url')
    expect(p.attributes).toHaveProperty('product_type')
    expect(p.favorites_change).toBe(0)
    expect(p.reviews).toMatchObject({ complete: true })
    expect(JSON.stringify(p)).not.toMatch(/https?:/)
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
    expect(text.reviews.map((r: { text: string }) => r.text)).toEqual(['Best marketplace purchase ever'])
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
    expect((r2.content[0] as { text: string }).text).toContain('too large')
  })
})

describe('neutrality: a client never learns where the data comes from', () => {
  it('no "etsy" in the instructions, tool list, any tool output or error', async () => {
    // Make sure the sweep covers every tool, whatever ran before.
    await data('list_stores')
    await data('get_store', { store_id: SHOP_ID })
    await data('search_products', { status: 'all', search_description: true, query: 'a' })
    for (const id of [1, 2, 3, 4, 5]) {
      await data('get_product', { product_id: id })
      await data('get_product_history', { product_id: id })
    }
    await data('list_snapshots', { store_id: SHOP_ID })
    for (const s of w.scans) await data('get_snapshot_changes', { store_id: SHOP_ID, snapshot_id: s })
    await data('list_reviews', {})
    await data('get_store_stats', { store_id: SHOP_ID })
    await call('get_product_image', { product_id: 1 })
    await call('get_review_photo', { review_id: w.photoReviewId })
    await call('get_product', { product_id: 0 })

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
    expect(everything).not.toMatch(/etsy/i)
    expect(everything).not.toMatch(/https?:\/\//)
    expect(MCP_INSTRUCTIONS).not.toMatch(/etsy/i)
  })
})

describe('neutralText / neutralFields', () => {
  it('takes out the marketplace name and links, keeps other words', () => {
    expect(neutralText('Etsy’s best; visit https://www.etsy.com/listing/1/x?ref=a now')).toBe('marketplace’s best; visit [link] now')
    expect(neutralText('ETSY.com/shop/x and etsystatic.com/img.jpg')).toBe('[link] and [link]')
    expect(neutralText('Betsy loves #EtsyFinds')).toBe('Betsy loves #marketplaceFinds')
    expect(neutralText('You must add this language as a shop language in Shop Manager.')).toBe(
      'You must add this language as a shop language in the store settings.'
    )
    expect(neutralText(null)).toBeNull()
    expect(neutralText('')).toBe('')
  })

  it('maps tracked change fields to neutral names', () => {
    expect(
      neutralFields({
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
    expect(neutralFields(null)).toBeNull()
  })
})
