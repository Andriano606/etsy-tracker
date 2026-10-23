// The MCP server's read-only tools over the app's database. Everything a
// client sees is neutral on purpose: "store", "product", "snapshot" (a scan),
// "discount" (a promotion), "customer price" (Etsy's buyer price) — no
// marketplace name, no marketplace URLs (listing/shop links, CDN image URLs),
// no raw API JSON. Free text from the data itself (descriptions, policies,
// reviews…) goes through `neutralText`. tests/main/mcpTools.test.ts asserts
// that no "etsy" reaches a client anywhere.

import type {
  BuyerPrice,
  Listing,
  ListingDetails,
  ListingImage,
  MoneyValue,
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
import {
  type Db,
  getListing,
  getScan,
  getShopSummary,
  listActiveListings,
  listAllListings,
  listListingPromotions,
  listListingStats,
  listNewReviews,
  listScanChanges,
  listScanPromotions,
  listScans,
  listShopSummaries
} from './db'
import { type McpServerInfo, type McpTool, ToolInputError, errorResult, textResult } from './mcpProtocol'
import { shopStatsPayload } from './shopStats'

export interface McpToolDeps {
  db: Db
  now?: () => number
  /**
   * Bytes of an app image URL (`etsyimg://img/{id}/{size}`, `etsyimg://review/{id}/fullxfull`)
   * — the image protocol handler in the app; null = not available.
   */
  readImage?: (url: string) => Promise<{ data: Buffer; mimeType: string } | null>
}

/** Larger images are refused (base64 in a model's context). */
export const MCP_MAX_IMAGE_BYTES = 5 * 1024 * 1024

// ------------------------------------------------------------- neutral output

const MARKET_URL = /(?:https?:\/\/)?(?:[\w-]+\.)*(?:etsy\.com|etsy\.me|etsystatic\.com)(?:\/[^\s<>"')\]]*)?/gi
const MARKET_WORD = /(?<![a-z])etsy/gi

/** Free text with the marketplace's links and name taken out. */
export function neutralText(s: string): string
export function neutralText(s: string | null | undefined): string | null
export function neutralText(s: string | null | undefined): string | null {
  if (s == null) return null
  return s.replace(MARKET_URL, '[link]').replace(MARKET_WORD, 'marketplace')
}

const n = neutralText
const list = (a: readonly string[] | null | undefined): string[] => (a ?? []).map((s) => n(s))
const isoSec = (s: number | null | undefined): string | null => (s == null ? null : new Date(s * 1000).toISOString())
const isoMs = (ms: number | null | undefined): string | null => (ms == null ? null : new Date(ms).toISOString())
const val = (m: MoneyValue | null | undefined): number | null => (m ? priceValue(m.amount, m.divisor) : null)
const featured = (r: number | null | undefined): number | null => (r != null && r >= 1 ? r : null)
const productType = (t: string | null | undefined): string | null => (t === 'download' ? 'digital' : (t ?? null))

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

function productSummary(l: Listing, newIds: ReadonlySet<number>) {
  return {
    id: l.listingId,
    store_id: l.shopId,
    title: n(l.title),
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
    new_in_latest_snapshot: newIds.has(l.listingId)
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
    digital_files: n(d.fileData),
    taxable: d.isTaxable,
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
    alt_text: n(img.alt),
    color_hex: img.hexCode ?? null,
    is_black_and_white: img.isBlackAndWhite ?? null,
    added_at: isoSec(img.createdAt)
  }
}

function productFull(l: Listing, newIds: ReadonlySet<number>, storeName: string | null) {
  const d = l.details ?? null
  return {
    ...productSummary(l, newIds),
    store_name: n(storeName),
    price: priceFull(l),
    state: l.state ?? null,
    description: n(l.description),
    tags: list(l.tags),
    materials: list(d?.materials),
    styles: list(d?.styles),
    attributes: attributes(d),
    personalization_questions: d?.personalization
      ? d.personalization.map((q) => ({
          question: n(q.text),
          instructions: n(q.instructions),
          type: q.type,
          required: q.required,
          max_chars: q.maxChars,
          max_files: q.maxFiles,
          options: list(q.options)
        }))
      : null,
    images: l.images.map(imageOf),
    video_count: l.videos?.length ?? 0,
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
    /** Very large store: only the first ≈12 000 products were read, removals not detected. */
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

function storeSummary(s: ShopSummary) {
  const p = s.profile ?? null
  return {
    id: s.id,
    name: n(s.shopName),
    title: n(s.title),
    currency: s.currency,
    active_products: s.activeCount,
    sales_count: s.stats?.transactionSoldCount ?? p?.transactionSoldCount ?? null,
    rating: s.stats?.reviewAverage ?? p?.reviewAverage ?? null,
    review_count: s.stats?.reviewCount ?? p?.reviewCount ?? null,
    favorites: s.stats?.numFavorers ?? p?.numFavorers ?? null,
    country: p?.countryIso ?? null,
    opened_at: isoSec(p?.etsyCreatedAt),
    tracked_since: isoMs(s.addedAt),
    new_products_in_latest_snapshot: s.newCount,
    latest_snapshot: s.lastOkScan ? snapshotOf(s.lastOkScan) : null,
    latest_update_failed: s.lastScan?.status === 'error'
  }
}

function storeFull(s: ShopSummary) {
  const p = s.profile ?? null
  const r = s.reviews ?? null
  return {
    ...storeSummary(s),
    owner_username: n(p?.loginName),
    announcement: n(p?.announcement),
    sale_message: n(p?.saleMessage),
    digital_sale_message: n(p?.digitalSaleMessage),
    on_vacation: p?.isVacation ?? null,
    vacation_message: n(p?.vacationMessage),
    vacation_autoreply: n(p?.vacationAutoreply),
    accepts_custom_requests: p?.acceptsCustomRequests ?? null,
    languages: p?.languages ?? [],
    ships_from_country: p?.shippingFromCountryIso ?? null,
    digital_products: p?.digitalListingCount ?? null,
    updated_at: isoSec(p?.etsyUpdatedAt),
    policies: p
      ? {
          welcome: n(p.policies.welcome),
          payment: n(p.policies.payment),
          shipping: n(p.policies.shipping),
          refunds: n(p.policies.refunds),
          additional: n(p.policies.additional),
          seller_info: n(p.policies.sellerInfo),
          privacy: n(p.policies.privacy),
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
    product_title: n(r.listing_title),
    rating: r.rating,
    text: n(r.review) || null,
    language: r.language,
    has_photo: !!r.has_photo,
    created_at: isoSec(r.created_timestamp),
    updated_at: isoSec(r.updated_timestamp),
    /** Found by a snapshot after the store's review history was loaded (not part of the initial history). */
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
    product_title: n(p.listingTitle ?? null),
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

/** A change row's tracked fields with neutral names. */
export function neutralFields(t: TrackedFields | null | undefined): Record<string, unknown> | null {
  if (!t) return null
  const o: Record<string, unknown> = {}
  if ('title' in t) o.title = n(t.title ?? null)
  if ('priceAmount' in t || 'currency' in t) {
    o.base_price = t.priceAmount != null && t.priceDivisor ? priceValue(t.priceAmount, t.priceDivisor) : null
    o.base_currency = t.currency ?? null
  }
  if ('description' in t) o.description = n(t.description ?? null)
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
      ? t.personalization.map((q) => ({ question: n(q.text), required: q.required, type: q.type }))
      : null
  }
  if ('dimensions' in t) o.weight_and_dimensions = n(t.dimensions ?? null)
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
  title: n(r.title),
  start: r.start,
  end: r.end,
  change: r.delta
})

// -------------------------------------------------------------------- queries

/** Products added by the store's latest successful snapshot. */
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
    const after = neutralFields(parse(r.new_value))
    return {
      snapshot_id: r.scan_id,
      at: isoMs(r.finished_at),
      kind: r.kind,
      ...(r.kind === 'changed'
        ? { changed_fields: Object.keys(after ?? {}), before: neutralFields(parse(r.old_value)), after }
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
  biggest_discount: 'discount'
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

export const MCP_INSTRUCTIONS = `Read-only access to a local catalog of online stores that the user follows (competitor and market research).

How the data is collected: the user's app takes periodic snapshots of each store. A snapshot records every active product of the store (title, description, price, tags, materials, photos, attributes, popularity numbers) and what changed since the previous snapshot: products added, removed, returned, or edited (and which fields). Customer reviews of each store are stored too and linked to the reviewed product. Nothing here is live — every number is as of the latest snapshot (see latest_snapshot.finished_at).

Where to start: list_stores → get_store / search_products → get_product. "What is new?" → get_snapshot_changes. Trends → get_store_stats and get_product_history. To look at a product, call get_product_image.

Prices: "base" is the seller's own price before tax and discounts. "current" is what a customer in customer_country pays now (tax included, discount applied when one runs); it equals "base" when no customer price is known. "regular" is the customer price before the discount. Currencies are never converted.

Popularity: favorites = how many people saved the product; views = total views (updated about once a day); featured_position = position among the products the store features (null = not featured). *_change fields compare the latest snapshot with the previous one. Store sales_count is the store's total number of sales; per-product sales are not available — review counts are the best proxy for how often a product sells.

Ids: store ids, product ids, image ids, review ids and snapshot ids are stable numbers. Times are ISO 8601 UTC.`

export function createMcpTools(deps: McpToolDeps): McpTool[] {
  const { db } = deps
  const now = deps.now ?? Date.now

  const tools: McpTool[] = [
    {
      name: 'list_stores',
      title: 'List stores',
      description:
        'All stores the user follows, with their headline numbers (active products, total sales, rating, review count, favorites) and the latest snapshot (when it was taken, how many products were added/removed/changed). Start here to get store ids.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => {
        const stores = listShopSummaries(db).map(storeSummary)
        return textResult({ count: stores.length, stores })
      }
    },
    {
      name: 'get_store',
      title: 'Store profile',
      description:
        "One store's full profile: announcement, messages to buyers, vacation status, policies (shipping, payment, refunds, …), languages, country, headline numbers at the latest snapshot and their change since the previous one, and what is known about its stored reviews.",
      inputSchema: {
        type: 'object',
        properties: { store_id: idArg('Store id from list_stores.') },
        required: ['store_id'],
        additionalProperties: false
      },
      run: (a) => textResult(storeFull(requireStore(db, a.store_id)))
    },
    {
      name: 'search_products',
      title: 'Search products',
      description:
        "Find products: in one store or across all stores, by text (title, tags, optionally description), with sorting (newest, price, most favorited/viewed/reviewed, favorites growth, new reviews, biggest discount) and paging. Returns compact product summaries (price, popularity, reviews, flags like new_in_latest_snapshot); call get_product for everything about one product.",
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
            description: 'active = currently offered; removed = no longer offered by the store (kept with their last known data).'
          },
          on_sale_only: { type: 'boolean', default: false, description: 'Only products with a running discount.' },
          new_only: {
            type: 'boolean',
            default: false,
            description: "Only products added by their store's latest snapshot."
          },
          sort: {
            type: 'string',
            enum: Object.keys(SORTS),
            default: 'newest',
            description: 'newest = most recently created first. Price sorts use the current price (currencies are not converted).'
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
          searchDescription: !!a.search_description
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
      title: 'Product details',
      description:
        'Everything stored about one product: title, full description, tags, materials, styles, price (base, customer price, discount and its dates, shipping), stock quantity, popularity, review summary, attributes (type, who made it, when, processing time, weight/dimensions, variations, personalization questions), photos (ids, sizes, alt text, colors) and dates (created, first/last seen, removed).',
      inputSchema: {
        type: 'object',
        properties: { product_id: idArg('Product id.') },
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
      title: 'Product history',
      description:
        "One product over time: its popularity, stock, review count and prices at every snapshot (oldest first), its discounts (start/end, percent, prices) and every recorded change (added, edited — with the fields' old and new values —, removed, returned).",
      inputSchema: {
        type: 'object',
        properties: {
          product_id: idArg('Product id.'),
          limit: { ...limitArg(100, 1000), description: 'Most recent snapshots to include (default 100, max 1000).' }
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
          title: n(l.title),
          snapshot_count: points.length,
          snapshots,
          discounts: listListingPromotions(db, l.listingId).map(discountOf),
          changes: productChanges(db, l.listingId)
        })
      }
    },
    {
      name: 'list_snapshots',
      title: 'Snapshot history',
      description:
        "A store's snapshots, newest first: when each was taken, whether it succeeded, how many products it saw and how many were added, removed, changed, returned, and discounts started/ended.",
      inputSchema: {
        type: 'object',
        properties: { store_id: idArg('Store id.'), limit: limitArg(50, 500) },
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
      title: 'What changed',
      description:
        "What one snapshot found compared with the store's previous snapshot: new products, removed products, products that came back, edited products (which fields, old → new values), new customer reviews, and discounts that started or ended. Defaults to the latest successful snapshot — i.e. \"what is new in this store\". The first snapshot of a store has no changes (everything was new).",
      inputSchema: {
        type: 'object',
        properties: {
          store_id: idArg('Store id.'),
          snapshot_id: idArg('A snapshot of that store (list_snapshots); omit = the latest successful one.'),
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
          return textResult({ store_id: s.id, snapshot: snapshotOf(scan), note: 'This snapshot did not succeed; it recorded no changes.' })
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
            const after = neutralFields(c.newValue)
            return {
              product_id: c.listingId,
              title: n(c.listing?.title ?? null),
              changed_fields: Object.keys(after ?? {}),
              before: neutralFields(c.oldValue),
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
      title: 'Customer reviews',
      description:
        "Customer reviews (rating 1–5, text, language, date, whether a photo is attached, the reviewed product), of one product, one store, or all stores. Filter by rating range, date range, text; sort by date or rating; paged. Review counts per product are the best available proxy for how often it sells.",
      inputSchema: {
        type: 'object',
        properties: {
          store_id: idArg('Only this store.'),
          product_id: idArg('Only this product.'),
          min_rating: { type: 'integer', minimum: 1, maximum: 5, description: 'Lowest rating to include.' },
          max_rating: { type: 'integer', minimum: 1, maximum: 5, description: 'Highest rating to include.' },
          since: { type: 'string', maxLength: 40, description: 'Created at or after this ISO date/time.' },
          until: { type: 'string', maxLength: 40, description: 'Created at or before this ISO date/time.' },
          query: { type: 'string', maxLength: 200, description: 'Case-insensitive text the review must contain.' },
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
      title: 'Store trends',
      description:
        "A store's numbers over time for a period: per snapshot (sales count, favorites, reviews, rating, active products, total product views/favorites, discounted products, added/removed/changed), the change between consecutive snapshots, sales per day, customer reviews per week or month (count, average, ratings 1–5), and the products that grew most in views, favorites and reviews.",
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
      title: 'Product photo',
      description:
        "Returns one photo of a product as an image you can look at. Pick it by image_id (from get_product) or position (1 = the main photo). size: medium (≈570 px wide, the default) or full (the original, can be large).",
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
      run: async (a) => {
        const l = requireProduct(db, a.product_id)
        if (!l.images.length) throw new ToolInputError(`Product ${l.listingId} has no photos.`)
        const index =
          a.image_id != null ? l.images.findIndex((i) => i.id === Number(a.image_id)) : num(a.position, 1) - 1
        const img = l.images[index]
        if (!img) {
          throw new ToolInputError(
            a.image_id != null
              ? `Product ${l.listingId} has no photo ${String(a.image_id)}.`
              : `Product ${l.listingId} has ${l.images.length} photo(s).`
          )
        }
        const size = a.size === 'full' ? 'fullxfull' : '570xN'
        const out = await readImage(`etsyimg://img/${img.id}/${size}`)
        if ('error' in out) return errorResult(out.error)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                product_id: l.listingId,
                title: n(l.title),
                image_id: img.id,
                position: index + 1,
                of: l.images.length,
                alt_text: n(img.alt)
              })
            },
            { type: 'image', data: out.data.toString('base64'), mimeType: out.mimeType }
          ]
        }
      }
    },
    {
      name: 'get_review_photo',
      title: 'Review photo',
      description: 'Returns the photo a customer attached to a review (has_photo = true in list_reviews) as an image.',
      inputSchema: {
        type: 'object',
        properties: { review_id: idArg('Review id from list_reviews.') },
        required: ['review_id'],
        additionalProperties: false
      },
      run: async (a) => {
        const id = Number(a.review_id)
        const r = db
          .prepare('SELECT id, image_url_fullxfull IS NOT NULL AS has_photo FROM reviews WHERE id = ?')
          .get(id) as { id: number; has_photo: number } | undefined
        if (!r) throw new ToolInputError(`No review with id ${id}.`)
        if (!r.has_photo) throw new ToolInputError(`Review ${id} has no photo.`)
        const out = await readImage(`etsyimg://review/${id}/fullxfull`)
        if ('error' in out) return errorResult(out.error)
        return {
          content: [
            { type: 'text', text: JSON.stringify({ review_id: id }) },
            { type: 'image', data: out.data.toString('base64'), mimeType: out.mimeType }
          ]
        }
      }
    }
  ]

  async function readImage(url: string): Promise<{ data: Buffer; mimeType: string } | { error: string }> {
    const img = deps.readImage ? await deps.readImage(url).catch(() => null) : null
    if (!img) return { error: 'The photo is not available right now (not stored locally and could not be downloaded).' }
    if (img.data.length > MCP_MAX_IMAGE_BYTES) {
      return { error: 'The photo is too large to return; ask for size "medium".' }
    }
    return img
  }

  return tools
}

export function mcpServerInfo(version: string): McpServerInfo {
  return { name: MCP_SERVER_NAME, title: 'Shop Catalog', version, instructions: MCP_INSTRUCTIONS }
}
