// Feature "market": search every active listing on Etsy (findAllListingsActive),
// the buyer category tree (getBuyerTaxonomyNodes) and a category's properties
// (getPropertiesByBuyerTaxonomyId). Shared types, sorts and the price summary.

/**
 * The sorts the app offers, as findAllListingsActive's `sort_on` + `sort_order`
 * (OAS enums: created|price|updated|score, asc|desc; `score` is always descending).
 */
export const MARKET_SORTS = {
  relevance: { sortOn: 'score', sortOrder: 'desc', label: 'Найрелевантніші' },
  newest: { sortOn: 'created', sortOrder: 'desc', label: 'Найновіші' },
  oldest: { sortOn: 'created', sortOrder: 'asc', label: 'Найстаріші' },
  price_low: { sortOn: 'price', sortOrder: 'asc', label: 'Ціна: від низької' },
  price_high: { sortOn: 'price', sortOrder: 'desc', label: 'Ціна: від високої' },
  updated: { sortOn: 'updated', sortOrder: 'desc', label: 'Нещодавно оновлені' }
} as const

export type MarketSort = keyof typeof MARKET_SORTS
export const MARKET_SORT_KEYS = Object.keys(MARKET_SORTS) as MarketSort[]

/** Results per page in the app (the OAS allows 1–100, default 25). */
export const MARKET_PAGE_SIZE = 24
/** The v3 offset cap. */
export const MARKET_MAX_OFFSET = 12000

export interface MarketQuery {
  keywords: string | null
  taxonomyId: number | null
  minPrice: number | null
  maxPrice: number | null
  sort: MarketSort
  /** Free text Etsy parses as a place ("Ukraine", "Kyiv, Ukraine"); an unparsable one is a 400. */
  shopLocation: string | null
  limit: number
  offset: number
}

/** One search result (OAS ShopListing + the first image from /listings/batch). */
export interface MarketListing {
  listingId: number
  shopId: number
  title: string
  /** Etsy Money: value = amount / divisor; null when the answer had no price. */
  priceAmount: number | null
  priceDivisor: number | null
  currency: string | null
  /** The listing page (https on etsy.com only), else null. */
  url: string | null
  tags: string[]
  numFavorers: number | null
  views: number | null
  /** Etsy epoch seconds: when the listing was first created (original_creation_timestamp). */
  createdAt: number | null
  /** The first photo (570xN) on the Etsy CDN, validated; null = none or not loaded. */
  imageUrl: string | null
}

export interface MarketSearchResult {
  /** Etsy's `count`: every match, not just this page. */
  count: number
  offset: number
  limit: number
  /** Whether the chosen sort was sent (only with keywords / category / shop location — see hasSearchOption). */
  sorted: boolean
  listings: MarketListing[]
  /** Photos couldn't be loaded (the results are still there), Ukrainian. */
  imagesError: string | null
}

/** A buyer category, flattened from the tree. */
export interface MarketCategory {
  id: number
  name: string
  level: number
  parentId: number | null
  /** "Home & Living › Kitchen › Mugs". */
  path: string
}

export interface MarketCategoryMatches {
  /** How many categories match (the list is capped). */
  total: number
  categories: MarketCategory[]
}

export interface MarketPropertyScale {
  scaleId: number
  name: string
  description: string | null
}

export interface MarketPropertyValue {
  valueId: number | null
  name: string
  scaleId: number | null
}

export interface MarketProperty {
  propertyId: number
  name: string
  displayName: string
  isRequired: boolean
  supportsAttributes: boolean
  supportsVariations: boolean
  isMultivalued: boolean
  maxValuesAllowed: number | null
  scales: MarketPropertyScale[]
  possibleValues: MarketPropertyValue[]
}

/** Prices of loaded results per currency (currencies are never converted). */
export interface MarketPriceStat {
  currency: string
  count: number
  min: number
  median: number
  max: number
}

export function marketPriceStats(listings: readonly MarketListing[]): MarketPriceStat[] {
  const by = new Map<string, number[]>()
  for (const l of listings) {
    if (l.priceAmount == null || !l.priceDivisor || !l.currency) continue
    const list = by.get(l.currency) ?? []
    list.push(l.priceAmount / l.priceDivisor)
    by.set(l.currency, list)
  }
  return [...by.entries()]
    .map(([currency, values]) => {
      const v = [...values].sort((a, b) => a - b)
      const mid = Math.floor(v.length / 2)
      const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
      return { currency, count: v.length, min: v[0], median, max: v[v.length - 1] }
    })
    .sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency))
}

/** The MCP tools of this feature, in Ukrainian for the MCP modal. */
export const MARKET_TOOL_SUMMARY: ReadonlyArray<{ name: string; text: string; write?: boolean }> = [
  { name: 'search_market', text: 'пошук товарів по всьому Etsy: слова, категорія, ціна, сортування, розташування магазину' },
  { name: 'list_market_categories', text: 'категорії покупця Etsy за назвою (id і шлях)' },
  { name: 'get_market_category_properties', text: 'властивості категорії та їхні можливі значення' }
]
