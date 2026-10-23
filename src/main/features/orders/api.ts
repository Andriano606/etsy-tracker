// The Etsy calls of the "orders" feature (OAuth: transactions_r to read,
// transactions_w to update a receipt or submit tracking) and the argument
// checks they share between IPC actions and MCP tools. Paths, parameters and
// body encodings follow the OAS exactly (see each function).

import type { MyListing } from '../../../shared/types'
import {
  ETSY_EPOCH_MIN,
  ORDERS_MAX_LIMIT,
  ORDERS_MAX_PAGES,
  ORDER_SORT_ON,
  ORDER_SORT_ORDER,
  addByCurrency,
  type LedgerEntry,
  type LedgerPage,
  type ListingSales,
  type Order,
  type OrderFilters,
  type OrderItem,
  type OrderMoney,
  type OrderPayment,
  type OrdersPage,
  type OrderUpdate,
  type SalesPage,
  type SalesRow,
  type SalesSummary,
  type ShipmentInput
} from '../../../shared/features/orders'
import { EtsyApiError, type EtsyClient, type EtsyListing, type Params } from '../../etsyApi'
import { toMyListing } from '../../myShop'
import { FeatureError } from '../common'
import { ledgerTotals, toItem, toLedgerEntry, toOrder, toPayment } from './map'

export const READ = ['transactions_r'] as const
export const WRITE = ['transactions_w'] as const

/** Limits of what we send (the OAS sets none for these strings). */
export const CARRIER_MAX = 255
export const TRACKING_MAX = 255
export const NOTE_MAX = 2000

type Obj = Record<string, unknown>
interface Page {
  count?: number
  results?: unknown[]
}

const shopPath = (shopId: number): string => `/v3/application/shops/${shopId}`
const results = (p: Page | undefined): Obj[] =>
  Array.isArray(p?.results) ? (p!.results as unknown[]).map((x) => (x && typeof x === 'object' ? (x as Obj) : {})) : []

// ---------------------------------------------------------------- arguments

/** An optional boolean filter: true/false, absent/null = not filtered. */
export function optBool(args: Obj, name: string): boolean | undefined {
  const v = args[name]
  if (v == null) return undefined
  if (typeof v !== 'boolean') throw new FeatureError(`Поле ${name} має бути так/ні.`)
  return v
}

/** An optional unix time (seconds) ≥ the OAS minimum 946684800. */
export function optSec(args: Obj, name: string): number | undefined {
  const v = args[name]
  if (v == null) return undefined
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < ETSY_EPOCH_MIN) {
    throw new FeatureError(`Некоректна дата ${name} (не раніше 2000 року).`)
  }
  return v
}

function optInt(args: Obj, name: string, min: number, max: number): number | undefined {
  const v = args[name]
  if (v == null) return undefined
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) {
    throw new FeatureError(`Поле ${name} має бути цілим числом від ${min} до ${max}.`)
  }
  return v
}

function optEnum<T extends string>(args: Obj, name: string, values: readonly T[]): T | undefined {
  const v = args[name]
  if (v == null) return undefined
  if (!values.includes(v as T)) throw new FeatureError(`Поле ${name}: одне з ${values.join(', ')}.`)
  return v as T
}

function range(lo: number | undefined, hi: number | undefined, what = ''): void {
  if (lo != null && hi != null && lo > hi) throw new FeatureError(`Початок періоду${what && ` ${what}`} пізніше за кінець.`)
}

/** Checked getShopReceipts filters (IPC args use the OrderFilters names). */
export function parseOrderFilters(args: Obj): OrderFilters {
  const f: OrderFilters = {
    minCreated: optSec(args, 'minCreated'),
    maxCreated: optSec(args, 'maxCreated'),
    minLastModified: optSec(args, 'minLastModified'),
    maxLastModified: optSec(args, 'maxLastModified'),
    wasPaid: optBool(args, 'wasPaid'),
    wasShipped: optBool(args, 'wasShipped'),
    wasDelivered: optBool(args, 'wasDelivered'),
    wasCanceled: optBool(args, 'wasCanceled'),
    sortOn: optEnum(args, 'sortOn', ORDER_SORT_ON),
    sortOrder: optEnum(args, 'sortOrder', ORDER_SORT_ORDER),
    limit: optInt(args, 'limit', 1, ORDERS_MAX_LIMIT),
    offset: optInt(args, 'offset', 0, 1_000_000)
  }
  range(f.minCreated ?? undefined, f.maxCreated ?? undefined, 'створення')
  range(f.minLastModified ?? undefined, f.maxLastModified ?? undefined, 'змін')
  return f
}

const opt = <T>(v: T | null | undefined): T | undefined => (v == null ? undefined : v)

/** OrderFilters → the OAS query of getShopReceipts. */
export function receiptsQuery(f: OrderFilters): Params {
  return {
    min_created: opt(f.minCreated),
    max_created: opt(f.maxCreated),
    min_last_modified: opt(f.minLastModified),
    max_last_modified: opt(f.maxLastModified),
    was_paid: opt(f.wasPaid),
    was_shipped: opt(f.wasShipped),
    was_delivered: opt(f.wasDelivered),
    was_canceled: opt(f.wasCanceled),
    sort_on: f.sortOn,
    sort_order: f.sortOrder,
    limit: f.limit ?? 25,
    offset: f.offset ?? 0
  }
}

/** A checked updateShopReceipt patch: at least one flag. */
export function parseOrderUpdate(args: Obj): OrderUpdate {
  const u: OrderUpdate = {}
  const shipped = optBool(args, 'wasShipped')
  const paid = optBool(args, 'wasPaid')
  if (shipped !== undefined) u.wasShipped = shipped
  if (paid !== undefined) u.wasPaid = paid
  if (!Object.keys(u).length) throw new FeatureError('Нічого не змінено.')
  return u
}

function optText(args: Obj, name: string, max: number): string | undefined {
  const v = args[name]
  if (v == null) return undefined
  if (typeof v !== 'string') throw new FeatureError(`Поле ${name} має бути текстом.`)
  const t = v.trim()
  if (t.length > max) throw new FeatureError(`Поле ${name} довше за ${max} символів.`)
  return t || undefined
}

/** A checked createReceiptShipment input: carrier and tracking code together, or neither. */
export function parseShipment(args: Obj): ShipmentInput {
  const s: ShipmentInput = {
    carrier: optText(args, 'carrier', CARRIER_MAX),
    trackingCode: optText(args, 'trackingCode', TRACKING_MAX),
    noteToBuyer: optText(args, 'noteToBuyer', NOTE_MAX),
    sendBcc: optBool(args, 'sendBcc')
  }
  if (!s.carrier !== !s.trackingCode) {
    throw new FeatureError('Вкажіть і перевізника, і трек-номер (або жодного — тоді замовлення лише позначиться відправленим).')
  }
  return s
}

/** A period {minCreated, maxCreated} (unix s, lo ≤ hi); `required` = both bounds needed (the ledger). */
export function periodArgs(args: Obj, required: true): { minCreated: number; maxCreated: number }
export function periodArgs(args: Obj, required?: false): { minCreated: number | null; maxCreated: number | null }
export function periodArgs(args: Obj, required = false): { minCreated: number | null; maxCreated: number | null } {
  const minCreated = optSec(args, 'minCreated') ?? null
  const maxCreated = optSec(args, 'maxCreated') ?? null
  if (required && (minCreated == null || maxCreated == null)) throw new FeatureError('Вкажіть період (від і до).')
  range(minCreated ?? undefined, maxCreated ?? undefined)
  return { minCreated, maxCreated }
}

// -------------------------------------------------------------------- calls

/** Read every page (limit 100) of an offset-paged endpoint, at most `maxPages`. */
async function pageAll(
  client: EtsyClient,
  path: string,
  query: Params,
  maxPages = ORDERS_MAX_PAGES
): Promise<{ rows: Obj[]; count: number; truncated: boolean }> {
  const rows: Obj[] = []
  let count = 0
  for (let page = 0; page < maxPages; page++) {
    const p = await client.call<Page>(path, { oauth: true, query: { ...query, limit: ORDERS_MAX_LIMIT, offset: page * ORDERS_MAX_LIMIT } })
    const got = results(p)
    count = typeof p?.count === 'number' ? p.count : rows.length + got.length
    rows.push(...got)
    if (!got.length || rows.length >= count) return { rows, count, truncated: false }
  }
  return { rows, count, truncated: rows.length < count }
}

/** getShopReceipts: GET /shops/{shop_id}/receipts. */
export async function listOrders(client: EtsyClient, shopId: number, f: OrderFilters): Promise<OrdersPage> {
  const p = await client.call<Page>(`${shopPath(shopId)}/receipts`, { oauth: true, query: receiptsQuery(f) })
  const orders = results(p).map((r) => toOrder(r))
  return { total: typeof p?.count === 'number' ? p.count : orders.length, offset: f.offset ?? 0, orders }
}

/** A receipt lists its transactions (every receipt has at least one, so an empty list = not included). */
const hasItems = (r: Obj): boolean => Array.isArray(r.transactions) && r.transactions.length > 0

/** A receipt → Order; its items come from getShopReceiptTransactionsByReceipt when the receipt lists none. */
async function withItems(client: EtsyClient, shopId: number, receiptId: number, r: Obj): Promise<Order> {
  return hasItems(r) ? toOrder(r) : toOrder(r, await orderItems(client, shopId, receiptId))
}

/** getShopReceipt (+ its transactions when the receipt has none listed). */
export async function getOrder(client: EtsyClient, shopId: number, receiptId: number): Promise<Order> {
  const r = await client.call<Obj>(`${shopPath(shopId)}/receipts/${receiptId}`, { oauth: true })
  return withItems(client, shopId, receiptId, r ?? {})
}

/** The order after a write: the answered receipt (+ items when it lists none), or a fresh read when the answer isn't one. */
function afterWrite(client: EtsyClient, shopId: number, receiptId: number, r: Obj | undefined): Promise<Order> {
  return r && typeof r.receipt_id === 'number' ? withItems(client, shopId, receiptId, r) : getOrder(client, shopId, receiptId)
}

/** getShopReceiptTransactionsByReceipt: GET /shops/{shop_id}/receipts/{receipt_id}/transactions. */
export async function orderItems(client: EtsyClient, shopId: number, receiptId: number): Promise<OrderItem[]> {
  const p = await client.call<Page>(`${shopPath(shopId)}/receipts/${receiptId}/transactions`, { oauth: true })
  return results(p).map(toItem)
}

/** updateShopReceipt: PUT /shops/{shop_id}/receipts/{receipt_id}, form was_shipped / was_paid. */
export async function updateOrder(client: EtsyClient, shopId: number, receiptId: number, u: OrderUpdate): Promise<Order> {
  const r = await client.call<Obj>(`${shopPath(shopId)}/receipts/${receiptId}`, {
    method: 'PUT',
    oauth: true,
    form: { was_shipped: u.wasShipped, was_paid: u.wasPaid }
  })
  return afterWrite(client, shopId, receiptId, r)
}

/**
 * createReceiptShipment: POST /shops/{shop_id}/receipts/{receipt_id}/tracking,
 * JSON body tracking_code / carrier_name / send_bcc / note_to_buyer. Etsy then
 * emails the buyer. (OAS: 409 = Etsy refused the shipment — see isConflict.)
 */
export async function shipOrder(client: EtsyClient, shopId: number, receiptId: number, s: ShipmentInput): Promise<Order> {
  const json: Obj = {}
  if (s.trackingCode) json.tracking_code = s.trackingCode
  if (s.carrier) json.carrier_name = s.carrier
  if (s.sendBcc !== undefined) json.send_bcc = s.sendBcc
  if (s.noteToBuyer) json.note_to_buyer = s.noteToBuyer
  const r = await client.call<Obj>(`${shopPath(shopId)}/receipts/${receiptId}/tracking`, { method: 'POST', oauth: true, json })
  return afterWrite(client, shopId, receiptId, r)
}

/** Etsy's 409 answer to createReceiptShipment. */
export const isConflict = (e: unknown): e is EtsyApiError => e instanceof EtsyApiError && e.status === 409

/**
 * Etsy's 403 answer to createReceiptShipment: the OAS says that where the
 * Preferred Partner Program is enforced only approved fulfillment-partner apps
 * may call it — even with transactions_w (our scope check runs before the call).
 */
export const isPartnerOnly = (e: unknown): e is EtsyApiError => e instanceof EtsyApiError && e.status === 403

/** The Ukrainian refusal of createReceiptShipment (409 / 403), or the error unchanged. */
export function shipmentError(e: unknown): unknown {
  if (isConflict(e)) return new FeatureError(`Etsy відхилив відправлення (HTTP 409)${e.detail ? `: ${e.detail}` : ''}.`)
  if (isPartnerOnly(e)) {
    return new FeatureError(
      'Etsy не дозволив цій програмі надіслати відправлення (HTTP 403): у регіонах, де діє Preferred Partner Program, ' +
        'це можуть лише схвалені Etsy програми-партнери з доставки, тож повторний вхід не допоможе. ' +
        'Додайте трек-номер на сайті Etsy або позначте замовлення кнопкою «Відправлено без трек-номера».'
    )
  }
  return e
}

/** getListingsByShopReceipt: GET /shops/{shop_id}/receipts/{receipt_id}/listings (one page of 100). */
export async function orderListings(client: EtsyClient, shopId: number, receiptId: number): Promise<MyListing[]> {
  const p = await client.call<Page>(`${shopPath(shopId)}/receipts/${receiptId}/listings`, {
    oauth: true,
    query: { limit: ORDERS_MAX_LIMIT }
  })
  return results(p).map((l) => toMyListing(l as unknown as EtsyListing))
}

/** getShopPaymentByReceiptId: GET /shops/{shop_id}/receipts/{receipt_id}/payments. */
export async function orderPayments(client: EtsyClient, shopId: number, receiptId: number): Promise<OrderPayment[]> {
  const p = await client.call<Page>(`${shopPath(shopId)}/receipts/${receiptId}/payments`, { oauth: true })
  return results(p).map(toPayment)
}

/** getPayments: GET /shops/{shop_id}/payments?payment_ids=1,2. */
export async function paymentsByIds(client: EtsyClient, shopId: number, ids: number[]): Promise<OrderPayment[]> {
  const p = await client.call<Page>(`${shopPath(shopId)}/payments`, { oauth: true, query: { payment_ids: ids } })
  return results(p).map(toPayment)
}

/** getPaymentAccountLedgerEntryPayments: GET /shops/{shop_id}/payment-account/ledger-entries/payments?ledger_entry_ids=… */
export async function ledgerPayments(client: EtsyClient, shopId: number, ids: number[]): Promise<OrderPayment[]> {
  const p = await client.call<Page>(`${shopPath(shopId)}/payment-account/ledger-entries/payments`, {
    oauth: true,
    query: { ledger_entry_ids: ids }
  })
  return results(p).map(toPayment)
}

/** getShopPaymentAccountLedgerEntries over the whole range (min_created / max_created required by the OAS). */
export async function ledger(client: EtsyClient, shopId: number, minCreated: number, maxCreated: number): Promise<LedgerPage> {
  const { rows, count, truncated } = await pageAll(client, `${shopPath(shopId)}/payment-account/ledger-entries`, {
    min_created: minCreated,
    max_created: maxCreated
  })
  const entries = rows.map(toLedgerEntry).sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0) || b.entryId - a.entryId)
  return { minCreated, maxCreated, total: count, entries, totals: ledgerTotals(entries), truncated }
}

/** getShopPaymentAccountLedgerEntry: GET /shops/{shop_id}/payment-account/ledger-entries/{ledger_entry_id}. */
export async function ledgerEntry(client: EtsyClient, shopId: number, entryId: number): Promise<LedgerEntry> {
  return toLedgerEntry((await client.call<Obj>(`${shopPath(shopId)}/payment-account/ledger-entries/${entryId}`, { oauth: true })) ?? {})
}

/** getShopReceiptTransaction: GET /shops/{shop_id}/transactions/{transaction_id}. */
export async function saleById(client: EtsyClient, shopId: number, transactionId: number): Promise<OrderItem> {
  return toItem((await client.call<Obj>(`${shopPath(shopId)}/transactions/${transactionId}`, { oauth: true })) ?? {})
}

/** price × quantity (null without a price). */
function revenueOf(t: OrderItem): OrderMoney | null {
  return t.price ? { ...t.price, amount: t.price.amount * t.quantity } : null
}

function aggregate(items: OrderItem[]): { quantity: number; revenue: OrderMoney[]; lastSaleAt: number | null } {
  let revenue: OrderMoney[] = []
  let quantity = 0
  let lastSaleAt: number | null = null
  for (const t of items) {
    quantity += t.quantity
    const r = revenueOf(t)
    if (r) revenue = addByCurrency(revenue, r)
    if (t.createdAt != null && (lastSaleAt == null || t.createdAt > lastSaleAt)) lastSaleAt = t.createdAt
  }
  return { quantity, revenue, lastSaleAt }
}

const newestFirst = (a: OrderItem, b: OrderItem): number => (b.createdAt ?? 0) - (a.createdAt ?? 0) || b.transactionId - a.transactionId

/**
 * Sales of one listing: getShopReceiptTransactionsByListing, every page (≤ 20).
 * The OAS documents no order, so with more than 2000 sales the read ones are
 * not necessarily the newest; a transaction carries no order status, so
 * canceled / refunded orders are counted too.
 */
export async function listingSales(client: EtsyClient, shopId: number, listingId: number, recent = 20): Promise<ListingSales> {
  const { rows, count, truncated } = await pageAll(client, `${shopPath(shopId)}/listings/${listingId}/transactions`, {})
  const items = rows.map(toItem).sort(newestFirst)
  return {
    listingId,
    total: count,
    scanned: rows.length,
    truncated,
    sales: items.length,
    ...aggregate(items),
    recent: items.slice(0, recent)
  }
}

/** getShopReceiptTransactionsByShop: one page (the OAS documents no order and no filter). */
export async function shopSalesPage(client: EtsyClient, shopId: number, limit: number, offset: number): Promise<SalesPage> {
  const p = await client.call<Page>(`${shopPath(shopId)}/transactions`, { oauth: true, query: { limit, offset } })
  const items = results(p).map(toItem)
  return { total: typeof p?.count === 'number' ? p.count : items.length, offset, items }
}

/** Receipt statuses whose sales don't count (canceled ones are already left out by was_canceled=false). */
const NOT_SOLD = new Set(['canceled', 'fully refunded'])

/**
 * Sales of the whole shop per listing, from the orders of the period:
 * getShopReceipts with min/max_created, was_canceled=false, newest first
 * (sort_on created, sort_order desc — documented by the OAS), at most
 * ORDERS_MAX_PAGES pages, so a cut-off loses only the oldest orders. Fully
 * refunded orders are left out too; partially refunded ones count in full.
 * `listingId` keeps one listing only.
 */
export async function shopSales(
  client: EtsyClient,
  shopId: number,
  opts: { minCreated?: number | null; maxCreated?: number | null; listingId?: number | null } = {}
): Promise<SalesSummary> {
  const lo = opts.minCreated ?? null
  const hi = opts.maxCreated ?? null
  const { rows, count, truncated } = await pageAll(client, `${shopPath(shopId)}/receipts`, {
    min_created: lo ?? undefined,
    max_created: hi ?? undefined,
    was_canceled: false,
    sort_on: 'created',
    sort_order: 'desc'
  })
  const sold = rows.filter((r) => !NOT_SOLD.has(String(r.status ?? '').toLowerCase()))
  const items: OrderItem[] = []
  for (const r of sold) {
    const id = typeof r.receipt_id === 'number' ? r.receipt_id : null
    if (hasItems(r) || id == null) items.push(...toOrder(r).items)
    else items.push(...(await orderItems(client, shopId, id)))
  }
  const kept = items.filter((t) => opts.listingId == null || t.listingId === opts.listingId)
  const groups = new Map<string, OrderItem[]>()
  for (const t of kept) {
    const key = t.listingId == null ? `t:${t.title}` : `l:${t.listingId}`
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const products: SalesRow[] = [...groups.values()].map((g) => {
    const latest = [...g].sort(newestFirst)[0]
    return { listingId: latest.listingId, title: latest.title, sales: g.length, ...aggregate(g) }
  })
  products.sort((a, b) => b.quantity - a.quantity || b.sales - a.sales || a.title.localeCompare(b.title))
  return {
    minCreated: lo,
    maxCreated: hi,
    ordersRead: rows.length,
    ordersTotal: count,
    excludedOrders: rows.length - sold.length,
    truncated,
    sales: kept.length,
    ...aggregate(kept),
    products
  }
}
