import type { Listing } from '@shared/types'
import { formatCount, formatPrice } from '@shared/format'
import { imageSrc } from '../imageUrl'

/** ❤ favorers (+growth since the previous scan), 👁 views, ★ featured rank. */
export function PopularityBadges({ listing }: { listing: Listing }): JSX.Element | null {
  const { numFavorers, views, featuredRank, favorersDelta } = listing
  if (numFavorers == null && views == null && !(featuredRank != null && featuredRank > 0)) return null
  return (
    <div className="card-stats" data-testid="card-stats">
      {numFavorers != null && (
        <span title="Додали в обране">
          ❤ {formatCount(numFavorers)}
          {favorersDelta != null && favorersDelta > 0 && (
            <span className="delta up" title="Ріст з минулого сканування">
              {' '}+{formatCount(favorersDelta)}
            </span>
          )}
        </span>
      )}
      {views != null && <span title="Перегляди (Etsy рахує раз на добу)">👁 {formatCount(views)}</span>}
      {featuredRank != null && featuredRank > 0 && (
        <span className="featured" title="Позиція серед рекомендованих товарів магазину">
          ★ {featuredRank}
        </span>
      )}
    </div>
  )
}

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
  return (
    <button
      className={`listing-card${isNew ? ' is-new' : ''}`}
      onClick={() => onOpen(listing)}
      data-testid="listing-card"
    >
      <div className="thumb">
        {img ? (
          <img src={imageSrc(img, '570xN')} alt={img.alt ?? ''} loading="lazy" referrerPolicy="no-referrer" />
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
        <PopularityBadges listing={listing} />
      </div>
    </button>
  )
}
