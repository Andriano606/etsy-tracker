// Types shared by main, preload and renderer (renderer imports via `@shared`).

/** What the renderer may know about the stored Etsy API key — never the key itself. */
export interface KeyStatus {
  hasKey: boolean
  /** Keystring shortened to `abcd…wxyz` (the shared secret is never shown). */
  masked: string | null
  /** true = stored via Electron safeStorage with a real OS keyring backend. */
  encrypted: boolean
  /**
   * A key is stored but could not be decrypted (OS keyring locked, unavailable
   * or changed) — `hasKey` is false and the user must enter the key again.
   */
  unreadable?: boolean
}

export interface KeyTestResult {
  ok: boolean
  message: string
  applicationId?: number
}

/** Rate-limit headers from the latest Etsy response (null = header absent). */
export interface Quota {
  limitPerDay: number | null
  remainingToday: number | null
  limitPerSecond: number | null
  remainingThisSecond: number | null
  /** Epoch ms when these numbers were read. */
  at: number
}

export interface ListingImage {
  id: number
  rank: number
  url75: string
  url170: string
  url570: string
  urlFull: string
  width: number | null
  height: number | null
  alt: string | null
}

/** One listing as stored in the DB and shown in the UI. */
export interface Listing {
  listingId: number
  shopId: number
  title: string
  description: string
  /** Money exactly as Etsy sends it: value = priceAmount / priceDivisor. */
  priceAmount: number
  priceDivisor: number
  currency: string
  url: string
  tags: string[]
  quantity: number
  /** Etsy timestamps, epoch seconds. */
  etsyCreatedAt: number | null
  etsyUpdatedAt: number | null
  images: ListingImage[]
  /** Our own bookkeeping, epoch ms. */
  firstSeenAt: number
  lastSeenAt: number
  removedAt: number | null
}

export type ScanStatus = 'running' | 'ok' | 'error'

export interface ScanSummary {
  id: number
  shopId: number
  startedAt: number
  finishedAt: number | null
  status: ScanStatus
  error: string | null
  isBaseline: boolean
  /** Active listings seen by this scan. */
  total: number
  added: number
  removed: number
  changed: number
  returned: number
  /** The listing set was capped by Etsy's offset limit, so removals were not detected. */
  truncated: boolean
}

export type ChangeKind = 'added' | 'removed' | 'changed' | 'returned'

/** Snapshot of the fields a 'changed' row tracks. Only changed fields are present. */
export interface TrackedFields {
  title?: string
  priceAmount?: number
  priceDivisor?: number
  currency?: string
}

export interface ScanChange {
  id: number
  scanId: number
  listingId: number
  kind: ChangeKind
  oldValue: TrackedFields | null
  newValue: TrackedFields | null
  /** The listing as it is stored now (null if it was somehow deleted). */
  listing: Listing | null
}

export interface Shop {
  /** Etsy shop_id. */
  id: number
  shopName: string
  title: string | null
  url: string
  iconUrl: string | null
  currency: string | null
  /** listing_active_count reported by Etsy when the shop was added/last scanned. */
  etsyActiveCount: number
  addedAt: number
}

/** A shop plus the derived numbers the sidebar and header need. */
export interface ShopSummary extends Shop {
  /** Active listings in our DB. */
  activeCount: number
  /** Latest successful scan (null = never scanned). */
  lastOkScan: ScanSummary | null
  /** Latest scan of any status (shows a failed rescan on top of older results). */
  lastScan: ScanSummary | null
  /** Listings added by the latest successful scan (0 for a baseline). */
  newCount: number
}

export interface ScanProgress {
  shopId: number
  phase: 'pages' | 'details' | 'verify' | 'saving'
  done: number
  total: number
  label: string
}

export type ScanOutcome =
  | { ok: true; shopId: number; scan: ScanSummary }
  | { ok: false; shopId: number; error: string; busy?: boolean }

export type AddShopResult = { ok: true; shop: ShopSummary } | { ok: false; error: string }
