import type { Listing, Review, ScanChange, ShopSummary } from '@shared/types'
import { formatCount, formatEtsyDate, ratingStars, textExcerpt } from '@shared/format'
import { imageSrc, reviewImageSrc } from '../imageUrl'
import { ChangeRows, KIND_LABEL, changedSummary } from './ChangeList'
import { ListingCard } from './ListingCard'

/**
 * "Нові відгуки: N" — reviews first seen as new (never backfilled ones) by this
 * scan's sync. `reviews` is capped (main sends at most 200); `total` is the real
 * count (`ShopSummary.reviews.newCount`).
 */
export function NewReviews({
  reviews,
  total,
  onOpenListing
}: {
  reviews: Review[]
  total?: number | null
  onOpenListing: (listingId: number) => void
}): JSX.Element | null {
  if (!reviews.length) return null
  const all = Math.max(total ?? 0, reviews.length)
  return (
    <details className="results-group new-reviews" open data-testid="new-reviews">
      <summary>
        Нові відгуки: {formatCount(all)}
        {all > reviews.length && (
          <span className="dim">
            {' '}
            (показано {formatCount(reviews.length)} з {formatCount(all)})
          </span>
        )}
      </summary>
      <ul className="review-list">
        {reviews.map((r) => (
          <li key={r.id} className="review-item">
            {r.listingId != null && (
              <button
                className="review-listing"
                onClick={() => onOpenListing(r.listingId!)}
                title={r.listingTitle ?? `Товар ${r.listingId}`}
              >
                {r.listingImageId != null ? (
                  <img src={imageSrc({ id: r.listingImageId }, '75x75')} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span className="no-img">—</span>
                )}
                <span className="review-listing-title">{r.listingTitle ?? `Товар ${r.listingId}`}</span>
              </button>
            )}
            <div className="review-body">
              <div className="review-head">
                <span className="stars" aria-label={`Оцінка ${r.rating ?? '—'} з 5`}>
                  {ratingStars(r.rating)}
                </span>
                <span className="dim"> {formatEtsyDate(r.createdAt)}</span>
              </div>
              {r.text && <div className="review-text">{textExcerpt(r.text)}</div>}
              {r.hasImage && (
                <img className="review-photo" src={reviewImageSrc(r)} alt="Фото покупця" loading="lazy" referrerPolicy="no-referrer" />
              )}
            </div>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** The latest successful scan's outcome: new listings first, the rest collapsible. */
export function ScanResults({
  shop,
  changes,
  newReviews = [],
  onOpen
}: {
  shop: ShopSummary
  changes: ScanChange[]
  newReviews?: Review[]
  onOpen: (l: Listing) => void
}): JSX.Element | null {
  const scan = shop.lastOkScan
  if (!scan) return null
  const openById = (listingId: number): void => {
    void window.api.getListing(listingId).then((l) => {
      if (l) onOpen(l)
    })
  }
  const reviewsGroup = (
    <NewReviews reviews={newReviews} total={shop.reviews?.newCount} onOpenListing={openById} />
  )

  if (scan.isBaseline) {
    return (
      <section className="results baseline" data-testid="scan-results">
        <div className="results-title">Базове сканування: збережено {scan.total} товарів</div>
        <div className="hint">
          Це перше сканування магазину — воно лише запам’ятовує поточні товари. Натисніть
          «Сканувати повторно» пізніше, щоб побачити, що додалося.
        </div>
        {reviewsGroup}
      </section>
    )
  }

  const of = (kind: ScanChange['kind']): ScanChange[] => changes.filter((c) => c.kind === kind)
  const added = of('added')
  const openChange = (c: ScanChange): void => {
    if (c.listing) onOpen(c.listing)
  }

  return (
    <section className="results" data-testid="scan-results">
      <div className="results-title">
        Нові з минулого сканування: <span className="results-count">{scan.added}</span>
      </div>
      {added.length > 0 ? (
        <div className="grid new-grid">
          {added.map(
            (c) =>
              c.listing && (
                <ListingCard key={c.id} listing={c.listing} isNew onOpen={onOpen} />
              )
          )}
        </div>
      ) : (
        <div className="hint">Нових товарів немає.</div>
      )}
      {scan.truncated && (
        <div className="hint warn">
          У магазині більше товарів, ніж Etsy дозволяє прочитати (≈12 100), тому зниклі товари
          не визначалися.
        </div>
      )}
      {(['returned', 'removed', 'changed'] as const).map((kind) => {
        const list = of(kind)
        if (!list.length) return null
        return (
          <details key={kind} className="results-group">
            <summary>
              {KIND_LABEL[kind]}: {list.length}
              {kind === 'changed' && changedSummary(list) && (
                <span className="dim" data-testid="changed-summary">
                  {' '}
                  ({changedSummary(list)})
                </span>
              )}
            </summary>
            <ChangeRows changes={list} onOpen={openChange} />
          </details>
        )
      })}
      {reviewsGroup}
    </section>
  )
}
