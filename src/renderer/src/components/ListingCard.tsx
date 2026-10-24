import type { ReactNode } from 'react'
import type { Listing } from '@shared/types'
import { formatCount, formatPrice, formatRating, formatReviewCount } from '@shared/format'
import { GLOSSARY, type GlossaryKey } from '@shared/glossary'
import { buyerPriceIncludes, discountLabel, formatMoney, hasActiveDiscount, shownPrice } from '@shared/price'
import { imageSrc } from '../imageUrl'
import { Icon, Tooltip, type IconName } from '../ui'
import { NowPrice, WasPrice } from './PriceParts'

/** A tooltip body: the glossary term in bold, its short text and an optional extra line. */
function tipOf(key: GlossaryKey, extra?: ReactNode): JSX.Element {
  const e = GLOSSARY[key]
  return (
    <>
      <div className="ui-tip-term">{e.term}</div>
      <div className="ui-tip-short">{e.short}</div>
      {extra && <div className="card-tip-extra">{extra}</div>}
    </>
  )
}

/**
 * One number on a card (❤ 87 +5): an icon, the value and a hover tooltip.
 * The card itself is the button, so the tip is hover-only (describe = false —
 * nothing focusable inside a button); screen readers get the sr-only words.
 */
function CardStat({
  icon,
  tip,
  testId,
  className,
  children
}: {
  icon: IconName
  tip: ReactNode
  testId?: string
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <Tooltip content={tip} describe={false}>
      <span className={'card-stat' + (className ? ' ' + className : '')} data-testid={testId}>
        <Icon name={icon} size={13} />
        {children}
      </span>
    </Tooltip>
  )
}

/** ⭐ average (count) of the stored reviews + "+N" new since the previous scan. */
export function ReviewBadge({ listing }: { listing: Listing }): JSX.Element | null {
  const { reviewCount, reviewAvg, reviewsNew, reviewsPartial } = listing
  if (reviewCount == null || reviewCount === 0) return null
  const fresh = reviewsNew != null && reviewsNew > 0
  return (
    <CardStat
      icon="star"
      className="reviews"
      testId="card-reviews"
      tip={tipOf(
        'reviews',
        <>
          Середня оцінка {formatRating(reviewAvg)} з 5, відгуків: {formatReviewCount(reviewCount, reviewsPartial)}.
          {reviewsPartial && ' Історія відгуків ще завантажується — їх щонайменше стільки.'}
          {fresh && ` Нових з минулого сканування: +${formatCount(reviewsNew)}.`}
        </>
      )}
    >
      <span className="sr-only">Оцінка </span>
      {formatRating(reviewAvg)}
      <span className="card-stat-sub">
        {' '}
        ({formatReviewCount(reviewCount, reviewsPartial)})
      </span>
      <span className="sr-only"> відгуків</span>
      {fresh && <span className="delta up"> +{formatCount(reviewsNew)}</span>}
    </CardStat>
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
 * The price row's tooltip: whose price it is and what it includes, the seller's
 * base price, and what the "−60%" badge and the country code mean (glossary).
 */
function priceTip(l: Listing, discounted: boolean): JSX.Element {
  const bp = l.buyerPrice
  return (
    <>
      <div className="ui-tip-term">{bp ? `Ціна для покупця з ${bp.country}` : GLOSSARY.basePrice.term}</div>
      <div className="ui-tip-short">{buyerPriceTitle(l)}.</div>
      {bp && discounted && (
        <div className="card-tip-extra">
          <b>{discountLabel(bp)}</b> — {GLOSSARY['shop.discountBadge'].short}
        </div>
      )}
      {bp ? (
        <div className="card-tip-extra">
          <b>{bp.country}</b> — {GLOSSARY['shop.priceCountry'].short}
        </div>
      ) : (
        <div className="card-tip-extra">{GLOSSARY.basePrice.short}</div>
      )}
    </>
  )
}

/**
 * The price like the shop page shows it to a buyer in `buyerPrice.country`:
 * the sale price bold + the original struck through + "−60%" while a
 * promotion runs; else the VAT-inclusive price; the seller's base price when
 * no buyer price is known (marked "без ПДВ"). A small country code says whose
 * price it is.
 */
export function PriceTag({ listing }: { listing: Listing }): JSX.Element {
  const p = shownPrice(listing)
  const bp = listing.buyerPrice
  const main = formatPrice(p.amount, p.divisor, p.currency)
  // A hover tooltip (not a native title): the card is the button, so nothing inside may be focusable.
  return (
    <Tooltip content={priceTip(listing, p.kind === 'discounted')} describe={false}>
      <div className="card-price" data-testid="card-price" data-kind={p.kind}>
        {p.kind === 'discounted' ? <NowPrice>{main}</NowPrice> : <span className="price-main">{main}</span>}
        {p.kind === 'discounted' && bp?.original && (
          <WasPrice testId="price-was">{formatMoney(bp.original, bp.currency)}</WasPrice>
        )}
        {bp ? (
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
        ) : (
          <span className="price-tags">
            <span className="price-basis">без ПДВ</span>
          </span>
        )}
      </div>
    </Tooltip>
  )
}

/** ❤ favorers (+growth since the previous scan), 👁 views, featured rank, ⭐ reviews — each with a tooltip. */
export function PopularityBadges({ listing }: { listing: Listing }): JSX.Element | null {
  const { numFavorers, views, featuredRank, favorersDelta } = listing
  const hasReviews = (listing.reviewCount ?? 0) > 0
  const featured = featuredRank != null && featuredRank > 0
  if (numFavorers == null && views == null && !featured && !hasReviews) return null
  const grew = favorersDelta != null && favorersDelta > 0
  return (
    <div className="card-stats" data-testid="card-stats">
      {numFavorers != null && (
        <CardStat
          icon="heart"
          testId="card-favorites"
          tip={tipOf('favorites', grew ? `+${formatCount(favorersDelta)} з минулого сканування.` : undefined)}
        >
          {formatCount(numFavorers)}
          <span className="sr-only"> в обраному</span>
          {grew && <span className="delta up"> +{formatCount(favorersDelta)}</span>}
        </CardStat>
      )}
      {views != null && (
        <CardStat icon="eye" testId="card-views" tip={tipOf('views')}>
          {formatCount(views)}
          <span className="sr-only"> переглядів</span>
        </CardStat>
      )}
      {featured && (
        <CardStat icon="store" className="featured" testId="card-featured" tip={tipOf('featuredRank')}>
          <span className="sr-only">Вибране продавцем, місце </span>№{featuredRank}
        </CardStat>
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
          <span className="no-img">
            <Icon name="image" size={22} />
            без фото
          </span>
        )}
        {isNew && (
          <Tooltip content={tipOf('listingNew')} describe={false}>
            <span className="badge-new">Новий</span>
          </Tooltip>
        )}
      </div>
      <div className="card-body">
        <div className="card-title" title={listing.title}>
          {listing.title}
        </div>
        <PriceTag listing={listing} />
        <PopularityBadges listing={listing} />
      </div>
    </button>
  )
}
