// UI harness, step 1: dump what the renderer would get from main, read from a
// COPY of the app's database, into .ui-harness/fixtures.json (gitignored — it
// holds real shop data). Run: npx vite-node scripts/ui-harness/fixtures.ts -- <db-copy> <out.json>

import { writeFileSync } from 'fs'
import { openDb, listShopSummaries, listActiveListings, listScans, listScanChanges, listScanPromotions, listNewReviews, listListingStats, listListingPromotions, listListingReviews, getImageRow, imageCounts, getListingRaw } from '../../src/main/db'
import { shopStatsPayload } from '../../src/main/shopStats'
import { listDrafts } from '../../src/main/drafts'
import { STATS_RANGES } from '../../src/shared/types'

const [dbPath, out] = process.argv.slice(2).filter((a) => a !== '--')
const db = openDb(dbPath)
const now = Date.now()
const shops = listShopSummaries(db)
const perShop: Record<number, unknown> = {}
const listingExtras: Record<number, unknown> = {}
const images: Record<number, Record<string, string>> = {}

for (const s of shops) {
  const listings = listActiveListings(db, s.id).slice(0, 120)
  const scans = listScans(db, s.id)
  const last = s.lastOkScan
  perShop[s.id] = {
    listings,
    scans,
    lastChanges: last ? listScanChanges(db, last.id) : [],
    scanPromotions: last ? listScanPromotions(db, last.id) : { started: [], ended: [] },
    newReviews: last ? listNewReviews(db, last.id) : [],
    imageCounts: imageCounts(db, s.id),
    stats: Object.fromEntries(STATS_RANGES.map((r) => [r, shopStatsPayload(db, s.id, r, now)])),
    scanChanges: Object.fromEntries(scans.slice(0, 5).map((sc) => [sc.id, listScanChanges(db, sc.id)]))
  }
  for (const l of listings.slice(0, 40)) {
    listingExtras[l.listingId] = {
      stats: listListingStats(db, l.listingId),
      promotions: listListingPromotions(db, l.listingId),
      reviews: listListingReviews(db, l.listingId, 0, 20),
      raw: getListingRaw(db, l.listingId)
    }
  }
  for (const l of listings) {
    for (const img of l.images) {
      const row = getImageRow(db, img.id)
      if (row) images[img.id] = { '570xN': row.url_570xN, fullxfull: row.url_fullxfull, '170x135': row.url_170x135, '75x75': row.url_75x75 }
    }
  }
}

writeFileSync(out, JSON.stringify({ generatedAt: now, shops, perShop, listingExtras, images, drafts: listDrafts(db) }))
console.log(`fixtures: ${shops.length} shops → ${out}`)
