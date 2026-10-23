// The "compete" sections at the bottom of a tracked listing's window — live
// data of any listing: properties, images/videos, personalization, a
// translation, variation images, shipping (own listings, signed in) and reviews.

import { useState } from 'react'
import {
  REVIEWS_PAGE,
  TRANSLATION_LANGUAGES,
  type ListingPropertyInfo,
  type ListingShippingInfo,
  type ListingTranslationInfo,
  type LiveImage,
  type LivePersonalizationQuestion,
  type LiveReview,
  type LiveReviewsPage,
  type LiveVideo,
  type ReturnPolicyInfo,
  type ShippingCarrierInfo,
  type ShippingDestinationInfo,
  type ShippingProfileInfo,
  type VariationImageInfo
} from '@shared/features/compete'
import { formatEtsyDate, ratingStars } from '@shared/format'
import { missingScopes } from '@shared/myShop'
import type { Listing } from '@shared/types'
import { imageSrc } from '../../imageUrl'
import { useStore } from '../../store'
import { featureCall } from '../call'
import { ErrorNote, LoadedView, money, useCompete, yesNo } from './common'
import { deadlineText } from './shopPanels'

type PanelProps = { listing: Listing; mine: boolean }

// ----------------------------------------------------------------- properties

function PropertiesPanel({ listing }: PanelProps): JSX.Element {
  const state = useCompete<ListingPropertyInfo[]>('properties', { shopId: listing.shopId, listingId: listing.listingId })
  return (
    <LoadedView state={state}>
      {(props) =>
        props.length === 0 ? (
          <div className="hint">Атрибутів немає.</div>
        ) : (
          <table className="data-table" data-testid="compete-properties">
            <thead>
              <tr>
                <th>Атрибут</th>
                <th>Значення</th>
                <th>Шкала</th>
              </tr>
            </thead>
            <tbody>
              {props.map((p) => (
                <tr key={p.propertyId}>
                  <td>{p.name ?? `#${p.propertyId}`}</td>
                  <td>{p.values.join(', ') || '—'}</td>
                  <td>{p.scaleName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </LoadedView>
  )
}

// ------------------------------------------------------------- images/videos

const size = (w: number | null, h: number | null): string => (w && h ? `${w}×${h}` : '—')

function ImageDetails({ listingId, imageId }: { listingId: number; imageId: number }): JSX.Element {
  const state = useCompete<LiveImage>('image', { listingId, imageId })
  return (
    <LoadedView state={state}>
      {(i) => (
        <dl className="listing-facts" data-testid="compete-image-details">
          <dt>Фото</dt>
          <dd>
            #{i.id}, позиція {i.rank ?? '—'}
          </dd>
          <dt>Розмір оригіналу</dt>
          <dd>{size(i.width, i.height)}</dd>
          <dt>Середній колір</dt>
          <dd>
            {i.hexCode ? `#${i.hexCode}` : '—'} · RGB {i.red ?? '—'}, {i.green ?? '—'}, {i.blue ?? '—'} · HSV {i.hue ?? '—'}°, {i.saturation ?? '—'}%,{' '}
            {i.brightness ?? '—'}%
          </dd>
          <dt>Чорно-біле</dt>
          <dd>{yesNo(i.isBlackAndWhite)}</dd>
          <dt>Alt-текст</dt>
          <dd>{i.altText ?? '—'}</dd>
          <dt>Завантажено</dt>
          <dd>{formatEtsyDate(i.createdAt)}</dd>
        </dl>
      )}
    </LoadedView>
  )
}

function VideoDetails({ listingId, videoId }: { listingId: number; videoId: number }): JSX.Element {
  const state = useCompete<LiveVideo>('video', { listingId, videoId })
  return (
    <LoadedView state={state}>
      {(v) => (
        <dl className="listing-facts" data-testid="compete-video-details">
          <dt>Відео</dt>
          <dd>#{v.id}</dd>
          <dt>Розмір</dt>
          <dd>{size(v.width, v.height)}</dd>
          <dt>Стан</dt>
          <dd>{v.state ?? '—'}</dd>
        </dl>
      )}
    </LoadedView>
  )
}

function MediaPanel({ listing }: PanelProps): JSX.Element {
  const images = useCompete<LiveImage[]>('images', { listingId: listing.listingId })
  const videos = useCompete<LiveVideo[]>('videos', { listingId: listing.listingId })
  const [open, setOpen] = useState<{ kind: 'image' | 'video'; id: number } | null>(null)
  const isOpen = (kind: 'image' | 'video', id: number): boolean => open?.kind === kind && open.id === id
  return (
    <div data-testid="compete-media">
      <h4>Фото</h4>
      <LoadedView state={images}>
        {(list) =>
          list.length === 0 ? (
            <div className="hint">Фото немає.</div>
          ) : (
            <ul className="my-listings">
              {list.map((i) => (
                <li key={i.id}>
                  {i.url570 ? <img src={i.url570} alt={i.altText ?? ''} /> : <span className="thumb-empty" />}
                  <div className="my-listing-text">
                    <div className="my-listing-title">
                      #{i.rank ?? '—'} · {size(i.width, i.height)}
                      {i.hexCode && <span className="compete-swatch" style={{ background: `#${i.hexCode}` }} title={`#${i.hexCode}`} />}
                    </div>
                    <div className="dim">{i.altText ? `Alt: ${i.altText}` : 'Без alt-тексту'}</div>
                  </div>
                  <button className="btn small" disabled={isOpen('image', i.id)} onClick={() => setOpen({ kind: 'image', id: i.id })}>
                    Деталі
                  </button>
                </li>
              ))}
            </ul>
          )
        }
      </LoadedView>
      {open?.kind === 'image' && <ImageDetails key={open.id} listingId={listing.listingId} imageId={open.id} />}
      <h4>Відео</h4>
      <LoadedView state={videos}>
        {(list) =>
          list.length === 0 ? (
            <div className="hint">Відео немає.</div>
          ) : (
            <ul className="my-listings">
              {list.map((v) => (
                <li key={v.id}>
                  {v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" /> : <span className="thumb-empty" />}
                  <div className="my-listing-text">
                    <div className="my-listing-title">
                      Відео #{v.id} · {size(v.width, v.height)}
                    </div>
                    <div className="dim">{v.state ?? '—'}</div>
                  </div>
                  <button className="btn small" disabled={isOpen('video', v.id)} onClick={() => setOpen({ kind: 'video', id: v.id })}>
                    Деталі
                  </button>
                </li>
              ))}
            </ul>
          )
        }
      </LoadedView>
      {open?.kind === 'video' && <VideoDetails key={open.id} listingId={listing.listingId} videoId={open.id} />}
    </div>
  )
}

// ------------------------------------------------------------ personalization

function questionFacts(q: LivePersonalizationQuestion): string {
  return [
    q.type,
    q.required ? 'обов’язкове' : 'необов’язкове',
    q.maxChars != null && `до ${q.maxChars} символів`,
    q.maxFiles != null && `до ${q.maxFiles} файлів`,
    q.addOnPrice && `доплата ${money(q.addOnPrice)}`
  ]
    .filter(Boolean)
    .join(' · ')
}

function PersonalizationPanel({ listing }: PanelProps): JSX.Element {
  const state = useCompete<LivePersonalizationQuestion[]>('personalization', { listingId: listing.listingId })
  return (
    <LoadedView state={state}>
      {(questions) =>
        questions.length === 0 ? (
          <div className="hint">Товар без персоналізації.</div>
        ) : (
          <ul className="plain-list" data-testid="compete-personalization">
            {questions.map((q, i) => (
              <li key={q.id ?? i}>
                <strong>{q.text || '—'}</strong> <span className="dim">({questionFacts(q)})</span>
                {q.instructions && <div className="compete-pre">{q.instructions}</div>}
                {q.options.length > 0 && <div className="dim">Варіанти: {q.options.map((o) => o.label).join(', ')}</div>}
              </li>
            ))}
          </ul>
        )
      }
    </LoadedView>
  )
}

// ---------------------------------------------------------------- translation

/** Etsy's 404 here is generic: no translation, or no such listing in that shop. */
const TRANSLATION_NOT_FOUND_UA = 'Перекладу цією мовою немає (або Etsy не знайшов цей лістинг у магазині).'

function TranslationView({ listing, language }: PanelProps & { language: string }): JSX.Element {
  const state = useCompete<ListingTranslationInfo | null>('translation', { shopId: listing.shopId, listingId: listing.listingId, language })
  if (state.error) return <ErrorNote error={state.error} />
  if (state.loading) return <div className="hint">Завантаження…</div>
  const t = state.data
  if (!t) return <div className="hint">{TRANSLATION_NOT_FOUND_UA}</div>
  return (
    <dl className="listing-facts" data-testid="compete-translation">
      <dt>Назва</dt>
      <dd>{t.title ?? '—'}</dd>
      <dt>Теги</dt>
      <dd>{t.tags.join(', ') || '—'}</dd>
      <dt>Опис</dt>
      <dd className="compete-pre">{t.description ?? '—'}</dd>
    </dl>
  )
}

function TranslationPanel(p: PanelProps): JSX.Element {
  const [pick, setPick] = useState(TRANSLATION_LANGUAGES[0].code)
  const [shown, setShown] = useState<string | null>(null)
  return (
    <div>
      <div className="field">
        <label htmlFor="compete-lang">Мова перекладу</label>
        <div className="row">
          <select id="compete-lang" value={pick} onChange={(e) => setPick(e.target.value)}>
            {TRANSLATION_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name} ({l.code})
              </option>
            ))}
          </select>
          <button className="btn small" disabled={pick === shown} onClick={() => setShown(pick)}>
            Показати переклад
          </button>
        </div>
      </div>
      {shown && <TranslationView key={shown} {...p} language={shown} />}
    </div>
  )
}

// ---------------------------------------------------------- variation images

/** The thumbnail of a variation's photo: our stored copy, else the live CDN one, else ''. */
function variationThumb(listing: Listing, live: LiveImage[] | null, imageId: number): string {
  if (listing.images.some((i) => i.id === imageId)) return imageSrc({ id: imageId }, '170x135')
  return live?.find((i) => i.id === imageId)?.url570 ?? ''
}

function VariationImagesPanel({ listing }: PanelProps): JSX.Element {
  const state = useCompete<VariationImageInfo[]>('variationImages', { shopId: listing.shopId, listingId: listing.listingId })
  const live = useCompete<LiveImage[]>('images', { listingId: listing.listingId })
  return (
    <LoadedView state={state}>
      {(rows) =>
        rows.length === 0 ? (
          <div className="hint">Фото для варіацій не задано.</div>
        ) : (
          <ul className="my-listings" data-testid="compete-variation-images">
            {rows.map((v) => {
              const src = variationThumb(listing, live.data, v.imageId)
              return (
                <li key={`${v.propertyId}-${v.valueId}`}>
                  {src ? <img src={src} alt={v.value ?? ''} /> : <span className="thumb-empty" />}
                  <div className="my-listing-text">
                    <div className="my-listing-title">{v.value ?? `Значення #${v.valueId}`}</div>
                    <div className="dim">
                      фото #{v.imageId}
                      {!src && !live.loading && ' (фото не знайдено серед фото лістингу)'}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )
      }
    </LoadedView>
  )
}

// ------------------------------------------------------------------- shipping

const REGION: Record<string, string> = { eu: 'ЄС', non_eu: 'поза ЄС', none: 'усі інші країни' }
const PROFILE_TYPE: Record<string, string> = { manual: 'фіксовані ціни', calculated: 'розрахункова' }

const days = (min: number | null, max: number | null): string =>
  min == null && max == null ? '—' : min === max || max == null ? `${min} дн.` : `${min ?? '?'}–${max} дн.`
const where = (d: ShippingDestinationInfo): string =>
  d.destinationCountry ?? (d.destinationRegion ? (REGION[d.destinationRegion] ?? d.destinationRegion) : '—')

function ProfileView({ p }: { p: ShippingProfileInfo }): JSX.Element {
  return (
    <div data-testid="compete-shipping-profile">
      <dl className="listing-facts">
        <dt>Профіль доставки</dt>
        <dd>
          {p.title ?? `#${p.id}`}
          {p.isDeleted && ' (видалений)'}
        </dd>
        <dt>Звідки</dt>
        <dd>{[p.originCountry, p.originPostalCode].filter(Boolean).join(', ') || '—'}</dd>
        <dt>Тип</dt>
        <dd>{p.profileType ? (PROFILE_TYPE[p.profileType] ?? p.profileType) : '—'}</dd>
        {p.profileType === 'calculated' && (
          <>
            <dt>Обробка</dt>
            <dd>
              по країні {p.domesticHandlingFee ?? '—'}, міжнародна {p.internationalHandlingFee ?? '—'}
            </dd>
          </>
        )}
      </dl>
      {p.destinations.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Куди</th>
              <th>Вартість</th>
              <th>З іншим товаром</th>
              <th>У дорозі</th>
              <th>Клас відправлення</th>
            </tr>
          </thead>
          <tbody>
            {p.destinations.map((d, i) => (
              <tr key={d.id ?? i}>
                <td>{where(d)}</td>
                <td>{money(d.primaryCost)}</td>
                <td>{money(d.secondaryCost)}</td>
                <td>{days(d.minDeliveryDays, d.maxDeliveryDays)}</td>
                <td>{d.mailClass ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {p.upgrades.length > 0 && (
        <>
          <h4>Прискорена доставка</h4>
          <table className="data-table">
            <thead>
              <tr>
                <th>Назва</th>
                <th>Де</th>
                <th>Доплата</th>
                <th>За кожен наступний</th>
                <th>У дорозі</th>
              </tr>
            </thead>
            <tbody>
              {p.upgrades.map((u, i) => (
                <tr key={u.id ?? i}>
                  <td>{u.name || '—'}</td>
                  <td>{u.type === 0 ? 'по країні' : u.type === 1 ? 'міжнародна' : '—'}</td>
                  <td>{money(u.price)}</td>
                  <td>{money(u.secondaryPrice)}</td>
                  <td>{days(u.minDeliveryDays, u.maxDeliveryDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

function ShippingProfile({ listing, mine }: PanelProps): JSX.Element {
  const state = useCompete<ListingShippingInfo[]>('shipping', { listingId: listing.listingId })
  return (
    <LoadedView state={state}>
      {(rows) => {
        const p = rows.find((r) => r.listingId === listing.listingId)?.profile ?? null
        if (p) return <ProfileView p={p} />
        return (
          <div className="hint">
            {mine
              ? 'Etsy не повернув профіль доставки цього лістингу.'
              : 'Etsy показує профіль доставки лише власнику магазину — для чужих лістингів він порожній.'}
          </div>
        )
      }}
    </LoadedView>
  )
}

function ListingReturnPolicy({ shopId, policyId }: { shopId: number; policyId: number }): JSX.Element {
  const state = useCompete<ReturnPolicyInfo>('returnPolicy', { shopId, policyId })
  return (
    <LoadedView state={state}>
      {(p) => (
        <div className="hint" data-testid="compete-listing-policy">
          Політика повернення: повернення — {yesNo(p.acceptsReturns)}, обмін — {yesNo(p.acceptsExchanges)}, строк — {deadlineText(p.returnDeadline)}.
        </div>
      )}
    </LoadedView>
  )
}

function CarriersLookup(): JSX.Element {
  const [country, setCountry] = useState('US')
  const [carriers, setCarriers] = useState<ShippingCarrierInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const r = await featureCall<ShippingCarrierInfo[]>('compete', 'carriers', { country })
    setBusy(false)
    if (r.ok) setCarriers(r.value)
    else {
      setCarriers(null)
      setError(r.error)
    }
  }
  return (
    <div className="compete-carriers">
      <h4>Служби доставки</h4>
      <div className="field">
        <label htmlFor="compete-carrier-country">Країна відправлення</label>
        <div className="row">
          <input
            id="compete-carrier-country"
            value={country}
            maxLength={2}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
          />
          <button className="btn small" disabled={busy || country.trim().length !== 2} onClick={() => void load()}>
            Показати служби
          </button>
        </div>
      </div>
      {error && <ErrorNote error={error} />}
      {carriers &&
        (carriers.length === 0 ? (
          <div className="hint">Для цієї країни служб доставки немає.</div>
        ) : (
          <ul className="plain-list" data-testid="compete-carriers">
            {carriers.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong>
                {c.domesticClasses.length > 0 && <div className="dim">По країні: {c.domesticClasses.map((m) => m.name).join(', ')}</div>}
                {c.internationalClasses.length > 0 && (
                  <div className="dim">Міжнародні: {c.internationalClasses.map((m) => m.name).join(', ')}</div>
                )}
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}

function ShippingPanel(p: PanelProps): JSX.Element {
  const auth = useStore((s) => s.etsyAuth)
  const policyId = p.listing.details?.returnPolicyId ?? null
  const lacksScope = !!auth?.loggedIn && missingScopes(auth.scopes, ['shops_r']).length > 0
  return (
    <div data-testid="compete-shipping">
      {!auth?.loggedIn ? (
        <div className="hint warn">
          Вартість доставки Etsy віддає лише після входу («✏️ Мій магазин» → «Увійти через Etsy») і лише для ваших власних лістингів.
        </div>
      ) : lacksScope ? (
        <div className="hint warn">Вхід не має дозволу «читання налаштувань магазину» — вийдіть і увійдіть в Etsy ще раз.</div>
      ) : (
        <ShippingProfile {...p} />
      )}
      {policyId != null && <ListingReturnPolicy shopId={p.listing.shopId} policyId={policyId} />}
      <CarriersLookup />
    </div>
  )
}

// -------------------------------------------------------------------- reviews

function ReviewItem({ r }: { r: LiveReview }): JSX.Element {
  return (
    <li className="compete-review">
      <div>
        <span className="compete-stars" aria-label={`Оцінка ${r.rating ?? '—'} з 5`}>
          {ratingStars(r.rating)}
        </span>{' '}
        <span className="dim">
          {formatEtsyDate(r.createdAt)}
          {r.language && ` · ${r.language}`}
        </span>
      </div>
      {r.text && <div className="compete-pre">{r.text}</div>}
      {r.imageUrl && <img className="compete-review-photo" src={r.imageUrl} alt="Фото покупця" />}
    </li>
  )
}

function ReviewsPanel({ listing }: PanelProps): JSX.Element {
  const first = useCompete<LiveReviewsPage>('reviews', { listingId: listing.listingId, offset: 0, limit: REVIEWS_PAGE })
  const [more, setMore] = useState<LiveReview[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <LoadedView state={first}>
      {(page) => {
        const shown = [...page.reviews, ...more]
        const loadMore = async (): Promise<void> => {
          setBusy(true)
          setError(null)
          const r = await featureCall<LiveReviewsPage>('compete', 'reviews', { listingId: listing.listingId, offset: shown.length, limit: REVIEWS_PAGE })
          setBusy(false)
          if (r.ok) setMore((m) => [...m, ...r.value.reviews])
          else setError(r.error)
        }
        if (shown.length === 0) return <div className="hint">Відгуків немає.</div>
        return (
          <div data-testid="compete-reviews">
            <div className="hint">
              Відгуків: {page.count}, показано {shown.length}
            </div>
            <ul className="plain-list compete-reviews">
              {shown.map((r, i) => (
                <ReviewItem key={i} r={r} />
              ))}
            </ul>
            {error && <ErrorNote error={error} />}
            {shown.length < page.count && (
              <button className="btn small" disabled={busy} onClick={() => void loadMore()}>
                {busy ? 'Завантаження…' : 'Показати ще'}
              </button>
            )}
          </div>
        )
      }}
    </LoadedView>
  )
}

export const LISTING_PANELS = [
  { id: 'compete-properties', label: 'Атрибути (властивості)', Component: PropertiesPanel },
  { id: 'compete-media', label: 'Фото й відео (живі дані)', Component: MediaPanel },
  { id: 'compete-personalization', label: 'Персоналізація (жива)', Component: PersonalizationPanel },
  { id: 'compete-translation', label: 'Переклад', Component: TranslationPanel },
  { id: 'compete-variation-images', label: 'Фото варіацій', Component: VariationImagesPanel },
  { id: 'compete-shipping', label: 'Доставка (вартість)', Component: ShippingPanel },
  { id: 'compete-reviews', label: 'Відгуки (живі)', Component: ReviewsPanel }
]
