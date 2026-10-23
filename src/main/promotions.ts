// Promotion (sale) tracking across scans, from the buyer prices each scan
// learns (ListingBuyerPrice.has_discount / discount_* fields). Pure decision
// logic here; db.ts stores the rows, scanner.ts applies them in the scan
// transaction.
//
// Buyer prices move with promotions and with the buyer country (VAT), so they
// are never a listing content "change" (scan_changes) — they are recorded per
// scan in listing_price_stats, and promotions get their own rows.

import type { BuyerPrice, Promotion, PromotionEndReason, PromotionStartKind } from '../shared/types'

export interface PromotionStep {
  /** End the running promotion with this reason. */
  end?: PromotionEndReason
  /** Start a new promotion of this kind (after `end`, if both). */
  start?: PromotionStartKind
  /** The running promotion continues: refresh its terms and last-seen. */
  continue?: boolean
}

/**
 * Same promotion? Etsy gives no promotion id, so: the same start epoch and
 * percentage when both have a start (a seller extending the end date is still
 * the same sale; a new percentage is a new one, so the history keeps the terms
 * each had), else the same percentage and end epoch.
 */
export function samePromotion(open: Pick<Promotion, 'discountStart' | 'discountEnd' | 'discountPercentage'>, bp: BuyerPrice): boolean {
  if (open.discountStart != null && bp.discountStart != null) {
    return (
      open.discountStart === bp.discountStart &&
      (open.discountPercentage ?? null) === (bp.discountPercentage ?? null)
    )
  }
  return (
    (open.discountPercentage ?? null) === (bp.discountPercentage ?? null) &&
    (open.discountEnd ?? null) === (bp.discountEnd ?? null)
  )
}

/**
 * What one scan's observation means for a listing's promotion.
 *
 * - `bp` = this scan's buyer price; null/undefined (unknown this scan) → nothing
 *   (a running promotion stays open until a scan that knows says otherwise).
 * - `prev` = the buyer price stored before this scan (the previous observation;
 *   null = none — a new listing, the first v4 scan, or one Etsy refused).
 * - `open` = the running promotion row, if any.
 *
 * Country switch: when the previous observation was for another buyer
 * country, a start/end coinciding with the switch is recorded as 'country'
 * (not reported as started/ended — the discount may be country-specific
 * rather than the seller's doing), while a promotion with the
 * same terms simply continues under the new country (its % and dates don't
 * depend on the country; only the VAT-inclusive prices do).
 * No previous observation (`prev` null — baseline, first scan with buyer
 * prices, the price was unknown in between — or `isNew`: a new or returned
 * listing): a discount is 'running' (we don't know when it began), and a
 * running promotion that is gone or different now ended at an unknown time in
 * between ('unknown') — neither is reported.
 */
export function promotionStep(
  open: Pick<Promotion, 'country' | 'discountStart' | 'discountEnd' | 'discountPercentage'> | null,
  prev: BuyerPrice | null | undefined,
  bp: BuyerPrice | null | undefined,
  opts: { isNew?: boolean } = {}
): PromotionStep {
  if (!bp) return {}
  const blind = !prev || !!opts.isNew
  const switched = !!prev && prev.country !== bp.country
  const active = bp.hasDiscount
  if (open) {
    if (active && samePromotion(open, bp)) return { continue: true }
    if (blind) return active ? { end: 'unknown', start: 'running' } : { end: 'unknown' }
    const end: PromotionEndReason = switched ? 'country' : active ? 'replaced' : 'ended'
    return active ? { end, start: switched ? 'country' : 'seen' } : { end }
  }
  if (!active) return {}
  if (blind) return { start: 'running' }
  return { start: switched ? 'country' : 'seen' }
}

/** Does this step count for the scan's "Акції" totals? */
export const countsAsStart = (s: PromotionStep): boolean => s.start === 'seen'
export const countsAsEnd = (s: PromotionStep): boolean => s.end === 'ended' || s.end === 'replaced'
