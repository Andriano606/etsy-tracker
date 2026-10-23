import { describe, expect, it } from 'vitest'
import {
  type Db,
  emptyReviewSync,
  finishScanError,
  finishScanOk,
  insertListingPriceStats,
  insertListingStats,
  insertRunningScan,
  insertShopStats,
  saveReviewSync,
  upsertListing
} from '../../src/main/db'
import {
  STATS_MIN_RATE_MS,
  monthStart,
  parseStatsRange,
  rangeStart,
  shopStatsPayload,
  statsSalesRate,
  weekStart
} from '../../src/main/shopStats'
import type { ShopStats } from '../../src/shared/types'
import { memDb, mkInput, seedShop } from '../helpers/db'

const SHOP = 20987654
const DAY = 86_400_000
const T0 = Date.UTC(2026, 8, 1, 12) // Tue 01.09.2026 12:00 UTC
/** Monday 19.10.2026 00:00 UTC, in Etsy seconds. */
const MON = Date.UTC(2026, 9, 19) / 1000

const totals = (over: Partial<Parameters<typeof finishScanOk>[3]> = {}) => ({
  isBaseline: false,
  truncated: false,
  total: 3,
  added: 0,
  removed: 0,
  changed: 0,
  returned: 0,
  ...over
})

const stats = (over: Partial<ShopStats> = {}): ShopStats => ({
  numFavorers: 100,
  transactionSoldCount: 1000,
  reviewCount: 50,
  reviewAverage: 4.8,
  listingActiveCount: 3,
  ...over
})

/** An ok scan finished at `at`, with optional shop_stats and listing_stats rows. */
function okScan(
  db: Db,
  at: number,
  opts: {
    shop?: Partial<ShopStats> | null
    listings?: Array<[number, number | null, number | null]>
    totals?: Parameters<typeof totals>[0]
  } = {}
): number {
  const id = insertRunningScan(db, SHOP, at - 1000)
  finishScanOk(db, id, at, totals(opts.totals))
  if (opts.shop !== null) insertShopStats(db, id, SHOP, stats(opts.shop))
  if (opts.listings) {
    insertListingStats(
      db,
      id,
      opts.listings.map(([listingId, views, numFavorers]) => ({
        listingId,
        views,
        numFavorers,
        featuredRank: null,
        quantity: 1
      }))
    )
  }
  return id
}

function review(db: Db, key: string, created: number, rating: number, listingId: number | null = 1): void {
  db.prepare(
    `INSERT INTO reviews (review_key, shop_id, listing_id, rating, created_timestamp, raw_json, first_seen_at, last_seen_at, origin)
     VALUES (?, ?, ?, ?, ?, '{}', 0, 0, 'backfill')`
  ).run(key, SHOP, listingId, rating, created)
}

function synced(db: Db, complete = true): void {
  saveReviewSync(db, { ...emptyReviewSync(SHOP), backfill_upper: MON + 30 * 86400, backfill_complete: complete ? 1 : 0 })
}

function setup(): Db {
  const db = memDb()
  seedShop(db)
  for (const id of [1, 2, 3, 4]) upsertListing(db, mkInput(id), 0)
  return db
}

describe('shopStatsPayload', () => {
  it('null for an unknown shop; an empty, well-formed payload for a shop with nothing', () => {
    const db = setup()
    expect(shopStatsPayload(db, 999, 'all', T0)).toBeNull()
    const p = shopStatsPayload(db, SHOP, 'all', T0)!
    expect(p).toMatchObject({
      shopId: SHOP,
      range: 'all',
      from: null,
      to: T0,
      scans: [],
      intervals: [],
      salesRate: [],
      reviews: { synced: false, complete: false, total: 0, avg: null, weeks: [], months: [] },
      top: { fromScanId: null, toScanId: null, views: [], favorers: [], reviews: [] }
    })
  })

  it('series of ok scans only, oldest first by time; scans without stats rows have nulls', () => {
    const db = setup()
    const a = okScan(db, T0, { shop: null, totals: { isBaseline: true, total: 3 } }) // a v1-era scan
    const e = insertRunningScan(db, SHOP, T0 + DAY)
    finishScanError(db, e, T0 + DAY + 5, 'boom')
    insertRunningScan(db, SHOP, T0 + 1.5 * DAY) // still running
    const b = okScan(db, T0 + 2 * DAY, {
      shop: { transactionSoldCount: 1040, numFavorers: 110 },
      listings: [
        [1, 100, 10],
        [2, 50, null],
        [3, null, 4]
      ],
      totals: { added: 2, changed: 1 }
    })
    const p = shopStatsPayload(db, SHOP, 'all', T0 + 3 * DAY)!
    expect(p.scans.map((s) => s.scanId)).toEqual([a, b])
    expect(p.scans[0]).toMatchObject({
      at: T0,
      isBaseline: true,
      transactionSoldCount: null,
      numFavorers: null,
      reviewAverage: null,
      listingViews: null,
      listingFavorers: null
    })
    expect(p.scans[1]).toMatchObject({
      at: T0 + 2 * DAY,
      isBaseline: false,
      added: 2,
      changed: 1,
      transactionSoldCount: 1040,
      numFavorers: 110,
      reviewAverage: 4.8,
      listingViews: 150, // unknown values are left out of the sum
      listingFavorers: 14
    })
    // One interval, every delta unknown because the first scan has no stats.
    expect(p.intervals).toEqual([
      expect.objectContaining({ fromScanId: a, toScanId: b, days: 2, sold: null, favorers: null, views: null })
    ])
    expect(p.salesRate).toEqual([])
  })

  it('deltas and sales per day over irregular gaps; scans < 1 h apart merge into the next interval', () => {
    const db = setup()
    const s1 = okScan(db, T0, { shop: { transactionSoldCount: 100, numFavorers: 10 } })
    const s2 = okScan(db, T0 + 2 * DAY, { shop: { transactionSoldCount: 140, numFavorers: 12 } })
    const s3 = okScan(db, T0 + 2 * DAY + 10 * 60_000, { shop: { transactionSoldCount: 141, numFavorers: 12 } })
    const s4 = okScan(db, T0 + 5.5 * DAY, { shop: { transactionSoldCount: 170, numFavorers: 9 } })
    const p = shopStatsPayload(db, SHOP, 'all', T0 + 6 * DAY)!
    expect(p.intervals.map((i) => [i.fromScanId, i.toScanId, i.sold, i.favorers])).toEqual([
      [s1, s2, 40, 2],
      [s2, s3, 1, 0],
      [s3, s4, 29, -3]
    ])
    expect(p.intervals[1].days).toBeCloseTo(10 / 1440, 6)
    expect(p.salesRate).toHaveLength(2)
    expect(p.salesRate[0]).toMatchObject({ fromScanId: s1, toScanId: s2, days: 2, sold: 40, perDay: 20 })
    // s3 (10 min after s2) is skipped: s2 → s4 = 30 sales over 3.5 days.
    expect(p.salesRate[1]).toMatchObject({ fromScanId: s2, toScanId: s4, sold: 30 })
    expect(p.salesRate[1].days).toBeCloseTo(3.5, 9)
    expect(p.salesRate[1].perDay).toBeCloseTo(30 / 3.5, 9)
  })

  it('sales rate needs two scans that know the sold count, at least the minimum apart', () => {
    const pt = (at: number, sold: number | null) =>
      ({ scanId: at, at, transactionSoldCount: sold }) as Parameters<typeof statsSalesRate>[0][number]
    expect(statsSalesRate([])).toEqual([])
    expect(statsSalesRate([pt(0, 5)])).toEqual([])
    expect(statsSalesRate([pt(0, 5), pt(STATS_MIN_RATE_MS - 1, 9)])).toEqual([])
    expect(statsSalesRate([pt(0, 5), pt(DAY, null), pt(2 * DAY, 9)])).toEqual([
      expect.objectContaining({ fromScanId: 0, toScanId: 2 * DAY, sold: 4, perDay: 2 })
    ])
  })

  it('a range keeps only scans finished inside it (all / 90 / 30 / 7 days)', () => {
    const db = setup()
    const now = T0 + 100 * DAY
    const old = okScan(db, T0) // 100 days ago
    const m = okScan(db, now - 40 * DAY)
    const w = okScan(db, now - 20 * DAY)
    const d = okScan(db, now - 2 * DAY)
    const ids = (r: Parameters<typeof shopStatsPayload>[2]) => shopStatsPayload(db, SHOP, r, now)!.scans.map((s) => s.scanId)
    expect(ids('all')).toEqual([old, m, w, d])
    expect(ids('90d')).toEqual([m, w, d])
    expect(ids('30d')).toEqual([w, d])
    expect(ids('7d')).toEqual([d])
    expect(shopStatsPayload(db, SHOP, '7d', now)!.from).toBe(now - 7 * DAY)
    expect(rangeStart('all', now)).toBeNull()
  })

  it('a range starts at the latest scan before it: deltas, sales/day and top growth cover the whole period', () => {
    const db = setup()
    const now = T0 + 100 * DAY
    okScan(db, now - 20 * DAY, { shop: { transactionSoldCount: 50 } })
    const before = okScan(db, now - 8 * DAY, { shop: { transactionSoldCount: 100 }, listings: [[1, 100, 5]] })
    const inside = okScan(db, now - 3600_000, { shop: { transactionSoldCount: 170 }, listings: [[1, 900, 5]] })
    const p = shopStatsPayload(db, SHOP, '7d', now)!
    expect(p.scans.map((s) => s.scanId)).toEqual([inside])
    expect(p.anchor).toMatchObject({ scanId: before, at: now - 8 * DAY, transactionSoldCount: 100 })
    expect(p.intervals.map((i) => [i.fromScanId, i.toScanId, i.sold])).toEqual([[before, inside, 70]])
    expect(p.salesRate).toEqual([expect.objectContaining({ fromScanId: before, toScanId: inside, sold: 70 })])
    expect(p.top).toMatchObject({ fromScanId: before, toScanId: inside, seriesAt: [now - 8 * DAY, now - 3600_000] })
    expect(p.top.views.map((r) => [r.listingId, r.start, r.end, r.delta])).toEqual([[1, 100, 900, 800]])
    // "Усе" has no anchor; neither has a period without a scan of its own.
    expect(shopStatsPayload(db, SHOP, 'all', now)!.anchor).toBeNull()
    expect(shopStatsPayload(db, SHOP, '7d', now + 30 * DAY)!).toMatchObject({ scans: [], anchor: null, salesRate: [] })
  })

  it('the newest scans less than the minimum after the last interval extend it (no sales left out)', () => {
    const pt = (at: number, sold: number) =>
      ({ scanId: at, at, transactionSoldCount: sold }) as Parameters<typeof statsSalesRate>[0][number]
    const H = 3600_000
    const r = statsSalesRate([pt(0, 100), pt(2 * H, 110), pt(2 * H + 50 * 60_000, 150)])
    expect(r).toEqual([expect.objectContaining({ fromScanId: 0, toScanId: 2 * H + 50 * 60_000, sold: 50 })])
    expect(r[0].days).toBeCloseTo((2 * H + 50 * 60_000) / DAY, 9)
    // Every sale is in exactly one interval: they add up to last − first.
    const many = statsSalesRate([pt(0, 0), pt(3 * H, 5), pt(3 * H + 60_000, 6), pt(7 * H, 9), pt(7 * H + 5 * 60_000, 12)])
    expect(many.reduce((a, x) => a + x.sold, 0)).toBe(12)
    expect(many.map((x) => [x.fromScanId, x.toScanId])).toEqual([
      [0, 3 * H],
      [3 * H, 7 * H + 5 * 60_000]
    ])
    // Only scans within the minimum of each other: still no interval.
    expect(statsSalesRate([pt(0, 1), pt(10 * 60_000, 2), pt(29 * 60_000, 3)])).toEqual([])
  })

  it('parseStatsRange accepts only the known ranges', () => {
    expect(parseStatsRange('30d')).toBe('30d')
    expect(parseStatsRange('1y')).toBe('all')
    expect(parseStatsRange(undefined)).toBe('all')
    expect(parseStatsRange({})).toBe('all')
  })
})

describe('review buckets (UTC weeks from Monday, UTC months)', () => {
  it('weekStart / monthStart are UTC and independent of the local time zone', () => {
    expect(weekStart(MON)).toBe(MON)
    expect(weekStart(MON - 1)).toBe(MON - 7 * 86400) // Sunday 23:59:59 belongs to the previous week
    expect(weekStart(MON + 7 * 86400 - 1)).toBe(MON)
    expect(new Date(weekStart(1_700_000_000) * 1000).getUTCDay()).toBe(1)
    expect(monthStart(Date.UTC(2026, 9, 31, 23, 59, 59) / 1000)).toBe(Date.UTC(2026, 9, 1) / 1000)
    expect(monthStart(Date.UTC(2026, 10, 1) / 1000)).toBe(Date.UTC(2026, 10, 1) / 1000)
  })

  it('the buckets do not depend on the machine time zone', () => {
    const db = setup()
    synced(db)
    for (let i = 0; i < 40; i++) review(db, `z${i}`, MON - i * 31_337, 1 + (i % 5))
    const now = (MON + 86400) * 1000
    const prev = process.env.TZ
    try {
      process.env.TZ = 'America/Los_Angeles'
      const la = shopStatsPayload(db, SHOP, 'all', now)!.reviews
      process.env.TZ = 'Asia/Tokyo'
      const tokyo = shopStatsPayload(db, SHOP, 'all', now)!.reviews
      expect(la).toEqual(tokyo)
      expect(la.weeks.every((w) => new Date(w.start * 1000).getUTCDay() === 1)).toBe(true)
      expect(la.months.every((m) => new Date(m.start * 1000).getUTCDate() === 1)).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.TZ
      else process.env.TZ = prev
    }
  })

  it('counts, ratings and averages per week, every week present, the current one partial', () => {
    const db = setup()
    synced(db)
    review(db, 'a', MON - 14 * 86400 + 5, 5) // week of 05.10
    review(db, 'b', MON - 1, 3) // Sunday 18.10 23:59:59 → week of 12.10
    review(db, 'c', MON, 5) // Monday 19.10 00:00:00 → week of 19.10
    review(db, 'd', MON + 3600, 4)
    review(db, 'e', MON + 7200, 2, null) // no listing: still counted
    const now = (MON + 3 * 86400) * 1000 // Thursday 22.10
    const p = shopStatsPayload(db, SHOP, 'all', now)!
    expect(p.reviews).toMatchObject({ synced: true, complete: true, total: 5, avg: 3.8 })
    expect(p.reviews.weeks.map((w) => [w.start, w.count, w.avg, w.partial])).toEqual([
      [MON - 14 * 86400, 1, 5, false],
      [MON - 7 * 86400, 1, 3, false],
      [MON, 3, 3.67, true]
    ])
    expect(p.reviews.weeks[2].ratings).toEqual([0, 1, 0, 1, 1])
    expect(p.reviews.weeks[2].end).toBe(MON + 7 * 86400)
    expect(p.reviews.months).toEqual([
      expect.objectContaining({ start: Date.UTC(2026, 9, 1) / 1000, end: Date.UTC(2026, 10, 1) / 1000, count: 5, partial: true })
    ])
  })

  it('gaps are zero-filled; a range cuts the history and marks its first bucket partial', () => {
    const db = setup()
    synced(db, false)
    review(db, 'old', MON - 70 * 86400, 1)
    review(db, 'x', MON - 35 * 86400, 5)
    review(db, 'y', MON + 10, 5)
    const now = (MON + 6 * 86400) * 1000
    const all = shopStatsPayload(db, SHOP, 'all', now)!
    expect(all.reviews.complete).toBe(false)
    expect(all.reviews.weeks).toHaveLength(11)
    expect(all.reviews.weeks.filter((w) => w.count > 0)).toHaveLength(3)
    expect(all.reviews.weeks[1]).toMatchObject({ count: 0, avg: null, ratings: [0, 0, 0, 0, 0] })
    expect(all.reviews.weeks[0].partial).toBe(false) // the history starts here; not a cut
    const m = shopStatsPayload(db, SHOP, '30d', now)!
    expect(m.reviews.total).toBe(1)
    expect(m.reviews.weeks[0].start).toBe(weekStart(Math.ceil((now - 30 * DAY) / 1000)))
    expect(m.reviews.weeks[0].partial).toBe(true)
    expect(m.reviews.weeks.at(-1)!.count).toBe(1)
  })

  it('a shop with 150 000 reviews: "Усе" still works (no argument spread over every row)', () => {
    const db = setup()
    synced(db)
    const ins = db.prepare(
      `INSERT INTO reviews (review_key, shop_id, listing_id, rating, created_timestamp, raw_json, first_seen_at, last_seen_at, origin)
       VALUES (?, ?, 1, 5, ?, '{}', 0, 0, 'backfill')`
    )
    db.exec('BEGIN')
    for (let i = 0; i < 150_000; i++) ins.run(`k${i}`, SHOP, MON - i * 300)
    db.exec('COMMIT')
    const p = shopStatsPayload(db, SHOP, 'all', (MON + 86400) * 1000)!
    expect(p.reviews.total).toBe(150_000)
    expect(p.reviews.weeks[0].start).toBe(weekStart(MON - 149_999 * 300))
    expect(p.reviews.weeks.reduce((a, w) => a + w.count, 0)).toBe(150_000)
  }, 30_000)

  it('the period filter uses the (shop_id, created_timestamp) index', () => {
    const db = setup()
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT created_timestamp AS ts, rating, COUNT(*) AS n FROM reviews
         WHERE shop_id = ? AND created_timestamp IS NOT NULL AND created_timestamp >= ? AND created_timestamp <= ?
         GROUP BY ts, rating`
      )
      .all(SHOP, 1, 2) as Array<{ detail: string }>
    expect(plan.map((r) => r.detail).join(' | ')).toMatch(/reviews_shop_created/)
  })

  it('a shop never synced has no buckets even with rows', () => {
    const db = setup()
    review(db, 'a', MON, 5)
    const p = shopStatsPayload(db, SHOP, 'all', (MON + 10) * 1000)!
    expect(p.reviews).toMatchObject({ synced: false, total: 0, weeks: [], months: [] })
    expect(p.top.reviews).toEqual([])
  })
})

describe('top growth', () => {
  it('views/favorers: first vs last scan of the period, growth only, ordered by Δ, then value, then id', () => {
    const db = setup()
    const s1 = okScan(db, T0, { listings: [[1, 100, 5], [2, 100, 5], [3, 300, 5], [4, 500, 9]] })
    const s2 = okScan(db, T0 + DAY, { shop: null }) // no listing stats: not a sparkline point
    const s3 = okScan(db, T0 + 2 * DAY, { listings: [[1, 120, 6], [2, 200, 5], [3, 400, 8], [4, 400, 9]] })
    const s4 = okScan(db, T0 + 3 * DAY, { listings: [[1, 150, 7], [2, 300, 5], [3, 500, 7], [4, 450, 9]] })
    void s2
    const t = shopStatsPayload(db, SHOP, 'all', T0 + 4 * DAY)!.top
    expect(t).toMatchObject({ fromScanId: s1, toScanId: s4, fromAt: T0, toAt: T0 + 3 * DAY })
    // 2 and 3 both +200: the bigger end value first; 4 went down → left out.
    expect(t.views.map((r) => [r.listingId, r.delta, r.start, r.end])).toEqual([
      [3, 200, 300, 500],
      [2, 200, 100, 300],
      [1, 50, 100, 150]
    ])
    expect(t.views[0]).toMatchObject({ title: 'Listing 3', imageId: null, series: [300, 400, 500] })
    expect(t.favorers.map((r) => [r.listingId, r.delta])).toEqual([
      [1, 2],
      [3, 2]
    ])
    void s3
  })

  it('listings missing at the first scan still count: from their first value, or from 0 when created later', () => {
    const db = setup()
    upsertListing(db, mkInput(5, { etsyCreatedAt: Math.floor((T0 + DAY) / 1000) }), 0) // created mid-period
    const s1 = okScan(db, T0, { listings: [[1, 100, 5], [2, 100, 1]] })
    const s2 = okScan(db, T0 + 2 * DAY, { listings: [[1, 105, 5], [3, 200, 2]] }) // 3 returned
    const s3 = okScan(db, T0 + 3 * DAY, { listings: [[1, 110, 5], [2, 100, 1], [3, 260, 9], [5, 5000, 400]] })
    const t = shopStatsPayload(db, SHOP, 'all', T0 + 4 * DAY)!.top
    expect(t.views.map((r) => [r.listingId, r.start, r.end, r.delta])).toEqual([
      [5, 0, 5000, 5000],
      [3, 200, 260, 60],
      [1, 100, 110, 10]
    ])
    expect(t.views[0].series).toEqual([null, null, 5000])
    expect(t.views[1].series).toEqual([null, 200, 260])
    expect(t.favorers.map((r) => [r.listingId, r.delta])).toEqual([
      [5, 400],
      [3, 7]
    ])
    expect(t.seriesAt).toEqual([T0, T0 + 2 * DAY, T0 + 3 * DAY])
    expect(t.views.every((r) => r.stored)).toBe(true)
    void s1
    void s2
    void s3
  })

  it('needs two scans with listing stats; one scan gives empty tables', () => {
    const db = setup()
    const s = okScan(db, T0, { listings: [[1, 100, 5]] })
    const t = shopStatsPayload(db, SHOP, 'all', T0 + DAY)!.top
    expect(t).toMatchObject({ fromScanId: s, toScanId: s, views: [], favorers: [] })
  })

  it('reviews: most reviewed listings in the period with their earlier count and a 12-slice sparkline', () => {
    const db = setup()
    synced(db)
    const now = (MON + 86400) * 1000
    review(db, 'p1', MON - 100 * 86400, 5, 2) // before the 30-day range
    for (let i = 0; i < 3; i++) review(db, `a${i}`, MON - i * 86400, 5, 2)
    for (let i = 0; i < 2; i++) review(db, `b${i}`, MON - i * 86400, 4, 1)
    review(db, 'c0', MON, 5, 9) // a listing we never stored
    const t = shopStatsPayload(db, SHOP, '30d', now)!.top
    expect(t.reviews.map((r) => [r.listingId, r.delta, r.start, r.end])).toEqual([
      [2, 3, 1, 4],
      [1, 2, 0, 2],
      [9, 1, 0, 1]
    ])
    expect(t.reviews[2]).toMatchObject({ title: 'Товар #9', stored: false })
    expect(t.reviews[0].stored).toBe(true)
    expect(t.reviews[0].series).toHaveLength(12)
    expect(t.reviews[0].series.reduce((a, b) => a! + b!, 0)).toBe(3)
    const all = shopStatsPayload(db, SHOP, 'all', now)!.top
    expect(all.reviews[0]).toMatchObject({ listingId: 2, delta: 4, start: 0, end: 4 })
  })
})

describe('listings with a discount per scan (listing_price_stats)', () => {
  const bp = (hasDiscount: boolean) => ({
    country: 'UA',
    currency: 'USD',
    base: { amount: 300, divisor: 100 },
    original: { amount: 300, divisor: 100 },
    discounted: hasDiscount ? { amount: 120, divisor: 100 } : null,
    discountAmount: hasDiscount ? { amount: 180, divisor: 100 } : null,
    discountPercentage: hasDiscount ? 60 : null,
    hasDiscount,
    discountStart: null,
    discountEnd: null,
    shipping: null,
    isFreeShipping: null
  })
  const prices = (db: Db, scanId: number, flags: Array<boolean | null>) =>
    insertListingPriceStats(
      db,
      scanId,
      flags.map((f, i) => ({ listingId: i + 1, priceAmount: 250, priceDivisor: 100, currency: 'USD', buyerPrice: f == null ? null : bp(f) }))
    )

  it('counts discounted listings among those with a known buyer price; null when a scan learned none', () => {
    const db = memDb()
    seedShop(db)
    const pre = okScan(db, T0) // before v4: no price rows at all
    const none = okScan(db, T0 + DAY)
    prices(db, none, [null, null, null]) // Etsy refused BuyerPrice
    const s3 = okScan(db, T0 + 2 * DAY)
    prices(db, s3, [true, false, null])
    const s4 = okScan(db, T0 + 3 * DAY)
    prices(db, s4, [true, true, false])
    const s5 = okScan(db, T0 + 4 * DAY)
    prices(db, s5, [false, false, false])
    const p = shopStatsPayload(db, SHOP, 'all', T0 + 5 * DAY)!
    expect(p.scans.map((s) => [s.scanId, s.discounted, s.buyerPriced])).toEqual([
      [pre, null, null],
      [none, null, null],
      [s3, 1, 2],
      [s4, 2, 3],
      [s5, 0, 3]
    ])
  })

  it('the anchor carries the count too; another shop’s rows never mix in', () => {
    const db = memDb()
    seedShop(db)
    seedShop(db, { id: 777, shopName: 'Other' })
    const a = okScan(db, T0)
    prices(db, a, [true])
    const other = insertRunningScan(db, 777, T0)
    finishScanOk(db, other, T0 + 1, totals())
    prices(db, other, [true, true, true])
    const b = okScan(db, T0 + 20 * DAY)
    prices(db, b, [false])
    const p = shopStatsPayload(db, SHOP, '7d', T0 + 21 * DAY)!
    expect(p.anchor).toMatchObject({ scanId: a, discounted: 1, buyerPriced: 1 })
    expect(p.scans.map((s) => [s.scanId, s.discounted])).toEqual([[b, 0]])
  })
})
