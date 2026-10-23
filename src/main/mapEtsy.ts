import type {
  BuyerPrice,
  ListingDetails,
  MoneyValue,
  ListingImage,
  ListingVideo,
  PersonalizationQuestion,
  ShopProfile,
  ShopStats
} from '../shared/types'
import { decodeHtmlEntities } from '../shared/html'
import { isEtsyCdnUrl } from '../shared/externalUrl'
import { shopUrlFor } from '../shared/shopUrl'
import type { ListingInput, ListingStatsInput, ReviewInput, ShopInput } from './db'
import type {
  EtsyListing,
  EtsyListingBuyerPrice,
  EtsyListingImage,
  EtsyListingVideo,
  EtsyListingWithAssociations,
  EtsyPersonalization,
  EtsyShop,
  EtsyTransactionReview
} from './etsyApi'

function int(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function optInt(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function optNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function optStr(v: unknown): string | null {
  return v == null ? null : String(v)
}

/** Free text from Etsy (entities decoded); null stays null. */
function optText(v: unknown): string | null {
  return v == null ? null : decodeHtmlEntities(String(v))
}

function optBool(v: unknown): boolean | null {
  return v == null ? null : !!v
}

function strList(v: unknown, decode = true): string[] {
  if (!Array.isArray(v)) return []
  return v.map((t) => (decode ? decodeHtmlEntities(String(t)) : String(t)))
}

/** An image URL is kept only when it is https on Etsy's CDN (main fetches it). */
const cdnUrl = (u: unknown): string => (typeof u === 'string' && isEtsyCdnUrl(u) ? u : '')

export function mapImage(i: EtsyListingImage): ListingImage {
  return {
    id: int(i.listing_image_id),
    rank: int(i.rank),
    url75: cdnUrl(i.url_75x75),
    url170: cdnUrl(i.url_170x135),
    url570: cdnUrl(i.url_570xN),
    urlFull: cdnUrl(i.url_fullxfull),
    width: optInt(i.full_width),
    height: optInt(i.full_height),
    alt: i.alt_text ?? null,
    hexCode: optStr(i.hex_code),
    red: optInt(i.red),
    green: optInt(i.green),
    blue: optInt(i.blue),
    hue: optInt(i.hue),
    saturation: optInt(i.saturation),
    brightness: optInt(i.brightness),
    isBlackAndWhite: optBool(i.is_black_and_white),
    createdAt: optInt(i.created_timestamp ?? i.creation_tsz)
  }
}

export function mapImages(images: EtsyListingImage[] | undefined | null): ListingImage[] {
  if (!Array.isArray(images)) return []
  return [...images]
    .sort((a, b) => int(a.rank, 999) - int(b.rank, 999) || int(a.listing_image_id) - int(b.listing_image_id))
    .map(mapImage)
}

export function mapVideos(videos: EtsyListingVideo[] | undefined | null): ListingVideo[] {
  if (!Array.isArray(videos)) return []
  return videos
    .filter((v) => v && v.video_id != null)
    .map((v) => ({
      id: int(v.video_id),
      width: optInt(v.width),
      height: optInt(v.height),
      thumbnailUrl: optStr(v.thumbnail_url),
      videoUrl: optStr(v.video_url),
      state: optStr(v.video_state)
    }))
}

export function mapPersonalization(
  p: EtsyPersonalization | null | undefined
): PersonalizationQuestion[] | null {
  if (!p || !Array.isArray(p.personalization_questions)) return null
  return p.personalization_questions.map((q) => ({
    questionId: optInt(q.question_id),
    text: decodeHtmlEntities(String(q.question_text ?? '')),
    instructions: optText(q.instructions),
    type: optStr(q.question_type),
    required: !!q.required,
    maxChars: optInt(q.max_allowed_characters),
    maxFiles: optInt(q.max_allowed_files),
    options: Array.isArray(q.options) ? q.options.map((o) => decodeHtmlEntities(String(o?.label ?? ''))) : []
  }))
}

/** Every useful scalar of a ShopListing(WithAssociations) beyond the basics. */
export function mapListingDetails(l: EtsyListing | EtsyListingWithAssociations): ListingDetails {
  const withAssoc = l as EtsyListingWithAssociations
  return {
    userId: optInt(l.user_id),
    shopSectionId: optInt(l.shop_section_id),
    taxonomyId: optInt(l.taxonomy_id),
    listingType: optStr(l.listing_type),
    whoMade: optStr(l.who_made),
    whenMade: optStr(l.when_made),
    isSupply: optBool(l.is_supply),
    materials: strList(l.materials),
    styles: strList(l.style),
    skus: strList(withAssoc.skus, false),
    processingMin: optInt(l.processing_min),
    processingMax: optInt(l.processing_max),
    isCustomizable: optBool(l.is_customizable),
    isPersonalizable: optBool(l.is_personalizable),
    personalization: mapPersonalization(withAssoc.personalization),
    hasVariations: optBool(l.has_variations),
    isPrivate: optBool(l.is_private),
    isTaxable: optBool(l.is_taxable),
    nonTaxable: optBool(l.non_taxable),
    shouldAutoRenew: optBool(l.should_auto_renew),
    fileData: optStr(l.file_data),
    language: optStr(l.language),
    shippingProfileId: optInt(l.shipping_profile_id),
    returnPolicyId: optInt(l.return_policy_id),
    readinessStateId: optInt(l.readiness_state_id),
    itemWeight: optNum(l.item_weight),
    itemWeightUnit: optStr(l.item_weight_unit),
    itemLength: optNum(l.item_length),
    itemWidth: optNum(l.item_width),
    itemHeight: optNum(l.item_height),
    itemDimensionsUnit: optStr(l.item_dimensions_unit),
    originalCreatedAt: optInt(l.original_creation_timestamp),
    endingAt: optInt(l.ending_timestamp),
    stateAt: optInt(l.state_timestamp)
  }
}

/** An Etsy Money as amount + divisor (exact, no floats); null when absent or malformed. */
export function mapMoney(m: unknown): MoneyValue | null {
  if (!m || typeof m !== 'object') return null
  const o = m as { amount?: unknown; divisor?: unknown }
  const amount = optInt(o.amount)
  if (amount == null) return null
  return { amount, divisor: int(o.divisor, 100) || 100 }
}

/**
 * OAS `ListingBuyerPrice` → our record, for the buyer country it was asked
 * for. null when Etsy sent none (null / not an object). The currency is taken
 * once from original_price (else base/discounted price) — Etsy computes the
 * whole set in one currency.
 */
export function mapBuyerPrice(bp: unknown, country: string, fetchedAt?: number): BuyerPrice | null {
  if (!bp || typeof bp !== 'object' || Array.isArray(bp)) return null
  const b = bp as EtsyListingBuyerPrice
  const currency =
    [b.original_price, b.base_price, b.discounted_price, b.discount_amount].find(
      (m) => m && typeof m.currency_code === 'string' && m.currency_code
    )?.currency_code ?? ''
  const discounted = mapMoney(b.discounted_price)
  return {
    country,
    currency,
    base: mapMoney(b.base_price),
    original: mapMoney(b.original_price),
    discounted,
    discountAmount: mapMoney(b.discount_amount),
    discountPercentage: optInt(b.discount_percentage),
    // OAS: has_discount = "an active promotion applies"; without a sale price there is nothing to show.
    hasDiscount: b.has_discount === true && discounted != null,
    discountStart: optInt(b.discount_start_epoch),
    discountEnd: optInt(b.discount_end_epoch),
    shipping: mapMoney(b.shipping_cost),
    isFreeShipping: optBool(b.is_free_shipping),
    ...(fetchedAt != null ? { fetchedAt } : {})
  }
}

/** How the details of a scan were asked for buyer prices. */
export interface BuyerPriceRequest {
  /** The buyer country BuyerPrice was requested for (null = never requested). */
  country: string | null
  /**
   * BuyerPrice is still being requested at the end of the details calls
   * (false once the client found Etsy refusing it — later answers lack it).
   */
  asked: boolean
  /** When it was learned (ms). */
  at?: number
}

/**
 * The buyer price of a details answer, as `ListingInput.buyerPrice`:
 * - an object = the fresh price for `req.country` (`buyer_price` present);
 * - null = known to be unavailable → clear: Etsy sent `buyer_price: null`, or
 *   the key is absent while BuyerPrice isn't requested (no buyer country /
 *   Etsy refused it) — a stored one would only go stale;
 * - undefined = not learned this scan → keep the stored one: no details
 *   answer, or BuyerPrice was requested but the object has no `buyer_price`
 *   key (GET /listings/{id}: "currently only supported on /listings/batch").
 */
export function buyerPriceOf(
  details: EtsyListingWithAssociations | null | undefined,
  req: BuyerPriceRequest | null | undefined
): BuyerPrice | null | undefined {
  if (!details) return undefined
  if (details.buyer_price !== undefined && 'buyer_price' in details) {
    return req?.country ? mapBuyerPrice(details.buyer_price, req.country, req.at) : null
  }
  return req?.country && req.asked ? undefined : null
}

/**
 * Map an Etsy listing. `page` is the item from /shops/{id}/listings/active
 * (no associations); `details` the /listings/batch object with Images, Videos
 * and Personalization, or null when that call did not answer for it — then
 * images/videos are null (keep the stored ones), personalization/skus are kept
 * from the DB, and views come from the page item (null = keep the stored ones).
 *
 * `includes` = the includes the details call was made with
 * (`client.detailIncludes()`): personalization only counts as answered when
 * the object carries the key or `Personalization` was requested — after the
 * Images-only fallback a missing key means "not asked", not "none".
 * `buyer` = how BuyerPrice was requested (see `buyerPriceOf`).
 */
export function mapListing(
  page: EtsyListing,
  details: EtsyListingWithAssociations | null | undefined,
  shopCurrency?: string | null,
  includes?: readonly string[],
  buyer?: BuyerPriceRequest | null
): ListingInput {
  const l: EtsyListingWithAssociations = details ?? page
  const personalizationFetched =
    !!details && ('personalization' in details || !!includes?.includes('Personalization'))
  const price = l.price ?? { amount: 0, divisor: 100, currency_code: shopCurrency ?? '' }
  return {
    listingId: int(l.listing_id),
    shopId: int(l.shop_id),
    title: decodeHtmlEntities(String(l.title ?? '')),
    description: decodeHtmlEntities(String(l.description ?? '')),
    priceAmount: int(price.amount),
    priceDivisor: int(price.divisor, 100) || 100,
    currency: price.currency_code || shopCurrency || '',
    url: String(l.url ?? `https://www.etsy.com/listing/${l.listing_id}`),
    tags: strList(l.tags),
    quantity: int(l.quantity),
    etsyCreatedAt: optInt(
      l.created_timestamp ?? l.creation_timestamp ?? l.original_creation_timestamp
    ),
    etsyUpdatedAt: optInt(l.updated_timestamp ?? l.last_modified_timestamp),
    state: optStr(l.state),
    // Live, the /listings/active page items carry `views` too (same value as
    // the details) — so a listing whose details did not answer still has it.
    views: optInt(l.views ?? page.views),
    numFavorers: optInt(l.num_favorers),
    featuredRank: optInt(l.featured_rank),
    details: mapListingDetails(l),
    images: details ? mapImages(details.images ?? []) : null,
    // Videos only when Etsy returned the association (an older include set may lack it).
    videos: details && Array.isArray(details.videos) ? mapVideos(details.videos) : null,
    rawJson: JSON.stringify(l),
    detailsFetched: !!details,
    personalizationFetched,
    buyerPrice: buyerPriceOf(details, buyer)
  }
}

export function listingStats(l: ListingInput): ListingStatsInput {
  return {
    listingId: l.listingId,
    views: l.views ?? null,
    numFavorers: l.numFavorers ?? null,
    featuredRank: l.featuredRank ?? null,
    quantity: l.quantity
  }
}

export function mapShopProfile(s: EtsyShop): ShopProfile {
  return {
    userId: optInt(s.user_id),
    loginName: optStr(s.login_name),
    announcement: optText(s.announcement),
    saleMessage: optText(s.sale_message),
    digitalSaleMessage: optText(s.digital_sale_message),
    isVacation: optBool(s.is_vacation),
    vacationMessage: optText(s.vacation_message),
    vacationAutoreply: optText(s.vacation_autoreply),
    numFavorers: optInt(s.num_favorers),
    transactionSoldCount: optInt(s.transaction_sold_count),
    reviewCount: optInt(s.review_count),
    reviewAverage: optNum(s.review_average),
    digitalListingCount: optInt(s.digital_listing_count),
    acceptsCustomRequests: optBool(s.accepts_custom_requests),
    languages: strList(s.languages, false),
    countryIso: optStr(s.shop_location_country_iso),
    shippingFromCountryIso: optStr(s.shipping_from_country_iso),
    bannerUrl: optStr(s.image_url_760x100),
    policies: {
      welcome: optText(s.policy_welcome),
      payment: optText(s.policy_payment),
      shipping: optText(s.policy_shipping),
      refunds: optText(s.policy_refunds),
      additional: optText(s.policy_additional),
      sellerInfo: optText(s.policy_seller_info),
      privacy: optText(s.policy_privacy),
      updatedAt: optInt(s.policy_update_date)
    },
    etsyCreatedAt: optInt(s.created_timestamp ?? s.create_date),
    etsyUpdatedAt: optInt(s.updated_timestamp ?? s.update_date)
  }
}

export function mapShop(s: EtsyShop, addedAt: number): ShopInput {
  return {
    id: int(s.shop_id),
    shopName: String(s.shop_name),
    title: s.title ? decodeHtmlEntities(s.title) : null,
    url: s.url || shopUrlFor(String(s.shop_name)),
    iconUrl: s.icon_url_fullxfull ?? null,
    currency: s.currency_code ?? null,
    etsyActiveCount: int(s.listing_active_count),
    addedAt,
    profile: mapShopProfile(s),
    rawJson: JSON.stringify(s)
  }
}

export function shopStats(s: EtsyShop): ShopStats {
  return {
    numFavorers: optInt(s.num_favorers),
    transactionSoldCount: optInt(s.transaction_sold_count),
    reviewCount: optInt(s.review_count),
    reviewAverage: optNum(s.review_average),
    listingActiveCount: optInt(s.listing_active_count)
  }
}

/**
 * The natural key of a review. getReviewsByShop returns `TransactionReview`
 * objects, and a transaction gets at most one review, so `t-{transaction_id}`.
 * Should Etsy ever leave transaction_id out, the fallback is deterministic
 * from what identifies a review otherwise: `x-{listing_id}-{buyer_user_id|0}-{created}`
 * (a buyer reviews one listing once per purchase; a second review of the same
 * listing by a hidden buyer in the same second would collide — accepted).
 * Only `[a-z0-9-]` so it can be a MinIO path segment as is.
 */
export function reviewKey(r: EtsyTransactionReview): string {
  const tx = optInt(r.transaction_id)
  if (tx != null && tx > 0) return `t-${tx}`
  const created = optInt(r.created_timestamp ?? r.create_timestamp) ?? 0
  return `x-${int(r.listing_id)}-${optInt(r.buyer_user_id) ?? 0}-${created}`
}

/** Etsy TransactionReview → our row. The photo URL is kept only when it is https on Etsy's CDN. */
export function mapReview(r: EtsyTransactionReview): ReviewInput {
  const url = cdnUrl(r.image_url_fullxfull)
  return {
    key: reviewKey(r),
    shopId: int(r.shop_id),
    listingId: optInt(r.listing_id),
    transactionId: optInt(r.transaction_id),
    buyerUserId: optInt(r.buyer_user_id),
    rating: optInt(r.rating),
    text: optText(r.review),
    language: optStr(r.language),
    imageUrl: url || null,
    createTimestamp: optInt(r.create_timestamp),
    createdTimestamp: optInt(r.created_timestamp ?? r.create_timestamp),
    updateTimestamp: optInt(r.update_timestamp),
    updatedTimestamp: optInt(r.updated_timestamp ?? r.update_timestamp),
    rawJson: JSON.stringify(r)
  }
}
