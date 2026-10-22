import type { Listing } from '@shared/types'
import { formatPrice } from '@shared/format'

export function ListingCard({
  listing,
  isNew,
  onOpen
}: {
  listing: Listing
  isNew?: boolean
  onOpen: (l: Listing) => void
}): JSX.Element {
  const img = listing.images[0]
  const thumb = img?.url570 || img?.url170 || img?.url75
  return (
    <button
      className={`listing-card${isNew ? ' is-new' : ''}`}
      onClick={() => onOpen(listing)}
      data-testid="listing-card"
    >
      <div className="thumb">
        {thumb ? (
          <img src={thumb} alt={img?.alt ?? ''} loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="no-img">без фото</span>
        )}
        {isNew && <span className="badge-new">NEW</span>}
      </div>
      <div className="card-body">
        <div className="card-title">{listing.title}</div>
        <div className="card-price">
          {formatPrice(listing.priceAmount, listing.priceDivisor, listing.currency)}
        </div>
      </div>
    </button>
  )
}
