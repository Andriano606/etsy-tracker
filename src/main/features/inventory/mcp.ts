// Inventory feature, the MCP side: live Etsy API tools over the user's own
// Etsy shop ("product" = listing, "variant" = inventory product, "offer" =
// offering, "option" = variation property). No URLs: photos go by id.

import {
  inventoryProperties,
  inventorySummary,
  moneyValue,
  type InvMoney,
  type InvOffering,
  type InvProduct,
  type InventoryOverviewRow,
  type InventoryWrite,
  type InvWriteProduct,
  type ListingInventory,
  type VariationImageInput
} from '../../../shared/features/inventory'
import { errorResult, textResult, ToolInputError, type JsonSchema, type McpTool, type McpToolResult } from '../../mcpProtocol'
import { mcpFail, mcpOwnShop, mcpWritable } from '../common'
import type { FeatureMcpDeps } from '../types'
import {
  InvError,
  READ_SCOPES,
  WRITE_SCOPES,
  getInventory,
  getOffering,
  getProduct,
  inventoriesByIdsLenient,
  overviewPage,
  overviewRow,
  putInventory,
  setVariationImages,
  updateSingle,
  variationImagesData,
  type SingleChange
} from './api'

/** Our own refusals answer their English text (it may quote the shop's option names and values as they are). */
const fail = (e: unknown): McpToolResult => (e instanceof InvError ? errorResult(e.en) : mcpFail(e))
const amount = (m: InvMoney | null): number | null => (m ? moneyValue(m) : null)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const posInt = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) > 0

// ------------------------------------------------------------------ outputs

const offerOut = (o: InvOffering) => ({
  offer_id: o.offeringId,
  price: amount(o.price),
  currency: o.price?.currency ?? null,
  quantity: o.quantity,
  enabled: o.isEnabled,
  processing_profile_id: o.readinessStateId
})

const variantOut = (p: InvProduct) => ({
  variant_id: p.productId,
  sku: p.sku || null,
  options: p.propertyValues.map((v) => ({
    option_id: v.propertyId,
    option_name: v.propertyName,
    value: v.values.join(', '),
    value_id: v.valueIds[0] ?? null,
    scale: v.scaleName
  })),
  offers: p.offerings.map(offerOut)
})

export function inventoryOut(inv: ListingInventory) {
  const s = inventorySummary(inv)
  return {
    product_id: inv.listingId,
    currency: s.priceMin?.currency ?? null,
    options: inventoryProperties(inv.products).map((p) => ({
      option_id: p.propertyId,
      name: p.name,
      values: p.values.map((v) => ({ value_id: v.valueId, value: v.value }))
    })),
    price_varies_by: inv.priceOnProperty,
    quantity_varies_by: inv.quantityOnProperty,
    sku_varies_by: inv.skuOnProperty,
    processing_varies_by: inv.readinessStateOnProperty,
    variants: inv.products.map(variantOut)
  }
}

const overviewOut = (r: InventoryOverviewRow) => ({
  product_id: r.listingId,
  title: r.title,
  status: r.state,
  currency: r.priceMin?.currency ?? null,
  price_min: amount(r.priceMin),
  price_max: amount(r.priceMax),
  total_quantity: r.totalQuantity,
  variants: r.productCount,
  enabled_variants: r.enabledCount,
  single_price_entry: r.single != null,
  has_variant_data: r.hasInventory
})

// -------------------------------------------------------------------- inputs

const OPTION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    option_id: { type: 'integer', minimum: 1, description: "The option's Etsy property id (from get_my_product_inventory; Etsy's custom options use 513 and 514)." },
    option_name: { type: 'string', description: 'The option name, e.g. "Size" (default: the current name of that option).' },
    value: { type: 'string', minLength: 1, description: 'The value, e.g. "M". Parentheses are not allowed.' },
    value_id: { type: 'integer', minimum: 1, description: 'The value id when reusing an existing value (default: looked up by text).' },
    scale_id: { type: 'integer', minimum: 1, description: 'The measurement scale id, for sized options that use one.' }
  },
  required: ['option_id', 'value'],
  additionalProperties: false
}

const VARIANT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    options: { type: 'array', items: OPTION_SCHEMA, description: 'This variant’s option values; omit for a product without variants.' },
    sku: { type: 'string', maxLength: 255 },
    price: { type: 'number', description: "The seller's price in the shop currency (before VAT and sales), > 0, at most 2 decimals." },
    quantity: { type: 'integer', minimum: 0, maximum: 999 },
    enabled: { type: 'boolean', description: 'Offered to buyers (default true).' },
    processing_profile_id: { type: 'integer', minimum: 1, description: 'Default: the current one of the same variant, else of the first variant.' }
  },
  required: ['price', 'quantity'],
  additionalProperties: false
}

const IDS = (description: string): JsonSchema => ({ type: 'array', items: { type: 'integer', minimum: 1 }, description })

const KEYS = {
  option: ['option_id', 'option_name', 'value', 'value_id', 'scale_id'],
  variant: ['options', 'sku', 'price', 'quantity', 'enabled', 'processing_profile_id'],
  link: ['option_id', 'value_id', 'photo_id']
}

function checkKeys(o: Record<string, unknown>, allowed: string[], where: string): void {
  const extra = Object.keys(o).find((k) => !allowed.includes(k))
  if (extra) throw new ToolInputError(`${where}: unknown field "${extra}".`)
}

function idsArg(v: unknown, name: string): number[] | undefined {
  if (v == null) return undefined
  if (!Array.isArray(v) || !v.every(posInt)) throw new ToolInputError(`"${name}" must be a list of positive whole numbers.`)
  return v as number[]
}

const comboKey = (opts: Array<{ propertyId: number; values: string[] }>): string =>
  JSON.stringify([...opts].sort((a, b) => a.propertyId - b.propertyId).map((o) => [o.propertyId, o.values.map((s) => s.trim().toLowerCase())]))

/** The MCP `variants` list → a full inventory, filling ids/names/processing from the current one. */
export function variantsToWrite(cur: ListingInventory, raw: unknown, varies: Record<string, unknown>): InventoryWrite {
  if (!Array.isArray(raw) || !raw.length) throw new ToolInputError('"variants" must be a non-empty list.')
  const props = inventoryProperties(cur.products)
  const firstReadiness = cur.products[0]?.offerings[0]?.readinessStateId ?? null
  const products: InvWriteProduct[] = raw.map((v, i) => {
    const where = `variants[${i}]`
    if (!isObj(v)) throw new ToolInputError(`${where} must be an object.`)
    checkKeys(v, KEYS.variant, where)
    if (typeof v.price !== 'number') throw new ToolInputError(`${where}.price must be a number.`)
    if (!Number.isSafeInteger(v.quantity)) throw new ToolInputError(`${where}.quantity must be a whole number.`)
    if (v.sku != null && typeof v.sku !== 'string') throw new ToolInputError(`${where}.sku must be text.`)
    if (v.enabled != null && typeof v.enabled !== 'boolean') throw new ToolInputError(`${where}.enabled must be true or false.`)
    if (v.processing_profile_id != null && !posInt(v.processing_profile_id)) {
      throw new ToolInputError(`${where}.processing_profile_id must be a positive whole number.`)
    }
    if (v.options != null && !Array.isArray(v.options)) throw new ToolInputError(`${where}.options must be a list.`)
    const propertyValues = ((v.options as unknown[] | undefined) ?? []).map((o, j) => {
      const w = `${where}.options[${j}]`
      if (!isObj(o)) throw new ToolInputError(`${w} must be an object.`)
      checkKeys(o, KEYS.option, w)
      if (!posInt(o.option_id)) throw new ToolInputError(`${w}.option_id must be a positive whole number.`)
      if (typeof o.value !== 'string' || !o.value.trim()) throw new ToolInputError(`${w}.value must be non-empty text.`)
      if (o.option_name != null && typeof o.option_name !== 'string') throw new ToolInputError(`${w}.option_name must be text.`)
      for (const k of ['value_id', 'scale_id']) {
        if (o[k] != null && !posInt(o[k])) throw new ToolInputError(`${w}.${k} must be a positive whole number.`)
      }
      const propertyId = o.option_id as number
      const value = (o.value as string).trim()
      const known = props.find((p) => p.propertyId === propertyId)
      const knownValue = known?.values.find((x) => x.value.trim().toLowerCase() === value.toLowerCase())
      const curScale = cur.products.flatMap((p) => p.propertyValues).find((x) => x.propertyId === propertyId)?.scaleId ?? null
      const valueId = (o.value_id as number | undefined) ?? knownValue?.valueId ?? null
      return {
        propertyId,
        propertyName: (o.option_name as string | undefined)?.trim() || (known ? known.name : null),
        scaleId: (o.scale_id as number | undefined) ?? curScale,
        valueIds: valueId != null ? [valueId] : [],
        values: [value]
      }
    })
    const twin = cur.products.find((p) => comboKey(p.propertyValues) === comboKey(propertyValues))
    return {
      sku: typeof v.sku === 'string' ? v.sku.trim() : '',
      propertyValues,
      offerings: [
        {
          price: v.price,
          quantity: v.quantity as number,
          isEnabled: v.enabled !== false,
          readinessStateId: (v.processing_profile_id as number | undefined) ?? twin?.offerings[0]?.readinessStateId ?? firstReadiness
        }
      ]
    }
  })
  const present = new Set(products.flatMap((p) => p.propertyValues.map((v) => v.propertyId)))
  const keep = (ids: number[]): number[] => ids.filter((id) => present.has(id))
  return {
    products,
    priceOnProperty: idsArg(varies.price_varies_by, 'price_varies_by') ?? keep(cur.priceOnProperty),
    quantityOnProperty: idsArg(varies.quantity_varies_by, 'quantity_varies_by') ?? keep(cur.quantityOnProperty),
    skuOnProperty: idsArg(varies.sku_varies_by, 'sku_varies_by') ?? keep(cur.skuOnProperty),
    readinessStateOnProperty: idsArg(varies.processing_varies_by, 'processing_varies_by') ?? keep(cur.readinessStateOnProperty)
  }
}

function linksArg(raw: unknown): VariationImageInput[] {
  if (!Array.isArray(raw)) throw new ToolInputError('"links" must be a list.')
  return raw.map((x, i) => {
    const where = `links[${i}]`
    if (!isObj(x)) throw new ToolInputError(`${where} must be an object.`)
    checkKeys(x, KEYS.link, where)
    for (const k of KEYS.link) if (!posInt(x[k])) throw new ToolInputError(`${where}.${k} must be a positive whole number.`)
    return { propertyId: x.option_id as number, valueId: x.value_id as number, imageId: x.photo_id as number }
  })
}

const LIVE =
  'This changes the user\'s live Etsy shop — buyers see it at once. Needs the "allow changes" switch in the app\'s MCP window; use only when the user asked for this change.'

// --------------------------------------------------------------------- tools

export function inventoryMcpTools(deps: FeatureMcpDeps): McpTool[] {
  const client = () => deps.client!
  return [
    {
      name: 'get_my_product_inventory',
      title: 'My Etsy listing: variants, prices, stock',
      openWorld: true,
      description:
        "Live from the Etsy API (getListingInventory; OAuth listings_r, 1 request): the inventory of one listing in the user's own Etsy shop — its variants (Etsy inventory products), each with its option values (e.g. Size = M), SKU and offers (Etsy offerings: the seller's price before VAT and sales, currency, quantity in stock, enabled, processing_profile_id); the options with their values; and which option ids the price / quantity / SKU / processing profile vary by. Deleted variants and offers are left out. With variant_id: only that variant (getListingProduct); with variant_id and offer_id: only that offer (getListingOffering).",
      inputSchema: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', minimum: 1, description: 'The Etsy listing id (from list_my_products).' },
          variant_id: { type: 'integer', minimum: 1, description: 'An Etsy inventory product id (variant_id from this tool).' },
          offer_id: { type: 'integer', minimum: 1, description: 'An Etsy offering id (offer_id from this tool); needs variant_id.' }
        },
        required: ['product_id'],
        additionalProperties: false
      },
      run: async (args) => {
        try {
          mcpOwnShop(deps, READ_SCOPES)
          const id = args.product_id as number
          const variant = args.variant_id as number | undefined
          const offer = args.offer_id as number | undefined
          if (offer != null && variant == null) throw new ToolInputError('offer_id needs variant_id.')
          if (variant != null && offer != null) {
            return textResult({ product_id: id, variant_id: variant, offer: offerOut(await getOffering(client(), id, variant, offer)) })
          }
          if (variant != null) return textResult({ product_id: id, variant: variantOut(await getProduct(client(), id, variant)) })
          return textResult(inventoryOut(await getInventory(client(), id)))
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'get_my_inventory_overview',
      title: 'My Etsy listings: price ranges and stock',
      openWorld: true,
      description:
        "Live from the Etsy API (OAuth listings_r): per listing of the user's own Etsy shop — title, status, currency, price range (lowest–highest seller price over the enabled offers), total quantity in stock of the enabled offers, number of variants and of enabled variants, single_price_entry (exactly one variant with one offer, so update_my_product_price works) and has_variant_data (false = Etsy returned no inventory record; price and quantity are then the listing's own). With product_ids (1–100): those listings (getListingsInventoryByListingIds, 1 request — more when some ids are unknown to Etsy; ids Etsy doesn't know or that aren't in the user's shop are listed in not_in_store; offset/limit are ignored). Without: one page of the shop's ACTIVE listings (offset/limit; total = the number of active listings; 2 requests).",
      inputSchema: {
        type: 'object',
        properties: {
          product_ids: IDS('Up to 100 Etsy listing ids of the user’s shop.'),
          offset: { type: 'integer', minimum: 0, default: 0, description: 'Without product_ids: where the page of active listings starts.' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 100, description: 'Without product_ids: the page size.' }
        },
        additionalProperties: false
      },
      run: async (args) => {
        try {
          const shopId = mcpOwnShop(deps, READ_SCOPES)
          const ids = idsArg(args.product_ids, 'product_ids')
          if (ids) {
            if (!ids.length || ids.length > 100) throw new ToolInputError('"product_ids" must hold 1 to 100 ids.')
            const mine = (await inventoriesByIdsLenient(client(), [...new Set(ids)])).filter((l) => l.shop_id === shopId)
            return textResult({
              products: mine.map((l) => overviewOut(overviewRow(l))),
              not_in_store: ids.filter((id) => !mine.some((l) => l.listing_id === id))
            })
          }
          const offset = (args.offset as number | undefined) ?? 0
          const page = await overviewPage(client(), shopId, offset, (args.limit as number | undefined) ?? 100)
          return textResult({ total: page.total, offset, products: page.rows.map(overviewOut) })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'update_my_product_price',
      title: 'Change price / stock of a simple Etsy listing',
      openWorld: true,
      description: `Sets the price, quantity in stock and/or SKU of a listing in the user's own Etsy shop that has exactly one variant with one offer (no options): reads its inventory, changes those values and writes the whole inventory back (getListingInventory + updateListingInventory; OAuth listings_r + listings_w, 2 requests). Give at least one of price, quantity, sku. Fails for a listing with several variants, or with no inventory record yet — use update_my_product_inventory then. Returns updated: true and the saved inventory (as get_my_product_inventory). ${LIVE}`,
      inputSchema: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', minimum: 1, description: 'The Etsy listing id (from list_my_products).' },
          price: { type: 'number', description: "The seller's price in the shop currency (before VAT and sales), > 0, at most 2 decimals." },
          quantity: { type: 'integer', minimum: 0, maximum: 999 },
          sku: { type: 'string', maxLength: 255, description: '"" clears the SKU.' }
        },
        required: ['product_id'],
        additionalProperties: false
      },
      readOnly: false,
      destructive: true,
      run: async (args) => {
        try {
          mcpWritable(deps, [...READ_SCOPES, ...WRITE_SCOPES])
          const change: SingleChange = {}
          if (args.price != null) change.price = args.price as number
          if (args.quantity != null) change.quantity = args.quantity as number
          if (args.sku != null) change.sku = args.sku as string
          if (!Object.keys(change).length) throw new ToolInputError('Give price, quantity or sku.')
          return textResult({ updated: true, ...inventoryOut(await updateSingle(client(), args.product_id as number, change)) })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'update_my_product_inventory',
      title: 'Replace all variants of an Etsy listing',
      openWorld: true,
      description: `Replaces ALL variants of a listing in the user's own Etsy shop with the given list (updateListingInventory; every variant must be listed — one left out is deleted): each with its option values (up to 3 options, the same options in every variant), SKU, price (the seller's price in the shop currency), quantity and enabled flag. Option names, value ids, scales and processing profiles left out are taken from the current inventory. price_varies_by / quantity_varies_by / sku_varies_by / processing_varies_by list the option ids each depends on (default: as now, for the options the new variants still have); where a value doesn't vary, it must be the same for the variants concerned. The rules are checked before anything is written. Read get_my_product_inventory first. OAuth listings_r + listings_w, 2 requests. Returns updated: true and the saved inventory (as get_my_product_inventory). ${LIVE}`,
      inputSchema: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', minimum: 1, description: 'The Etsy listing id (from list_my_products).' },
          variants: { type: 'array', items: VARIANT_SCHEMA, description: 'The full list of variants.' },
          price_varies_by: IDS('Option ids the price depends on ([] = one price for all).'),
          quantity_varies_by: IDS('Option ids the quantity depends on.'),
          sku_varies_by: IDS('Option ids the SKU depends on.'),
          processing_varies_by: IDS('Option ids the processing profile depends on.')
        },
        required: ['product_id', 'variants'],
        additionalProperties: false
      },
      readOnly: false,
      destructive: true,
      run: async (args) => {
        try {
          mcpWritable(deps, [...READ_SCOPES, ...WRITE_SCOPES])
          const id = args.product_id as number
          const write = variantsToWrite(await getInventory(client(), id), args.variants, args)
          return textResult({ updated: true, ...inventoryOut(await putInventory(client(), id, write)) })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'get_my_variation_photos',
      title: 'My Etsy listing: photos of option values',
      openWorld: true,
      description:
        "Live from the Etsy API (OAuth listings_r; 3 requests: inventory, images, variation images): for a listing in the user's own Etsy shop — its options with their values and the photo linked to each value (Etsy variation images; photo_id = the listing image id, null = none), and the listing's photos (photo_id, position = Etsy's rank, alt text). No image bytes: to look at a photo of a listing the app has scanned, use get_product_image.",
      inputSchema: {
        type: 'object',
        properties: { product_id: { type: 'integer', minimum: 1, description: 'The Etsy listing id (from list_my_products).' } },
        required: ['product_id'],
        additionalProperties: false
      },
      run: async (args) => {
        try {
          const shopId = mcpOwnShop(deps, READ_SCOPES)
          const d = await variationImagesData(client(), shopId, args.product_id as number)
          return textResult({
            product_id: d.listingId,
            options: d.properties.map((p) => ({
              option_id: p.propertyId,
              name: p.name,
              values: p.values.map((v) => ({
                value_id: v.valueId,
                value: v.value,
                photo_id: d.assigned.find((a) => a.propertyId === p.propertyId && a.valueId === v.valueId)?.imageId ?? null
              }))
            })),
            photos: d.photos.map((p) => ({ photo_id: p.imageId, position: p.rank, alt_text: p.alt }))
          })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'set_my_variation_photos',
      title: 'Link photos to option values of an Etsy listing',
      openWorld: true,
      description: `Links photos of a listing in the user's own Etsy shop to values of ONE of its options, e.g. each Color its photo (updateVariationImages; OAuth listings_w, 1 request). Replaces every existing link: values left out lose theirs, an empty list removes them all; each value gets at most one photo. Ids from get_my_variation_photos (the photos must be the listing's own). Returns the links as Etsy saved them. ${LIVE}`,
      inputSchema: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', minimum: 1, description: 'The Etsy listing id (from list_my_products).' },
          links: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                option_id: { type: 'integer', minimum: 1 },
                value_id: { type: 'integer', minimum: 1 },
                photo_id: { type: 'integer', minimum: 1 }
              },
              required: ['option_id', 'value_id', 'photo_id'],
              additionalProperties: false
            }
          }
        },
        required: ['product_id', 'links'],
        additionalProperties: false
      },
      readOnly: false,
      destructive: true,
      run: async (args) => {
        try {
          const shopId = mcpWritable(deps, WRITE_SCOPES)
          const saved = await setVariationImages(client(), shopId, args.product_id as number, linksArg(args.links))
          return textResult({
            product_id: args.product_id,
            links: saved.map((s) => ({ option_id: s.propertyId, value_id: s.valueId, value: s.value, photo_id: s.imageId }))
          })
        } catch (e) {
          return fail(e)
        }
      }
    }
  ]
}
