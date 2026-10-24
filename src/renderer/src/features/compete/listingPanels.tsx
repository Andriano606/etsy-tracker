import { Fragment, useId, useState, type ReactNode } from 'react'
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
import { COMMON_COUNTRIES, ISO_COUNTRIES, countryLabel } from '@shared/countries'
import { formatCount, formatEtsyDate, formatPrice, ratingStars } from '@shared/format'
import { missingScopes } from '@shared/myShop'
import type { Listing } from '@shared/types'
import { imageSrc } from '../../imageUrl'
import { useStore } from '../../store'
import { Badge, Button, Callout, GLOSSARY, Icon, InfoTip, Loading, Select, Term } from '../../ui'
import { featureCall } from '../call'
import { EmptyNote, ErrorNote, LoadedView, money, useCompete, useReveal, YesNo } from './common'
import { deadlineText } from './shopPanels'

type PanelProps = { listing: Listing; mine: boolean }

// ------------------------------------------------------------- properties

function PropertiesPanel({ listing }: PanelProps): JSX.Element {
  const state = useCompete<ListingPropertyInfo[]>('properties', { shopId: listing.shopId, listingId: listing.listingId })
  return (
    <LoadedView state={state}>
      {(props) =>
        props.length === 0 ? (
          <EmptyNote icon="tag" hint="Продавець не заповнив жодної характеристики з довідника Etsy.">
            Характеристик немає.
          </EmptyNote>
        ) : (
          <div className="table-wrap">
            <table className="data-table" data-testid="compete-properties">
              <thead>
                <tr>
                  <th>Характеристика</th>
                  <th>Значення</th>
                  <th>
                    Шкала <InfoTip glossary="features.market.scale" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {props.map((p) => (
                  <tr key={p.propertyId}>
                    <td>{p.name ?? `Характеристика #${p.propertyId}`}</td>
                    <td>{p.values.join(', ') || '—'}</td>
                    <td>{p.scaleName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </LoadedView>
  )
}

// ----------------------------------------------------------- photos/video

const size = (w: number | null, h: number | null): string => (w && h ? `${w}×${h} пікс.` : '—')

function Swatch({ hex }: { hex: string | null }): JSX.Element | null {
  if (!hex) return null
  return <span className="compete-swatch" style={{ background: `#${hex}` }} title={`Середній колір #${hex}`} aria-hidden="true" />
}

function ImageDetails({
  listingId,
  imageId,
  imageRank,
  onClose
}: {
  listingId: number
  imageId: number
  imageRank: number | null
  onClose: () => void
}): JSX.Element {
  const state = useCompete<LiveImage>('image', { listingId, imageId })
  const { box, heading } = useReveal<HTMLDivElement, HTMLHeadingElement>()
  return (
    <div ref={box} className="ui-card compete-detail-card">
      <div className="compete-head">
        <h4 ref={heading} tabIndex={-1}>
          Деталі фото {imageRank}
        </h4>
        <span className="ui-spacer" />
        <Button size="sm" variant="ghost" icon="close" onClick={onClose}>
          Сховати
        </Button>
      </div>
      <LoadedView state={state}>
        {(i) => (
          <div className="feat-facts-wrap">
            <dl className="feat-facts" data-testid="compete-image-details">
              <dt>Позиція в галереї</dt>
              <dd>{i.rank == null ? '—' : i.rank === 1 ? '1 (головне фото)' : i.rank}</dd>
              <dt>
                Розмір оригіналу <InfoTip glossary="features.compete.photoSize" />
              </dt>
              <dd>{size(i.width, i.height)}</dd>
              <dt>
                Середній колір <InfoTip glossary="features.compete.dominantColor" />
              </dt>
              <dd>
                <Swatch hex={i.hexCode} />
                {i.hexCode ? `#${i.hexCode}` : '—'}{' '}
                <span className="dim">
                  · RGB {i.red ?? '—'}, {i.green ?? '—'}, {i.blue ?? '—'} · HSV {i.hue ?? '—'}°, {i.saturation ?? '—'}%, {i.brightness ?? '—'}%
                </span>
              </dd>
              <dt>Чорно-біле</dt>
              <dd>
                <YesNo value={i.isBlackAndWhite} />
              </dd>
              <dt>
                Опис фото <InfoTip glossary="features.compete.altText" />
              </dt>
              <dd>{i.altText ?? 'немає'}</dd>
              <dt>Завантажено</dt>
              <dd>{formatEtsyDate(i.createdAt)}</dd>
            </dl>
          </div>
        )}
      </LoadedView>
    </div>
  )
}

/** OAS ListingVideo.video_state, in Ukrainian. */
const VIDEO_STATE: Record<string, string> = {
  active: 'показується покупцям',
  inactive: 'вимкнене продавцем',
  deleted: 'видалене',
  flagged: 'приховане Etsy'
}
const videoState = (s: string | null): string => (s ? (VIDEO_STATE[s] ?? s) : '—')

function VideoDetails({ listingId, videoId, onClose }: { listingId: number; videoId: number; onClose: () => void }): JSX.Element {
  const state = useCompete<LiveVideo>('video', { listingId, videoId })
  const { box, heading } = useReveal<HTMLDivElement, HTMLHeadingElement>()
  return (
    <div ref={box} className="ui-card compete-detail-card">
      <div className="compete-head">
        <h4 ref={heading} tabIndex={-1}>
          Деталі відео
        </h4>
        <span className="ui-spacer" />
        <Button size="sm" variant="ghost" icon="close" onClick={onClose}>
          Сховати
        </Button>
      </div>
      <LoadedView state={state}>
        {(v) => (
          <div className="feat-facts-wrap">
            <dl className="feat-facts" data-testid="compete-video-details">
              <dt>Розмір</dt>
              <dd>{size(v.width, v.height)}</dd>
              <dt>
                Стан відео <InfoTip glossary="features.compete.videoState" />
              </dt>
              <dd>{videoState(v.state)}</dd>
            </dl>
          </div>
        )}
      </LoadedView>
    </div>
  )
}

function MediaPanel({ listing }: PanelProps): JSX.Element {
  const images = useCompete<LiveImage[]>('images', { listingId: listing.listingId })
  const videos = useCompete<LiveVideo[]>('videos', { listingId: listing.listingId })
  const [open, setOpen] = useState<{ kind: 'image' | 'video'; id: number } | null>(null)
  const isOpen = (kind: 'image' | 'video', id: number): boolean => open?.kind === kind && open.id === id
  const close = (): void => setOpen(null)
  return (
    <div data-testid="compete-media">
      <h4 className="feat-subhead">
        <Icon name="photo" size={14} /> Фото
        {images.data && images.data.length > 0 && <span className="compete-count">{images.data.length}</span>}
      </h4>
      <LoadedView state={images}>
        {(list) =>
          list.length === 0 ? (
            <EmptyNote icon="photo">Фото немає.</EmptyNote>
          ) : (
            <ul className="compete-media-grid">
              {list.map((i) => (
                <Fragment key={i.id}>
                <li className={'compete-media-item' + (isOpen('image', i.id) ? ' is-open' : '')} data-testid="compete-photo">
                  <div className="compete-media-thumb">
                    {i.url570 ? <img src={i.url570} alt={i.altText ?? ''} loading="lazy" /> : <Icon name="image" size={22} />}
                  </div>
                  <div className="compete-media-text">
                    <div className="compete-media-title">
                      Фото {i.rank ?? '—'}
                      {i.rank === 1 && <Badge tone="accent">головне</Badge>}
                    </div>
                    <div className="dim">{size(i.width, i.height)}</div>
                    <div className={'compete-alt clamp-2' + (i.altText ? '' : ' dim')} title={i.altText ?? undefined}>
                      {i.altText ? `Опис: ${i.altText}` : 'Без опису фото'}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    icon="info"
                    disabled={isOpen('image', i.id)}
                    aria-expanded={isOpen('image', i.id)}
                    onClick={() => setOpen({ kind: 'image', id: i.id })}
                  >
                    Деталі
                  </Button>
                </li>
                {/* Right under the photo's row of the grid (the grid packs densely around it). */}
                {isOpen('image', i.id) && (
                  <li className="compete-media-expanded">
                    <ImageDetails listingId={listing.listingId} imageId={i.id} imageRank={i.rank} onClose={close} />
                  </li>
                )}
                </Fragment>
              ))}
            </ul>
          )
        }
      </LoadedView>
      <h4 className="feat-subhead">
        <Icon name="video" size={14} /> Відео
      </h4>
      <LoadedView state={videos}>
        {(list) =>
          list.length === 0 ? (
            <EmptyNote icon="video">Відео немає.</EmptyNote>
          ) : (
            <ul className="compete-media-grid">
              {list.map((v) => (
                <Fragment key={v.id}>
                <li className={'compete-media-item' + (isOpen('video', v.id) ? ' is-open' : '')}>
                  <div className="compete-media-thumb">
                    {v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" loading="lazy" /> : <Icon name="video" size={22} />}
                  </div>
                  <div className="compete-media-text">
                    <div className="compete-media-title">Відео</div>
                    <div className="dim">{size(v.width, v.height)}</div>
                    <div className="dim">{videoState(v.state)}</div>
                  </div>
                  <Button
                    size="sm"
                    icon="info"
                    disabled={isOpen('video', v.id)}
                    aria-expanded={isOpen('video', v.id)}
                    onClick={() => setOpen({ kind: 'video', id: v.id })}
                  >
                    Деталі
                  </Button>
                </li>
                {isOpen('video', v.id) && (
                  <li className="compete-media-expanded">
                    <VideoDetails listingId={listing.listingId} videoId={v.id} onClose={close} />
                  </li>
                )}
                </Fragment>
              ))}
            </ul>
          )
        }
      </LoadedView>
    </div>
  )
}

// ---------------------------------------------------------- personalization

/** OAS PersonalizationQuestion.question_type, in Ukrainian. */
const QUESTION_TYPE: Record<string, string> = {
  text_input: 'текст',
  dropdown: 'вибір зі списку',
  unlabeled_dropdown: 'вибір зі списку',
  file: 'файл',
  file_upload: 'файл',
  image_upload: 'фото'
}

function PersonalizationPanel({ listing }: PanelProps): JSX.Element {
  const state = useCompete<LivePersonalizationQuestion[]>('personalization', { listingId: listing.listingId })
  return (
    <LoadedView state={state}>
      {(questions) =>
        questions.length === 0 ? (
          <EmptyNote icon="edit" hint="Покупець не може вписати свій текст чи надіслати файл під час замовлення.">
            Товар без персоналізації.
          </EmptyNote>
        ) : (
          <ul className="compete-questions" data-testid="compete-personalization">
            {questions.map((q, i) => (
              <li key={q.id ?? i} className="compete-question" data-testid="compete-question">
                <div className="compete-question-head">
                  <strong className="compete-question-text">{q.text || 'Питання без тексту'}</strong>
                  <span className="feat-chips">
                    {q.type && <Badge tone="neutral">{QUESTION_TYPE[q.type] ?? q.type}</Badge>}
                    <Badge tone={q.required ? 'warn' : 'neutral'}>{q.required ? 'обов’язкове' : 'необов’язкове'}</Badge>
                    {q.maxChars != null && <Badge tone="neutral">до {formatCount(q.maxChars)} символів</Badge>}
                    {q.maxFiles != null && <Badge tone="neutral">до {q.maxFiles} файлів</Badge>}
                    {q.addOnPrice && (
                      <Badge tone="info" icon="money" hint={GLOSSARY['features.compete.addOnPrice'].short}>
                        доплата {money(q.addOnPrice)}
                      </Badge>
                    )}
                  </span>
                </div>
                {q.instructions && <div className="feat-pre compete-question-help">{q.instructions}</div>}
                {q.options.length > 0 && (
                  <div className="compete-question-options">
                    <span className="dim">Варіанти:</span>
                    <ul className="feat-chips">
                      {q.options.map((o, k) => (
                        <li key={o.id ?? k} className="feat-chip">
                          {o.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )
      }
    </LoadedView>
  )
}

// -------------------------------------------------------------- translation

/** Etsy's 404 here is generic: no translation, or no such listing in that shop. */
const TRANSLATION_NOT_FOUND_UA = 'Перекладу цією мовою немає (або Etsy не знайшов цей товар у магазині).'

function TranslationView({ listing, language }: PanelProps & { language: string }): JSX.Element {
  const state = useCompete<ListingTranslationInfo | null>('translation', { shopId: listing.shopId, listingId: listing.listingId, language })
  if (state.error) return <ErrorNote error={state.error} onRetry={state.reload} />
  if (state.loading) return <Loading inline>Завантаження перекладу…</Loading>
  const t = state.data
  if (!t) return <EmptyNote icon="globe">{TRANSLATION_NOT_FOUND_UA}</EmptyNote>
  return (
    <div className="feat-facts-wrap">
      <dl className="feat-facts" data-testid="compete-translation">
        <dt>Назва</dt>
        <dd>{t.title ?? '—'}</dd>
        <dt>Теги</dt>
        <dd>
          {t.tags.length === 0 ? (
            '—'
          ) : (
            <ul className="feat-chips" aria-label="Теги">
              {t.tags.map((tag) => (
                <li key={tag} className="feat-chip">
                  {tag}
                </li>
              ))}
            </ul>
          )}
        </dd>
        <dt>Опис</dt>
        <dd className="feat-pre compete-translation-desc">{t.description ?? '—'}</dd>
      </dl>
    </div>
  )
}

/**
 * A select and its button on one line, the button aligned with the control
 * (the label above, the hint below both); the button wraps under the select
 * when the card is narrow.
 */
function InlinePick({
  id,
  label,
  hint,
  control,
  button
}: {
  id: string
  label: string
  hint: string
  control: (p: { id: string; 'aria-describedby': string }) => ReactNode
  button: ReactNode
}): JSX.Element {
  const hintId = `${useId()}-h`
  return (
    <div className="compete-inline-form">
      <div className="ui-field-head">
        <label htmlFor={id} className="ui-field-label">
          {label}
        </label>
      </div>
      <div className="compete-inline-row">
        {control({ id, 'aria-describedby': hintId })}
        {button}
      </div>
      <div className="ui-field-hint" id={hintId}>
        {hint}
      </div>
    </div>
  )
}

function TranslationPanel(p: PanelProps): JSX.Element {
  const [pick, setPick] = useState(TRANSLATION_LANGUAGES[0].code)
  const [shown, setShown] = useState<string | null>(null)
  return (
    <div className="ui-stack">
      <InlinePick
        id="compete-lang"
        label="Мова перекладу"
        hint="Переклад показується, лише якщо продавець його додав."
        control={(c) => (
          <Select
            {...c}
            value={pick}
            onChange={setPick}
            options={TRANSLATION_LANGUAGES.map((l) => ({ value: l.code, label: `${l.name} (${l.code})` }))}
          />
        )}
        button={
          <Button icon="globe" disabled={pick === shown} onClick={() => setShown(pick)}>
            Показати переклад
          </Button>
        }
      />
      {shown && <TranslationView key={shown} {...p} language={shown} />}
    </div>
  )
}

// --------------------------------------------------------- variation photos

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
          <EmptyNote icon="layers" hint="Коли покупець вибирає варіант, фото товару не змінюється.">
            Фото для варіантів не задано.
          </EmptyNote>
        ) : (
          <ul className="compete-variation-grid" data-testid="compete-variation-images">
            {rows.map((v) => {
              const src = variationThumb(listing, live.data, v.imageId)
              const label = v.value ?? `Значення #${v.valueId}`
              return (
                <li key={`${v.propertyId}-${v.valueId}`} className="compete-variation" data-testid="compete-variation">
                  <div className="compete-media-thumb">{src ? <img src={src} alt={v.value ?? ''} loading="lazy" /> : <Icon name="image" size={22} />}</div>
                  <div className="compete-variation-label truncate" title={label}>
                    {label}
                  </div>
                  {!src && !live.loading && <div className="compete-variation-missing">Фото не знайдено серед фото товару</div>}
                </li>
              )
            })}
          </ul>
        )
      }
    </LoadedView>
  )
}

// ------------------------------------------------------------------ shipping

const REGION: Record<string, string> = { eu: 'Країни ЄС', non_eu: 'Країни поза ЄС', none: 'Усі інші країни' }
const PROFILE_TYPE: Record<string, string> = { manual: 'фіксовані ціни', calculated: 'розрахункова' }
const CARRIER_ACRONYMS = new Set(['usps', 'ups', 'dhl', 'tnt', 'gls', 'dpd', 'fedex', 'ems', 'ppl', 'uk', 'us', 'eu'])

/** "usps_first_class" → "USPS First Class" (Etsy's mail class keys; the names come from the carrier). */
export function mailClassLabel(key: string | null): string {
  if (!key) return '—'
  if (!/^[a-z0-9_]+$/.test(key)) return key
  return key
    .split('_')
    .filter(Boolean)
    .map((w) => (CARRIER_ACRONYMS.has(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
}

const days = (min: number | null, max: number | null): string =>
  min == null && max == null ? '—' : min === max || max == null ? `${min} дн.` : `${min ?? '?'}–${max} дн.`
const where = (d: ShippingDestinationInfo): string =>
  d.destinationCountry ? countryLabel(d.destinationCountry) : d.destinationRegion ? (REGION[d.destinationRegion] ?? d.destinationRegion) : '—'

/** Etsy gives the handling fee as a bare number in the shop's currency: the profile's prices say which one. */
const handlingFee = (fee: number | null, currency: string | null): string =>
  fee == null ? '—' : currency ? formatPrice(Math.round(fee * 100), 100, currency) : `${fee} (у валюті магазину)`

function ProfileView({ p }: { p: ShippingProfileInfo }): JSX.Element {
  const feeCurrency =
    p.destinations.find((d) => d.primaryCost)?.primaryCost?.currency ?? p.upgrades.find((u) => u.price)?.price?.currency ?? null
  return (
    <div className="ui-stack" data-testid="compete-shipping-profile">
      <div className="feat-facts-wrap">
        <dl className="feat-facts">
          <dt>
            Профіль доставки <InfoTip glossary="shippingProfile" />
          </dt>
          <dd>
            {p.title ?? `Профіль #${p.id}`}
            {p.isDeleted && ' (видалений)'}
          </dd>
          <dt>Звідки</dt>
          <dd>{[p.originCountry && countryLabel(p.originCountry), p.originPostalCode].filter(Boolean).join(', ') || '—'}</dd>
          <dt>
            Тип <InfoTip glossary="features.compete.profileType" />
          </dt>
          <dd>{p.profileType ? (PROFILE_TYPE[p.profileType] ?? p.profileType) : '—'}</dd>
          {p.profileType === 'calculated' && (
            <>
              <dt>
                Плата за обробку <InfoTip glossary="features.compete.handlingFee" />
              </dt>
              <dd>
                по країні {handlingFee(p.domesticHandlingFee, feeCurrency)}, міжнародна {handlingFee(p.internationalHandlingFee, feeCurrency)}
              </dd>
            </>
          )}
        </dl>
      </div>
      {p.destinations.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Куди</th>
                <th>Вартість</th>
                <th>
                  З іншим товаром <InfoTip glossary="features.compete.secondaryCost" />
                </th>
                <th>
                  У дорозі <InfoTip glossary="features.compete.deliveryTime" />
                </th>
                <th>
                  Клас відправлення <InfoTip glossary="features.compete.mailClass" />
                </th>
              </tr>
            </thead>
            <tbody>
              {p.destinations.map((d, i) => (
                <tr key={d.id ?? i}>
                  <td>{where(d)}</td>
                  <td className="num">{money(d.primaryCost)}</td>
                  <td className="num">{money(d.secondaryCost)}</td>
                  <td>{days(d.minDeliveryDays, d.maxDeliveryDays)}</td>
                  <td>{mailClassLabel(d.mailClass)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {p.upgrades.length > 0 && (
        <>
          <h4 className="feat-subhead">
            Прискорена доставка <InfoTip glossary="features.compete.upgrades" />
          </h4>
          <div className="table-wrap">
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
                    <td className="num">{money(u.price)}</td>
                    <td className="num">{money(u.secondaryPrice)}</td>
                    <td>{days(u.minDeliveryDays, u.maxDeliveryDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          <Callout tone="info" compact role="note">
            {mine
              ? 'Etsy не повернув профіль доставки цього товару.'
              : 'Etsy показує профіль доставки лише власнику магазину — для чужих товарів він порожній.'}
          </Callout>
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
        <div className="compete-policy-line" data-testid="compete-listing-policy">
          <Icon name="refresh" size={14} />
          <span>
            <Term glossary="returnPolicy">Правила повернення</Term> цього товару: повернення — {p.acceptsReturns ? 'так' : 'ні'}, обмін —{' '}
            {p.acceptsExchanges ? 'так' : 'ні'}, строк — {p.returnDeadline == null ? 'не вказано.' : deadlineText(p.returnDeadline)}
          </span>
        </div>
      )}
    </LoadedView>
  )
}

/** Common countries first, then every other ISO code by its Ukrainian name. */
const CARRIER_COUNTRIES = (() => {
  const common = COMMON_COUNTRIES.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }))
  const seen = new Set(common.map((c) => c.value))
  const rest = [...ISO_COUNTRIES]
    .filter((c) => !seen.has(c))
    .map((c) => ({ value: c, label: countryLabel(c) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'uk'))
  return { common, rest }
})()

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
      <h4 className="feat-subhead">
        <Icon name="truck" size={14} /> Служби доставки <InfoTip glossary="features.compete.carriers" />
      </h4>
      <InlinePick
        id="compete-carrier-country"
        label="Країна відправлення"
        hint="Звідки відправляє продавець. Не залежить від цього товару."
        control={(c) => (
          <Select {...c} value={country} onChange={setCountry}>
            <optgroup label="Часто вживані">
              {CARRIER_COUNTRIES.common.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Усі країни">
              {CARRIER_COUNTRIES.rest.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          </Select>
        )}
        button={
          <Button icon="truck" busy={busy} onClick={() => void load()}>
            Показати служби
          </Button>
        }
      />
      {error && <ErrorNote error={error} onRetry={() => void load()} />}
      {carriers &&
        (carriers.length === 0 ? (
          <EmptyNote icon="truck">Для цієї країни служб доставки немає.</EmptyNote>
        ) : (
          <ul className="feat-rows" data-testid="compete-carriers">
            {carriers.map((c) => (
              <li key={c.id} className="feat-row compete-carrier">
                <div className="feat-row-text">
                  <div className="feat-row-title">{c.name}</div>
                  {c.domesticClasses.length > 0 && (
                    <div className="compete-carrier-classes">
                      <span className="dim">По країні:</span> {c.domesticClasses.map((m) => m.name).join(', ')}
                    </div>
                  )}
                  {c.internationalClasses.length > 0 && (
                    <div className="compete-carrier-classes">
                      <span className="dim">Міжнародні:</span> {c.internationalClasses.map((m) => m.name).join(', ')}
                    </div>
                  )}
                  {c.domesticClasses.length === 0 && c.internationalClasses.length === 0 && <div className="dim">Видів послуг Etsy не вказав.</div>}
                </div>
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
    <div className="ui-stack" data-testid="compete-shipping">
      {!auth?.loggedIn ? (
        <Callout tone="info" compact role="note" title="Вартість доставки не видно">
          Etsy показує її лише після входу і лише для ваших власних товарів. Увійти можна в «Мій магазин» → «Увійти через Etsy».
        </Callout>
      ) : lacksScope ? (
        <Callout tone="warn" compact>
          Під час входу ви не дали дозволу на «читання налаштувань магазину» — вийдіть і увійдіть в Etsy ще раз.
        </Callout>
      ) : (
        <ShippingProfile {...p} />
      )}
      {policyId != null && <ListingReturnPolicy shopId={p.listing.shopId} policyId={policyId} />}
      <CarriersLookup />
    </div>
  )
}

// ------------------------------------------------------------------- reviews

/** "en" → "англійська" (the system's Ukrainian language names); the code itself when unknown. */
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames(['uk'], { type: 'language', fallback: 'none' }).of(code)
    return name ? name.toLocaleLowerCase('uk') : code
  } catch {
    return code
  }
}

function ReviewItem({ r }: { r: LiveReview }): JSX.Element {
  return (
    <li className="compete-review">
      <div className="compete-review-head">
        <span className="compete-stars" role="img" aria-label={`Оцінка ${r.rating ?? '—'} з 5`}>
          {ratingStars(r.rating)}
        </span>
        <span className="dim">
          {formatEtsyDate(r.createdAt)}
          {r.language && ` · мова: ${languageName(r.language)}`}
        </span>
      </div>
      {r.text ? <div className="feat-pre compete-review-text">{r.text}</div> : <div className="dim">Без тексту — лише оцінка.</div>}
      {r.imageUrl && <img className="compete-review-photo" src={r.imageUrl} alt="Фото покупця" loading="lazy" />}
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
        if (shown.length === 0) return <EmptyNote icon="review">Відгуків немає.</EmptyNote>
        return (
          <div data-testid="compete-reviews">
            <div className="compete-reviews-summary">
              Відгуків: {formatCount(page.count)}, показано {formatCount(shown.length)}
            </div>
            <ul className="compete-reviews">
              {shown.map((r, i) => (
                <ReviewItem key={i} r={r} />
              ))}
            </ul>
            {error && <ErrorNote error={error} onRetry={() => void loadMore()} />}
            {shown.length < page.count && (
              <div className="feat-more">
                <span />
                <Button size="sm" icon="chevron-down" busy={busy} onClick={() => void loadMore()}>
                  Показати ще
                </Button>
              </div>
            )}
          </div>
        )
      }}
    </LoadedView>
  )
}

export const LISTING_PANELS = [
  {
    id: 'compete-properties',
    label: 'Характеристики',
    icon: 'tag' as const,
    description: 'Колір, розмір, стиль, свято — властивості з довідника Etsy, за якими покупці фільтрують пошук.',
    Component: PropertiesPanel
  },
  {
    id: 'compete-media',
    label: 'Усі фото й відео',
    icon: 'photo' as const,
    description: 'Галерея товару зараз на Etsy: розміри, описи фото, основний колір, відео.',
    Component: MediaPanel
  },
  {
    id: 'compete-personalization',
    label: 'Персоналізація',
    icon: 'edit' as const,
    description: 'Що покупець може вписати чи надіслати продавцю під час замовлення (ім’я, дату, файл).',
    Component: PersonalizationPanel
  },
  {
    id: 'compete-translation',
    label: 'Переклади',
    icon: 'globe' as const,
    description: 'Назва, опис і теги товару іншими мовами, якщо продавець їх переклав.',
    Component: TranslationPanel
  },
  {
    id: 'compete-variation-images',
    label: 'Фото варіантів',
    icon: 'layers' as const,
    description: 'Яке фото бачить покупець, коли вибирає варіант (наприклад, колір).',
    Component: VariationImagesPanel
  },
  {
    id: 'compete-shipping',
    label: 'Доставка і повернення',
    icon: 'truck' as const,
    description: 'Скільки коштує і скільки йде доставка, правила повернення, служби доставки країни.',
    Component: ShippingPanel
  },
  {
    id: 'compete-reviews',
    label: 'Відгуки зараз на Etsy (з фото)',
    icon: 'review' as const,
    description: 'Оцінки й коментарі покупців саме цього товару — прямо з Etsy, разом з фото покупців.',
    Component: ReviewsPanel
  }
]
