// Etsy JSON (OAS ShopReceipt, ShopReceiptTransaction, Payment,
// PaymentAccountLedgerEntry) → the clean records of shared/features/orders.ts.
// Every field is read defensively: the OAS marks almost nothing required.

import type {
  LedgerEntry,
  LedgerTotal,
  Order,
  OrderItem,
  OrderMoney,
  OrderPayment,
  PaymentAdjustment,
  PaymentAdjustmentItem
} from '../../../shared/features/orders'
import { addMoney } from '../../../shared/features/orders'
import { decodeHtmlEntities } from '../../../shared/html'

type Obj = Record<string, unknown>

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : [])
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
/** Free text from Etsy: entities decoded, '' → null. */
const txt = (v: unknown): string | null => {
  const s = str(v)
  return s == null ? null : decodeHtmlEntities(s)
}

/** Etsy `Money` → OrderMoney (null when absent/malformed). */
export function toMoney(v: unknown): OrderMoney | null {
  const m = obj(v)
  const amount = int(m.amount)
  if (amount == null) return null
  const divisor = int(m.divisor)
  return { amount, divisor: divisor && divisor > 0 ? divisor : 100, currency: str(m.currency_code) ?? '' }
}

/** 10^(minor-unit digits) of an ISO 4217 currency (USD 100, JPY 1); 100 when unknown. */
export function minorDivisor(currency: string | null): number {
  if (!currency) return 100
  try {
    return 10 ** new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits!
  } catch {
    return 100
  }
}

/**
 * A bare integer amount in minor units of `currency` (ledger entries, payment
 * adjustments — "pennies" in the OAS) → OrderMoney.
 */
export function minorUnits(v: unknown, currency: string | null): OrderMoney | null {
  const amount = int(v)
  return amount == null ? null : { amount, divisor: minorDivisor(currency), currency: currency ?? '' }
}

/** OAS ShopReceiptTransaction → OrderItem. */
export function toItem(t: Obj): OrderItem {
  return {
    transactionId: int(t.transaction_id) ?? 0,
    receiptId: int(t.receipt_id),
    listingId: int(t.listing_id),
    productId: int(t.product_id),
    title: txt(t.title) ?? '',
    quantity: int(t.quantity) ?? 0,
    price: toMoney(t.price),
    shippingCost: toMoney(t.shipping_cost),
    variations: arr(t.variations).map((v) => ({ name: txt(v.formatted_name) ?? '', value: txt(v.formatted_value) ?? '' })),
    sku: str(t.sku),
    isDigital: t.is_digital === true,
    createdAt: int(t.created_timestamp) ?? int(t.create_timestamp),
    paidAt: int(t.paid_timestamp),
    shippedAt: int(t.shipped_timestamp),
    expectedShipDate: int(t.expected_ship_date),
    shippingMethod: txt(t.shipping_method),
    shippingUpgrade: txt(t.shipping_upgrade)
  }
}

/** OAS ShopReceipt → Order. `items` replaces the receipt's own transactions when given. */
export function toOrder(r: Obj, items?: OrderItem[]): Order {
  const lines = items ?? arr(r.transactions).map(toItem)
  return {
    receiptId: int(r.receipt_id) ?? 0,
    status: str(r.status) ?? '',
    createdAt: int(r.created_timestamp) ?? int(r.create_timestamp),
    updatedAt: int(r.updated_timestamp) ?? int(r.update_timestamp),
    isPaid: r.is_paid === true,
    isShipped: r.is_shipped === true,
    isGift: r.is_gift === true,
    giftMessage: txt(r.gift_message),
    giftSender: txt(r.gift_sender),
    buyerName: txt(r.name),
    buyerEmail: str(r.buyer_email),
    address: {
      name: txt(r.name),
      firstLine: txt(r.first_line),
      secondLine: txt(r.second_line),
      city: txt(r.city),
      state: txt(r.state),
      zip: txt(r.zip),
      countryIso: str(r.country_iso),
      formatted: txt(r.formatted_address)
    },
    paymentMethod: str(r.payment_method),
    messageFromBuyer: txt(r.message_from_buyer),
    messageFromSeller: txt(r.message_from_seller),
    messageFromPayment: txt(r.message_from_payment),
    totals: {
      grandTotal: toMoney(r.grandtotal),
      subtotal: toMoney(r.subtotal),
      itemsTotal: toMoney(r.total_price),
      shipping: toMoney(r.total_shipping_cost),
      tax: toMoney(r.total_tax_cost),
      vat: toMoney(r.total_vat_cost),
      discount: toMoney(r.discount_amt),
      giftWrap: toMoney(r.gift_wrap_price)
    },
    items: lines,
    itemCount: lines.reduce((s, i) => s + i.quantity, 0),
    shipments: arr(r.shipments).map((s) => ({
      id: int(s.receipt_shipping_id),
      carrier: txt(s.carrier_name),
      trackingCode: str(s.tracking_code),
      notifiedAt: int(s.shipment_notification_timestamp)
    })),
    refunds: arr(r.refunds).map((f) => ({
      amount: toMoney(f.amount),
      createdAt: int(f.created_timestamp),
      reason: txt(f.reason),
      note: txt(f.note_from_issuer),
      status: str(f.status)
    }))
  }
}

function toAdjustmentItem(i: Obj, currency: string | null, shopCurrency: string | null): PaymentAdjustmentItem {
  return {
    id: int(i.payment_adjustment_item_id) ?? 0,
    type: str(i.adjustment_type),
    amount: minorUnits(i.amount, currency),
    shopAmount: minorUnits(i.shop_amount, shopCurrency),
    transactionId: int(i.transaction_id),
    createdAt: int(i.created_timestamp)
  }
}

/**
 * OAS PaymentAdjustment → PaymentAdjustment. Its amounts are bare integers
 * ("USD pennies unless otherwise specified"): the payment's currencies are
 * passed in (payment / shop / buyer).
 */
export function toAdjustment(
  a: Obj,
  cur: { currency: string | null; shop: string | null; buyer: string | null }
): PaymentAdjustment {
  return {
    id: int(a.payment_adjustment_id) ?? 0,
    status: str(a.status),
    isSuccess: a.is_success === true,
    reason: txt(a.reason_code),
    amount: minorUnits(a.total_adjustment_amount, cur.currency),
    shopAmount: minorUnits(a.shop_total_adjustment_amount, cur.shop),
    buyerAmount: minorUnits(a.buyer_total_adjustment_amount, cur.buyer),
    feeAmount: minorUnits(a.total_fee_adjustment_amount, cur.currency),
    createdAt: int(a.created_timestamp) ?? int(a.create_timestamp),
    items: arr(a.payment_adjustment_items).map((i) => toAdjustmentItem(i, cur.currency, cur.shop))
  }
}

/** OAS Payment → OrderPayment. */
export function toPayment(p: Obj): OrderPayment {
  const cur = { currency: str(p.currency), shop: str(p.shop_currency), buyer: str(p.buyer_currency) }
  return {
    paymentId: int(p.payment_id) ?? 0,
    receiptId: int(p.receipt_id),
    status: str(p.status),
    currency: cur.currency,
    shopCurrency: cur.shop,
    buyerCurrency: cur.buyer,
    gross: toMoney(p.amount_gross),
    fees: toMoney(p.amount_fees),
    net: toMoney(p.amount_net),
    postedGross: toMoney(p.posted_gross),
    postedFees: toMoney(p.posted_fees),
    postedNet: toMoney(p.posted_net),
    adjustedGross: toMoney(p.adjusted_gross),
    adjustedFees: toMoney(p.adjusted_fees),
    adjustedNet: toMoney(p.adjusted_net),
    createdAt: int(p.created_timestamp) ?? int(p.create_timestamp),
    updatedAt: int(p.updated_timestamp) ?? int(p.update_timestamp),
    shippedAt: int(p.shipped_timestamp),
    adjustments: arr(p.payment_adjustments).map((a) => toAdjustment(a, cur))
  }
}

/** OAS PaymentAccountLedgerEntry → LedgerEntry (amount / balance read as minor units of `currency`; the OAS gives no unit). */
export function toLedgerEntry(e: Obj): LedgerEntry {
  const currency = str(e.currency)
  const entryId = int(e.entry_id) ?? 0
  const parent = int(e.parent_entry_id)
  return {
    entryId,
    ledgerId: int(e.ledger_id),
    sequence: int(e.sequence_number),
    amount: minorUnits(e.amount, currency) ?? { amount: 0, divisor: minorDivisor(currency), currency: currency ?? '' },
    balance: minorUnits(e.balance, currency),
    description: txt(e.description) ?? '',
    type: txt(e.ledger_type) ?? '',
    referenceType: str(e.reference_type),
    referenceId: str(e.reference_id),
    parentEntryId: parent && parent !== entryId ? parent : null,
    createdAt: int(e.created_timestamp) ?? int(e.create_date),
    adjustments: arr(e.payment_adjustments).map((a) => toAdjustment(a, { currency, shop: currency, buyer: null }))
  }
}

/** Totals per (type, currency), largest count first (then by type). */
export function ledgerTotals(entries: LedgerEntry[]): LedgerTotal[] {
  const by = new Map<string, LedgerTotal>()
  for (const e of entries) {
    const type = e.type || e.description || '—'
    const key = `${type}\u0000${e.amount.currency}`
    const t = by.get(key)
    by.set(key, t ? { ...t, count: t.count + 1, sum: addMoney(t.sum, e.amount) } : { type, count: 1, sum: e.amount })
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
}
