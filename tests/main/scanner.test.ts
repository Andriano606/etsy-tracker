import { describe, expect, it } from 'vitest'
import {
  type Db,
  getListing,
  getShopSummary,
  listActiveListings,
  listScanChanges,
  listScans
} from '../../src/main/db'
import { createScanner, diffListings, dimensionsOf, excerpt, trackedDiff } from '../../src/main/scanner'
import { getImageRow, getListingRaw, imageCounts, listListingStats } from '../../src/main/db'
import type { ScanOutcome, ScanProgress } from '../../src/shared/types'
import { FakeEtsy, SHOP_ID, mkEtsyImage, mkEtsyListing } from '../helpers/fakeEtsy'
import { memDb, mkInput, mkListing, seedShop } from '../helpers/db'

function setup(count = 3) {
  const db = memDb()
  seedShop(db, { id: SHOP_ID })
  const etsy = new FakeEtsy(count)
  const progress: ScanProgress[] = []
  let t = 1_000_000
  const scanner = createScanner({
    db,
    client: etsy.client({ maxRetries: 1 }),
    now: () => (t += 1000),
    onProgress: (p) => progress.push(p)
  })
  return { db, etsy, scanner, progress }
}

function ok(o: ScanOutcome) {
  if (!o.ok) throw new Error(`scan failed: ${o.error}`)
  return o.scan
}

const changes = (db: Db, scanId: number) =>
  listScanChanges(db, scanId).map((c) => [c.kind, c.listingId])

describe('baseline scan', () => {
  it('saves every listing but reports nothing as new', async () => {
    const { db, etsy, scanner } = setup(3)
    etsy.listings[0].title = 'Mug &quot;Sunflower&quot; &amp; saucer'
    etsy.listings[0].description = 'Line 1\nLine &lt;2&gt;'
    const scan = ok(await scanner.scanShop(SHOP_ID))
    expect(scan).toMatchObject({ status: 'ok', isBaseline: true, total: 3, added: 0, removed: 0, changed: 0 })
    expect(listActiveListings(db, SHOP_ID)).toHaveLength(3)
    expect(listScanChanges(db, scan.id)).toEqual([])
    expect(getShopSummary(db, SHOP_ID)!.newCount).toBe(0)

    const l = getListing(db, 1)!
    expect(l.title).toBe('Mug "Sunflower" & saucer')
    expect(l.description).toBe('Line 1\nLine <2>')
    expect(l.priceAmount).toBe(1001)
    expect(l.priceDivisor).toBe(100)
    expect(l.currency).toBe('UAH')
    expect(l.tags).toEqual(['ceramic mug', 'sunflower', 'handmade pottery'])
    // Images come from /listings/batch, ordered by rank.
    expect(l.images.map((i) => i.rank)).toEqual([1, 2])
    expect(l.images[0].url570).toMatch(/il_570xN/)
  })

  it('refreshes the shop info from getShop', async () => {
    const { db, etsy, scanner } = setup(2)
    etsy.shop.title = 'Renamed &amp; refreshed'
    ok(await scanner.scanShop(SHOP_ID))
    const s = getShopSummary(db, SHOP_ID)!
    expect(s.title).toBe('Renamed & refreshed')
    expect(s.etsyActiveCount).toBe(2)
  })

  it('reports progress for pages and details', async () => {
    const { scanner, progress } = setup(150)
    ok(await scanner.scanShop(SHOP_ID))
    const labels = progress.map((p) => p.label)
    expect(labels).toContain('Сторінка 1/2')
    expect(labels).toContain('Сторінка 2/2')
    expect(labels).toContain('Деталі 100/150')
    expect(labels).toContain('Деталі 150/150')
    expect(progress.at(-1)?.phase).toBe('saving')
  })
})

describe('rescan diff', () => {
  it('detects added, removed and changed (price/title)', async () => {
    const { db, etsy, scanner } = setup(4)
    ok(await scanner.scanShop(SHOP_ID))

    etsy.listings.push(mkEtsyListing(5))
    etsy.listings[0].state = 'sold_out' // #1 gone from the active list
    etsy.listings[1].price = { amount: 9999, divisor: 100, currency_code: 'UAH' } // #2 price
    etsy.listings[1].updated_timestamp = 1_800_000_000
    etsy.listings[2].title = 'Brand new title' // #3 title
    const scan = ok(await scanner.scanShop(SHOP_ID))

    expect(scan).toMatchObject({ isBaseline: false, total: 4, added: 1, removed: 1, changed: 2, returned: 0 })
    expect(changes(db, scan.id).sort()).toEqual(
      [['added', 5], ['changed', 2], ['changed', 3], ['removed', 1]].sort()
    )
    const byId = Object.fromEntries(listScanChanges(db, scan.id).map((c) => [c.listingId, c]))
    expect(byId[2].oldValue).toEqual({ priceAmount: 1002, priceDivisor: 100, currency: 'UAH' })
    expect(byId[2].newValue).toEqual({ priceAmount: 9999, priceDivisor: 100, currency: 'UAH' })
    expect(byId[3].oldValue).toEqual({ title: 'Listing 3' })
    expect(byId[3].newValue).toEqual({ title: 'Brand new title' })

    // Removed rows are kept, just marked.
    expect(getListing(db, 1)!.removedAt).not.toBeNull()
    expect(listActiveListings(db, SHOP_ID).map((l) => l.listingId).sort()).toEqual([2, 3, 4, 5])
    expect(getShopSummary(db, SHOP_ID)!.newCount).toBe(1)
    expect(getListing(db, 5)!.images).toHaveLength(2)
  })

  it('a listing coming back after removal is "returned", not "added"', async () => {
    const { db, etsy, scanner } = setup(2)
    ok(await scanner.scanShop(SHOP_ID))
    etsy.listings[0].state = 'inactive'
    ok(await scanner.scanShop(SHOP_ID))
    etsy.listings[0].state = 'active'
    const scan = ok(await scanner.scanShop(SHOP_ID))
    expect(scan).toMatchObject({ added: 0, returned: 1, removed: 0 })
    expect(changes(db, scan.id)).toEqual([['returned', 1]])
    expect(getListing(db, 1)!.removedAt).toBeNull()
    expect(getShopSummary(db, SHOP_ID)!.newCount).toBe(0)
  })

  it('an unchanged rescan records no changes (popularity moves are not changes)', async () => {
    const { db, etsy, scanner } = setup(3)
    ok(await scanner.scanShop(SHOP_ID))
    etsy.listings[0].views = 999
    etsy.listings[0].num_favorers = 77
    etsy.listings[0].featured_rank = 1
    etsy.listings[0].quantity = 1 // stock is not a change either
    const before = etsy.count('/v3/application/listings/batch')
    const scan = ok(await scanner.scanShop(SHOP_ID))
    expect(scan).toMatchObject({ added: 0, removed: 0, changed: 0, total: 3 })
    expect(listScanChanges(db, scan.id)).toEqual([])
    // Details (views!) are read for every listing on every scan: 1 request per 100.
    expect(etsy.count('/v3/application/listings/batch')).toBe(before + 1)
    const l = getListing(db, 1)!
    expect(l).toMatchObject({ views: 999, numFavorers: 77, featuredRank: 1, quantity: 1 })
    expect(l.images).toHaveLength(2)
  })

  it('fetches details for every active listing on every scan, 100 per request', async () => {
    const { etsy, scanner } = setup(150)
    ok(await scanner.scanShop(SHOP_ID))
    etsy.requests.length = 0
    ok(await scanner.scanShop(SHOP_ID))
    const batch = etsy.requests.filter((u) => u.pathname.endsWith('/listings/batch'))
    expect(batch.map((u) => u.searchParams.get('listing_ids')!.split(',').length)).toEqual([100, 50])
    expect(batch[0].searchParams.get('includes')).toBe('Images,Videos,Personalization')
  })

  it('a listing that only shifted out of the pages is verified, not marked removed', async () => {
    const { db, etsy, scanner } = setup(3)
    ok(await scanner.scanShop(SHOP_ID))
    // Page reading "loses" #2, but the batch endpoint says it is still active.
    etsy.intercept = (url) => {
      if (url.pathname.endsWith('/listings/active')) {
        const results = etsy.listings.filter((l) => l.listing_id !== 2).map(({ images: _i, ...l }) => l)
        return { body: { count: 3, results } }
      }
      return null
    }
    const scan = ok(await scanner.scanShop(SHOP_ID))
    expect(scan.removed).toBe(0)
    expect(getListing(db, 2)!.removedAt).toBeNull()
  })
})

describe('listings Etsy no longer knows (batch answers 404)', () => {
  it('deleted listings are marked removed instead of failing every rescan', async () => {
    const { db, etsy, scanner } = setup(4)
    etsy.batchUnknown = '404'
    ok(await scanner.scanShop(SHOP_ID))
    etsy.listings.splice(0, 1) // #1 deleted: unknown to /listings/batch and /listings/1
    etsy.listings[0].state = 'sold_out' // #2 still known, just not active
    const scan = ok(await scanner.scanShop(SHOP_ID))
    expect(scan).toMatchObject({ removed: 2, added: 0 })
    expect(changes(db, scan.id).sort()).toEqual([['removed', 1], ['removed', 2]])
    expect(getListing(db, 1)!.removedAt).not.toBeNull()
    expect(getListing(db, 3)!.removedAt).toBeNull()
    // …and the next rescan is clean, not stuck on the same ids.
    expect(ok(await scanner.scanShop(SHOP_ID))).toMatchObject({ removed: 0, added: 0 })
  })

  it('a listing deleted between paging and the details call is kept without images', async () => {
    const { db, etsy, scanner } = setup(2)
    etsy.batchUnknown = '404'
    ok(await scanner.scanShop(SHOP_ID))
    etsy.listings.push(mkEtsyListing(3))
    const ghost = mkEtsyListing(4) // on the active page, gone by the time we ask for details
    etsy.intercept = (url) => {
      if (!url.pathname.endsWith('/listings/active')) return null
      const results = [...etsy.listings, ghost].map(({ images: _i, ...l }) => l)
      return { body: { count: results.length, results } }
    }
    const scan = ok(await scanner.scanShop(SHOP_ID))
    expect(scan).toMatchObject({ added: 2, removed: 0 })
    expect(getListing(db, 3)!.images).toHaveLength(2)
    expect(getListing(db, 4)!.images).toEqual([])
  })
})

describe('truncated shops (more than ≈12,100 listings)', () => {
  it('skips the removal re-check and records the scan as truncated', async () => {
    const { db, etsy, scanner } = setup(3)
    ok(await scanner.scanShop(SHOP_ID))
    etsy.listings[0].state = 'inactive' // #1 drops out of the pages we can read
    etsy.intercept = (url) => {
      if (!url.pathname.endsWith('/listings/active')) return null
      const offset = Number(url.searchParams.get('offset'))
      const active = etsy.listings.filter((l) => l.state === 'active').map(({ images: _i, ...l }) => l)
      return { body: { count: 20000, results: active.slice(offset, offset + 100) } }
    }
    etsy.requests.length = 0
    const scan = ok(await scanner.scanShop(SHOP_ID))
    expect(scan).toMatchObject({ truncated: true, removed: 0 })
    expect(getListing(db, 1)!.removedAt).toBeNull()
    // Details are read for the listings on the pages only — #1 is never re-checked.
    const asked = etsy.requests
      .filter((u) => u.pathname.endsWith('/listings/batch'))
      .flatMap((u) => u.searchParams.get('listing_ids')!.split(','))
    expect(asked.sort()).toEqual(['2', '3'])
  })
})

describe('failures keep the previous state', () => {
  it('an API error mid-pagination marks nothing removed and writes no diff', async () => {
    const { db, etsy, scanner } = setup(250)
    ok(await scanner.scanShop(SHOP_ID))
    etsy.listings.push(mkEtsyListing(999))
    etsy.intercept = (url) =>
      url.pathname.endsWith('/listings/active') && url.searchParams.get('offset') === '100'
        ? { status: 500, body: { error: 'Internal' } }
        : null

    const res = await scanner.scanShop(SHOP_ID)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/HTTP 500/)

    expect(listActiveListings(db, SHOP_ID)).toHaveLength(250)
    expect(getListing(db, 999)).toBeNull()
    const [last, prev] = listScans(db, SHOP_ID)
    expect(last).toMatchObject({ status: 'error', added: 0, removed: 0 })
    expect(last.error).toMatch(/HTTP 500/)
    expect(listScanChanges(db, last.id)).toEqual([])
    const sum = getShopSummary(db, SHOP_ID)!
    expect(sum.lastOkScan?.id).toBe(prev.id)
    expect(sum.lastScan?.status).toBe('error')
  })

  it('429 exhaustion mid-scan is an error, not a half diff', async () => {
    const { db, etsy, scanner } = setup(3)
    ok(await scanner.scanShop(SHOP_ID))
    etsy.listings[0].state = 'removed'
    etsy.intercept = (url) =>
      url.pathname.endsWith('/listings/active')
        ? { status: 429, body: { error: 'rate' }, headers: { 'retry-after': '1' } }
        : null
    const res = await scanner.scanShop(SHOP_ID)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/ліміт/)
    expect(getListing(db, 1)!.removedAt).toBeNull()
  })

  it('a failure during the details phase also leaves the DB untouched', async () => {
    const { db, etsy, scanner } = setup(3)
    ok(await scanner.scanShop(SHOP_ID))
    etsy.listings.push(mkEtsyListing(4))
    etsy.intercept = (url) =>
      url.pathname.endsWith('/listings/batch') ? { throws: new TypeError('fetch failed') } : null
    const res = await scanner.scanShop(SHOP_ID)
    expect(res.ok).toBe(false)
    expect(getListing(db, 4)).toBeNull()
  })

  it('a bad key gives the Ukrainian auth message', async () => {
    const { etsy, scanner } = setup(3)
    etsy.intercept = () => ({ status: 403, body: { error: 'API key not found or not active' } })
    const res = await scanner.scanShop(SHOP_ID)
    expect(res).toMatchObject({ ok: false })
    if (!res.ok) expect(res.error).toMatch(/API-ключ/)
  })

  it('a shop that no longer exists on Etsy → not found', async () => {
    const { etsy, scanner } = setup(3)
    etsy.shop.shop_id = 1 // our SHOP_ID now 404s
    const res = await scanner.scanShop(SHOP_ID)
    if (res.ok) throw new Error('expected failure')
    expect(res.error).toMatch(/404/)
  })

  it('an unknown shop id fails without a scan row', async () => {
    const { db, scanner } = setup(1)
    const res = await scanner.scanShop(424242)
    expect(res.ok).toBe(false)
    expect(listScans(db, 424242)).toEqual([])
  })
})

describe('concurrency', () => {
  it('a second scan of the same shop is refused while the first runs', async () => {
    const { etsy, scanner } = setup(3)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const realFetch = etsy.fetch
    const client = etsy.client({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        await gate
        return realFetch(input, init)
      }) as typeof fetch
    })
    const db = memDb()
    seedShop(db, { id: SHOP_ID })
    const s = createScanner({ db, client })
    const first = s.scanShop(SHOP_ID)
    expect(s.isScanning(SHOP_ID)).toBe(true)
    const second = await s.scanShop(SHOP_ID)
    expect(second).toMatchObject({ ok: false, busy: true })
    release()
    expect((await first).ok).toBe(true)
    expect(s.isScanning(SHOP_ID)).toBe(false)
    // and the original scanner is untouched
    expect(scanner.isScanning(SHOP_ID)).toBe(false)
  })

  it('a scan left running by a crash is closed as an error at startup', () => {
    const db = memDb()
    seedShop(db, { id: SHOP_ID })
    db.prepare("INSERT INTO scans (shop_id, started_at, status) VALUES (?, 1, 'running')").run(SHOP_ID)
    createScanner({ db, client: new FakeEtsy().client(), now: () => 5 })
    expect(listScans(db, SHOP_ID)[0]).toMatchObject({ status: 'error', finishedAt: 5 })
  })
})

describe('diffListings (pure)', () => {
  it('splits added / returned / changed / removed', () => {
    const prev = [mkListing(1), mkListing(2, { removedAt: 5 }), mkListing(3), mkListing(4)]
    const cur = [mkInput(1), mkInput(2), mkInput(3, { title: 'x' }), mkInput(9)]
    const d = diffListings(prev, cur, { detectRemoved: true })
    expect(d.added.map((l) => l.listingId)).toEqual([9])
    expect(d.returned.map((l) => l.listingId)).toEqual([2])
    expect(d.changed.map((c) => c.listing.listingId)).toEqual([3])
    expect(d.removed.map((l) => l.listingId)).toEqual([4])
  })

  it('skips removals when detection is off (truncated listing set)', () => {
    const d = diffListings([mkListing(1)], [], { detectRemoved: false })
    expect(d.removed).toEqual([])
  })

  it('compares prices by value, not by representation', () => {
    expect(trackedDiff(mkListing(1, { priceAmount: 1500, priceDivisor: 100 }), mkInput(1, { priceAmount: 15000, priceDivisor: 1000 }))).toBeNull()
    expect(trackedDiff(mkListing(1), mkInput(1, { currency: 'USD' }))).not.toBeNull()
  })

  it('ignores stock and popularity', () => {
    expect(
      trackedDiff(mkListing(1), mkInput(1, { quantity: 99, views: 5, numFavorers: 7, featuredRank: 1 }))
    ).toBeNull()
  })
})

describe('progress callback is optional', () => {
  it('works without onProgress', async () => {
    const db = memDb()
    seedShop(db, { id: SHOP_ID })
    const etsy = new FakeEtsy(2)
    const s = createScanner({ db, client: etsy.client() })
    expect((await s.scanShop(SHOP_ID)).ok).toBe(true)
    expect(listActiveListings(db, SHOP_ID)).toHaveLength(2)
  })
})

describe('popularity history (listing_stats / shop_stats)', () => {
  it('every successful scan, baseline included, records stats; deltas compare with the previous scan', async () => {
    const { db, etsy, scanner } = setup(2)
    const s1 = ok(await scanner.scanShop(SHOP_ID))
    expect(listListingStats(db, 1)).toEqual([
      {
        scanId: s1.id,
        at: s1.finishedAt,
        views: 101,
        numFavorers: 11,
        featuredRank: -1,
        quantity: 5,
        reviewCount: null,
        reviewAvg: null,
        reviewsComplete: null,
        price: { amount: 1001, divisor: 100, currency: 'UAH' },
        buyerPrice: null
      }
    ])
    expect(getListing(db, 1)).toMatchObject({ views: 101, numFavorers: 11, favorersDelta: null, viewsDelta: null })
    expect(getShopSummary(db, SHOP_ID)).toMatchObject({
      stats: { numFavorers: 1530, transactionSoldCount: 2410, reviewCount: 512, reviewAverage: 4.9, listingActiveCount: 2 },
      statsDelta: null
    })

    etsy.listings[0].num_favorers = 20
    etsy.listings[0].views = 150
    etsy.shop.num_favorers = 1540
    etsy.shop.transaction_sold_count = 2413
    etsy.shop.review_average = 4.85
    const s2 = ok(await scanner.scanShop(SHOP_ID))
    expect(s2.changed).toBe(0)
    expect(listListingStats(db, 1).map((r) => [r.scanId, r.numFavorers, r.views])).toEqual([
      [s1.id, 11, 101],
      [s2.id, 20, 150]
    ])
    const l1 = listActiveListings(db, SHOP_ID).find((l) => l.listingId === 1)!
    expect(l1).toMatchObject({ numFavorers: 20, favorersDelta: 9, views: 150, viewsDelta: 49 })
    expect(getShopSummary(db, SHOP_ID)!.statsDelta).toEqual({
      numFavorers: 10,
      transactionSoldCount: 3,
      reviewCount: 0,
      reviewAverage: -0.05,
      listingActiveCount: 0
    })
  })

  it('a failed scan writes no stats', async () => {
    const { db, etsy, scanner } = setup(2)
    ok(await scanner.scanShop(SHOP_ID))
    etsy.intercept = (url) => (url.pathname.endsWith('/listings/batch') ? { status: 500, body: {} } : null)
    expect((await scanner.scanShop(SHOP_ID)).ok).toBe(false)
    expect(listListingStats(db, 1)).toHaveLength(1)
    expect(db.prepare('SELECT COUNT(*) AS n FROM shop_stats').get()).toEqual({ n: 1 })
  })
})

describe('rescan updates content and records what changed', () => {
  const fieldsOf = (db: Db, scanId: number, id: number) =>
    Object.keys(listScanChanges(db, scanId).find((c) => c.listingId === id)!.newValue!)

  it('description, tags and images are changes; the stored row and raw JSON are updated', async () => {
    const { db, etsy, scanner } = setup(3)
    ok(await scanner.scanShop(SHOP_ID))
    etsy.listings[0].description = 'A brand new description'
    etsy.listings[1].tags = ['new tag']
    // #3: image 32 replaced by 39, order changes
    etsy.listings[2].images = [mkEtsyImage(3, 9, { rank: 1 }), mkEtsyImage(3, 1, { rank: 2 })]
    const scan = ok(await scanner.scanShop(SHOP_ID))
    expect(scan.changed).toBe(3)
    const byId = Object.fromEntries(listScanChanges(db, scan.id).map((c) => [c.listingId, c]))
    expect(byId[1].oldValue).toEqual({ description: 'Description of 1' })
    expect(byId[1].newValue).toEqual({ description: 'A brand new description' })
    expect(byId[2].newValue).toEqual({ tags: ['new tag'] })
    expect(byId[3].oldValue).toEqual({ images: [31, 32] })
    expect(byId[3].newValue).toEqual({ images: [39, 31] })

    expect(getListing(db, 1)!.description).toBe('A brand new description')
    expect(JSON.parse(db.prepare('SELECT raw_json FROM listings WHERE listing_id = 1').get()!.raw_json as string).description).toBe(
      'A brand new description'
    )
    expect(getListing(db, 3)!.images.map((i) => i.id)).toEqual([39, 31])
    // The replaced image is kept but marked removed; the new one waits for the MinIO copy.
    expect(getImageRow(db, 32)!.removed_at).not.toBeNull()
    expect(getImageRow(db, 39)).toMatchObject({ removed_at: null, sync_status: 'pending' })
  })

  it('a changed CDN URL of the same image resets it to pending (re-download)', async () => {
    const { db, etsy, scanner } = setup(1)
    ok(await scanner.scanShop(SHOP_ID))
    db.prepare("UPDATE listing_images SET sync_status = 'stored', key_full = 'k' WHERE listing_image_id = 11").run()
    etsy.listings[0].images = [
      mkEtsyImage(1, 1, { url_fullxfull: 'https://i.etsystatic.com/1/il_fullxfull.11_v2.jpg' }),
      mkEtsyImage(1, 2)
    ]
    const scan = ok(await scanner.scanShop(SHOP_ID))
    expect(scan.changed).toBe(0) // same ids, same order → not a content change
    expect(getImageRow(db, 11)).toMatchObject({ sync_status: 'pending', url_fullxfull: expect.stringMatching(/_v2/) })
    expect(getImageRow(db, 12)!.sync_status).toBe('pending')
  })

  it('content fields (materials, who made, processing, dimensions, personalization) once stored with v2', async () => {
    const { db, etsy, scanner } = setup(1)
    etsy.listings[0].personalization = {
      personalization_questions: [{ question_text: 'Name', question_type: 'text_input', required: true }]
    }
    ok(await scanner.scanShop(SHOP_ID))
    Object.assign(etsy.listings[0], {
      materials: ['porcelain'],
      who_made: 'collective',
      processing_max: 5,
      item_weight: 0.5,
      personalization: { personalization_questions: [{ question_text: 'Name and date', question_type: 'text_input', required: true }] }
    })
    const scan = ok(await scanner.scanShop(SHOP_ID))
    expect(fieldsOf(db, scan.id, 1).sort()).toEqual(
      ['dimensions', 'materials', 'personalization', 'processingMax', 'processingMin', 'whoMade'].sort()
    )
    const c = listScanChanges(db, scan.id)[0]
    expect(c.oldValue).toMatchObject({ materials: ['stoneware', 'glaze'], whoMade: 'i_did', dimensions: '0.4 kg' })
    expect(c.newValue).toMatchObject({ materials: ['porcelain'], whoMade: 'collective', dimensions: '0.5 kg', processingMax: 5 })
    expect(getListing(db, 1)!.details).toMatchObject({ materials: ['porcelain'], whoMade: 'collective' })
  })

  it('videos appearing on a listing are a change', async () => {
    const { db, etsy, scanner } = setup(1)
    ok(await scanner.scanShop(SHOP_ID))
    etsy.listings[0].videos = [{ video_id: 77, width: 640, height: 360, video_state: 'active' }]
    const scan = ok(await scanner.scanShop(SHOP_ID))
    expect(listScanChanges(db, scan.id)[0].newValue).toEqual({ videos: [77] })
    expect(getListing(db, 1)!.videos).toEqual([
      { id: 77, width: 640, height: 360, thumbnailUrl: null, videoUrl: null, state: 'active' }
    ])
  })

  it('photos and videos shared by several listings are no false change on a rescan (seen live)', async () => {
    const { db, etsy, scanner } = setup(3)
    const shared = mkEtsyImage(1, 1) // image 11 of listing 1 …
    const video = { video_id: 77, width: 640, height: 360, video_state: 'active' }
    for (const l of etsy.listings) {
      if (l.listing_id !== 1) l.images = [...(l.images ?? []), { ...shared, listing_id: l.listing_id, rank: 3 }] // … reused on 2 and 3
      l.videos = [video]
    }
    ok(await scanner.scanShop(SHOP_ID))
    for (const id of [1, 2, 3]) {
      expect(getListing(db, id)!.images.map((i) => i.id)).toContain(11)
      expect(getListing(db, id)!.videos.map((v) => v.id)).toEqual([77])
    }
    expect(imageCounts(db, SHOP_ID).total).toBe(8)
    const scan = ok(await scanner.scanShop(SHOP_ID))
    expect(scan.changed).toBe(0)
    expect(listScanChanges(db, scan.id)).toEqual([])
  })

  it('when Etsy refuses Videos/Personalization the scan still works with Images only', async () => {
    const db = memDb()
    seedShop(db, { id: SHOP_ID })
    const etsy = new FakeEtsy(3, { refuseIncludes: ['Videos'] })
    const scanner = createScanner({ db, client: etsy.client() })
    ok(await scanner.scanShop(SHOP_ID))
    expect(getListing(db, 1)!.images).toHaveLength(2)
    expect(getListing(db, 1)!.views).toBe(101)
    expect(ok(await scanner.scanShop(SHOP_ID)).changed).toBe(0)
  })

  it('a listing deleted between paging and details keeps its stored views and images', async () => {
    const { db, etsy, scanner } = setup(2)
    ok(await scanner.scanShop(SHOP_ID))
    etsy.intercept = (url) =>
      url.pathname.endsWith('/listings/batch') ? { body: { count: 1, results: [etsy.listings[1]] } } : null
    const scan = ok(await scanner.scanShop(SHOP_ID))
    expect(scan.changed).toBe(0)
    expect(getListing(db, 1)).toMatchObject({ views: 101 })
    expect(getListing(db, 1)!.images).toHaveLength(2)
    expect(imageCounts(db, SHOP_ID).total).toBe(4)
    // The page item carries views (like live Etsy): a newer value is taken from it.
    etsy.listings[0].views = 150
    ok(await scanner.scanShop(SHOP_ID))
    expect(getListing(db, 1)).toMatchObject({ views: 150 })
    expect(getListing(db, 1)!.images).toHaveLength(2)
  })
  it('after the Images-only include fallback, stored personalization is kept and not reported as changed', async () => {
    const { db, etsy, scanner } = setup(2)
    const questions = {
      personalization_questions: [{ question_id: 1, question_text: 'Name', question_type: 'text_input', required: true }]
    }
    etsy.listings[0].personalization = questions as never
    ok(await scanner.scanShop(SHOP_ID))
    expect(getListing(db, 1)!.details!.personalization).toMatchObject([{ questionId: 1, text: 'Name' }])
    // A new client that gets 403 for the full include set → Images only.
    etsy.refuseIncludes = ['Personalization']
    const fallback = createScanner({ db, client: etsy.client(), now: () => 9_000_000 })
    const scan = ok(await fallback.scanShop(SHOP_ID))
    expect(scan.changed).toBe(0)
    expect(listScanChanges(db, scan.id)).toEqual([])
    expect(getListing(db, 1)!.details!.personalization).toMatchObject([{ questionId: 1, text: 'Name' }])
    // With the full includes again, a real removal is still detected.
    etsy.refuseIncludes = []
    etsy.listings[0].personalization = null
    const again = createScanner({ db, client: etsy.client(), now: () => 9_100_000 })
    const s3 = ok(await again.scanShop(SHOP_ID))
    expect(listScanChanges(db, s3.id)[0].newValue).toEqual({ personalization: null })
  })

  it('a views value of 0 for a listing that had views is treated as unknown (OAS: maybe not tabulated)', async () => {
    const { db, etsy, scanner } = setup(1)
    ok(await scanner.scanShop(SHOP_ID)) // views 101
    etsy.listings[0].views = 0
    const s2 = ok(await scanner.scanShop(SHOP_ID))
    const l = getListing(db, 1)!
    expect(l.views).toBe(101)
    expect(l.viewsDelta).toBe(0)
    expect(listListingStats(db, 1).map((p) => p.views)).toEqual([101, 101])
    expect(s2.changed).toBe(0)
    etsy.listings[0].views = 150
    ok(await scanner.scanShop(SHOP_ID))
    expect(getListing(db, 1)).toMatchObject({ views: 150, viewsDelta: 49 })
    // A brand-new listing with 0 views is a real 0.
    etsy.listings.push(mkEtsyListing(2, { views: 0 }))
    ok(await scanner.scanShop(SHOP_ID))
    expect(getListing(db, 2)!.views).toBe(0)
  })

  it('a scan without details for a listing keeps its SKUs and full raw JSON, and its stats history stays continuous', async () => {
    const { db, etsy, scanner } = setup(2)
    etsy.listings[0].skus = ['MUG-SUN-01']
    ok(await scanner.scanShop(SHOP_ID))
    expect(getListing(db, 1)!.details!.skus).toEqual(['MUG-SUN-01'])
    etsy.intercept = (url) =>
      url.pathname.endsWith('/listings/batch') ? { body: { count: 1, results: [etsy.listings[1]] } } : null
    ok(await scanner.scanShop(SHOP_ID))
    expect(getListing(db, 1)!.details!.skus).toEqual(['MUG-SUN-01'])
    const raw = JSON.parse(getListingRaw(db, 1)!)
    expect(raw.views).toBe(101)
    expect(raw.images).toHaveLength(2)
    expect(listListingStats(db, 1).map((p) => p.views)).toEqual([101, 101])
    etsy.intercept = undefined
    etsy.listings[0].views = 130
    ok(await scanner.scanShop(SHOP_ID))
    expect(getListing(db, 1)).toMatchObject({ views: 130, viewsDelta: 29 })
  })
})

describe('trackedDiff (pure, v2 fields)', () => {
  const det = (over = {}) => ({ ...mkInput(1).details!, ...over })

  it('a row from before schema v2 (no details) only compares title/price/description/tags/images', () => {
    const prev = mkListing(1, { details: null })
    const next = mkInput(1, { details: det({ materials: ['x'], whoMade: 'collective' }) })
    expect(trackedDiff(prev, next)).toBeNull()
  })

  it('images are compared only when fetched (null = not fetched) and known before', () => {
    const img = (id: number) => ({ id, rank: id, url75: '', url170: '', url570: '', urlFull: '', width: null, height: null, alt: null })
    expect(trackedDiff(mkListing(1, { images: [img(1)] }), mkInput(1, { images: null }))).toBeNull()
    expect(trackedDiff(mkListing(1, { images: [], details: null }), mkInput(1, { images: [img(2)] }))).toBeNull()
    expect(trackedDiff(mkListing(1, { images: [img(1)] }), mkInput(1, { images: [img(2)] }))!.new).toEqual({ images: [2] })
  })

  it('tags and materials compare as sets', () => {
    expect(trackedDiff(mkListing(1, { tags: ['a', 'b'] }), mkInput(1, { tags: ['b', 'a'] }))).toBeNull()
    const prev = mkListing(1, { details: det({ materials: ['a', 'b'] }) })
    expect(trackedDiff(prev, mkInput(1, { details: det({ materials: ['b', 'a'] }) }))).toBeNull()
  })

  it('long descriptions are shortened in the change row', () => {
    const long = 'x'.repeat(5000)
    const d = trackedDiff(mkListing(1), mkInput(1, { description: long }))!
    expect(d.new.description).toHaveLength(1001)
    expect(excerpt('short')).toBe('short')
  })

  it('dimensionsOf groups weight and size', () => {
    expect(dimensionsOf(null)).toBeNull()
    expect(dimensionsOf(det({ itemWeight: 1, itemWeightUnit: 'kg', itemLength: 2, itemWidth: 3, itemHeight: null, itemDimensionsUnit: 'cm' }))).toBe(
      '1 kg, 2×3×? cm'
    )
  })
})
