import type { ReactNode } from 'react'
import type { Listing, Promotion, Review, ScanChange, ScanPromotions, ShopSummary } from '@shared/types'
import { formatCount, formatDateTime, formatEtsyDate, formatPromoPeriod, ratingStars, textExcerpt } from '@shared/format'
import { GLOSSARY } from '@shared/glossary'
import { photoRef, reviewPhotoRef } from '@shared/claudeRef'
import { formatMoney } from '@shared/price'
import { imageSrc, reviewImageSrc } from '../imageUrl'
import { Callout, Icon, InfoTip, ZoomButton, ZoomImage, type IconName } from '../ui'
import { ChangeRows, KIND_LABEL, changedSummary, countOf } from './ChangeList'
import { ListingCard } from './ListingCard'
import { WasPrice } from './PriceParts'
import { KIND_DESC } from './ScanHistory'

/**
 * A collapsible group of the scan results: a chevron, "Label: N" (+ extra),
 * a plain-words line saying what the group means, and the content.
 */
export function ResultsGroup({
  icon,
  label,
  desc,
  open,
  className,
  testId,
  children
}: {
  icon: IconName
  label: ReactNode
  desc: ReactNode
  open?: boolean
  className?: string
  testId?: string
  children: ReactNode
}): JSX.Element {
  return (
    <details className={'results-group' + (className ? ' ' + className : '')} open={open} data-testid={testId}>
      <summary className="group-summary">
        <Icon name="chevron-right" size={16} className="group-chevron" />
        <span className="group-icon" aria-hidden="true">
          <Icon name={icon} size={15} />
        </span>
        <span className="group-main">
          <span className="group-label">{label}</span>
          <span className="group-desc">{desc}</span>
        </span>
      </summary>
      <div className="group-body">{children}</div>
    </details>
  )
}

/**
 * A listing thumbnail + title button (a review's or a promotion's listing). The
 * thumbnail carries a magnifier overlay — a sibling of the button, never inside
 * it — that opens the photo full size; the rest of the button opens the listing.
 */
function ListingLink({
  listingId,
  title,
  imageId,
  onOpen
}: {
  listingId: number
  title: string | null | undefined
  imageId: number | null | undefined
  onOpen: (listingId: number) => void
}): JSX.Element {
  const name = title ?? `Товар ${listingId}`
  return (
    <span className="review-listing-host ui-zoom-host">
      <button className="review-listing" onClick={() => onOpen(listingId)} title={name}>
        {imageId != null ? (
          <img src={imageSrc({ id: imageId }, '75x75')} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="no-img">—</span>
        )}
        <span className="review-listing-title">{name}</span>
      </button>
      {imageId != null && (
        <ZoomButton
          images={{ src: imageSrc({ id: imageId }, 'fullxfull'), alt: name, caption: name, ref: photoRef(listingId, imageId) }}
          label={`Відкрити фото на весь розмір: ${name}`}
          className="ui-zoom-corner thumb-zoom"
        />
      )}
    </span>
  )
}

/** "(показано 200 з 430)" when main capped the list. */
function shownOf(shown: number, all: number): JSX.Element | null {
  if (all <= shown) return null
  return (
    <span className="dim">
      {' '}
      (показано {formatCount(shown)} з {formatCount(all)})
    </span>
  )
}

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
    <ResultsGroup
      icon="review"
      className="new-reviews"
      testId="new-reviews"
      open
      label={
        <>
          Нові відгуки: {formatCount(all)}
          {shownOf(reviews.length, all)}
        </>
      }
      desc={GLOSSARY.newReviews.short}
    >
      <ul className="review-list">
        {reviews.map((r) => (
          <li key={r.id} className="review-item">
            {r.listingId != null && (
              <ListingLink listingId={r.listingId} title={r.listingTitle} imageId={r.listingImageId} onOpen={onOpenListing} />
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
                <ZoomImage
                  className="review-photo-zoom"
                  imgClassName="review-photo"
                  src={reviewImageSrc(r)}
                  alt="Фото покупця"
                  caption={`Фото покупця · ${formatEtsyDate(r.createdAt)}`}
                  claudeRef={reviewPhotoRef(r.id)}
                  loading="lazy"
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </ResultsGroup>
  )
}

function PromotionRow({ p, onOpenListing }: { p: Promotion; onOpenListing: (id: number) => void }): JSX.Element {
  const pct =
    p.discountPercentage != null
      ? `−${p.discountPercentage}%`
      : p.discountAmount
        ? `−${formatMoney(p.discountAmount, p.currency ?? '')}`
        : 'знижка'
  const period = formatPromoPeriod(p.discountStart, p.discountEnd)
  return (
    <li className="promo-item">
      <ListingLink listingId={p.listingId} title={p.listingTitle} imageId={p.listingImageId} onOpen={onOpenListing} />
      <span className="promo-terms">
        <span className="badge-discount">{pct}</span>{' '}
        <span className="promo-price">{formatMoney(p.discounted, p.currency ?? '')}</span>
        {p.original && <WasPrice>{formatMoney(p.original, p.currency ?? '')}</WasPrice>}
        {period && <span className="dim"> · {period}</span>}
        <span className="dim" title={`Ціни для покупця з ${p.country}`}>
          {' '}
          · {p.country}
        </span>
      </span>
    </li>
  )
}

/**
 * "Акції: почалися N, закінчилися M" — promotions this scan saw start or end
 * (never ones only explained by a buyer-country switch, nor ones already
 * running at the first observation). The lists are capped by main (200 each,
 * `listScanPromotions`); N/M are the scan's real counts
 * (`ScanSummary.promotionsStarted/Ended`) when known.
 */
export function PromotionsGroup({
  promotions,
  startedCount,
  endedCount,
  onOpenListing
}: {
  promotions?: ScanPromotions
  startedCount?: number | null
  endedCount?: number | null
  onOpenListing: (listingId: number) => void
}): JSX.Element | null {
  const started = promotions?.started ?? []
  const ended = promotions?.ended ?? []
  const nStarted = Math.max(startedCount ?? 0, started.length)
  const nEnded = Math.max(endedCount ?? 0, ended.length)
  if (!nStarted && !nEnded) return null
  const parts = [
    nStarted ? `почалися ${formatCount(nStarted)}` : '',
    nEnded ? `закінчилися ${formatCount(nEnded)}` : ''
  ].filter(Boolean)
  return (
    <ResultsGroup
      icon="percent"
      className="promotions"
      testId="scan-promotions"
      label={`Акції: ${parts.join(', ')}`}
      desc="Продавець почав або закінчив знижки на ці товари. Ціни — для покупця з вибраної країни."
    >
      {started.length > 0 && (
        <>
          <h4>Почалися{shownOf(started.length, nStarted)}</h4>
          <ul className="review-list" data-testid="promotions-started">
            {started.map((p) => (
              <PromotionRow key={p.id} p={p} onOpenListing={onOpenListing} />
            ))}
          </ul>
        </>
      )}
      {ended.length > 0 && (
        <>
          <h4>Закінчилися{shownOf(ended.length, nEnded)}</h4>
          <ul className="review-list" data-testid="promotions-ended">
            {ended.map((p) => (
              <PromotionRow key={p.id} p={p} onOpenListing={onOpenListing} />
            ))}
          </ul>
        </>
      )}
    </ResultsGroup>
  )
}

const KIND_ICON: Record<ScanChange['kind'], IconName> = {
  added: 'sparkle',
  returned: 'arrow-up',
  removed: 'minus',
  changed: 'edit'
}

/** The latest successful scan's outcome: new listings first, the rest collapsible. */
export function ScanResults({
  shop,
  changes,
  newReviews = [],
  promotions,
  onOpen
}: {
  shop: ShopSummary
  changes: ScanChange[]
  newReviews?: Review[]
  promotions?: ScanPromotions
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
      <section className="results baseline" data-testid="scan-results" aria-label="Результат сканування">
        <div className="results-head">
          <h2 className="results-title">
            <Icon name="check" size={18} />
            <span>Базове сканування: збережено {countOf(scan.total, 'товар', 'товари', 'товарів')}</span>
          </h2>
          <InfoTip glossary="baseline" />
          <span className="results-when num">{formatDateTime(scan.finishedAt)}</span>
        </div>
        <p className="results-note">
          Це перше сканування магазину — програма лише запам’ятала всі його товари. Натисніть «Сканувати
          повторно» пізніше, і тут з’явиться, що додалося, зникло чи змінилось.
        </p>
        {reviewsGroup}
      </section>
    )
  }

  const of = (kind: ScanChange['kind']): ScanChange[] => changes.filter((c) => c.kind === kind)
  const added = of('added')
  const openChange = (c: ScanChange): void => {
    if (c.listing) onOpen(c.listing)
  }
  const groups = (['returned', 'removed', 'changed'] as const).filter((k) => of(k).length > 0)

  return (
    <section className="results" data-testid="scan-results" aria-labelledby="scan-results-title">
      <div className="results-head">
        <h2 className="results-title" id="scan-results-title">
          Що змінилось з минулого сканування
        </h2>
        <InfoTip glossary="shop.whatsNew" />
        <span className="results-when num" title="Коли закінчилось останнє успішне сканування">
          {formatDateTime(scan.finishedAt)}
        </span>
      </div>

      <div className="results-new">
        <div className="head-row results-sub-row">
          <h3 className="results-sub">
            <Icon name="sparkle" size={15} />
            <span>Нові товари: </span>
            <span className="results-count">{scan.added}</span>
          </h3>
          <InfoTip glossary="listingNew" />
        </div>
        {added.length > 0 ? (
          <div className="grid new-grid">
            {added.map(
              (c) => c.listing && <ListingCard key={c.id} listing={c.listing} isNew onOpen={onOpen} />
            )}
          </div>
        ) : (
          <p className="results-empty">Нових товарів немає.</p>
        )}
      </div>

      {scan.truncated && (
        <Callout tone="warn" compact>
          У магазині більше товарів, ніж Etsy дозволяє прочитати (≈12 100), тому зниклі товари не визначалися.
        </Callout>
      )}

      {groups.map((kind) => {
        const list = of(kind)
        const summary = kind === 'changed' ? changedSummary(list) : ''
        return (
          <ResultsGroup
            key={kind}
            icon={KIND_ICON[kind]}
            className={`kind-${kind}`}
            label={
              <>
                {KIND_LABEL[kind]}: {list.length}
                {summary && (
                  <span className="dim" data-testid="changed-summary">
                    {' '}
                    ({summary})
                  </span>
                )}
              </>
            }
            desc={KIND_DESC[kind]}
          >
            <ChangeRows changes={list} onOpen={openChange} />
          </ResultsGroup>
        )
      })}
      <PromotionsGroup
        promotions={promotions}
        startedCount={scan.promotionsStarted}
        endedCount={scan.promotionsEnded}
        onOpenListing={openById}
      />
      {reviewsGroup}
    </section>
  )
}
