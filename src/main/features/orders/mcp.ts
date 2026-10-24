// The MCP tools of the "orders" feature: the user's own Etsy orders (receipts),
// sales (transactions), Etsy Payments payments and payment-account ledger
// entries — every tool is a live Etsy API call with the user's OAuth sign-in
// (transactions_r to read, transactions_w to write), nothing comes from the
// local database. Etsy's free text is passed through unchanged; no raw API
// objects, tokens or CDN URLs are sent. Buyer email and street address only
// with include_shipping_address.

import type {
  LedgerEntry,
  Order,
  OrderItem,
  OrderMoney,
  OrderPayment,
  PaymentAdjustment
} from '../../../shared/features/orders'
import { ETSY_EPOCH_MIN, moneyValue } from '../../../shared/features/orders'
import { type JsonSchema, type McpTool, ToolInputError, textResult } from '../../mcpProtocol'
import { mcpFail, mcpOwnShop, mcpWritable } from '../common'
import type { FeatureMcpDeps } from '../types'
import {
  CARRIER_MAX,
  NOTE_MAX,
  READ,
  TRACKING_MAX,
  WRITE,
  getOrder,
  isConflict,
  isPartnerOnly,
  ledger,
  ledgerEntry,
  ledgerPayments,
  listOrders,
  listingSales,
  orderPayments,
  paymentsByIds,
  saleById,
  shipOrder,
  shopSales,
  shopSalesPage,
  updateOrder
} from './api'

// ------------------------------------------------------------------ output

const iso = (sec: number | null): string | null => (sec == null ? null : new Date(sec * 1000).toISOString())
const money = (m: OrderMoney | null): { value: number; currency: string } | null =>
  m ? { value: moneyValue(m), currency: m.currency } : null
const moneys = (list: OrderMoney[]): Array<{ value: number; currency: string }> => list.map((m) => money(m)!)

function orderSummary(o: Order, withAddress: boolean): Record<string, unknown> {
  const a = o.address
  return {
    id: o.receiptId,
    created_at: iso(o.createdAt),
    updated_at: iso(o.updatedAt),
    status: o.status,
    paid: o.isPaid,
    shipped: o.isShipped,
    canceled: o.status === 'canceled',
    gift: o.isGift,
    item_count: o.itemCount,
    totals: {
      grand_total: money(o.totals.grandTotal),
      subtotal: money(o.totals.subtotal),
      items_total: money(o.totals.itemsTotal),
      shipping: money(o.totals.shipping),
      tax: money(o.totals.tax),
      vat: money(o.totals.vat),
      discount: money(o.totals.discount),
      gift_wrap: money(o.totals.giftWrap)
    },
    buyer_name: o.buyerName,
    city: a.city,
    country: a.countryIso,
    ...(withAddress
      ? {
          buyer_email: o.buyerEmail,
          shipping_address: {
            name: a.name,
            line1: a.firstLine,
            line2: a.secondLine,
            city: a.city,
            state: a.state,
            zip: a.zip,
            country: a.countryIso,
            formatted: a.formatted
          }
        }
      : {})
  }
}

function saleOut(t: OrderItem): Record<string, unknown> {
  return {
    sale_id: t.transactionId,
    order_id: t.receiptId,
    product_id: t.listingId,
    title: t.title,
    quantity: t.quantity,
    unit_price: money(t.price),
    shipping_cost: money(t.shippingCost),
    variations: t.variations.map((v) => ({ name: v.name, value: v.value })),
    sku: t.sku,
    digital: t.isDigital,
    created_at: iso(t.createdAt),
    paid_at: iso(t.paidAt),
    shipped_at: iso(t.shippedAt),
    expected_ship_date: iso(t.expectedShipDate),
    shipping_method: t.shippingMethod,
    shipping_upgrade: t.shippingUpgrade
  }
}

function orderDetail(o: Order, withAddress: boolean): Record<string, unknown> {
  return {
    ...orderSummary(o, withAddress),
    payment_method: o.paymentMethod,
    buyer_message: o.messageFromBuyer,
    seller_message: o.messageFromSeller,
    gift_message: o.giftMessage,
    gift_sender: o.giftSender,
    items: o.items.map(saleOut),
    shipments: o.shipments.map((s) => ({
      carrier: s.carrier,
      tracking_code: s.trackingCode,
      buyer_notified_at: iso(s.notifiedAt)
    })),
    refunds: o.refunds.map((r) => ({
      amount: money(r.amount),
      created_at: iso(r.createdAt),
      reason: r.reason,
      note: r.note,
      status: r.status
    }))
  }
}

const refundOut = (a: PaymentAdjustment): Record<string, unknown> => ({
  id: a.id,
  status: a.status,
  success: a.isSuccess,
  reason: a.reason,
  amount: money(a.amount),
  store_currency_amount: money(a.shopAmount),
  buyer_currency_amount: money(a.buyerAmount),
  fee_amount: money(a.feeAmount),
  created_at: iso(a.createdAt),
  items: a.items.map((i) => ({
    type: i.type,
    amount: money(i.amount),
    store_currency_amount: money(i.shopAmount),
    sale_id: i.transactionId
  }))
})

function paymentOut(p: OrderPayment): Record<string, unknown> {
  return {
    payment_id: p.paymentId,
    order_id: p.receiptId,
    status: p.status,
    currency: p.currency,
    store_currency: p.shopCurrency,
    buyer_currency: p.buyerCurrency,
    gross: money(p.gross),
    fees: money(p.fees),
    net: money(p.net),
    posted_gross: money(p.postedGross),
    posted_fees: money(p.postedFees),
    posted_net: money(p.postedNet),
    adjusted_gross: money(p.adjustedGross),
    adjusted_fees: money(p.adjustedFees),
    adjusted_net: money(p.adjustedNet),
    created_at: iso(p.createdAt),
    updated_at: iso(p.updatedAt),
    shipped_at: iso(p.shippedAt),
    refunds: p.adjustments.map(refundOut)
  }
}

function entryOut(e: LedgerEntry): Record<string, unknown> {
  return {
    entry_id: e.entryId,
    created_at: iso(e.createdAt),
    description: e.description,
    type: e.type,
    amount: money(e.amount),
    balance_after: money(e.balance),
    reference_type: e.referenceType,
    reference_id: e.referenceId,
    related_entry_id: e.parentEntryId,
    refunds: e.adjustments.map(refundOut)
  }
}

// ------------------------------------------------------------------- input

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** "2026-10-01" (UTC day; `end` = its last second) or a full ISO 8601 time → unix seconds; null if absent. */
export function dateArg(v: unknown, name: string, end = false): number | null {
  if (v == null) return null
  const s = String(v)
  const ms = DATE_ONLY.test(s) ? Date.parse(`${s}T00:00:00Z`) + (end ? 86_400_000 - 1000 : 0) : Date.parse(s)
  if (Number.isNaN(ms)) throw new ToolInputError(`Argument "${name}" must be a date like 2026-10-01 or an ISO 8601 time.`)
  const sec = Math.floor(ms / 1000)
  if (sec < ETSY_EPOCH_MIN) throw new ToolInputError(`Argument "${name}" must not be before 2000-01-01.`)
  return sec
}

function rangeArgs(args: Record<string, unknown>, from: string, to: string): { lo: number | null; hi: number | null } {
  const lo = dateArg(args[from], from)
  const hi = dateArg(args[to], to, true)
  if (lo != null && hi != null && lo > hi) throw new ToolInputError(`"${from}" must not be after "${to}".`)
  return { lo, hi }
}

function idsArg(v: unknown, name: string): number[] {
  const ids = Array.isArray(v) ? v : []
  if (!ids.length || ids.length > 100 || ids.some((n) => typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0)) {
    throw new ToolInputError(`Argument "${name}" must be a list of 1–100 positive integer ids.`)
  }
  return [...new Set(ids as number[])]
}

const DATE = (what: string): JsonSchema => ({
  type: 'string',
  maxLength: 40,
  description: `${what}: a date (YYYY-MM-DD, UTC; an end date includes the whole day) or an ISO 8601 time.`
})
const ID = (what: string): JsonSchema => ({ type: 'integer', minimum: 1, description: what })
const ADDRESS: JsonSchema = {
  type: 'boolean',
  description: "Also return the buyer's email and full shipping address (street, zip). Only when the user needs them, e.g. to ship."
}
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema & { type: 'object' } => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
})

const MONEY_NOTE = 'Money is {value, currency} with value a decimal number; currencies are never converted.'
/** Where the data comes from: every orders tool calls the Etsy API live. */
const LIVE_READ = 'Live Etsy API call (costs API quota; needs the OAuth scope transactions_r). '
const LIVE_WRITE =
  'Live Etsy API call (needs the OAuth scope transactions_w and the app\'s "allow changes" switch); it changes the user\'s real Etsy shop — only when the user asked. '

// ------------------------------------------------------------------- tools

export function orderTools(deps: FeatureMcpDeps): McpTool[] {
  const read = (): number => mcpOwnShop(deps, READ)
  const write = (): number => mcpWritable(deps, WRITE)
  const client = () => deps.client!

  return [
    {
      name: 'list_my_orders',
      title: 'My Etsy orders',
      openWorld: true,
      description:
        "One page of the orders (Etsy receipts) of the user's own Etsy shop, newest first by default. " +
        LIVE_READ +
        "Each order: id, created/updated time, Etsy's status (e.g. paid, completed, canceled, fully refunded), paid / shipped / canceled / gift flags, totals, item_count (units), buyer name, city and country. No buyer email or street address unless include_shipping_address is true. Filters: placed / last-changed time ranges, paid, shipped, delivered, canceled. Returns total (all matching orders), offset, count, orders. " +
        MONEY_NOTE,
      inputSchema: obj({
        created_from: DATE('Placed at or after'),
        created_to: DATE('Placed at or before'),
        modified_from: DATE('Last changed at or after'),
        modified_to: DATE('Last changed at or before'),
        paid: { type: 'boolean', description: 'true = only paid orders, false = only unpaid.' },
        shipped: { type: 'boolean', description: 'true = only shipped orders, false = only not shipped.' },
        delivered: { type: 'boolean', description: 'true = only orders marked delivered, false = only not delivered.' },
        canceled: { type: 'boolean', description: 'true = only canceled orders, false = only not canceled.' },
        sort_by: { type: 'string', enum: ['created', 'updated', 'order_id'], description: 'Default created.' },
        sort_order: { type: 'string', enum: ['asc', 'desc'], description: 'Default desc.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 25.' },
        offset: { type: 'integer', minimum: 0, maximum: 100000, description: 'For paging. Default 0.' },
        include_shipping_address: ADDRESS
      }),
      run: async (args) => {
        try {
          const shopId = read()
          const c = rangeArgs(args, 'created_from', 'created_to')
          const m = rangeArgs(args, 'modified_from', 'modified_to')
          const sortBy = args.sort_by as string | undefined
          const page = await listOrders(client(), shopId, {
            minCreated: c.lo,
            maxCreated: c.hi,
            minLastModified: m.lo,
            maxLastModified: m.hi,
            wasPaid: args.paid as boolean | undefined,
            wasShipped: args.shipped as boolean | undefined,
            wasDelivered: args.delivered as boolean | undefined,
            wasCanceled: args.canceled as boolean | undefined,
            sortOn: sortBy === 'order_id' ? 'receipt_id' : (sortBy as 'created' | 'updated' | undefined),
            sortOrder: args.sort_order as 'asc' | 'desc' | undefined,
            limit: (args.limit as number | undefined) ?? 25,
            offset: (args.offset as number | undefined) ?? 0
          })
          return textResult({
            total: page.total,
            offset: page.offset,
            count: page.orders.length,
            orders: page.orders.map((o) => orderSummary(o, args.include_shipping_address === true))
          })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'get_my_order',
      title: 'One of my Etsy orders',
      openWorld: true,
      description:
        "One order (Etsy receipt) of the user's own Etsy shop, with its items read from Etsy when the receipt doesn't list them. " +
        LIVE_READ +
        "Returns everything list_my_orders gives plus the payment method, the buyer's and the seller's messages, gift message and sender, items (sales: listing id, title, quantity, unit price, shipping cost, chosen variations, SKU, times, shipping method), shipments (carrier, tracking code, when Etsy notified the buyer) and refunds. Buyer email and street address only with include_shipping_address. " +
        MONEY_NOTE,
      inputSchema: obj({ order_id: ID('The order (Etsy receipt) id.'), include_shipping_address: ADDRESS }, ['order_id']),
      run: async (args) => {
        try {
          const o = await getOrder(client(), read(), args.order_id as number)
          return textResult(orderDetail(o, args.include_shipping_address === true))
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'mark_my_order_shipped',
      title: 'Mark my Etsy order shipped (with tracking)',
      openWorld: true,
      description:
        "Submits a carrier and tracking code for an order of the user's own Etsy shop (Etsy createReceiptShipment) and so marks it shipped. " +
        LIVE_WRITE +
        "Etsy immediately emails the buyer a shipping notice (with note_to_buyer if given) — this cannot be taken back, and the request is never retried. Etsy may refuse it with HTTP 403 where only approved fulfillment-partner apps may submit tracking. Returns the shipped order (without the buyer's email/address).",
      inputSchema: obj(
        {
          order_id: ID('The order (Etsy receipt) id.'),
          carrier: { type: 'string', minLength: 1, maxLength: CARRIER_MAX, description: 'Carrier name as Etsy knows it, e.g. "usps", "ukrposhta", or "other".' },
          tracking_code: { type: 'string', minLength: 1, maxLength: TRACKING_MAX, description: 'The tracking code.' },
          note_to_buyer: { type: 'string', maxLength: NOTE_MAX, description: "A message included in Etsy's shipping notice to the buyer." },
          send_copy_to_me: { type: 'boolean', description: 'Also send a copy of the notice to the seller.' }
        },
        ['order_id', 'carrier', 'tracking_code']
      ),
      readOnly: false,
      destructive: true,
      run: async (args) => {
        try {
          const shopId = write()
          const carrier = String(args.carrier).trim()
          const trackingCode = String(args.tracking_code).trim()
          if (!carrier || !trackingCode) throw new ToolInputError('"carrier" and "tracking_code" must not be blank.')
          const o = await shipOrder(client(), shopId, args.order_id as number, {
            carrier,
            trackingCode,
            noteToBuyer: typeof args.note_to_buyer === 'string' ? args.note_to_buyer.trim() || undefined : undefined,
            sendBcc: args.send_copy_to_me as boolean | undefined
          })
          return textResult({ shipped: true, order: orderDetail(o, false) })
        } catch (e) {
          if (isConflict(e)) {
            return mcpFail(new ToolInputError(`Etsy refused to record this shipment (HTTP 409)${e.detail ? `: ${e.detail}` : ''}.`))
          }
          if (isPartnerOnly(e)) {
            return mcpFail(
              new ToolInputError(
                'Etsy refused to record this shipment (HTTP 403): where Etsy enforces its Preferred Partner Program only approved fulfillment-partner apps may submit tracking, so signing in again will not help. ' +
                  'The user can add the tracking on Etsy (Shop Manager → Orders & Shipping), or the order can be marked shipped without tracking with update_my_order (shipped: true).'
              )
            )
          }
          return mcpFail(e)
        }
      }
    },
    {
      name: 'update_my_order',
      title: 'Set paid / shipped on my Etsy order',
      openWorld: true,
      description:
        "Sets the paid and/or shipped flag of an order of the user's own Etsy shop (Etsy updateShopReceipt; no tracking — use mark_my_order_shipped for that). " +
        LIVE_WRITE +
        'The buyer may see the change. Returns the updated order in the list_my_orders form (no items).',
      inputSchema: obj(
        {
          order_id: ID('The order (Etsy receipt) id.'),
          paid: { type: 'boolean', description: 'Mark the order paid (true) or not paid (false).' },
          shipped: { type: 'boolean', description: 'Mark the order shipped (true) or not shipped (false).' }
        },
        ['order_id']
      ),
      readOnly: false,
      destructive: true,
      run: async (args) => {
        try {
          const shopId = write()
          if (args.paid == null && args.shipped == null) throw new ToolInputError('Give "paid" and/or "shipped".')
          const o = await updateOrder(client(), shopId, args.order_id as number, {
            wasPaid: args.paid as boolean | undefined,
            wasShipped: args.shipped as boolean | undefined
          })
          return textResult({ updated: true, order: orderSummary(o, false) })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'list_my_sales',
      title: 'My Etsy sales by listing',
      openWorld: true,
      description:
        "Sales of the user's own Etsy shop in a period, grouped per listing (product): number of sales (order lines), units sold, revenue per currency (unit price × quantity as recorded on each sale — no shipping, tax or order-level discounts), last sale time; plus the totals. " +
        LIVE_READ +
        "Built from the orders placed in the period, read newest first (up to 20 requests of 100 orders, plus one per order that lists no items): canceled orders are not requested, fully refunded ones are left out (`excluded_orders` counts those read), partially refunded orders count in full. At most the newest 2000 orders are read — `partial: true` means older orders of the period are missing (`orders_read` of `orders_total`). " +
        MONEY_NOTE,
      inputSchema: obj({
        from: DATE('Orders placed at or after'),
        to: DATE('Orders placed at or before'),
        product_id: ID('Only this listing (product) id — the same orders are read, only its lines are counted.'),
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Products returned, most units first. Default 50.' }
      }),
      run: async (args) => {
        try {
          const shopId = read()
          const { lo, hi } = rangeArgs(args, 'from', 'to')
          const productId = (args.product_id as number | undefined) ?? null
          const s = await shopSales(client(), shopId, { minCreated: lo, maxCreated: hi, listingId: productId })
          return textResult({
            from: iso(lo),
            to: iso(hi),
            orders_read: s.ordersRead,
            orders_total: s.ordersTotal,
            excluded_orders: s.excludedOrders,
            partial: s.truncated,
            sales: s.sales,
            units: s.quantity,
            revenue: moneys(s.revenue),
            products: s.products.slice(0, (args.limit as number | undefined) ?? 50).map((p) => ({
              product_id: p.listingId,
              title: p.title,
              sales: p.sales,
              units: p.quantity,
              revenue: moneys(p.revenue),
              last_sale_at: iso(p.lastSaleAt)
            }))
          })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'get_my_product_sales',
      title: 'Sales of my Etsy listing',
      openWorld: true,
      description:
        "Sales (Etsy transactions) of one listing (product) of the user's own Etsy shop over its whole history: total number of sales, units, revenue (unit price × quantity) per currency, last sale time, and the newest sales (time, quantity, unit price, variations, order id). " +
        LIVE_READ +
        "Up to 20 requests of 100 sales. Includes sales of canceled and refunded orders (a sale carries no order status — use list_my_sales with product_id for sales without them). At most 2000 sales are read, in an order Etsy doesn't document: with `partial: true` the totals cover only `sales_read` of `total_sales` and the newest sales may be missing. " +
        MONEY_NOTE,
      inputSchema: obj(
        {
          product_id: ID('The listing (product) id.'),
          recent: { type: 'integer', minimum: 1, maximum: 100, description: 'How many recent sales to list. Default 20.' }
        },
        ['product_id']
      ),
      run: async (args) => {
        try {
          const s = await listingSales(client(), read(), args.product_id as number, (args.recent as number | undefined) ?? 20)
          return textResult({
            product_id: s.listingId,
            total_sales: s.total,
            sales_read: s.scanned,
            partial: s.truncated,
            units: s.quantity,
            revenue: moneys(s.revenue),
            last_sale_at: iso(s.lastSaleAt),
            recent: s.recent.map(saleOut)
          })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'get_my_sale',
      title: 'One Etsy sale',
      openWorld: true,
      description:
        "One sale (an Etsy transaction = one listing line of an order) of the user's own Etsy shop: order and listing ids, title, quantity, unit price, shipping cost, variations, SKU, digital flag, created / paid / shipped times, expected ship date, shipping method and upgrade. " +
        LIVE_READ +
        MONEY_NOTE,
      inputSchema: obj({ sale_id: ID('The sale (Etsy transaction) id — from get_my_order items, get_my_product_sales or browse_my_sales.') }, ['sale_id']),
      run: async (args) => {
        try {
          return textResult(saleOut(await saleById(client(), read(), args.sale_id as number)))
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'browse_my_sales',
      title: 'Browse my Etsy sales',
      openWorld: true,
      description:
        "One page of the individual sales (Etsy transactions — one listing line of an order each) of the user's own Etsy shop, in the order Etsy returns them (not documented to be by time — for a period use list_my_sales). Includes sales of canceled and refunded orders. Returns total, offset, count, sales. " +
        LIVE_READ +
        MONEY_NOTE,
      inputSchema: obj({
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 25.' },
        offset: { type: 'integer', minimum: 0, maximum: 100000, description: 'For paging. Default 0.' }
      }),
      run: async (args) => {
        try {
          const p = await shopSalesPage(client(), read(), (args.limit as number | undefined) ?? 25, (args.offset as number | undefined) ?? 0)
          return textResult({ total: p.total, offset: p.offset, count: p.items.length, sales: p.items.map(saleOut) })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'list_my_ledger',
      title: 'My Etsy payment account ledger',
      openWorld: true,
      description:
        "Money movements (ledger entries) of the user's Etsy Payments account in a period (both ends required): each entry's time, description, type, amount (+ credit, − debit), balance after it, what it refers to, related entry and refunds; plus the totals per type and currency. " +
        LIVE_READ +
        "Up to 20 requests of 100 entries: at most 2000 entries are read — `partial: true` says the period has more (`total`) and the totals then cover only the entries read. " +
        MONEY_NOTE,
      inputSchema: obj(
        {
          from: DATE('Entries at or after'),
          to: DATE('Entries at or before'),
          limit: { type: 'integer', minimum: 0, maximum: 500, description: 'Entries listed, newest first (0 = totals only; the totals cover every entry read). Default 100.' }
        },
        ['from', 'to']
      ),
      run: async (args) => {
        try {
          const shopId = read()
          const { lo, hi } = rangeArgs(args, 'from', 'to')
          const page = await ledger(client(), shopId, lo!, hi!)
          return textResult({
            from: iso(page.minCreated),
            to: iso(page.maxCreated),
            total: page.total,
            partial: page.truncated,
            totals: page.totals.map((t) => ({ type: t.type, count: t.count, sum: money(t.sum) })),
            entries: page.entries.slice(0, (args.limit as number | undefined) ?? 100).map(entryOut)
          })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'get_my_ledger_entry',
      title: 'One Etsy ledger entry',
      openWorld: true,
      description:
        "One money movement (ledger entry) of the user's Etsy Payments account and the payments behind it (if any; a second request, skipped with include_payments: false). " +
        LIVE_READ +
        MONEY_NOTE,
      inputSchema: obj(
        {
          entry_id: ID('The entry id (from list_my_ledger).'),
          include_payments: { type: 'boolean', description: 'Also return the payments of this entry. Default true.' }
        },
        ['entry_id']
      ),
      run: async (args) => {
        try {
          const shopId = read()
          const id = args.entry_id as number
          const entry = await ledgerEntry(client(), shopId, id)
          const payments = args.include_payments === false ? undefined : await ledgerPayments(client(), shopId, [id])
          return textResult({ ...entryOut(entry), ...(payments ? { payments: payments.map(paymentOut) } : {}) })
        } catch (e) {
          return mcpFail(e)
        }
      }
    },
    {
      name: 'get_my_payments',
      title: 'My Etsy Payments payments',
      openWorld: true,
      description:
        "Etsy Payments payments received by the user's own Etsy shop — give exactly one of: order_id (the order's payment), payment_ids, or ledger_entry_ids (the payments behind ledger entries). Each: payment and order ids, status, currencies, gross, fees, net, the amounts once posted and after adjustments, times, refunds (payment adjustments). " +
        LIVE_READ +
        MONEY_NOTE,
      inputSchema: obj({
        order_id: ID('The order (Etsy receipt) id.'),
        payment_ids: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Up to 100 payment ids.' },
        ledger_entry_ids: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Up to 100 ledger entry ids (from list_my_ledger).' }
      }),
      run: async (args) => {
        try {
          const shopId = read()
          const given = ['order_id', 'payment_ids', 'ledger_entry_ids'].filter((k) => args[k] != null)
          if (given.length !== 1) throw new ToolInputError('Give exactly one of "order_id", "payment_ids", "ledger_entry_ids".')
          const payments =
            args.order_id != null
              ? await orderPayments(client(), shopId, args.order_id as number)
              : args.payment_ids != null
                ? await paymentsByIds(client(), shopId, idsArg(args.payment_ids, 'payment_ids'))
                : await ledgerPayments(client(), shopId, idsArg(args.ledger_entry_ids, 'ledger_entry_ids'))
          return textResult({ count: payments.length, payments: payments.map(paymentOut) })
        } catch (e) {
          return mcpFail(e)
        }
      }
    }
  ]
}
