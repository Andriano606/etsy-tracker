// The MCP tools of the "compete" feature: live Etsy API reads of any Etsy shop
// ("store") / listing ("product"), each call costing API quota. Text from Etsy
// goes out as Etsy returned it (entities decoded); no URLs (no listing pages,
// no CDN images), no ids of Etsy-internal objects the client can't use;
// photos as ids/sizes/alt/colors only.

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
import { mcpFail, mcpErrorText } from '../common'
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

export const NOT_AVAILABLE = 'Not available: the app has no Etsy API key configured (Settings), so it cannot read Etsy live.'
/** Etsy's 404 for getListingTranslation is generic, so both meanings are named. */
export const TRANSLATION_NOT_FOUND =
  'Etsy found nothing for this language: the listing has no translation into it, or the listing is not (or no longer) in that shop.'
/** Etsy answers getListingsShippingByListingIds with a null profile for listings the signed-in user doesn't own. */
export const SHIPPING_NOT_SHARED = 'Etsy shares shipping profiles only for listings of the signed-in user’s own shop.'
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
  title: l.title,
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
  alt_text: i.altText,
  color: { hex: i.hexCode, red: i.red, green: i.green, blue: i.blue, hue: i.hue, saturation: i.saturation, brightness: i.brightness },
  black_and_white: i.isBlackAndWhite
})

const shippingProfile = (p: ShippingProfileInfo) => ({
  name: p.title,
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
    name: u.name,
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
 * Signed in to Etsy with `scopes` — owning a shop or not (getListingsShippingByListingIds
 * needs only the scope), else a ToolInputError for the client. Mirrors requireSignIn.
 */
export function mcpSignedIn(deps: FeatureMcpDeps, scopes: readonly string[]): void {
  const st = deps.authStatus()
  if (!deps.client || !st.loggedIn) throw new ToolInputError(NOT_SIGNED_IN)
  const missing = missingScopes(st.scopes, scopes)
  if (missing.length) {
    throw new ToolInputError(
      `The user's Etsy sign-in lacks an OAuth scope this needs (${missing.join(', ')}). Ask them to sign out and sign in to Etsy again in the app: the "Керувати" button in their own shop's header → "Вийти", then "Увійти через Etsy".`
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

/** The shop of a listing in the local database (tracked shops), else undefined. */
function knownStore(deps: FeatureMcpDeps, productId: number): number | undefined {
  const row = deps.db.prepare('SELECT shop_id FROM listings WHERE listing_id = ?').get(productId) as { shop_id: number } | undefined
  return row?.shop_id
}

/** The shop of a listing by one live getListing call. */
async function liveStore(client: EtsyClient, productId: number): Promise<number> {
  const l = await client.call<{ shop_id?: unknown } | undefined>(`/v3/application/listings/${productId}`)
  const id = optInt(l?.shop_id)
  if (!id) throw new ToolInputError(`Etsy returned no shop for listing ${productId}.`)
  return id
}

async function liveDetails(deps: FeatureMcpDeps, a: Record<string, unknown>) {
  const client = publicClient(deps)
  const productId = a.product_id as number
  const parts = partsArg(a.parts)
  const language = a.language as string | undefined
  if (!parts.length && !language) throw new ToolInputError('Ask for at least one part or a language.')
  const out: Record<string, unknown> = { product_id: productId }
  // The local database wins over a given store_id (a wrong one would only turn
  // the shop-scoped reads into "not found"); untracked → given, else live.
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
        name: p.name,
        scale: p.scaleName,
        values: p.values
      })),
    photos: async () => (await listingImages(client, productId)).map(photo),
    videos: async () =>
      (await listingVideos(client, productId)).map((v) => ({ video_id: v.id, width: v.width, height: v.height, status: v.state })),
    personalization: async () =>
      (await listingPersonalization(client, productId)).map((q) => ({
        question: q.text,
        instructions: q.instructions,
        type: q.type,
        required: q.required,
        max_characters: q.maxChars,
        max_files: q.maxFiles,
        add_on_price: money(q.addOnPrice),
        options: q.options.map((o) => o.label)
      })),
    variation_photos: async () =>
      (await variationImages(client, await storeId(), productId)).map((v) => ({
        attribute_id: v.propertyId,
        value_id: v.valueId,
        value: v.value,
        photo_id: v.imageId
      })),
    shipping: async () => {
      mcpSignedIn(deps, SHIPPING_SCOPES)
      const [s] = await listingsShipping(client, [productId])
      if (s?.profile) return shippingProfile(s.profile)
      out.shipping_note = SHIPPING_NOT_SHARED
      return null
    },
    reviews: async () => {
      const page = await listingReviews(client, productId, (a.reviews_offset as number) ?? 0, (a.reviews_limit as number) ?? 25)
      return {
        total: page.count,
        offset: page.offset,
        items: page.reviews.map((r) => ({
          rating: r.rating,
          text: r.text,
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
      errors[part] = mcpErrorText(e)
    }
  }
  if (language) {
    try {
      const t = await listingTranslation(client, await storeId(), productId, language)
      out.translation = t && {
        language: t.language,
        title: t.title,
        description: t.description,
        tags: t.tags
      }
      if (!t) out.translation_note = TRANSLATION_NOT_FOUND
    } catch (e) {
      errors.translation = mcpErrorText(e)
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
    title: s.title,
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
    out.find((s) => s.section_id === l.shopSectionId)?.products?.push({ product_id: l.listingId, title: l.title, price: money(l.price) })
  }
  return { store_id: storeId, sections: out, products_total: total, products_truncated: rows.length < total }
}

const storeIdSchema = {
  type: 'integer',
  minimum: 1,
  description: 'Etsy shop id: a store_id from list_stores / get_store / search_market, or any Etsy shop_id (the shop need not be tracked).'
} as const

/** Shared by the tool descriptions: what every call here is. */
const LIVE = 'Live Etsy API read (not the local database; costs API quota, needs only the app’s API key)'
const PRICE_NOTE = 'price = the listing’s base price set by the seller (before VAT and sales, not the buyer price)'

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
      title: 'Etsy shop sections (live)',
      openWorld: true,
      description:
        `${LIVE}: the sections of any Etsy shop, in the shop’s display order, with each section’s active listing count (1 request). include_products adds the listings of the sections (product_id, title, ${PRICE_NOTE}), 100 per extra request, at most ${SECTION_PRODUCTS_MAX} overall; products_total = Etsy’s count, products_truncated = more exist.`,
      inputSchema: {
        type: 'object',
        properties: {
          store_id: storeIdSchema,
          include_products: { type: 'boolean', description: `Also list each section’s listings (up to ${SECTION_PRODUCTS_MAX} in all). Default false.` }
        },
        required: ['store_id'],
        additionalProperties: false
      },
      run: run((a) => sectionsWithProducts(publicClient(deps), a.store_id as number, a.include_products === true))
    },
    {
      name: 'get_store_featured',
      title: 'Featured listings of an Etsy shop (live)',
      openWorld: true,
      description:
        `${LIVE}: the listings an Etsy shop features on its shop home page, one page per call — product_id, title, ${PRICE_NOTE}, status, quantity, featured_position (1 = first; null = not ranked), favorites (Etsy favorers), section_id. total = all featured listings; page with limit/offset.`,
      inputSchema: {
        type: 'object',
        properties: {
          store_id: storeIdSchema,
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Page size, default 25.' },
          offset: { type: 'integer', minimum: 0, maximum: 12000, description: 'Listings to skip, default 0.' }
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
      title: 'Return policies of an Etsy shop (live)',
      openWorld: true,
      description:
        `${LIVE}: the return policies an Etsy shop assigns to its listings — accepts_returns, accepts_exchanges and return_window_days (null = none). 1 request.`,
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
      title: 'Live Etsy listing details',
      openWorld: true,
      description:
        'Live Etsy API read (not the local database; costs API quota) of any Etsy listing, one request per part; every part but shipping needs only the app’s API key. parts (default: all but shipping): properties = the listing’s attributes (e.g. color, size) with values; photos = id, position, full size, alt text, average color, black_and_white (metadata only — get_product_image returns the photo of a tracked listing); videos = id, size, status; personalization = the questions a buyer answers (type, required, limits, add-on price, options); variation_photos = which photo each variation value shows; shipping = the listing’s shipping profile (costs per destination, delivery days, upgrades; carrier_id as in list_shipping_carriers) — needs the user’s Etsy sign-in with the OAuth scope shops_r, and Etsy returns it only for the user’s own listings (else null + shipping_note); reviews = one page of Etsy’s reviews of the listing (rating, text, language, dates, has_photo; reviews_limit/reviews_offset; list_reviews has the stored reviews of tracked shops). language adds Etsy’s translation of title/description/tags (null + translation_note when Etsy has none). properties, variation_photos and the translation need the shop: the tracked shop from the local database, else store_id, else one extra getListing request; the answer then has store_id. A part that fails is reported in errors without failing the rest.',
      inputSchema: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', minimum: 1, description: 'Etsy listing id (a product_id from the other tools, or any Etsy listing_id).' },
          store_id: {
            type: 'integer',
            minimum: 1,
            description: 'The listing’s Etsy shop id (optional — looked up live when omitted; a tracked listing always uses its known shop).'
          },
          parts: {
            type: 'array',
            items: { type: 'string', enum: LIVE_PARTS },
            description: `Which parts to read: ${LIVE_PARTS.join(', ')}.`
          },
          language: { type: 'string', enum: TRANSLATION_CODES, description: 'Also read Etsy’s translation of the listing into this language.' },
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
      title: 'Etsy shipping carriers of a country (live)',
      openWorld: true,
      description:
        `${LIVE}: the shipping carriers Etsy supports for parcels sent from a country, each with its domestic and international mail classes (key + name) — the carrier_id / mail_class values Etsy shipping profiles use for delivery-time estimates. 1 request.`,
      inputSchema: {
        type: 'object',
        properties: {
          origin_country: { type: 'string', minLength: 2, maxLength: 2, description: 'Origin country, ISO 3166-1 alpha-2 (e.g. US, GB, UA; UK = GB).' }
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
            name: c.name,
            domestic_classes: c.domesticClasses.map((m) => ({ key: m.key, name: m.name })),
            international_classes: c.internationalClasses.map((m) => ({ key: m.key, name: m.name }))
          }))
        }
      })
    }
  ]
}
