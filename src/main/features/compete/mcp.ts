// The neutral MCP tools of the "compete" feature: live reads of any store /
// product. Never a URL, never the marketplace's name; free text through
// neutralText; photos as ids/sizes/alt/colors only.

import {
  LIVE_PARTS,
  TRANSLATION_CODES,
  type CompeteListingRow,
  type CompeteMoney,
  type LiveImage,
  type LivePart,
  type ShippingProfileInfo
} from '../../../shared/features/compete'
import { normalizeCountry } from '../../../shared/countries'
import { missingScopes } from '../../../shared/myShop'
import { priceValue } from '../../../shared/format'
import type { EtsyClient } from '../../etsyApi'
import { ToolInputError, textResult, type McpTool } from '../../mcpProtocol'
import { NOT_SIGNED_IN } from '../../mcpStoreTools'
import { neutralText } from '../../neutral'
import { mcpFail, neutralError } from '../common'
import type { FeatureMcpDeps } from '../types'
import {
  SHIPPING_SCOPES,
  featuredListings,
  listingImages,
  listingPersonalization,
  listingProperties,
  listingReviews,
  listingTranslation,
  listingVideos,
  listingsShipping,
  returnPolicies,
  sectionListings,
  shippingCarriers,
  shopSections,
  variationImages
} from './api'
import { optInt } from './map'

export const NOT_AVAILABLE = 'Not available: the app has no connection to the store service configured (no API key).'
export const TRANSLATION_NOT_FOUND =
  'Nothing found for this language: the product has no translation into it, or the product is not (or no longer) in that store.'
/** get_store_sections include_products: at most this many products (5 requests). */
export const SECTION_PRODUCTS_MAX = 500
const DEFAULT_PARTS: readonly LivePart[] = LIVE_PARTS.filter((p) => p !== 'shipping')

const isoSec = (s: number | null | undefined): string | null => (s == null ? null : new Date(s * 1000).toISOString())
const money = (m: CompeteMoney | null): { amount: number; currency: string } | null =>
  m ? { amount: priceValue(m.amount, m.divisor), currency: m.currency } : null

function publicClient(deps: FeatureMcpDeps): EtsyClient {
  if (!deps.client) throw new ToolInputError(NOT_AVAILABLE)
  return deps.client
}

const product = (l: CompeteListingRow) => ({
  product_id: l.listingId,
  title: neutralText(l.title),
  price: money(l.price),
  status: l.state,
  quantity: l.quantity,
  featured_position: l.featuredRank,
  favorites: l.numFavorers,
  section_id: l.shopSectionId
})

const photo = (i: LiveImage) => ({
  photo_id: i.id,
  position: i.rank,
  width: i.width,
  height: i.height,
  alt_text: neutralText(i.altText),
  color: { hex: i.hexCode, red: i.red, green: i.green, blue: i.blue, hue: i.hue, saturation: i.saturation, brightness: i.brightness },
  black_and_white: i.isBlackAndWhite
})

const shippingProfile = (p: ShippingProfileInfo) => ({
  name: neutralText(p.title),
  origin_country: p.originCountry,
  origin_postal_code: p.originPostalCode,
  profile_type: p.profileType,
  deleted: p.isDeleted,
  domestic_handling_fee: p.domesticHandlingFee,
  international_handling_fee: p.internationalHandlingFee,
  destinations: p.destinations.map((d) => ({
    destination_country: d.destinationCountry,
    destination_region: d.destinationRegion,
    cost: money(d.primaryCost),
    cost_with_another_item: money(d.secondaryCost),
    carrier_id: d.carrierId,
    mail_class: d.mailClass,
    min_delivery_days: d.minDeliveryDays,
    max_delivery_days: d.maxDeliveryDays
  })),
  upgrades: p.upgrades.map((u) => ({
    name: neutralText(u.name),
    scope: u.type === 0 ? 'domestic' : u.type === 1 ? 'international' : null,
    price: money(u.price),
    price_per_additional_item: money(u.secondaryPrice),
    carrier_id: u.carrierId,
    mail_class: u.mailClass,
    min_delivery_days: u.minDeliveryDays,
    max_delivery_days: u.maxDeliveryDays
  }))
})

/**
 * Signed in with `scopes` — owning a store or not (getListingsShippingByListingIds
 * needs only the scope), else a neutral ToolInputError. Mirrors requireSignIn.
 */
export function mcpSignedIn(deps: FeatureMcpDeps, scopes: readonly string[]): void {
  const st = deps.authStatus()
  if (!deps.client || !st.loggedIn) throw new ToolInputError(NOT_SIGNED_IN)
  const missing = missingScopes(st.scopes, scopes)
  if (missing.length) {
    throw new ToolInputError(
      `The user's sign-in lacks a permission this needs (${missing.join(', ')}). Ask them to sign out and sign in again in the app ("✏️ Мій магазин").`
    )
  }
}

/** The parts asked for (validated: the protocol checks only the array type). */
export function partsArg(v: unknown): LivePart[] {
  if (v == null) return [...DEFAULT_PARTS]
  const parts = v as unknown[]
  const bad = parts.find((p) => !LIVE_PARTS.includes(p as LivePart))
  if (bad !== undefined) throw new ToolInputError(`Unknown part "${String(bad)}". Use: ${LIVE_PARTS.join(', ')}.`)
  return [...new Set(parts as LivePart[])]
}

/** The store of a product in our snapshot data, else undefined. */
function knownStore(deps: FeatureMcpDeps, productId: number): number | undefined {
  const row = deps.db.prepare('SELECT shop_id FROM listings WHERE listing_id = ?').get(productId) as { shop_id: number } | undefined
  return row?.shop_id
}

/** The store of a product by one live lookup. */
async function liveStore(client: EtsyClient, productId: number): Promise<number> {
  const l = await client.call<{ shop_id?: unknown } | undefined>(`/v3/application/listings/${productId}`)
  const id = optInt(l?.shop_id)
  if (!id) throw new ToolInputError(`Product ${productId} was not found.`)
  return id
}

async function liveDetails(deps: FeatureMcpDeps, a: Record<string, unknown>) {
  const client = publicClient(deps)
  const productId = a.product_id as number
  const parts = partsArg(a.parts)
  const language = a.language as string | undefined
  if (!parts.length && !language) throw new ToolInputError('Ask for at least one part or a language.')
  const out: Record<string, unknown> = { product_id: productId }
  // Our snapshot data wins over a given store_id (a wrong one would only turn
  // the store-scoped reads into "not found"); unknown to us → given, else live.
  const known = knownStore(deps, productId)
  const given = a.store_id as number | undefined
  if (known && given && known !== given) out.store_id_note = `Product ${productId} belongs to store ${known}; store_id ${given} was ignored.`
  let store: Promise<number> | null = known || given ? Promise.resolve((known ?? given) as number) : null
  const storeId = (): Promise<number> => (store ??= liveStore(client, productId))
  const errors: Record<string, string> = {}

  const readers: Record<LivePart, () => Promise<unknown>> = {
    properties: async () =>
      (await listingProperties(client, await storeId(), productId)).map((p) => ({
        attribute_id: p.propertyId,
        name: neutralText(p.name),
        scale: neutralText(p.scaleName),
        values: p.values.map((v) => neutralText(v))
      })),
    photos: async () => (await listingImages(client, productId)).map(photo),
    videos: async () =>
      (await listingVideos(client, productId)).map((v) => ({ video_id: v.id, width: v.width, height: v.height, status: v.state })),
    personalization: async () =>
      (await listingPersonalization(client, productId)).map((q) => ({
        question: neutralText(q.text),
        instructions: neutralText(q.instructions),
        type: q.type,
        required: q.required,
        max_characters: q.maxChars,
        max_files: q.maxFiles,
        add_on_price: money(q.addOnPrice),
        options: q.options.map((o) => neutralText(o.label))
      })),
    variation_photos: async () =>
      (await variationImages(client, await storeId(), productId)).map((v) => ({
        attribute_id: v.propertyId,
        value_id: v.valueId,
        value: neutralText(v.value),
        photo_id: v.imageId
      })),
    shipping: async () => {
      mcpSignedIn(deps, SHIPPING_SCOPES)
      const [s] = await listingsShipping(client, [productId])
      if (s?.profile) return shippingProfile(s.profile)
      out.shipping_note = 'Shipping details are only shared for products of the user’s own store.'
      return null
    },
    reviews: async () => {
      const page = await listingReviews(client, productId, (a.reviews_offset as number) ?? 0, (a.reviews_limit as number) ?? 25)
      return {
        total: page.count,
        offset: page.offset,
        items: page.reviews.map((r) => ({
          rating: r.rating,
          text: neutralText(r.text),
          language: r.language,
          created_at: isoSec(r.createdAt),
          updated_at: isoSec(r.updatedAt),
          has_photo: r.imageUrl != null
        }))
      }
    }
  }
  for (const part of parts) {
    try {
      out[part] = await readers[part]()
    } catch (e) {
      errors[part] = neutralError(e)
    }
  }
  if (language) {
    try {
      const t = await listingTranslation(client, await storeId(), productId, language)
      out.translation = t && {
        language: t.language,
        title: neutralText(t.title),
        description: neutralText(t.description),
        tags: t.tags.map((x) => neutralText(x))
      }
      if (!t) out.translation_note = TRANSLATION_NOT_FOUND
    } catch (e) {
      errors.translation = neutralError(e)
    }
  }
  if (store) out.store_id = await store.catch(() => null)
  if (Object.keys(errors).length) out.errors = errors
  return out
}

async function sectionsWithProducts(client: EtsyClient, storeId: number, includeProducts: boolean) {
  const sections = await shopSections(client, storeId)
  const out = sections.map((s) => ({
    section_id: s.id,
    title: neutralText(s.title),
    position: s.rank,
    active_product_count: s.activeListingCount,
    ...(includeProducts ? { products: [] as Array<{ product_id: number; title: string; price: ReturnType<typeof money> }> } : {})
  }))
  if (!includeProducts || !sections.length) return { store_id: storeId, sections: out }
  const rows: CompeteListingRow[] = []
  let total = 0
  do {
    const page = await sectionListings(client, storeId, sections.map((s) => s.id), rows.length)
    total = page.count
    rows.push(...page.listings)
    if (!page.listings.length) break
  } while (rows.length < total && rows.length < SECTION_PRODUCTS_MAX)
  for (const l of rows) {
    out.find((s) => s.section_id === l.shopSectionId)?.products?.push({ product_id: l.listingId, title: neutralText(l.title), price: money(l.price) })
  }
  return { store_id: storeId, sections: out, products_total: total, products_truncated: rows.length < total }
}

const storeIdSchema = { type: 'integer', minimum: 1, description: 'Store id (from list_stores or get_store).' } as const

export function competeMcpTools(deps: FeatureMcpDeps): McpTool[] {
  const run =
    (fn: (a: Record<string, unknown>) => Promise<unknown>) =>
    async (a: Record<string, unknown>) => {
      try {
        return textResult(await fn(a))
      } catch (e) {
        return mcpFail(e)
      }
    }
  return [
    {
      name: 'get_store_sections',
      title: 'Store sections (live)',
      description:
        'Live: the sections (shelves) of any store, in display order, with how many active products each has. With include_products, also the active products of each section (id, title, price; at most 500 products overall — products_truncated says when more exist).',
      inputSchema: {
        type: 'object',
        properties: {
          store_id: storeIdSchema,
          include_products: { type: 'boolean', description: 'Also list the products of each section. Default false.' }
        },
        required: ['store_id'],
        additionalProperties: false
      },
      run: run((a) => sectionsWithProducts(publicClient(deps), a.store_id as number, a.include_products === true))
    },
    {
      name: 'get_store_featured',
      title: 'Featured products of a store (live)',
      description:
        'Live: the products a store features on its front page (featured_position 1 = first), with price, status, favorites and section. Paged with limit/offset; total = all featured products.',
      inputSchema: {
        type: 'object',
        properties: {
          store_id: storeIdSchema,
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Page size, default 25.' },
          offset: { type: 'integer', minimum: 0, maximum: 12000, description: 'Products to skip, default 0.' }
        },
        required: ['store_id'],
        additionalProperties: false
      },
      run: run(async (a) => {
        const page = await featuredListings(publicClient(deps), a.store_id as number, (a.offset as number) ?? 0, (a.limit as number) ?? 25)
        return { store_id: a.store_id, total: page.count, offset: page.offset, products: page.listings.map(product) }
      })
    },
    {
      name: 'get_store_return_policies',
      title: 'Return policies of a store (live)',
      description:
        'Live: the return policies a store uses for its products — whether it accepts returns and exchanges, and the return window in days.',
      inputSchema: {
        type: 'object',
        properties: { store_id: storeIdSchema },
        required: ['store_id'],
        additionalProperties: false
      },
      run: run(async (a) => ({
        store_id: a.store_id,
        policies: (await returnPolicies(publicClient(deps), a.store_id as number)).map((p) => ({
          accepts_returns: p.acceptsReturns,
          accepts_exchanges: p.acceptsExchanges,
          return_window_days: p.returnDeadline
        }))
      }))
    },
    {
      name: 'get_product_live_details',
      title: 'Live product details',
      description:
        'Live details of any product, read now (not from a snapshot). parts (default: all but shipping): properties = attributes (e.g. color, size) with values; photos = id, position, size, alt text, average color (no images — use get_product_image for tracked products); videos = id, size, status; personalization = the questions a buyer answers; variation_photos = which photo each variation value shows; shipping = the shipping profile (costs per destination, delivery days, upgrades) — needs the user’s sign-in and is only shared for the user’s own products; reviews = one page of the product’s reviews (reviews_limit/reviews_offset). language adds the product’s translation into that language (null = no translation, or the product was not found in that store — translation_note says so). A part that fails is reported in errors without failing the rest.',
      inputSchema: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', minimum: 1, description: 'Product id.' },
          store_id: { type: 'integer', minimum: 1, description: 'The product’s store id (optional — looked up when omitted; a tracked product always uses its known store).' },
          parts: {
            type: 'array',
            items: { type: 'string', enum: LIVE_PARTS },
            description: `Which parts to read: ${LIVE_PARTS.join(', ')}.`
          },
          language: { type: 'string', enum: TRANSLATION_CODES, description: 'Also read the translation into this language.' },
          reviews_limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Reviews per page, default 25.' },
          reviews_offset: { type: 'integer', minimum: 0, maximum: 12000, description: 'Reviews to skip, default 0.' }
        },
        required: ['product_id'],
        additionalProperties: false
      },
      run: run((a) => liveDetails(deps, a))
    },
    {
      name: 'list_shipping_carriers',
      title: 'Shipping carriers of a country',
      description:
        'The shipping carriers available for parcels sent from a country, each with its domestic and international mail classes (key + name) — used for delivery-date estimates in shipping profiles.',
      inputSchema: {
        type: 'object',
        properties: {
          origin_country: { type: 'string', minLength: 2, maxLength: 2, description: 'ISO 3166-1 alpha-2 country code, e.g. US, GB, UA.' }
        },
        required: ['origin_country'],
        additionalProperties: false
      },
      run: run(async (a) => {
        const country = normalizeCountry(a.origin_country)
        if (!country) throw new ToolInputError('origin_country must be an ISO 3166-1 alpha-2 country code, e.g. US.')
        const carriers = await shippingCarriers(publicClient(deps), country)
        return {
          origin_country: country,
          carriers: carriers.map((c) => ({
            id: c.id,
            name: neutralText(c.name),
            domestic_classes: c.domesticClasses.map((m) => ({ key: m.key, name: neutralText(m.name) })),
            international_classes: c.internationalClasses.map((m) => ({ key: m.key, name: neutralText(m.name) }))
          }))
        }
      })
    }
  ]
}
