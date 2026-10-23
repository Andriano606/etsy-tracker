// Inventory feature, the Etsy side: OAS shapes, mapping into the shared types,
// the write body, and every call (paths, scopes and encodings from the OAS).

import {
  inventoryProblems,
  inventoryToWrite,
  inventoryProperties,
  inventorySummary,
  variationImageProblems,
  type InvMoney,
  type InvOffering,
  type InvProblem,
  type InvProduct,
  type InvPropertyValue,
  type InventoryOverviewPage,
  type InventoryOverviewRow,
  type InventoryWrite,
  type InvWriteProduct,
  type InvWriteValue,
  type ListingInventory,
  type ListingPhoto,
  type VariationImage,
  type VariationImageInput,
  type VariationImagesData
} from '../../../shared/features/inventory'
import { isEtsyCdnUrl } from '../../../shared/externalUrl'
import { decodeHtmlEntities } from '../../../shared/html'
import { BATCH_LIMIT, EtsyApiError, PAGE_LIMIT, type EtsyClient, type EtsyListingImage, type EtsyListingWithAssociations, type EtsyMoney, type Paged } from '../../etsyApi'
import { FeatureError } from '../common'

// ------------------------------------------------------------- OAS shapes

/** OAS ListingInventoryProductOffering. */
export interface EtsyInvOffering {
  offering_id?: number
  quantity?: number
  is_enabled?: boolean
  is_deleted?: boolean
  price?: EtsyMoney | null
  readiness_state_id?: number | null
}

/** OAS ListingPropertyValue. */
export interface EtsyInvPropertyValue {
  property_id: number
  property_name?: string | null
  scale_id?: number | null
  scale_name?: string | null
  value_ids?: number[]
  values?: string[]
}

/** OAS ListingInventoryProduct. */
export interface EtsyInvProduct {
  product_id?: number
  sku?: string | null
  is_deleted?: boolean
  offerings?: EtsyInvOffering[]
  property_values?: EtsyInvPropertyValue[]
}

/** OAS ListingInventory (+ WithAssociations). */
export interface EtsyInventory {
  products?: EtsyInvProduct[]
  price_on_property?: number[]
  quantity_on_property?: number[]
  sku_on_property?: number[]
  readiness_state_on_property?: number[] | null
}

/** OAS ListingVariationImage. */
export interface EtsyVariationImage {
  property_id: number
  value_id: number
  value?: string | null
  image_id: number
}

export type EtsyListingWithInventory = EtsyListingWithAssociations & { inventory?: EtsyInventory | null }

export const READ_SCOPES = ['listings_r'] as const
export const WRITE_SCOPES = ['listings_w'] as const

/** A refusal in both languages: IPC shows the Ukrainian message, MCP answers `en`. */
export class InvError extends FeatureError {
  constructor(
    uk: string,
    public en: string
  ) {
    super(uk)
  }
}

const unexpected = (): InvError => new InvError('Etsy повернув неочікувану відповідь.', 'The store service returned an unexpected answer.')

export const problemsError = (ps: InvProblem[]): InvError =>
  new InvError(ps.map((p) => p.uk).join(' '), ps.map((p) => p.en).join(' '))

// ------------------------------------------------------------------ mapping

const txt = (v: unknown): string => (v == null ? '' : decodeHtmlEntities(String(v)))
const ints = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => Number.isSafeInteger(n)) : [])

export function mapMoney(m: EtsyMoney | null | undefined): InvMoney | null {
  if (!m || typeof m.amount !== 'number' || typeof m.divisor !== 'number') return null
  return { amount: m.amount, divisor: m.divisor, currency: String(m.currency_code ?? '') }
}

export function mapOffering(o: EtsyInvOffering): InvOffering {
  return {
    offeringId: o.offering_id ?? null,
    price: mapMoney(o.price),
    quantity: typeof o.quantity === 'number' ? o.quantity : 0,
    isEnabled: o.is_enabled !== false,
    readinessStateId: o.readiness_state_id ?? null
  }
}

function mapPropertyValue(v: EtsyInvPropertyValue): InvPropertyValue {
  return {
    propertyId: v.property_id,
    propertyName: v.property_name ? txt(v.property_name) : null,
    scaleId: v.scale_id ?? null,
    scaleName: v.scale_name ? txt(v.scale_name) : null,
    valueIds: ints(v.value_ids),
    values: Array.isArray(v.values) ? v.values.map(txt) : []
  }
}

export function mapProduct(p: EtsyInvProduct): InvProduct {
  return {
    productId: p.product_id ?? null,
    sku: txt(p.sku),
    propertyValues: (p.property_values ?? []).map(mapPropertyValue),
    offerings: (p.offerings ?? []).filter((o) => !o.is_deleted).map(mapOffering)
  }
}

export function mapInventory(raw: EtsyInventory | null | undefined, listingId: number): ListingInventory {
  if (!raw || typeof raw !== 'object') throw unexpected()
  return {
    listingId,
    products: (raw.products ?? []).filter((p) => !p.is_deleted).map(mapProduct),
    priceOnProperty: ints(raw.price_on_property),
    quantityOnProperty: ints(raw.quantity_on_property),
    skuOnProperty: ints(raw.sku_on_property),
    readinessStateOnProperty: ints(raw.readiness_state_on_property)
  }
}

function mapPhoto(i: EtsyListingImage): ListingPhoto {
  const url = i.url_170x135 ?? i.url_75x75 ?? null
  return {
    imageId: i.listing_image_id,
    url: url && isEtsyCdnUrl(url) ? url : null,
    rank: typeof i.rank === 'number' ? i.rank : null,
    alt: i.alt_text ? txt(i.alt_text) : null
  }
}

const mapVariationImage = (v: EtsyVariationImage): VariationImage => ({
  propertyId: v.property_id,
  valueId: v.value_id,
  value: v.value ? txt(v.value) : null,
  imageId: v.image_id
})

// --------------------------------------------------------------- write body

/** updateListingInventory's JSON body (OAS names; every product, price as a float). */
export function writeBody(w: InventoryWrite) {
  return {
    products: w.products.map((p) => ({
      sku: p.sku,
      property_values: p.propertyValues.map((v) => ({
        property_id: v.propertyId,
        value_ids: v.valueIds,
        values: v.values,
        ...(v.propertyName ? { property_name: v.propertyName } : {}),
        ...(v.scaleId != null ? { scale_id: v.scaleId } : {})
      })),
      offerings: p.offerings.map((o) => ({
        price: o.price,
        quantity: o.quantity,
        is_enabled: o.isEnabled,
        readiness_state_id: o.readinessStateId
      }))
    })),
    price_on_property: w.priceOnProperty,
    quantity_on_property: w.quantityOnProperty,
    sku_on_property: w.skuOnProperty,
    readiness_state_on_property: w.readinessStateOnProperty
  }
}

// ---------------------------------------------------- parsing IPC arguments

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const bad = (): FeatureError => new FeatureError('Некоректні дані інвентарю.')
const posInt = (v: unknown): number => {
  if (!Number.isSafeInteger(v) || (v as number) <= 0) throw bad()
  return v as number
}
const idList = (v: unknown): number[] => {
  if (!Array.isArray(v)) throw bad()
  return v.map(posInt)
}
const optId = (v: unknown): number | null => (v == null ? null : posInt(v))

function parseValue(v: unknown): InvWriteValue {
  if (!isObj(v) || !Array.isArray(v.values) || !v.values.every((s) => typeof s === 'string')) throw bad()
  return {
    propertyId: posInt(v.propertyId),
    propertyName: typeof v.propertyName === 'string' && v.propertyName ? v.propertyName : null,
    scaleId: optId(v.scaleId),
    valueIds: idList(v.valueIds ?? []),
    values: v.values as string[]
  }
}

function parseProduct(p: unknown): InvWriteProduct {
  if (!isObj(p) || !Array.isArray(p.propertyValues) || !Array.isArray(p.offerings)) throw bad()
  if (p.sku != null && typeof p.sku !== 'string') throw bad()
  return {
    sku: typeof p.sku === 'string' ? p.sku.trim() : '',
    propertyValues: p.propertyValues.map(parseValue),
    offerings: p.offerings.map((o) => {
      if (!isObj(o) || typeof o.price !== 'number' || typeof o.quantity !== 'number' || typeof o.isEnabled !== 'boolean') throw bad()
      return { price: o.price, quantity: o.quantity, isEnabled: o.isEnabled, readinessStateId: optId(o.readinessStateId) }
    })
  }
}

/** A full inventory from the renderer: shape checked strictly, rules by inventoryProblems. */
export function parseWrite(raw: unknown): InventoryWrite {
  if (!isObj(raw) || !Array.isArray(raw.products)) throw bad()
  return {
    products: raw.products.map(parseProduct),
    priceOnProperty: idList(raw.priceOnProperty ?? []),
    quantityOnProperty: idList(raw.quantityOnProperty ?? []),
    skuOnProperty: idList(raw.skuOnProperty ?? []),
    readinessStateOnProperty: idList(raw.readinessStateOnProperty ?? [])
  }
}

export function parseVariationItems(raw: unknown): VariationImageInput[] {
  if (!Array.isArray(raw)) throw bad()
  return raw.map((x) => {
    if (!isObj(x)) throw bad()
    return { propertyId: posInt(x.propertyId), valueId: posInt(x.valueId), imageId: posInt(x.imageId) }
  })
}

// -------------------------------------------------------------------- calls

const inventoryPath = (listingId: number): string => `/v3/application/listings/${listingId}/inventory`
const variationPath = (shopId: number, listingId: number): string =>
  `/v3/application/shops/${shopId}/listings/${listingId}/variation-images`

/** getListingInventory (OAuth listings_r). */
export async function getInventory(client: EtsyClient, listingId: number): Promise<ListingInventory> {
  return mapInventory(await client.call<EtsyInventory>(inventoryPath(listingId), { oauth: true }), listingId)
}

/** updateListingInventory (OAuth listings_w, JSON): the FULL inventory, checked first. */
export async function putInventory(client: EtsyClient, listingId: number, w: InventoryWrite): Promise<ListingInventory> {
  const problems = inventoryProblems(w)
  if (problems.length) throw problemsError(problems)
  const props = inventoryProperties(w.products).length
  const raw = await client.call<EtsyInventory>(inventoryPath(listingId), {
    method: 'PUT',
    oauth: true,
    query: { max_variations_supported: props > 2 ? '3' : undefined },
    json: writeBody(w)
  })
  return mapInventory(raw, listingId)
}

/** getListingProduct (OAuth listings_r). */
export async function getProduct(client: EtsyClient, listingId: number, productId: number): Promise<InvProduct> {
  const raw = await client.call<EtsyInvProduct>(`${inventoryPath(listingId)}/products/${productId}`, { oauth: true })
  if (!isObj(raw)) throw unexpected()
  return mapProduct(raw)
}

/** getListingOffering (API key only). */
export async function getOffering(client: EtsyClient, listingId: number, productId: number, offeringId: number): Promise<InvOffering> {
  const raw = await client.call<EtsyInvOffering>(
    `/v3/application/listings/${listingId}/products/${productId}/offerings/${offeringId}`
  )
  if (!isObj(raw)) throw unexpected()
  return mapOffering(raw)
}

/** getListingsInventoryByListingIds (OAuth listings_r), ≤ 100 ids per request. */
export async function inventoriesByIds(client: EtsyClient, ids: number[]): Promise<EtsyListingWithInventory[]> {
  const out: EtsyListingWithInventory[] = []
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const page = await client.call<Paged<EtsyListingWithInventory>>('/v3/application/listings/batch/inventory', {
      oauth: true,
      query: { listing_ids: ids.slice(i, i + BATCH_LIMIT) }
    })
    out.push(...(Array.isArray(page?.results) ? page.results : []))
  }
  return out
}

const isNotFound = (e: unknown): boolean => e instanceof EtsyApiError && e.status === 404

/**
 * Like inventoriesByIds, but an unknown id doesn't fail the rest: the OAS answers a whole batch
 * with 404 when any id is missing, so a 404 chunk is bisected down to single ids and those left out.
 */
export async function inventoriesByIdsLenient(client: EtsyClient, ids: number[]): Promise<EtsyListingWithInventory[]> {
  try {
    return await inventoriesByIds(client, ids)
  } catch (e) {
    if (!isNotFound(e)) throw e
    if (ids.length === 1) return []
    const half = Math.ceil(ids.length / 2)
    return [...(await inventoriesByIdsLenient(client, ids.slice(0, half))), ...(await inventoriesByIdsLenient(client, ids.slice(half)))]
  }
}

/** One row of "Ціни й залишки": from the inventory, else the listing's own price/quantity. */
export function overviewRow(l: EtsyListingWithInventory): InventoryOverviewRow {
  const imgs = Array.isArray(l.images) ? [...l.images].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)) : []
  const thumb = imgs[0]?.url_170x135 ?? null
  const base = { listingId: l.listing_id, title: txt(l.title), state: String(l.state ?? ''), imageUrl: thumb && isEtsyCdnUrl(thumb) ? thumb : null }
  if (l.inventory && Array.isArray(l.inventory.products)) {
    return { ...base, ...inventorySummary(mapInventory(l.inventory, l.listing_id)), hasInventory: true }
  }
  const price = mapMoney(l.price)
  return {
    ...base,
    priceMin: price,
    priceMax: price,
    totalQuantity: typeof l.quantity === 'number' ? l.quantity : 0,
    productCount: 0,
    enabledCount: 0,
    single: null,
    hasInventory: false
  }
}

/** A page of the shop's active listings with their inventories (2 requests per 100). */
export async function overviewPage(client: EtsyClient, shopId: number, offset: number, limit = PAGE_LIMIT): Promise<InventoryOverviewPage> {
  const page = await client.getShopListingsByState(shopId, 'active', offset, limit)
  const withInv = new Map((await inventoriesByIds(client, page.results.map((l) => l.listing_id))).map((l) => [l.listing_id, l]))
  return {
    total: page.count,
    offset,
    rows: page.results.map((l) => overviewRow({ ...l, inventory: withInv.get(l.listing_id)?.inventory ?? null }))
  }
}

export interface SingleChange {
  price?: number
  quantity?: number
  sku?: string
}

/** Price / quantity / SKU of a listing without variations: read, change, write back the full inventory. */
export async function updateSingle(client: EtsyClient, listingId: number, change: SingleChange): Promise<ListingInventory> {
  const inv = await getInventory(client, listingId)
  if (!inv.products.length) {
    throw new InvError(
      'Etsy не має запису інвентарю для цього лістингу (його ще не редагували інструментами інвентарю Etsy) — змініть ціну й кількість на Etsy.com.',
      'This product has no variant data yet; use update_my_product_inventory with one variant without options to set its price and quantity.'
    )
  }
  if (!inventorySummary(inv).single) {
    throw new InvError(
      'У цього лістингу кілька варіантів — змініть ціни в розділі «Ціна, кількість і варіації» (Мій магазин → Лістинги → Редагувати).',
      'This product has several variants; use update_my_product_inventory with the full list of variants instead.'
    )
  }
  const w = inventoryToWrite(inv)
  const p = w.products[0]
  const o = p.offerings[0]
  if (change.sku !== undefined) p.sku = change.sku.trim()
  if (change.price !== undefined) o.price = change.price
  if (change.quantity !== undefined) o.quantity = change.quantity
  return putInventory(client, listingId, w)
}

/** getListingImages (API key only), by rank. */
export async function listingPhotos(client: EtsyClient, listingId: number): Promise<ListingPhoto[]> {
  const page = await client.call<Paged<EtsyListingImage>>(`/v3/application/listings/${listingId}/images`)
  const all = Array.isArray(page?.results) ? page.results : []
  return all.map(mapPhoto).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
}

/** getListingVariationImages (API key only). */
export async function getVariationImages(client: EtsyClient, shopId: number, listingId: number): Promise<VariationImage[]> {
  const page = await client.call<Paged<EtsyVariationImage>>(variationPath(shopId, listingId))
  return (Array.isArray(page?.results) ? page.results : []).map(mapVariationImage)
}

/** Everything the "Фото варіацій" section needs: properties, photos, what is linked now. */
export async function variationImagesData(client: EtsyClient, shopId: number, listingId: number): Promise<VariationImagesData> {
  const inv = await getInventory(client, listingId)
  const photos = await listingPhotos(client, listingId)
  const assigned = await getVariationImages(client, shopId, listingId)
  return { listingId, properties: inventoryProperties(inv.products), photos, assigned }
}

/** updateVariationImages (OAuth listings_w, JSON): replaces every variation image of the listing. */
export async function setVariationImages(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  items: VariationImageInput[]
): Promise<VariationImage[]> {
  const problems = variationImageProblems(items)
  if (problems.length) throw problemsError(problems)
  const page = await client.call<Paged<EtsyVariationImage>>(variationPath(shopId, listingId), {
    method: 'POST',
    oauth: true,
    json: { variation_images: items.map((x) => ({ property_id: x.propertyId, value_id: x.valueId, image_id: x.imageId })) }
  })
  return (Array.isArray(page?.results) ? page.results : []).map(mapVariationImage)
}

