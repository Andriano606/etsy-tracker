// Etsy JSON of the shop configuration endpoints (OAS: ShopSection,
// ShopShippingProfile + Destination + Upgrade, ShippingCarrier,
// ShopProcessingProfile, ShopReturnPolicy, ShopHolidayPreference,
// ShopProductionPartner) → the clean types of shared/features/shopConfig.

import type {
  HolidayPreference,
  MailClass,
  Money,
  PolicyListing,
  ProcessingProfile,
  ProductionPartner,
  ReadinessState,
  ReturnPolicy,
  ShippingCarrier,
  ShippingDestination,
  ShippingProfile,
  ShippingRegion,
  ShippingUpgrade,
  ShopSection
} from '../../../shared/features/shopConfig'
import { decodeHtmlEntities } from '../../../shared/html'

export interface EtsyMoneyJson {
  amount?: number
  divisor?: number
  currency_code?: string
}

export interface EtsySection {
  shop_section_id: number
  title?: string | null
  rank?: number | null
  active_listing_count?: number | null
}

export interface EtsyDestination {
  shipping_profile_destination_id: number
  shipping_profile_id: number
  origin_country_iso?: string | null
  destination_country_iso?: string | null
  destination_region?: string | null
  primary_cost?: EtsyMoneyJson | null
  secondary_cost?: EtsyMoneyJson | null
  shipping_carrier_id?: number | null
  mail_class?: string | null
  min_delivery_days?: number | null
  max_delivery_days?: number | null
}

export interface EtsyUpgrade {
  shipping_profile_id: number
  upgrade_id: number
  upgrade_name?: string | null
  type?: number | null
  rank?: number | null
  language?: string | null
  price?: EtsyMoneyJson | null
  secondary_price?: EtsyMoneyJson | null
  shipping_carrier_id?: number | null
  mail_class?: string | null
  min_delivery_days?: number | null
  max_delivery_days?: number | null
}

export interface EtsyShippingProfileFull {
  shipping_profile_id: number
  title?: string | null
  origin_country_iso?: string | null
  origin_postal_code?: string | null
  is_deleted?: boolean
  profile_type?: string | null
  domestic_handling_fee?: number | null
  international_handling_fee?: number | null
  shipping_profile_destinations?: EtsyDestination[] | null
  shipping_profile_upgrades?: EtsyUpgrade[] | null
}

export interface EtsyCarrier {
  shipping_carrier_id: number
  name?: string | null
  domestic_classes?: Array<{ mail_class_key?: string; name?: string }> | null
  international_classes?: Array<{ mail_class_key?: string; name?: string }> | null
}

export interface EtsyReadiness {
  readiness_state_id: number
  readiness_state?: string | null
  min_processing_days?: number | null
  max_processing_days?: number | null
  processing_days_display_label?: string | null
}

export interface EtsyReturnPolicy {
  return_policy_id: number
  accepts_returns?: boolean
  accepts_exchanges?: boolean
  return_deadline?: number | null
}

export interface EtsyHoliday {
  holiday_id: number
  country_iso?: string | null
  is_working?: boolean
  holiday_name?: string | null
}

export interface EtsyPartner {
  production_partner_id: number
  partner_name?: string | null
  location?: string | null
}

export interface EtsyPolicyListing {
  listing_id: number
  title?: string | null
  state?: string | null
}

const text = (v: unknown): string => (v == null ? '' : decodeHtmlEntities(String(v)))
const textOrNull = (v: unknown): string | null => (v == null || v === '' ? null : decodeHtmlEntities(String(v)))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const code = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null)

export function mapMoneyJson(m: EtsyMoneyJson | null | undefined): Money | null {
  if (!m || typeof m.amount !== 'number' || typeof m.divisor !== 'number') return null
  return { amount: m.amount, divisor: m.divisor, currency: typeof m.currency_code === 'string' ? m.currency_code : '' }
}

export function mapSection(s: EtsySection): ShopSection {
  return { id: s.shop_section_id, title: text(s.title), rank: num(s.rank), activeListingCount: num(s.active_listing_count) }
}

const region = (v: unknown): ShippingRegion => (v === 'eu' || v === 'non_eu' ? v : 'none')

export function mapDestination(d: EtsyDestination): ShippingDestination {
  return {
    id: d.shipping_profile_destination_id,
    profileId: d.shipping_profile_id,
    originCountry: code(d.origin_country_iso),
    destinationCountry: code(d.destination_country_iso),
    destinationRegion: region(d.destination_region),
    primaryCost: mapMoneyJson(d.primary_cost),
    secondaryCost: mapMoneyJson(d.secondary_cost),
    carrierId: num(d.shipping_carrier_id) || null,
    mailClass: textOrNull(d.mail_class),
    minDeliveryDays: num(d.min_delivery_days),
    maxDeliveryDays: num(d.max_delivery_days)
  }
}

export function mapUpgrade(u: EtsyUpgrade): ShippingUpgrade {
  return {
    id: u.upgrade_id,
    profileId: u.shipping_profile_id,
    name: text(u.upgrade_name),
    international: u.type === 1,
    rank: num(u.rank),
    language: textOrNull(u.language),
    price: mapMoneyJson(u.price),
    secondaryPrice: mapMoneyJson(u.secondary_price),
    carrierId: num(u.shipping_carrier_id) || null,
    mailClass: textOrNull(u.mail_class),
    minDeliveryDays: num(u.min_delivery_days),
    maxDeliveryDays: num(u.max_delivery_days)
  }
}

export function mapProfile(p: EtsyShippingProfileFull): ShippingProfile {
  return {
    id: p.shipping_profile_id,
    title: text(p.title),
    originCountry: code(p.origin_country_iso),
    originPostalCode: textOrNull(p.origin_postal_code),
    isDeleted: p.is_deleted === true,
    profileType: textOrNull(p.profile_type),
    domesticHandlingFee: num(p.domestic_handling_fee),
    internationalHandlingFee: num(p.international_handling_fee),
    destinations: (p.shipping_profile_destinations ?? []).map(mapDestination),
    upgrades: (p.shipping_profile_upgrades ?? []).map(mapUpgrade)
  }
}

const mailClasses = (list: EtsyCarrier['domestic_classes']): MailClass[] =>
  (list ?? []).filter((c) => typeof c?.mail_class_key === 'string').map((c) => ({ key: String(c.mail_class_key), name: text(c.name) }))

export function mapCarrier(c: EtsyCarrier): ShippingCarrier {
  return {
    id: c.shipping_carrier_id,
    name: text(c.name),
    domesticClasses: mailClasses(c.domestic_classes),
    internationalClasses: mailClasses(c.international_classes)
  }
}

const readiness = (v: unknown): ReadinessState | null => (v === 'ready_to_ship' || v === 'made_to_order' ? v : null)

export function mapProcessing(r: EtsyReadiness): ProcessingProfile {
  return {
    id: r.readiness_state_id,
    readinessState: readiness(r.readiness_state),
    minDays: num(r.min_processing_days),
    maxDays: num(r.max_processing_days),
    label: textOrNull(r.processing_days_display_label)
  }
}

export function mapReturnPolicy(r: EtsyReturnPolicy): ReturnPolicy {
  return {
    id: r.return_policy_id,
    acceptsReturns: r.accepts_returns === true,
    acceptsExchanges: r.accepts_exchanges === true,
    returnDeadline: num(r.return_deadline)
  }
}

export function mapPolicyListing(l: EtsyPolicyListing): PolicyListing {
  return { listingId: l.listing_id, title: text(l.title), state: text(l.state) }
}

export function mapHoliday(h: EtsyHoliday): HolidayPreference {
  return { holidayId: h.holiday_id, countryIso: code(h.country_iso), name: text(h.holiday_name), isWorking: h.is_working === true }
}

export function mapPartner(p: EtsyPartner): ProductionPartner {
  return { id: p.production_partner_id, name: text(p.partner_name), location: textOrNull(p.location) }
}
