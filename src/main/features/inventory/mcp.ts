// Inventory feature, the MCP side: neutral tools over the user's own store
// ("product" = listing, "variant" = inventory product, "offer" = offering,
// "option" = variation property). Never names the marketplace, never a URL.

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
import { neutralText } from '../../neutral'
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

/** Refusals quote the store's own option names and values — neutralized like any other store text. */
const fail = (e: unknown): McpToolResult => (e instanceof InvError ? errorResult(neutralText(e.en)) : mcpFail(e))
const amount = (m: InvMoney | null): number | null => (m ? moneyValue(m) : null)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const posInt = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) > 0

// ------------------------------------------------------------------ outputs

const neutralOffer = (o: InvOffering) => ({
  offer_id: o.offeringId,
  price: amount(o.price),
  currency: o.price?.currency ?? null,
  quantity: o.quantity,
  enabled: o.isEnabled,
  processing_profile_id: o.readinessStateId
})

const neutralVariant = (p: InvProduct) => ({
  variant_id: p.productId,
  sku: neutralText(p.sku) || null,
  options: p.propertyValues.map((v) => ({
    option_id: v.propertyId,
    option_name: neutralText(v.propertyName),
    value: neutralText(v.values.join(', ')),
    value_id: v.valueIds[0] ?? null,
    scale: neutralText(v.scaleName)
  })),
  offers: p.offerings.map(neutralOffer)
})

export function neutralInventory(inv: ListingInventory) {
  const s = inventorySummary(inv)
  return {
    product_id: inv.listingId,
    currency: s.priceMin?.currency ?? null,
    options: inventoryProperties(inv.products).map((p) => ({
      option_id: p.propertyId,
      name: neutralText(p.name),
      values: p.values.map((v) => ({ value_id: v.valueId, value: neutralText(v.value) }))
    })),
    price_varies_by: inv.priceOnProperty,
    quantity_varies_by: inv.quantityOnProperty,
    sku_varies_by: inv.skuOnProperty,
    processing_varies_by: inv.readinessStateOnProperty,
    variants: inv.products.map(neutralVariant)
  }
}

const neutralRow = (r: InventoryOverviewRow) => ({
  product_id: r.listingId,
  title: neutralText(r.title),
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
    option_id: { type: 'integer', minimum: 1, description: 'The option id (from get_my_product_inventory; custom options use the ids shown there).' },
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
    price: { type: 'number', description: 'Price in the store currency, > 0, at most 2 decimals.' },
    quantity: { type: 'integer', minimum: 0, maximum: 999 },
    enabled: { type: 'boolean', description: 'Offered to customers (default true).' },
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

/** The neutral `variants` list → a full inventory, filling ids/names/processing from the current one. */
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

const LIVE = "This changes the user's live store and customers see it at once — use only when the user asked for this change."

// --------------------------------------------------------------------- tools

export function inventoryMcpTools(deps: FeatureMcpDeps): McpTool[] {
  const client = () => deps.client!
  return [
    {
      name: 'get_my_product_inventory',
      title: 'My product: variants, prices, stock',
      description:
        "The variants of one product in the user's own store: each variant's option values (e.g. Size = M), SKU and offers (price, currency, quantity in stock, enabled), the options with their values, and which options the price / quantity / SKU / processing profile vary by. With variant_id: that variant only; with variant_id and offer_id: that one offer only.",
      inputSchema: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', minimum: 1 },
          variant_id: { type: 'integer', minimum: 1 },
          offer_id: { type: 'integer', minimum: 1, description: 'Needs variant_id.' }
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
            return textResult({ product_id: id, variant_id: variant, offer: neutralOffer(await getOffering(client(), id, variant, offer)) })
          }
          if (variant != null) return textResult({ product_id: id, variant: neutralVariant(await getProduct(client(), id, variant)) })
          return textResult(neutralInventory(await getInventory(client(), id)))
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'get_my_inventory_overview',
      title: 'My products: price ranges and stock',
      description:
        "Price range (lowest–highest enabled offer), total quantity in stock, number of variants and whether it has a single price entry, for products of the user's own store: the given product_ids (up to 100; ids that don't exist or belong to another store are listed in not_in_store), else a page of the store's active products (offset/limit, total = how many active products there are).",
      inputSchema: {
        type: 'object',
        properties: {
          product_ids: IDS('Up to 100 product ids of the user’s store.'),
          offset: { type: 'integer', minimum: 0, default: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 100 }
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
              products: mine.map((l) => neutralRow(overviewRow(l))),
              not_in_store: ids.filter((id) => !mine.some((l) => l.listing_id === id))
            })
          }
          const offset = (args.offset as number | undefined) ?? 0
          const page = await overviewPage(client(), shopId, offset, (args.limit as number | undefined) ?? 100)
          return textResult({ total: page.total, offset, products: page.rows.map(neutralRow) })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'update_my_product_price',
      title: 'Change price / stock of a simple product',
      description: `Sets the price, quantity in stock and/or SKU of a product of the user's own store that has a single variant and offer (no options). For products with variants it fails — use update_my_product_inventory. Returns the new variants. ${LIVE}`,
      inputSchema: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', minimum: 1 },
          price: { type: 'number', description: 'In the store currency, > 0, at most 2 decimals.' },
          quantity: { type: 'integer', minimum: 0, maximum: 999 },
          sku: { type: 'string', maxLength: 255 }
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
          return textResult({ updated: true, ...neutralInventory(await updateSingle(client(), args.product_id as number, change)) })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'update_my_product_inventory',
      title: 'Replace all variants of a product',
      description: `Replaces ALL variants of a product of the user's own store with the given list (every variant must be listed — one left out is deleted): each with its option values, SKU, price, quantity and enabled flag. price_varies_by / quantity_varies_by / sku_varies_by / processing_varies_by list the option ids each of those depends on (default: as now); where a value doesn't vary, it must be the same for the variants concerned. Read get_my_product_inventory first. Returns the new variants. ${LIVE}`,
      inputSchema: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', minimum: 1 },
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
          return textResult({ updated: true, ...neutralInventory(await putInventory(client(), id, write)) })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'get_my_variation_photos',
      title: 'My product: photos of option values',
      description:
        "For a product of the user's own store: its options with their values and the photo linked to each value (photo_id, null = none), and the product's photos (photo_id, position, alt text).",
      inputSchema: {
        type: 'object',
        properties: { product_id: { type: 'integer', minimum: 1 } },
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
              name: neutralText(p.name),
              values: p.values.map((v) => ({
                value_id: v.valueId,
                value: neutralText(v.value),
                photo_id: d.assigned.find((a) => a.propertyId === p.propertyId && a.valueId === v.valueId)?.imageId ?? null
              }))
            })),
            photos: d.photos.map((p) => ({ photo_id: p.imageId, position: p.rank, alt_text: neutralText(p.alt) }))
          })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'set_my_variation_photos',
      title: 'Link photos to option values',
      description: `Links photos of a product of the user's own store to values of ONE of its options (e.g. each Color its photo). Replaces every existing link: values left out lose theirs, an empty list removes them all. Ids from get_my_variation_photos. ${LIVE}`,
      inputSchema: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', minimum: 1 },
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
            links: saved.map((s) => ({ option_id: s.propertyId, value_id: s.valueId, value: neutralText(s.value), photo_id: s.imageId }))
          })
        } catch (e) {
          return fail(e)
        }
      }
    }
  ]
}
