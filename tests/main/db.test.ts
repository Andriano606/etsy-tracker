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
  insertShop
} from '../../src/main/db'
import { memDb, mkInput, mkShop, seedShop } from '../helpers/db'

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
    const fresh = memDb()
    fresh.exec('PRAGMA user_version = 0')
    fresh.exec('DROP TABLE scan_changes; DROP TABLE scans; DROP TABLE listings; DROP TABLE shops')
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
    expect(l.images).toEqual([img(5)])
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
    expect(l.images).toEqual([img(5)])
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
