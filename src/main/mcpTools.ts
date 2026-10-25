// The "etsy-tracker" MCP server's core tools over the app's local database:
// the Etsy shops the user tracks, as of their latest scans. The JSON keys keep
// their original names — "store" = an Etsy shop, "product" = a listing,
// "snapshot" = a scan, "discount" = an Etsy sale/promotion, "customer price" =
// Etsy's buyer price, "favorites" = favorers. Text from the data goes out
// exactly as stored (Etsy's text, HTML entities decoded); the Etsy page URLs of shops and
// listings go out as `url`. Never sent: raw API JSON (raw_json), tokens/keys,
// CDN image URLs (photos go out as MCP image content). tests/main/mcpTools.test.ts
// checks all of that over every tool.

import type {
  BuyerPrice,
  DraftPullSummary,
  Listing,
  ListingDetails,
  ListingImage,
  ListingMark,
  MoneyValue,
  MyShopResult,
  Promotion,
  PromotionEndReason,
  PromotionStartKind,
  Review,
  ScanSummary,
  ShopStats,
  ShopSummary,
  StatsRange,
  StatsReviewBucket,
  StatsScanPoint,
  StatsTopRow,
  TrackedFields
} from '../shared/types'
import { STATS_RANGES } from '../shared/types'
import { priceValue } from '../shared/format'
import { filterListings, type SortMode } from '../shared/listingFilter'
import { discountPercent, hasActiveDiscount, shownPrice } from '../shared/price'
import { MCP_SERVER_NAME } from '../shared/mcpConfig'
import { isAllowedExternalUrl, isEtsyCdnUrl } from '../shared/externalUrl'
import { type ClaudeRef, hasEtsyShortLink, parseClaudeRef, photoRef } from '../shared/claudeRef'
import { decodeHtmlEntities } from '../shared/html'
import { MARK_NOTE_MAX, isMarkFilter, isMarkStatus } from '../shared/marks'
import {
  type Db,
  getListing,
  getScan,
  getShopSummary,
  listActiveListings,
  listAllListings,
  listListingPromotions,
  listListingStats,
  listMarkedListings,
  listNewReviews,
  listScanChanges,
  listScanPromotions,
  listScans,
  listShopSummaries,
  setListingMark
} from './db'
import { EtsyApiError, type EtsyClient } from './etsyApi'
import { type McpServerInfo, type McpTool, type McpToolResult, ToolInputError, errorResult, textResult } from './mcpProtocol'
import { shopStatsPayload } from './shopStats'
import { type OwnStoreDeps, createDraftTools, createStoreTools, draftOut, mcpErrorText } from './mcpStoreTools'
import { getDraft } from './drafts'
import { featureMcpTools } from './features'
import { listingVideo } from './features/compete/api'
import { byImageRank, optInt, optText, toImage, toListingRow } from './features/compete/map'

export interface McpToolDeps {
  db: Db
  now?: () => number
  /**
   * Bytes of an app image URL (`etsyimg://img/{id}/{size}`, `etsyimg://review/{id}/fullxfull`)
   * — the image protocol handler in the app; null = not available.
   */
  readImage?: (url: string) => Promise<{ data: Buffer; mimeType: string } | null>
  /**
   * Bytes of an Etsy CDN image URL (https *.etsystatic.com only — the caller
   * checks isEtsyCdnUrl first): open_link's live photos of listings the app
   * doesn't store. index.ts: downloadImage over the app's CDN fetch. null /
   * a throw = not available.
   */
  fetchCdnImage?: (url: string) => Promise<{ data: Buffer; mimeType: string } | null>
  /** The user's own store (signed in in the app): the store tools; absent = not available. */
  own?: OwnStoreDeps
  /**
   * Whether an Etsy API key is saved (index.ts: the key store). open_link reads
   * Etsy live only with one; false = answer from the database or refuse without
   * a request. Absent = assume a key whenever `own.client` exists.
   */
  hasApiKey?: () => boolean
  /** Drafts kept in the app changed (prepare_product …): tell the renderer. */
  onDraftsChanged?: () => void
  /** Listing marks changed (set_product_mark, a published draft completing its example's mark): tell the renderer. */
  onMarksChanged?: (listingIds: number[]) => void
  /**
   * The app's own Etsy-drafts pull (ipc.ts pullEtsyDrafts: one at a time, shared
   * with the scan-time pull, pushes the drafts window's progress). Absent:
   * sync_prepared_products pulls directly.
   */
  pullDrafts?: () => Promise<MyShopResult<DraftPullSummary>>
}

/** Larger images are refused (base64 in a model's context). */
export const MCP_MAX_IMAGE_BYTES = 5 * 1024 * 1024
const TOO_LARGE = 'The image is larger than 5 MB and cannot be returned.'

/**
 * Image types MCP clients (Claude) can show. Etsy's CDN negotiates the format
 * with Chromium's Accept header, so some stored 570xN copies are AVIF — those
 * are skipped for the original (always JPEG) instead of being sent unreadable.
 */
export const MCP_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

/** `image/JPEG; charset=…` → `image/jpeg` (and the non-standard `image/jpg`). */
export function imageMime(contentType: string): string {
  const t = contentType.split(';')[0].trim().toLowerCase()
  return t === 'image/jpg' ? 'image/jpeg' : t
}

// ------------------------------------------------------------- output shapes

const list = (a: readonly string[] | null | undefined): string[] => [...(a ?? [])]
const isoSec = (s: number | null | undefined): string | null => (s == null ? null : new Date(s * 1000).toISOString())
const isoMs = (ms: number | null | undefined): string | null => (ms == null ? null : new Date(ms).toISOString())
const val = (m: MoneyValue | null | undefined): number | null => (m ? priceValue(m.amount, m.divisor) : null)
const featured = (r: number | null | undefined): number | null => (r != null && r >= 1 ? r : null)
const productType = (t: string | null | undefined): string | null => (t === 'download' ? 'digital' : (t ?? null))
/** A stored shop/listing page URL, only when it is an https etsy.com page. */
const pageUrl = (u: string | null | undefined): string | null => (u && isAllowedExternalUrl(u) ? u : null)

/** ISO date/time argument → epoch seconds. */
function parseDateArg(v: unknown, name: string): number | null {
  if (v == null) return null
  const ms = Date.parse(String(v))
  if (!Number.isFinite(ms)) throw new ToolInputError(`Argument "${name}" must be an ISO date like 2025-01-31.`)
  return Math.floor(ms / 1000)
}

function priceSummary(l: Listing) {
  const bp = l.buyerPrice ?? null
  const shown = shownPrice(l)
  return {
    current: priceValue(shown.amount, shown.divisor),
    currency: shown.currency,
    regular: val(bp?.original),
    on_sale: hasActiveDiscount(bp),
    discount_percent: discountPercent(bp),
    base: priceValue(l.priceAmount, l.priceDivisor),
    base_currency: l.currency,
    customer_country: bp?.country ?? null
  }
}

function priceFull(l: Listing) {
  const bp: BuyerPrice | null = l.buyerPrice ?? null
  return {
    ...priceSummary(l),
    discount_amount: hasActiveDiscount(bp) ? val(bp?.discountAmount) : null,
    discount_starts_at: hasActiveDiscount(bp) ? isoSec(bp?.discountStart) : null,
    discount_ends_at: hasActiveDiscount(bp) ? isoSec(bp?.discountEnd) : null,
    price_with_tax: val(bp?.base),
    shipping: val(bp?.shipping),
    free_shipping: bp?.isFreeShipping ?? null,
    customer_price_updated_at: isoMs(bp?.fetchedAt)
  }
}

function reviewsOf(l: Listing) {
  if (l.reviewCount == null) return null
  return {
    count: l.reviewCount,
    average_rating: l.reviewAvg ?? null,
    new_in_latest_snapshot: l.reviewsNew ?? 0,
    complete: !l.reviewsPartial
  }
}

/** The user's mark on a listing (their own bookkeeping); null = none. */
function markOut(m: ListingMark | null | undefined) {
  if (!m) return null
  return {
    status: m.status,
    note: m.note,
    our_product_id: m.ourListingId,
    our_draft_id: m.ourDraftId,
    set_by: m.source === 'mcp' ? 'assistant' : 'user',
    updated_at: isoMs(m.updatedAt)
  }
}

function productSummary(l: Listing, newIds: ReadonlySet<number>) {
  return {
    id: l.listingId,
    store_id: l.shopId,
    title: l.title,
    /** The listing's Etsy page. */
    url: pageUrl(l.url),
    status: l.removedAt == null ? 'active' : 'removed',
    price: priceSummary(l),
    quantity: l.quantity,
    favorites: l.numFavorers ?? null,
    favorites_change: l.favorersDelta ?? null,
    views: l.views ?? null,
    views_change: l.viewsDelta ?? null,
    featured_position: featured(l.featuredRank),
    reviews: reviewsOf(l),
    image_count: l.images.length,
    created_at: isoSec(l.details?.originalCreatedAt ?? l.etsyCreatedAt),
    first_seen_at: isoMs(l.firstSeenAt),
    removed_at: isoMs(l.removedAt),
    new_in_latest_snapshot: newIds.has(l.listingId),
    mark: markOut(l.mark)
  }
}

function attributes(d: ListingDetails | null | undefined) {
  if (!d) return null
  const hasDims = d.itemLength != null || d.itemWidth != null || d.itemHeight != null
  return {
    product_type: productType(d.listingType),
    made_by: d.whoMade,
    made_when: d.whenMade,
    is_supply: d.isSupply,
    category_id: d.taxonomyId,
    section_id: d.shopSectionId,
    customizable: d.isCustomizable,
    personalizable: d.isPersonalizable,
    has_variations: d.hasVariations,
    processing_days: d.processingMin == null && d.processingMax == null ? null : { min: d.processingMin, max: d.processingMax },
    weight: d.itemWeight == null ? null : { value: d.itemWeight, unit: d.itemWeightUnit },
    dimensions: hasDims
      ? { length: d.itemLength, width: d.itemWidth, height: d.itemHeight, unit: d.itemDimensionsUnit }
      : null,
    language: d.language,
    skus: list(d.skus),
    digital_files: d.fileData,
    taxable: d.isTaxable,
    non_taxable: d.nonTaxable,
    auto_renew: d.shouldAutoRenew,
    private: d.isPrivate,
    expires_at: isoSec(d.endingAt),
    state_changed_at: isoSec(d.stateAt)
  }
}

function imageOf(img: ListingImage, i: number) {
  return {
    image_id: img.id,
    position: i + 1,
    width: img.width,
    height: img.height,
    alt_text: img.alt,
    color_hex: img.hexCode ?? null,
    is_black_and_white: img.isBlackAndWhite ?? null,
    added_at: isoSec(img.createdAt)
  }
}

function productFull(l: Listing, newIds: ReadonlySet<number>, storeName: string | null) {
  const d = l.details ?? null
  return {
    ...productSummary(l, newIds),
    store_name: storeName,
    price: priceFull(l),
    state: l.state ?? null,
    description: l.description,
    tags: list(l.tags),
    materials: list(d?.materials),
    styles: list(d?.styles),
    attributes: attributes(d),
    personalization_questions: d?.personalization
      ? d.personalization.map((q) => ({
          question: q.text,
          instructions: q.instructions,
          type: q.type,
          required: q.required,
          max_chars: q.maxChars,
          max_files: q.maxFiles,
          options: list(q.options)
        }))
      : null,
    images: l.images.map(imageOf),
    video_count: l.videos?.length ?? 0,
    videos: (l.videos ?? []).map((v, i) => ({
      video_id: v.id,
      position: i + 1,
      width: v.width,
      height: v.height,
      state: v.state,
      /** get_product_video_preview returns its preview frame as an image. */
      has_preview: !!v.thumbnailUrl
    })),
    listed_at: isoSec(l.etsyCreatedAt),
    updated_at: isoSec(l.etsyUpdatedAt),
    last_seen_at: isoMs(l.lastSeenAt)
  }
}

function snapshotOf(s: ScanSummary) {
  return {
    id: s.id,
    store_id: s.shopId,
    started_at: isoMs(s.startedAt),
    finished_at: isoMs(s.finishedAt),
    status: s.status === 'error' ? 'failed' : s.status,
    is_first: s.isBaseline,
    products: s.total,
    added: s.added,
    removed: s.removed,
    changed: s.changed,
    returned: s.returned,
    discounts_started: s.promotionsStarted ?? 0,
    discounts_ended: s.promotionsEnded ?? 0,
    customer_country: s.buyerCountry ?? null,
    /** Very large shop: Etsy's paging stops at ≈12 100 active listings, so not all were read and removals were not detected. */
    partial: s.truncated
  }
}

function storeNumbers(s: ShopStats | null | undefined) {
  if (!s) return null
  return {
    favorites: s.numFavorers,
    sales_count: s.transactionSoldCount,
    review_count: s.reviewCount,
    rating: s.reviewAverage,
    active_products: s.listingActiveCount
  }
}

function storeSummary(s: ShopSummary, mine: number | null = null) {
  const p = s.profile ?? null
  return {
    id: s.id,
    /** The user's own Etsy shop (signed in in the app): list_my_products / create_product / … work on it. */
    is_mine: mine != null && s.id === mine,
    name: s.shopName,
    title: s.title,
    /** The shop's Etsy page. */
    url: pageUrl(s.url),
    currency: s.currency,
    /** get_store_logo returns it as an image. */
    has_logo: !!s.iconUrl,
    active_products: s.activeCount,
    /** Etsy's own count of the shop's active listings (listing_active_count) at the latest scan. */
    reported_active_products: s.etsyActiveCount,
    sales_count: s.stats?.transactionSoldCount ?? p?.transactionSoldCount ?? null,
    rating: s.stats?.reviewAverage ?? p?.reviewAverage ?? null,
    review_count: s.stats?.reviewCount ?? p?.reviewCount ?? null,
    favorites: s.stats?.numFavorers ?? p?.numFavorers ?? null,
    country: p?.countryIso ?? null,
    opened_at: isoSec(p?.etsyCreatedAt),
    tracked_since: isoMs(s.addedAt),
    new_products_in_latest_snapshot: s.newCount,
    latest_snapshot: s.lastOkScan ? snapshotOf(s.lastOkScan) : null,
    latest_update_failed: s.lastScan?.status === 'error',
    /** Why the latest scan failed (the app's message); null when it didn't. */
    latest_update_error: s.lastScan?.status === 'error' ? (s.lastScan.error ?? null) : null
  }
}

function storeFull(s: ShopSummary, mine: number | null = null) {
  const p = s.profile ?? null
  const r = s.reviews ?? null
  return {
    ...storeSummary(s, mine),
    owner_username: p?.loginName ?? null,
    /** get_store_logo with kind "banner". */
    has_banner: !!p?.bannerUrl,
    announcement: p?.announcement ?? null,
    sale_message: p?.saleMessage ?? null,
    digital_sale_message: p?.digitalSaleMessage ?? null,
    on_vacation: p?.isVacation ?? null,
    vacation_message: p?.vacationMessage ?? null,
    vacation_autoreply: p?.vacationAutoreply ?? null,
    accepts_custom_requests: p?.acceptsCustomRequests ?? null,
    languages: p?.languages ?? [],
    ships_from_country: p?.shippingFromCountryIso ?? null,
    digital_products: p?.digitalListingCount ?? null,
    updated_at: isoSec(p?.etsyUpdatedAt),
    policies: p
      ? {
          welcome: p.policies.welcome,
          payment: p.policies.payment,
          shipping: p.policies.shipping,
          refunds: p.policies.refunds,
          additional: p.policies.additional,
          seller_info: p.policies.sellerInfo,
          privacy: p.policies.privacy,
          updated_at: isoSec(p.policies.updatedAt)
        }
      : null,
    numbers_at_latest_snapshot: storeNumbers(s.stats),
    change_since_previous_snapshot: storeNumbers(s.statsDelta),
    stored_reviews:
      r && r.synced
        ? {
            count: r.stored,
            average_rating: r.average,
            complete: r.backfillComplete,
            expected_total: r.estimate,
            new_in_latest_snapshot: r.newCount,
            last_updated_at: isoMs(r.lastSyncedAt)
          }
        : null
  }
}

interface ReviewRow {
  id: number
  shop_id: number
  listing_id: number | null
  rating: number | null
  review: string | null
  language: string | null
  has_photo: number
  created_timestamp: number | null
  updated_timestamp: number | null
  origin: string
  first_seen_scan_id: number | null
  listing_title: string | null
}

function reviewOf(r: ReviewRow) {
  return {
    review_id: r.id,
    store_id: r.shop_id,
    product_id: r.listing_id,
    product_title: r.listing_title,
    rating: r.rating,
    text: r.review || null,
    language: r.language,
    has_photo: !!r.has_photo,
    created_at: isoSec(r.created_timestamp),
    updated_at: isoSec(r.updated_timestamp),
    /** Found by the review sync after a scan, once the shop's review history had been loaded (not part of the initial history). */
    is_new: r.origin === 'new',
    first_seen_snapshot_id: r.first_seen_scan_id
  }
}

const reviewFromApp = (r: Review) =>
  reviewOf({
    id: r.id,
    shop_id: r.shopId,
    listing_id: r.listingId,
    rating: r.rating,
    review: r.text,
    language: r.language,
    has_photo: r.hasImage ? 1 : 0,
    created_timestamp: r.createdAt,
    updated_timestamp: r.updatedAt,
    origin: r.origin,
    first_seen_scan_id: r.firstSeenScanId,
    listing_title: r.listingTitle ?? null
  })

const START_KIND: Record<PromotionStartKind, string> = {
  seen: 'started between two snapshots',
  running: 'already running when first seen',
  country: 'appeared when the customer country was changed'
}

const END_REASON: Record<PromotionEndReason, string> = {
  ended: 'ended',
  replaced: 'replaced by another discount',
  country: 'disappeared when the customer country was changed',
  removed: 'the product was removed',
  unknown: 'ended at an unknown time'
}

function discountOf(p: Promotion) {
  return {
    product_id: p.listingId,
    product_title: p.listingTitle ?? null,
    discount_percent: p.discountPercentage,
    discount_amount: val(p.discountAmount),
    regular_price: val(p.original),
    sale_price: val(p.discounted),
    currency: p.currency,
    customer_country: p.country,
    starts_at: isoSec(p.discountStart),
    ends_at: isoSec(p.discountEnd),
    how_it_started: START_KIND[p.startKind],
    first_seen_at: isoMs(p.firstSeenAt),
    last_seen_at: isoMs(p.lastSeenAt),
    status: p.endedAt == null ? 'running' : 'over',
    over_at: isoMs(p.endedAt),
    end_reason: p.endReason ? END_REASON[p.endReason] : null
  }
}

/** A change row's tracked fields under the MCP output's names. */
export function changeFields(t: TrackedFields | null | undefined): Record<string, unknown> | null {
  if (!t) return null
  const o: Record<string, unknown> = {}
  if ('title' in t) o.title = t.title ?? null
  if ('priceAmount' in t || 'currency' in t) {
    o.base_price = t.priceAmount != null && t.priceDivisor ? priceValue(t.priceAmount, t.priceDivisor) : null
    o.base_currency = t.currency ?? null
  }
  if ('description' in t) o.description = t.description ?? null
  if ('tags' in t) o.tags = t.tags ? list(t.tags) : null
  if ('materials' in t) o.materials = t.materials ? list(t.materials) : null
  if ('styles' in t) o.styles = t.styles ? list(t.styles) : null
  if ('images' in t) o.image_ids = t.images ?? null
  if ('videos' in t) o.video_ids = t.videos ?? null
  if ('whoMade' in t) o.made_by = t.whoMade
  if ('whenMade' in t) o.made_when = t.whenMade
  if ('taxonomyId' in t) o.category_id = t.taxonomyId
  if ('shopSectionId' in t) o.section_id = t.shopSectionId
  if ('listingType' in t) o.product_type = productType(t.listingType)
  if ('processingMin' in t || 'processingMax' in t) {
    o.processing_days = { min: t.processingMin ?? null, max: t.processingMax ?? null }
  }
  if ('isPersonalizable' in t) o.personalizable = t.isPersonalizable
  if ('isCustomizable' in t) o.customizable = t.isCustomizable
  if ('hasVariations' in t) o.has_variations = t.hasVariations
  if ('personalization' in t) {
    o.personalization_questions = t.personalization
      ? t.personalization.map((q) => ({ question: q.text, required: q.required, type: q.type }))
      : null
  }
  if ('dimensions' in t) o.weight_and_dimensions = t.dimensions ?? null
  return o
}

function statsPoint(p: StatsScanPoint) {
  return {
    snapshot_id: p.scanId,
    at: isoMs(p.at),
    is_first: p.isBaseline,
    products: p.total,
    added: p.added,
    removed: p.removed,
    changed: p.changed,
    returned: p.returned,
    store_favorites: p.numFavorers,
    sales_count: p.transactionSoldCount,
    review_count: p.reviewCount,
    rating: p.reviewAverage,
    active_products: p.listingActiveCount,
    total_product_views: p.listingViews,
    total_product_favorites: p.listingFavorers,
    discounted_products: p.discounted ?? null,
    products_with_customer_price: p.buyerPriced ?? null
  }
}

const bucketOf = (b: StatsReviewBucket) => ({
  start: isoSec(b.start),
  end: isoSec(b.end),
  count: b.count,
  average_rating: b.avg,
  ratings_1_to_5: b.ratings,
  partial: b.partial
})

const topRow = (r: StatsTopRow) => ({
  product_id: r.listingId,
  title: r.title,
  start: r.start,
  end: r.end,
  change: r.delta
})

// -------------------------------------------------------------------- queries

/** Listings added by the shop's latest successful scan. */
function newProductIds(db: Db, shop: ShopSummary | null): Set<number> {
  const scanId = shop?.lastOkScan?.id
  if (scanId == null) return new Set()
  const rows = db
    .prepare("SELECT listing_id FROM scan_changes WHERE scan_id = ? AND kind = 'added'")
    .all(scanId) as Array<{ listing_id: number }>
  return new Set(rows.map((r) => r.listing_id))
}

function requireStore(db: Db, id: unknown): ShopSummary {
  const s = getShopSummary(db, Number(id))
  if (!s) throw new ToolInputError(`No store with id ${String(id)}. Call list_stores for the ids.`)
  return s
}

function requireProduct(db: Db, id: unknown): Listing {
  const l = getListing(db, Number(id))
  if (!l) throw new ToolInputError(`No product with id ${String(id)}. Use search_products to find ids.`)
  return l
}

function productChanges(db: Db, listingId: number) {
  const rows = db
    .prepare(
      `SELECT c.scan_id, c.kind, c.old_value, c.new_value, s.finished_at
       FROM scan_changes c JOIN scans s ON s.id = c.scan_id
       WHERE c.listing_id = ? ORDER BY c.scan_id, c.id`
    )
    .all(listingId) as Array<{
    scan_id: number
    kind: string
    old_value: string | null
    new_value: string | null
    finished_at: number | null
  }>
  const parse = (v: string | null): TrackedFields | null => {
    try {
      return v ? (JSON.parse(v) as TrackedFields) : null
    } catch {
      return null
    }
  }
  return rows.map((r) => {
    const after = changeFields(parse(r.new_value))
    return {
      snapshot_id: r.scan_id,
      at: isoMs(r.finished_at),
      kind: r.kind,
      ...(r.kind === 'changed'
        ? { changed_fields: Object.keys(after ?? {}), before: changeFields(parse(r.old_value)), after }
        : {})
    }
  })
}

const REVIEW_SORT: Record<string, string> = {
  newest: 'r.created_timestamp DESC, r.id DESC',
  oldest: 'r.created_timestamp ASC, r.id ASC',
  lowest_rating: 'r.rating ASC, r.created_timestamp DESC, r.id DESC',
  highest_rating: 'r.rating DESC, r.created_timestamp DESC, r.id DESC'
}

// ---------------------------------------------------------------------- tools

const SORTS: Record<string, SortMode> = {
  newest: 'newest',
  price_low: 'price-asc',
  price_high: 'price-desc',
  most_favorited: 'favorites',
  most_viewed: 'views',
  favorites_growth: 'favorites-growth',
  most_reviewed: 'reviews',
  new_reviews: 'reviews-growth',
  biggest_discount: 'discount',
  marked_first: 'marked'
}

const idArg = (description: string) => ({ type: 'integer' as const, minimum: 1, description })
const limitArg = (def: number, max: number) => ({
  type: 'integer' as const,
  minimum: 1,
  maximum: max,
  default: def,
  description: `Page size (default ${def}, max ${max}).`
})
const offsetArg = { type: 'integer' as const, minimum: 0, default: 0, description: 'Items to skip (paging).' }

const num = (v: unknown, def: number): number => (typeof v === 'number' ? v : def)

/** open_link's answer when the text holds nothing it can open. */
/** open_link's answer to an etsy.me share link (it hides the listing id behind a redirect). */
export const OPEN_LINK_SHORT =
  "That is a short etsy.me share link: it doesn't contain the listing id, and this tool doesn't follow redirects. Ask the user to open it in the browser and paste the full address from the address bar (https://www.etsy.com/listing/<id>/…), or to copy the reference with the app's \"Копіювати для Claude\" button on the picture."

export const OPEN_LINK_FORMS =
  "No link or reference found. open_link accepts: an app reference copied with the app's \"Копіювати для Claude\" buttons — etsy-tracker://product/<id>, etsy-tracker://product/<id>/photo/<image_id>, etsy-tracker://product/<id>/video/<video_id>, etsy-tracker://review/<review_id>/photo, etsy-tracker://store/<id>, etsy-tracker://store/<id>/logo, etsy-tracker://store/<id>/banner, etsy-tracker://draft/<id>, etsy-tracker://draft/<id>/photo/<photo_id> —, an Etsy listing link (https://www.etsy.com/listing/<id>), an Etsy shop link (https://www.etsy.com/shop/<Name>) or a bare Etsy listing id (6 digits or more, on its own). Ask the user to copy the reference again with the app's button."

export const MCP_INSTRUCTIONS = `Etsy Tracker is the user's desktop app that watches Etsy shops through the official Etsy Open API v3 (competitor and market research) and manages the user's own Etsy shop. Names used by these tools: a "store" is an Etsy shop, a "product" is an Etsy listing, a "snapshot" is one scan the app made of a shop, a "discount" is an Etsy sale (promotion), "favorites" are Etsy favorers, the "customer price" is Etsy's buyer price.

Local data — no Etsy request, no API quota: list_stores, get_store, search_products, get_product, get_product_history, list_snapshots, get_snapshot_changes, list_reviews, get_store_stats, list_marked_products. They read the app's database, filled when the user scans the shops they track (you cannot start a scan; if latest_snapshot.finished_at is old, ask the user to rescan). A scan stores every active listing of the shop (title, description, price, tags, materials, photos, videos, attributes, views, favorers, featured rank) and records what changed since the previous scan: listings added, removed, returned and edited (which fields, old → new). After each scan the app also syncs the shop's Etsy reviews (the whole history first, then the new ones) and copies listing and review photos into a local image store. Text fields are Etsy's text with HTML entities decoded (&amp; → &); in the change records of get_snapshot_changes and get_product_history a description's old and new values are excerpts of at most 1000 characters (get_product has the full current text). url fields are the shops' and listings' Etsy pages.

Photos as images: get_product_image and get_review_photo return the app's local copy when there is one, else download the photo from Etsy's image CDN; get_store_logo and get_product_video_preview always download from Etsy's image CDN (those images are never copied locally). CDN downloads cost no API quota.

Where to start: list_stores → get_store / search_products → get_product. "What is new?" → get_snapshot_changes. Trends → get_store_stats and get_product_history.

Prices: "base" is the seller's price as the API reports it (no VAT, no sale). "current" is what a buyer in customer_country sees on Etsy: the buyer price (VAT included where the country charges it, shipping included for GB, the sale applied while one runs); the app asks Etsy for one buyer country, set in its Settings. It equals "base" when no buyer price is known. "regular" is the buyer price before the sale. Currencies are never converted.

Popularity: favorites = Etsy favorers; views = total listing views (Etsy updates them about once a day); featured_position = the listing's place among the shop's featured listings (null = not featured). *_change fields compare the latest scan with the previous one. A shop's sales_count is Etsy's total for the whole shop; Etsy does not give other shops' sales per listing — review counts are the best proxy. Review counts cover the reviews the app has stored (complete: false = the history is still loading, the counts are lower bounds).

Ids: store, product, image and video ids are Etsy's (shop_id, listing_id, …); review and snapshot ids are the app's own. Times are ISO 8601 UTC. Links the user pastes: an Etsy listing link https://www.etsy.com/listing/<id>[/…] (the app's "Копіювати посилання" button copies exactly that) means product_id = <id> — call get_product with it right away (or open_link with the link, which also reads a listing the app doesn't store live; for the user's own listings also the *_my_* tools); a shop link https://www.etsy.com/shop/<Name> means the store whose name is <Name> in list_stores.

References from the app: references like etsy-tracker://product/<id>/photo/<image_id> (also …/video/<video_id>, etsy-tracker://review/<review_id>/photo, etsy-tracker://store/<id>[/logo|/banner], etsy-tracker://draft/<id>[/photo/<photo_id>]) are copied from the app's "Копіювати для Claude" buttons on pictures: listing photos (cards and the listing window), video frames, buyers' review photos, the shop logo and draft photos — in the full-size picture viewer and next to the main photo of the listing window. For a listing itself the app's "Копіювати посилання" button copies its Etsy link. When the user pastes one — or an Etsy listing or shop link, alone or inside a sentence ("look at this picture: …") — call open_link with what they pasted right away: it finds the reference and answers in one call (the listing's data, or the picture itself as an image), so no list_stores / search_products round trip is needed.

Live Etsy tools (Etsy API requests on the user's daily quota; the app's API key is enough, no Etsy sign-in needed): search_market, list_market_categories, get_market_category_properties search all of Etsy, not only the tracked shops; get_store_sections, get_store_featured, get_store_return_policies, get_product_live_details read any shop or listing now (only the shipping part of get_product_live_details needs the sign-in); list_shipping_carriers; find_categories (Etsy's seller categories, for a new listing's category_id) and get_category_attributes (the attributes a seller category supports). The two category trees (find_categories, list_market_categories) are read from Etsy once per app run and then matched locally, so repeated searches make no further requests.

The user's own Etsy shop: once the user signed in to Etsy in the app ("Мій магазин", OAuth), list_stores marks it is_mine: true and the *_my_* tools work on it live through the Etsy API: the account (get_my_account), listings in any state (list_my_products: drafts, inactive, expired, sold out), allowed values and the shop's shipping/processing profiles for new listings (get_product_options), inventory and prices, photos / video / digital files, attributes, personalization, translations, sections, shipping and processing profiles, return policies, public-holiday processing preferences (get_my_holidays, set_my_holiday: whether the shop processes orders on each public holiday of its country — not vacation mode, which no tool changes), production partners, orders (list_my_orders, mark_my_order_shipped…), sales (list_my_sales) and the payment ledger (list_my_ledger). A tool whose OAuth permission the sign-in lacks says which one is missing. Buyer email and street address are left out unless explicitly asked for.

Changing the shop: every tool that writes to Etsy — create_product, update_my_product, add_product_media, update_my_store, send_prepared_product, delete_prepared_product with also_on_etsy, mark_my_order_shipped, update_my_order, consolidate_my_return_policies and every create_/update_/set_/replace_/upload_/remove_/delete_ tool with "my" in its name — needs the Etsy sign-in and works only while "allow changes" is switched on in the app's MCP window; otherwise it answers how to enable it. The exception: prepare_product, unlink_prepared_product and delete_prepared_product (without also_on_etsy) change only drafts kept inside the app — they are annotated readOnlyHint: false too, but need neither the sign-in nor the switch; sync_prepared_products reads Etsy (sign-in needed) and writes only the app's drafts, so it needs no switch either. Change only what the user asked for, prefer Etsy drafts (publish=false) unless the user said to publish, and confirm with the user before publishing a draft (create_product / send_prepared_product with publish=true, or update_my_product status "active" on a draft) or renewing an expired or sold-out listing (update_my_product status "active"): Etsy charges a $0.20 listing fee for that. Reactivating an inactive listing costs no fee.

New listings: prefer prepare_product — it saves a draft inside the app (nothing is sent to Etsy, no "allow changes" needed, incomplete drafts are fine); the user reviews, edits and sends it from the app's drafts window (the "Чернетки" button in their own shop's header, shown only while they are signed in to Etsy in the app). send_prepared_product sends one to Etsy (as an Etsy draft or published) only when the user asks you to. A sent draft stays linked to its Etsy listing, and drafts the user made on Etsy's site are pulled into the app after every scan of their shop (or now with sync_prepared_products). To change such a listing, prepare_product can edit its linked draft too — Etsy changes only when the draft is sent again, and send_prepared_product then updates that same listing, never a second one. When the listing was also changed on Etsy since the last sync, send_prepared_product answers conflict: true and writes nothing: ask the user before sending again with overwrite_etsy_changes. list_prepared_products shows every draft's link and state; unlink_prepared_product forgets the link (the next send creates a new listing); delete_prepared_product deletes a draft in the app — with also_on_etsy the Etsy listing too, which can't be undone, so confirm with the user first.

Marks: the user keeps their own record of which example listings (usually a competitor's, in a tracked shop) they already made their own version of — a mark on the listing in the app: in_progress (being made) or done (we have it), with an optional note, our_product_id (their own Etsy listing made from it) and our_draft_id (the draft in the app made from it). get_product, search_products and open_link show it as mark (null = none; set_by user or assistant); search_products filters by it (mark) and sorts marked_first; list_marked_products lists every marked listing. set_product_mark sets or removes one — it changes only the app's database (no Etsy request, no sign-in, no "allow changes" switch). When the user asks you to make a similar listing from an example: check its mark first (done = already made — tell the user), prepare_product, then set_product_mark(example, in_progress, our_draft_id = the new draft_id); the app turns that mark done by itself (with our_product_id) when the draft is published. When the user says the listing is done another way, set_product_mark(example, done, our_product_id).`

export function createMcpTools(deps: McpToolDeps): McpTool[] {
  const { db } = deps
  const now = deps.now ?? Date.now
  const mine = (): number | null => {
    const st = deps.own?.status()
    return st?.loggedIn ? (st.shopId ?? null) : null
  }

  const tools: McpTool[] = [
    {
      name: 'open_link',
      openWorld: true,
      title: 'Open a link or reference from the app',
      description:
        "Opens whatever the user pasted — a whole sentence is fine — in one call: an app reference copied with the app's \"Копіювати для Claude\" buttons (etsy-tracker://product/<id>, etsy-tracker://product/<id>/photo/<image_id>, etsy-tracker://product/<id>/video/<video_id>, etsy-tracker://review/<review_id>/photo, etsy-tracker://store/<id>, etsy-tracker://store/<id>/logo or /banner, etsy-tracker://draft/<id>, etsy-tracker://draft/<id>/photo/<photo_id>), an Etsy listing link (https://www.etsy.com/listing/<id>…), an Etsy shop link (https://www.etsy.com/shop/<Name>), the owner's editor link (https://www.etsy.com/your/shops/me/listing-editor/edit/<id>) or a bare listing id sent on its own. Answers like the matching tool, with `opened` = what it was: a product → the same JSON as get_product (source local); a listing the app doesn't store → read live from Etsy (source live, 1 API request; compact, with its photos' image ids and links); a photo → the image (like get_product_image; a photo of a listing the app doesn't store, or one added since the latest scan, is read live: 1 API request + Etsy's image CDN); a video → its preview frame; a review photo → the image + the review's rating, text, date and listing; a store or shop link → like get_store (only tracked shops); a logo/banner → the image; a draft → as list_prepared_products shows it; a draft photo → the image. Nothing recognised → an error listing the accepted forms.",
      inputSchema: {
        type: 'object',
        properties: {
          link: { type: 'string', minLength: 1, maxLength: 2000, description: 'What the user pasted: a reference, an Etsy link, a listing id, or a sentence containing one.' },
          size: {
            type: 'string',
            enum: ['medium', 'full'],
            default: 'medium',
            description: 'For photos: medium (≈570 px, the default) or full (the original; over 5 MB is refused).'
          }
        },
        required: ['link'],
        additionalProperties: false
      },
      run: async (a) => {
        const text = String(a.link ?? '')
        const ref = parseClaudeRef(text)
        if (!ref) throw new ToolInputError(hasEtsyShortLink(text) ? OPEN_LINK_SHORT : OPEN_LINK_FORMS)
        try {
          return await openRef(ref, a.size === 'full')
        } catch (e) {
          if (e instanceof ToolInputError) throw e
          return errorResult(mcpErrorText(e))
        }
      }
    },
    {
      name: 'list_stores',
      title: 'Tracked Etsy shops (local)',
      description:
        "The Etsy shops the user tracks in the app (local data, as of each shop's latest scan): id (Etsy shop_id), name, url (the shop's Etsy page), is_mine (the user's own shop), headline numbers (active listings, total sales, rating, review count, favorers), the latest successful scan (when, listings added/removed/changed/returned) and whether the latest scan failed (latest_update_error = the app's error message, in Ukrainian). Start here to get store ids.",
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => {
        const m = mine()
        const stores = listShopSummaries(db).map((s) => storeSummary(s, m))
        return textResult({ count: stores.length, stores })
      }
    },
    {
      name: 'get_store',
      title: 'Etsy shop profile (local)',
      description:
        "One tracked Etsy shop from the local database (as of its latest scan): everything list_stores gives plus the owner's username, announcement, sale messages, vacation status and messages, policies (welcome, payment, shipping, refunds, additional, seller info, privacy), languages, ships-from country, digital listing count, the shop's numbers at the latest scan and their change since the previous scan, and the reviews the app has stored (count, average, whether the history is complete).",
      inputSchema: {
        type: 'object',
        properties: { store_id: idArg('Store id from list_stores.') },
        required: ['store_id'],
        additionalProperties: false
      },
      run: (a) => textResult(storeFull(requireStore(db, a.store_id), mine()))
    },
    {
      name: 'search_products',
      title: 'Search tracked listings (local)',
      description:
        "Find listings in the local database (as of the latest scans), in one tracked Etsy shop or all of them: by text (title or tags, optionally the description; case-insensitive), status, sale/new/mark filters, with sorting and paging. Returns total and compact summaries (url, price, quantity, favorers, views and their change, featured position, review summary, new_in_latest_snapshot, the user's mark); get_product has everything about one listing. To search all of Etsy live, use search_market.",
      inputSchema: {
        type: 'object',
        properties: {
          store_id: idArg('Only this store (omit = all stores).'),
          query: { type: 'string', maxLength: 200, description: 'Case-insensitive text to find in the title or tags.' },
          search_description: {
            type: 'boolean',
            default: false,
            description: 'Also match the query in descriptions.'
          },
          status: {
            type: 'string',
            enum: ['active', 'removed', 'all'],
            default: 'active',
            description: 'active = active on Etsy at the latest scan; removed = no longer active in the shop (deactivated, sold out, deleted…; kept with their last known data); all = both.'
          },
          on_sale_only: { type: 'boolean', default: false, description: 'Only listings whose buyer price had a running Etsy sale at the latest scan.' },
          new_only: {
            type: 'boolean',
            default: false,
            description: "Only listings added by their shop's latest successful scan (a shop's first scan adds none)."
          },
          mark: {
            type: 'string',
            enum: ['any', 'none', 'in_progress', 'done'],
            default: 'any',
            description: "The user's mark (see set_product_mark): any = every listing, none = unmarked only, in_progress / done = only listings with that mark."
          },
          sort: {
            type: 'string',
            enum: Object.keys(SORTS),
            default: 'newest',
            description:
              'newest = most recently listed or renewed on Etsy first. price_low/price_high use the current price (currencies are not converted). favorites_growth / new_reviews = change since the previous scan; most_reviewed = stored reviews; marked_first = marked done first, then in_progress, then unmarked (each newest first). Unknown values sort last.'
          },
          limit: limitArg(50, 200),
          offset: offsetArg
        },
        additionalProperties: false
      },
      run: (a) => {
        const stores = a.store_id != null ? [requireStore(db, a.store_id)] : listShopSummaries(db)
        const status = (a.status as string | undefined) ?? 'active'
        const newIds = new Set<number>()
        let all: Listing[] = []
        for (const s of stores) {
          for (const id of newProductIds(db, s)) newIds.add(id)
          const ls = status === 'active' ? listActiveListings(db, s.id) : listAllListings(db, s.id)
          all = all.concat(status === 'removed' ? ls.filter((l) => l.removedAt != null) : ls)
        }
        if (a.new_only) all = all.filter((l) => newIds.has(l.listingId))
        const hits = filterListings(all, String(a.query ?? ''), SORTS[(a.sort as string) ?? 'newest'], {
          discountOnly: !!a.on_sale_only,
          searchDescription: !!a.search_description,
          mark: isMarkFilter(a.mark) ? a.mark : 'any'
        })
        const offset = num(a.offset, 0)
        const limit = num(a.limit, 50)
        return textResult({
          total: hits.length,
          offset,
          products: hits.slice(offset, offset + limit).map((l) => productSummary(l, newIds))
        })
      }
    },
    {
      name: 'get_product',
      title: 'Listing details (local)',
      description:
        "Everything the local database has about one listing of a tracked shop, as of the latest scan (also listings that have left the shop): title, full description, tags, materials, styles, url (its Etsy page), state, price (base, buyer price with VAT, the sale and its dates, shipping), quantity, favorers/views and their change, featured position, review summary, attributes (type, who made it, when, category and section ids, processing time, weight/dimensions, variations, SKUs, auto-renew, expiry), personalization questions, photos (ids, sizes, alt text, colors), videos, dates (created_at = first listed, listed_at = last listed/renewed, first/last seen by the app, removed) and the user's mark (see set_product_mark; null = none).",
      inputSchema: {
        type: 'object',
        properties: { product_id: idArg('Etsy listing id (from search_products).') },
        required: ['product_id'],
        additionalProperties: false
      },
      run: (a) => {
        const l = requireProduct(db, a.product_id)
        const shop = getShopSummary(db, l.shopId)
        return textResult(productFull(l, newProductIds(db, shop), shop?.shopName ?? null))
      }
    },
    {
      name: 'get_product_history',
      title: 'Listing history (local)',
      description:
        "One listing over time, from the local database: per successful scan (oldest first): views, favorers, featured position, quantity, stored review count and average, seller and buyer price (current, regular, sale %); its Etsy sales as the app observed them (newest first: %, prices, Etsy's start/end dates, first/last seen, how it started and ended); and every recorded change, oldest first (added, edited — the fields' old and new values; a description's are excerpts of at most 1000 characters, get_product has the full current text —, removed, returned).",
      inputSchema: {
        type: 'object',
        properties: {
          product_id: idArg('Product id.'),
          limit: { ...limitArg(100, 1000), description: 'Most recent scans to include (default 100, max 1000); snapshot_count is the total.' }
        },
        required: ['product_id'],
        additionalProperties: false
      },
      run: (a) => {
        const l = requireProduct(db, a.product_id)
        const points = listListingStats(db, l.listingId)
        const limit = num(a.limit, 100)
        const snapshots = points.slice(Math.max(0, points.length - limit)).map((p) => {
          const bp = p.buyerPrice ?? null
          const cur = bp && hasActiveDiscount(bp) ? bp.discounted : (bp?.original ?? null)
          return {
            snapshot_id: p.scanId,
            at: isoMs(p.at),
            views: p.views,
            favorites: p.numFavorers,
            featured_position: featured(p.featuredRank),
            quantity: p.quantity,
            review_count: p.reviewCount ?? null,
            average_rating: p.reviewAvg ?? null,
            base_price: p.price ? priceValue(p.price.amount, p.price.divisor) : null,
            base_currency: p.price?.currency ?? null,
            current_price: val(cur),
            regular_price: val(bp?.original),
            discount_percent: discountPercent(bp),
            currency: bp?.currency ?? null,
            customer_country: bp?.country ?? null
          }
        })
        return textResult({
          product_id: l.listingId,
          title: l.title,
          snapshot_count: points.length,
          snapshots,
          discounts: listListingPromotions(db, l.listingId).map(discountOf),
          changes: productChanges(db, l.listingId)
        })
      }
    },
    {
      name: 'list_snapshots',
      title: 'Scan history (local)',
      description:
        "One tracked shop's scans from the local database, newest first: start/end time, status (ok, failed or running), is_first (the shop's first scan, which records no changes), listings seen, added, removed, changed, returned, Etsy sales started/ended, the buyer country asked, partial (too many listings to read them all).",
      inputSchema: {
        type: 'object',
        properties: {
          store_id: idArg('Store id.'),
          limit: { ...limitArg(50, 500), description: 'Newest scans to return (default 50, max 500).' }
        },
        required: ['store_id'],
        additionalProperties: false
      },
      run: (a) => {
        const s = requireStore(db, a.store_id)
        return textResult({ store_id: s.id, snapshots: listScans(db, s.id, num(a.limit, 50)).map(snapshotOf) })
      }
    },
    {
      name: 'get_snapshot_changes',
      title: 'What a scan found (local)',
      description:
        "What one scan of a tracked shop found compared with the shop's previous successful scan (local data): new listings, removed listings, listings that came back, edited listings (which fields, old → new values; a description's are excerpts of at most 1000 characters, get_product has the full current text), reviews that the review sync after it found new, and Etsy sales that started or ended. Defaults to the latest successful scan — i.e. \"what is new in this shop\". A shop's first scan records no changes (everything was new); a failed or still running scan has none either. Each group: exact total + up to limit items.",
      inputSchema: {
        type: 'object',
        properties: {
          store_id: idArg('Store id.'),
          snapshot_id: idArg('A scan of that shop (list_snapshots); omit = the latest successful one.'),
          limit: { ...limitArg(100, 500), description: 'Max items per group (default 100, max 500); totals are always exact.' }
        },
        required: ['store_id'],
        additionalProperties: false
      },
      run: (a) => {
        const s = requireStore(db, a.store_id)
        const scan = a.snapshot_id != null ? getScan(db, Number(a.snapshot_id)) : s.lastOkScan
        if (!scan || scan.shopId !== s.id) {
          if (a.snapshot_id != null) throw new ToolInputError(`Store ${s.id} has no snapshot ${String(a.snapshot_id)}.`)
          return textResult({ store_id: s.id, snapshot: null, note: 'The store has no successful snapshot yet.' })
        }
        if (scan.status !== 'ok') {
          const note =
            scan.status === 'running'
              ? 'This snapshot is still running; its changes are recorded when it finishes.'
              : 'This snapshot did not succeed; it recorded no changes.'
          return textResult({ store_id: s.id, snapshot: snapshotOf(scan), note })
        }
        const limit = num(a.limit, 100)
        const changes = listScanChanges(db, scan.id)
        const newIds = new Set(changes.filter((c) => c.kind === 'added').map((c) => c.listingId))
        const group = <T>(kind: string, f: (c: (typeof changes)[number]) => T) => {
          const rows = changes.filter((c) => c.kind === kind)
          return { total: rows.length, items: rows.slice(0, limit).map(f) }
        }
        const brief = (c: (typeof changes)[number]) =>
          c.listing ? productSummary(c.listing, newIds) : { id: c.listingId, title: null }
        const reviews = listNewReviews(db, scan.id, limit)
        const reviewTotal = (
          db
            .prepare("SELECT COUNT(*) AS n FROM reviews WHERE first_seen_scan_id = ? AND origin = 'new'")
            .get(scan.id) as { n: number }
        ).n
        const promos = listScanPromotions(db, scan.id, limit)
        return textResult({
          store_id: s.id,
          snapshot: snapshotOf(scan),
          added: group('added', brief),
          returned: group('returned', brief),
          removed: group('removed', brief),
          changed: group('changed', (c) => {
            const after = changeFields(c.newValue)
            return {
              product_id: c.listingId,
              title: c.listing?.title ?? null,
              changed_fields: Object.keys(after ?? {}),
              before: changeFields(c.oldValue),
              after
            }
          }),
          new_reviews: { total: reviewTotal, items: reviews.map(reviewFromApp) },
          discounts_started: { total: scan.promotionsStarted ?? 0, items: promos.started.map(discountOf) },
          discounts_ended: { total: scan.promotionsEnded ?? 0, items: promos.ended.map(discountOf) }
        })
      }
    },
    {
      name: 'list_reviews',
      title: 'Stored Etsy reviews (local)',
      description:
        "Etsy reviews the app has stored for the tracked shops (synced from Etsy after each scan; reviews later deleted on Etsy are kept): rating 1–5, text, language, created/updated dates, whether a photo is attached, the reviewed listing, is_new. Of one listing, one shop, or all tracked shops. Filters: rating range, created date range, text, with text only; sort by date or rating; paged; total = all matches. Review counts per listing are the best available proxy for how often it sells.",
      inputSchema: {
        type: 'object',
        properties: {
          store_id: idArg('Only this store.'),
          product_id: idArg('Only this product.'),
          min_rating: { type: 'integer', minimum: 1, maximum: 5, description: 'Lowest rating to include.' },
          max_rating: { type: 'integer', minimum: 1, maximum: 5, description: 'Highest rating to include.' },
          since: { type: 'string', maxLength: 40, description: 'Created at or after this ISO date/time.' },
          until: { type: 'string', maxLength: 40, description: 'Created at or before this ISO date/time.' },
          query: { type: 'string', maxLength: 200, description: 'Text the review must contain (case-insensitive for Latin letters only).' },
          with_text_only: { type: 'boolean', default: false, description: 'Skip reviews without text.' },
          sort: { type: 'string', enum: Object.keys(REVIEW_SORT), default: 'newest' },
          limit: limitArg(50, 200),
          offset: offsetArg
        },
        additionalProperties: false
      },
      run: (a) => {
        const where: string[] = []
        const params: Array<string | number> = []
        if (a.store_id != null) {
          where.push('r.shop_id = ?')
          params.push(Number(a.store_id))
        }
        if (a.product_id != null) {
          where.push('r.listing_id = ?')
          params.push(Number(a.product_id))
        }
        if (a.min_rating != null) {
          where.push('r.rating >= ?')
          params.push(Number(a.min_rating))
        }
        if (a.max_rating != null) {
          where.push('r.rating <= ?')
          params.push(Number(a.max_rating))
        }
        const since = parseDateArg(a.since, 'since')
        const until = parseDateArg(a.until, 'until')
        if (since != null) {
          where.push('r.created_timestamp >= ?')
          params.push(since)
        }
        if (until != null) {
          where.push('r.created_timestamp <= ?')
          params.push(until)
        }
        if (a.with_text_only) where.push("r.review IS NOT NULL AND r.review <> ''")
        const q = String(a.query ?? '').trim()
        if (q) {
          where.push("r.review LIKE ? ESCAPE '\\'")
          params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
        }
        const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
        const total = (db.prepare(`SELECT COUNT(*) AS n FROM reviews r ${w}`).get(...params) as { n: number }).n
        const offset = num(a.offset, 0)
        const limit = num(a.limit, 50)
        const rows = db
          .prepare(
            `SELECT r.id, r.shop_id, r.listing_id, r.rating, r.review, r.language,
                    r.image_url_fullxfull IS NOT NULL AS has_photo, r.created_timestamp,
                    r.updated_timestamp, r.origin, r.first_seen_scan_id, l.title AS listing_title
             FROM reviews r LEFT JOIN listings l ON l.listing_id = r.listing_id
             ${w} ORDER BY ${REVIEW_SORT[(a.sort as string) ?? 'newest']} LIMIT ? OFFSET ?`
          )
          .all(...params, limit, offset) as unknown as ReviewRow[]
        return textResult({ total, offset, reviews: rows.map(reviewOf) })
      }
    },
    {
      name: 'get_store_stats',
      title: 'Etsy shop trends (local)',
      description:
        "One tracked shop's numbers over a period, from the local database (the app's Statistics view): per successful scan in the period (sales count, favorers, review count, rating, active listings, total views/favorers of its listings, listings on sale, added/removed/changed/returned), before_period (the last scan before it, the starting point), the change between consecutive scans, sales per day (derived from Etsy's shop sales count between scans at least 1 h apart), stored reviews per week or month (count, average, ratings 1–5; UTC) and the top 10 listings by growth in views, favorers and reviews.",
      inputSchema: {
        type: 'object',
        properties: {
          store_id: idArg('Store id.'),
          period: {
            type: 'string',
            enum: [...STATS_RANGES],
            default: 'all',
            description: 'all, or the last 90/30/7 days (90d, 30d, 7d).'
          },
          review_buckets: {
            type: 'string',
            enum: ['week', 'month'],
            description: 'Group reviews by week or month (default: month for "all", week otherwise). Weeks start Monday 00:00 UTC.'
          }
        },
        required: ['store_id'],
        additionalProperties: false
      },
      run: (a) => {
        const s = requireStore(db, a.store_id)
        const range = ((a.period as string) ?? 'all') as StatsRange
        const p = shopStatsPayload(db, s.id, range, now())
        if (!p) throw new ToolInputError(`No store with id ${s.id}.`)
        const by = (a.review_buckets as string) ?? (range === 'all' ? 'month' : 'week')
        return textResult({
          store_id: s.id,
          period: range,
          from: isoMs(p.from),
          to: isoMs(p.to),
          snapshots: p.scans.map(statsPoint),
          before_period: p.anchor ? statsPoint(p.anchor) : null,
          intervals: p.intervals.map((i) => ({
            from_snapshot_id: i.fromScanId,
            to_snapshot_id: i.toScanId,
            from: isoMs(i.from),
            to: isoMs(i.to),
            days: i.days,
            sales: i.sold,
            favorites: i.favorers,
            reviews: i.reviews,
            views: i.views
          })),
          sales_per_day: p.salesRate.map((r) => ({
            from: isoMs(r.from),
            to: isoMs(r.to),
            days: r.days,
            sales: r.sold,
            per_day: r.perDay
          })),
          reviews: {
            loaded: p.reviews.synced,
            complete: p.reviews.complete,
            total: p.reviews.total,
            average_rating: p.reviews.avg,
            grouped_by: by,
            buckets: (by === 'week' ? p.reviews.weeks : p.reviews.months).map(bucketOf)
          },
          top_growth: {
            from_snapshot_id: p.top.fromScanId,
            to_snapshot_id: p.top.toScanId,
            views: p.top.views.map(topRow),
            favorites: p.top.favorers.map(topRow),
            reviews: p.top.reviews.map(topRow)
          }
        })
      }
    },
    {
      name: 'get_product_image',
      openWorld: true,
      title: 'Listing photo',
      description:
        "One photo of a tracked listing as an image you can look at: the app's local copy, else downloaded from Etsy's image CDN (no API quota). Pick it by image_id (from get_product) or position (1 = the main photo). size: medium (≈570 px wide, the default; the original when that copy can't be shown) or full (the original; over 5 MB is refused).",
      inputSchema: {
        type: 'object',
        properties: {
          product_id: idArg('Product id.'),
          image_id: idArg('A photo id from get_product.'),
          position: { type: 'integer', minimum: 1, default: 1, description: '1 = the main photo.' },
          size: { type: 'string', enum: ['medium', 'full'], default: 'medium' }
        },
        required: ['product_id'],
        additionalProperties: false
      },
      run: (a) =>
        productPhoto(requireProduct(db, a.product_id), {
          imageId: a.image_id != null ? Number(a.image_id) : undefined,
          position: num(a.position, 1),
          full: a.size === 'full'
        })
    },
    {
      name: 'get_store_logo',
      openWorld: true,
      title: 'Etsy shop logo or banner',
      description:
        'A tracked shop\'s logo (has_logo = true in list_stores / get_store) or its banner (kind "banner"; has_banner in get_store) as an image, downloaded from Etsy\'s image CDN (no API quota).',
      inputSchema: {
        type: 'object',
        properties: {
          store_id: idArg('Store id from list_stores.'),
          kind: { type: 'string', enum: ['logo', 'banner'], default: 'logo' }
        },
        required: ['store_id'],
        additionalProperties: false
      },
      run: (a) => storePicture(requireStore(db, a.store_id), a.kind === 'banner')
    },
    {
      name: 'get_product_video_preview',
      openWorld: true,
      title: 'Listing video preview',
      description:
        "The preview frame of a tracked listing's video (videos in get_product, has_preview = true) as an image, downloaded from Etsy's image CDN (no API quota). Pick it by video_id or position. The video itself is not available.",
      inputSchema: {
        type: 'object',
        properties: {
          product_id: idArg('Product id.'),
          video_id: idArg('A video id from get_product.'),
          position: { type: 'integer', minimum: 1, default: 1, description: '1 = the first video.' }
        },
        required: ['product_id'],
        additionalProperties: false
      },
      run: (a) =>
        videoPreview(requireProduct(db, a.product_id), {
          videoId: a.video_id != null ? Number(a.video_id) : undefined,
          position: num(a.position, 1)
        })
    },
    {
      name: 'get_review_photo',
      openWorld: true,
      title: 'Review photo',
      description:
        "The photo a buyer attached to a stored Etsy review (has_photo = true in list_reviews) as an image: the app's local copy, else downloaded from Etsy's image CDN (no API quota).",
      inputSchema: {
        type: 'object',
        properties: { review_id: idArg('Review id from list_reviews.') },
        required: ['review_id'],
        additionalProperties: false
      },
      run: (a) => reviewPhoto(Number(a.review_id))
    },
    {
      name: 'set_product_mark',
      readOnly: false,
      title: "Mark a listing as made (the app's own bookkeeping)",
      description:
        "Sets the user's mark on a stored listing of a tracked shop — their own bookkeeping of which example (competitor) listings they already made their own version of: in_progress = being made (e.g. a draft prepared from it), done = we have our version, none = remove the mark. Changes only the app's database (nothing on Etsy, no API request, no sign-in and no \"allow changes\" needed); the app shows the mark on the listing and can sort and filter by it. note, our_product_id (the user's own Etsy listing made from it) and our_draft_id (the draft in the app made from it, from prepare_product): omit = keep, null = clear. When a draft named in an in_progress mark is published, the app turns the mark done by itself. Answers the listing and its mark.",
      inputSchema: {
        type: 'object',
        properties: {
          product_id: idArg('The example listing (Etsy listing id, from search_products / get_product).'),
          status: { type: 'string', enum: ['in_progress', 'done', 'none'], description: 'in_progress, done, or none (removes the mark).' },
          note: { type: 'string', maxLength: MARK_NOTE_MAX, description: `A short note shown with the mark (≤ ${MARK_NOTE_MAX} characters; "" or null clears it).` },
          our_product_id: idArg("The user's own Etsy listing made from this example (listing id); null clears it."),
          our_draft_id: idArg('The draft in the app made from this example (draft_id from prepare_product); null clears it.')
        },
        required: ['product_id', 'status'],
        additionalProperties: false
      },
      run: (a) => {
        const l = requireProduct(db, a.product_id)
        if (a.our_draft_id != null && !getDraft(db, Number(a.our_draft_id))) {
          throw new ToolInputError(`No draft ${String(a.our_draft_id)} in the app. Call list_prepared_products for the ids.`)
        }
        const status = isMarkStatus(a.status) ? a.status : null
        const pick = (k: string): number | null | undefined => (a[k] === undefined ? undefined : a[k] === null ? null : Number(a[k]))
        const mark = setListingMark(
          db,
          l.listingId,
          {
            status,
            source: 'mcp',
            ...(a.note !== undefined ? { note: (a.note as string | null) ?? null } : {}),
            ...(a.our_product_id !== undefined ? { ourListingId: pick('our_product_id') } : {}),
            ...(a.our_draft_id !== undefined ? { ourDraftId: pick('our_draft_id') } : {})
          },
          now()
        )
        deps.onMarksChanged?.([l.listingId])
        return textResult({ product_id: l.listingId, title: l.title, store_id: l.shopId, mark: markOut(mark) })
      }
    },
    {
      name: 'list_marked_products',
      title: "Listings the user marked (local)",
      description:
        "The listings the user (or you) marked with set_product_mark — the user's own record of which example listings they already made their own version of (done) or are making (in_progress) — newest change first, from the app's database: id, store, title, url (its Etsy page), status (active/removed in its shop) and the mark (note, our_product_id, our_draft_id, set_by, updated_at). Check it before making a listing from an example, so the same example isn't made twice.",
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['in_progress', 'done'], description: 'Only this mark (omit = both).' },
          store_id: idArg('Only listings of this store (omit = all stores).'),
          limit: limitArg(50, 200),
          offset: offsetArg
        },
        additionalProperties: false
      },
      run: (a) => {
        if (a.store_id != null) requireStore(db, a.store_id)
        const rows = listMarkedListings(db, {
          ...(isMarkStatus(a.status) ? { status: a.status } : {}),
          ...(a.store_id != null ? { shopId: Number(a.store_id) } : {})
        })
        const offset = num(a.offset, 0)
        const limit = num(a.limit, 50)
        return textResult({
          total: rows.length,
          offset,
          products: rows.slice(offset, offset + limit).map((r) => ({
            id: r.listingId,
            store_id: r.shopId,
            store_name: r.shopName,
            title: r.title,
            url: pageUrl(r.url),
            status: r.removedAt == null ? 'active' : 'removed',
            mark: markOut(r.mark)
          }))
        })
      }
    }
  ]

  tools.push(
    ...createStoreTools(deps.own),
    ...createDraftTools(deps.own, { db, now, onChanged: deps.onDraftsChanged, onMarksChanged: deps.onMarksChanged, pull: deps.pullDrafts })
  )
  tools.push(
    ...featureMcpTools({
      db,
      client: deps.own?.client ?? null,
      authStatus: () => deps.own?.status() ?? { loggedIn: false, redirectUri: '', pending: false, encrypted: false },
      writesAllowed: () => deps.own?.writesAllowed() ?? false,
      taxonomy: () => deps.own?.taxonomy() ?? Promise.resolve([]),
      readFile: deps.own?.readFile,
      statFile: deps.own?.statFile,
      accessToken: () => deps.own?.accessToken?.() ?? Promise.resolve(null),
      now
    })
  )

  // ------------------------------------------------- images (shared by tools)

  const imageResult = (info: Record<string, unknown>, img: { data: Buffer; mimeType: string }): McpToolResult => ({
    content: [
      { type: 'text', text: JSON.stringify(info) },
      { type: 'image', data: img.data.toString('base64'), mimeType: img.mimeType }
    ]
  })

  /** One photo of a stored listing, picked by id or position (get_product_image, open_link). */
  async function productPhoto(
    l: Listing,
    pick: { imageId?: number; position?: number; full: boolean },
    extra: Record<string, unknown> = {}
  ): Promise<McpToolResult> {
    if (!l.images.length) throw new ToolInputError(`Product ${l.listingId} has no photos.`)
    const index = pick.imageId != null ? l.images.findIndex((i) => i.id === pick.imageId) : (pick.position ?? 1) - 1
    const img = l.images[index]
    if (!img) {
      throw new ToolInputError(
        pick.imageId != null
          ? `Product ${l.listingId} has no photo ${pick.imageId}.`
          : `Product ${l.listingId} has ${l.images.length} photo(s).`
      )
    }
    // medium = the 570 px copy, else the original (a missing or AVIF copy).
    const sizes = pick.full ? ['fullxfull'] : ['570xN', 'fullxfull']
    const out = await readImage(sizes.map((size) => `etsyimg://img/${img.id}/${size}`), {
      local: true,
      tooLarge: pick.full ? `${TOO_LARGE} Ask for size "medium".` : TOO_LARGE
    })
    if ('error' in out) return errorResult(out.error)
    return imageResult(
      { ...extra, product_id: l.listingId, title: l.title, image_id: img.id, position: index + 1, of: l.images.length, alt_text: img.alt },
      out
    )
  }

  /** A tracked shop's logo or banner (get_store_logo, open_link). */
  async function storePicture(s: ShopSummary, banner: boolean, extra: Record<string, unknown> = {}): Promise<McpToolResult> {
    const has = banner ? !!s.profile?.bannerUrl : !!s.iconUrl
    if (!has) throw new ToolInputError(`Store ${s.id} has no ${banner ? 'banner' : 'logo'}.`)
    const out = await readImage([`etsyimg://shop/${s.id}/${banner ? 'banner' : 'icon'}`], { local: false })
    if ('error' in out) return errorResult(out.error)
    return imageResult({ ...extra, store_id: s.id, name: s.shopName, kind: banner ? 'banner' : 'logo' }, out)
  }

  /** The preview frame of a stored listing's video (get_product_video_preview, open_link). */
  async function videoPreview(
    l: Listing,
    pick: { videoId?: number; position?: number },
    extra: Record<string, unknown> = {}
  ): Promise<McpToolResult> {
    const videos = l.videos ?? []
    if (!videos.length) throw new ToolInputError(`Product ${l.listingId} has no videos.`)
    const index = pick.videoId != null ? videos.findIndex((v) => v.id === pick.videoId) : (pick.position ?? 1) - 1
    const v = videos[index]
    if (!v) {
      throw new ToolInputError(
        pick.videoId != null
          ? `Product ${l.listingId} has no video ${pick.videoId}.`
          : `Product ${l.listingId} has ${videos.length} video(s).`
      )
    }
    if (!v.thumbnailUrl) throw new ToolInputError(`Video ${v.id} has no preview.`)
    const out = await readImage([`etsyimg://video/${v.id}/thumbnail`], { local: false })
    if ('error' in out) return errorResult(out.error)
    return imageResult({ ...extra, product_id: l.listingId, title: l.title, video_id: v.id, position: index + 1, of: videos.length }, out)
  }

  /** A stored review's buyer photo + what the review says (get_review_photo, open_link). */
  async function reviewPhoto(id: number, extra: Record<string, unknown> = {}): Promise<McpToolResult> {
    const r = db
      .prepare(
        `SELECT r.id, r.shop_id, r.listing_id, r.rating, r.review, r.created_timestamp,
                r.image_url_fullxfull IS NOT NULL AS has_photo, l.title AS listing_title
         FROM reviews r LEFT JOIN listings l ON l.listing_id = r.listing_id WHERE r.id = ?`
      )
      .get(id) as
      | {
          id: number
          shop_id: number
          listing_id: number | null
          rating: number | null
          review: string | null
          created_timestamp: number | null
          has_photo: number
          listing_title: string | null
        }
      | undefined
    if (!r) throw new ToolInputError(`No review with id ${id}.`)
    if (!r.has_photo) throw new ToolInputError(`Review ${id} has no photo.`)
    const out = await readImage([`etsyimg://review/${id}/fullxfull`], { local: true })
    if ('error' in out) return errorResult(out.error)
    return imageResult(
      {
        ...extra,
        review_id: id,
        store_id: r.shop_id,
        product_id: r.listing_id,
        product_title: r.listing_title,
        rating: r.rating,
        text: r.review || null,
        created_at: isoSec(r.created_timestamp)
      },
      out
    )
  }

  /** A photo of a draft kept in the app (open_link). */
  async function draftPhoto(draftId: number, mediaId: number): Promise<McpToolResult> {
    const d = getDraft(db, draftId)
    if (!d) throw new ToolInputError(`No draft ${draftId} in the app (deleted?). list_prepared_products lists the drafts.`)
    const index = d.photos.findIndex((p) => p.id === mediaId)
    if (index < 0) {
      throw new ToolInputError(
        d.files.some((f) => f.id === mediaId)
          ? `Item ${mediaId} of draft ${draftId} is a buyer file, not a photo.`
          : `Draft ${draftId} has no photo ${mediaId} (it has ${d.photos.length} photo(s)).`
      )
    }
    const photo = d.photos[index]
    const out = await readImage([`etsyimg://draft/${photo.id}`], {
      local: true,
      missing: "The draft's photo could not be read from the app's database right now."
    })
    if ('error' in out) return errorResult(out.error)
    return imageResult(
      { opened: 'draft_photo', draft_id: d.id, title: d.fields.title, photo_id: photo.id, position: index + 1, of: d.photos.length, name: photo.name },
      out
    )
  }

  // ---------------------------------------------------- open_link: live reads

  /** Live Etsy reads are possible: a client and a saved API key. */
  const canLive = (): boolean => !!deps.own?.client && (deps.hasApiKey?.() ?? true)

  /** The Etsy client for live reads, or the "not in the database" refusal (no request made). */
  function liveClient(what: string): EtsyClient {
    const client = deps.own?.client
    if (!client || !canLive()) {
      throw new ToolInputError(
        `${what} is not in the app's database (its shop isn't tracked, or the app hasn't scanned it yet), and the app cannot read Etsy live right now (no API key). The user can add the shop in the app ("+ Додати магазин") and scan it.`
      )
    }
    return client
  }

  /**
   * A live read with the API key; when Etsy answers 404 / 403 and the user is
   * signed in, once more as the owner (OAuth): the user's own drafts, inactive
   * and expired listings are only visible that way (they are never in the
   * database — scans store active listings). The retry's failure keeps the
   * first answer unless the retry says 404 too.
   */
  async function ownerRetry<T>(client: EtsyClient, read: (c: EtsyClient) => Promise<T>): Promise<T> {
    try {
      return await read(client)
    } catch (e) {
      const hidden = e instanceof EtsyApiError && (e.kind === 'not_found' || (e.kind === 'auth' && e.status === 403))
      if (!hidden || !deps.own?.status().loggedIn) throw e
      const owner: EtsyClient = { ...client, call: (path, o = {}) => client.call(path, { ...o, oauth: true }) }
      try {
        return await read(owner)
      } catch (e2) {
        throw e2 instanceof EtsyApiError && e2.kind === 'not_found' ? e2 : e
      }
    }
  }

  /**
   * GET /listings/{id}?includes=Images (API key, 1 request; as the owner once
   * more for a hidden own listing); a 404 → a ToolInputError.
   */
  async function liveListing(client: EtsyClient, id: number) {
    let body: unknown
    try {
      body = await ownerRetry(client, (c) => c.call(`/v3/application/listings/${id}`, { query: { includes: 'Images' } }))
    } catch (e) {
      if (e instanceof EtsyApiError && e.kind === 'not_found') {
        throw new ToolInputError(`Etsy has no listing ${id} (deleted, or not public), and the app's database doesn't have it either.`)
      }
      throw e
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new EtsyApiError('bad_response', 'Etsy повернув неочікувану відповідь.')
    }
    const raw = body as Record<string, unknown>
    const images = (Array.isArray(raw.images) ? raw.images : []).map(toImage).filter((i) => i.id > 0).sort(byImageRank)
    return { raw, row: toListingRow(raw), images }
  }

  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(decodeHtmlEntities) : []

  async function liveProduct(id: number) {
    const { raw, row, images } = await liveListing(liveClient(`Product ${id}`), id)
    const storeId = optInt(raw.shop_id)
    return textResult({
      opened: 'product',
      source: 'live',
      note: "Not in the app's database — read live from Etsy now (1 API request on the daily quota); not tracked, so there is no history. get_product_live_details reads more of it; to track its shop, the user adds the shop in the app.",
      id: row.listingId || id,
      store_id: storeId,
      store_tracked: storeId != null && !!getShopSummary(db, storeId),
      title: row.title,
      url: row.url,
      state: row.state,
      price: row.price ? { base: priceValue(row.price.amount, row.price.divisor), base_currency: row.price.currency } : null,
      quantity: row.quantity,
      favorites: row.numFavorers,
      views: optInt(raw.views),
      featured_position: row.featuredRank,
      description: optText(raw.description),
      tags: strings(raw.tags),
      materials: strings(raw.materials),
      product_type: productType(typeof raw.listing_type === 'string' ? raw.listing_type : null),
      created_at: isoSec(optInt(raw.original_creation_timestamp) ?? optInt(raw.created_timestamp)),
      listed_at: isoSec(optInt(raw.created_timestamp)),
      updated_at: isoSec(optInt(raw.updated_timestamp)),
      images: images.map((i, n) => ({
        image_id: i.id,
        position: n + 1,
        width: i.width,
        height: i.height,
        alt_text: i.altText,
        /** open_link with this shows the photo. */
        link: photoRef(row.listingId || id, i.id)
      }))
    })
  }

  /** `stored` = the listing as the app's database has it (the photo isn't among its photos). */
  async function livePhoto(productId: number, imageId: number, full: boolean, stored?: Listing): Promise<McpToolResult> {
    const client = liveClient(`Product ${productId}`)
    let live: Awaited<ReturnType<typeof liveListing>>
    try {
      live = await liveListing(client, productId)
    } catch (e) {
      if (stored && e instanceof ToolInputError) {
        throw new ToolInputError(
          `Product ${productId} is in the app's database but has no photo ${imageId} there (it has ${stored.images.length} photo(s): ${stored.images.map((i) => i.id).join(', ') || 'none'}), and Etsy has no listing ${productId} now (deleted, or not public), so the photo can't be read live either.`
        )
      }
      throw e
    }
    const { row, images } = live
    const index = images.findIndex((i) => i.id === imageId)
    const img = images[index]
    if (!img) {
      throw new ToolInputError(
        `Etsy listing ${productId} has no photo ${imageId} now (it has ${images.length} photo(s): ${images.map((i) => i.id).join(', ') || 'none'}).`
      )
    }
    const urls = (full ? [img.urlFull] : [img.url570, img.urlFull]).filter((u) => !!u)
    const out = await readImage(urls, {
      local: false,
      tooLarge: full ? `${TOO_LARGE} Ask for size "medium".` : TOO_LARGE
    })
    if ('error' in out) return errorResult(out.error)
    return imageResult(
      { opened: 'photo', source: 'live', product_id: productId, title: row.title, image_id: img.id, position: index + 1, of: images.length, alt_text: img.altText },
      out
    )
  }

  async function liveVideo(productId: number, videoId: number, stored?: Listing): Promise<McpToolResult> {
    const client = liveClient(`Product ${productId}`)
    let v: Awaited<ReturnType<typeof listingVideo>>
    try {
      v = await ownerRetry(client, (c) => listingVideo(c, productId, videoId))
    } catch (e) {
      if (e instanceof EtsyApiError && e.kind === 'not_found') {
        const had = stored ? ` The app's database has listing ${productId} without that video (its videos: ${(stored.videos ?? []).map((x) => x.id).join(', ') || 'none'}).` : ''
        throw new ToolInputError(`Etsy has no video ${videoId} of listing ${productId} (or no such listing now).${had}`)
      }
      throw e
    }
    if (!v.thumbnailUrl) throw new ToolInputError(`Video ${videoId} has no preview.`)
    const out = await readImage([v.thumbnailUrl], { local: false })
    if ('error' in out) return errorResult(out.error)
    return imageResult({ opened: 'video_preview', source: 'live', product_id: productId, video_id: v.id || videoId }, out)
  }

  /** open_link: one reference → what it points at. */
  async function openRef(ref: ClaudeRef, full: boolean): Promise<McpToolResult> {
    const local = { source: 'local' }
    switch (ref.kind) {
      case 'product': {
        const l = getListing(db, ref.productId)
        if (!l) return liveProduct(ref.productId)
        const shop = getShopSummary(db, l.shopId)
        return textResult({ opened: 'product', ...local, ...productFull(l, newProductIds(db, shop), shop?.shopName ?? null) })
      }
      case 'photo': {
        const l = getListing(db, ref.productId)
        // Not stored, or a photo added since the latest scan: Etsy live (when the app can).
        if (l && (l.images.some((i) => i.id === ref.imageId) || !canLive())) {
          return productPhoto(l, { imageId: ref.imageId, full }, { opened: 'photo', ...local })
        }
        return livePhoto(ref.productId, ref.imageId, full, l ?? undefined)
      }
      case 'video': {
        const l = getListing(db, ref.productId)
        if (l && ((l.videos ?? []).some((v) => v.id === ref.videoId) || !canLive())) {
          return videoPreview(l, { videoId: ref.videoId }, { opened: 'video_preview', ...local })
        }
        return liveVideo(ref.productId, ref.videoId, l ?? undefined)
      }
      case 'reviewPhoto':
        return reviewPhoto(ref.reviewId, { opened: 'review_photo' })
      case 'store': {
        const s = getShopSummary(db, ref.storeId)
        if (!s) throw new ToolInputError(`No tracked store with id ${ref.storeId}. list_stores lists the tracked shops.`)
        return textResult({ opened: 'store', ...storeFull(s, mine()) })
      }
      case 'storeImage': {
        const s = getShopSummary(db, ref.storeId)
        if (!s) throw new ToolInputError(`No tracked store with id ${ref.storeId}. list_stores lists the tracked shops.`)
        return storePicture(s, ref.image === 'banner', { opened: ref.image === 'banner' ? 'store_banner' : 'store_logo' })
      }
      case 'storeName': {
        const name = ref.name.toLowerCase()
        const s = listShopSummaries(db).find((x) => x.shopName.toLowerCase() === name)
        if (!s) {
          throw new ToolInputError(
            `The Etsy shop "${ref.name}" is not tracked in the app, so the app has no data about it. The live tools (search_market, get_store_sections, get_store_featured …) can read Etsy now; to track it, the user adds it in the app ("+ Додати магазин").`
          )
        }
        return textResult({ opened: 'store', ...storeFull(s, mine()) })
      }
      case 'draft': {
        const d = getDraft(db, ref.draftId)
        if (!d) throw new ToolInputError(`No draft ${ref.draftId} in the app (deleted?). list_prepared_products lists the drafts.`)
        return textResult({ opened: 'draft', ...draftOut(d) })
      }
      case 'draftPhoto':
        return draftPhoto(ref.draftId, ref.mediaId)
    }
  }

  /**
   * The first of `urls` that reads as a showable image of an acceptable size:
   * `etsyimg://…` through the app's image handler, an https Etsy CDN URL
   * (isEtsyCdnUrl only) through fetchCdnImage. `local`: the app may have its
   * own copy (listing and review photos); else the image only ever comes from
   * Etsy's CDN. `tooLarge` / `missing`: the tool's own messages.
   */
  async function readImage(
    urls: string[],
    opts: { local: boolean; tooLarge?: string; missing?: string }
  ): Promise<{ data: Buffer; mimeType: string } | { error: string }> {
    let unsupported: string | null = null
    let tooLarge = false
    for (const url of urls) {
      const read = url.startsWith('etsyimg://')
        ? deps.readImage
        : isEtsyCdnUrl(url)
          ? deps.fetchCdnImage
          : undefined
      const img = read ? await read(url).catch(() => null) : null
      if (!img) continue
      const mimeType = imageMime(img.mimeType)
      if (!MCP_IMAGE_TYPES.includes(mimeType)) unsupported = mimeType
      else if (img.data.length > MCP_MAX_IMAGE_BYTES) tooLarge = true
      else return { data: img.data, mimeType }
    }
    if (tooLarge) return { error: opts.tooLarge ?? TOO_LARGE }
    if (unsupported) return { error: `The image is only available as ${unsupported}, which cannot be returned as an image.` }
    return {
      error:
        opts.missing ??
        (opts.local
          ? "The image is not available right now (no local copy, and it could not be downloaded from Etsy's image CDN)."
          : "The image could not be downloaded from Etsy's image CDN right now.")
    }
  }

  return tools
}

export function mcpServerInfo(version: string): McpServerInfo {
  return { name: MCP_SERVER_NAME, title: 'Etsy Tracker', version, instructions: MCP_INSTRUCTIONS }
}
