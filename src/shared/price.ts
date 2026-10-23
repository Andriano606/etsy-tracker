// Which price the UI shows (and sorts by) for a listing: the buyer-facing one
// when Etsy gave it (what the shop page shows a buyer in that country), else
// the seller's base price.

import type { BuyerPrice, Listing, MoneyValue } from './types'
import { formatPrice, priceValue } from './format'

export type ShownPriceKind =
  /** An active promotion: the sale price (discounted_price). */
  | 'discounted'
  /** Buyer price without a promotion (original_price, VAT included). */
  | 'buyer'
  /** No buyer price known: the seller's base price (no VAT, no promotion). */
  | 'base'

export interface ShownPrice extends MoneyValue {
  currency: string
  kind: ShownPriceKind
}

type PriceOf = Pick<Listing, 'priceAmount' | 'priceDivisor' | 'currency' | 'buyerPrice'>

/** The listing's active discount: the buyer price has one with a sale price. */
export function hasActiveDiscount(bp: BuyerPrice | null | undefined): boolean {
  return !!bp && bp.hasDiscount && bp.discounted != null
}

/**
 * The price a buyer in `buyerPrice.country` sees on Etsy: discounted when a
 * promotion is active, else original_price; the seller's base price when no
 * buyer price is known.
 */
export function shownPrice(l: PriceOf): ShownPrice {
  const bp = l.buyerPrice
  if (bp && hasActiveDiscount(bp)) return { ...bp.discounted!, currency: bp.currency, kind: 'discounted' }
  if (bp?.original) return { ...bp.original, currency: bp.currency, kind: 'buyer' }
  return { amount: l.priceAmount, divisor: l.priceDivisor, currency: l.currency, kind: 'base' }
}

/** shownPrice as a number (for sorting). */
export function shownPriceValue(l: PriceOf): number {
  const p = shownPrice(l)
  return priceValue(p.amount, p.divisor)
}

export function formatMoney(m: MoneyValue | null | undefined, currency: string): string {
  return m ? formatPrice(m.amount, m.divisor, currency) : '—'
}

/**
 * The discount in percent: Etsy's discount_percentage, else (a fixed-amount
 * promotion) derived from discount_amount / original_price; null without one.
 */
export function discountPercent(bp: BuyerPrice | null | undefined): number | null {
  if (!bp || !hasActiveDiscount(bp)) return null
  if (bp.discountPercentage != null) return bp.discountPercentage
  const orig = bp.original ? priceValue(bp.original.amount, bp.original.divisor) : 0
  const cut = bp.discountAmount
    ? priceValue(bp.discountAmount.amount, bp.discountAmount.divisor)
    : orig - priceValue(bp.discounted!.amount, bp.discounted!.divisor)
  return orig > 0 && cut > 0 ? Math.round((cut / orig) * 100) : null
}

/** "−60%", or "−1,80 $" for a fixed-amount discount; '' without one. */
export function discountLabel(bp: BuyerPrice | null | undefined): string {
  if (!bp || !hasActiveDiscount(bp)) return ''
  if (bp.discountPercentage != null) return `−${bp.discountPercentage}%`
  if (bp.discountAmount) return `−${formatMoney(bp.discountAmount, bp.currency)}`
  const pct = discountPercent(bp)
  return pct != null ? `−${pct}%` : ''
}

/**
 * What a buyer price includes on top of the seller's base price, for the card
 * tooltip and the listing modal: VAT where the buyer's country has one (Etsy's
 * base_price is "VAT incl.", which is no VAT for e.g. US), shipping for UK
 * buyers (OAS: original_price = base + shipping for GB, DMCC), and the
 * discount when `withDiscount`. "з ПДВ (якщо він є в цій країні), доставкою і знижкою".
 */
export function buyerPriceIncludes(bp: Pick<BuyerPrice, 'country'>, withDiscount = false): string {
  const parts = ['з ПДВ (якщо він є в цій країні)']
  if (bp.country === 'GB') parts.push('доставкою')
  if (withDiscount) parts.push('знижкою')
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} і ${parts.at(-1)}`
}
