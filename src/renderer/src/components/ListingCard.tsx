import type { Listing } from '@shared/types'
import { formatCount, formatPrice, formatRating, formatReviewCount } from '@shared/format'
import { buyerPriceIncludes, discountLabel, formatMoney, hasActiveDiscount, shownPrice } from '@shared/price'
import { imageSrc } from '../imageUrl'
import { NowPrice, WasPrice } from './PriceParts'

/** ⭐ average (count) of the stored reviews + "+N" new since the previous scan. */
export function ReviewBadge({ listing }: { listing: Listing }): JSX.Element | null {
  const { reviewCount, reviewAvg, reviewsNew, reviewsPartial } = listing
  if (reviewCount == null || reviewCount === 0) return null
  return (
    <span
      className="reviews"
      data-testid="card-reviews"
      title={
        reviewsPartial
          ? 'Відгуки (історія магазину ще завантажується — щонайменше стільки)'
          : 'Відгуки покупців: середня оцінка (кількість)'
      }
    >
      ⭐ {formatRating(reviewAvg)} ({formatReviewCount(reviewCount, reviewsPartial)})
      {reviewsNew != null && reviewsNew > 0 && (
        <span className="delta up" title="Нові відгуки з минулого сканування">
          {' '}+{formatCount(reviewsNew)}
        </span>
      )}
    </span>
  )
}

/** The seller's own price: no VAT, no promotion (ShopListing.price). */
export const basePriceText = (l: Listing): string => formatPrice(l.priceAmount, l.priceDivisor, l.currency)

/** Tooltip of a buyer price: for which country, what it includes (`buyerPriceIncludes`), and the seller's base price. */
export function buyerPriceTitle(l: Listing): string {
  const bp = l.buyerPrice
  if (!bp) return 'Базова ціна продавця (без ПДВ і без знижок) — ціна для покупця невідома'
  return `Ціна для покупця з ${bp.country}: ${buyerPriceIncludes(bp, hasActiveDiscount(bp))}. Базова ціна продавця: ${basePriceText(l)}`
}

/**
 * The price like the shop page shows it to a buyer in `buyerPrice.country`:
 * the sale price bold + the original struck through + "−60%" while a
 * promotion runs; else the VAT-inclusive price; the seller's base price when
 * no buyer price is known. A small country code says whose price it is.
 */
export function PriceTag({ listing }: { listing: Listing }): JSX.Element {
  const p = shownPrice(listing)
  const bp = listing.buyerPrice
  const main = formatPrice(p.amount, p.divisor, p.currency)
  return (
    <div className="card-price" data-testid="card-price" data-kind={p.kind} title={buyerPriceTitle(listing)}>
      {p.kind === 'discounted' ? <NowPrice>{main}</NowPrice> : <span>{main}</span>}
      {p.kind === 'discounted' && bp?.original && (
        <WasPrice testId="price-was">{formatMoney(bp.original, bp.currency)}</WasPrice>
      )}
      {bp && (
        // Badge + country code wrap as one unit (a narrow card never leaves
        // the code or the badge alone on a line); the code stays right-aligned.
        <span className="price-tags">
          {p.kind === 'discounted' && (
            <span className="badge-discount" data-testid="discount-badge">
              {discountLabel(bp)}
            </span>
          )}
          <span className="price-country" aria-hidden="true">
            {bp.country}
          </span>
          <span className="sr-only"> (ціна для покупця з {bp.country})</span>
        </span>
      )}
    </div>
  )
}

/** ❤ favorers (+growth since the previous scan), 👁 views, ★ featured rank, ⭐ reviews. */
export function PopularityBadges({ listing }: { listing: Listing }): JSX.Element | null {
  const { numFavorers, views, featuredRank, favorersDelta } = listing
  const hasReviews = (listing.reviewCount ?? 0) > 0
  if (numFavorers == null && views == null && !(featuredRank != null && featuredRank > 0) && !hasReviews) {
    return null
  }
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
      <ReviewBadge listing={listing} />
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
        <PriceTag listing={listing} />
        <PopularityBadges listing={listing} />
      </div>
    </button>
  )
}
