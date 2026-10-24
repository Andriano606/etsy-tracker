// Feature "orders": the signed-in user's own orders (OAS ShopReceipt), sales
// (ShopReceiptTransaction), payments (Payment) and the payment-account ledger
// (PaymentAccountLedgerEntry). Times are Etsy epoch seconds; money is kept
// exactly as Etsy sends it (value = amount / divisor).

/** Etsy `Money`: value = amount / divisor in `currency`. */
export interface OrderMoney {
  amount: number
  divisor: number
  currency: string
}

/** The OAS `sort_on` / `sort_order` enums of getShopReceipts. */
export const ORDER_SORT_ON = ['created', 'updated', 'receipt_id'] as const
export const ORDER_SORT_ORDER = ['asc', 'ascending', 'desc', 'descending', 'up', 'down'] as const
export type OrderSortOn = (typeof ORDER_SORT_ON)[number]
export type OrderSortOrder = (typeof ORDER_SORT_ORDER)[number]

/** The OAS minimum of every *_created / *_last_modified filter (2000-01-01). */
export const ETSY_EPOCH_MIN = 946_684_800
/** getShopReceipts / transactions / ledger pages: the OAS `limit` maximum. */
export const ORDERS_MAX_LIMIT = 100
/** Pages read at most for one ledger range / one sales summary (100 rows each). */
export const ORDERS_MAX_PAGES = 20

/** getShopReceipts filters — exactly the OAS query parameters; absent/null = not filtered. */
export interface OrderFilters {
  minCreated?: number | null
  maxCreated?: number | null
  minLastModified?: number | null
  maxLastModified?: number | null
  wasPaid?: boolean | null
  wasShipped?: boolean | null
  wasDelivered?: boolean | null
  wasCanceled?: boolean | null
  sortOn?: OrderSortOn
  sortOrder?: OrderSortOrder
  limit?: number
  offset?: number
}

export interface OrderAddress {
  /** The recipient (OAS `name`). */
  name: string | null
  firstLine: string | null
  secondLine: string | null
  city: string | null
  state: string | null
  zip: string | null
  countryIso: string | null
  formatted: string | null
}

export interface OrderVariation {
  name: string
  value: string
}

/** One line of an order (OAS ShopReceiptTransaction). */
export interface OrderItem {
  transactionId: number
  receiptId: number | null
  listingId: number | null
  productId: number | null
  title: string
  quantity: number
  /** The unit price recorded by the sale. */
  price: OrderMoney | null
  shippingCost: OrderMoney | null
  variations: OrderVariation[]
  sku: string | null
  isDigital: boolean
  createdAt: number | null
  paidAt: number | null
  shippedAt: number | null
  expectedShipDate: number | null
  shippingMethod: string | null
  shippingUpgrade: string | null
}

export interface OrderShipment {
  id: number | null
  carrier: string | null
  trackingCode: string | null
  /** When Etsy notified the buyer. */
  notifiedAt: number | null
}

export interface OrderRefund {
  amount: OrderMoney | null
  createdAt: number | null
  reason: string | null
  note: string | null
  status: string | null
}

export interface OrderTotals {
  /** total_price − discount + tax + shipping. */
  grandTotal: OrderMoney | null
  /** total_price − discount. */
  subtotal: OrderMoney | null
  /** Σ price × quantity. */
  itemsTotal: OrderMoney | null
  shipping: OrderMoney | null
  tax: OrderMoney | null
  vat: OrderMoney | null
  discount: OrderMoney | null
  giftWrap: OrderMoney | null
}

/** One order (OAS ShopReceipt). */
export interface Order {
  receiptId: number
  /** OAS enum: paid, completed, open, payment processing, canceled, fully refunded, partially refunded. */
  status: string
  createdAt: number | null
  updatedAt: number | null
  isPaid: boolean
  isShipped: boolean
  isGift: boolean
  giftMessage: string | null
  giftSender: string | null
  buyerName: string | null
  /** null unless Etsy granted access (case by case). */
  buyerEmail: string | null
  address: OrderAddress
  paymentMethod: string | null
  messageFromBuyer: string | null
  messageFromSeller: string | null
  messageFromPayment: string | null
  totals: OrderTotals
  items: OrderItem[]
  /** Σ quantity of the items. */
  itemCount: number
  shipments: OrderShipment[]
  refunds: OrderRefund[]
}

export interface OrdersPage {
  /** Etsy's `count` for the filters. */
  total: number
  offset: number
  orders: Order[]
}

/** updateShopReceipt: absent = unchanged. */
export interface OrderUpdate {
  wasShipped?: boolean
  wasPaid?: boolean
}

/** createReceiptShipment: carrier + tracking code together, or neither (= shipped without tracking). */
export interface ShipmentInput {
  carrier?: string
  trackingCode?: string
  noteToBuyer?: string
  sendBcc?: boolean
}

export interface PaymentAdjustmentItem {
  id: number
  type: string | null
  /** In the payment currency. */
  amount: OrderMoney | null
  /** In the shop currency. */
  shopAmount: OrderMoney | null
  transactionId: number | null
  createdAt: number | null
}

/** A refund on a payment (OAS PaymentAdjustment). */
export interface PaymentAdjustment {
  id: number
  status: string | null
  isSuccess: boolean
  reason: string | null
  amount: OrderMoney | null
  shopAmount: OrderMoney | null
  buyerAmount: OrderMoney | null
  feeAmount: OrderMoney | null
  createdAt: number | null
  items: PaymentAdjustmentItem[]
}

/** OAS Payment. */
export interface OrderPayment {
  paymentId: number
  receiptId: number | null
  status: string | null
  currency: string | null
  shopCurrency: string | null
  buyerCurrency: string | null
  gross: OrderMoney | null
  fees: OrderMoney | null
  net: OrderMoney | null
  postedGross: OrderMoney | null
  postedFees: OrderMoney | null
  postedNet: OrderMoney | null
  adjustedGross: OrderMoney | null
  adjustedFees: OrderMoney | null
  adjustedNet: OrderMoney | null
  createdAt: number | null
  updatedAt: number | null
  shippedAt: number | null
  adjustments: PaymentAdjustment[]
}

/**
 * OAS PaymentAccountLedgerEntry. The OAS gives no unit for amount / balance;
 * they are read as minor units of `currency` (cents: divisor 100, yen: 1) —
 * unverified live.
 */
export interface LedgerEntry {
  entryId: number
  ledgerId: number | null
  sequence: number | null
  amount: OrderMoney
  balance: OrderMoney | null
  description: string
  /** ledger_type: the original reference type. */
  type: string
  referenceType: string | null
  referenceId: string | null
  /** The related entry (e.g. VAT on a fee), null when none / itself. */
  parentEntryId: number | null
  createdAt: number | null
  adjustments: PaymentAdjustment[]
}

export interface LedgerTotal {
  type: string
  count: number
  sum: OrderMoney
}

export interface LedgerPage {
  minCreated: number
  maxCreated: number
  /** Etsy's `count` for the range. */
  total: number
  entries: LedgerEntry[]
  /** Per (type, currency), largest count first. */
  totals: LedgerTotal[]
  /** More entries than ORDERS_MAX_PAGES pages: the list and totals are partial. */
  truncated: boolean
}

/** Sales of one listing, aggregated (revenue = Σ price × quantity, without shipping/tax/discounts). */
export interface SalesRow {
  listingId: number | null
  title: string
  sales: number
  quantity: number
  revenue: OrderMoney[]
  lastSaleAt: number | null
}

/** Sales of the shop in a period, from its orders (getShopReceipts, newest first, canceled ones left out). */
export interface SalesSummary {
  minCreated: number | null
  maxCreated: number | null
  /** Orders read (the newest ORDERS_MAX_PAGES × 100 at most). */
  ordersRead: number
  /** Etsy's `count` of non-canceled orders in the period. */
  ordersTotal: number
  /** Read orders left out: fully refunded (partially refunded ones count in full). */
  excludedOrders: number
  /** More orders than were read: the oldest ones of the period are missing. */
  truncated: boolean
  sales: number
  quantity: number
  revenue: OrderMoney[]
  lastSaleAt: number | null
  /** Most quantity first. */
  products: SalesRow[]
}

/**
 * Sales of one listing (getShopReceiptTransactionsByListing): every sale incl.
 * those of canceled / refunded orders (a transaction carries no order status).
 */
export interface ListingSales {
  listingId: number
  /** Etsy's `count` of this listing's sales. */
  total: number
  /** Sales read (ORDERS_MAX_PAGES × 100 at most, in Etsy's undocumented order). */
  scanned: number
  truncated: boolean
  /** Sales read. */
  sales: number
  quantity: number
  revenue: OrderMoney[]
  lastSaleAt: number | null
  /** The newest of the read ones first. */
  recent: OrderItem[]
}

/** One page of the shop's sales (getShopReceiptTransactionsByShop, Etsy's order). */
export interface SalesPage {
  total: number
  offset: number
  items: OrderItem[]
}

/** Ukrainian labels of the OAS ShopReceipt `status` enum. */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  paid: 'оплачено',
  completed: 'виконано',
  open: 'відкрите',
  'payment processing': 'оплата обробляється',
  canceled: 'скасовано',
  'fully refunded': 'повністю повернуто',
  'partially refunded': 'частково повернуто'
}

export const orderStatusLabel = (s: string): string => ORDER_STATUS_LABEL[s.toLowerCase()] ?? s

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

/** a + b, exactly (common divisor); the currencies must match. */
export function addMoney(a: OrderMoney, b: OrderMoney): OrderMoney {
  if (a.divisor === b.divisor) return { ...a, amount: a.amount + b.amount }
  const d = (a.divisor / gcd(a.divisor, b.divisor)) * b.divisor
  return { currency: a.currency, divisor: d, amount: a.amount * (d / a.divisor) + b.amount * (d / b.divisor) }
}

/** `list` with `m` added to the entry of its currency (a new list; currencies in first-seen order). */
export function addByCurrency(list: OrderMoney[], m: OrderMoney): OrderMoney[] {
  const i = list.findIndex((x) => x.currency === m.currency)
  if (i < 0) return [...list, m]
  return list.map((x, j) => (j === i ? addMoney(x, m) : x))
}

/** A money value as a decimal number. */
export const moneyValue = (m: OrderMoney): number => (m.divisor > 0 ? m.amount / m.divisor : m.amount)

/** A local calendar date "YYYY-MM-DD" → epoch seconds of its start (or its last second with `end`); null if invalid. */
export function localDaySec(date: string, end = false): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (end ? 1 : 0))
  if (Number.isNaN(d.getTime())) return null
  return Math.floor(d.getTime() / 1000) - (end ? 1 : 0)
}

/** Epoch ms → the local calendar date "YYYY-MM-DD" (for date inputs). */
export function localDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** The MCP tools of this feature, in Ukrainian for the MCP modal (all read Etsy live, with the sign-in). */
export const ORDERS_TOOL_SUMMARY: ReadonlyArray<{ name: string; text: string; write?: boolean }> = [
  {
    name: 'list_my_orders',
    text: 'мої замовлення з Etsy (сторінка) з фільтрами: дати, оплачені, відправлені, доставлені, скасовані; email і адреса покупця — лише на прохання'
  },
  { name: 'get_my_order', text: 'одне моє замовлення з Etsy: товари, суми, відправлення з трек-номером, повернення, повідомлення (адреса — лише на прохання)' },
  { name: 'mark_my_order_shipped', text: 'додати трек-номер і позначити замовлення відправленим (Etsy одразу надішле покупцю лист)', write: true },
  { name: 'update_my_order', text: 'змінити позначки «оплачено» / «відправлено» замовлення на Etsy (без трек-номера)', write: true },
  {
    name: 'list_my_sales',
    text: 'мої продажі за період, згруповані за товарами: кількість, виручка (без скасованих і повністю повернутих замовлень; до 2000 найновіших замовлень)'
  },
  { name: 'get_my_product_sales', text: 'продажі одного мого товару за всю історію (зі скасованими теж): кількість, виручка, останні продажі' },
  { name: 'get_my_sale', text: 'один мій продаж (рядок замовлення) з Etsy' },
  { name: 'browse_my_sales', text: 'сторінка моїх продажів (рядків замовлень) у порядку Etsy' },
  { name: 'list_my_ledger', text: 'рух коштів платіжного рахунку Etsy за період (до 2000 записів) і підсумки за типами' },
  { name: 'get_my_ledger_entry', text: 'один запис руху коштів на Etsy і його платежі' },
  { name: 'get_my_payments', text: 'платежі Etsy Payments (сума, комісії, чиста сума, повернення): за замовленням, номерами платежів або записами руху коштів' }
]
