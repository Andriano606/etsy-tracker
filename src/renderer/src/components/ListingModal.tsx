import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BuyerPrice, Listing, ListingDetails, ListingImage, ListingStatsPoint, Promotion, Review } from '@shared/types'
import {
  formatCount,
  formatDateTime,
  formatEtsyDate,
  formatPrice,
  formatPromoPeriod,
  formatRating,
  formatReviewCount
} from '@shared/format'
import { buyerPriceIncludes, discountLabel, formatMoney, hasActiveDiscount, shownPrice } from '@shared/price'
import { countryLabel } from '@shared/countries'
import { whenMadeLabel } from '@shared/changes'
import { GLOSSARY, type GlossaryKey } from '@shared/glossary'
import { ownShopId, useStore } from '../store'
import { LazyDetails, panelMeta } from '../features/LazyDetails'
import { LISTING_PANELS } from '../features/registry'
import { imageSrc, reviewImageSrc } from '../imageUrl'
import { Badge, Button, Callout, Icon, InfoTip, Loading, Modal, Stat, buttonClass, type BadgeTone, type IconName } from '../ui'
import { ExternalLink } from './ExternalLink'
import { NowPrice, WasPrice } from './PriceParts'

// The listing window: a gallery beside the price, popularity, tags, description,
// details and dates (two columns, one when narrow), then collapsible sections
// loaded only when opened (reviews, prices & promotions, popularity history,
// the features' live panels, technical data). Every Etsy concept carries an ⓘ.

const yesNo = (v: boolean | null | undefined): string | null => (v == null ? null : v ? 'так' : 'ні')

const num = (n: number): string => n.toLocaleString('uk-UA', { maximumFractionDigits: 2 })

const UNIT: Record<string, string> = {
  kg: 'кг',
  g: 'г',
  lb: 'фунт.',
  oz: 'унц.',
  cm: 'см',
  mm: 'мм',
  m: 'м',
  in: 'дюйм.',
  ft: 'фут.',
  yd: 'ярд.'
}
const unit = (u: string | null | undefined): string => (u ? (UNIT[u.toLowerCase()] ?? u) : '')

const TYPE_LABEL: Record<string, string> = {
  physical: 'фізичний (надсилають поштою)',
  download: 'цифровий (файл для завантаження)',
  both: 'фізичний і цифровий'
}
const WHO_LABEL: Record<string, string> = {
  i_did: 'сам продавець',
  collective: 'команда продавця',
  someone_else: 'інший виробник'
}

/** Listing state → a Ukrainian label and a badge tone (null for an unknown state). */
const STATE: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: 'у продажу', tone: 'accent' },
  sold_out: { label: 'розпродано', tone: 'warn' },
  inactive: { label: 'знято з продажу', tone: 'warn' },
  expired: { label: 'термін розміщення минув', tone: 'warn' },
  draft: { label: 'чернетка', tone: 'neutral' },
  edit: { label: 'редагується', tone: 'neutral' },
  removed: { label: 'видалено', tone: 'danger' }
}

let languageNames: Intl.DisplayNames | null | undefined
/** "en-US" → "англійська (США)"; the code itself when the runtime can't name it. */
export function languageName(code: string | null | undefined): string | null {
  if (!code) return null
  if (languageNames === undefined) {
    try {
      languageNames = new Intl.DisplayNames(['uk'], { type: 'language' })
    } catch {
      languageNames = null
    }
  }
  try {
    return languageNames?.of(code) ?? code
  } catch {
    return code
  }
}

function dims(d: ListingDetails): string | null {
  const xs = [d.itemLength, d.itemWidth, d.itemHeight]
  if (xs.every((x) => x == null)) return null
  return `${xs.map((x) => (x == null ? '?' : num(x))).join(' × ')} ${unit(d.itemDimensionsUnit)}`.trim()
}

export interface DetailRow {
  label: string
  value: string
  glossary?: GlossaryKey
}

/** The "Деталі" rows in plain Ukrainian; empty values are skipped. Internal ids are in the technical data. */
export function detailRows(l: Listing): DetailRow[] {
  const d = l.details
  const rows: Array<[string, string | null | undefined, GlossaryKey?]> = [
    ['Тип товару', d?.listingType ? (TYPE_LABEL[d.listingType] ?? d.listingType) : null, 'listing.listingType'],
    ['Хто зробив', d?.whoMade ? (WHO_LABEL[d.whoMade] ?? d.whoMade) : null, 'whoMade'],
    ['Коли зроблено', whenMadeLabel(d?.whenMade), 'whenMade'],
    ['Матеріал для рукоділля', yesNo(d?.isSupply), 'supply'],
    ['Матеріали', d?.materials.length ? d.materials.join(', ') : null, 'materials'],
    ['Стиль', d?.styles.length ? d.styles.join(', ') : null, 'styles'],
    [
      'Час на підготовку',
      d && (d.processingMin != null || d.processingMax != null)
        ? d.processingMin != null && d.processingMin === d.processingMax
          ? `${d.processingMin} дн.`
          : `${d.processingMin ?? '?'}–${d.processingMax ?? '?'} дн.`
        : null,
      'processingTime'
    ],
    ['Персоналізація', yesNo(d?.isPersonalizable), 'personalization'],
    ['Індивідуальні замовлення', yesNo(d?.isCustomizable), 'listing.customizable'],
    ['Варіанти', yesNo(d?.hasVariations), 'variations'],
    ['Вага', d?.itemWeight != null ? `${num(d.itemWeight)} ${unit(d.itemWeightUnit)}`.trim() : null, 'listing.size'],
    ['Розміри', d ? dims(d) : null, 'listing.size'],
    ['Файли для завантаження', d?.fileData || null, 'listing.fileData'],
    ['Відео товару', l.videos?.length ? String(l.videos.length) : null, 'listing.videos'],
    ['Мова опису', languageName(d?.language), 'listing.language'],
    ['Автоподовження', yesNo(d?.shouldAutoRenew), 'autoRenew'],
    ['Артикул (SKU)', d?.skus.length ? d.skus.join(', ') : null, 'sku']
  ]
  return rows
    .filter((r) => r[1] != null && r[1] !== '')
    .map(([label, value, glossary]) => ({ label, value: value as string, glossary }))
}

/** One labelled row of a `<dl className="lm-rows">`, with an ⓘ when there is a glossary entry. */
function Row({ label, glossary, children, testId }: { label: ReactNode; glossary?: GlossaryKey; children: ReactNode; testId?: string }): JSX.Element {
  return (
    <div className="lm-row">
      <dt>
        <span>{label}</span>
        {glossary && <InfoTip glossary={glossary} size={13} />}
      </dt>
      <dd data-testid={testId}>{children}</dd>
    </div>
  )
}

/**
 * A collapsible section with the same card look as the features' live panels
 * (LazyDetails): icon, title, a one-line description visible while closed, a
 * summary on the right ("1 727 · ★ 4,73"), a chevron. `onToggle` fires on every
 * opening/closing — the sections load their data lazily.
 */
function Section({
  className,
  testId,
  icon,
  title,
  meta,
  desc,
  onToggle,
  children
}: {
  className?: string
  testId?: string
  icon: IconName
  title: ReactNode
  meta?: ReactNode
  desc?: ReactNode
  onToggle?: (open: boolean) => void
  children: ReactNode
}): JSX.Element {
  return (
    <details
      className={'feature-details lm-collapse' + (className ? ' ' + className : '')}
      data-testid={testId}
      onToggle={(e) => onToggle?.((e.target as HTMLDetailsElement).open)}
    >
      <summary className="feature-summary">
        <span className="feature-summary-icon">
          <Icon name={icon} size={16} />
        </span>
        <span className="feature-summary-text">
          <span className="feature-summary-label">{title}</span>
          {desc && <span className="feature-summary-desc">{desc}</span>}
        </span>
        {meta != null && meta !== '' && <span className="lm-section-meta">{meta}</span>}
        <Icon name="chevron-down" size={16} className="feature-summary-chevron" />
      </summary>
      <div className="feature-body">{children}</div>
    </details>
  )
}

/** A table column header with its ⓘ. */
function Th({ children, glossary }: { children: ReactNode; glossary?: GlossaryKey }): JSX.Element {
  return (
    <th>
      <span className="lm-th">
        {children}
        {glossary && <InfoTip glossary={glossary} size={12} />}
      </span>
    </th>
  )
}

/** "14 · ★ 4,75" (the average rating after the star; "≥" while the history is partial). */
function ReviewsCell({ count, avg, partial }: { count: number; avg: number | null | undefined; partial?: boolean }): JSX.Element {
  return (
    <>
      {formatReviewCount(count, partial)}
      {avg != null && (
        <>
          {' · '}
          <Icon name="star" size={11} className="lm-star" />
          <span className="sr-only">оцінка</span> {formatRating(avg)}
        </>
      )}
    </>
  )
}

function Failed({ children, onRetry, busy, testId }: { children: ReactNode; onRetry: () => void; busy?: boolean; testId?: string }): JSX.Element {
  return (
    <div data-testid={testId}>
      <Callout
        tone="error"
        compact
        action={
          <Button size="sm" variant="subtle" icon="refresh" disabled={busy} onClick={onRetry}>
            Спробувати ще
          </Button>
        }
      >
        {children}
      </Callout>
    </div>
  )
}

/** The stored API object, fetched from main only when the section is opened — with Etsy's internal ids. */
function TechData({ listing: l }: { listing: Listing }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState<string | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const id = l.listingId
  const d = l.details
  useEffect(() => {
    if (!open || raw !== undefined) return
    let alive = true
    setFailed(false)
    window.api
      .getListingRaw(id)
      .then((r) => {
        if (alive) setRaw(r)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [open, raw, id, attempt])
  let pretty = raw ?? ''
  try {
    if (raw) pretty = JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    // not JSON — shown as stored
  }
  const ids: Array<[string, number | null | undefined, GlossaryKey]> = [
    ['Номер товару', id, 'listing.internalId'],
    ['Номер категорії', d?.taxonomyId, 'category'],
    ['Номер розділу магазину', d?.shopSectionId, 'section'],
    ['Номер профілю доставки', d?.shippingProfileId, 'shippingProfile'],
    ['Номер правил повернення', d?.returnPolicyId, 'returnPolicy']
  ]
  return (
    <Section
      className="raw-json"
      testId="listing-advanced"
      icon="database"
      title="Для досвідчених: технічні дані"
      desc={GLOSSARY['listing.advanced'].short}
      onToggle={setOpen}
    >
      <dl className="lm-rows lm-rows--ids">
        {ids
          .filter(([, v]) => v != null)
          .map(([label, v, g]) => (
            <Row key={label} label={label} glossary={g}>
              <span className="num">{v}</span>
            </Row>
          ))}
      </dl>
      <h4 className="lm-subhead">Повна відповідь Etsy про товар</h4>
      {open &&
        (raw === undefined && failed ? (
          <Failed testId="raw-json-failed" onRetry={() => setAttempt((n) => n + 1)}>
            Не вдалося завантажити технічні дані.
          </Failed>
        ) : (
          <pre className="lm-raw" data-testid="raw-json">
            {raw === undefined ? 'Завантаження…' : raw === null ? 'Немає збережених даних.' : pretty}
          </pre>
        ))}
    </Section>
  )
}

/** Popularity per successful scan (`listing_stats`), loaded only when opened. */
function StatsHistory({ listingId }: { listingId: number }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [points, setPoints] = useState<ListingStatsPoint[] | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!open || points !== undefined) return
    let alive = true
    setFailed(false)
    window.api
      .getListingStats(listingId)
      .then((p) => {
        if (alive) setPoints(p)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [open, points, listingId, attempt])
  const rows = points ? [...points].reverse() : []
  return (
    <Section
      className="stats-details"
      icon="stats"
      title="Історія популярності"
      meta={points?.length ? `сканувань: ${points.length}` : undefined}
      desc={GLOSSARY['listing.popularityHistory'].short}
      onToggle={setOpen}
    >
      {open &&
        (points === undefined ? (
          failed ? (
            <Failed testId="stats-history-failed" onRetry={() => setAttempt((n) => n + 1)}>
              Не вдалося завантажити історію популярності.
            </Failed>
          ) : (
            <Loading inline />
          )
        ) : points.length === 0 ? (
          <p className="lm-empty">Ще немає даних — вони з’являються після кожного сканування.</p>
        ) : (
          <div className="lm-table-wrap" aria-label="Найновіше сканування — зверху">
            <table className="stats-history lm-table" data-testid="stats-history">
              <thead>
                <tr>
                  <Th glossary="scan">Сканування</Th>
                  <Th glossary="favorites">Обране</Th>
                  <Th glossary="views">Перегляди</Th>
                  <Th glossary="featuredRank">Вибране продавцем</Th>
                  <Th glossary="quantity">У наявності</Th>
                  <Th glossary="reviews">Відгуки</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.scanId}>
                    <td>{p.at != null ? formatDateTime(p.at) : `#${p.scanId}`}</td>
                    <td>{p.numFavorers != null ? formatCount(p.numFavorers) : '—'}</td>
                    <td>{p.views != null ? formatCount(p.views) : '—'}</td>
                    <td>{p.featuredRank != null && p.featuredRank >= 1 ? `№ ${p.featuredRank}` : '—'}</td>
                    <td>{p.quantity ?? '—'}</td>
                    <td>
                      {p.reviewCount != null ? (
                        <ReviewsCell count={p.reviewCount} avg={p.reviewAvg} partial={p.reviewsComplete === false} />
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </Section>
  )
}

/** "Акція −60% з 01.10 до 31.10" for an active discount; '' without one. */
export function promoText(bp: BuyerPrice | null | undefined, now: number = Date.now()): string {
  if (!bp || !hasActiveDiscount(bp)) return ''
  return ['Акція', discountLabel(bp), formatPromoPeriod(bp.discountStart, bp.discountEnd, now)]
    .filter(Boolean)
    .join(' ')
}

/**
 * The price like Etsy shows it to a buyer in the configured country (sale
 * price, original struck through, −N %, the promotion's dates), plus the
 * seller's base price (no VAT, no promotion) — the one the API's `price` is.
 */
export function PriceBlock({ listing: l }: { listing: Listing }): JSX.Element {
  const p = shownPrice(l)
  const bp = l.buyerPrice
  const base = formatPrice(l.priceAmount, l.priceDivisor, l.currency)
  const promo = promoText(bp)
  return (
    <section className="price-block lm-price" data-testid="price-block" aria-label="Ціна">
      <div className="lm-price-label">
        {bp ? (
          <>
            <span>Ціна для покупця</span>
            <InfoTip glossary="buyerPrice" size={13} />
          </>
        ) : (
          <>
            <span>Базова ціна продавця</span>
            <InfoTip glossary="basePrice" size={13} />
          </>
        )}
      </div>
      <div className="listing-price">
        {p.kind === 'discounted' ? (
          <NowPrice>{formatPrice(p.amount, p.divisor, p.currency)}</NowPrice>
        ) : (
          <span>{formatPrice(p.amount, p.divisor, p.currency)}</span>
        )}
        {p.kind === 'discounted' && bp?.original && <WasPrice>{formatMoney(bp.original, bp.currency)}</WasPrice>}
        {p.kind === 'discounted' && <span className="badge-discount">{discountLabel(bp)}</span>}
      </div>
      {promo && (
        <div className="promo-line" data-testid="promo-line">
          <Icon name="percent" size={14} />
          <span>{promo}</span>
          <InfoTip glossary="listing.promoPeriod" size={13} />
        </div>
      )}
      <p className="lm-price-note" data-testid="price-note">
        {bp
          ? `Ціна для покупця: ${countryLabel(bp.country)}, ${buyerPriceIncludes(bp)}.`
          : 'Ціна для покупця невідома — показано базову ціну продавця (без ПДВ і без знижок).'}
      </p>
      {bp && (
        <dl className="lm-rows lm-price-rows">
          <Row label="Базова ціна продавця" glossary="basePrice" testId="base-price">
            {base} <span className="lm-dim">(без ПДВ і знижок)</span>
          </Row>
          {bp.base && (
            <Row label="З ПДВ, до знижки" glossary="listing.priceWithVat">
              {formatMoney(bp.base, bp.currency)}
            </Row>
          )}
          {bp.discountAmount && hasActiveDiscount(bp) && (
            <Row label="Знижка" glossary="listing.discountAmount">
              {formatMoney(bp.discountAmount, bp.currency)}
            </Row>
          )}
          {(bp.shipping || bp.isFreeShipping) && (
            <Row label={`Доставка (${bp.country})`} glossary="shippingCost">
              {bp.isFreeShipping ? 'безкоштовно' : formatMoney(bp.shipping, bp.currency)}
            </Row>
          )}
        </dl>
      )}
    </section>
  )
}

const PROMO_STATUS: Record<string, string> = {
  ended: 'закінчилась',
  replaced: 'змінилась на іншу',
  country: 'змінено країну покупця',
  removed: 'товар зник з магазину',
  unknown: 'закінчилась (коли саме — невідомо)'
}

/** "Ціни та акції": the listing's promotions and the price at every scan, loaded only when opened. */
function PriceHistory({ listingId }: { listingId: number }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{ promos: Promotion[]; points: ListingStatsPoint[] } | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!open || data !== undefined) return
    let alive = true
    setFailed(false)
    Promise.all([window.api.getListingPromotions(listingId), window.api.getListingStats(listingId)])
      .then(([promos, points]) => {
        if (alive) setData({ promos, points })
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [open, data, listingId, attempt])
  const priced = data ? [...data.points].reverse().filter((p) => p.price) : []
  return (
    <Section
      className="price-details"
      icon="percent"
      title="Ціни та акції"
      meta={data ? (data.promos.length ? `акцій: ${data.promos.length}` : 'акцій не було') : undefined}
      desc={GLOSSARY['listing.priceHistory'].short}
      onToggle={setOpen}
    >
      {open &&
        (data === undefined ? (
          failed ? (
            <Failed testId="price-history-failed" onRetry={() => setAttempt((n) => n + 1)}>
              Не вдалося завантажити історію цін.
            </Failed>
          ) : (
            <Loading inline />
          )
        ) : (
          <>
            <h4 className="lm-subhead">
              Акції <InfoTip glossary="promotion" size={13} />
            </h4>
            {data.promos.length === 0 ? (
              <p className="lm-empty">Акцій ще не було помічено.</p>
            ) : (
              <div className="lm-table-wrap">
                <table className="stats-history lm-table" data-testid="promotions-history">
                  <thead>
                    <tr>
                      <Th glossary="promotion">Знижка</Th>
                      <Th glossary="buyerPrice">Ціна</Th>
                      <Th glossary="listing.promoPeriod">Терміни акції</Th>
                      <Th glossary="listing.promoSeen">Коли помічено</Th>
                      <Th>Стан</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.promos.map((pr) => (
                      <tr key={pr.id}>
                        <td>
                          {pr.discountPercentage != null
                            ? `−${pr.discountPercentage}%`
                            : pr.discountAmount
                              ? `−${formatMoney(pr.discountAmount, pr.currency ?? '')}`
                              : '—'}
                        </td>
                        <td>
                          {formatMoney(pr.discounted, pr.currency ?? '')}
                          {pr.original && <WasPrice>{formatMoney(pr.original, pr.currency ?? '')}</WasPrice>}{' '}
                          <span className="lm-dim">{pr.country}</span>
                        </td>
                        <td>{formatPromoPeriod(pr.discountStart, pr.discountEnd) || '—'}</td>
                        <td>
                          {formatDateTime(pr.firstSeenAt)}
                          {pr.startKind === 'running' && <span className="lm-dim"> (уже тривала)</span>}
                          {pr.startKind === 'country' && <span className="lm-dim"> (після зміни країни)</span>}
                          {pr.endedAt != null && ` — ${formatDateTime(pr.endedAt)}`}
                        </td>
                        <td>
                          {pr.endedAt == null ? (
                            <Badge tone="accent">триває</Badge>
                          ) : (
                            (PROMO_STATUS[pr.endReason ?? 'ended'] ?? 'закінчилась')
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h4 className="lm-subhead">Ціна за скануваннями</h4>
            {priced.length === 0 ? (
              <p className="lm-empty">Ще немає даних — вони з’являються після кожного сканування.</p>
            ) : (
              <div className="lm-table-wrap">
                <table className="stats-history lm-table" data-testid="price-history">
                  <thead>
                    <tr>
                      <Th glossary="scan">Сканування</Th>
                      <Th glossary="basePrice">Ціна продавця</Th>
                      <Th glossary="buyerPrice">Для покупця</Th>
                      <Th glossary="promotion">Знижка</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {priced.map((pt) => {
                      const b = pt.buyerPrice
                      const shown = b ? (hasActiveDiscount(b) ? b.discounted : b.original) : null
                      return (
                        <tr key={pt.scanId}>
                          <td>{pt.at != null ? formatDateTime(pt.at) : `#${pt.scanId}`}</td>
                          <td>{formatMoney(pt.price, pt.price!.currency)}</td>
                          <td>{b ? `${formatMoney(shown, b.currency)} (${b.country})` : '—'}</td>
                          <td>{b ? discountLabel(b) || '—' : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ))}
    </Section>
  )
}

const REVIEWS_PAGE = 20

/** Five star icons (filled up to the rating), read as "Оцінка 4 з 5". */
function Stars({ rating }: { rating: number | null | undefined }): JSX.Element {
  const on = rating == null ? 0 : Math.round(rating)
  return (
    <span className="lm-stars" role="img" aria-label={rating == null ? 'Без оцінки' : `Оцінка ${formatRating(rating)} з 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" size={14} filled={i <= on} className={i <= on ? 'is-on' : 'is-off'} />
      ))}
    </span>
  )
}

/** One review: stars, date, language, plain text with its line breaks, the buyer's photo. */
function ReviewItem({ r }: { r: Review }): JSX.Element {
  const lang = languageName(r.language)
  return (
    <li className="review-item lm-review" data-testid="review-item">
      <div className="review-body">
        <div className="review-head">
          <Stars rating={r.rating} />
          <span className="lm-dim">{formatEtsyDate(r.createdAt)}</span>
          {lang && <span className="lm-dim">· {lang}</span>}
          {r.origin === 'new' && (
            <Badge tone="accent" hint={GLOSSARY.newReviews.short}>
              новий
            </Badge>
          )}
        </div>
        {r.text ? <div className="review-text">{r.text}</div> : <div className="lm-dim lm-review-empty">Покупець поставив оцінку без тексту.</div>}
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
  const loadMore = (offset: number): void => {
    setLoading(true)
    setFailed(false)
    window.api
      .getListingReviews(id, offset, REVIEWS_PAGE)
      .then((page) => {
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
    <Section
      className="reviews-details"
      icon="review"
      title="Збережені відгуки"
      meta={
        <>
          {formatReviewCount(listing.reviewCount, listing.reviewsPartial)}
          {listing.reviewAvg != null && (
            <>
              {' · '}
              <Icon name="star" size={12} className="lm-star" /> {formatRating(listing.reviewAvg)}
            </>
          )}
        </>
      }
      desc={GLOSSARY['listing.reviewsSection'].short}
      onToggle={setOpen}
    >
      {listing.reviewsPartial && (
        <Callout tone="info" compact role="note">
          Історія відгуків магазину ще завантажується — показано не всі.
        </Callout>
      )}
      {open &&
        (items === undefined ? (
          failed ? (
            <Failed busy={loading} onRetry={() => loadMore(0)}>
              Не вдалося завантажити відгуки.
            </Failed>
          ) : (
            <Loading inline />
          )
        ) : items.length === 0 ? (
          <p className="lm-empty">Відгуків ще немає.</p>
        ) : (
          <>
            <ul className="review-list lm-reviews" data-testid="listing-reviews">
              {items.map((r) => (
                <ReviewItem key={r.id} r={r} />
              ))}
            </ul>
            {failed && (
              <Callout tone="error" compact>
                Не вдалося завантажити відгуки.
              </Callout>
            )}
            {items.length < total && (
              <Button size="sm" variant="subtle" icon="chevron-down" busy={loading} onClick={() => loadMore(items.length)}>
                Показати ще ({formatCount(total - items.length)})
              </Button>
            )}
          </>
        ))}
    </Section>
  )
}

/** The photos: a big one with ‹ › and a counter, and a scrolling strip of thumbnails. */
/** Controls and scrollers that use ←/→ themselves — the gallery leaves those keys to them. */
const OWNS_ARROWS =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role=radio], [role=radiogroup], [role=slider], [role=tab], [role=tablist], ' +
  '[role=menu], [role=menuitem], [role=listbox], [role=option], [role=combobox], [role=spinbutton], [role=grid], .lm-table-wrap, .lm-raw'

function Gallery({ images, title }: { images: ListingImage[]; title: string }): JSX.Element {
  const [idx, setIdx] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const n = images.length
  const img = images[idx] ?? images[0]
  const show = (i: number): void => setIdx(((i % n) + n) % n)
  // Keep the chosen thumbnail in view (horizontally only — never scroll the dialog).
  useEffect(() => {
    const c = strip.current
    const el = c?.children[idx] as HTMLElement | undefined
    if (!c || !el) return
    if (el.offsetLeft < c.scrollLeft) c.scrollLeft = el.offsetLeft - 4
    else if (el.offsetLeft + el.offsetWidth > c.scrollLeft + c.clientWidth) c.scrollLeft = el.offsetLeft + el.offsetWidth - c.clientWidth + 4
  }, [idx])
  // ←/→ anywhere in this listing window (the dialog itself has focus right after opening),
  // except in fields, widgets that move with arrows, sideways scrollers and windows on top.
  useEffect(() => {
    if (n < 2) return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const dialog = root.current?.closest('.ui-modal')
      const t = e.target
      if (!dialog || !(t instanceof Element) || t.closest('.ui-modal') !== dialog || t.closest(OWNS_ARROWS)) return
      e.preventDefault()
      const step = e.key === 'ArrowLeft' ? -1 : 1
      setIdx((i) => (i + step + n) % n)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [n])
  return (
    <div className="gallery lm-gallery" role="group" aria-label="Фото товару" ref={root}>
      <div className="gallery-main">
        {img ? (
          <img src={imageSrc(img, 'fullxfull')} alt={img.alt || title} referrerPolicy="no-referrer" />
        ) : (
          <div className="lm-noimg">
            <Icon name="image" size={32} />
            <span className="no-img">без фото</span>
          </div>
        )}
        {n > 1 && (
          <>
            <button type="button" className="lm-gallery-nav is-prev" aria-label="Попереднє фото" title="Попереднє фото (←)" onClick={() => show(idx - 1)}>
              <Icon name="chevron-left" size={20} />
            </button>
            <button type="button" className="lm-gallery-nav is-next" aria-label="Наступне фото" title="Наступне фото (→)" onClick={() => show(idx + 1)}>
              <Icon name="chevron-right" size={20} />
            </button>
            <span className="lm-gallery-count num" aria-live="polite">
              {idx + 1} / {n}
            </span>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="gallery-thumbs" ref={strip}>
          {images.map((im, i) => (
            <button
              key={im.id}
              type="button"
              className={`gallery-thumb${i === idx ? ' active' : ''}`}
              onClick={() => show(i)}
              aria-label={`Фото ${i + 1}`}
              aria-current={i === idx ? 'true' : undefined}
            >
              <img src={imageSrc(im, '75x75')} alt="" referrerPolicy="no-referrer" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A long description is folded to a few lines with "Показати весь опис". */
const LONG_DESCRIPTION = 700

function Description({ text }: { text: string }): JSX.Element {
  const long = text.length > LONG_DESCRIPTION || text.split('\n').length > 14
  const [expanded, setExpanded] = useState(false)
  const folded = long && !expanded
  return (
    <section className="lm-block">
      <h3 className="lm-block-title">
        Опис <InfoTip glossary="listing.description" size={13} />
      </h3>
      {text.trim() ? (
        <>
          <div id="lm-description" className={'description' + (folded ? ' is-folded' : '')} data-testid="listing-description">
            {text}
          </div>
          {long && (
            <Button
              size="sm"
              variant="ghost"
              icon={expanded ? 'chevron-up' : 'chevron-down'}
              aria-expanded={expanded}
              aria-controls="lm-description"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Згорнути опис' : 'Показати весь опис'}
            </Button>
          )}
        </>
      ) : (
        <p className="lm-empty" data-testid="listing-description">
          Продавець не додав опису.
        </p>
      )}
    </section>
  )
}

/** Popularity tiles: favourites, views, reviews, stock, featured position. */
function Popularity({ listing: l }: { listing: Listing }): JSX.Element {
  const since = 'Зміна з попереднього сканування'
  return (
    <section className="lm-block" aria-label="Популярність">
      <h3 className="lm-block-title">
        Популярність <InfoTip glossary="listing.popularity" size={13} />
      </h3>
      <div className="lm-stats">
        {l.numFavorers != null && (
          <div data-testid="fact-favorers">
            <Stat compact icon="heart" label="Обране" glossary="favorites" value={formatCount(l.numFavorers)} delta={l.favorersDelta || null} deltaHint={since} />
          </div>
        )}
        {l.views != null && (
          <div data-testid="fact-views">
            <Stat compact icon="eye" label="Перегляди" glossary="views" value={formatCount(l.views)} delta={l.viewsDelta || null} deltaHint={since} />
          </div>
        )}
        {l.reviewCount != null && l.reviewCount > 0 && (
          <div data-testid="fact-reviews">
            <Stat
              compact
              icon="review"
              label="Відгуки"
              glossary={l.reviewsPartial ? 'reviewsPartial' : 'reviews'}
              value={formatReviewCount(l.reviewCount, l.reviewsPartial)}
              delta={l.reviewsNew != null && l.reviewsNew > 0 ? `+${formatCount(l.reviewsNew)} нових` : null}
              deltaHint="Нові відгуки з попереднього сканування"
              caption={l.reviewAvg != null ? `оцінка ${formatRating(l.reviewAvg)} з 5` : undefined}
            />
          </div>
        )}
        <div data-testid="fact-quantity">
          <Stat compact icon="box" label="У наявності" glossary="quantity" value={formatCount(l.quantity)} caption="шт." />
        </div>
        {l.featuredRank != null && l.featuredRank > 0 && (
          <div data-testid="fact-featured">
            <Stat compact icon="star" label="Вибране продавцем" glossary="featuredRank" value={`№ ${l.featuredRank}`} caption="місце нагорі магазину" />
          </div>
        )}
      </div>
    </section>
  )
}

function Dates({ listing: l }: { listing: Listing }): JSX.Element {
  const d = l.details
  return (
    <section className="lm-block" aria-label="Дати">
      <h3 className="lm-block-title">Дати</h3>
      <dl className="lm-rows" data-testid="listing-dates">
        {d?.originalCreatedAt != null && (
          <Row label="Уперше виставлено на Etsy" glossary="listing.createdOnEtsy">
            {formatEtsyDate(d.originalCreatedAt)}
          </Row>
        )}
        <Row label="Розміщено або поновлено" glossary="listing.renewedOnEtsy">
          {formatEtsyDate(l.etsyCreatedAt)}
        </Row>
        <Row label="Змінено на Etsy" glossary="listing.updatedOnEtsy">
          {formatEtsyDate(l.etsyUpdatedAt)}
        </Row>
        {d?.endingAt != null && (
          <Row label="Розміщення діє до" glossary="listing.endingAt">
            {formatEtsyDate(d.endingAt)}
          </Row>
        )}
        <Row label="Програма вперше побачила" glossary="listing.firstSeen">
          {formatDateTime(l.firstSeenAt)}
        </Row>
        <Row
          label={l.removedAt != null ? 'Востаннє був у магазині' : 'Останнє сканування'}
          glossary={l.removedAt != null ? 'listing.lastSeen' : 'listing.lastScan'}
        >
          {formatDateTime(l.lastSeenAt)}
        </Row>
      </dl>
    </section>
  )
}

function Details({ listing: l }: { listing: Listing }): JSX.Element | null {
  const rows = detailRows(l)
  const personalization = l.details?.personalization ?? []
  if (rows.length === 0) return null
  return (
    <section className="lm-block listing-details" data-testid="listing-details">
      <h3 className="lm-block-title">Деталі</h3>
      <dl className="lm-rows">
        {rows.map((r) => (
          <Row key={r.label} label={r.label} glossary={r.glossary}>
            {r.value}
          </Row>
        ))}
      </dl>
      {personalization.length > 0 && (
        <div className="personalization lm-personalization">
          <h4 className="lm-subhead">
            Питання персоналізації <InfoTip glossary="listing.personalizationQuestions" size={13} />
          </h4>
          <ul>
            {personalization.map((q, i) => (
              <li key={q.questionId ?? i}>
                <span className="lm-q">{q.text}</span>
                {q.required && <Badge tone="warn">обовʼязково</Badge>}
                {q.instructions && <div className="lm-dim">{q.instructions}</div>}
                {q.options.length > 0 && <div className="lm-dim">Варіанти: {q.options.join(' · ')}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Tags({ tags }: { tags: string[] }): JSX.Element | null {
  if (tags.length === 0) return null
  return (
    <section className="lm-block" aria-label="Теги">
      <h3 className="lm-block-title">
        Теги <InfoTip glossary="tags" size={13} />
        <span className="lm-count">{tags.length}</span>
      </h3>
      <ul className="lm-tags">
        {tags.map((t) => (
          <li key={t} className="lm-tag">
            {t}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Everything inside the dialog for one listing — remounted (fresh state, closed sections) for another one. */
function ListingBody({ listing: l, mine }: { listing: Listing; mine: boolean }): JSX.Element {
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const body = top.current?.closest('.ui-modal-body')
    if (body) body.scrollTop = 0
  }, [])
  return (
    <div className="lm-layout" ref={top}>
      <div className="lm-grid">
        <div className="lm-media">
          <Gallery images={l.images} title={l.title} />
        </div>
        <div className="lm-info listing-info">
          {l.removedAt != null && (
            <Callout tone="warn" compact title={`Товар зник з магазину ${formatDateTime(l.removedAt)}`}>
              Його більше немає в продажу. Нижче — дані з останнього сканування, коли він ще був у магазині.
            </Callout>
          )}
          <PriceBlock listing={l} />
          <Popularity listing={l} />
          <Tags tags={l.tags} />
          <Description text={l.description} />
          <Details listing={l} />
          <Dates listing={l} />
        </div>
      </div>

      <div className="lm-more">
        <h3 className="lm-group-title">Історія</h3>
        <div className="lm-sections">
          <ReviewsSection listing={l} />
          <PriceHistory listingId={l.listingId} />
          <StatsHistory listingId={l.listingId} />
        </div>
        {LISTING_PANELS.length > 0 && (
          <>
            <h3 className="lm-group-title">
              Свіжі дані з Etsy <InfoTip glossary="listing.liveData" size={13} />
            </h3>
            <div className="lm-sections">
              {LISTING_PANELS.map((p) => {
                const meta = panelMeta(p)
                return (
                  <LazyDetails key={p.id} label={p.label} description={meta.description} icon={meta.icon} testId={`listing-panel-${p.id}`}>
                    {() => <p.Component listing={l} mine={mine} />}
                  </LazyDetails>
                )
              })}
            </div>
          </>
        )}
        <div className="lm-sections lm-sections--advanced">
          <TechData listing={l} />
        </div>
      </div>
    </div>
  )
}

/** The listing window (opened from a card, the scan results, the history or the statistics). */
export function ListingModal(): JSX.Element | null {
  const l = useStore((s) => s.detailListing)
  const openListing = useStore((s) => s.openListing)
  const etsyAuth = useStore((s) => s.etsyAuth)
  const shopName = useStore((s) => (l ? s.shops.find((x) => x.id === l.shopId)?.shopName : undefined))
  if (!l) return null
  const close = (): void => openListing(null)
  const state = l.removedAt != null ? { label: 'зник з магазину', tone: 'danger' as BadgeTone } : l.state ? STATE[l.state] : undefined

  return (
    <Modal
      size="xl"
      onClose={close}
      className="listing-modal"
      title={
        <span className="lm-title clamp-2" title={l.title}>
          {l.title}
        </span>
      }
      subtitle={
        <span className="lm-subtitle">
          {shopName && (
            <span className="lm-shop">
              <Icon name="store" size={14} />
              <span className="truncate">{shopName}</span>
            </span>
          )}
          {state && (
            <Badge tone={state.tone} hint={GLOSSARY['listing.state'].short}>
              {state.label}
            </Badge>
          )}
        </span>
      }
      footer={
        <>
          <span className="ui-modal-foot-start lm-foot-note truncate" title="Усі числа — станом на це сканування">
            Дані станом на {formatDateTime(l.lastSeenAt)}
          </span>
          <ExternalLink href={l.url} className={buttonClass('primary')}>
            <Icon name="external" size={16} />
            <span className="ui-btn-text">Відкрити на Etsy</span>
          </ExternalLink>
          <Button onClick={close}>Закрити</Button>
        </>
      }
    >
      <ListingBody key={l.listingId} listing={l} mine={l.shopId === ownShopId({ etsyAuth })} />
    </Modal>
  )
}
