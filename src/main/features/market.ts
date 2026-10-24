// Feature "market": research the whole of Etsy with the API key alone (no
// OAuth — the OAS lists only api_key for these endpoints):
// findAllListingsActive (GET /listings/active — keywords, sort, price range,
// buyer category, shop location), the buyer category tree
// (GET /buyer-taxonomy/nodes, cached per client) and a category's properties
// (GET /buyer-taxonomy/nodes/{taxonomy_id}/properties). The app's search also
// reads the results' photos in ONE /listings/batch call per page; the MCP
// search doesn't (it returns no photos — never Etsy CDN URLs — but each
// listing's etsy.com page url).

import {
  MARKET_MAX_OFFSET,
  MARKET_PAGE_SIZE,
  MARKET_SORTS,
  MARKET_SORT_KEYS,
  type MarketCategory,
  type MarketCategoryMatches,
  type MarketListing,
  type MarketProperty,
  type MarketQuery,
  type MarketSearchResult,
  type MarketSort
} from '../../shared/features/market'
import { isAllowedExternalUrl, isEtsyCdnUrl } from '../../shared/externalUrl'
import { decodeHtmlEntities } from '../../shared/html'
import { EtsyApiError, type EtsyClient, type EtsyListing, type EtsyListingWithAssociations, type Paged } from '../etsyApi'
import { textResult, ToolInputError, type McpTool } from '../mcpProtocol'
import { FeatureError, idArg, mcpFail, optIdArg, strArg } from './common'
import type { Feature } from './types'

/** OAS BuyerTaxonomyNode (recursive). */
interface EtsyBuyerNode {
  id: number
  level?: number
  name: string
  parent_id?: number | null
  children?: EtsyBuyerNode[]
}

/** OAS BuyerTaxonomyNodeProperty. */
interface EtsyBuyerProperty {
  property_id: number
  name?: string
  display_name?: string
  scales?: Array<{ scale_id: number; display_name?: string; description?: string | null }>
  is_required?: boolean
  supports_attributes?: boolean
  supports_variations?: boolean
  is_multivalued?: boolean
  max_values_allowed?: number | null
  possible_values?: Array<{ value_id?: number | null; name?: string; scale_id?: number | null }>
}

const txt = (v: unknown): string => (v == null ? '' : decodeHtmlEntities(String(v)))

/** A paged answer's `results`; an answer without that array is an error (never an empty list — it would be cached / look like "nothing found"). */
function results<T>(page: Paged<T> | undefined): T[] {
  if (!Array.isArray(page?.results)) throw new EtsyApiError('bad_response', 'Etsy повернув неочікувану відповідь.')
  return page.results
}

// ---------------------------------------------------------------- categories

export function flattenBuyerTaxonomy(nodes: readonly EtsyBuyerNode[], parentPath = '', out: MarketCategory[] = []): MarketCategory[] {
  for (const n of nodes) {
    const name = txt(n.name)
    const path = parentPath ? `${parentPath} › ${name}` : name
    out.push({ id: n.id, name, level: n.level ?? 0, parentId: n.parent_id ?? null, path })
    if (n.children?.length) flattenBuyerTaxonomy(n.children, path, out)
  }
  return out
}

const taxonomyCache = new WeakMap<EtsyClient, Promise<MarketCategory[]>>()

/** The whole buyer category tree, flattened; one request per client (a failure is not cached). */
export function buyerCategories(client: EtsyClient): Promise<MarketCategory[]> {
  const cached = taxonomyCache.get(client)
  if (cached) return cached
  const p = client
    .call<Paged<EtsyBuyerNode>>('/v3/application/buyer-taxonomy/nodes')
    .then((r) => flattenBuyerTaxonomy(results(r)))
  taxonomyCache.set(client, p)
  p.catch(() => taxonomyCache.delete(client))
  return p
}

/**
 * Categories whose path contains every word of `query` (case-insensitive), or
 * whose id is the query; the top level for an empty query. Best first: the
 * category's own name contains the query, then shallower, then by path.
 */
export function matchCategories(all: readonly MarketCategory[], query: string, limit: number): MarketCategoryMatches {
  const q = query.trim().toLowerCase()
  if (!q) {
    const roots = all.filter((c) => c.parentId == null)
    return { total: roots.length, categories: roots.slice(0, limit) }
  }
  const words = q.split(/\s+/)
  const hits = all.filter((c) => String(c.id) === q || words.every((w) => c.path.toLowerCase().includes(w)))
  const rank = (c: MarketCategory): number => (String(c.id) === q ? 0 : c.name.toLowerCase().includes(q) ? 1 : 2)
  hits.sort((a, b) => rank(a) - rank(b) || a.level - b.level || a.path.localeCompare(b.path))
  return { total: hits.length, categories: hits.slice(0, limit) }
}

export function toMarketProperty(p: EtsyBuyerProperty): MarketProperty {
  return {
    propertyId: p.property_id,
    name: txt(p.name),
    displayName: txt(p.display_name ?? p.name),
    isRequired: !!p.is_required,
    supportsAttributes: !!p.supports_attributes,
    supportsVariations: !!p.supports_variations,
    isMultivalued: !!p.is_multivalued,
    maxValuesAllowed: p.max_values_allowed ?? null,
    scales: (p.scales ?? []).map((s) => ({ scaleId: s.scale_id, name: txt(s.display_name), description: s.description ? txt(s.description) : null })),
    possibleValues: (p.possible_values ?? []).map((v) => ({ valueId: v.value_id ?? null, name: txt(v.name), scaleId: v.scale_id ?? null }))
  }
}

export async function categoryProperties(client: EtsyClient, taxonomyId: number): Promise<MarketProperty[]> {
  const r = await client.call<Paged<EtsyBuyerProperty>>(`/v3/application/buyer-taxonomy/nodes/${taxonomyId}/properties`)
  return results(r).map(toMarketProperty)
}

// -------------------------------------------------------------------- search

function firstImage(d: EtsyListingWithAssociations | undefined): { thumb: string | null; full: string | null } {
  const img = [...(d?.images ?? [])].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))[0]
  const cdn = (u: string | null | undefined): string | null => (u && isEtsyCdnUrl(u) ? u : null)
  const thumb = cdn(img?.url_570xN)
  return { thumb, full: thumb ? (cdn(img?.url_fullxfull) ?? thumb) : null }
}

export function toMarketListing(l: EtsyListing, details?: EtsyListingWithAssociations): MarketListing {
  const image = firstImage(details)
  const price = l.price && Number.isFinite(l.price.amount) && l.price.divisor > 0 ? l.price : null
  return {
    listingId: l.listing_id,
    shopId: l.shop_id,
    title: txt(l.title),
    priceAmount: price?.amount ?? null,
    priceDivisor: price?.divisor ?? null,
    currency: price?.currency_code ?? null,
    url: typeof l.url === 'string' && isAllowedExternalUrl(l.url) ? l.url : null,
    tags: (l.tags ?? []).map(txt),
    numFavorers: l.num_favorers ?? null,
    views: l.views ?? details?.views ?? null,
    createdAt: l.original_creation_timestamp ?? l.created_timestamp ?? l.creation_timestamp ?? null,
    imageUrl: image.thumb,
    imageFullUrl: image.full
  }
}

/**
 * Whether the query has one of findAllListingsActive's "search options" — the
 * OAS: `sort_on` / `sort_order` "only work when combined with one of the search
 * options (keywords, region, etc.)". A price range alone is not counted as one.
 */
export const hasSearchOption = (q: MarketQuery): boolean => !!q.keywords || q.taxonomyId != null || !!q.shopLocation

/**
 * What's wrong with a query before asking Etsy (null = fine). The OAS requires
 * no parameter; an unfiltered query is refused only because it would list
 * every listing on Etsy — a price bound is filter enough.
 */
export function queryProblem(q: MarketQuery): 'empty' | 'range' | null {
  if (!hasSearchOption(q) && q.minPrice == null && q.maxPrice == null) return 'empty'
  if (q.minPrice != null && q.maxPrice != null && q.minPrice > q.maxPrice) return 'range'
  return null
}

/**
 * findAllListingsActive; the sort is sent only with a search option (see
 * hasSearchOption — without one Etsy returns the newest first). `withImages` adds one /listings/batch call for the page's photos (a failure only costs the photos). */
export async function searchMarket(client: EtsyClient, q: MarketQuery, withImages: boolean): Promise<MarketSearchResult> {
  const sort = hasSearchOption(q) ? MARKET_SORTS[q.sort] : null
  const page = await client.call<Paged<EtsyListing>>('/v3/application/listings/active', {
    query: {
      limit: q.limit,
      offset: q.offset,
      keywords: q.keywords ?? undefined,
      sort_on: sort?.sortOn,
      sort_order: sort?.sortOrder,
      min_price: q.minPrice ?? undefined,
      max_price: q.maxPrice ?? undefined,
      taxonomy_id: q.taxonomyId ?? undefined,
      shop_location: q.shopLocation ?? undefined
    }
  })
  const found = results(page)
  let details = new Map<number, EtsyListingWithAssociations>()
  let imagesError: string | null = null
  if (withImages && found.length) {
    try {
      details = await client.getListingsByIds(found.map((l) => l.listing_id), undefined, {})
    } catch (e) {
      imagesError = `Фото не завантажилися: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  return {
    count: Number(page.count) || 0,
    offset: q.offset,
    limit: q.limit,
    sorted: sort != null,
    listings: found.map((l) => toMarketListing(l, details.get(l.listing_id))),
    imagesError
  }
}

// ---------------------------------------------------------------- IPC args

function priceArg(args: Record<string, unknown>, name: string): number | null {
  const v = args[name]
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) throw new FeatureError(`Ціна ${name === 'minPrice' ? 'від' : 'до'} має бути невід’ємним числом.`)
  return n
}

function intArg(args: Record<string, unknown>, name: string, min: number, max: number, dflt: number): number {
  if (args[name] == null) return dflt
  const n = Number(args[name])
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new FeatureError(`Некоректний ${name} (${min}–${max}).`)
  return n
}

function sortArg(v: unknown): MarketSort {
  if (v == null) return 'relevance'
  if (typeof v === 'string' && Object.hasOwn(MARKET_SORTS, v)) return v as MarketSort
  throw new FeatureError('Невідоме сортування.')
}

const orNull = (s: string): string | null => s.trim() || null

export function parseMarketQuery(args: Record<string, unknown>): MarketQuery {
  const q: MarketQuery = {
    keywords: orNull(strArg(args, 'keywords', { optional: true, max: 200 })),
    taxonomyId: optIdArg(args, 'taxonomyId'),
    minPrice: priceArg(args, 'minPrice'),
    maxPrice: priceArg(args, 'maxPrice'),
    sort: sortArg(args.sort),
    shopLocation: orNull(strArg(args, 'shopLocation', { optional: true, max: 100 })),
    limit: intArg(args, 'limit', 1, 100, MARKET_PAGE_SIZE),
    offset: intArg(args, 'offset', 0, MARKET_MAX_OFFSET, 0)
  }
  const problem = queryProblem(q)
  if (problem === 'empty') throw new FeatureError('Вкажіть ключові слова, категорію, розташування магазину або ціну.')
  if (problem === 'range') throw new FeatureError('Ціна «від» більша за ціну «до».')
  return q
}

// ----------------------------------------------------------------------- MCP

const NOT_AVAILABLE = 'Not available: the app has no Etsy API client right now (no API key configured in Settings).'

function needClient(client: EtsyClient | null): EtsyClient {
  if (!client) throw new ToolInputError(NOT_AVAILABLE)
  return client
}

const isoDate = (sec: number | null): string | null => (sec == null ? null : new Date(sec * 1000).toISOString())

function mcpQuery(a: Record<string, unknown>): MarketQuery {
  const q: MarketQuery = {
    keywords: typeof a.keywords === 'string' ? orNull(a.keywords) : null,
    taxonomyId: (a.category_id as number | undefined) ?? null,
    minPrice: (a.min_price as number | undefined) ?? null,
    maxPrice: (a.max_price as number | undefined) ?? null,
    sort: (a.sort as MarketSort | undefined) ?? 'relevance',
    shopLocation: typeof a.store_location === 'string' ? orNull(a.store_location) : null,
    limit: (a.limit as number | undefined) ?? 25,
    offset: (a.offset as number | undefined) ?? 0
  }
  const problem = queryProblem(q)
  if (problem === 'empty') throw new ToolInputError('Give at least one of: keywords, category_id, store_location, min_price, max_price.')
  if (problem === 'range') throw new ToolInputError('min_price is greater than max_price.')
  return q
}

function mcpTools(deps: { client: EtsyClient | null }): McpTool[] {
  return [
    {
      name: 'search_market',
      title: 'Search all of Etsy',
      openWorld: true,
      description:
        'Searches every active listing on all of Etsy (Etsy API findAllListingsActive) — not only the shops the user tracks, and not the app\'s local data: a live call (1 API request, API key only, no sign-in); nothing is saved. Filters (give at least one): keywords (a search term; Etsy\'s own search decides which listings match — it is not an exact-text filter), category_id (an Etsy buyer category from list_market_categories), min_price / max_price (the currency the range is compared in is not documented; prices come back in each listing\'s own currency, never converted), store_location (a place name Etsy parses, such as "Germany"; an unknown place is an error). The sort applies only together with keywords, category_id or store_location — with a price range alone Etsy\'s default order is used and sorted is false. Returns total (all matches), sorted, offset, returned and one page of products (Etsy listings): id (listing id), store_id (Etsy shop id), title, price (the seller\'s base price — before VAT and any sale), currency, tags, favorites (Etsy favorers), views (null when unknown), created_at (ISO 8601 UTC, when the listing was first created), url (the listing page on etsy.com, or null). No photos. Page with limit (1–100, default 25) and offset (≤ 12000).',
      inputSchema: {
        type: 'object',
        properties: {
          keywords: { type: 'string', maxLength: 200, description: 'Search term or phrase, matched by Etsy\'s own search.' },
          category_id: { type: 'integer', minimum: 1, description: 'An Etsy buyer category id from list_market_categories.' },
          min_price: { type: 'number', minimum: 0, description: 'Lowest price (currency not documented).' },
          max_price: { type: 'number', minimum: 0, description: 'Highest price (currency not documented).' },
          sort: {
            type: 'string',
            enum: MARKET_SORT_KEYS,
            default: 'relevance',
            description: 'relevance (Etsy\'s search score), newest/oldest (listing date), price_low/price_high, updated (recently edited first). Ignored without keywords, category_id or store_location.'
          },
          store_location: { type: 'string', maxLength: 100, description: 'Only Etsy shops located here (a country or city name).' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          offset: { type: 'integer', minimum: 0, maximum: MARKET_MAX_OFFSET, default: 0 }
        },
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const r = await searchMarket(needClient(deps.client), mcpQuery(a), false)
          return textResult({
            total: r.count,
            sorted: r.sorted,
            offset: r.offset,
            returned: r.listings.length,
            products: r.listings.map((l) => ({
              id: l.listingId,
              store_id: l.shopId,
              title: l.title,
              price: l.priceAmount != null && l.priceDivisor ? l.priceAmount / l.priceDivisor : null,
              currency: l.currency,
              tags: l.tags,
              favorites: l.numFavorers,
              views: l.views,
              created_at: isoDate(l.createdAt),
              url: l.url
            }))
          })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'list_market_categories',
      title: 'Etsy buyer categories',
      openWorld: true,
      description:
        'Etsy\'s buyer categories (the shopper-facing taxonomy, getBuyerTaxonomyNodes) whose path contains every word of `query` (case-insensitive) or whose id equals it; the top-level categories when `query` is empty. The tree is read live from the Etsy API once per app run (API key only), then matched locally. Best first: the id, then the category\'s own name containing the query, then shallower. Returns total (all matches) and up to `limit` categories: id, path ("Home & Living › Kitchen › Mugs"), level (0 = top). Use an id as category_id of search_market / get_market_category_properties. These are not the seller categories a new listing needs (find_categories).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 100, description: 'Words of the category path, e.g. "wall art".' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 }
        },
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const all = await buyerCategories(needClient(deps.client))
          const m = matchCategories(all, typeof a.query === 'string' ? a.query : '', (a.limit as number | undefined) ?? 30)
          return textResult({
            total: m.total,
            categories: m.categories.map((c) => ({ id: c.id, path: c.path, level: c.level }))
          })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'get_market_category_properties',
      title: 'Etsy buyer category properties',
      openWorld: true,
      description:
        'The listing properties Etsy supports for one buyer category (getPropertiesByBuyerTaxonomyId: e.g. color, material, size) — a live Etsy API call (1 request, API key only). Returns category_id and properties: id, name, display_name, required, multivalued, max_values, scales (units: id, name, description) and values (the possible values: id, name, scale_id).',
      inputSchema: {
        type: 'object',
        properties: { category_id: { type: 'integer', minimum: 1, description: 'An Etsy buyer category id from list_market_categories.' } },
        required: ['category_id'],
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const props = await categoryProperties(needClient(deps.client), a.category_id as number)
          return textResult({
            category_id: a.category_id,
            properties: props.map((p) => ({
              id: p.propertyId,
              name: p.name,
              display_name: p.displayName,
              required: p.isRequired,
              multivalued: p.isMultivalued,
              max_values: p.maxValuesAllowed,
              scales: p.scales.map((s) => ({ id: s.scaleId, name: s.name, description: s.description })),
              values: p.possibleValues.map((v) => ({ id: v.valueId, name: v.name, scale_id: v.scaleId }))
            }))
          })
        } catch (e) {
          return mcpFail(e)
        }
      }
    }
  ]
}

export const marketFeature: Feature = {
  id: 'market',
  actions: {
    search: (args, ctx) => searchMarket(ctx.client, parseMarketQuery(args), true),
    categories: async (args, ctx) =>
      matchCategories(
        await buyerCategories(ctx.client),
        strArg(args, 'query', { optional: true, max: 100 }),
        args.limit == null ? 50 : intArg(args, 'limit', 1, 200, 50)
      ),
    properties: (args, ctx) => categoryProperties(ctx.client, idArg(args, 'taxonomyId')),
    /** The shop's name for "Стежити за магазином" (window.api.addShop takes a name or link). */
    shopName: async (args, ctx) => {
      const name = (await ctx.client.getShop(idArg(args, 'shopId')))?.shop_name
      if (typeof name !== 'string' || !name) throw new FeatureError('Etsy не повернув назву цього магазину.')
      return name
    }
  },
  mcpTools
}
