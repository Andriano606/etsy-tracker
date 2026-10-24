// Feature "inventory": the own listings' price, quantity, SKU and variations
// (getListingInventory / updateListingInventory and friends) plus variation
// images. Shared by main (mapping, validation before Etsy) and the renderer
// (the editor's live problems), so both check the same rules.

import { parsePrice } from '../myShop'

/** Etsy `Money` kept exactly: value = amount / divisor. */
export interface InvMoney {
  amount: number
  divisor: number
  currency: string
}

/** One property value of a product (e.g. Size = M). */
export interface InvPropertyValue {
  propertyId: number
  propertyName: string | null
  scaleId: number | null
  scaleName: string | null
  valueIds: number[]
  values: string[]
}

export interface InvOffering {
  offeringId: number | null
  price: InvMoney | null
  quantity: number
  isEnabled: boolean
  readinessStateId: number | null
}

/** One product (variant) of a listing: a combination of property values. */
export interface InvProduct {
  productId: number | null
  sku: string
  propertyValues: InvPropertyValue[]
  offerings: InvOffering[]
}

/** A listing's inventory as read (deleted products/offerings left out). */
export interface ListingInventory {
  listingId: number
  products: InvProduct[]
  /** Properties that change the price / quantity / SKU / processing profile. */
  priceOnProperty: number[]
  quantityOnProperty: number[]
  skuOnProperty: number[]
  readinessStateOnProperty: number[]
}

// --------------------------------------------------------------- write shape

export interface InvWriteValue {
  propertyId: number
  propertyName: string | null
  scaleId: number | null
  valueIds: number[]
  values: string[]
}

export interface InvWriteOffering {
  /** A float (amount / divisor), as updateListingInventory wants it. */
  price: number
  quantity: number
  isEnabled: boolean
  readinessStateId: number | null
}

export interface InvWriteProduct {
  sku: string
  propertyValues: InvWriteValue[]
  offerings: InvWriteOffering[]
}

/** The FULL inventory to send (Etsy replaces every product with these). */
export interface InventoryWrite {
  products: InvWriteProduct[]
  priceOnProperty: number[]
  quantityOnProperty: number[]
  skuOnProperty: number[]
  readinessStateOnProperty: number[]
}

export const INV_MAX_QUANTITY = 999
/** updateListingInventory supports up to 3 variation properties (max_variations_supported=3). */
export const INV_MAX_PROPERTIES = 3

export const moneyValue = (m: InvMoney): number => (m.divisor > 0 ? m.amount / m.divisor : m.amount)

/** The read inventory as a write (Money → float; ids, deleted flags and scale names dropped). */
export function inventoryToWrite(inv: ListingInventory): InventoryWrite {
  return {
    products: inv.products.map((p) => ({
      sku: p.sku,
      propertyValues: p.propertyValues.map((v) => ({
        propertyId: v.propertyId,
        propertyName: v.propertyName,
        scaleId: v.scaleId,
        valueIds: [...v.valueIds],
        values: [...v.values]
      })),
      offerings: p.offerings.map((o) => ({
        price: o.price ? moneyValue(o.price) : NaN,
        quantity: o.quantity,
        isEnabled: o.isEnabled,
        readinessStateId: o.readinessStateId
      }))
    })),
    priceOnProperty: [...inv.priceOnProperty],
    quantityOnProperty: [...inv.quantityOnProperty],
    skuOnProperty: [...inv.skuOnProperty],
    readinessStateOnProperty: [...inv.readinessStateOnProperty]
  }
}

/** A variation property with its values, in first-seen order. */
export interface InvProperty {
  propertyId: number
  name: string
  values: Array<{ valueId: number | null; value: string }>
}

export function inventoryProperties(products: ReadonlyArray<{ propertyValues: InvWriteValue[] }>): InvProperty[] {
  const out: InvProperty[] = []
  for (const p of products) {
    for (const v of p.propertyValues) {
      let prop = out.find((x) => x.propertyId === v.propertyId)
      if (!prop) {
        prop = { propertyId: v.propertyId, name: v.propertyName || `#${v.propertyId}`, values: [] }
        out.push(prop)
      }
      const value = v.values.join(', ')
      const valueId = v.valueIds[0] ?? null
      if (!prop.values.some((x) => x.value === value && x.valueId === valueId)) prop.values.push({ valueId, value })
    }
  }
  return out
}

/** The one product + offering of a listing without variations. */
export interface SingleOffer {
  productId: number | null
  offeringId: number | null
  sku: string
  price: InvMoney | null
  quantity: number
  isEnabled: boolean
}

export interface InventorySummary {
  /** Over enabled offerings (all, when none is enabled). */
  priceMin: InvMoney | null
  priceMax: InvMoney | null
  /** Sum over enabled offerings. */
  totalQuantity: number
  productCount: number
  enabledCount: number
  /** Set when the listing has exactly one product with one offering (quick edit possible). */
  single: SingleOffer | null
}

export function inventorySummary(inv: Pick<ListingInventory, 'products'>): InventorySummary {
  const all = inv.products.flatMap((p) => p.offerings)
  const enabled = all.filter((o) => o.isEnabled)
  const priced = (enabled.length ? enabled : all).map((o) => o.price).filter((m): m is InvMoney => m != null)
  const byValue = [...priced].sort((a, b) => moneyValue(a) - moneyValue(b))
  const only = inv.products.length === 1 && inv.products[0].offerings.length === 1 ? inv.products[0] : null
  return {
    priceMin: byValue[0] ?? null,
    priceMax: byValue[byValue.length - 1] ?? null,
    totalQuantity: enabled.reduce((s, o) => s + o.quantity, 0),
    productCount: inv.products.length,
    enabledCount: inv.products.filter((p) => p.offerings.some((o) => o.isEnabled)).length,
    single: only
      ? {
          productId: only.productId,
          offeringId: only.offerings[0].offeringId,
          sku: only.sku,
          price: only.offerings[0].price,
          quantity: only.offerings[0].quantity,
          isEnabled: only.offerings[0].isEnabled
        }
      : null
  }
}

// ------------------------------------------------------------------ problems

/** A problem in both languages: the app shows `uk`, MCP answers `en`. */
export interface InvProblem {
  uk: string
  en: string
}

const variantName = (p: InvWriteProduct, i: number): { uk: string; en: string } => {
  const vals = p.propertyValues.map((v) => v.values.join(', ')).filter(Boolean)
  return vals.length ? { uk: `Варіант «${vals.join(' / ')}»`, en: `Variant "${vals.join(' / ')}"` } : { uk: `Варіант №${i + 1}`, en: `Variant #${i + 1}` }
}

const cents = (price: number): number => Math.round(price * 100)
const validPrice = (price: number): boolean => Number.isFinite(price) && price > 0 && Math.abs(price * 100 - cents(price)) < 1e-6

/** The values of `ids` in a product, as a comparable key. */
const keyOf = (p: InvWriteProduct, ids: readonly number[]): string =>
  JSON.stringify(
    [...ids].sort((a, b) => a - b).map((id) => p.propertyValues.find((v) => v.propertyId === id)?.values.map((s) => s.trim().toLowerCase()) ?? null)
  )

type OnKey = 'priceOnProperty' | 'quantityOnProperty' | 'skuOnProperty' | 'readinessStateOnProperty'

/** The `*_on_property` lists and the value each one governs. */
const ON_FIELDS: ReadonlyArray<{ key: OnKey; uk: string; en: string; of: (o: InvWriteOffering, p: InvWriteProduct) => unknown }> = [
  { key: 'priceOnProperty', uk: 'Ціна', en: 'price', of: (o) => cents(o.price) },
  { key: 'quantityOnProperty', uk: 'Кількість', en: 'quantity', of: (o) => o.quantity },
  { key: 'skuOnProperty', uk: 'SKU', en: 'SKU', of: (_o, p) => p.sku.trim() },
  { key: 'readinessStateOnProperty', uk: 'Профіль обробки', en: 'processing profile', of: (o) => o.readinessStateId }
]

/** Every problem of a full inventory (Etsy refuses the whole update for any of them). */
export function inventoryProblems(w: InventoryWrite): InvProblem[] {
  const out: InvProblem[] = []
  if (!w.products.length) return [{ uk: 'Потрібен хоча б один варіант.', en: 'At least one variant is required.' }]
  const props = inventoryProperties(w.products)
  if (props.length > INV_MAX_PROPERTIES) {
    out.push({ uk: `Властивостей варіацій може бути не більше ${INV_MAX_PROPERTIES}.`, en: `At most ${INV_MAX_PROPERTIES} options are allowed.` })
  }
  const propIds = props.map((p) => p.propertyId).sort((a, b) => a - b).join(',')
  const seen = new Set<string>()
  w.products.forEach((p, i) => {
    const name = variantName(p, i)
    const own = [...new Set(p.propertyValues.map((v) => v.propertyId))].sort((a, b) => a - b).join(',')
    if (own !== propIds || p.propertyValues.length !== props.length) {
      out.push({ uk: `${name.uk}: у всіх варіантів мають бути ті самі властивості.`, en: `${name.en}: every variant needs the same options.` })
    }
    for (const v of p.propertyValues) {
      if (!v.values.length || v.values.some((s) => !s.trim())) {
        out.push({ uk: `${name.uk}: порожнє значення властивості.`, en: `${name.en}: an option value is empty.` })
      }
      const bad = v.values.find((s) => /[()]/.test(s))
      if (bad) {
        out.push({ uk: `Значення «${bad}» містить дужки — їх не можна використовувати.`, en: `The value "${bad}" contains parentheses, which are not allowed.` })
      }
    }
    if (!p.offerings.length) out.push({ uk: `${name.uk}: немає ціни й кількості.`, en: `${name.en}: no price and quantity.` })
    for (const o of p.offerings) {
      if (!validPrice(o.price)) {
        out.push({ uk: `${name.uk}: ціна — додатне число, не більше 2 знаків після коми.`, en: `${name.en}: the price must be a positive number with at most 2 decimals.` })
      }
      if (!Number.isSafeInteger(o.quantity) || o.quantity < 0 || o.quantity > INV_MAX_QUANTITY) {
        out.push({ uk: `${name.uk}: кількість — ціле число від 0 до ${INV_MAX_QUANTITY}.`, en: `${name.en}: the quantity must be a whole number from 0 to ${INV_MAX_QUANTITY}.` })
      }
    }
    const combo = keyOf(p, props.map((x) => x.propertyId))
    if (seen.has(combo)) out.push({ uk: `${name.uk} повторюється.`, en: `${name.en} appears twice.` })
    else seen.add(combo)
  })
  for (const f of ON_FIELDS) {
    const on = w[f.key]
    const unknown = on.filter((id) => !props.some((p) => p.propertyId === id))
    if (unknown.length) {
      out.push({
        uk: `${f.uk} залежить від властивості #${unknown.join(', #')}, якої немає у варіантах.`,
        en: `The ${f.en} depends on option ${unknown.join(', ')}, which no variant has.`
      })
      continue
    }
    const groups = new Map<string, Set<string>>()
    for (const p of w.products) {
      const k = keyOf(p, on)
      const vals = groups.get(k) ?? new Set<string>()
      for (const o of p.offerings) vals.add(JSON.stringify(f.of(o, p)))
      groups.set(k, vals)
    }
    if ([...groups.values()].some((v) => v.size > 1)) {
      const names = props.filter((p) => on.includes(p.propertyId)).map((p) => p.name)
      out.push(
        names.length
          ? {
              uk: `${f.uk}: значення мають збігатися у варіантах з тим самим «${names.join(' / ')}» (або позначте, що це залежить і від інших властивостей).`,
              en: `The ${f.en} must be the same for variants with the same ${names.join(' / ')}, or make it depend on more options.`
            }
          : {
              uk: `${f.uk}: значення мають збігатися в усіх варіантах (або позначте, від якої властивості це залежить).`,
              en: `The ${f.en} must be the same for every variant, or make it depend on an option.`
            }
      )
    }
  }
  return out
}

// --------------------------------------------------------- the app's editor

/** One editable table row (a product's first offering), as typed. */
export interface InvRowEdit {
  sku: string
  price: string
  quantity: string
  enabled: boolean
}

export interface InvOnProperty {
  price: number[]
  quantity: number[]
  sku: number[]
}

const priceText = (m: InvMoney | null): string => (m ? String(moneyValue(m)) : '')

export function rowsFromInventory(inv: ListingInventory): InvRowEdit[] {
  return inv.products.map((p) => ({
    sku: p.sku,
    price: priceText(p.offerings[0]?.price ?? null),
    quantity: String(p.offerings[0]?.quantity ?? 0),
    enabled: p.offerings[0]?.isEnabled ?? true
  }))
}

/** "12" → 12; anything but a plain whole number → NaN (inventoryProblems names it). */
export const parseQuantity = (raw: string): number => (/^\s*\d+\s*$/.test(raw) ? Number(raw) : NaN)

/** The full inventory with the table's edits (the first offering of each product) and the "depends on" choices. */
export function writeFromRows(inv: ListingInventory, rows: InvRowEdit[], on: InvOnProperty): InventoryWrite {
  const w = inventoryToWrite(inv)
  w.products.forEach((p, i) => {
    const r = rows[i]
    if (!r) return
    p.sku = r.sku.trim()
    const o = p.offerings[0]
    if (!o) return
    o.price = parsePrice(r.price) ?? NaN
    o.quantity = parseQuantity(r.quantity)
    o.isEnabled = r.enabled
  })
  w.priceOnProperty = [...on.price]
  w.quantityOnProperty = [...on.quantity]
  w.skuOnProperty = [...on.sku]
  return w
}

// --------------------------------------------------------- variation images

export interface VariationImage {
  propertyId: number
  valueId: number
  value: string | null
  imageId: number
}

/** A photo of the listing (a CDN thumbnail, validated). */
export interface ListingPhoto {
  imageId: number
  url: string | null
  rank: number | null
  alt: string | null
}

export interface VariationImagesData {
  listingId: number
  /** The variation properties and their values (from the inventory). */
  properties: InvProperty[]
  photos: ListingPhoto[]
  assigned: VariationImage[]
}

export interface VariationImageInput {
  propertyId: number
  valueId: number
  imageId: number
}

/** updateVariationImages: no duplicates, a single property (the call replaces every variation image). */
export function variationImageProblems(items: VariationImageInput[]): InvProblem[] {
  const out: InvProblem[] = []
  const pos = (n: unknown): boolean => Number.isSafeInteger(n) && (n as number) > 0
  if (items.some((x) => !pos(x.propertyId) || !pos(x.valueId) || !pos(x.imageId))) {
    out.push({ uk: 'Некоректні ідентифікатори фото варіацій.', en: 'Every option id, value id and photo id must be a positive whole number.' })
  }
  if (new Set(items.map((x) => x.propertyId)).size > 1) {
    out.push({ uk: 'Фото можна прив’язати лише до однієї властивості варіацій.', en: 'Photos can be linked to values of one option only.' })
  }
  const keys = items.map((x) => `${x.propertyId}:${x.valueId}`)
  if (new Set(keys).size !== keys.length) {
    out.push({ uk: 'Одне значення має лише одне фото.', en: 'Each option value can have only one photo.' })
  }
  return out
}

// ------------------------------------------------------------------ overview

export interface InventoryOverviewRow extends InventorySummary {
  listingId: number
  title: string
  state: string
  imageUrl: string | null
  /** false = Etsy returned no inventory record: price/quantity are the listing's own. */
  hasInventory: boolean
}

export interface InventoryOverviewPage {
  total: number
  offset: number
  rows: InventoryOverviewRow[]
}

/** The MCP tools of this feature, in Ukrainian for the MCP modal. */
export const INVENTORY_TOOL_SUMMARY: ReadonlyArray<{ name: string; text: string; write?: boolean }> = [
  { name: 'get_my_product_inventory', text: 'варіанти мого товару: властивості, артикули, ціни, кількість, що продається' },
  { name: 'get_my_inventory_overview', text: 'ціни й залишки моїх товарів: діапазон цін, загальна кількість' },
  { name: 'update_my_product_price', text: 'змінити ціну / кількість / артикул товару без варіантів', write: true },
  { name: 'update_my_product_inventory', text: 'замінити всі варіанти товару (ціни, кількість, артикули, властивості)', write: true },
  { name: 'get_my_variation_photos', text: 'які фото прив’язані до значень варіацій' },
  { name: 'set_my_variation_photos', text: 'прив’язати фото до значень варіацій', write: true }
]
