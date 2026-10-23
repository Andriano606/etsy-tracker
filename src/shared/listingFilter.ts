// Shared by the renderer's grid and the MCP server's product search (main), so
// relative imports only (main has no @shared alias).
import type { Listing } from './types'
import { discountPercent, hasActiveDiscount, shownPriceValue } from './price'

export type SortMode =
  | 'newest'
  | 'price-asc'
  | 'price-desc'
  /** Most favorited first. */
  | 'favorites'
  /** Most viewed first. */
  | 'views'
  /** Biggest favorers growth since the previous successful scan first. */
  | 'favorites-growth'
  /** Most reviews (stored) first. */
  | 'reviews'
  /** Most new reviews since the previous successful scan first. */
  | 'reviews-growth'
  /** Biggest active discount (buyer price) first. */
  | 'discount'

export interface FilterOptions {
  /** "Зі знижкою": only listings whose buyer price has an active discount. */
  discountOnly?: boolean
  /** Search the description too (the MCP product search; the grid searches title/tags). */
  searchDescription?: boolean
}

/**
 * Search by title/tags (case-insensitive), filter and sort. Pure, for the grid.
 * Price sorts use the price the card shows (`shownPrice`: the buyer's sale or
 * VAT-inclusive price when known, else the seller's base price), so the order
 * matches what the user reads.
 */
export function filterListings(
  listings: Listing[],
  search: string,
  sort: SortMode,
  opts: FilterOptions = {}
): Listing[] {
  const q = search.trim().toLowerCase()
  let hit = q
    ? listings.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          l.tags.some((t) => t.toLowerCase().includes(q)) ||
          (!!opts.searchDescription && l.description.toLowerCase().includes(q))
      )
    : [...listings]
  if (opts.discountOnly) hit = hit.filter((l) => hasActiveDiscount(l.buyerPrice))
  const price = (l: Listing): number => shownPriceValue(l)
  // Unknown popularity (null) sorts last; ties fall back to the newest listing.
  const num = (v: number | null | undefined): number => (v == null ? -Infinity : v)
  const byNum = (f: (l: Listing) => number | null | undefined) => (a: Listing, b: Listing) =>
    num(f(b)) - num(f(a)) || b.listingId - a.listingId
  switch (sort) {
    case 'favorites':
      return hit.sort(byNum((l) => l.numFavorers))
    case 'views':
      return hit.sort(byNum((l) => l.views))
    case 'favorites-growth':
      return hit.sort(byNum((l) => l.favorersDelta))
    case 'reviews':
      return hit.sort(byNum((l) => l.reviewCount))
    case 'reviews-growth':
      return hit.sort(byNum((l) => l.reviewsNew))
    case 'discount':
      // No discount (or no buyer price) last.
      return hit.sort(byNum((l) => discountPercent(l.buyerPrice)))
    case 'price-asc':
      return hit.sort((a, b) => price(a) - price(b) || b.listingId - a.listingId)
    case 'price-desc':
      return hit.sort((a, b) => price(b) - price(a) || b.listingId - a.listingId)
    default:
      return hit.sort(
        (a, b) => (b.etsyCreatedAt ?? 0) - (a.etsyCreatedAt ?? 0) || b.listingId - a.listingId
      )
  }
}
