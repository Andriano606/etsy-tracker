// SQLite persistence on Node's built-in `node:sqlite` (DatabaseSync) — no native
// modules to rebuild for Electron. Every function takes the db handle, so tests
// run against a real in-memory database with no Electron at all.

import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type {
  ChangeKind,
  ImageCounts,
  ImageSyncStatus,
  Listing,
  ListingDetails,
  ListingImage,
  ListingVideo,
  ListingStatsPoint,
  PersonalizationQuestion,
  Review,
  ReviewOrigin,
  ReviewPage,
  ReviewSyncInfo,
  ScanChange,
  ScanStatus,
  ScanSummary,
  Shop,
  ShopProfile,
  ShopStats,
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
  `,
  // v2: everything the API returns — full listing/shop columns + raw JSON,
  // normalized images (with MinIO sync state) and videos, per-scan popularity.
  `
  ALTER TABLE shops ADD COLUMN user_id INTEGER;
  ALTER TABLE shops ADD COLUMN login_name TEXT;
  ALTER TABLE shops ADD COLUMN announcement TEXT;
  ALTER TABLE shops ADD COLUMN sale_message TEXT;
  ALTER TABLE shops ADD COLUMN digital_sale_message TEXT;
  ALTER TABLE shops ADD COLUMN is_vacation INTEGER;
  ALTER TABLE shops ADD COLUMN vacation_message TEXT;
  ALTER TABLE shops ADD COLUMN vacation_autoreply TEXT;
  ALTER TABLE shops ADD COLUMN num_favorers INTEGER;
  ALTER TABLE shops ADD COLUMN transaction_sold_count INTEGER;
  ALTER TABLE shops ADD COLUMN review_count INTEGER;
  ALTER TABLE shops ADD COLUMN review_average REAL;
  ALTER TABLE shops ADD COLUMN digital_listing_count INTEGER;
  ALTER TABLE shops ADD COLUMN accepts_custom_requests INTEGER;
  ALTER TABLE shops ADD COLUMN languages TEXT;                 -- JSON string[]
  ALTER TABLE shops ADD COLUMN shop_location_country_iso TEXT;
  ALTER TABLE shops ADD COLUMN shipping_from_country_iso TEXT;
  ALTER TABLE shops ADD COLUMN banner_url TEXT;                -- image_url_760x100
  ALTER TABLE shops ADD COLUMN policy_welcome TEXT;
  ALTER TABLE shops ADD COLUMN policy_payment TEXT;
  ALTER TABLE shops ADD COLUMN policy_shipping TEXT;
  ALTER TABLE shops ADD COLUMN policy_refunds TEXT;
  ALTER TABLE shops ADD COLUMN policy_additional TEXT;
  ALTER TABLE shops ADD COLUMN policy_seller_info TEXT;
  ALTER TABLE shops ADD COLUMN policy_privacy TEXT;
  ALTER TABLE shops ADD COLUMN policy_updated_at INTEGER;      -- epoch seconds
  ALTER TABLE shops ADD COLUMN etsy_created_at INTEGER;        -- epoch seconds
  ALTER TABLE shops ADD COLUMN etsy_updated_at INTEGER;        -- epoch seconds
  ALTER TABLE shops ADD COLUMN raw_json TEXT;                  -- full GET /shops/{id}
  ALTER TABLE shops ADD COLUMN info_fetched_at INTEGER;        -- epoch ms

  ALTER TABLE listings ADD COLUMN user_id INTEGER;
  ALTER TABLE listings ADD COLUMN state TEXT;
  ALTER TABLE listings ADD COLUMN views INTEGER;
  ALTER TABLE listings ADD COLUMN num_favorers INTEGER;
  ALTER TABLE listings ADD COLUMN featured_rank INTEGER;
  ALTER TABLE listings ADD COLUMN shop_section_id INTEGER;
  ALTER TABLE listings ADD COLUMN taxonomy_id INTEGER;
  ALTER TABLE listings ADD COLUMN listing_type TEXT;
  ALTER TABLE listings ADD COLUMN who_made TEXT;
  ALTER TABLE listings ADD COLUMN when_made TEXT;
  ALTER TABLE listings ADD COLUMN is_supply INTEGER;
  ALTER TABLE listings ADD COLUMN materials TEXT;              -- JSON string[]
  ALTER TABLE listings ADD COLUMN style TEXT;                  -- JSON string[]
  ALTER TABLE listings ADD COLUMN skus TEXT;                   -- JSON string[]
  ALTER TABLE listings ADD COLUMN processing_min INTEGER;
  ALTER TABLE listings ADD COLUMN processing_max INTEGER;
  ALTER TABLE listings ADD COLUMN is_customizable INTEGER;
  ALTER TABLE listings ADD COLUMN is_personalizable INTEGER;
  ALTER TABLE listings ADD COLUMN personalization TEXT;        -- JSON PersonalizationQuestion[]
  ALTER TABLE listings ADD COLUMN has_variations INTEGER;
  ALTER TABLE listings ADD COLUMN is_private INTEGER;
  ALTER TABLE listings ADD COLUMN is_taxable INTEGER;
  ALTER TABLE listings ADD COLUMN non_taxable INTEGER;
  ALTER TABLE listings ADD COLUMN should_auto_renew INTEGER;
  ALTER TABLE listings ADD COLUMN file_data TEXT;
  ALTER TABLE listings ADD COLUMN language TEXT;
  ALTER TABLE listings ADD COLUMN shipping_profile_id INTEGER;
  ALTER TABLE listings ADD COLUMN return_policy_id INTEGER;
  ALTER TABLE listings ADD COLUMN readiness_state_id INTEGER;
  ALTER TABLE listings ADD COLUMN item_weight REAL;
  ALTER TABLE listings ADD COLUMN item_weight_unit TEXT;
  ALTER TABLE listings ADD COLUMN item_length REAL;
  ALTER TABLE listings ADD COLUMN item_width REAL;
  ALTER TABLE listings ADD COLUMN item_height REAL;
  ALTER TABLE listings ADD COLUMN item_dimensions_unit TEXT;
  ALTER TABLE listings ADD COLUMN original_created_at INTEGER; -- epoch seconds
  ALTER TABLE listings ADD COLUMN ending_at INTEGER;           -- epoch seconds
  ALTER TABLE listings ADD COLUMN state_at INTEGER;            -- epoch seconds
  ALTER TABLE listings ADD COLUMN raw_json TEXT;               -- the latest full API object
  ALTER TABLE listings ADD COLUMN details_fetched_at INTEGER;  -- epoch ms; NULL = never fetched with v2
  UPDATE listings SET state = 'active' WHERE removed_at IS NULL;

  -- One row per (listing, image): Etsy reuses one listing_image_id on several
  -- listings of a shop (verified live), so the image id alone is not a key.
  CREATE TABLE listing_images (
    listing_image_id INTEGER NOT NULL,     -- Etsy listing_image_id
    listing_id INTEGER NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL,
    rank INTEGER NOT NULL DEFAULT 0,
    url_75x75 TEXT NOT NULL DEFAULT '',
    url_170x135 TEXT NOT NULL DEFAULT '',
    url_570xN TEXT NOT NULL DEFAULT '',
    url_fullxfull TEXT NOT NULL DEFAULT '',
    full_width INTEGER,
    full_height INTEGER,
    hex_code TEXT,
    red INTEGER,
    green INTEGER,
    blue INTEGER,
    hue INTEGER,
    saturation INTEGER,
    brightness INTEGER,
    is_black_and_white INTEGER,
    alt_text TEXT,
    created_timestamp INTEGER,             -- Etsy epoch seconds
    first_seen_at INTEGER NOT NULL,        -- epoch ms
    removed_at INTEGER,                    -- epoch ms; NULL = still on the listing
    sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'stored', 'error')),
    sync_error TEXT,
    sync_attempts INTEGER NOT NULL DEFAULT 0,
    stored_at INTEGER,                     -- epoch ms
    key_full TEXT,                         -- MinIO object keys; NULL = no object
    key_570 TEXT,
    byte_size INTEGER,                     -- of the fullxfull object
    content_type TEXT,
    etag TEXT,
    sha256 TEXT,
    PRIMARY KEY (listing_id, listing_image_id)
  );
  CREATE INDEX listing_images_image ON listing_images(listing_image_id);
  CREATE INDEX listing_images_listing ON listing_images(listing_id, removed_at, rank);
  CREATE INDEX listing_images_shop_sync ON listing_images(shop_id, removed_at, sync_status);
  INSERT OR IGNORE INTO listing_images (listing_image_id, listing_id, shop_id, rank, url_75x75,
      url_170x135, url_570xN, url_fullxfull, full_width, full_height, alt_text, first_seen_at)
    SELECT json_extract(j.value, '$.id'), l.listing_id, l.shop_id,
      COALESCE(json_extract(j.value, '$.rank'), 0),
      COALESCE(json_extract(j.value, '$.url75'), ''), COALESCE(json_extract(j.value, '$.url170'), ''),
      COALESCE(json_extract(j.value, '$.url570'), ''), COALESCE(json_extract(j.value, '$.urlFull'), ''),
      json_extract(j.value, '$.width'), json_extract(j.value, '$.height'),
      json_extract(j.value, '$.alt'), l.first_seen_at
    FROM listings l, json_each(l.images) j
    WHERE json_valid(l.images) AND json_extract(j.value, '$.id') IS NOT NULL;
  ALTER TABLE listings DROP COLUMN images;

  CREATE TABLE listing_videos (
    video_id INTEGER NOT NULL,             -- shared across listings like images
    listing_id INTEGER NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
    width INTEGER,
    height INTEGER,
    thumbnail_url TEXT,
    video_url TEXT,
    video_state TEXT,
    first_seen_at INTEGER NOT NULL,
    removed_at INTEGER,
    PRIMARY KEY (listing_id, video_id)
  );
  CREATE INDEX listing_videos_listing ON listing_videos(listing_id, removed_at);

  CREATE TABLE listing_stats (
    scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    listing_id INTEGER NOT NULL,
    views INTEGER,
    num_favorers INTEGER,
    featured_rank INTEGER,
    quantity INTEGER,
    PRIMARY KEY (scan_id, listing_id)
  ) WITHOUT ROWID;
  CREATE INDEX listing_stats_listing ON listing_stats(listing_id, scan_id);

  CREATE TABLE shop_stats (
    scan_id INTEGER PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL,
    num_favorers INTEGER,
    transaction_sold_count INTEGER,
    review_count INTEGER,
    review_average REAL,
    listing_active_count INTEGER
  );
  CREATE INDEX shop_stats_shop ON shop_stats(shop_id, scan_id);
  `,
  // v3: the shops' reviews (GET /shops/{id}/reviews) with their photos' MinIO
  // state, the per-shop sync cursor, and per-scan review counts.
  `
  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- our id (etsyimg://review/{id}/fullxfull)
    review_key TEXT NOT NULL UNIQUE,       -- t-{transaction_id}, else x-{listing}-{buyer|0}-{created}
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    listing_id INTEGER,                    -- no FK: reviews of listings we never stored
    transaction_id INTEGER,
    buyer_user_id INTEGER,
    rating INTEGER,
    review TEXT,                           -- entities decoded
    language TEXT,
    image_url_fullxfull TEXT,              -- NULL = none / not returned / not an Etsy CDN URL
    create_timestamp INTEGER,              -- Etsy epoch seconds (the OAS has both spellings)
    created_timestamp INTEGER,
    update_timestamp INTEGER,
    updated_timestamp INTEGER,
    raw_json TEXT NOT NULL,                -- the latest API object
    first_seen_at INTEGER NOT NULL,        -- epoch ms
    last_seen_at INTEGER NOT NULL,         -- epoch ms
    changed_at INTEGER,                    -- epoch ms: last time a rescan saw an edit
    first_seen_scan_id INTEGER REFERENCES scans(id) ON DELETE SET NULL,
    origin TEXT NOT NULL CHECK (origin IN ('backfill', 'new')),
    image_sync_status TEXT CHECK (image_sync_status IN ('pending', 'stored', 'error')), -- NULL = no photo
    image_sync_error TEXT,
    image_sync_attempts INTEGER NOT NULL DEFAULT 0,
    image_stored_at INTEGER,
    image_key TEXT,                        -- MinIO object key; NULL = no object
    image_byte_size INTEGER,
    image_content_type TEXT,
    image_etag TEXT,
    image_sha256 TEXT
  );
  CREATE INDEX reviews_listing ON reviews(listing_id);
  CREATE INDEX reviews_shop_created ON reviews(shop_id, created_timestamp);
  CREATE INDEX reviews_scan ON reviews(first_seen_scan_id, origin);
  CREATE INDEX reviews_image_sync ON reviews(shop_id, image_sync_status);

  -- One row per shop: where the backfill / incremental sync stands.
  CREATE TABLE review_sync (
    shop_id INTEGER PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
    backfill_complete INTEGER NOT NULL DEFAULT 0,
    backfill_upper INTEGER,                -- s: the backfill covers created <= this (fixed at its start)
    total_estimate INTEGER,                -- Etsy count of created <= backfill_upper at the start
    win_hi INTEGER,                        -- s: current backfill window [win_lo, win_hi]
    win_lo INTEGER,                        -- NULL = open down to the oldest review
    win_offset INTEGER NOT NULL DEFAULT 0,
    win_count INTEGER,                     -- Etsy count of the current window
    win_span INTEGER,                      -- s: width used when a window must be narrowed
    synced_through INTEGER,                -- s: incremental passes covered created <= this
    inc_lo INTEGER,                        -- s: an incremental pass in progress [inc_lo, inc_hi]
    inc_hi INTEGER,
    inc_target INTEGER,                    -- s: where that pass ends
    inc_offset INTEGER NOT NULL DEFAULT 0,
    inc_count INTEGER,
    oldest_created INTEGER,                -- s: oldest/newest created_timestamp stored
    newest_created INTEGER,
    requests_total INTEGER NOT NULL DEFAULT 0,
    last_run_requests INTEGER NOT NULL DEFAULT 0,
    last_synced_at INTEGER,                -- ms: last run that finished (ok or not)
    last_error TEXT
  );

  CREATE TABLE listing_review_stats (
    scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    listing_id INTEGER NOT NULL,
    review_count INTEGER NOT NULL,
    review_avg REAL,
    new_count INTEGER NOT NULL DEFAULT 0,
    complete INTEGER NOT NULL,             -- 0 = the shop's backfill was incomplete (count is a lower bound)
    PRIMARY KEY (scan_id, listing_id)
  ) WITHOUT ROWID;
  CREATE INDEX listing_review_stats_listing ON listing_review_stats(listing_id, scan_id);

  CREATE TABLE shop_review_stats (
    scan_id INTEGER PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL,
    review_count INTEGER NOT NULL,
    review_avg REAL,
    new_count INTEGER NOT NULL DEFAULT 0,
    complete INTEGER NOT NULL,
    synced_at INTEGER NOT NULL             -- ms
  );
  CREATE INDEX shop_review_stats_shop ON shop_review_stats(shop_id, scan_id);
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

type Nullable<T> = T | null

interface ShopRow {
  id: number
  shop_name: string
  title: string | null
  url: string
  icon_url: string | null
  currency: string | null
  etsy_active_count: number
  added_at: number
  user_id: Nullable<number>
  login_name: Nullable<string>
  announcement: Nullable<string>
  sale_message: Nullable<string>
  digital_sale_message: Nullable<string>
  is_vacation: Nullable<number>
  vacation_message: Nullable<string>
  vacation_autoreply: Nullable<string>
  num_favorers: Nullable<number>
  transaction_sold_count: Nullable<number>
  review_count: Nullable<number>
  review_average: Nullable<number>
  digital_listing_count: Nullable<number>
  accepts_custom_requests: Nullable<number>
  languages: Nullable<string>
  shop_location_country_iso: Nullable<string>
  shipping_from_country_iso: Nullable<string>
  banner_url: Nullable<string>
  policy_welcome: Nullable<string>
  policy_payment: Nullable<string>
  policy_shipping: Nullable<string>
  policy_refunds: Nullable<string>
  policy_additional: Nullable<string>
  policy_seller_info: Nullable<string>
  policy_privacy: Nullable<string>
  policy_updated_at: Nullable<number>
  etsy_created_at: Nullable<number>
  etsy_updated_at: Nullable<number>
  raw_json: Nullable<string>
  info_fetched_at: Nullable<number>
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
  first_seen_at: number
  last_seen_at: number
  removed_at: number | null
  user_id: Nullable<number>
  state: Nullable<string>
  views: Nullable<number>
  num_favorers: Nullable<number>
  featured_rank: Nullable<number>
  shop_section_id: Nullable<number>
  taxonomy_id: Nullable<number>
  listing_type: Nullable<string>
  who_made: Nullable<string>
  when_made: Nullable<string>
  is_supply: Nullable<number>
  materials: Nullable<string>
  style: Nullable<string>
  skus: Nullable<string>
  processing_min: Nullable<number>
  processing_max: Nullable<number>
  is_customizable: Nullable<number>
  is_personalizable: Nullable<number>
  personalization: Nullable<string>
  has_variations: Nullable<number>
  is_private: Nullable<number>
  is_taxable: Nullable<number>
  non_taxable: Nullable<number>
  should_auto_renew: Nullable<number>
  file_data: Nullable<string>
  language: Nullable<string>
  shipping_profile_id: Nullable<number>
  return_policy_id: Nullable<number>
  readiness_state_id: Nullable<number>
  item_weight: Nullable<number>
  item_weight_unit: Nullable<string>
  item_length: Nullable<number>
  item_width: Nullable<number>
  item_height: Nullable<number>
  item_dimensions_unit: Nullable<string>
  original_created_at: Nullable<number>
  ending_at: Nullable<number>
  state_at: Nullable<number>
  raw_json: Nullable<string>
  details_fetched_at: Nullable<number>
}

export interface ImageRow {
  listing_image_id: number
  listing_id: number
  shop_id: number
  rank: number
  url_75x75: string
  url_170x135: string
  url_570xN: string
  url_fullxfull: string
  full_width: Nullable<number>
  full_height: Nullable<number>
  hex_code: Nullable<string>
  red: Nullable<number>
  green: Nullable<number>
  blue: Nullable<number>
  hue: Nullable<number>
  saturation: Nullable<number>
  brightness: Nullable<number>
  is_black_and_white: Nullable<number>
  alt_text: Nullable<string>
  created_timestamp: Nullable<number>
  first_seen_at: number
  removed_at: Nullable<number>
  sync_status: ImageSyncStatus
  sync_error: Nullable<string>
  sync_attempts: number
  stored_at: Nullable<number>
  key_full: Nullable<string>
  key_570: Nullable<string>
  byte_size: Nullable<number>
  content_type: Nullable<string>
  etag: Nullable<string>
  sha256: Nullable<string>
}

interface VideoRow {
  video_id: number
  listing_id: number
  width: Nullable<number>
  height: Nullable<number>
  thumbnail_url: Nullable<string>
  video_url: Nullable<string>
  video_state: Nullable<string>
  first_seen_at: number
  removed_at: Nullable<number>
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

const bool = (v: number | null | undefined): boolean | null => (v == null ? null : v !== 0)
const bit = (v: boolean | null | undefined): number | null => (v == null ? null : v ? 1 : 0)
const jsonOrNull = (v: unknown): string | null => (v == null ? null : JSON.stringify(v))

function toShop(r: ShopRow): Shop {
  const shop: Shop = {
    id: r.id,
    shopName: r.shop_name,
    title: r.title,
    url: r.url,
    iconUrl: r.icon_url,
    currency: r.currency,
    etsyActiveCount: r.etsy_active_count,
    addedAt: r.added_at,
    profile: null
  }
  if (r.info_fetched_at != null) {
    shop.profile = {
      userId: r.user_id,
      loginName: r.login_name,
      announcement: r.announcement,
      saleMessage: r.sale_message,
      digitalSaleMessage: r.digital_sale_message,
      isVacation: bool(r.is_vacation),
      vacationMessage: r.vacation_message,
      vacationAutoreply: r.vacation_autoreply,
      numFavorers: r.num_favorers,
      transactionSoldCount: r.transaction_sold_count,
      reviewCount: r.review_count,
      reviewAverage: r.review_average,
      digitalListingCount: r.digital_listing_count,
      acceptsCustomRequests: bool(r.accepts_custom_requests),
      languages: parseJson<string[]>(r.languages, []),
      countryIso: r.shop_location_country_iso,
      shippingFromCountryIso: r.shipping_from_country_iso,
      bannerUrl: r.banner_url,
      policies: {
        welcome: r.policy_welcome,
        payment: r.policy_payment,
        shipping: r.policy_shipping,
        refunds: r.policy_refunds,
        additional: r.policy_additional,
        sellerInfo: r.policy_seller_info,
        privacy: r.policy_privacy,
        updatedAt: r.policy_updated_at
      },
      etsyCreatedAt: r.etsy_created_at,
      etsyUpdatedAt: r.etsy_updated_at
    }
  }
  return shop
}

export function toImage(r: ImageRow): ListingImage {
  return {
    id: r.listing_image_id,
    rank: r.rank,
    url75: r.url_75x75,
    url170: r.url_170x135,
    url570: r.url_570xN,
    urlFull: r.url_fullxfull,
    width: r.full_width,
    height: r.full_height,
    alt: r.alt_text,
    hexCode: r.hex_code,
    red: r.red,
    green: r.green,
    blue: r.blue,
    hue: r.hue,
    saturation: r.saturation,
    brightness: r.brightness,
    isBlackAndWhite: bool(r.is_black_and_white),
    createdAt: r.created_timestamp,
    syncStatus: r.sync_status,
    storedAt: r.stored_at
  }
}

function toVideo(r: VideoRow): ListingVideo {
  return {
    id: r.video_id,
    width: r.width,
    height: r.height,
    thumbnailUrl: r.thumbnail_url,
    videoUrl: r.video_url,
    state: r.video_state
  }
}

function toDetails(r: ListingRow): ListingDetails | null {
  // Rows written before schema v2 carry none of these columns.
  if (r.details_fetched_at == null && r.raw_json == null) return null
  return {
    userId: r.user_id,
    shopSectionId: r.shop_section_id,
    taxonomyId: r.taxonomy_id,
    listingType: r.listing_type,
    whoMade: r.who_made,
    whenMade: r.when_made,
    isSupply: bool(r.is_supply),
    materials: parseJson<string[]>(r.materials, []),
    styles: parseJson<string[]>(r.style, []),
    skus: parseJson<string[]>(r.skus, []),
    processingMin: r.processing_min,
    processingMax: r.processing_max,
    isCustomizable: bool(r.is_customizable),
    isPersonalizable: bool(r.is_personalizable),
    personalization: parseJson<PersonalizationQuestion[] | null>(r.personalization, null),
    hasVariations: bool(r.has_variations),
    isPrivate: bool(r.is_private),
    isTaxable: bool(r.is_taxable),
    nonTaxable: bool(r.non_taxable),
    shouldAutoRenew: bool(r.should_auto_renew),
    fileData: r.file_data,
    language: r.language,
    shippingProfileId: r.shipping_profile_id,
    returnPolicyId: r.return_policy_id,
    readinessStateId: r.readiness_state_id,
    itemWeight: r.item_weight,
    itemWeightUnit: r.item_weight_unit,
    itemLength: r.item_length,
    itemWidth: r.item_width,
    itemHeight: r.item_height,
    itemDimensionsUnit: r.item_dimensions_unit,
    originalCreatedAt: r.original_created_at,
    endingAt: r.ending_at,
    stateAt: r.state_at
  }
}

interface ListingExtras {
  images: ListingImage[]
  videos: ListingVideo[]
  prevStats?: { views: number | null; num_favorers: number | null }
  /** Review aggregates of the listing; undefined = the shop's reviews were never synced. */
  reviews?: { count: number; avg: number | null; fresh: number; partial: boolean }
}

function delta(cur: number | null | undefined, prev: number | null | undefined): number | null {
  return cur == null || prev == null ? null : cur - prev
}

function toListing(r: ListingRow, x: ListingExtras): Listing {
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
    images: x.images,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    removedAt: r.removed_at,
    state: r.state,
    views: r.views,
    numFavorers: r.num_favorers,
    featuredRank: r.featured_rank,
    favorersDelta: delta(r.num_favorers, x.prevStats?.num_favorers),
    viewsDelta: delta(r.views, x.prevStats?.views),
    details: toDetails(r),
    videos: x.videos,
    reviewCount: x.reviews ? x.reviews.count : null,
    reviewAvg: x.reviews ? x.reviews.avg : null,
    reviewsNew: x.reviews ? x.reviews.fresh : null,
    reviewsPartial: x.reviews ? x.reviews.partial : false
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

/** A shop as read from Etsy; `rawJson` is the full GET /shops/{id} object. */
export type ShopInput = Shop & { rawJson?: string | null }

export function insertShop(db: Db, shop: ShopInput): void {
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
  if (shop.profile) writeShopProfile(db, shop.id, shop.profile, shop.rawJson ?? null, shop.addedAt)
}

function writeShopProfile(db: Db, id: number, p: ShopProfile, rawJson: string | null, now: number): void {
  db.prepare(
    `UPDATE shops SET user_id = ?, login_name = ?, announcement = ?, sale_message = ?,
       digital_sale_message = ?, is_vacation = ?, vacation_message = ?, vacation_autoreply = ?,
       num_favorers = ?, transaction_sold_count = ?, review_count = ?, review_average = ?,
       digital_listing_count = ?, accepts_custom_requests = ?, languages = ?,
       shop_location_country_iso = ?, shipping_from_country_iso = ?, banner_url = ?,
       policy_welcome = ?, policy_payment = ?, policy_shipping = ?, policy_refunds = ?,
       policy_additional = ?, policy_seller_info = ?, policy_privacy = ?, policy_updated_at = ?,
       etsy_created_at = ?, etsy_updated_at = ?, raw_json = COALESCE(?, raw_json), info_fetched_at = ?
     WHERE id = ?`
  ).run(
    p.userId,
    p.loginName,
    p.announcement,
    p.saleMessage,
    p.digitalSaleMessage,
    bit(p.isVacation),
    p.vacationMessage,
    p.vacationAutoreply,
    p.numFavorers,
    p.transactionSoldCount,
    p.reviewCount,
    p.reviewAverage,
    p.digitalListingCount,
    bit(p.acceptsCustomRequests),
    JSON.stringify(p.languages ?? []),
    p.countryIso,
    p.shippingFromCountryIso,
    p.bannerUrl,
    p.policies.welcome,
    p.policies.payment,
    p.policies.shipping,
    p.policies.refunds,
    p.policies.additional,
    p.policies.sellerInfo,
    p.policies.privacy,
    p.policies.updatedAt,
    p.etsyCreatedAt,
    p.etsyUpdatedAt,
    rawJson,
    now,
    id
  )
}

/**
 * Refresh the Etsy-side shop fields (title, icon, count… and, when given, the
 * full profile + raw JSON) keeping added_at.
 */
export function updateShopInfo(db: Db, shop: Omit<ShopInput, 'addedAt'>, now: number = Date.now()): void {
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
  if (shop.profile) writeShopProfile(db, shop.id, shop.profile, shop.rawJson ?? null, now)
}

export function getShop(db: Db, id: number): Shop | null {
  const r = db.prepare('SELECT * FROM shops WHERE id = ?').get(id) as ShopRow | undefined
  return r ? toShop(r) : null
}

export function getShopRaw(db: Db, id: number): string | null {
  const r = db.prepare('SELECT raw_json FROM shops WHERE id = ?').get(id) as
    | { raw_json: string | null }
    | undefined
  return r?.raw_json ?? null
}

export function findShopByName(db: Db, shopName: string): Shop | null {
  const r = db.prepare('SELECT * FROM shops WHERE shop_name = ?').get(shopName) as
    | ShopRow
    | undefined
  return r ? toShop(r) : null
}

/**
 * Delete a shop; its listings (with images/videos), scans, stats, scan
 * changes, reviews and review sync state go with it (FK cascade). MinIO objects are the caller's job —
 * collect them first with `listShopObjectKeys`.
 */
export function deleteShop(db: Db, id: number): void {
  transaction(db, () => {
    db.prepare(
      'DELETE FROM scan_changes WHERE scan_id IN (SELECT id FROM scans WHERE shop_id = ?)'
    ).run(id)
    db.prepare('DELETE FROM scans WHERE shop_id = ?').run(id)
    db.prepare('DELETE FROM listing_images WHERE shop_id = ?').run(id)
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

/** Ids of a shop's latest `n` successful scans, newest first. */
export function okScanIds(db: Db, shopId: number, n = 2): number[] {
  return (
    db
      .prepare("SELECT id FROM scans WHERE shop_id = ? AND status = 'ok' ORDER BY id DESC LIMIT ?")
      .all(shopId, n) as Array<{ id: number }>
  ).map((r) => r.id)
}

interface ShopStatsRow {
  num_favorers: Nullable<number>
  transaction_sold_count: Nullable<number>
  review_count: Nullable<number>
  review_average: Nullable<number>
  listing_active_count: Nullable<number>
}

function toShopStats(r: ShopStatsRow): ShopStats {
  return {
    numFavorers: r.num_favorers,
    transactionSoldCount: r.transaction_sold_count,
    reviewCount: r.review_count,
    reviewAverage: r.review_average,
    listingActiveCount: r.listing_active_count
  }
}

function getShopStats(db: Db, scanId: number | undefined): ShopStats | null {
  if (scanId == null) return null
  const r = db.prepare('SELECT * FROM shop_stats WHERE scan_id = ?').get(scanId) as
    | ShopStatsRow
    | undefined
  return r ? toShopStats(r) : null
}

/** latest − previous per field; review_average rounded to 2 decimals. */
export function shopStatsDelta(cur: ShopStats | null, prev: ShopStats | null): ShopStats | null {
  if (!cur || !prev) return null
  const avg = delta(cur.reviewAverage, prev.reviewAverage)
  return {
    numFavorers: delta(cur.numFavorers, prev.numFavorers),
    transactionSoldCount: delta(cur.transactionSoldCount, prev.transactionSoldCount),
    reviewCount: delta(cur.reviewCount, prev.reviewCount),
    reviewAverage: avg == null ? null : Math.round(avg * 100) / 100,
    listingActiveCount: delta(cur.listingActiveCount, prev.listingActiveCount)
  }
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
  const [curId, prevId] = okScanIds(db, shop.id, 2)
  const stats = getShopStats(db, curId)
  return {
    ...shop,
    activeCount: active.n,
    lastOkScan,
    lastScan: last ? toScan(last) : null,
    newCount: lastOkScan && !lastOkScan.isBaseline ? lastOkScan.added : 0,
    stats,
    statsDelta: shopStatsDelta(stats, getShopStats(db, prevId)),
    reviews: reviewSyncInfo(db, shop.id)
  }
}

// ------------------------------------------------------------------- listings

/** A listing as produced by a scan (our bookkeeping columns are set on write). */
export type ListingInput = Omit<
  Listing,
  'firstSeenAt' | 'lastSeenAt' | 'removedAt' | 'images' | 'videos' | 'favorersDelta' | 'viewsDelta'
> & {
  /** null = images were not fetched this scan; keep what is stored. */
  images: ListingImage[] | null
  /** null/absent = videos were not fetched this scan; keep what is stored. */
  videos?: ListingVideo[] | null
  /** The most complete API object we have for it this scan (details, else the page item). */
  rawJson?: string | null
  /**
   * The details call (/listings/batch) answered for it this scan: views and
   * personalization are only known then — otherwise the stored ones are kept.
   */
  detailsFetched?: boolean
  /**
   * The details answer carried personalization (the `Personalization` include
   * was requested, or the key is present). Defaults to `detailsFetched`.
   * False after the Images-only include fallback: the stored questions are kept.
   */
  personalizationFetched?: boolean
}

function imagesFor(db: Db, where: string, arg: number): Map<number, ListingImage[]> {
  const rows = db
    .prepare(
      `SELECT i.* FROM listing_images i JOIN listings l ON l.listing_id = i.listing_id
       WHERE ${where} AND i.removed_at IS NULL ORDER BY i.listing_id, i.rank, i.listing_image_id`
    )
    .all(arg) as unknown as ImageRow[]
  const out = new Map<number, ListingImage[]>()
  for (const r of rows) {
    const list = out.get(r.listing_id) ?? []
    list.push(toImage(r))
    out.set(r.listing_id, list)
  }
  return out
}

function videosFor(db: Db, where: string, arg: number): Map<number, ListingVideo[]> {
  const rows = db
    .prepare(
      `SELECT v.* FROM listing_videos v JOIN listings l ON l.listing_id = v.listing_id
       WHERE ${where} AND v.removed_at IS NULL ORDER BY v.listing_id, v.video_id`
    )
    .all(arg) as unknown as VideoRow[]
  const out = new Map<number, ListingVideo[]>()
  for (const r of rows) {
    const list = out.get(r.listing_id) ?? []
    list.push(toVideo(r))
    out.set(r.listing_id, list)
  }
  return out
}

/** listing_stats of one scan, by listing_id. */
function statsOfScan(
  db: Db,
  scanId: number | undefined
): Map<number, { views: number | null; num_favorers: number | null }> {
  const out = new Map<number, { views: number | null; num_favorers: number | null }>()
  if (scanId == null) return out
  const rows = db
    .prepare('SELECT listing_id, views, num_favorers FROM listing_stats WHERE scan_id = ?')
    .all(scanId) as Array<{ listing_id: number; views: number | null; num_favorers: number | null }>
  for (const r of rows) out.set(r.listing_id, r)
  return out
}

function listingsOfShop(db: Db, shopId: number, activeOnly: boolean): Listing[] {
  const rows = db
    .prepare(
      `SELECT * FROM listings WHERE shop_id = ? ${activeOnly ? 'AND removed_at IS NULL' : ''}
       ORDER BY etsy_created_at DESC, listing_id DESC`
    )
    .all(shopId) as unknown as ListingRow[]
  const images = imagesFor(db, 'l.shop_id = ?', shopId)
  const videos = videosFor(db, 'l.shop_id = ?', shopId)
  // Deltas compare with the previous successful scan (the latest one wrote the current values).
  const prev = statsOfScan(db, okScanIds(db, shopId, 2)[1])
  const reviews = reviewAggregates(db, shopId)
  return rows.map((r) =>
    toListing(r, {
      images: images.get(r.listing_id) ?? [],
      videos: videos.get(r.listing_id) ?? [],
      prevStats: prev.get(r.listing_id),
      reviews: reviews?.(r.listing_id)
    })
  )
}

export function listActiveListings(db: Db, shopId: number): Listing[] {
  return listingsOfShop(db, shopId, true)
}

export function getListing(db: Db, listingId: number): Listing | null {
  const r = db.prepare('SELECT * FROM listings WHERE listing_id = ?').get(listingId) as
    | ListingRow
    | undefined
  if (!r) return null
  const prev = statsOfScan(db, okScanIds(db, r.shop_id, 2)[1])
  return toListing(r, {
    images: imagesFor(db, 'l.listing_id = ?', listingId).get(listingId) ?? [],
    videos: videosFor(db, 'l.listing_id = ?', listingId).get(listingId) ?? [],
    prevStats: prev.get(listingId),
    reviews: reviewAggregates(db, r.shop_id, listingId)?.(listingId)
  })
}

/** The latest full API object stored for a listing (pretty-printed by the UI). */
export function getListingRaw(db: Db, listingId: number): string | null {
  const r = db.prepare('SELECT raw_json FROM listings WHERE listing_id = ?').get(listingId) as
    | { raw_json: string | null }
    | undefined
  return r?.raw_json ?? null
}

/** Every stored listing of a shop (active and removed) — the previous snapshot for a diff. */
export function listAllListings(db: Db, shopId: number): Listing[] {
  return listingsOfShop(db, shopId, false)
}

/**
 * Insert or refresh a listing as seen active at `now`. Clears removed_at.
 * Images/videos passed as null keep the stored ones; arrays are synced into
 * listing_images / listing_videos (see `syncListingImages`). Not wrapped in a
 * transaction — callers batch these inside `applyScan`'s.
 */
export function upsertListing(db: Db, l: ListingInput, now: number): void {
  const d = l.details ?? null
  const fetched = !!l.detailsFetched
  const cols: Array<[string, SQLInputValue]> = [
    ['listing_id', l.listingId],
    ['shop_id', l.shopId],
    ['title', l.title],
    ['description', l.description],
    ['price_amount', l.priceAmount],
    ['price_divisor', l.priceDivisor],
    ['currency', l.currency],
    ['url', l.url],
    ['tags', JSON.stringify(l.tags)],
    ['quantity', l.quantity],
    ['etsy_created_at', l.etsyCreatedAt],
    ['etsy_updated_at', l.etsyUpdatedAt],
    ['user_id', d?.userId ?? null],
    ['state', l.state ?? null],
    ['views', l.views ?? null],
    ['num_favorers', l.numFavorers ?? null],
    ['featured_rank', l.featuredRank ?? null],
    ['shop_section_id', d?.shopSectionId ?? null],
    ['taxonomy_id', d?.taxonomyId ?? null],
    ['listing_type', d?.listingType ?? null],
    ['who_made', d?.whoMade ?? null],
    ['when_made', d?.whenMade ?? null],
    ['is_supply', bit(d?.isSupply)],
    ['materials', d ? JSON.stringify(d.materials) : null],
    ['style', d ? JSON.stringify(d.styles) : null],
    ['skus', d ? JSON.stringify(d.skus) : null],
    ['processing_min', d?.processingMin ?? null],
    ['processing_max', d?.processingMax ?? null],
    ['is_customizable', bit(d?.isCustomizable)],
    ['is_personalizable', bit(d?.isPersonalizable)],
    ['personalization', jsonOrNull(d?.personalization)],
    ['has_variations', bit(d?.hasVariations)],
    ['is_private', bit(d?.isPrivate)],
    ['is_taxable', bit(d?.isTaxable)],
    ['non_taxable', bit(d?.nonTaxable)],
    ['should_auto_renew', bit(d?.shouldAutoRenew)],
    ['file_data', d?.fileData ?? null],
    ['language', d?.language ?? null],
    ['shipping_profile_id', d?.shippingProfileId ?? null],
    ['return_policy_id', d?.returnPolicyId ?? null],
    ['readiness_state_id', d?.readinessStateId ?? null],
    ['item_weight', d?.itemWeight ?? null],
    ['item_weight_unit', d?.itemWeightUnit ?? null],
    ['item_length', d?.itemLength ?? null],
    ['item_width', d?.itemWidth ?? null],
    ['item_height', d?.itemHeight ?? null],
    ['item_dimensions_unit', d?.itemDimensionsUnit ?? null],
    ['original_created_at', d?.originalCreatedAt ?? null],
    ['ending_at', d?.endingAt ?? null],
    ['state_at', d?.stateAt ?? null],
    ['raw_json', l.rawJson ?? null],
    ['details_fetched_at', fetched ? now : null],
    ['first_seen_at', now],
    ['last_seen_at', now]
  ]
  // Fields only the details call returns keep their stored value when it didn't answer.
  const keepUnlessFetched = new Set(['skus', 'details_fetched_at'])
  const personalizationFetched = l.personalizationFetched ?? fetched
  const updates = cols
    .map(([c]) => c)
    .filter((c) => c !== 'listing_id' && c !== 'first_seen_at')
    .map((c) => {
      if (keepUnlessFetched.has(c)) return fetched ? `${c} = excluded.${c}` : `${c} = listings.${c}`
      if (c === 'personalization') {
        return personalizationFetched ? `${c} = excluded.${c}` : `${c} = listings.${c}`
      }
      // views: null = unknown this scan (no details, or a 0 the scanner distrusts) → keep.
      if (c === 'views') return `${c} = COALESCE(excluded.${c}, listings.${c})`
      // raw_json: the full details object wins; a page-only object never replaces a stored one.
      if (c === 'raw_json') {
        return fetched
          ? `${c} = COALESCE(excluded.${c}, listings.${c})`
          : `${c} = COALESCE(listings.${c}, excluded.${c})`
      }
      return `${c} = excluded.${c}`
    })
  db.prepare(
    `INSERT INTO listings (${cols.map(([c]) => c).join(', ')}, removed_at)
     VALUES (${cols.map(() => '?').join(', ')}, NULL)
     ON CONFLICT(listing_id) DO UPDATE SET ${updates.join(', ')}, removed_at = NULL`
  ).run(...cols.map(([, v]) => v))
  if (l.images) syncListingImages(db, l.listingId, l.shopId, l.images, now)
  if (l.videos) syncListingVideos(db, l.listingId, l.videos, now)
}

/**
 * Make listing_images match the fresh image list of one listing:
 * - new listing_image_id → inserted with sync_status 'pending';
 * - known id → metadata refreshed (rank, colours, alt, urls…); a changed
 *   fullxfull/570xN URL resets it to 'pending' so the image sync re-downloads it;
 *   a previously removed id is revived;
 * - an active id that is gone → removed_at = now (its MinIO objects are deleted
 *   by the image sync, never inside the scan transaction).
 */
export function syncListingImages(
  db: Db,
  listingId: number,
  shopId: number,
  images: ListingImage[],
  now: number
): void {
  const existing = new Map(
    (
      db
        .prepare(
          'SELECT listing_image_id, url_570xN, url_fullxfull, removed_at FROM listing_images WHERE listing_id = ?'
        )
        .all(listingId) as Array<{
        listing_image_id: number
        url_570xN: string
        url_fullxfull: string
        removed_at: number | null
      }>
    ).map((r) => [r.listing_image_id, r])
  )
  const fresh = new Set<number>()
  const upsert = db.prepare(
    `INSERT INTO listing_images (listing_image_id, listing_id, shop_id, rank, url_75x75, url_170x135,
       url_570xN, url_fullxfull, full_width, full_height, hex_code, red, green, blue, hue,
       saturation, brightness, is_black_and_white, alt_text, created_timestamp, first_seen_at,
       removed_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending')
     ON CONFLICT(listing_id, listing_image_id) DO UPDATE SET
       shop_id = excluded.shop_id, rank = excluded.rank,
       url_75x75 = excluded.url_75x75, url_170x135 = excluded.url_170x135,
       url_570xN = excluded.url_570xN, url_fullxfull = excluded.url_fullxfull,
       full_width = excluded.full_width, full_height = excluded.full_height,
       hex_code = excluded.hex_code, red = excluded.red, green = excluded.green, blue = excluded.blue,
       hue = excluded.hue, saturation = excluded.saturation, brightness = excluded.brightness,
       is_black_and_white = excluded.is_black_and_white, alt_text = excluded.alt_text,
       created_timestamp = excluded.created_timestamp, removed_at = NULL`
  )
  const resetSync = db.prepare(
    `UPDATE listing_images SET sync_status = 'pending', sync_error = NULL, sync_attempts = 0
     WHERE listing_id = ? AND listing_image_id = ?`
  )
  for (const i of images) {
    if (!i.id || fresh.has(i.id)) continue
    fresh.add(i.id)
    upsert.run(
      i.id,
      listingId,
      shopId,
      i.rank,
      i.url75,
      i.url170,
      i.url570,
      i.urlFull,
      i.width,
      i.height,
      i.hexCode ?? null,
      i.red ?? null,
      i.green ?? null,
      i.blue ?? null,
      i.hue ?? null,
      i.saturation ?? null,
      i.brightness ?? null,
      bit(i.isBlackAndWhite),
      i.alt,
      i.createdAt ?? null,
      now
    )
    const ex = existing.get(i.id)
    if (ex && (ex.url_fullxfull !== i.urlFull || ex.url_570xN !== i.url570)) resetSync.run(listingId, i.id)
  }
  const remove = db.prepare('UPDATE listing_images SET removed_at = ? WHERE listing_id = ? AND listing_image_id = ?')
  for (const [id, ex] of existing) {
    if (!fresh.has(id) && ex.removed_at == null) remove.run(now, listingId, id)
  }
}

export function syncListingVideos(db: Db, listingId: number, videos: ListingVideo[], now: number): void {
  const existing = db
    .prepare('SELECT video_id, removed_at FROM listing_videos WHERE listing_id = ?')
    .all(listingId) as Array<{ video_id: number; removed_at: number | null }>
  const fresh = new Set<number>()
  const upsert = db.prepare(
    `INSERT INTO listing_videos (video_id, listing_id, width, height, thumbnail_url, video_url,
       video_state, first_seen_at, removed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(listing_id, video_id) DO UPDATE SET width = excluded.width,
       height = excluded.height, thumbnail_url = excluded.thumbnail_url,
       video_url = excluded.video_url, video_state = excluded.video_state, removed_at = NULL`
  )
  for (const v of videos) {
    if (!v.id || fresh.has(v.id)) continue
    fresh.add(v.id)
    upsert.run(v.id, listingId, v.width, v.height, v.thumbnailUrl, v.videoUrl, v.state, now)
  }
  const remove = db.prepare('UPDATE listing_videos SET removed_at = ? WHERE listing_id = ? AND video_id = ?')
  for (const ex of existing) {
    if (!fresh.has(ex.video_id) && ex.removed_at == null) remove.run(now, listingId, ex.video_id)
  }
}

// ---------------------------------------------------------------------- stats

export interface ListingStatsInput {
  listingId: number
  views: number | null
  numFavorers: number | null
  featuredRank: number | null
  quantity: number | null
}

/** The views value stored on a listing row (null when unknown). */
export function getListingViews(db: Db, listingId: number): number | null {
  const r = db.prepare('SELECT views FROM listings WHERE listing_id = ?').get(listingId) as
    | { views: number | null }
    | undefined
  return r?.views ?? null
}

export function insertListingStats(db: Db, scanId: number, rows: ListingStatsInput[]): void {
  const st = db.prepare(
    `INSERT OR REPLACE INTO listing_stats (scan_id, listing_id, views, num_favorers, featured_rank, quantity)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  for (const r of rows) st.run(scanId, r.listingId, r.views, r.numFavorers, r.featuredRank, r.quantity)
}

export function insertShopStats(db: Db, scanId: number, shopId: number, s: ShopStats): void {
  db.prepare(
    `INSERT OR REPLACE INTO shop_stats (scan_id, shop_id, num_favorers, transaction_sold_count,
       review_count, review_average, listing_active_count) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    scanId,
    shopId,
    s.numFavorers,
    s.transactionSoldCount,
    s.reviewCount,
    s.reviewAverage,
    s.listingActiveCount
  )
}

export type { ListingStatsPoint }

/** One listing's popularity per successful scan, oldest first. */
export function listListingStats(db: Db, listingId: number): ListingStatsPoint[] {
  const rows = db
    .prepare(
      `SELECT s.scan_id, sc.finished_at, s.views, s.num_favorers, s.featured_rank, s.quantity,
         rs.review_count, rs.review_avg, rs.complete AS reviews_complete
       FROM listing_stats s JOIN scans sc ON sc.id = s.scan_id
       LEFT JOIN listing_review_stats rs ON rs.scan_id = s.scan_id AND rs.listing_id = s.listing_id
       WHERE s.listing_id = ? ORDER BY s.scan_id`
    )
    .all(listingId) as Array<{
    scan_id: number
    finished_at: number | null
    views: number | null
    num_favorers: number | null
    featured_rank: number | null
    quantity: number | null
    review_count: number | null
    review_avg: number | null
    reviews_complete: number | null
  }>
  return rows.map((r) => ({
    scanId: r.scan_id,
    at: r.finished_at,
    views: r.views,
    numFavorers: r.num_favorers,
    featuredRank: r.featured_rank,
    quantity: r.quantity,
    reviewCount: r.review_count,
    reviewAvg: r.review_avg,
    reviewsComplete: bool(r.reviews_complete)
  }))
}

// --------------------------------------------------------------- image sync

/** Which row of `listing_images` an operation is about: one image on one listing. */
export interface ImageRef {
  listing_id: number
  listing_image_id: number
}

/**
 * One image row. With `listingId`: exactly that listing's row. Without it (the
 * `etsyimg://` handler, which only knows the Etsy image id — shared by every
 * listing that reuses the photo): the most useful row — a stored copy first,
 * then an active row.
 */
export function getImageRow(db: Db, imageId: number, listingId?: number): ImageRow | null {
  const row =
    listingId != null
      ? db.prepare('SELECT * FROM listing_images WHERE listing_id = ? AND listing_image_id = ?').get(listingId, imageId)
      : db
          .prepare(
            `SELECT * FROM listing_images WHERE listing_image_id = ?
             ORDER BY sync_status = 'stored' DESC, removed_at IS NULL DESC, listing_id LIMIT 1`
          )
          .get(imageId)
  return (row as ImageRow | undefined) ?? null
}

/**
 * Active images that still need a MinIO copy: 'pending', plus 'error' rows
 * with fewer than `maxAttempts` failed tries (all errors when `maxAttempts` is
 * null — the manual "Синхронізувати фото").
 */
export function listImagesToSync(
  db: Db,
  opts: { shopId?: number | null; maxAttempts?: number | null } = {}
): ImageRow[] {
  const max = opts.maxAttempts === undefined ? 5 : opts.maxAttempts
  const params: SQLInputValue[] = []
  let where = "removed_at IS NULL AND (sync_status = 'pending' OR (sync_status = 'error'"
  if (max != null) {
    where += ' AND sync_attempts < ?'
    params.push(max)
  }
  where += '))'
  if (opts.shopId != null) {
    where += ' AND shop_id = ?'
    params.push(opts.shopId)
  }
  return db
    .prepare(`SELECT * FROM listing_images WHERE ${where} ORDER BY shop_id, listing_id, rank`)
    .all(...params) as unknown as ImageRow[]
}

/** Removed images whose MinIO objects still exist. */
export function listImagesToCleanup(db: Db): ImageRow[] {
  return db
    .prepare(
      'SELECT * FROM listing_images WHERE removed_at IS NOT NULL AND (key_full IS NOT NULL OR key_570 IS NOT NULL)'
    )
    .all() as unknown as ImageRow[]
}

export interface StoredImageInfo {
  keyFull: string
  key570: string | null
  byteSize: number
  contentType: string | null
  etag: string | null
  sha256: string
  storedAt: number
}

/**
 * Record a finished upload — only if the row still has the URL that was
 * downloaded (a rescan may have replaced it meanwhile; then it stays pending).
 */
export function markImageStored(db: Db, ref: ImageRef, downloadedUrl: string, s: StoredImageInfo): boolean {
  const r = db
    .prepare(
      `UPDATE listing_images SET sync_status = 'stored', sync_error = NULL, stored_at = ?, key_full = ?,
         key_570 = ?, byte_size = ?, content_type = ?, etag = ?, sha256 = ?
       WHERE listing_id = ? AND listing_image_id = ? AND url_fullxfull = ? AND sync_status != 'stored'`
    )
    .run(s.storedAt, s.keyFull, s.key570, s.byteSize, s.contentType, s.etag, s.sha256, ref.listing_id, ref.listing_image_id, downloadedUrl)
  return Number(r.changes) > 0
}

export function markImageError(db: Db, ref: ImageRef, downloadedUrl: string, error: string): void {
  db.prepare(
    `UPDATE listing_images SET sync_status = 'error', sync_error = ?, sync_attempts = sync_attempts + 1
     WHERE listing_id = ? AND listing_image_id = ? AND url_fullxfull = ?`
  ).run(error.slice(0, 500), ref.listing_id, ref.listing_image_id, downloadedUrl)
}

/**
 * The objects `keyFull`/`key570` of an image were deleted from MinIO: forget
 * them and make the row 'pending' again. Guarded by the keys actually deleted,
 * not by removed_at — a rescan may have revived the image meanwhile, and a
 * revived row must be uploaded again rather than stay 'stored' without objects.
 */
export function markImageObjectsDeleted(
  db: Db,
  ref: ImageRef,
  keyFull: string | null,
  key570: string | null
): void {
  db.prepare(
    `UPDATE listing_images SET key_full = NULL, key_570 = NULL, stored_at = NULL, etag = NULL,
       sync_status = 'pending', sync_error = NULL, sync_attempts = 0
     WHERE listing_id = ? AND listing_image_id = ? AND key_full IS ? AND key_570 IS ?`
  ).run(ref.listing_id, ref.listing_image_id, keyFull, key570)
}

/**
 * A stored image's object is missing from MinIO (bucket switched, volume
 * wiped, deleted by hand): forget its keys and queue it again.
 */
export function markImageMissing(db: Db, ref: ImageRef): void {
  db.prepare(
    `UPDATE listing_images SET key_full = NULL, key_570 = NULL, stored_at = NULL, etag = NULL,
       sync_status = 'pending', sync_error = NULL, sync_attempts = 0
     WHERE listing_id = ? AND listing_image_id = ? AND sync_status = 'stored'`
  ).run(ref.listing_id, ref.listing_image_id)
}

/**
 * The MinIO endpoint or bucket changed: nothing stored is known to exist in
 * the new place, so every copy is queued again (objects in the old bucket are
 * left alone). Returns how many rows were reset.
 */
export function resetStoredImages(db: Db): number {
  const r = db
    .prepare(
      `UPDATE listing_images SET key_full = NULL, key_570 = NULL, stored_at = NULL, etag = NULL,
         sync_status = 'pending', sync_error = NULL, sync_attempts = 0
       WHERE sync_status = 'stored' OR key_full IS NOT NULL OR key_570 IS NOT NULL`
    )
    .run()
  const rv = db
    .prepare(
      `UPDATE reviews SET image_key = NULL, image_stored_at = NULL, image_etag = NULL,
         image_sync_status = CASE WHEN image_url_fullxfull IS NULL THEN NULL ELSE 'pending' END,
         image_sync_error = NULL, image_sync_attempts = 0
       WHERE image_sync_status = 'stored' OR image_key IS NOT NULL`
    )
    .run()
  return Number(r.changes) + Number(rv.changes)
}

/** Active 'stored' rows (to verify their objects still exist on a forced sync). */
export function listStoredImages(db: Db, shopId?: number | null): ImageRow[] {
  return db
    .prepare(
      `SELECT * FROM listing_images WHERE removed_at IS NULL AND sync_status = 'stored'
       ${shopId != null ? 'AND shop_id = ?' : ''} ORDER BY shop_id, listing_id, rank`
    )
    .all(...(shopId != null ? [shopId] : [])) as unknown as ImageRow[]
}

/** Every MinIO key stored for a shop (to delete before `deleteShop`). */
export function listShopObjectKeys(db: Db, shopId: number): string[] {
  const rows = db
    .prepare('SELECT key_full, key_570 FROM listing_images WHERE shop_id = ?')
    .all(shopId) as Array<{ key_full: string | null; key_570: string | null }>
  const reviewKeys = db
    .prepare('SELECT image_key FROM reviews WHERE shop_id = ? AND image_key IS NOT NULL')
    .all(shopId) as Array<{ image_key: string }>
  return [
    ...rows.flatMap((r) => [r.key_full, r.key_570]),
    ...reviewKeys.map((r) => r.image_key)
  ].filter((k): k is string => !!k)
}

export function imageCounts(db: Db, shopId?: number | null): ImageCounts {
  const rows = db
    .prepare(
      `SELECT sync_status AS s, COUNT(*) AS n FROM listing_images i
       JOIN listings l ON l.listing_id = i.listing_id
       WHERE i.removed_at IS NULL AND l.removed_at IS NULL ${shopId != null ? 'AND i.shop_id = ?' : ''}
       GROUP BY sync_status`
    )
    .all(...(shopId != null ? [shopId] : [])) as Array<{ s: ImageSyncStatus; n: number }>
  const c: ImageCounts = { total: 0, stored: 0, pending: 0, error: 0 }
  for (const r of rows) {
    c[r.s] = r.n
    c.total += r.n
  }
  return c
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

// -------------------------------------------------------------------- reviews

/** A review as mapped from Etsy (`mapReview`); bookkeeping columns are set on write. */
export interface ReviewInput {
  key: string
  shopId: number
  listingId: number | null
  transactionId: number | null
  buyerUserId: number | null
  rating: number | null
  text: string | null
  language: string | null
  /** Validated Etsy CDN URL, else null. */
  imageUrl: string | null
  createTimestamp: number | null
  createdTimestamp: number | null
  updateTimestamp: number | null
  updatedTimestamp: number | null
  rawJson: string
}

interface ReviewRow {
  id: number
  review_key: string
  shop_id: number
  listing_id: Nullable<number>
  transaction_id: Nullable<number>
  buyer_user_id: Nullable<number>
  rating: Nullable<number>
  review: Nullable<string>
  language: Nullable<string>
  image_url_fullxfull: Nullable<string>
  create_timestamp: Nullable<number>
  created_timestamp: Nullable<number>
  update_timestamp: Nullable<number>
  updated_timestamp: Nullable<number>
  raw_json: string
  first_seen_at: number
  last_seen_at: number
  changed_at: Nullable<number>
  first_seen_scan_id: Nullable<number>
  origin: ReviewOrigin
  image_sync_status: Nullable<ImageSyncStatus>
  image_sync_error: Nullable<string>
  image_sync_attempts: number
  image_stored_at: Nullable<number>
  image_key: Nullable<string>
  image_byte_size: Nullable<number>
  image_content_type: Nullable<string>
  image_etag: Nullable<string>
  image_sha256: Nullable<string>
}

/** The columns the image sync / etsyimg handler need of one review row. */
export type ReviewImageRow = Pick<
  ReviewRow,
  | 'id'
  | 'review_key'
  | 'shop_id'
  | 'image_url_fullxfull'
  | 'image_sync_status'
  | 'image_sync_attempts'
  | 'image_key'
>

function toReview(r: ReviewRow & { listing_title?: string | null; listing_image_id?: number | null }): Review {
  const out: Review = {
    id: r.id,
    key: r.review_key,
    shopId: r.shop_id,
    listingId: r.listing_id,
    transactionId: r.transaction_id,
    buyerUserId: r.buyer_user_id,
    rating: r.rating,
    text: r.review,
    language: r.language,
    hasImage: !!r.image_url_fullxfull,
    imageStatus: r.image_sync_status,
    createdAt: r.created_timestamp,
    updatedAt: r.updated_timestamp,
    firstSeenAt: r.first_seen_at,
    firstSeenScanId: r.first_seen_scan_id,
    origin: r.origin
  }
  if ('listing_title' in r) out.listingTitle = r.listing_title ?? null
  if ('listing_image_id' in r) out.listingImageId = r.listing_image_id ?? null
  return out
}

export interface ReviewSyncRow {
  shop_id: number
  backfill_complete: number
  backfill_upper: Nullable<number>
  total_estimate: Nullable<number>
  win_hi: Nullable<number>
  win_lo: Nullable<number>
  win_offset: number
  win_count: Nullable<number>
  win_span: Nullable<number>
  synced_through: Nullable<number>
  inc_lo: Nullable<number>
  inc_hi: Nullable<number>
  inc_target: Nullable<number>
  inc_offset: number
  inc_count: Nullable<number>
  oldest_created: Nullable<number>
  newest_created: Nullable<number>
  requests_total: number
  last_run_requests: number
  last_synced_at: Nullable<number>
  last_error: Nullable<string>
}

const REVIEW_SYNC_COLS: Array<keyof ReviewSyncRow> = [
  'shop_id',
  'backfill_complete',
  'backfill_upper',
  'total_estimate',
  'win_hi',
  'win_lo',
  'win_offset',
  'win_count',
  'win_span',
  'synced_through',
  'inc_lo',
  'inc_hi',
  'inc_target',
  'inc_offset',
  'inc_count',
  'oldest_created',
  'newest_created',
  'requests_total',
  'last_run_requests',
  'last_synced_at',
  'last_error'
]

/** A shop's review sync cursor before its first run. */
export function emptyReviewSync(shopId: number): ReviewSyncRow {
  return {
    shop_id: shopId,
    backfill_complete: 0,
    backfill_upper: null,
    total_estimate: null,
    win_hi: null,
    win_lo: null,
    win_offset: 0,
    win_count: null,
    win_span: null,
    synced_through: null,
    inc_lo: null,
    inc_hi: null,
    inc_target: null,
    inc_offset: 0,
    inc_count: null,
    oldest_created: null,
    newest_created: null,
    requests_total: 0,
    last_run_requests: 0,
    last_synced_at: null,
    last_error: null
  }
}

export function getReviewSync(db: Db, shopId: number): ReviewSyncRow | null {
  const r = db.prepare('SELECT * FROM review_sync WHERE shop_id = ?').get(shopId) as ReviewSyncRow | undefined
  return r ?? null
}

/** Two cursor rows hold the same saved values (every column `saveReviewSync` writes). */
export function sameReviewSync(a: ReviewSyncRow, b: ReviewSyncRow): boolean {
  return REVIEW_SYNC_COLS.every((c) => a[c] === b[c])
}

/** Insert or replace a shop's review sync cursor (no-op if the shop was deleted). */
export function saveReviewSync(db: Db, row: ReviewSyncRow): void {
  if (!db.prepare('SELECT 1 FROM shops WHERE id = ?').get(row.shop_id)) return
  db.prepare(
    `INSERT OR REPLACE INTO review_sync (${REVIEW_SYNC_COLS.join(', ')})
     VALUES (${REVIEW_SYNC_COLS.map(() => '?').join(', ')})`
  ).run(...REVIEW_SYNC_COLS.map((c) => row[c] as SQLInputValue))
}

export interface UpsertReviewsResult {
  inserted: number
  /** Known reviews whose content (rating, text, photo, update time…) changed. */
  updated: number
  /** Inserted with origin 'new'. */
  fresh: number
}

/**
 * Insert unseen reviews (origin from `isNew`, first_seen_scan_id = `scanId`)
 * and refresh known ones: every API column + raw_json + last_seen_at; an edit
 * sets changed_at; a changed photo URL queues the photo again (a vanished one
 * leaves the object for cleanup — only what the API returns is kept). Origin
 * and first-seen fields never change. Not wrapped in a transaction.
 */
export function upsertReviews(
  db: Db,
  shopId: number,
  reviews: ReviewInput[],
  o: { now: number; scanId: number | null; isNew: (r: ReviewInput) => boolean }
): UpsertReviewsResult {
  const out: UpsertReviewsResult = { inserted: 0, updated: 0, fresh: 0 }
  const sel = db.prepare(
    `SELECT id, listing_id, rating, review, language, image_url_fullxfull, updated_timestamp, update_timestamp
     FROM reviews WHERE review_key = ?`
  )
  const ins = db.prepare(
    `INSERT INTO reviews (review_key, shop_id, listing_id, transaction_id, buyer_user_id, rating, review,
       language, image_url_fullxfull, create_timestamp, created_timestamp, update_timestamp,
       updated_timestamp, raw_json, first_seen_at, last_seen_at, first_seen_scan_id, origin,
       image_sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const upd = db.prepare(
    `UPDATE reviews SET listing_id = ?, transaction_id = ?, buyer_user_id = ?, rating = ?, review = ?,
       language = ?, image_url_fullxfull = ?, create_timestamp = ?, created_timestamp = ?,
       update_timestamp = ?, updated_timestamp = ?, raw_json = ?, last_seen_at = ?,
       changed_at = CASE WHEN ? THEN ? ELSE changed_at END
     WHERE id = ?`
  )
  const requeue = db.prepare(
    `UPDATE reviews SET image_sync_status = ?, image_sync_error = NULL, image_sync_attempts = 0
     WHERE id = ?`
  )
  const seen = new Set<string>()
  for (const r of reviews) {
    if (seen.has(r.key)) continue
    seen.add(r.key)
    const ex = sel.get(r.key) as
      | {
          id: number
          listing_id: number | null
          rating: number | null
          review: string | null
          language: string | null
          image_url_fullxfull: string | null
          updated_timestamp: number | null
          update_timestamp: number | null
        }
      | undefined
    if (!ex) {
      const fresh = o.isNew(r)
      ins.run(
        r.key,
        shopId,
        r.listingId,
        r.transactionId,
        r.buyerUserId,
        r.rating,
        r.text,
        r.language,
        r.imageUrl,
        r.createTimestamp,
        r.createdTimestamp,
        r.updateTimestamp,
        r.updatedTimestamp,
        r.rawJson,
        o.now,
        o.now,
        o.scanId,
        fresh ? 'new' : 'backfill',
        r.imageUrl ? 'pending' : null
      )
      out.inserted++
      if (fresh) out.fresh++
      continue
    }
    const changed =
      ex.listing_id !== r.listingId ||
      ex.rating !== r.rating ||
      (ex.review ?? null) !== (r.text ?? null) ||
      (ex.language ?? null) !== (r.language ?? null) ||
      (ex.image_url_fullxfull ?? null) !== (r.imageUrl ?? null) ||
      (ex.updated_timestamp ?? null) !== (r.updatedTimestamp ?? null) ||
      (ex.update_timestamp ?? null) !== (r.updateTimestamp ?? null)
    upd.run(
      r.listingId,
      r.transactionId,
      r.buyerUserId,
      r.rating,
      r.text,
      r.language,
      r.imageUrl,
      r.createTimestamp,
      r.createdTimestamp,
      r.updateTimestamp,
      r.updatedTimestamp,
      r.rawJson,
      o.now,
      changed ? 1 : 0,
      o.now,
      ex.id
    )
    if (changed) out.updated++
    if ((ex.image_url_fullxfull ?? null) !== (r.imageUrl ?? null)) {
      requeue.run(r.imageUrl ? 'pending' : null, ex.id)
    }
  }
  return out
}

/** Oldest/newest created_timestamp and the count/average of a shop's stored reviews. */
export function reviewTotals(
  db: Db,
  shopId: number
): { count: number; avg: number | null; oldest: number | null; newest: number | null } {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n, AVG(rating) AS avg, MIN(created_timestamp) AS oldest,
         MAX(created_timestamp) AS newest FROM reviews WHERE shop_id = ?`
    )
    .get(shopId) as { n: number; avg: number | null; oldest: number | null; newest: number | null }
  return { count: r.n, avg: roundAvg(r.avg), oldest: r.oldest, newest: r.newest }
}

/**
 * How many of a shop's stored reviews were created in [lo, hi] (seconds; lo
 * null = no lower bound) — what a finished sync window is checked against.
 */
export function countReviewsCreated(db: Db, shopId: number, lo: number | null, hi: number): number {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n FROM reviews
       WHERE shop_id = ? AND created_timestamp <= ? AND (? IS NULL OR created_timestamp >= ?)`
    )
    .get(shopId, hi, lo, lo) as { n: number }
  return r.n
}

const roundAvg = (v: number | null | undefined): number | null =>
  v == null ? null : Math.round(v * 100) / 100

/**
 * Per-listing review aggregates of a shop (optionally one listing): count,
 * average, and how many were first seen as new by the latest successful
 * scan's sync. null when the shop's reviews were never synced.
 */
function reviewAggregates(
  db: Db,
  shopId: number,
  listingId?: number
): ((listingId: number) => { count: number; avg: number | null; fresh: number; partial: boolean }) | null {
  const sync = getReviewSync(db, shopId)
  if (!sync || sync.backfill_upper == null) return null
  const latest = okScanIds(db, shopId, 1)[0] ?? -1
  const rows = db
    .prepare(
      `SELECT listing_id, COUNT(*) AS n, AVG(rating) AS avg,
         SUM(CASE WHEN origin = 'new' AND first_seen_scan_id = ? THEN 1 ELSE 0 END) AS fresh
       FROM reviews WHERE shop_id = ? ${listingId != null ? 'AND listing_id = ?' : ''}
       GROUP BY listing_id`
    )
    .all(latest, shopId, ...(listingId != null ? [listingId] : [])) as Array<{
    listing_id: number | null
    n: number
    avg: number | null
    fresh: number
  }>
  const by = new Map(rows.map((r) => [r.listing_id, r]))
  const partial = !sync.backfill_complete
  return (id) => {
    const r = by.get(id)
    return r
      ? { count: r.n, avg: roundAvg(r.avg), fresh: r.fresh, partial }
      : { count: 0, avg: null, fresh: 0, partial }
  }
}

/**
 * Record review counts for one successful scan: a listing_review_stats row
 * for every active listing of the shop (0 included) and a shop_review_stats
 * row. Re-running (a manual sync after the scan) replaces them. Nothing is
 * written while the shop was never synced.
 */
export function writeReviewStats(db: Db, shopId: number, scanId: number, now: number): void {
  if (!db.prepare("SELECT 1 FROM scans WHERE id = ? AND status = 'ok'").get(scanId)) return
  const sync = getReviewSync(db, shopId)
  // Never synced (no reviews request has succeeded yet): nothing is known, write no zeros.
  if (!sync || sync.backfill_upper == null) return
  const complete = sync?.backfill_complete ? 1 : 0
  db.prepare('DELETE FROM listing_review_stats WHERE scan_id = ?').run(scanId)
  db.prepare(
    `INSERT INTO listing_review_stats (scan_id, listing_id, review_count, review_avg, new_count, complete)
     SELECT ?, l.listing_id, COUNT(r.id), ROUND(AVG(r.rating), 2),
       COALESCE(SUM(CASE WHEN r.origin = 'new' AND r.first_seen_scan_id = ? THEN 1 ELSE 0 END), 0), ?
     FROM listings l LEFT JOIN reviews r ON r.listing_id = l.listing_id AND r.shop_id = l.shop_id
     WHERE l.shop_id = ? AND l.removed_at IS NULL
     GROUP BY l.listing_id`
  ).run(scanId, scanId, complete, shopId)
  const t = reviewTotals(db, shopId)
  const fresh = db
    .prepare("SELECT COUNT(*) AS n FROM reviews WHERE shop_id = ? AND origin = 'new' AND first_seen_scan_id = ?")
    .get(shopId, scanId) as { n: number }
  db.prepare(
    `INSERT OR REPLACE INTO shop_review_stats (scan_id, shop_id, review_count, review_avg, new_count, complete, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(scanId, shopId, t.count, t.avg, fresh.n, complete, now)
}

/** What the shop header shows about the reviews; null = never tried (no run finished). */
export function reviewSyncInfo(db: Db, shopId: number): ReviewSyncInfo | null {
  const sync = getReviewSync(db, shopId)
  if (!sync) return null
  const t = reviewTotals(db, shopId)
  const latest = okScanIds(db, shopId, 1)[0] ?? -1
  const fresh = db
    .prepare("SELECT COUNT(*) AS n FROM reviews WHERE shop_id = ? AND origin = 'new' AND first_seen_scan_id = ?")
    .get(shopId, latest) as { n: number }
  return {
    synced: sync.backfill_upper != null,
    stored: t.count,
    average: t.avg,
    backfillComplete: !!sync.backfill_complete,
    estimate: sync.total_estimate,
    lastSyncedAt: sync.last_synced_at,
    lastError: sync.last_error,
    newCount: fresh.n,
    photos: reviewImageCounts(db, shopId)
  }
}

/** One listing's reviews, newest first, a page at a time. */
export function listListingReviews(db: Db, listingId: number, offset = 0, limit = 20): ReviewPage {
  const l = Math.trunc(limit)
  const lim = l > 0 ? Math.min(100, l) : 20
  // NaN/negative → 0; a huge or infinite one is an empty page (SQLite would
  // throw "datatype mismatch" for a non-integer-sized bound).
  const o = Math.trunc(offset)
  const off = o > 0 ? Math.min(o, Number.MAX_SAFE_INTEGER) : 0
  const total = db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE listing_id = ?').get(listingId) as { n: number }
  const rows = db
    .prepare(
      `SELECT * FROM reviews WHERE listing_id = ?
       ORDER BY created_timestamp DESC, id DESC LIMIT ? OFFSET ?`
    )
    .all(listingId, lim, off) as unknown as ReviewRow[]
  return { total: total.n, offset: off, reviews: rows.map(toReview) }
}

/**
 * Reviews first seen as new by a scan's sync (never backfilled ones), newest
 * first, with the reviewed listing's title and first photo when we store it.
 */
export function listNewReviews(db: Db, scanId: number, limit = 200): Review[] {
  const rows = db
    .prepare(
      `SELECT r.*, l.title AS listing_title,
         (SELECT i.listing_image_id FROM listing_images i
          WHERE i.listing_id = r.listing_id AND i.removed_at IS NULL
          ORDER BY i.rank, i.listing_image_id LIMIT 1) AS listing_image_id
       FROM reviews r LEFT JOIN listings l ON l.listing_id = r.listing_id
       WHERE r.first_seen_scan_id = ? AND r.origin = 'new'
       ORDER BY r.created_timestamp DESC, r.id DESC LIMIT ?`
    )
    .all(scanId, limit) as unknown as Array<ReviewRow & { listing_title: string | null; listing_image_id: number | null }>
  return rows.map(toReview)
}

/** The raw API object of one review. */
export function getReviewRaw(db: Db, id: number): string | null {
  const r = db.prepare('SELECT raw_json FROM reviews WHERE id = ?').get(id) as { raw_json: string } | undefined
  return r?.raw_json ?? null
}

// ------------------------------------------------------- review photo sync

const REVIEW_IMAGE_COLS =
  'id, review_key, shop_id, image_url_fullxfull, image_sync_status, image_sync_attempts, image_key'

export function getReviewImageRow(db: Db, id: number): ReviewImageRow | null {
  const r = db.prepare(`SELECT ${REVIEW_IMAGE_COLS} FROM reviews WHERE id = ?`).get(id)
  return (r as ReviewImageRow | undefined) ?? null
}

/** Review photos still to copy: 'pending', and 'error' with < maxAttempts tries (null = all). */
export function listReviewImagesToSync(
  db: Db,
  opts: { shopId?: number | null; maxAttempts?: number | null } = {}
): ReviewImageRow[] {
  const max = opts.maxAttempts === undefined ? 5 : opts.maxAttempts
  const params: SQLInputValue[] = []
  let where = "image_url_fullxfull IS NOT NULL AND (image_sync_status = 'pending' OR (image_sync_status = 'error'"
  if (max != null) {
    where += ' AND image_sync_attempts < ?'
    params.push(max)
  }
  where += '))'
  if (opts.shopId != null) {
    where += ' AND shop_id = ?'
    params.push(opts.shopId)
  }
  return db
    .prepare(`SELECT ${REVIEW_IMAGE_COLS} FROM reviews WHERE ${where} ORDER BY shop_id, id`)
    .all(...params) as unknown as ReviewImageRow[]
}

/** Review rows whose photo the API no longer returns but whose object still exists. */
export function listReviewImagesToCleanup(db: Db): ReviewImageRow[] {
  return db
    .prepare(`SELECT ${REVIEW_IMAGE_COLS} FROM reviews WHERE image_key IS NOT NULL AND image_url_fullxfull IS NULL`)
    .all() as unknown as ReviewImageRow[]
}

/** Stored review photos (verified on a forced sync). */
export function listStoredReviewImages(db: Db, shopId?: number | null): ReviewImageRow[] {
  return db
    .prepare(
      `SELECT ${REVIEW_IMAGE_COLS} FROM reviews WHERE image_sync_status = 'stored'
       ${shopId != null ? 'AND shop_id = ?' : ''} ORDER BY shop_id, id`
    )
    .all(...(shopId != null ? [shopId] : [])) as unknown as ReviewImageRow[]
}

export interface StoredReviewImageInfo {
  key: string
  byteSize: number
  contentType: string | null
  etag: string | null
  sha256: string
  storedAt: number
}

/** Record an upload — only if the row still has the URL that was downloaded. */
export function markReviewImageStored(db: Db, id: number, downloadedUrl: string, s: StoredReviewImageInfo): boolean {
  const r = db
    .prepare(
      `UPDATE reviews SET image_sync_status = 'stored', image_sync_error = NULL, image_stored_at = ?,
         image_key = ?, image_byte_size = ?, image_content_type = ?, image_etag = ?, image_sha256 = ?
       WHERE id = ? AND image_url_fullxfull = ? AND image_sync_status != 'stored'`
    )
    .run(s.storedAt, s.key, s.byteSize, s.contentType, s.etag, s.sha256, id, downloadedUrl)
  return Number(r.changes) > 0
}

export function markReviewImageError(db: Db, id: number, downloadedUrl: string, error: string): void {
  db.prepare(
    `UPDATE reviews SET image_sync_status = 'error', image_sync_error = ?, image_sync_attempts = image_sync_attempts + 1
     WHERE id = ? AND image_url_fullxfull = ?`
  ).run(error.slice(0, 500), id, downloadedUrl)
}

/** The object `key` was deleted: forget it (guarded by the key actually deleted). */
export function markReviewImageObjectDeleted(db: Db, id: number, key: string): void {
  db.prepare(
    `UPDATE reviews SET image_key = NULL, image_stored_at = NULL, image_etag = NULL,
       image_sync_status = CASE WHEN image_url_fullxfull IS NULL THEN NULL ELSE 'pending' END,
       image_sync_error = NULL, image_sync_attempts = 0
     WHERE id = ? AND image_key = ?`
  ).run(id, key)
}

/** A stored review photo is missing from MinIO: queue it again. */
export function markReviewImageMissing(db: Db, id: number): void {
  db.prepare(
    `UPDATE reviews SET image_key = NULL, image_stored_at = NULL, image_etag = NULL,
       image_sync_status = 'pending', image_sync_error = NULL, image_sync_attempts = 0
     WHERE id = ? AND image_sync_status = 'stored'`
  ).run(id)
}

/** Review photos of a shop by MinIO copy state. */
export function reviewImageCounts(db: Db, shopId?: number | null): ImageCounts {
  const rows = db
    .prepare(
      `SELECT image_sync_status AS s, COUNT(*) AS n FROM reviews
       WHERE image_url_fullxfull IS NOT NULL AND image_sync_status IS NOT NULL
       ${shopId != null ? 'AND shop_id = ?' : ''} GROUP BY image_sync_status`
    )
    .all(...(shopId != null ? [shopId] : [])) as Array<{ s: ImageSyncStatus; n: number }>
  const c: ImageCounts = { total: 0, stored: 0, pending: 0, error: 0 }
  for (const r of rows) {
    c[r.s] = r.n
    c.total += r.n
  }
  return c
}
