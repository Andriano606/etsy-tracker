import type { Listing } from '@shared/types'
import { priceValue } from '@shared/format'
import type { SortMode } from './store'

/** Search by title/tags (case-insensitive) and sort. Pure, for the grid. */
export function filterListings(listings: Listing[], search: string, sort: SortMode): Listing[] {
  const q = search.trim().toLowerCase()
  const hit = q
    ? listings.filter(
        (l) => l.title.toLowerCase().includes(q) || l.tags.some((t) => t.toLowerCase().includes(q))
      )
    : [...listings]
  const price = (l: Listing): number => priceValue(l.priceAmount, l.priceDivisor)
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
