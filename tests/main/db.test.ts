import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MIGRATIONS,
  deleteShop,
  failStaleRunningScans,
  finishScanError,
  finishScanOk,
  getListing,
  getShopSummary,
  insertChange,
  insertRunningScan,
  listActiveListings,
  listScanChanges,
  listScans,
  listShopSummaries,
  markListingRemoved,
  migrate,
  openDb,
  schemaVersion,
  transaction,
  upsertListing,
  findShopByName,
  insertShop,
  getImageRow,
  getListingRaw,
  getShopRaw,
  imageCounts,
  insertListingStats,
  insertShopStats,
  listImagesToCleanup,
  listImagesToSync,
  listShopObjectKeys,
  markImageError,
  markImageObjectsDeleted,
  markImageMissing,
  resetStoredImages,
  listStoredImages,
  markImageStored,
  updateShopInfo,
  listListingStats,
  saveReviewSync,
  emptyReviewSync,
  upsertReviews,
  writeReviewStats,
  type Db
} from '../../src/main/db'
import { mapReview, mapShop } from '../../src/main/mapEtsy'
import shopFx from '../fixtures/shop.json'
import reviewFx from '../fixtures/transactionReview.json'
import { memDb, memDbAt, mkInput, mkShop, seedShop } from '../helpers/db'

const img = (id: number) => ({
  id,
  rank: 1,
  url75: 'a',
  url170: 'b',
  url570: 'c',
  urlFull: 'd',
  width: null,
  height: null,
  alt: null
})

/** ListingImage colour/date fields absent from `img()`, as read back from the DB. */
const noMeta = {
  hexCode: null,
  red: null,
  green: null,
  blue: null,
  hue: null,
  saturation: null,
  brightness: null,
  isBlackAndWhite: null,
  createdAt: null
}

describe('migrations', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('a fresh db ends at the latest schema version', () => {
    const db = memDb()
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tables).toEqual(expect.arrayContaining(['listings', 'scan_changes', 'scans', 'shops']))
  })

  it('re-running migrate is a no-op', () => {
    const db = memDb()
    seedShop(db)
    migrate(db)
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
    expect(listShopSummaries(db)).toHaveLength(1)
  })

  it('persists across reopen of a file db', () => {
    const dir = mkdtempSync(join(tmpdir(), 'etsy-db-'))
    dirs.push(dir)
    const path = join(dir, 'x.db')
    const a = openDb(path)
    seedShop(a)
    a.close()
    const b = openDb(path)
    expect(schemaVersion(b)).toBe(MIGRATIONS.length)
    expect(listShopSummaries(b).map((s) => s.shopName)).toEqual(['CeramicStudioUA'])
    b.close()
  })

  it('a failing migration rolls back entirely and leaves user_version unchanged', () => {
    const db = memDb()
    seedShop(db)
    const v = MIGRATIONS.length
    const next = [
      ...MIGRATIONS,
      // Works up to the last statement, which fails — none of it may stick.
      `ALTER TABLE shops ADD COLUMN note TEXT;
       CREATE TABLE extra (id INTEGER PRIMARY KEY);
       INSERT INTO no_such_table VALUES (1);`
    ]
    expect(() => migrate(db, next)).toThrow(/no_such_table/)
    expect(schemaVersion(db)).toBe(v)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tables).not.toContain('extra')
    const cols = db
      .prepare('PRAGMA table_info(shops)')
      .all()
      .map((r) => (r as { name: string }).name)
    expect(cols).not.toContain('note')
    expect(listShopSummaries(db)).toHaveLength(1)
    // Earlier migrations that succeeded in the same run stay applied.
    const fresh = memDbAt(0)
    expect(() => migrate(fresh, next)).toThrow()
    expect(schemaVersion(fresh)).toBe(v)
  })

  it('refuses a db from a newer app version', () => {
    const db = memDb()
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`)
    expect(() => migrate(db)).toThrow(/новішою версією/)
  })

  it('swallows only the node:sqlite ExperimentalWarning while loading, then restores emitWarning', async () => {
    vi.resetModules()
    const original = process.emitWarning
    const emitted = vi.fn()
    process.emitWarning = emitted as unknown as typeof process.emitWarning
    const realGet = process.getBuiltinModule.bind(process)
    const get = vi.spyOn(process, 'getBuiltinModule').mockImplementation((id: string) => {
      // What Node does on the first load of node:sqlite.
      process.emitWarning('SQLite is an experimental feature and might change at any time', 'ExperimentalWarning')
      process.emitWarning('something else')
      return realGet(id)
    })
    try {
      const fresh = await import('../../src/main/db')
      fresh.openDb(':memory:').close()
      expect(emitted).toHaveBeenCalledTimes(1)
      expect(emitted).toHaveBeenCalledWith('something else')
      expect(process.emitWarning).toBe(emitted)
    } finally {
      get.mockRestore()
      process.emitWarning = original
    }
  })
})

describe('transaction', () => {
  it('rolls back on throw', () => {
    const db = memDb()
    expect(() =>
      transaction(db, () => {
        seedShop(db)
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(listShopSummaries(db)).toHaveLength(0)
  })
})

describe('shops', () => {
  it('finds by name case-insensitively and rejects a duplicate name', () => {
    const db = memDb()
    seedShop(db)
    expect(findShopByName(db, 'ceramicstudioua')?.id).toBe(20987654)
    expect(() => insertShop(db, mkShop({ id: 2, shopName: 'CERAMICSTUDIOUA' }))).toThrow()
  })

  it('summary: counts active listings and exposes the latest scans', () => {
    const db = memDb()
    seedShop(db)
    upsertListing(db, mkInput(1), 10)
    upsertListing(db, mkInput(2), 10)
    markListingRemoved(db, 2, 20)
    const s1 = insertRunningScan(db, 20987654, 1)
    finishScanOk(db, s1, 2, { isBaseline: false, truncated: false, total: 1, added: 3, removed: 1, changed: 0, returned: 0 })
    const s2 = insertRunningScan(db, 20987654, 3)
    finishScanError(db, s2, 4, 'boom')
    const sum = getShopSummary(db, 20987654)!
    expect(sum.activeCount).toBe(1)
    expect(sum.lastOkScan?.id).toBe(s1)
    expect(sum.lastScan?.id).toBe(s2)
    expect(sum.lastScan?.error).toBe('boom')
    expect(sum.newCount).toBe(3)
  })

  it('a baseline scan reports no new items', () => {
    const db = memDb()
    seedShop(db)
    const s = insertRunningScan(db, 20987654, 1)
    finishScanOk(db, s, 2, { isBaseline: true, truncated: false, total: 5, added: 0, removed: 0, changed: 0, returned: 0 })
    expect(getShopSummary(db, 20987654)!.newCount).toBe(0)
  })

  it('deleteShop removes its listings, scans and changes but not other shops', () => {
    const db = memDb()
    seedShop(db)
    seedShop(db, { id: 2, shopName: 'Other' })
    upsertListing(db, mkInput(1), 10)
    upsertListing(db, mkInput(9, { shopId: 2 }), 10)
    const s = insertRunningScan(db, 20987654, 1)
    insertChange(db, s, 1, 'added', null, null)
    deleteShop(db, 20987654)
    expect(listShopSummaries(db).map((x) => x.id)).toEqual([2])
    expect(getListing(db, 1)).toBeNull()
    expect(getListing(db, 9)).not.toBeNull()
    expect(listScans(db, 20987654)).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM scan_changes').get()).toEqual({ n: 0 })
  })
})

describe('listings upsert', () => {
  it('inserts with bookkeeping and JSON columns round-tripped', () => {
    const db = memDb()
    seedShop(db)
    upsertListing(db, mkInput(1, { tags: ['x', 'y'], images: [img(5)] }), 100)
    const l = getListing(db, 1)!
    expect(l.tags).toEqual(['x', 'y'])
    expect(l.images).toEqual([{ ...img(5), ...noMeta, syncStatus: 'pending', storedAt: null }])
    expect(l.firstSeenAt).toBe(100)
    expect(l.lastSeenAt).toBe(100)
    expect(l.removedAt).toBeNull()
  })

  it('update keeps first_seen_at, bumps last_seen_at, revives a removed row', () => {
    const db = memDb()
    seedShop(db)
    upsertListing(db, mkInput(1, { images: [img(5)] }), 100)
    markListingRemoved(db, 1, 150)
    expect(getListing(db, 1)!.removedAt).toBe(150)
    upsertListing(db, mkInput(1, { title: 'New', images: null }), 200)
    const l = getListing(db, 1)!
    expect(l.title).toBe('New')
    expect(l.firstSeenAt).toBe(100)
    expect(l.lastSeenAt).toBe(200)
    expect(l.removedAt).toBeNull()
    // images: null = not fetched this time → stored ones kept
    expect(l.images).toEqual([expect.objectContaining(img(5))])
  })

  it('images: [] replaces stored images; new rows with null images get []', () => {
    const db = memDb()
    seedShop(db)
    upsertListing(db, mkInput(1, { images: [img(5)] }), 1)
    upsertListing(db, mkInput(1, { images: [] }), 2)
    expect(getListing(db, 1)!.images).toEqual([])
    upsertListing(db, mkInput(2, { images: null }), 2)
    expect(getListing(db, 2)!.images).toEqual([])
  })

  it('listActiveListings skips removed rows, newest Etsy creation first', () => {
    const db = memDb()
    seedShop(db)
    for (const id of [1, 2, 3]) upsertListing(db, mkInput(id), 1)
    markListingRemoved(db, 2, 5)
    expect(listActiveListings(db, 20987654).map((l) => l.listingId)).toEqual([3, 1])
  })
})

describe('scans', () => {
  it('lists newest first and parses change JSON with the joined listing', () => {
    const db = memDb()
    seedShop(db)
    upsertListing(db, mkInput(1), 1)
    const a = insertRunningScan(db, 20987654, 1)
    const b = insertRunningScan(db, 20987654, 2)
    insertChange(db, b, 1, 'changed', { title: 'old' }, { title: 'new' })
    expect(listScans(db, 20987654).map((s) => s.id)).toEqual([b, a])
    const [c] = listScanChanges(db, b)
    expect(c.kind).toBe('changed')
    expect(c.oldValue).toEqual({ title: 'old' })
    expect(c.newValue).toEqual({ title: 'new' })
    expect(c.listing?.listingId).toBe(1)
  })

  it('failStaleRunningScans marks leftovers as errors', () => {
    const db = memDb()
    seedShop(db)
    const s = insertRunningScan(db, 20987654, 1)
    expect(failStaleRunningScans(db, 9)).toBe(1)
    expect(listScans(db, 20987654)[0]).toMatchObject({ id: s, status: 'error', finishedAt: 9 })
  })
})

/** A database created by the v1 app (schema version 1) with some data in it. */
function v1Db(): Db {
  // A real v1 database, built from scratch with only the first migration.
  const db = memDbAt(1)
  expect(schemaVersion(db)).toBe(1)
  db.prepare(
    "INSERT INTO shops (id, shop_name, title, url, currency, etsy_active_count, added_at) VALUES (20987654, 'CeramicStudioUA', 'T', 'u', 'UAH', 2, 1)"
  ).run()
  const v1Images = JSON.stringify([
    { id: 501, rank: 1, url75: 'a75', url170: 'a170', url570: 'a570', urlFull: 'afull', width: 10, height: 20, alt: 'first' },
    { id: 502, rank: 2, url75: 'b75', url170: 'b170', url570: 'b570', urlFull: 'bfull', width: null, height: null, alt: null }
  ])
  const ins = db.prepare(
    `INSERT INTO listings (listing_id, shop_id, title, description, price_amount, price_divisor, currency, url,
       tags, quantity, etsy_created_at, etsy_updated_at, images, first_seen_at, last_seen_at, removed_at)
     VALUES (?, 20987654, ?, 'd', 1000, 100, 'UAH', 'u', '["x"]', 1, 1, 1, ?, 100, 200, ?)`
  )
  ins.run(1, 'Active one', v1Images, null)
  ins.run(2, 'Removed one', '[]', 300)
  ins.run(3, 'Broken JSON', 'not json', null)
  // Etsy reuses one photo on several listings: image 501 is on listing 4 too.
  ins.run(4, 'Shares a photo', JSON.stringify([{ id: 501, rank: 3, url75: 'a75', url170: 'a170', url570: 'a570', urlFull: 'afull' }]), null)
  const scan = db.prepare("INSERT INTO scans (shop_id, started_at, finished_at, status, is_baseline, total) VALUES (20987654, 1, 2, 'ok', 1, 2)").run()
  db.prepare("INSERT INTO scan_changes (scan_id, listing_id, kind, old_value, new_value) VALUES (?, 1, 'changed', '{\"title\":\"a\"}', '{\"title\":\"b\"}')").run(
    Number(scan.lastInsertRowid)
  )
  return db
}

describe('migration v2 (from a real v1 database)', () => {
  it('adds the v2 columns/tables and backfills images as pending listing_images rows', () => {
    const db = v1Db()
    migrate(db)
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tables).toEqual(expect.arrayContaining(['listing_images', 'listing_videos', 'listing_stats', 'shop_stats']))
    const cols = (t: string) =>
      db.prepare(`PRAGMA table_info(${t})`).all().map((r) => (r as { name: string }).name)
    expect(cols('listings')).toEqual(
      expect.arrayContaining(['views', 'num_favorers', 'featured_rank', 'materials', 'raw_json', 'who_made', 'item_weight'])
    )
    expect(cols('listings')).not.toContain('images')
    expect(cols('shops')).toEqual(expect.arrayContaining(['transaction_sold_count', 'review_average', 'raw_json', 'policy_shipping']))

    // Images moved to listing_images, in rank order, waiting for MinIO.
    const l1 = getListing(db, 1)!
    expect(l1.images.map((i) => [i.id, i.rank, i.url570, i.urlFull, i.alt, i.syncStatus])).toEqual([
      [501, 1, 'a570', 'afull', 'first', 'pending'],
      [502, 2, 'b570', 'bfull', null, 'pending']
    ])
    expect(getImageRow(db, 501)).toMatchObject({ shop_id: 20987654, full_width: 10, full_height: 20, first_seen_at: 100 })
    expect(getListing(db, 3)!.images).toEqual([]) // corrupt v1 JSON is skipped, not fatal
    expect(getListing(db, 4)!.images.map((i) => [i.id, i.rank])).toEqual([[501, 3]]) // shared photo kept on both
    expect(getListing(db, 1)!.images.map((i) => i.id)).toEqual([501, 502])
    // Active rows get state 'active', removed ones keep removed_at; v2-only fields are unknown.
    expect(l1).toMatchObject({ state: 'active', views: null, numFavorers: null, details: null })
    expect(getListing(db, 2)).toMatchObject({ state: null, removedAt: 300 })
    // Old scan rows and changes survive untouched.
    expect(listScans(db, 20987654)).toHaveLength(1)
    expect(listScanChanges(db, listScans(db, 20987654)[0].id)[0].newValue).toEqual({ title: 'b' })
    expect(getShopSummary(db, 20987654)).toMatchObject({ profile: null, stats: null, statsDelta: null })
    expect(imageCounts(db, 20987654)).toEqual({ total: 3, stored: 0, pending: 3, error: 0 })
  })
})

describe('listing_images', () => {
  const ref = (id: number, listingId = 1) => ({ listing_id: listingId, listing_image_id: id })
  const im = (id: number, rank: number, over = {}) => ({ ...img(id), rank, urlFull: `full${id}`, url570: `570-${id}`, ...over })

  it('new ids are inserted pending, gone ids get removed_at, a returning id is revived', () => {
    const db = memDb()
    seedShop(db)
    upsertListing(db, mkInput(1, { images: [im(1, 1), im(2, 2)] }), 10)
    upsertListing(db, mkInput(1, { images: [im(2, 1), im(3, 2)] }), 20)
    expect(getListing(db, 1)!.images.map((i) => i.id)).toEqual([2, 3])
    expect(getImageRow(db, 1)!.removed_at).toBe(20)
    expect(getImageRow(db, 2)).toMatchObject({ rank: 1, removed_at: null })
    upsertListing(db, mkInput(1, { images: [im(1, 1)] }), 30)
    expect(getImageRow(db, 1)!.removed_at).toBeNull()
    expect(getListing(db, 1)!.images.map((i) => i.id)).toEqual([1])
  })

  it('sync bookkeeping: to-sync list, stored guard on the downloaded URL, errors with attempts, cleanup', () => {
    const db = memDb()
    seedShop(db)
    upsertListing(db, mkInput(1, { images: [im(1, 1), im(2, 2)] }), 10)
    expect(listImagesToSync(db).map((r) => r.listing_image_id)).toEqual([1, 2])
    const info = { keyFull: 'k1', key570: 'k1t', byteSize: 3, contentType: 'image/jpeg', etag: 'e', sha256: 'h', storedAt: 50 }
    // URL replaced meanwhile → not marked stored
    expect(markImageStored(db, ref(1), 'stale-url', info)).toBe(false)
    expect(markImageStored(db, ref(1), 'full1', info)).toBe(true)
    expect(getListing(db, 1)!.images[0]).toMatchObject({ syncStatus: 'stored', storedAt: 50 })
    for (let i = 0; i < 5; i++) markImageError(db, ref(2), 'full2', 'CDN Etsy відповів HTTP 404')
    expect(getImageRow(db, 2)).toMatchObject({ sync_status: 'error', sync_attempts: 5 })
    expect(listImagesToSync(db)).toEqual([]) // gave up after 5 tries…
    expect(listImagesToSync(db, { maxAttempts: null }).map((r) => r.listing_image_id)).toEqual([2]) // …unless forced
    expect(imageCounts(db, 20987654)).toEqual({ total: 2, stored: 1, pending: 0, error: 1 })
    expect(listShopObjectKeys(db, 20987654).sort()).toEqual(['k1', 'k1t'])

    upsertListing(db, mkInput(1, { images: [im(2, 1)] }), 60) // image 1 removed
    expect(listImagesToCleanup(db).map((r) => r.listing_image_id)).toEqual([1])
    markImageObjectsDeleted(db, ref(1), 'other', 'k1t') // not the keys it has → untouched
    expect(getImageRow(db, 1)).toMatchObject({ key_full: 'k1', sync_status: 'stored' })
    markImageObjectsDeleted(db, ref(1), 'k1', 'k1t')
    expect(listImagesToCleanup(db)).toEqual([])
    expect(getImageRow(db, 1)).toMatchObject({ key_full: null, key_570: null, sync_status: 'pending' })
  })

  it('markImageObjectsDeleted also resets an image a rescan revived meanwhile (it must be uploaded again)', () => {
    const db = memDb()
    seedShop(db)
    upsertListing(db, mkInput(1, { images: [im(1, 1), im(2, 2)] }), 10)
    const info = { keyFull: 'k1', key570: 'k1t', byteSize: 3, contentType: 'image/jpeg', etag: 'e', sha256: 'h', storedAt: 50 }
    markImageStored(db, ref(1), 'full1', info)
    upsertListing(db, mkInput(1, { images: [im(2, 2)] }), 20) // removed → cleanup picks it up
    const row = listImagesToCleanup(db)[0]
    upsertListing(db, mkInput(1, { images: [im(1, 1), im(2, 2)] }), 30) // back before the delete finished
    markImageObjectsDeleted(db, ref(1), row.key_full, row.key_570)
    expect(getImageRow(db, 1)).toMatchObject({ removed_at: null, key_full: null, key_570: null, sync_status: 'pending' })
    expect(listImagesToSync(db).map((r) => r.listing_image_id)).toContain(1)
  })

  it('resetStoredImages / markImageMissing queue stored copies again; listStoredImages lists them', () => {
    const db = memDb()
    seedShop(db)
    upsertListing(db, mkInput(1, { images: [im(1, 1), im(2, 2)] }), 10)
    const info = { keyFull: 'k', key570: null, byteSize: 3, contentType: 'image/jpeg', etag: 'e', sha256: 'h', storedAt: 50 }
    markImageStored(db, ref(1), 'full1', info)
    markImageStored(db, ref(2), 'full2', { ...info, keyFull: 'k2' })
    expect(listStoredImages(db, 20987654).map((r) => r.listing_image_id)).toEqual([1, 2])
    markImageMissing(db, ref(1))
    expect(getImageRow(db, 1)).toMatchObject({ sync_status: 'pending', key_full: null })
    expect(resetStoredImages(db)).toBe(1)
    expect(getImageRow(db, 2)).toMatchObject({ sync_status: 'pending', key_full: null, stored_at: null })
    expect(listStoredImages(db)).toEqual([])
  })

  it('one Etsy image id shared by two listings gets a row per listing (live Etsy reuses photos)', () => {
    const db = memDb()
    seedShop(db)
    upsertListing(db, mkInput(1, { images: [im(7, 1), im(1, 2)] }), 10)
    upsertListing(db, mkInput(2, { images: [im(7, 1), im(2, 2)] }), 10)
    // Saving listing 2 must not steal image 7 from listing 1.
    expect(getListing(db, 1)!.images.map((i) => i.id)).toEqual([7, 1])
    expect(getListing(db, 2)!.images.map((i) => i.id)).toEqual([7, 2])
    expect(imageCounts(db, 20987654)).toEqual({ total: 4, stored: 0, pending: 4, error: 0 })
    // Rescanning listing 1 with the same images keeps both rows as they were.
    upsertListing(db, mkInput(1, { images: [im(7, 1), im(1, 2)] }), 20)
    expect(getListing(db, 2)!.images.map((i) => i.id)).toEqual([7, 2])
    // State is per listing: storing / removing image 7 on listing 2 leaves listing 1's row alone.
    const info = { keyFull: 'k27', key570: null, byteSize: 3, contentType: 'image/jpeg', etag: 'e', sha256: 'h', storedAt: 50 }
    expect(markImageStored(db, ref(7, 2), 'full7', info)).toBe(true)
    expect(getImageRow(db, 7, 1)).toMatchObject({ listing_id: 1, sync_status: 'pending', key_full: null })
    expect(getImageRow(db, 7, 2)).toMatchObject({ listing_id: 2, sync_status: 'stored', key_full: 'k27' })
    // Without a listing (the etsyimg:// handler) the stored copy wins.
    expect(getImageRow(db, 7)).toMatchObject({ listing_id: 2, sync_status: 'stored' })
    upsertListing(db, mkInput(1, { images: [im(1, 1)] }), 30)
    expect(getImageRow(db, 7, 1)!.removed_at).toBe(30)
    expect(getImageRow(db, 7, 2)!.removed_at).toBeNull()
    markImageMissing(db, ref(7, 1)) // not stored on listing 1 → no effect on listing 2
    expect(getImageRow(db, 7, 2)!.sync_status).toBe('stored')
  })

  it('one Etsy video id shared by two listings stays on both', () => {
    const db = memDb()
    seedShop(db)
    const v = { id: 9, width: 1, height: 2, thumbnailUrl: null, videoUrl: null, state: 'active' }
    upsertListing(db, mkInput(1, { videos: [v] }), 10)
    upsertListing(db, mkInput(2, { videos: [v] }), 10)
    expect(getListing(db, 1)!.videos.map((x) => x.id)).toEqual([9])
    expect(getListing(db, 2)!.videos.map((x) => x.id)).toEqual([9])
    upsertListing(db, mkInput(2, { videos: [] }), 20)
    expect(getListing(db, 1)!.videos.map((x) => x.id)).toEqual([9])
    expect(getListing(db, 2)!.videos).toEqual([])
  })

  it('deleteShop removes images, videos and stats too', () => {
    const db = memDb()
    seedShop(db)
    upsertListing(db, mkInput(1, { images: [im(1, 1)], videos: [{ id: 9, width: 1, height: 1, thumbnailUrl: null, videoUrl: null, state: 'active' }] }), 10)
    const s = insertRunningScan(db, 20987654, 1)
    insertListingStats(db, s, [{ listingId: 1, views: 1, numFavorers: 1, featuredRank: null, quantity: 1 }])
    insertShopStats(db, s, 20987654, { numFavorers: 1, transactionSoldCount: 1, reviewCount: 1, reviewAverage: 5, listingActiveCount: 1 })
    deleteShop(db, 20987654)
    for (const t of ['listing_images', 'listing_videos', 'listing_stats', 'shop_stats']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 })
    }
  })
})

describe('v2 listing and shop columns', () => {
  it('views/personalization are kept when the details call did not answer; raw JSON is stored', () => {
    const db = memDb()
    seedShop(db)
    const q = [{ questionId: 1, text: 'Name', instructions: null, type: 't', required: true, maxChars: 10, maxFiles: null, options: [] }]
    upsertListing(db, mkInput(1, { views: 50, rawJson: '{"a":1}', details: { ...mkInput(1).details!, personalization: q } }), 10)
    upsertListing(db, mkInput(1, { views: null, detailsFetched: false, rawJson: null, numFavorers: 3, details: { ...mkInput(1).details!, personalization: null } }), 20)
    const l = getListing(db, 1)!
    expect(l.views).toBe(50)
    expect(l.numFavorers).toBe(3)
    expect(l.details!.personalization).toEqual(q)
    expect(getListingRaw(db, 1)).toBe('{"a":1}')
  })

  it('updateShopInfo writes the full profile and raw JSON', () => {
    const db = memDb()
    seedShop(db)
    const fresh = mapShop(shopFx as never, 0)
    updateShopInfo(db, fresh, 77)
    const s = getShopSummary(db, 20987654)!
    expect(s.profile).toEqual(fresh.profile)
    expect(JSON.parse(getShopRaw(db, 20987654)!)).toEqual(shopFx)
  })
})

describe('migration v3 (from a real v2 database)', () => {
  /** A database the v2 app wrote: a shop, listings with images, two ok scans with stats, changes. */
  function v2Db(): Db {
    const db = memDbAt(2)
    expect(schemaVersion(db)).toBe(2)
    insertShop(db, { ...mkShop(), profile: mapShop(shopFx as never, 1).profile })
    upsertListing(db, mkInput(1, { views: 10, numFavorers: 2, images: [{ ...img(501), urlFull: 'https://i.etsystatic.com/a.jpg' }] }), 100)
    upsertListing(db, mkInput(2, { views: 20, numFavorers: 4 }), 100)
    for (const at of [1000, 2000]) {
      const id = insertRunningScan(db, 20987654, at)
      insertListingStats(db, id, [{ listingId: 1, views: 10, numFavorers: 2, featuredRank: null, quantity: 1 }])
      insertShopStats(db, id, 20987654, { numFavorers: 5, transactionSoldCount: 9, reviewCount: 3, reviewAverage: 4.5, listingActiveCount: 2 })
      finishScanOk(db, id, at + 1, { isBaseline: at === 1000, truncated: false, total: 2, added: 0, removed: 0, changed: 1, returned: 0 })
      insertChange(db, id, 2, 'changed', { title: 'a' }, { title: 'b' })
    }
    markImageStored(db, { listing_id: 1, listing_image_id: 501 }, 'https://i.etsystatic.com/a.jpg', {
      keyFull: 'k501', key570: null, byteSize: 1, contentType: 'image/jpeg', etag: 'e', sha256: 'h', storedAt: 5
    })
    return db
  }

  it('adds the review tables, keeps every v2 row, and starts with "never synced"', () => {
    const db = v2Db()
    // Snapshot every v2 table with plain SQL (today's query functions already read v3 tables).
    const v2Tables = ['shops', 'listings', 'listing_images', 'listing_videos', 'listing_stats', 'shop_stats', 'scans', 'scan_changes']
    const dump = () => Object.fromEntries(v2Tables.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all()]))
    const before = dump()
    expect(before.listings).toHaveLength(2)
    expect(before.scans).toHaveLength(2)
    migrate(db)
    expect(dump()).toEqual(before)
    expect(schemaVersion(db)).toBe(3)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tables).toEqual(
      expect.arrayContaining(['reviews', 'review_sync', 'listing_review_stats', 'shop_review_stats'])
    )
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'reviews'")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(indexes).toEqual(expect.arrayContaining(['reviews_listing', 'reviews_shop_created']))
    const cols = db.prepare('PRAGMA table_info(reviews)').all().map((r) => (r as { name: string }).name)
    expect(cols).toEqual(
      expect.arrayContaining([
        'review_key', 'shop_id', 'listing_id', 'transaction_id', 'buyer_user_id', 'rating', 'review', 'language',
        'image_url_fullxfull', 'create_timestamp', 'created_timestamp', 'update_timestamp', 'updated_timestamp',
        'raw_json', 'first_seen_at', 'last_seen_at', 'first_seen_scan_id', 'origin', 'image_sync_status', 'image_key'
      ])
    )

    // v2 data reads back through today's functions.
    expect(listActiveListings(db, 20987654).map((l) => [l.listingId, l.views, l.numFavorers, l.images.length])).toEqual([
      [2, 20, 4, 0],
      [1, 10, 2, 1]
    ])
    expect(listListingStats(db, 1).map((p) => p.views)).toEqual([10, 10])
    expect(getImageRow(db, 501)).toMatchObject({ sync_status: 'stored', key_full: 'k501' })
    expect(getShopSummary(db, 20987654)).toMatchObject({ stats: { reviewCount: 3 }, reviews: null })
    // Never synced: no review numbers at all (not "0 reviews").
    expect(getListing(db, 1)).toMatchObject({ reviewCount: null, reviewAvg: null, reviewsNew: null, reviewsPartial: false })
    expect(listListingStats(db, 1)[0]).toMatchObject({ reviewCount: null, reviewsComplete: null })
    expect(listShopObjectKeys(db, 20987654)).toEqual(['k501'])
  })

  it('the migrated database takes reviews, and a shop delete cascades to them', () => {
    const db = v2Db()
    migrate(db)
    const scanId = listScans(db, 20987654)[0].id
    saveReviewSync(db, { ...emptyReviewSync(20987654), backfill_upper: 10, backfill_complete: 1 })
    upsertReviews(db, 20987654, [mapReview({ ...(reviewFx as never), shop_id: 20987654, listing_id: 1 })], {
      now: 7,
      scanId,
      isNew: () => true
    })
    writeReviewStats(db, 20987654, scanId, 8)
    expect(getListing(db, 1)).toMatchObject({ reviewCount: 1, reviewAvg: 5, reviewsNew: 1 })
    expect(listListingStats(db, 1).at(-1)).toMatchObject({ reviewCount: 1, reviewAvg: 5, reviewsComplete: true })
    deleteShop(db, 20987654)
    for (const t of ['reviews', 'review_sync', 'listing_review_stats', 'shop_review_stats']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 })
    }
  })
})
