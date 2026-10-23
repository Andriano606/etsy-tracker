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

export type ImageSyncStatus = 'pending' | 'stored' | 'error'

/** Image sizes Etsy serves; the app stores `fullxfull` and `570xN` in MinIO. */
export type ImageSize = '75x75' | '170x135' | '570xN' | 'fullxfull'

/** One Etsy ListingImage (every OAS field) plus our MinIO sync state. */
export interface ListingImage {
  /** Etsy listing_image_id. */
  id: number
  rank: number
  url75: string
  url170: string
  url570: string
  urlFull: string
  width: number | null
  height: number | null
  alt: string | null
  hexCode?: string | null
  red?: number | null
  green?: number | null
  blue?: number | null
  hue?: number | null
  saturation?: number | null
  brightness?: number | null
  isBlackAndWhite?: boolean | null
  /** Etsy created_timestamp, epoch seconds. */
  createdAt?: number | null
  /** MinIO copy state (absent on records that were never stored in the DB). */
  syncStatus?: ImageSyncStatus
  storedAt?: number | null
}

/** One Etsy ListingVideo (metadata only — videos are not copied to MinIO). */
export interface ListingVideo {
  id: number
  width: number | null
  height: number | null
  thumbnailUrl: string | null
  videoUrl: string | null
  state: string | null
}

/** One personalization question (Etsy `includes=Personalization`). */
export interface PersonalizationQuestion {
  questionId: number | null
  text: string
  instructions: string | null
  type: string | null
  required: boolean
  maxChars: number | null
  maxFiles: number | null
  options: string[]
}

/**
 * The content fields of a listing beyond title/price/description/tags — every
 * useful scalar of the OAS ShopListingWithAssociations (the whole response is
 * also kept as raw JSON).
 */
export interface ListingDetails {
  userId: number | null
  shopSectionId: number | null
  taxonomyId: number | null
  /** physical | download | both */
  listingType: string | null
  whoMade: string | null
  whenMade: string | null
  isSupply: boolean | null
  materials: string[]
  styles: string[]
  skus: string[]
  processingMin: number | null
  processingMax: number | null
  isCustomizable: boolean | null
  isPersonalizable: boolean | null
  /** null = not fetched (no `includes=Personalization` data). */
  personalization: PersonalizationQuestion[] | null
  hasVariations: boolean | null
  isPrivate: boolean | null
  isTaxable: boolean | null
  nonTaxable: boolean | null
  shouldAutoRenew: boolean | null
  fileData: string | null
  language: string | null
  shippingProfileId: number | null
  returnPolicyId: number | null
  readinessStateId: number | null
  itemWeight: number | null
  itemWeightUnit: string | null
  itemLength: number | null
  itemWidth: number | null
  itemHeight: number | null
  itemDimensionsUnit: string | null
  /** Etsy epoch seconds. */
  originalCreatedAt: number | null
  endingAt: number | null
  stateAt: number | null
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
  /** Active images ordered by rank (from the listing_images table). */
  images: ListingImage[]
  /** Our own bookkeeping, epoch ms. */
  firstSeenAt: number
  lastSeenAt: number
  removedAt: number | null
  /** Etsy listing state (active, sold_out, …); null for rows from before schema v2. */
  state?: string | null
  /** Popularity, as of the latest scan (views is tabulated by Etsy once a day). */
  views?: number | null
  numFavorers?: number | null
  /** Position among the shop's featured listings (≥ 1), else null/≤ 0. */
  featuredRank?: number | null
  /** Growth since the previous successful scan (null = no previous value). */
  favorersDelta?: number | null
  viewsDelta?: number | null
  /** Extra content fields; null for rows never fetched with schema v2. */
  details?: ListingDetails | null
  videos?: ListingVideo[]
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

/**
 * Snapshot of the fields a 'changed' row tracks. Only changed fields are
 * present (a field whose new value is empty/none is present with null).
 * Popularity (views, favorers, featured rank) and stock (quantity) are NOT
 * changes — they go to listing_stats.
 */
export interface TrackedFields {
  title?: string
  priceAmount?: number
  priceDivisor?: number
  currency?: string
  /** Possibly shortened (see DESCRIPTION_EXCERPT in scanner.ts). */
  description?: string
  tags?: string[]
  materials?: string[]
  styles?: string[]
  /** listing_image_ids in rank order. */
  images?: number[]
  /** video ids. */
  videos?: number[]
  whoMade?: string | null
  whenMade?: string | null
  taxonomyId?: number | null
  shopSectionId?: number | null
  listingType?: string | null
  processingMin?: number | null
  processingMax?: number | null
  isPersonalizable?: boolean | null
  isCustomizable?: boolean | null
  hasVariations?: boolean | null
  personalization?: PersonalizationQuestion[] | null
  /** Weight + dimensions + units, as one group. */
  dimensions?: string | null
}

/** Which TrackedFields group a key belongs to (for "що змінилось"). */
export type ChangedField =
  | 'title'
  | 'price'
  | 'description'
  | 'tags'
  | 'materials'
  | 'styles'
  | 'images'
  | 'videos'
  | 'whoMade'
  | 'whenMade'
  | 'taxonomyId'
  | 'shopSectionId'
  | 'listingType'
  | 'processing'
  | 'isPersonalizable'
  | 'isCustomizable'
  | 'hasVariations'
  | 'personalization'
  | 'dimensions'

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

export interface ShopPolicies {
  welcome: string | null
  payment: string | null
  shipping: string | null
  refunds: string | null
  additional: string | null
  sellerInfo: string | null
  privacy: string | null
  /** Etsy epoch seconds. */
  updatedAt: number | null
}

/** Etsy-side shop info beyond the basics (OAS `Shop`). */
export interface ShopProfile {
  userId: number | null
  loginName: string | null
  announcement: string | null
  saleMessage: string | null
  digitalSaleMessage: string | null
  isVacation: boolean | null
  vacationMessage: string | null
  vacationAutoreply: string | null
  numFavorers: number | null
  transactionSoldCount: number | null
  reviewCount: number | null
  reviewAverage: number | null
  digitalListingCount: number | null
  acceptsCustomRequests: boolean | null
  languages: string[]
  countryIso: string | null
  shippingFromCountryIso: string | null
  bannerUrl: string | null
  policies: ShopPolicies
  /** Etsy epoch seconds. */
  etsyCreatedAt: number | null
  etsyUpdatedAt: number | null
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
  /** Full Etsy shop info; null/absent until read with schema v2. */
  profile?: ShopProfile | null
}

/** Shop popularity numbers recorded per successful scan (shop_stats). */
export interface ShopStats {
  numFavorers: number | null
  transactionSoldCount: number | null
  reviewCount: number | null
  reviewAverage: number | null
  listingActiveCount: number | null
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
  /** Stats recorded by the latest successful scan. */
  stats?: ShopStats | null
  /** latest − previous successful scan, per field (null where unknown). */
  statsDelta?: ShopStats | null
}

/** Per-shop counts of active listing images by MinIO sync state. */
export interface ImageCounts {
  total: number
  stored: number
  pending: number
  error: number
}

/** The background image-sync loop, pushed as `images:progress`. */
export interface ImageSyncState {
  running: boolean
  /** Shop being synced (null = all shops). */
  shopId: number | null
  done: number
  total: number
  errors: number
  /** Why the last run stopped early (MinIO unreachable, …), or null. */
  lastError: string | null
  /** MinIO is switched off in Settings. */
  disabled: boolean
}

/** What the renderer may know about the MinIO settings — never the secret key. */
export interface MinioStatus {
  enabled: boolean
  endpoint: string
  accessKey: string
  bucket: string
  /** 'default' = the docker-compose default secret is used; 'stored' = user-entered. */
  secretSource: 'default' | 'stored'
  /** The stored secret is protected by a real OS keyring. */
  encrypted: boolean
  /** A stored secret could not be decrypted — enter it again. */
  unreadable?: boolean
}

export interface MinioSettingsInput {
  enabled?: boolean
  endpoint?: string
  accessKey?: string
  /** Empty/undefined = keep the stored secret. */
  secretKey?: string
  bucket?: string
}

export interface MinioTestResult {
  ok: boolean
  message: string
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

/** One listing's popularity at one successful scan (`listing:stats`). */
export interface ListingStatsPoint {
  scanId: number
  /** When that scan finished (ms). */
  at: number | null
  views: number | null
  numFavorers: number | null
  featuredRank: number | null
  quantity: number | null
}
