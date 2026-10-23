import { Fragment, useEffect, useState } from 'react'
import type { Listing, ListingDetails, ListingStatsPoint, Review } from '@shared/types'
import {
  formatCount,
  formatDateTime,
  formatDelta,
  formatEtsyDate,
  formatPrice,
  formatRating,
  formatReviewCount,
  ratingStars
} from '@shared/format'
import { LISTING_TYPE_LABEL, WHO_MADE_LABEL, whenMadeLabel } from '@shared/changes'
import { useStore } from '../store'
import { imageSrc, reviewImageSrc } from '../imageUrl'
import { ExternalLink } from './ExternalLink'
import { useEscape } from './useEscape'

const yesNo = (v: boolean | null | undefined): string | null => (v == null ? null : v ? 'так' : 'ні')

function dims(d: ListingDetails): string | null {
  const xs = [d.itemLength, d.itemWidth, d.itemHeight]
  if (xs.every((x) => x == null)) return null
  return `${xs.map((x) => x ?? '?').join(' × ')} ${d.itemDimensionsUnit ?? ''}`.trim()
}

/** label → value rows of the "Деталі" section; empty values are skipped. */
export function detailRows(l: Listing): Array<[string, string]> {
  const d = l.details
  const rows: Array<[string, string | null | undefined]> = [
    ['Стан', l.state],
    ['Матеріали', d?.materials.length ? d.materials.join(', ') : null],
    ['Стиль', d?.styles.length ? d.styles.join(', ') : null],
    ['Хто виготовив', d?.whoMade ? (WHO_MADE_LABEL[d.whoMade] ?? d.whoMade) : null],
    ['Коли виготовлено', whenMadeLabel(d?.whenMade)],
    ['Тип', d?.listingType ? (LISTING_TYPE_LABEL[d.listingType] ?? d.listingType) : null],
    [
      'Час виготовлення',
      d && (d.processingMin != null || d.processingMax != null)
        ? `${d.processingMin ?? '?'}–${d.processingMax ?? '?'} дн.`
        : null
    ],
    ['Вага', d?.itemWeight != null ? `${d.itemWeight} ${d.itemWeightUnit ?? ''}`.trim() : null],
    ['Розміри', d ? dims(d) : null],
    ['Персоналізація', yesNo(d?.isPersonalizable)],
    ['Індивідуальні замовлення', yesNo(d?.isCustomizable)],
    ['Варіанти', yesNo(d?.hasVariations)],
    ['Матеріал для рукоділля (supply)', yesNo(d?.isSupply)],
    ['Категорія (taxonomy_id)', d?.taxonomyId != null ? String(d.taxonomyId) : null],
    ['Розділ магазину', d?.shopSectionId != null ? String(d.shopSectionId) : null],
    ['Мова', d?.language],
    ['Автопродовження', yesNo(d?.shouldAutoRenew)],
    ['Вперше створено на Etsy', d?.originalCreatedAt != null ? formatEtsyDate(d.originalCreatedAt) : null],
    ['Закінчується', d?.endingAt != null ? formatEtsyDate(d.endingAt) : null],
    ['Профіль доставки', d?.shippingProfileId != null ? String(d.shippingProfileId) : null],
    ['Політика повернення', d?.returnPolicyId != null ? String(d.returnPolicyId) : null],
    ['SKU', d?.skus.length ? d.skus.join(', ') : null],
    ['Цифрові файли', d?.fileData || null],
    ['Відео', l.videos?.length ? String(l.videos.length) : null]
  ]
  return rows.filter((r): r is [string, string] => r[1] != null && r[1] !== '')
}

/** The stored API object, fetched from main only when the viewer is opened. */
function RawJson({ listingId }: { listingId: number }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    setOpen(false)
    setRaw(undefined)
  }, [listingId])
  useEffect(() => {
    if (!open || raw !== undefined) return
    let alive = true
    void window.api.getListingRaw(listingId).then((r) => {
      if (alive) setRaw(r)
    })
    return () => {
      alive = false
    }
  }, [open, raw, listingId])
  let pretty = raw ?? ''
  try {
    if (raw) pretty = JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    // show as is
  }
  return (
    <details className="raw-json" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Сирі дані API (JSON)</summary>
      {open && (
        <pre data-testid="raw-json">
          {raw === undefined ? 'Завантаження…' : raw === null ? 'Немає збережених даних.' : pretty}
        </pre>
      )}
    </details>
  )
}

/** Popularity per successful scan (`listing_stats`), loaded only when opened. */
function StatsHistory({ listingId }: { listingId: number }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [points, setPoints] = useState<ListingStatsPoint[] | undefined>(undefined)
  useEffect(() => {
    setOpen(false)
    setPoints(undefined)
  }, [listingId])
  useEffect(() => {
    if (!open || points !== undefined) return
    let alive = true
    void window.api.getListingStats(listingId).then((p) => {
      if (alive) setPoints(p)
    })
    return () => {
      alive = false
    }
  }, [open, points, listingId])
  const rows = points ? [...points].reverse() : []
  return (
    <details className="stats-details" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Історія популярності</summary>
      {open &&
        (points === undefined ? (
          <p className="hint">Завантаження…</p>
        ) : points.length === 0 ? (
          <p className="hint">Ще немає даних — вони з’являються після кожного сканування.</p>
        ) : (
          <table className="stats-history" data-testid="stats-history">
            <thead>
              <tr>
                <th>Сканування</th>
                <th>❤ обране</th>
                <th>👁 перегляди</th>
                <th>★ ранг</th>
                <th>К-сть</th>
                <th>⭐ відгуки</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.scanId}>
                  <td>{p.at != null ? formatDateTime(p.at) : `#${p.scanId}`}</td>
                  <td>{p.numFavorers != null ? formatCount(p.numFavorers) : '—'}</td>
                  <td>{p.views != null ? formatCount(p.views) : '—'}</td>
                  <td>{p.featuredRank != null && p.featuredRank >= 1 ? p.featuredRank : '—'}</td>
                  <td>{p.quantity ?? '—'}</td>
                  <td>
                    {p.reviewCount != null
                      ? `${formatReviewCount(p.reviewCount, p.reviewsComplete === false)}${p.reviewAvg != null ? ` (${formatRating(p.reviewAvg)})` : ''}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </details>
  )
}

const REVIEWS_PAGE = 20

/** One review: stars, date, language, plain text with its line breaks, the buyer's photo. */
function ReviewItem({ r }: { r: Review }): JSX.Element {
  return (
    <li className="review-item" data-testid="review-item">
      <div className="review-body">
        <div className="review-head">
          <span className="stars" aria-label={`Оцінка ${r.rating ?? '—'} з 5`}>
            {ratingStars(r.rating)}
          </span>
          <span className="dim">
            {' '}
            {formatEtsyDate(r.createdAt)}
            {r.language ? ` · ${r.language}` : ''}
            {r.origin === 'new' ? ' · новий' : ''}
          </span>
        </div>
        {r.text && <div className="review-text">{r.text}</div>}
        {r.hasImage && (
          <img className="review-photo" src={reviewImageSrc(r)} alt="Фото покупця" loading="lazy" referrerPolicy="no-referrer" />
        )}
      </div>
    </li>
  )
}

/** The listing's stored reviews, newest first, loaded a page at a time only when opened. */
function ReviewsSection({ listing }: { listing: Listing }): JSX.Element | null {
  const id = listing.listingId
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Review[] | undefined>(undefined)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setOpen(false)
    setItems(undefined)
    setTotal(0)
    setFailed(false)
  }, [id])
  const loadMore = (offset: number): void => {
    setLoading(true)
    setFailed(false)
    window.api
      .getListingReviews(id, offset, REVIEWS_PAGE)
      .then((page) => {
        // A sync may insert newer reviews meanwhile, shifting the offsets: a
        // review already shown can come back on the next page — skip it.
        setItems((prev) => {
          const kept = offset === 0 ? [] : (prev ?? [])
          const seen = new Set(kept.map((r) => r.id))
          return [...kept, ...page.reviews.filter((r) => !seen.has(r.id))]
        })
        setTotal(page.total)
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    if (open && items === undefined && !loading) loadMore(0)
  }, [open, items, id])
  if (listing.reviewCount == null) return null
  return (
    <details className="reviews-details" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        Відгуки ({formatReviewCount(listing.reviewCount, listing.reviewsPartial)})
        {listing.reviewAvg != null && ` · ⭐ ${formatRating(listing.reviewAvg)}`}
      </summary>
      {open &&
        (items === undefined ? (
          failed ? (
            <p className="hint">
              Не вдалося завантажити відгуки.{' '}
              <button className="btn subtle small" disabled={loading} onClick={() => loadMore(0)}>
                Спробувати ще
              </button>
            </p>
          ) : (
            <p className="hint">Завантаження…</p>
          )
        ) : items.length === 0 ? (
          <p className="hint">Відгуків ще немає.</p>
        ) : (
          <>
            <ul className="review-list" data-testid="listing-reviews">
              {items.map((r) => (
                <ReviewItem key={r.id} r={r} />
              ))}
            </ul>
            {failed && <p className="hint">Не вдалося завантажити відгуки.</p>}
            {items.length < total && (
              <button className="btn subtle small" disabled={loading} onClick={() => loadMore(items.length)}>
                Показати ще ({formatCount(total - items.length)})
              </button>
            )}
          </>
        ))}
      {listing.reviewsPartial && (
        <p className="hint">Історія відгуків магазину ще завантажується — показано не всі.</p>
      )}
    </details>
  )
}

/** Listing details: gallery, popularity, facts, "Деталі", tags, plain-text description, reviews, raw JSON. */
export function ListingModal(): JSX.Element | null {
  const { detailListing: l, openListing } = useStore()
  const [idx, setIdx] = useState(0)
  useEffect(() => setIdx(0), [l?.listingId])
  const close = (): void => openListing(null)
  useEscape(close, l != null)
  if (!l) return null

  const img = l.images[idx] ?? l.images[0]
  const details = detailRows(l)
  const personalization = l.details?.personalization ?? []

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal listing-modal" onClick={(e) => e.stopPropagation()}>
        <div className="listing-layout">
          <div className="gallery">
            <div className="gallery-main">
              {img ? (
                <img src={imageSrc(img, 'fullxfull')} alt={img.alt ?? ''} referrerPolicy="no-referrer" />
              ) : (
                <span className="no-img">без фото</span>
              )}
            </div>
            {l.images.length > 1 && (
              <div className="gallery-thumbs">
                {l.images.map((im, i) => (
                  <button
                    key={im.id}
                    className={`gallery-thumb${i === idx ? ' active' : ''}`}
                    onClick={() => setIdx(i)}
                    aria-label={`Фото ${i + 1}`}
                  >
                    <img src={imageSrc(im, '75x75')} alt="" referrerPolicy="no-referrer" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="listing-info">
            <h2>{l.title}</h2>
            <div className="listing-price">
              {formatPrice(l.priceAmount, l.priceDivisor, l.currency)}
            </div>
            {l.removedAt != null && (
              <div className="hint warn">Товар зник з магазину {formatDateTime(l.removedAt)}.</div>
            )}
            <dl className="listing-facts">
              <dt>Кількість</dt>
              <dd>{l.quantity}</dd>
              {l.numFavorers != null && (
                <>
                  <dt>В обраному</dt>
                  <dd data-testid="fact-favorers">
                    ❤ {formatCount(l.numFavorers)}
                    {formatDelta(l.favorersDelta) && (
                      <span className="delta"> ({formatDelta(l.favorersDelta)})</span>
                    )}
                  </dd>
                </>
              )}
              {l.views != null && (
                <>
                  <dt>Перегляди</dt>
                  <dd data-testid="fact-views">
                    👁 {formatCount(l.views)}
                    {formatDelta(l.viewsDelta) && <span className="delta"> ({formatDelta(l.viewsDelta)})</span>}
                  </dd>
                </>
              )}
              {l.reviewCount != null && l.reviewCount > 0 && (
                <>
                  <dt>Відгуки</dt>
                  <dd data-testid="fact-reviews">
                    ⭐ {formatRating(l.reviewAvg)} ({formatReviewCount(l.reviewCount, l.reviewsPartial)})
                    {l.reviewsNew != null && l.reviewsNew > 0 && (
                      <span className="delta"> (+{formatCount(l.reviewsNew)} нових)</span>
                    )}
                  </dd>
                </>
              )}
              {l.featuredRank != null && l.featuredRank > 0 && (
                <>
                  <dt>Рекомендований</dt>
                  <dd>★ позиція {l.featuredRank}</dd>
                </>
              )}
              <dt>Створено на Etsy</dt>
              <dd>{formatEtsyDate(l.etsyCreatedAt)}</dd>
              <dt>Оновлено на Etsy</dt>
              <dd>{formatEtsyDate(l.etsyUpdatedAt)}</dd>
              <dt>Вперше побачено</dt>
              <dd>{formatDateTime(l.firstSeenAt)}</dd>
              <dt>Востаннє побачено</dt>
              <dd>{formatDateTime(l.lastSeenAt)}</dd>
            </dl>
            {l.tags.length > 0 && (
              <div className="tags">
                {l.tags.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="description" data-testid="listing-description">
              {l.description}
            </div>
            {details.length > 0 && (
              <section className="listing-details" data-testid="listing-details">
                <h3>Деталі</h3>
                <dl className="listing-facts">
                  {details.map(([k, v]) => (
                    <Fragment key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </Fragment>
                  ))}
                </dl>
                {personalization.length > 0 && (
                  <div className="personalization">
                    <h4>Питання персоналізації</h4>
                    <ul>
                      {personalization.map((q, i) => (
                        <li key={q.questionId ?? i}>
                          {q.text}
                          {q.required && ' (обовʼязково)'}
                          {q.instructions && <div className="hint">{q.instructions}</div>}
                          {q.options.length > 0 && <div className="hint">{q.options.join(' · ')}</div>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}
            <ReviewsSection listing={l} />
            <StatsHistory listingId={l.listingId} />
            <RawJson listingId={l.listingId} />
          </div>
        </div>
        <div className="modal-actions">
          <ExternalLink href={l.url} className="btn primary">
            Відкрити на Etsy
          </ExternalLink>
          <button className="btn" onClick={close}>
            Закрити
          </button>
        </div>
      </div>
    </div>
  )
}
