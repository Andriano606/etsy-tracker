// Etsy JSON (OAS schemas) → the clean types of shared/features/compete.ts.
// Text entities are decoded; every URL is validated (CDN for images, etsy.com
// for pages) before it can reach the renderer.

import type {
  CompeteListingRow,
  CompeteMoney,
  ListingPropertyInfo,
  ListingShippingInfo,
  ListingTranslationInfo,
  LiveImage,
  LivePersonalizationQuestion,
  LiveReview,
  LiveVideo,
  MailClassInfo,
  ReturnPolicyInfo,
  ShippingCarrierInfo,
  ShippingDestinationInfo,
  ShippingProfileInfo,
  ShippingUpgradeInfo,
  ShopSectionInfo,
  VariationImageInfo
} from '../../../shared/features/compete'
import { isAllowedExternalUrl, isEtsyCdnUrl } from '../../../shared/externalUrl'
import { decodeHtmlEntities } from '../../../shared/html'

type Obj = Record<string, unknown>

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export const optInt = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null
}
const optNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const optStr = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const optBool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
/** Etsy free text: entities decoded; '' → null. */
export const optText = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? decodeHtmlEntities(v) : null)
const text = (v: unknown): string => optText(v) ?? ''
const cdn = (v: unknown): string => (typeof v === 'string' && isEtsyCdnUrl(v) ? v : '')
const cdnOrNull = (v: unknown): string | null => cdn(v) || null

/** OAS Money; null when it carries no amount. */
export function toMoney(v: unknown): CompeteMoney | null {
  const m = obj(v)
  const amount = optInt(m.amount)
  if (amount == null) return null
  return { amount, divisor: optInt(m.divisor) || 100, currency: optStr(m.currency_code) ?? '' }
}

export function toSection(v: unknown): ShopSectionInfo {
  const s = obj(v)
  return {
    id: optInt(s.shop_section_id) ?? 0,
    title: text(s.title),
    rank: optInt(s.rank),
    activeListingCount: optInt(s.active_listing_count)
  }
}

/** Sections in display order (rank 1 first; unranked last). */
export const bySectionRank = (a: ShopSectionInfo, b: ShopSectionInfo): number =>
  (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.id - b.id

export function toListingRow(v: unknown): CompeteListingRow {
  const l = obj(v)
  const url = typeof l.url === 'string' && isAllowedExternalUrl(l.url) ? l.url : null
  const rank = optInt(l.featured_rank)
  return {
    listingId: optInt(l.listing_id) ?? 0,
    title: text(l.title),
    price: toMoney(l.price),
    state: optStr(l.state),
    quantity: optInt(l.quantity),
    featuredRank: rank != null && rank >= 1 ? rank : null,
    numFavorers: optInt(l.num_favorers),
    shopSectionId: optInt(l.shop_section_id),
    url
  }
}

export function toReturnPolicy(v: unknown): ReturnPolicyInfo {
  const p = obj(v)
  return {
    id: optInt(p.return_policy_id) ?? 0,
    acceptsReturns: p.accepts_returns === true,
    acceptsExchanges: p.accepts_exchanges === true,
    returnDeadline: optInt(p.return_deadline)
  }
}

export function toProperty(v: unknown): ListingPropertyInfo {
  const p = obj(v)
  return {
    propertyId: optInt(p.property_id) ?? 0,
    name: optText(p.property_name),
    scaleId: optInt(p.scale_id),
    scaleName: optText(p.scale_name),
    valueIds: arr(p.value_ids).map(optInt).filter((n): n is number => n != null),
    values: arr(p.values).map(text)
  }
}

export function toImage(v: unknown): LiveImage {
  const i = obj(v)
  return {
    id: optInt(i.listing_image_id) ?? 0,
    rank: optInt(i.rank),
    url570: cdn(i.url_570xN),
    urlFull: cdn(i.url_fullxfull),
    width: optInt(i.full_width),
    height: optInt(i.full_height),
    altText: optText(i.alt_text),
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

/** Images in display order (rank 1 = the main photo). */
export const byImageRank = (a: LiveImage, b: LiveImage): number =>
  (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.id - b.id

export function toVideo(v: unknown): LiveVideo {
  const x = obj(v)
  return {
    id: optInt(x.video_id) ?? 0,
    width: optInt(x.width),
    height: optInt(x.height),
    state: optStr(x.video_state),
    thumbnailUrl: cdnOrNull(x.thumbnail_url)
  }
}

export function toQuestion(v: unknown): LivePersonalizationQuestion {
  const q = obj(v)
  return {
    id: optInt(q.question_id),
    text: text(q.question_text),
    instructions: optText(q.instructions),
    type: optStr(q.question_type),
    required: q.required === true,
    maxChars: optInt(q.max_allowed_characters),
    maxFiles: optInt(q.max_allowed_files),
    addOnPrice: toMoney(q.add_on_price),
    options: arr(q.options).map((o) => ({ id: optInt(obj(o).option_id), label: text(obj(o).label) }))
  }
}

export function toTranslation(v: unknown, language: string): ListingTranslationInfo {
  const t = obj(v)
  return {
    listingId: optInt(t.listing_id) ?? 0,
    language: optStr(t.language) ?? language,
    title: optText(t.title),
    description: optText(t.description),
    tags: arr(t.tags).map(text).filter(Boolean)
  }
}

export function toVariationImage(v: unknown): VariationImageInfo {
  const x = obj(v)
  return {
    propertyId: optInt(x.property_id) ?? 0,
    valueId: optInt(x.value_id) ?? 0,
    value: optText(x.value),
    imageId: optInt(x.image_id) ?? 0
  }
}

export function toReview(v: unknown): LiveReview {
  const r = obj(v)
  return {
    shopId: optInt(r.shop_id),
    listingId: optInt(r.listing_id),
    rating: optInt(r.rating),
    text: optText(r.review),
    language: optStr(r.language),
    imageUrl: cdnOrNull(r.image_url_fullxfull),
    createdAt: optInt(r.created_timestamp ?? r.create_timestamp),
    updatedAt: optInt(r.updated_timestamp ?? r.update_timestamp)
  }
}

function toDestination(v: unknown): ShippingDestinationInfo {
  const d = obj(v)
  return {
    id: optInt(d.shipping_profile_destination_id),
    originCountry: optStr(d.origin_country_iso),
    destinationCountry: optStr(d.destination_country_iso),
    destinationRegion: optStr(d.destination_region),
    primaryCost: toMoney(d.primary_cost),
    secondaryCost: toMoney(d.secondary_cost),
    carrierId: optInt(d.shipping_carrier_id),
    mailClass: optStr(d.mail_class),
    minDeliveryDays: optInt(d.min_delivery_days),
    maxDeliveryDays: optInt(d.max_delivery_days)
  }
}

function toUpgrade(v: unknown): ShippingUpgradeInfo {
  const u = obj(v)
  return {
    id: optInt(u.upgrade_id),
    name: text(u.upgrade_name),
    type: optInt(u.type),
    price: toMoney(u.price),
    secondaryPrice: toMoney(u.secondary_price),
    carrierId: optInt(u.shipping_carrier_id),
    mailClass: optStr(u.mail_class),
    minDeliveryDays: optInt(u.min_delivery_days),
    maxDeliveryDays: optInt(u.max_delivery_days)
  }
}

export function toShippingProfile(v: unknown): ShippingProfileInfo | null {
  const p = obj(v)
  const id = optInt(p.shipping_profile_id)
  if (id == null) return null
  return {
    id,
    title: optText(p.title),
    originCountry: optStr(p.origin_country_iso),
    originPostalCode: optStr(p.origin_postal_code),
    profileType: optStr(p.profile_type),
    isDeleted: p.is_deleted === true,
    domesticHandlingFee: optNum(p.domestic_handling_fee),
    internationalHandlingFee: optNum(p.international_handling_fee),
    destinations: arr(p.shipping_profile_destinations).map(toDestination),
    upgrades: arr(p.shipping_profile_upgrades).map(toUpgrade)
  }
}

export function toListingShipping(v: unknown): ListingShippingInfo {
  const l = obj(v)
  return { listingId: optInt(l.listing_id) ?? 0, profile: toShippingProfile(l.shipping_profile) }
}

const toMailClass = (v: unknown): MailClassInfo => ({ key: optStr(obj(v).mail_class_key) ?? '', name: text(obj(v).name) })

export function toCarrier(v: unknown): ShippingCarrierInfo {
  const c = obj(v)
  return {
    id: optInt(c.shipping_carrier_id) ?? 0,
    name: text(c.name),
    domesticClasses: arr(c.domestic_classes).map(toMailClass),
    internationalClasses: arr(c.international_classes).map(toMailClass)
  }
}
