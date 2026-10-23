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

/** An Etsy `Money` without its currency (kept once per price set): value = amount / divisor. */
export interface MoneyValue {
  amount: number
  divisor: number
}

/**
 * The buyer-facing price of a listing for one buyer country (OAS
 * `ListingBuyerPrice`, `includes=BuyerPrice` + `buyer_country` on
 * /listings/batch): VAT included, UK shipping included, active promotion
 * applied. The seller's own price (`Listing.priceAmount`) has none of these.
 */
export interface BuyerPrice {
  /** ISO 3166-1 alpha-2 country the price was computed for. */
  country: string
  /** currency_code of the price set (original_price, else base_price). */
  currency: string
  /** base_price: pre-discount price with VAT, excluding shipping. */
  base: MoneyValue | null
  /** original_price: the display price (UK: base + shipping; elsewhere = base). */
  original: MoneyValue | null
  /** discounted_price: the sale price; null without an active promotion. */
  discounted: MoneyValue | null
  /** discount_amount = original − discounted; null without a promotion. */
  discountAmount: MoneyValue | null
  /** e.g. 60 for 60 % off; null without a promotion or for a fixed-amount discount. */
  discountPercentage: number | null
  hasDiscount: boolean
  /** Active promotion's start/end, Etsy epoch seconds. */
  discountStart: number | null
  discountEnd: number | null
  /** shipping_cost to that country (VAT incl.); null = free or unavailable. */
  shipping: MoneyValue | null
  isFreeShipping: boolean | null
  /** When this price was learned (our epoch ms). */
  fetchedAt?: number | null
}

/** How a stored promotion was first seen. */
export type PromotionStartKind =
  /** A previous scan saw the listing without it (same buyer country) — it started in between. */
  | 'seen'
  /** Already running at the listing's first known buyer price (baseline, new or returned listing, first v4 scan, after the price was unknown). */
  | 'running'
  /** Appeared together with a change of the buyer country — may be the country, not the seller. */
  | 'country'

/** Why a stored promotion is over. */
export type PromotionEndReason =
  /** A scan saw the listing without a discount (same buyer country). */
  | 'ended'
  /** A different promotion replaced it. */
  | 'replaced'
  /** Gone together with a change of the buyer country — may be the country, not the seller. */
  | 'country'
  /** The listing disappeared from the shop while it ran — when the sale itself ended is unknown. */
  | 'removed'
  /**
   * Over at a scan with no previous observation (the buyer price was unknown
   * in between, or the listing came back): it ended at some unknown earlier time.
   */
  | 'unknown'

/** One promotion (sale / discount) of a listing as tracked across scans (`promotions`). */
export interface Promotion {
  id: number
  listingId: number
  shopId: number
  /** Buyer country of its latest observation. */
  country: string
  currency: string | null
  discountPercentage: number | null
  /** Etsy's discount_start_epoch / discount_end_epoch (seconds). */
  discountStart: number | null
  discountEnd: number | null
  original: MoneyValue | null
  discounted: MoneyValue | null
  discountAmount: MoneyValue | null
  startKind: PromotionStartKind
  startedScanId: number | null
  /** Our epoch ms: first / latest scan that saw it. */
  firstSeenAt: number
  lastSeenAt: number
  /** null = still running at the latest observation. */
  endedScanId: number | null
  endedAt: number | null
  endReason: PromotionEndReason | null
  /** For the scan results: the listing as we store it. */
  listingTitle?: string | null
  listingImageId?: number | null
}

/** Promotions that started / ended with one scan (the "Акції" group). */
export interface ScanPromotions {
  started: Promotion[]
  ended: Promotion[]
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
  /**
   * Reviews stored for this listing (all time, from the shop's review sync);
   * null = the shop's reviews were never synced. While the shop's backfill is
   * incomplete the count is a lower bound (`reviewsPartial`).
   */
  reviewCount?: number | null
  /** Average rating of the stored reviews (1–5), null when none. */
  reviewAvg?: number | null
  /** Reviews first seen as new (not backfilled) by the latest successful scan's sync. */
  reviewsNew?: number | null
  /** The shop's review history is not fully loaded yet: counts are "≥". */
  reviewsPartial?: boolean
  /**
   * The buyer-facing price (VAT, promotion) from the latest scan that learned
   * it; null/absent = unknown (never fetched, or Etsy refused `BuyerPrice`).
   */
  buyerPrice?: BuyerPrice | null
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
  /** Buyer country the scan asked buyer prices for (null = none / before schema v4). */
  buyerCountry?: string | null
  /** 'ok' = buyer prices requested and served; 'unavailable' = Etsy refused `BuyerPrice` for that country, or no details answer carried `buyer_price`. */
  buyerPrices?: 'ok' | 'unavailable' | null
  /** Promotions this scan saw start / end (see `PromotionStartKind`/`PromotionEndReason`). */
  promotionsStarted?: number
  promotionsEnded?: number
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
  /** What we have stored of the shop's reviews; null = never synced. */
  reviews?: ReviewSyncInfo | null
}

/** How a stored review was first found. */
export type ReviewOrigin = 'backfill' | 'new'

/** One Etsy TransactionReview as stored (GET /shops/{id}/reviews). */
export interface Review {
  /** Our row id (used by etsyimg://review/{id}/fullxfull). */
  id: number
  /** Natural key: `t-{transaction_id}`, else `x-{listing_id}-{buyer_user_id|0}-{created}`. */
  key: string
  shopId: number
  listingId: number | null
  transactionId: number | null
  buyerUserId: number | null
  /** 1–5. */
  rating: number | null
  /** Plain text (entities decoded); null/'' when the buyer wrote none. */
  text: string | null
  language: string | null
  /** The buyer attached a photo (and the API returned it). */
  hasImage: boolean
  /** MinIO copy state of the photo; null without a photo. */
  imageStatus: ImageSyncStatus | null
  /** Etsy epoch seconds. */
  createdAt: number | null
  updatedAt: number | null
  /** Our bookkeeping, epoch ms. */
  firstSeenAt: number
  firstSeenScanId: number | null
  origin: ReviewOrigin
  /** For the "Нові відгуки" panel: the reviewed listing as we store it. */
  listingTitle?: string | null
  listingImageId?: number | null
}

/** One page of a listing's reviews (`reviews:listing`), newest first. */
export interface ReviewPage {
  total: number
  offset: number
  reviews: Review[]
}

/** The shop's review sync as stored (`review_sync` + counts). */
export interface ReviewSyncInfo {
  /**
   * A reviews request has succeeded at least once (the backfill started). False
   * = only failed runs so far (e.g. 403): nothing is known about the reviews.
   */
  synced: boolean
  /** Reviews stored for the shop. */
  stored: number
  /** Average rating of the stored reviews. */
  average: number | null
  /** The whole history has been read (else counts are a lower bound). */
  backfillComplete: boolean
  /** Etsy's `count` of the shop's reviews when the backfill started (≈ total). */
  estimate: number | null
  /** Epoch ms of the last sync run that finished. */
  lastSyncedAt: number | null
  /** Why the last run failed/stopped, or null. */
  lastError: string | null
  /** Reviews first seen as new by the latest successful scan's sync. */
  newCount: number
  /** MinIO copy state of the review photos. */
  photos: ImageCounts
}

/** A review sync run in progress or just finished (`reviews:progress`). */
export interface ReviewSyncState {
  shopId: number
  running: boolean
  phase: 'backfill' | 'incremental' | null
  /** Reviews stored for the shop now. */
  stored: number
  estimate: number | null
  /** API requests made by this run. */
  requests: number
  /** Reviews first seen as new by this run. */
  newReviews: number
  backfillComplete: boolean
  /** The run stopped at its request budget / the daily-quota reserve; it continues next time. */
  budgetExhausted: boolean
  error: string | null
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

/** Answer of `buyerCountry:set`. */
export type BuyerCountryResult = { ok: true; country: string } | { ok: false; error: string }

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
  /** Reviews stored for the listing when that scan's review sync ran (null = not synced). */
  reviewCount?: number | null
  reviewAvg?: number | null
  /** false = the shop's history was still being backfilled: reviewCount is "≥". */
  reviewsComplete?: boolean | null
  /** The seller's base price at that scan (listing_price_stats; absent before schema v4). */
  price?: (MoneyValue & { currency: string }) | null
  /** The buyer price that scan learned (null = unknown at that scan). */
  buyerPrice?: BuyerPrice | null
}

// ------------------------------------------------------------ statistics view

/** The period the Statistics view covers ("Усе" / 90 / 30 / 7 днів). */
export type StatsRange = 'all' | '90d' | '30d' | '7d'

export const STATS_RANGES: readonly StatsRange[] = ['all', '90d', '30d', '7d']

/** One successful scan in the period, with what was recorded for it. */
export interface StatsScanPoint {
  scanId: number
  /** When the scan finished (ms). */
  at: number
  isBaseline: boolean
  truncated: boolean
  total: number
  added: number
  removed: number
  changed: number
  returned: number
  /** shop_stats of that scan; all null when the scan has none (scans before schema v2). */
  numFavorers: number | null
  transactionSoldCount: number | null
  reviewCount: number | null
  reviewAverage: number | null
  listingActiveCount: number | null
  /** Sums over that scan's listing_stats rows; null when it has none. */
  listingViews: number | null
  listingFavorers: number | null
  /**
   * Listings with an active discount at that scan, among those whose buyer
   * price it learned; null when it learned none (before schema v4, or Etsy
   * refused BuyerPrice).
   */
  discounted?: number | null
  /** Listings whose buyer price that scan learned (null = none). */
  buyerPriced?: number | null
}

/** latest − earlier between two consecutive successful scans of the period (the anchor included). */
export interface StatsInterval {
  fromScanId: number
  toScanId: number
  /** ms */
  from: number
  to: number
  days: number
  sold: number | null
  favorers: number | null
  reviews: number | null
  views: number | null
}

/**
 * Sales per day over an interval of at least `STATS_MIN_RATE_MS` (shorter gaps
 * between scans are merged with the next one — a sale or two within minutes
 * would read as hundreds a day). Derived: Δ transaction_sold_count / days.
 */
export interface StatsSalesRate {
  fromScanId: number
  toScanId: number
  from: number
  to: number
  days: number
  sold: number
  perDay: number
}

/** Reviews created in one calendar week / month (UTC), from the reviews table. */
export interface StatsReviewBucket {
  /** Start of the bucket, Etsy epoch seconds (Monday 00:00 UTC / the 1st 00:00 UTC). */
  start: number
  /** Exclusive end, seconds. */
  end: number
  count: number
  /** Average rating of those reviews; null when there are none. */
  avg: number | null
  /** Counts by rating 1..5 (index 0 = 1★). */
  ratings: [number, number, number, number, number]
  /** The bucket reaches past "now" or starts before the period: not a full week/month. */
  partial: boolean
}

/** One row of a "Топ товарів за ростом" table. */
export interface StatsTopRow {
  listingId: number
  title: string
  /** First active image (etsyimg://img/{id}/…); null when none is stored. */
  imageId: number | null
  /** The value at the first and last point the delta is taken over (null = unknown). */
  start: number | null
  end: number | null
  delta: number
  /** The values the sparkline draws, oldest first (per scan — at `StatsTop.seriesAt` — or reviews per equal time slice). */
  series: Array<number | null>
  /** The listing is in our `listings` table (else the title is "Товар #id" and it can't be opened). */
  stored: boolean
}

export interface StatsTop {
  /** The scans the views/favorers deltas compare (first and last of the period with listing_stats). */
  fromScanId: number | null
  toScanId: number | null
  fromAt: number | null
  toAt: number | null
  /** When each views/favorers sparkline point was taken (ms; the scans with listing_stats, oldest first). */
  seriesAt: number[]
  views: StatsTopRow[]
  favorers: StatsTopRow[]
  /** Reviews created in the period (the reviews table), most first. */
  reviews: StatsTopRow[]
}

/** Everything the Statistics view draws, computed in main (`stats:shop`). */
export interface ShopStatsPayload {
  shopId: number
  range: StatsRange
  /** Start of the period (ms); null for "Усе". */
  from: number | null
  /** "Now" when it was computed (ms). */
  to: number
  /** Successful scans of the period, oldest first (error/running scans are never included). */
  scans: StatsScanPoint[]
  /**
   * The latest successful scan before the period (null for "Усе" or when the
   * period has no scan): the starting point of the period's deltas, intervals,
   * sales/day and top growth, and the left end of the scan lines.
   */
  anchor: StatsScanPoint | null
  /** Between consecutive scans, the anchor first. */
  intervals: StatsInterval[]
  salesRate: StatsSalesRate[]
  reviews: {
    /** false while the shop's reviews were never synced (no buckets then). */
    synced: boolean
    /** false while the history is still being backfilled (counts are lower bounds). */
    complete: boolean
    /** Reviews created in the period and their average rating. */
    total: number
    avg: number | null
    weeks: StatsReviewBucket[]
    months: StatsReviewBucket[]
  }
  top: StatsTop
}

/** The local MCP server (Settings → "MCP"): its settings plus whether it runs. */
export interface McpStatus {
  enabled: boolean
  /** MCP clients may change the user's own store (create/edit listings, store texts). */
  allowWrites: boolean
  port: number
  /** http://127.0.0.1:{port}/mcp */
  url: string
  /** The bearer token clients send; null until the server was first enabled. */
  token: string | null
  /** The token is protected by a real OS keyring in settings.json. */
  tokenEncrypted: boolean
  /** Listening right now. */
  running: boolean
  /** Why it is not running although enabled (port busy, …), else null. */
  error: string | null
  /** Authorized requests since the app started. */
  requests: number
  /** Epoch ms of the latest authorized request. */
  lastRequestAt: number | null
  /** `clientInfo.name` of the latest client that initialized a session (e.g. "claude-code"). */
  lastClient: string | null
}

export interface McpSettingsInput {
  enabled?: boolean
  allowWrites?: boolean
  port?: number | string
}

/** Signed in to Etsy (OAuth) to edit the user's own shop — never the tokens themselves. */
export interface EtsyAuthStatus {
  loggedIn: boolean
  /** The redirect URI used for sign-in (must equal one registered for the app on Etsy). */
  redirectUri: string
  /** A sign-in was started and waits for the pasted redirect URL. */
  pending: boolean
  /** The stored tokens are protected by a real OS keyring. */
  encrypted: boolean
  /** Stored tokens could not be decrypted — sign in again. */
  unreadable?: boolean
  userId?: number
  shopId?: number | null
  shopName?: string | null
  scopes?: string[]
  /** Epoch ms. */
  signedInAt?: number
  /** Epoch ms: the refresh token runs out (90 days after it was issued) — sign in again by then. */
  reloginBy?: number
}

/** A listing's state on Etsy (getListingsByShop `state`). */
export type MyListingState = 'active' | 'inactive' | 'draft' | 'expired' | 'sold_out'

/** One listing of the signed-in user's own shop (any state), as the editor needs it. */
export interface MyListing {
  listingId: number
  state: string
  title: string
  description: string
  tags: string[]
  materials: string[]
  shouldAutoRenew: boolean | null
  /** listing_type: physical | download | both */
  type: string | null
  priceAmount: number | null
  priceDivisor: number | null
  currency: string | null
  quantity: number | null
  url: string | null
  /** First image, 170x135 on the Etsy CDN (CSP allows i.etsystatic.com); null when none / not a CDN URL. */
  imageUrl: string | null
  /** Etsy epoch seconds. */
  updatedAt: number | null
  endingAt: number | null
}

export interface MyListingsPage {
  state: MyListingState
  total: number
  offset: number
  listings: MyListing[]
}

/** The fields the editor can change (updateListing); absent = unchanged. */
export interface MyListingPatch {
  title?: string
  description?: string
  tags?: string[]
  materials?: string[]
  shouldAutoRenew?: boolean
  state?: 'active' | 'inactive'
}

/** The editable texts of the user's shop (updateShop). */
export interface MyShopProfile {
  shopId: number
  shopName: string
  title: string
  announcement: string
  saleMessage: string
  digitalSaleMessage: string
  policyAdditional: string
  /** Etsy says policy_additional may only be set for shops in the EU. */
  inEu: boolean
  countryIso: string | null
}

export type MyShopPatch = Partial<
  Pick<MyShopProfile, 'title' | 'announcement' | 'saleMessage' | 'digitalSaleMessage' | 'policyAdditional'>
>

export type MyShopResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** A file the user picked in the native dialog: main keeps the path, the renderer only the token. */
export interface PickedFile {
  token: string
  name: string
  size: number
}

/** "Новий лістинг": everything createDraftListing needs, plus the uploads. */
export interface NewListingInput {
  /** download = a digital product (files delivered by Etsy); physical needs a shipping profile. */
  type: 'download' | 'physical'
  title: string
  description: string
  /** In the shop's currency, e.g. "5.99" (Etsy takes a decimal). */
  price: string
  quantity: number
  taxonomyId: number | null
  whoMade: string
  whenMade: string
  isSupply: boolean
  tags: string[]
  materials: string[]
  shouldAutoRenew: boolean
  shippingProfileId: number | null
  readinessStateId: number | null
  /** PickedFile tokens, in display order (the first is the main photo). */
  images: string[]
  /** Digital files (PickedFile tokens). */
  files: string[]
  /** Publish right away (Etsy's $0.20 fee) instead of leaving a draft. */
  publish: boolean
}

export interface CreateListingProgress {
  step: 'draft' | 'images' | 'files' | 'publish'
  done: number
  total: number
  label: string
}

/**
 * Creating a listing is several Etsy calls: once the draft exists, a later
 * failure still returns its id so the user can finish it in the editor.
 */
export type CreateListingResult =
  | { ok: true; listingId: number; published: boolean; warnings: string[] }
  | { ok: false; error: string; listingId?: number }

export interface TaxonomyOption {
  id: number
  /** "Paper & Party Supplies › Paper › Calendars & Planners" */
  path: string
}

export interface ShippingOption {
  id: number
  label: string
}

/** A listing draft's texts and settings as kept in the app (everything but the media). */
export interface DraftFields {
  type: 'download' | 'physical'
  title: string
  description: string
  /** As typed, e.g. "5.99". */
  price: string
  quantity: number
  taxonomyId: number | null
  /** The chosen category's "A › B › C" path, for display. */
  taxonomyPath: string | null
  whoMade: string
  whenMade: string
  isSupply: boolean
  tags: string[]
  materials: string[]
  shouldAutoRenew: boolean
  shippingProfileId: number | null
  readinessStateId: number | null
}

/** A photo or buyer file stored with a draft (photos show via etsyimg://draft/{id}). */
export interface DraftMedia {
  id: number
  kind: 'photo' | 'file'
  position: number
  name: string
  mime: string
  size: number
}

/** A listing prepared in the app (by the user or by Claude over MCP), reviewed before sending. */
export interface ListingDraft {
  id: number
  source: 'app' | 'mcp'
  /** draft = not sent; sent = the listing exists on Etsy; error = the last send failed. */
  status: 'draft' | 'sent' | 'error'
  fields: DraftFields
  photos: DraftMedia[]
  files: DraftMedia[]
  createdAt: number
  updatedAt: number
  sentAt: number | null
  sentListingId: number | null
  sentPublished: boolean | null
  lastError: string | null
  /** What still blocks sending it as an Etsy draft (empty = ready). */
  problems: string[]
}

/** A media slot when saving a draft: one already stored, or a freshly picked file. */
export type DraftMediaRef = { mediaId: number } | { token: string }

export interface SaveDraftInput {
  /** Absent = a new draft. */
  id?: number
  fields: DraftFields
  /** The full list in order (stored ones not listed are removed). */
  photos: DraftMediaRef[]
  files: DraftMediaRef[]
}
