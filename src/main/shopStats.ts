// Read-only queries behind the Statistics view (`stats:shop`). Everything is
// aggregated here in main so the renderer gets a compact, chart-ready payload
// (a few hundred numbers) instead of thousands of rows.
//
// Time: scan times are our epoch ms; review times are Etsy epoch seconds.
// Review buckets are calendar weeks (Monday 00:00 UTC) and months (the 1st
// 00:00 UTC) — UTC on purpose, so a bucket never depends on the machine's
// time zone or DST; the renderer formats their labels in UTC too.

import type {
  ShopStatsPayload,
  StatsInterval,
  StatsRange,
  StatsReviewBucket,
  StatsSalesRate,
  StatsScanPoint,
  StatsTop,
  StatsTopRow
} from '../shared/types'
import { STATS_RANGES } from '../shared/types'
import type { Db } from './db'

const DAY_MS = 86_400_000
const WEEK_S = 7 * 86_400
/** 1970-01-05 00:00 UTC, a Monday: the anchor of the week buckets. */
const MONDAY_EPOCH_S = 4 * 86_400

/** Sales/day is only computed over at least this much time (shorter gaps are merged). */
export const STATS_MIN_RATE_MS = 60 * 60 * 1000
/** Rows per "Топ товарів за ростом" table. */
export const STATS_TOP_N = 10
/** Time slices of a reviews sparkline in the top table. */
export const STATS_SPARK_SLICES = 12

const RANGE_DAYS: Record<Exclude<StatsRange, 'all'>, number> = { '90d': 90, '30d': 30, '7d': 7 }

/** A range from the renderer; anything unknown is "Усе". */
export function parseStatsRange(v: unknown): StatsRange {
  return STATS_RANGES.includes(v as StatsRange) ? (v as StatsRange) : 'all'
}

/** Start of the period (ms) for a range; null = everything. */
export function rangeStart(range: StatsRange, now: number): number | null {
  return range === 'all' ? null : now - RANGE_DAYS[range] * DAY_MS
}

/** Monday 00:00 UTC of the week holding `sec` (Etsy epoch seconds). */
export function weekStart(sec: number): number {
  const off = (((sec - MONDAY_EPOCH_S) % WEEK_S) + WEEK_S) % WEEK_S
  return sec - off
}

/** The 1st 00:00 UTC of the month holding `sec`. */
export function monthStart(sec: number): number {
  const d = new Date(sec * 1000)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
}

function nextMonth(sec: number): number {
  const d = new Date(sec * 1000)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000
}

const diff = (a: number | null, b: number | null): number | null => (a == null || b == null ? null : a - b)

// ---------------------------------------------------------------------- scans

interface ScanStatsRow {
  id: number
  finished_at: number
  is_baseline: number
  truncated: number
  total: number
  added: number
  removed: number
  changed: number
  returned: number
  num_favorers: number | null
  transaction_sold_count: number | null
  review_count: number | null
  review_average: number | null
  listing_active_count: number | null
  ls_rows: number | null
  ls_views: number | null
  ls_favorers: number | null
}

const SCAN_STATS_SQL = `SELECT s.id, s.finished_at, s.is_baseline, s.truncated, s.total, s.added, s.removed, s.changed, s.returned,
     ss.num_favorers, ss.transaction_sold_count, ss.review_count, ss.review_average, ss.listing_active_count,
     ls.n AS ls_rows, ls.v AS ls_views, ls.f AS ls_favorers
   FROM scans s
   LEFT JOIN shop_stats ss ON ss.scan_id = s.id
   LEFT JOIN (
     SELECT scan_id, COUNT(*) AS n, SUM(views) AS v, SUM(num_favorers) AS f FROM listing_stats
     WHERE scan_id IN (SELECT id FROM scans WHERE shop_id = ?) GROUP BY scan_id
   ) ls ON ls.scan_id = s.id
   WHERE s.shop_id = ? AND s.status = 'ok' AND s.finished_at IS NOT NULL`

function toScanPoint(r: ScanStatsRow): StatsScanPoint {
  return {
    scanId: r.id,
    at: r.finished_at,
    isBaseline: !!r.is_baseline,
    truncated: !!r.truncated,
    total: r.total ?? 0,
    added: r.added ?? 0,
    removed: r.removed ?? 0,
    changed: r.changed ?? 0,
    returned: r.returned ?? 0,
    numFavorers: r.num_favorers,
    transactionSoldCount: r.transaction_sold_count,
    reviewCount: r.review_count,
    reviewAverage: r.review_average,
    listingActiveCount: r.listing_active_count,
    listingViews: r.ls_rows ? r.ls_views : null,
    listingFavorers: r.ls_rows ? r.ls_favorers : null
  }
}

/** The shop's successful scans finished at/after `from` (all when null), oldest first. */
export function statsScans(db: Db, shopId: number, from: number | null): StatsScanPoint[] {
  const rows = db
    .prepare(`${SCAN_STATS_SQL} AND s.finished_at >= ? ORDER BY s.finished_at, s.id`)
    .all(shopId, shopId, from ?? Number.MIN_SAFE_INTEGER) as unknown as ScanStatsRow[]
  return rows.map(toScanPoint)
}

/**
 * The latest successful scan finished before `from` — the period's starting
 * point, so a delta "over the period" starts at the period's edge rather than
 * at its first scan (and a shop scanned weekly still has a 7-day change).
 */
export function statsAnchor(db: Db, shopId: number, from: number): StatsScanPoint | null {
  const row = db
    .prepare(`${SCAN_STATS_SQL} AND s.finished_at < ? ORDER BY s.finished_at DESC, s.id DESC LIMIT 1`)
    .get(shopId, shopId, from) as unknown as ScanStatsRow | undefined
  return row ? toScanPoint(row) : null
}

/** Deltas between consecutive scans (null where either side is unknown). */
export function statsIntervals(scans: StatsScanPoint[]): StatsInterval[] {
  const out: StatsInterval[] = []
  for (let i = 1; i < scans.length; i++) {
    const a = scans[i - 1]
    const b = scans[i]
    out.push({
      fromScanId: a.scanId,
      toScanId: b.scanId,
      from: a.at,
      to: b.at,
      days: (b.at - a.at) / DAY_MS,
      sold: diff(b.transactionSoldCount, a.transactionSoldCount),
      favorers: diff(b.numFavorers, a.numFavorers),
      reviews: diff(b.reviewCount, a.reviewCount),
      views: diff(b.listingViews, a.listingViews)
    })
  }
  return out
}

/**
 * Sales per day between scans that know `transaction_sold_count`. A scan less
 * than `minMs` after the previous anchor is skipped (its gap merges into the
 * next interval), so scans minutes apart can't turn one sale into "300/день".
 * Scans less than `minMs` after the last interval's end extend that interval,
 * so the newest sales are never left out (the intervals add up to the total Δ).
 */
export function statsSalesRate(scans: StatsScanPoint[], minMs = STATS_MIN_RATE_MS): StatsSalesRate[] {
  const known = scans.filter((s) => s.transactionSoldCount != null)
  const out: StatsSalesRate[] = []
  const interval = (a: StatsScanPoint, b: StatsScanPoint): StatsSalesRate => {
    const days = (b.at - a.at) / DAY_MS
    const sold = b.transactionSoldCount! - a.transactionSoldCount!
    return { fromScanId: a.scanId, toScanId: b.scanId, from: a.at, to: b.at, days, sold, perDay: sold / days }
  }
  let anchor = known[0]
  let anchorOfLast: StatsScanPoint | null = null
  for (const s of known.slice(1)) {
    if (s.at - anchor.at < minMs) continue
    out.push(interval(anchor, s))
    anchorOfLast = anchor
    anchor = s
  }
  const tail = known[known.length - 1]
  if (anchorOfLast && tail && tail !== anchor) out[out.length - 1] = interval(anchorOfLast, tail)
  return out
}

// -------------------------------------------------------------------- reviews

/**
 * When a review was created. `mapReview` already fills `created_timestamp` from
 * either OAS spelling, so the column alone is the creation time — and filtering
 * on it (not on a COALESCE) lets SQLite use `reviews_shop_created`.
 */
const CREATED = 'created_timestamp'

function emptyBucket(start: number, end: number): StatsReviewBucket {
  return { start, end, count: 0, avg: null, ratings: [0, 0, 0, 0, 0], partial: false }
}

/**
 * Reviews created in [lo, nowSec] per week and month (UTC), every bucket in
 * between present (0 included). `lo` null = from the shop's oldest review.
 */
export function reviewBuckets(
  db: Db,
  shopId: number,
  lo: number | null,
  nowSec: number
): { weeks: StatsReviewBucket[]; months: StatsReviewBucket[]; total: number; avg: number | null } {
  const rows = db
    .prepare(
      `SELECT ${CREATED} AS ts, rating, COUNT(*) AS n FROM reviews
       WHERE shop_id = ? AND ${CREATED} IS NOT NULL AND ${CREATED} >= ? AND ${CREATED} <= ?
       GROUP BY ts, rating`
    )
    .all(shopId, lo ?? Number.MIN_SAFE_INTEGER, nowSec) as Array<{ ts: number; rating: number | null; n: number }>
  if (!rows.length) return { weeks: [], months: [], total: 0, avg: null }
  // A loop, not Math.min(...rows): one row per distinct (second, rating) — a
  // spread of 100k+ arguments overflows the stack.
  let first = lo ?? Infinity
  if (lo == null) for (const r of rows) if (r.ts < first) first = r.ts

  const build = (startOf: (s: number) => number, next: (s: number) => number): StatsReviewBucket[] => {
    const buckets: StatsReviewBucket[] = []
    const index = new Map<number, StatsReviewBucket>()
    for (let s = startOf(first); s <= nowSec; s = next(s)) {
      const b = emptyBucket(s, next(s))
      // A period cut into the bucket, or the bucket isn't over yet.
      b.partial = (lo != null && s < lo) || b.end > nowSec + 1
      buckets.push(b)
      index.set(s, b)
    }
    const sums = new Map<StatsReviewBucket, { sum: number; n: number }>()
    for (const r of rows) {
      const b = index.get(startOf(r.ts))
      if (!b) continue
      b.count += r.n
      if (r.rating != null && r.rating >= 1 && r.rating <= 5) {
        b.ratings[Math.round(r.rating) - 1] += r.n
        const acc = sums.get(b) ?? { sum: 0, n: 0 }
        acc.sum += r.rating * r.n
        acc.n += r.n
        sums.set(b, acc)
      }
    }
    for (const [b, acc] of sums) b.avg = acc.n ? Math.round((acc.sum / acc.n) * 100) / 100 : null
    return buckets
  }

  let total = 0
  let sum = 0
  let rated = 0
  for (const r of rows) {
    total += r.n
    if (r.rating != null) {
      sum += r.rating * r.n
      rated += r.n
    }
  }
  return {
    weeks: build(weekStart, (s) => s + WEEK_S),
    months: build(monthStart, nextMonth),
    total,
    avg: rated ? Math.round((sum / rated) * 100) / 100 : null
  }
}

// ------------------------------------------------------------------ top growth

interface ListingMeta {
  title: string
  imageId: number | null
}

function listingMeta(db: Db, ids: number[]): Map<number, ListingMeta> {
  const out = new Map<number, ListingMeta>()
  if (!ids.length) return out
  const rows = db
    .prepare(
      `SELECT l.listing_id, l.title,
         (SELECT i.listing_image_id FROM listing_images i
          WHERE i.listing_id = l.listing_id AND i.removed_at IS NULL
          ORDER BY i.rank, i.listing_image_id LIMIT 1) AS image_id
       FROM listings l WHERE l.listing_id IN (${ids.map(() => '?').join(',')})`
    )
    .all(...ids) as Array<{ listing_id: number; title: string; image_id: number | null }>
  for (const r of rows) out.set(r.listing_id, { title: r.title, imageId: r.image_id })
  return out
}

function withMeta(
  db: Db,
  rows: Array<Omit<StatsTopRow, 'title' | 'imageId' | 'stored'>>
): StatsTopRow[] {
  const meta = listingMeta(db, rows.map((r) => r.listingId))
  return rows.map((r) => ({
    ...r,
    title: meta.get(r.listingId)?.title ?? `Товар #${r.listingId}`,
    imageId: meta.get(r.listingId)?.imageId ?? null,
    stored: meta.has(r.listingId)
  }))
}

/**
 * Biggest growth of `col` (views | num_favorers) over the given scans (oldest
 * first) up to the last one's listing_stats. Each listing starts at its own
 * first known value among those scans — a listing that wasn't there at the
 * first scan (returned, or added) still counts — and from 0 when Etsy created
 * it after the first scan (every view it has came during the period).
 */
function topListingGrowth(
  db: Db,
  col: 'views' | 'num_favorers',
  scans: Array<{ scanId: number; at: number }>,
  limit: number
): StatsTopRow[] {
  if (scans.length < 2) return []
  const scanIds = scans.map((s) => s.scanId)
  const fromAt = scans[0].at
  const toId = scanIds[scanIds.length - 1]
  const inScans = scanIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT listing_id, start, "end", "end" - start AS delta FROM (
         SELECT b.listing_id, b.${col} AS "end",
           CASE WHEN COALESCE(l.original_created_at, l.etsy_created_at) * 1000 > ? THEN 0 ELSE (
             SELECT a.${col} FROM listing_stats a JOIN scans s ON s.id = a.scan_id
             WHERE a.listing_id = b.listing_id AND a.scan_id IN (${inScans}) AND a.${col} IS NOT NULL
             ORDER BY s.finished_at, s.id LIMIT 1
           ) END AS start
         FROM listing_stats b LEFT JOIN listings l ON l.listing_id = b.listing_id
         WHERE b.scan_id = ? AND b.${col} IS NOT NULL
       )
       WHERE start IS NOT NULL AND "end" > start
       ORDER BY delta DESC, "end" DESC, listing_id
       LIMIT ?`
    )
    .all(fromAt, ...scanIds, toId, limit) as Array<{ listing_id: number; start: number; end: number; delta: number }>
  if (!rows.length) return []
  const ids = rows.map((r) => r.listing_id)
  const pos = new Map(scanIds.map((id, i) => [id, i]))
  const series = new Map<number, Array<number | null>>(ids.map((id) => [id, scanIds.map(() => null)]))
  const pts = db
    .prepare(
      `SELECT scan_id, listing_id, ${col} AS v FROM listing_stats
       WHERE listing_id IN (${ids.map(() => '?').join(',')}) AND scan_id IN (${inScans})`
    )
    .all(...ids, ...scanIds) as Array<{ scan_id: number; listing_id: number; v: number | null }>
  for (const p of pts) series.get(p.listing_id)![pos.get(p.scan_id)!] = p.v
  return withMeta(
    db,
    rows.map((r) => ({ listingId: r.listing_id, start: r.start, end: r.end, delta: r.delta, series: series.get(r.listing_id)! }))
  )
}

/** Listings with the most reviews created in [lo, nowSec]; `lo` null = the whole history. */
function topReviewed(db: Db, shopId: number, lo: number | null, nowSec: number, limit: number): StatsTopRow[] {
  const from = lo ?? Number.MIN_SAFE_INTEGER
  const rows = db
    .prepare(
      `SELECT listing_id, COUNT(*) AS n,
         (SELECT COUNT(*) FROM reviews p WHERE p.listing_id = r.listing_id AND p.shop_id = r.shop_id
            AND p.created_timestamp < ?) AS before
       FROM reviews r
       WHERE shop_id = ? AND listing_id IS NOT NULL AND ${CREATED} >= ? AND ${CREATED} <= ?
       GROUP BY listing_id ORDER BY n DESC, listing_id LIMIT ?`
    )
    .all(from, shopId, from, nowSec, limit) as Array<{ listing_id: number; n: number; before: number }>
  if (!rows.length) return []
  // Sparkline: the period cut into equal slices (from the oldest review for "Усе").
  const start =
    lo ??
    ((db.prepare(`SELECT MIN(${CREATED}) AS m FROM reviews WHERE shop_id = ?`).get(shopId) as { m: number | null }).m ??
      nowSec)
  const span = Math.max(1, nowSec - start + 1)
  const ids = rows.map((r) => r.listing_id)
  const series = new Map<number, Array<number | null>>(ids.map((id) => [id, Array(STATS_SPARK_SLICES).fill(0)]))
  const pts = db
    .prepare(
      `SELECT listing_id, ${CREATED} AS ts FROM reviews
       WHERE shop_id = ? AND listing_id IN (${ids.map(() => '?').join(',')}) AND ${CREATED} >= ? AND ${CREATED} <= ?`
    )
    .all(shopId, ...ids, start, nowSec) as Array<{ listing_id: number; ts: number }>
  for (const p of pts) {
    const i = Math.min(STATS_SPARK_SLICES - 1, Math.floor(((p.ts - start) * STATS_SPARK_SLICES) / span))
    const s = series.get(p.listing_id)!
    s[i] = (s[i] ?? 0) + 1
  }
  return withMeta(
    db,
    rows.map((r) => ({
      listingId: r.listing_id,
      start: r.before,
      end: r.before + r.n,
      delta: r.n,
      series: series.get(r.listing_id)!
    }))
  )
}

export function statsTop(
  db: Db,
  shopId: number,
  scans: StatsScanPoint[],
  lo: number | null,
  nowSec: number,
  /** Oldest first; the period's anchor scan (if any) first. The shop's reviews were synced (else the reviews table is left empty, like the chart). */
  reviewsSynced: boolean,
  limit = STATS_TOP_N
): StatsTop {
  const withStats = scans.filter((s) => s.listingViews != null || s.listingFavorers != null)
  const first = withStats[0]
  const last = withStats[withStats.length - 1]
  return {
    fromScanId: first?.scanId ?? null,
    toScanId: last?.scanId ?? null,
    fromAt: first?.at ?? null,
    toAt: last?.at ?? null,
    seriesAt: withStats.map((s) => s.at),
    views: topListingGrowth(db, 'views', withStats, limit),
    favorers: topListingGrowth(db, 'num_favorers', withStats, limit),
    reviews: reviewsSynced ? topReviewed(db, shopId, lo, nowSec, limit) : []
  }
}

// -------------------------------------------------------------------- payload

/** The Statistics view of one shop for a period; null when the shop doesn't exist. */
export function shopStatsPayload(db: Db, shopId: number, range: StatsRange, now: number): ShopStatsPayload | null {
  if (!db.prepare('SELECT 1 FROM shops WHERE id = ?').get(shopId)) return null
  const from = rangeStart(range, now)
  const nowSec = Math.floor(now / 1000)
  const loSec = from == null ? null : Math.ceil(from / 1000)
  const scans = statsScans(db, shopId, from)
  // The starting point before the period — only when the period has a scan.
  const anchor = from != null && scans.length ? statsAnchor(db, shopId, from) : null
  const series = anchor ? [anchor, ...scans] : scans
  const sync = db
    .prepare('SELECT backfill_upper, backfill_complete FROM review_sync WHERE shop_id = ?')
    .get(shopId) as { backfill_upper: number | null; backfill_complete: number } | undefined
  const synced = sync?.backfill_upper != null
  const buckets = synced ? reviewBuckets(db, shopId, loSec, nowSec) : { weeks: [], months: [], total: 0, avg: null }
  return {
    shopId,
    range,
    from,
    to: now,
    scans,
    anchor,
    intervals: statsIntervals(series),
    salesRate: statsSalesRate(series),
    reviews: { synced, complete: !!sync?.backfill_complete, ...buckets },
    top: statsTop(db, shopId, series, loSec, nowSec, synced)
  }
}
