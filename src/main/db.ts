// SQLite persistence on Node's built-in `node:sqlite` (DatabaseSync) — no native
// modules to rebuild for Electron. Every function takes the db handle, so tests
// run against a real in-memory database with no Electron at all.

import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type {
  ChangeKind,
  Listing,
  ListingImage,
  ScanChange,
  ScanStatus,
  ScanSummary,
  Shop,
  ShopSummary,
  TrackedFields
} from '../shared/types'

export type Db = DatabaseSync

type SqliteModule = typeof import('node:sqlite')

let sqlite: SqliteModule | null = null

/**
 * Load `node:sqlite` lazily, swallowing the one-time "SQLite is an experimental
 * feature" ExperimentalWarning it prints on first load (Node 22 / Electron 38).
 * Lazy on purpose: a top-level import would be hoisted above any filter.
 */
function loadSqlite(): SqliteModule {
  if (sqlite) return sqlite
  const original = process.emitWarning
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const msg = typeof warning === 'string' ? warning : warning?.message
    if (typeof msg === 'string' && msg.includes('SQLite is an experimental feature')) return
    return (original as (...a: unknown[]) => void).call(process, warning, ...rest)
  }) as typeof process.emitWarning
  try {
    sqlite = process.getBuiltinModule('node:sqlite') as SqliteModule
  } finally {
    process.emitWarning = original
  }
  return sqlite
}

/**
 * Schema migrations, applied in order. `PRAGMA user_version` holds how many have
 * run. Append only — never edit a shipped entry.
 */
export const MIGRATIONS: string[] = [
  // 1 — initial schema
  `
  CREATE TABLE shops (
    id INTEGER PRIMARY KEY,               -- Etsy shop_id
    shop_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    title TEXT,
    url TEXT NOT NULL,
    icon_url TEXT,
    currency TEXT,
    etsy_active_count INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL
  );
  CREATE TABLE listings (
    listing_id INTEGER PRIMARY KEY,        -- Etsy listing_id
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    price_amount INTEGER NOT NULL,
    price_divisor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    url TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',       -- JSON string[]
    quantity INTEGER NOT NULL DEFAULT 0,
    etsy_created_at INTEGER,               -- epoch seconds
    etsy_updated_at INTEGER,               -- epoch seconds
    images TEXT NOT NULL DEFAULT '[]',     -- JSON ListingImage[], ordered by rank
    first_seen_at INTEGER NOT NULL,        -- epoch ms
    last_seen_at INTEGER NOT NULL,         -- epoch ms
    removed_at INTEGER                     -- epoch ms; NULL = active
  );
  CREATE INDEX listings_shop ON listings(shop_id, removed_at);
  CREATE TABLE scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
    error TEXT,
    is_baseline INTEGER NOT NULL DEFAULT 0,
    truncated INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    added INTEGER NOT NULL DEFAULT 0,
    removed INTEGER NOT NULL DEFAULT 0,
    changed INTEGER NOT NULL DEFAULT 0,
    returned INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX scans_shop ON scans(shop_id, id);
  CREATE TABLE scan_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    listing_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('added', 'removed', 'changed', 'returned')),
    old_value TEXT,                        -- JSON TrackedFields
    new_value TEXT                         -- JSON TrackedFields
  );
  CREATE INDEX scan_changes_scan ON scan_changes(scan_id);
  `
]

export function schemaVersion(db: Db): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return row.user_version
}

/** Apply every pending migration, each in its own transaction. */
export function migrate(db: Db, migrations: readonly string[] = MIGRATIONS): void {
  const current = schemaVersion(db)
  if (current > migrations.length) {
    throw new Error(
      `База даних створена новішою версією програми (схема ${current}, ця версія знає ${migrations.length}).`
    )
  }
  for (let v = current; v < migrations.length; v++) {
    transaction(db, () => {
      db.exec(migrations[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}

/** Open (creating if needed) the database at `path` (or ':memory:') and migrate it. */
export function openDb(path: string): Db {
  const { DatabaseSync } = loadSqlite()
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 3000')
  migrate(db)
  return db
}

/** Run `fn` in a transaction: commit on return, roll back on throw. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

// ---------------------------------------------------------------- row mapping

interface ShopRow {
  id: number
  shop_name: string
  title: string | null
  url: string
  icon_url: string | null
  currency: string | null
  etsy_active_count: number
  added_at: number
}

interface ListingRow {
  listing_id: number
  shop_id: number
  title: string
  description: string
  price_amount: number
  price_divisor: number
  currency: string
  url: string
  tags: string
  quantity: number
  etsy_created_at: number | null
  etsy_updated_at: number | null
  images: string
  first_seen_at: number
  last_seen_at: number
  removed_at: number | null
}

interface ScanRow {
  id: number
  shop_id: number
  started_at: number
  finished_at: number | null
  status: ScanStatus
  error: string | null
  is_baseline: number
  truncated: number
  total: number
  added: number
  removed: number
  changed: number
  returned: number
}

interface ChangeRow {
  id: number
  scan_id: number
  listing_id: number
  kind: ChangeKind
  old_value: string | null
  new_value: string | null
}

function parseJson<T>(text: string | null, fallback: T): T {
  if (text == null) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function toShop(r: ShopRow): Shop {
  return {
    id: r.id,
    shopName: r.shop_name,
    title: r.title,
    url: r.url,
    iconUrl: r.icon_url,
    currency: r.currency,
    etsyActiveCount: r.etsy_active_count,
    addedAt: r.added_at
  }
}

function toListing(r: ListingRow): Listing {
  return {
    listingId: r.listing_id,
    shopId: r.shop_id,
    title: r.title,
    description: r.description,
    priceAmount: r.price_amount,
    priceDivisor: r.price_divisor,
    currency: r.currency,
    url: r.url,
    tags: parseJson<string[]>(r.tags, []),
    quantity: r.quantity,
    etsyCreatedAt: r.etsy_created_at,
    etsyUpdatedAt: r.etsy_updated_at,
    images: parseJson<ListingImage[]>(r.images, []),
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    removedAt: r.removed_at
  }
}

function toScan(r: ScanRow): ScanSummary {
  return {
    id: r.id,
    shopId: r.shop_id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    error: r.error,
    isBaseline: !!r.is_baseline,
    truncated: !!r.truncated,
    total: r.total,
    added: r.added,
    removed: r.removed,
    changed: r.changed,
    returned: r.returned
  }
}

// ---------------------------------------------------------------------- shops

export function insertShop(db: Db, shop: Shop): void {
  db.prepare(
    `INSERT INTO shops (id, shop_name, title, url, icon_url, currency, etsy_active_count, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    shop.id,
    shop.shopName,
    shop.title,
    shop.url,
    shop.iconUrl,
    shop.currency,
    shop.etsyActiveCount,
    shop.addedAt
  )
}

/** Refresh the Etsy-side shop fields (title, icon, count…) keeping added_at. */
export function updateShopInfo(db: Db, shop: Omit<Shop, 'addedAt'>): void {
  db.prepare(
    `UPDATE shops SET shop_name = ?, title = ?, url = ?, icon_url = ?, currency = ?, etsy_active_count = ?
     WHERE id = ?`
  ).run(
    shop.shopName,
    shop.title,
    shop.url,
    shop.iconUrl,
    shop.currency,
    shop.etsyActiveCount,
    shop.id
  )
}

export function getShop(db: Db, id: number): Shop | null {
  const r = db.prepare('SELECT * FROM shops WHERE id = ?').get(id) as ShopRow | undefined
  return r ? toShop(r) : null
}

export function findShopByName(db: Db, shopName: string): Shop | null {
  const r = db.prepare('SELECT * FROM shops WHERE shop_name = ?').get(shopName) as
    | ShopRow
    | undefined
  return r ? toShop(r) : null
}

/** Delete a shop; its listings, scans and scan changes go with it (FK cascade). */
export function deleteShop(db: Db, id: number): void {
  transaction(db, () => {
    db.prepare(
      'DELETE FROM scan_changes WHERE scan_id IN (SELECT id FROM scans WHERE shop_id = ?)'
    ).run(id)
    db.prepare('DELETE FROM scans WHERE shop_id = ?').run(id)
    db.prepare('DELETE FROM listings WHERE shop_id = ?').run(id)
    db.prepare('DELETE FROM shops WHERE id = ?').run(id)
  })
}

export function listShopSummaries(db: Db): ShopSummary[] {
  const rows = db.prepare('SELECT * FROM shops ORDER BY added_at, id').all() as unknown as ShopRow[]
  return rows.map((r) => shopSummary(db, toShop(r)))
}

export function getShopSummary(db: Db, id: number): ShopSummary | null {
  const shop = getShop(db, id)
  return shop ? shopSummary(db, shop) : null
}

function shopSummary(db: Db, shop: Shop): ShopSummary {
  const active = db
    .prepare('SELECT COUNT(*) AS n FROM listings WHERE shop_id = ? AND removed_at IS NULL')
    .get(shop.id) as { n: number }
  const lastOk = db
    .prepare("SELECT * FROM scans WHERE shop_id = ? AND status = 'ok' ORDER BY id DESC LIMIT 1")
    .get(shop.id) as ScanRow | undefined
  const last = db
    .prepare("SELECT * FROM scans WHERE shop_id = ? AND status != 'running' ORDER BY id DESC LIMIT 1")
    .get(shop.id) as ScanRow | undefined
  const lastOkScan = lastOk ? toScan(lastOk) : null
  return {
    ...shop,
    activeCount: active.n,
    lastOkScan,
    lastScan: last ? toScan(last) : null,
    newCount: lastOkScan && !lastOkScan.isBaseline ? lastOkScan.added : 0
  }
}

// ------------------------------------------------------------------- listings

/** A listing as produced by a scan (our bookkeeping columns are set on write). */
export type ListingInput = Omit<Listing, 'firstSeenAt' | 'lastSeenAt' | 'removedAt' | 'images'> & {
  /** null = images were not fetched this scan; keep what is stored. */
  images: ListingImage[] | null
}

export function listActiveListings(db: Db, shopId: number): Listing[] {
  const rows = db
    .prepare(
      `SELECT * FROM listings WHERE shop_id = ? AND removed_at IS NULL
       ORDER BY etsy_created_at DESC, listing_id DESC`
    )
    .all(shopId) as unknown as ListingRow[]
  return rows.map(toListing)
}

export function getListing(db: Db, listingId: number): Listing | null {
  const r = db.prepare('SELECT * FROM listings WHERE listing_id = ?').get(listingId) as
    | ListingRow
    | undefined
  return r ? toListing(r) : null
}

/** Every stored listing of a shop (active and removed) — the previous snapshot for a diff. */
export function listAllListings(db: Db, shopId: number): Listing[] {
  const rows = db
    .prepare('SELECT * FROM listings WHERE shop_id = ?')
    .all(shopId) as unknown as ListingRow[]
  return rows.map(toListing)
}

/**
 * Insert or refresh a listing as seen active at `now`. Clears removed_at. Images
 * passed as null keep the stored ones. Not wrapped in a transaction — callers
 * batch these inside `applyScan`'s.
 */
export function upsertListing(db: Db, l: ListingInput, now: number): void {
  const params: SQLInputValue[] = [
    l.listingId,
    l.shopId,
    l.title,
    l.description,
    l.priceAmount,
    l.priceDivisor,
    l.currency,
    l.url,
    JSON.stringify(l.tags),
    l.quantity,
    l.etsyCreatedAt,
    l.etsyUpdatedAt,
    l.images ? JSON.stringify(l.images) : null,
    now,
    now
  ]
  db.prepare(
    `INSERT INTO listings (listing_id, shop_id, title, description, price_amount, price_divisor,
       currency, url, tags, quantity, etsy_created_at, etsy_updated_at, images,
       first_seen_at, last_seen_at, removed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, '[]'), ?, ?, NULL)
     ON CONFLICT(listing_id) DO UPDATE SET
       shop_id = excluded.shop_id,
       title = excluded.title,
       description = excluded.description,
       price_amount = excluded.price_amount,
       price_divisor = excluded.price_divisor,
       currency = excluded.currency,
       url = excluded.url,
       tags = excluded.tags,
       quantity = excluded.quantity,
       etsy_created_at = excluded.etsy_created_at,
       etsy_updated_at = excluded.etsy_updated_at,
       images = CASE WHEN ? IS NULL THEN listings.images ELSE excluded.images END,
       last_seen_at = excluded.last_seen_at,
       removed_at = NULL`
  ).run(...params, l.images ? 'set' : null)
}

export function markListingRemoved(db: Db, listingId: number, now: number): void {
  db.prepare('UPDATE listings SET removed_at = ? WHERE listing_id = ? AND removed_at IS NULL').run(
    now,
    listingId
  )
}

// ---------------------------------------------------------------------- scans

export function insertRunningScan(db: Db, shopId: number, startedAt: number): number {
  const r = db
    .prepare("INSERT INTO scans (shop_id, started_at, status) VALUES (?, ?, 'running')")
    .run(shopId, startedAt)
  return Number(r.lastInsertRowid)
}

export interface ScanTotals {
  isBaseline: boolean
  truncated: boolean
  total: number
  added: number
  removed: number
  changed: number
  returned: number
}

export function finishScanOk(db: Db, scanId: number, finishedAt: number, t: ScanTotals): void {
  db.prepare(
    `UPDATE scans SET status = 'ok', finished_at = ?, error = NULL, is_baseline = ?, truncated = ?,
       total = ?, added = ?, removed = ?, changed = ?, returned = ?
     WHERE id = ?`
  ).run(
    finishedAt,
    t.isBaseline ? 1 : 0,
    t.truncated ? 1 : 0,
    t.total,
    t.added,
    t.removed,
    t.changed,
    t.returned,
    scanId
  )
}

export function finishScanError(db: Db, scanId: number, finishedAt: number, error: string): void {
  db.prepare("UPDATE scans SET status = 'error', finished_at = ?, error = ? WHERE id = ?").run(
    finishedAt,
    error,
    scanId
  )
}

/**
 * A scan left 'running' by a crash/quit mid-scan can never finish — mark those
 * as errors on startup so they don't look in-flight forever.
 */
export function failStaleRunningScans(db: Db, now: number): number {
  const r = db
    .prepare(
      "UPDATE scans SET status = 'error', finished_at = ?, error = 'Сканування перервано (програму закрито)' WHERE status = 'running'"
    )
    .run(now)
  return Number(r.changes)
}

export function hasOkScan(db: Db, shopId: number): boolean {
  return !!db.prepare("SELECT 1 FROM scans WHERE shop_id = ? AND status = 'ok' LIMIT 1").get(shopId)
}

export function getScan(db: Db, scanId: number): ScanSummary | null {
  const r = db.prepare('SELECT * FROM scans WHERE id = ?').get(scanId) as ScanRow | undefined
  return r ? toScan(r) : null
}

export function listScans(db: Db, shopId: number, limit = 100): ScanSummary[] {
  const rows = db
    .prepare('SELECT * FROM scans WHERE shop_id = ? ORDER BY id DESC LIMIT ?')
    .all(shopId, limit) as unknown as ScanRow[]
  return rows.map(toScan)
}

export function insertChange(
  db: Db,
  scanId: number,
  listingId: number,
  kind: ChangeKind,
  oldValue: TrackedFields | null,
  newValue: TrackedFields | null
): void {
  db.prepare(
    'INSERT INTO scan_changes (scan_id, listing_id, kind, old_value, new_value) VALUES (?, ?, ?, ?, ?)'
  ).run(
    scanId,
    listingId,
    kind,
    oldValue ? JSON.stringify(oldValue) : null,
    newValue ? JSON.stringify(newValue) : null
  )
}

export function listScanChanges(db: Db, scanId: number): ScanChange[] {
  const rows = db
    .prepare('SELECT * FROM scan_changes WHERE scan_id = ? ORDER BY id')
    .all(scanId) as unknown as ChangeRow[]
  return rows.map((r) => ({
    id: r.id,
    scanId: r.scan_id,
    listingId: r.listing_id,
    kind: r.kind,
    oldValue: parseJson<TrackedFields | null>(r.old_value, null),
    newValue: parseJson<TrackedFields | null>(r.new_value, null),
    listing: getListing(db, r.listing_id)
  }))
}
