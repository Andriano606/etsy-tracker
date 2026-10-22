import { useEffect, useState } from 'react'
import { formatDateTime, formatEtsyDate, formatPrice } from '@shared/format'
import { useStore } from '../store'
import { ExternalLink } from './ExternalLink'
import { useEscape } from './useEscape'

/** Listing details: image gallery, full description as plain text, tags, dates. */
export function ListingModal(): JSX.Element | null {
  const { detailListing: l, openListing } = useStore()
  const [idx, setIdx] = useState(0)
  useEffect(() => setIdx(0), [l?.listingId])
  const close = (): void => openListing(null)
  useEscape(close, l != null)
  if (!l) return null

  const img = l.images[idx] ?? l.images[0]

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal listing-modal" onClick={(e) => e.stopPropagation()}>
        <div className="listing-layout">
          <div className="gallery">
            <div className="gallery-main">
              {img ? (
                <img
                  src={img.url570 || img.urlFull}
                  alt={img.alt ?? ''}
                  referrerPolicy="no-referrer"
                />
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
                    <img src={im.url75 || im.url170} alt="" referrerPolicy="no-referrer" />
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
            {/* Plain text with line breaks kept — never rendered as HTML. */}
            <div className="description" data-testid="listing-description">
              {l.description}
            </div>
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
