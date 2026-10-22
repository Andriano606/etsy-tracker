import { describe, expect, it } from 'vitest'
import {
  type Db,
  getListing,
  getShopSummary,
  listActiveListings,
  listScanChanges,
  listScans
} from '../../src/main/db'
import { createScanner, diffListings, trackedDiff } from '../../src/main/scanner'
import type { ScanOutcome, ScanProgress } from '../../src/shared/types'
import { FakeEtsy, SHOP_ID, mkEtsyListing } from '../helpers/fakeEtsy'
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

  it('an unchanged rescan records no changes and fetches no details', async () => {
    const { db, etsy, scanner } = setup(3)
    ok(await scanner.scanShop(SHOP_ID))
    const before = etsy.count('/v3/application/listings/batch')
    const scan = ok(await scanner.scanShop(SHOP_ID))
    expect(scan).toMatchObject({ added: 0, removed: 0, changed: 0, total: 3 })
    expect(listScanChanges(db, scan.id)).toEqual([])
    expect(etsy.count('/v3/application/listings/batch')).toBe(before)
    // Stored images survive a rescan that did not refetch them.
    expect(getListing(db, 1)!.images).toHaveLength(2)
  })

  it('refetches details only for modified listings', async () => {
    const { etsy, scanner } = setup(3)
    ok(await scanner.scanShop(SHOP_ID))
    etsy.listings[1].updated_timestamp = 1_900_000_000
    etsy.requests.length = 0
    ok(await scanner.scanShop(SHOP_ID))
    const batch = etsy.requests.filter((u) => u.pathname.endsWith('/listings/batch'))
    expect(batch.map((u) => u.searchParams.get('listing_ids'))).toEqual(['2'])
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
    expect(etsy.count('/v3/application/listings/batch')).toBe(0)
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

  it('ignores changes to untracked fields', () => {
    expect(trackedDiff(mkListing(1), mkInput(1, { description: 'other', quantity: 99 }))).toBeNull()
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
