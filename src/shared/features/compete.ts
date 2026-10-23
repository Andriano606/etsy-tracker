// Feature "compete": live data of any shop / listing from public Etsy API
// reads — shop sections and their listings, featured listings, return
// policies, listing properties, images/videos, personalization, translations,
// variation images, listing reviews, shipping carriers — plus the listing
// shipping profiles (OAuth shops_r; Etsy fills them only for the user's own
// listings). Types are what main sends the renderer (URLs already validated).

/** Etsy Money kept exactly: value = amount / divisor. */
export interface CompeteMoney {
  amount: number
  divisor: number
  currency: string
}

/** OAS ShopSection. */
export interface ShopSectionInfo {
  id: number
  title: string
  /** 1 = shown first; null when Etsy didn't say. */
  rank: number | null
  activeListingCount: number | null
}

/** One listing of a page (OAS ShopListing, the fields the panels show). */
export interface CompeteListingRow {
  listingId: number
  title: string
  price: CompeteMoney | null
  state: string | null
  quantity: number | null
  /** Position among the shop's featured listings (≥ 1), else null. */
  featuredRank: number | null
  numFavorers: number | null
  shopSectionId: number | null
  /** The listing page on etsy.com (validated), or null. */
  url: string | null
}

export interface CompeteListingsPage {
  /** Etsy's `count` (all matches, not only this page). */
  count: number
  offset: number
  listings: CompeteListingRow[]
}

/** OAS ShopReturnPolicy. */
export interface ReturnPolicyInfo {
  id: number
  acceptsReturns: boolean
  acceptsExchanges: boolean
  /** Days (7, 14, 21, 30, 45, 60, 90); null = none. */
  returnDeadline: number | null
}

/** OAS ListingPropertyValue. */
export interface ListingPropertyInfo {
  propertyId: number
  name: string | null
  scaleId: number | null
  scaleName: string | null
  valueIds: number[]
  values: string[]
}

/** OAS ListingImage (URLs only when they are Etsy CDN URLs, else ''). */
export interface LiveImage {
  id: number
  rank: number | null
  url570: string
  urlFull: string
  width: number | null
  height: number | null
  altText: string | null
  hexCode: string | null
  red: number | null
  green: number | null
  blue: number | null
  hue: number | null
  saturation: number | null
  brightness: number | null
  isBlackAndWhite: boolean | null
  /** Etsy epoch seconds. */
  createdAt: number | null
}

/** OAS ListingVideo (the thumbnail only when it is an Etsy CDN URL). */
export interface LiveVideo {
  id: number
  width: number | null
  height: number | null
  /** active | inactive | deleted | flagged */
  state: string | null
  thumbnailUrl: string | null
}

export interface LivePersonalizationOption {
  id: number | null
  label: string
}

/** OAS PersonalizationQuestion. */
export interface LivePersonalizationQuestion {
  id: number | null
  text: string
  instructions: string | null
  type: string | null
  required: boolean
  maxChars: number | null
  maxFiles: number | null
  addOnPrice: CompeteMoney | null
  options: LivePersonalizationOption[]
}

/** OAS ListingTranslation. */
export interface ListingTranslationInfo {
  listingId: number
  language: string
  title: string | null
  description: string | null
  tags: string[]
}

/** OAS ListingVariationImage: which image a variation value shows. */
export interface VariationImageInfo {
  propertyId: number
  valueId: number
  value: string | null
  imageId: number
}

/** OAS ListingReview. */
export interface LiveReview {
  shopId: number | null
  listingId: number | null
  rating: number | null
  text: string | null
  language: string | null
  /** The buyer's photo (Etsy CDN only), or null. */
  imageUrl: string | null
  /** Etsy epoch seconds. */
  createdAt: number | null
  updatedAt: number | null
}

export interface LiveReviewsPage {
  count: number
  offset: number
  reviews: LiveReview[]
}

export interface ShippingDestinationInfo {
  id: number | null
  originCountry: string | null
  destinationCountry: string | null
  /** eu | non_eu | none */
  destinationRegion: string | null
  primaryCost: CompeteMoney | null
  secondaryCost: CompeteMoney | null
  carrierId: number | null
  mailClass: string | null
  minDeliveryDays: number | null
  maxDeliveryDays: number | null
}

export interface ShippingUpgradeInfo {
  id: number | null
  name: string
  /** 0 = domestic, 1 = international. */
  type: number | null
  price: CompeteMoney | null
  secondaryPrice: CompeteMoney | null
  carrierId: number | null
  mailClass: string | null
  minDeliveryDays: number | null
  maxDeliveryDays: number | null
}

/** OAS ShopShippingProfile. */
export interface ShippingProfileInfo {
  id: number
  title: string | null
  originCountry: string | null
  originPostalCode: string | null
  /** manual | calculated */
  profileType: string | null
  isDeleted: boolean
  domesticHandlingFee: number | null
  internationalHandlingFee: number | null
  destinations: ShippingDestinationInfo[]
  upgrades: ShippingUpgradeInfo[]
}

/** getListingsShippingByListingIds: null profile = Etsy nulls it for other sellers' listings. */
export interface ListingShippingInfo {
  listingId: number
  profile: ShippingProfileInfo | null
}

export interface MailClassInfo {
  key: string
  name: string
}

/** OAS ShippingCarrier. */
export interface ShippingCarrierInfo {
  id: number
  name: string
  domesticClasses: MailClassInfo[]
  internationalClasses: MailClassInfo[]
}

/** The languages Etsy documents for listing translations (OAS ListingTranslations). */
export const TRANSLATION_LANGUAGES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'de', name: 'Німецька' },
  { code: 'en-GB', name: 'Англійська (Велика Британія)' },
  { code: 'en-IN', name: 'Англійська (Індія)' },
  { code: 'en-US', name: 'Англійська (США)' },
  { code: 'es', name: 'Іспанська' },
  { code: 'fr', name: 'Французька' },
  { code: 'it', name: 'Італійська' },
  { code: 'ja', name: 'Японська' },
  { code: 'nl', name: 'Нідерландська' },
  { code: 'pl', name: 'Польська' },
  { code: 'pt', name: 'Португальська' },
  { code: 'ru', name: 'Російська' },
  { code: 'sv', name: 'Шведська' }
]

export const TRANSLATION_CODES: readonly string[] = TRANSLATION_LANGUAGES.map((l) => l.code)

/** The parts get_product_live_details can read. */
export const LIVE_PARTS = ['properties', 'photos', 'videos', 'personalization', 'variation_photos', 'shipping', 'reviews'] as const
export type LivePart = (typeof LIVE_PARTS)[number]

/** Page sizes (the OAS maximum is 100). */
export const COMPETE_PAGE = 100
export const REVIEWS_PAGE = 20

/** The MCP tools of this feature, in Ukrainian for the MCP modal. */
export const COMPETE_TOOL_SUMMARY: ReadonlyArray<{ name: string; text: string; write?: boolean }> = [
  { name: 'get_store_sections', text: 'розділи будь-якого магазину (з товарами за бажанням) — живі дані' },
  { name: 'get_store_featured', text: 'рекомендовані товари будь-якого магазину' },
  { name: 'get_store_return_policies', text: 'політики повернення будь-якого магазину' },
  {
    name: 'get_product_live_details',
    text: 'живі деталі будь-якого товару: атрибути, фото, відео, персоналізація, фото варіацій, доставка, відгуки, переклад'
  },
  { name: 'list_shipping_carriers', text: 'служби доставки й класи відправлень для країни' }
]
