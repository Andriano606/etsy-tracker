// The Etsy reads of the "compete" feature — one function per OAS operation.
// All are public (API key only) except getListingsShippingByListingIds, whose
// OAS security asks for the OAuth scope shops_r.

import {
  COMPETE_PAGE,
  type CompeteListingsPage,
  type ListingPropertyInfo,
  type ListingShippingInfo,
  type ListingTranslationInfo,
  type LiveImage,
  type LivePersonalizationQuestion,
  type LiveReviewsPage,
  type LiveVideo,
  type ReturnPolicyInfo,
  type ShippingCarrierInfo,
  type ShopSectionInfo,
  type VariationImageInfo
} from '../../../shared/features/compete'
import { missingScopes, SCOPE_LABEL } from '../../../shared/myShop'
import { EtsyApiError, type EtsyClient } from '../../etsyApi'
import { FeatureError } from '../common'
import type { FeatureCtx } from '../types'
import {
  byImageRank,
  bySectionRank,
  toCarrier,
  toImage,
  toListingRow,
  toListingShipping,
  toProperty,
  toQuestion,
  toReturnPolicy,
  toReview,
  toSection,
  toTranslation,
  toVariationImage,
  toVideo
} from './map'

const API = '/v3/application'

/** The scope getListingsShippingByListingIds needs (OAS security). */
export const SHIPPING_SCOPES = ['shops_r'] as const

/** A `{count, results}` answer, else Etsy's "unexpected answer" error. */
function results(body: unknown): { count: number; results: unknown[] } {
  const b = body as { count?: unknown; results?: unknown } | null | undefined
  if (!b || !Array.isArray(b.results)) throw new EtsyApiError('bad_response', 'Etsy повернув неочікувану відповідь.')
  return { count: typeof b.count === 'number' ? b.count : b.results.length, results: b.results }
}

/** A single-object answer, else Etsy's "unexpected answer" error. */
function one(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new EtsyApiError('bad_response', 'Etsy повернув неочікувану відповідь.')
  }
  return body
}

// ------------------------------------------------------------------- sections

/** getShopSections. */
export async function shopSections(client: EtsyClient, shopId: number): Promise<ShopSectionInfo[]> {
  return results(await client.call(`${API}/shops/${shopId}/sections`)).results.map(toSection).sort(bySectionRank)
}

/** getShopSection. */
export async function shopSection(client: EtsyClient, shopId: number, sectionId: number): Promise<ShopSectionInfo> {
  return toSection(one(await client.call(`${API}/shops/${shopId}/sections/${sectionId}`)))
}

/** getListingsByShopSectionId: active listings of one or more sections, one page. */
export async function sectionListings(
  client: EtsyClient,
  shopId: number,
  sectionIds: number[],
  offset = 0,
  limit = COMPETE_PAGE
): Promise<CompeteListingsPage> {
  const r = results(
    await client.call(`${API}/shops/${shopId}/shop-sections/listings`, {
      query: { shop_section_ids: sectionIds, limit, offset }
    })
  )
  return { count: r.count, offset, listings: r.results.map(toListingRow) }
}

/** getFeaturedListingsByShop, one page. */
export async function featuredListings(
  client: EtsyClient,
  shopId: number,
  offset = 0,
  limit = COMPETE_PAGE
): Promise<CompeteListingsPage> {
  const r = results(await client.call(`${API}/shops/${shopId}/listings/featured`, { query: { limit, offset } }))
  return { count: r.count, offset, listings: r.results.map(toListingRow) }
}

// ------------------------------------------------------------ return policies

/** getShopReturnPolicies. */
export async function returnPolicies(client: EtsyClient, shopId: number): Promise<ReturnPolicyInfo[]> {
  return results(await client.call(`${API}/shops/${shopId}/policies/return`)).results.map(toReturnPolicy)
}

/** getShopReturnPolicy. */
export async function returnPolicy(client: EtsyClient, shopId: number, policyId: number): Promise<ReturnPolicyInfo> {
  return toReturnPolicy(one(await client.call(`${API}/shops/${shopId}/policies/return/${policyId}`)))
}

// ------------------------------------------------------------------ listings

/** getListingProperties. */
export async function listingProperties(client: EtsyClient, shopId: number, listingId: number): Promise<ListingPropertyInfo[]> {
  return results(await client.call(`${API}/shops/${shopId}/listings/${listingId}/properties`)).results.map(toProperty)
}

/** What getListingProperty's 501 ("development in progress", OAS) is shown as. */
export const PROPERTY_NOT_IMPLEMENTED =
  'Etsy ще не підтримує читання окремого атрибута (HTTP 501). Усі атрибути лістингу — у розділі «Атрибути (властивості)».'

/** Clients that already got a 501 from getListingProperty: not asked again. */
const propertyRefused = new WeakSet<EtsyClient>()

/**
 * getListingProperty. The OAS says it "will only return a 501 response" for
 * now; the client retries 5xx inside the serialized queue, so after the first
 * 501 this client fails at once instead of holding the queue again.
 */
export async function listingProperty(client: EtsyClient, listingId: number, propertyId: number): Promise<ListingPropertyInfo> {
  if (propertyRefused.has(client)) throw new FeatureError(PROPERTY_NOT_IMPLEMENTED)
  try {
    return toProperty(one(await client.call(`${API}/listings/${listingId}/properties/${propertyId}`)))
  } catch (e) {
    if (!(e instanceof EtsyApiError && e.status === 501)) throw e
    propertyRefused.add(client)
    throw new FeatureError(PROPERTY_NOT_IMPLEMENTED)
  }
}

/** getListingImages, in display order. */
export async function listingImages(client: EtsyClient, listingId: number): Promise<LiveImage[]> {
  return results(await client.call(`${API}/listings/${listingId}/images`)).results.map(toImage).sort(byImageRank)
}

/** getListingImage. */
export async function listingImage(client: EtsyClient, listingId: number, imageId: number): Promise<LiveImage> {
  return toImage(one(await client.call(`${API}/listings/${listingId}/images/${imageId}`)))
}

/** getListingVideos. */
export async function listingVideos(client: EtsyClient, listingId: number): Promise<LiveVideo[]> {
  return results(await client.call(`${API}/listings/${listingId}/videos`)).results.map(toVideo)
}

/** getListingVideo. */
export async function listingVideo(client: EtsyClient, listingId: number, videoId: number): Promise<LiveVideo> {
  return toVideo(one(await client.call(`${API}/listings/${listingId}/videos/${videoId}`)))
}

/** getReviewsByListing, one page (limit ≤ 100). */
export async function listingReviews(
  client: EtsyClient,
  listingId: number,
  offset = 0,
  limit = 25
): Promise<LiveReviewsPage> {
  const r = results(await client.call(`${API}/listings/${listingId}/reviews`, { query: { limit, offset } }))
  return { count: r.count, offset, reviews: r.results.map(toReview) }
}

/** getListingPersonalization: the questions (empty = not personalizable). */
export async function listingPersonalization(client: EtsyClient, listingId: number): Promise<LivePersonalizationQuestion[]> {
  const p = one(await client.call(`${API}/listings/${listingId}/personalization`)) as { personalization_questions?: unknown }
  return Array.isArray(p.personalization_questions) ? p.personalization_questions.map(toQuestion) : []
}

/**
 * getListingTranslation; null = Etsy answered 404. The OAS 404 is generic, so
 * that means "no translation in this language" or "no such listing in that
 * shop" — callers word it that way.
 */
export async function listingTranslation(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  language: string
): Promise<ListingTranslationInfo | null> {
  try {
    const t = await client.call(`${API}/shops/${shopId}/listings/${listingId}/translations/${encodeURIComponent(language)}`)
    return toTranslation(one(t), language)
  } catch (e) {
    if (e instanceof EtsyApiError && e.kind === 'not_found') return null
    throw e
  }
}

/** getListingVariationImages. */
export async function variationImages(client: EtsyClient, shopId: number, listingId: number): Promise<VariationImageInfo[]> {
  return results(await client.call(`${API}/shops/${shopId}/listings/${listingId}/variation-images`)).results.map(
    toVariationImage
  )
}

// ------------------------------------------------------------------- shipping

/** Signed in with `scopes` (not necessarily owning a shop), else the sign-in / permission text. */
export function requireSignIn(status: FeatureCtx['authStatus'], scopes: readonly string[]): void {
  const st = status()
  if (!st.loggedIn) {
    throw new EtsyApiError('not_signed_in', 'Увійдіть в Etsy («Мій магазин» → «Увійти через Etsy»), щоб бачити доставку.')
  }
  const missing = missingScopes(st.scopes, scopes)
  if (missing.length) {
    throw new FeatureError(
      `Для цього потрібен дозвіл: ${missing.map((s) => SCOPE_LABEL[s] ?? s).join(', ')}. Вийдіть і увійдіть в Etsy ще раз («✏️ Мій магазин»).`
    )
  }
}

/**
 * getListingsShippingByListingIds (OAuth shops_r, ≤ 100 ids; one unknown id →
 * 404 for all). Etsy nulls the profile of listings the user doesn't own.
 */
export async function listingsShipping(client: EtsyClient, listingIds: number[]): Promise<ListingShippingInfo[]> {
  const r = results(await client.call(`${API}/listings/batch/shipping`, { oauth: true, query: { listing_ids: listingIds } }))
  return r.results.map(toListingShipping)
}

/** getShippingCarriers for an origin country (ISO 3166-1 alpha-2). */
export async function shippingCarriers(client: EtsyClient, country: string): Promise<ShippingCarrierInfo[]> {
  return results(await client.call(`${API}/shipping-carriers`, { query: { origin_country_iso: country } })).results.map(toCarrier)
}
