import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type {
  ShopStatsPayload,
  ShopSummary,
  StatsRange,
  StatsReviewBucket,
  StatsScanPoint,
  StatsTopRow
} from '@shared/types'
import type { GlossaryKey } from '@shared/glossary'
import { formatCount, formatDelta, formatRating } from '@shared/format'
import { photoRef } from '@shared/claudeRef'
import { fullDate, fullDateTime, shortDate, timeDomain } from '../chartScale'
import { plural } from './ChangeList'
import { imageSrc } from '../imageUrl'
import { useStore } from '../store'
import {
  Badge,
  Button,
  Callout,
  Icon,
  InfoTip,
  Loading,
  Modal,
  Segmented,
  Spinner,
  Stat,
  ZoomButton,
  type IconName,
  type SegmentedOption
} from '../ui'
import { BarChart, Legend, LineChart, Sparkline, StackedBarChart, type StackSeries } from './Charts'

export const RANGE_LABEL: Record<StatsRange, string> = {
  all: 'Усе',
  '90d': '90 днів',
  '30d': '30 днів',
  '7d': '7 днів'
}

const RANGE_OPTIONS: ReadonlyArray<SegmentedOption<StatsRange>> = [
  { value: 'all', label: RANGE_LABEL.all, hint: 'Уся історія — з першого сканування магазину' },
  { value: '90d', label: RANGE_LABEL['90d'], hint: 'Останні три місяці' },
  { value: '30d', label: RANGE_LABEL['30d'], hint: 'Останній місяць' },
  { value: '7d', label: RANGE_LABEL['7d'], hint: 'Останній тиждень' }
]

/** Weekly bars until there would be more than this many; then monthly (switchable). */
const MAX_AUTO_WEEKS = 120

export const NEED_TWO_SCANS = 'Потрібно щонайменше 2 сканування'
const NO_SCANS = 'У цьому періоді немає успішних сканувань.'
const NO_DATA = 'Немає даних'
const NO_STATS_HINT =
  'Старіші сканування цих чисел не записували — вони з’являться після наступного сканування.'

export const NO_BUYER_PRICES_HINT =
  'Сканування цього періоду не знають цін для покупця (з ПДВ і знижками). Вони з’являться після наступного сканування, якщо Etsy їх віддасть.'

export const NO_LISTINGS = 'У магазині немає товарів у продажу'

/** Every scan of the period (anchor included) found no active listing: nothing to sum or rank. */
export function hasNoListings(data: ShopStatsPayload): boolean {
  const s = withAnchor(data)
  return s.length > 0 && s.every((x) => x.listingActiveCount === 0)
}

const noListingsEmpty = (what: string): JSX.Element => (
  <Empty title={NO_LISTINGS} icon="box">
    {what}
  </Empty>
)

const num = (v: number, digits = 0): string => v.toLocaleString('uk-UA', { maximumFractionDigits: digits })
const perDayText = (v: number): string => num(v, Math.abs(v) < 10 ? 1 : 0)

// ------------------------------------------------------------ building blocks

/** What a chart shows when it can't draw: why, and what to do. */
function Empty({
  title,
  children,
  icon = 'chart'
}: {
  title: ReactNode
  children?: ReactNode
  icon?: IconName
}): JSX.Element {
  return (
    <div className="chart-empty">
      <span className="chart-empty-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <div className="chart-empty-main">
        <div className="chart-empty-title">{title}</div>
        {children && <div className="chart-empty-text">{children}</div>}
      </div>
    </div>
  )
}

const noScansEmpty = (): JSX.Element => (
  <Empty title={NO_SCANS} icon="calendar">
    Виберіть довший період угорі або проскануйте магазин ще раз.
  </Empty>
)

/** A card: a title (+ ⓘ), one or two plain sentences on what it shows, optional controls, the chart(s). */
function Card({
  title,
  glossary,
  desc,
  wide,
  children,
  testId,
  actions
}: {
  title: string
  glossary?: GlossaryKey
  /** What the card shows and how to read it. */
  desc?: ReactNode
  wide?: boolean
  children: ReactNode
  testId?: string
  /** Controls at the right of the header (e.g. weeks/months). */
  actions?: ReactNode
}): JSX.Element {
  const id = useId()
  return (
    <section className={`stats-card${wide ? ' wide' : ''}`} data-testid={testId} aria-labelledby={id}>
      <header className="stats-card-head">
        <div className="stats-card-titles">
          <div className="stats-card-title-row">
            <h4 id={id}>{title}</h4>
            {glossary && <InfoTip glossary={glossary} />}
          </div>
          {desc && <p className="stats-card-desc">{desc}</p>}
        </div>
        {actions && <div className="stats-card-actions">{actions}</div>}
      </header>
      {children}
    </section>
  )
}

/** The title of a second chart inside a card (+ ⓘ, a badge, a caption under it). */
function SubTitle({
  children,
  glossary,
  badge,
  caption
}: {
  children: ReactNode
  glossary?: GlossaryKey
  badge?: ReactNode
  caption?: ReactNode
}): JSX.Element {
  return (
    <div className="chart-subhead">
      <div className="chart-subhead-row">
        <h5 className="chart-subtitle">{children}</h5>
        {glossary && <InfoTip glossary={glossary} />}
        {badge}
      </div>
      {caption && <p className="chart-caption">{caption}</p>}
    </div>
  )
}

/** The accessible twin of a chart: every plotted value as a table, collapsed by default. */
function DataTable({
  head,
  rows,
  note,
  caption
}: {
  head: string[]
  rows: ReactNode[][]
  /** A footnote under the table (e.g. what "*" means). */
  note?: string
  /** What the table lists (screen readers). */
  caption?: string
}): JSX.Element | null {
  // The ⓘ sits right after the summary but outside it (a button inside a
  // <summary> would be a control inside a control), placed by its measured width.
  const summary = useRef<HTMLElement>(null)
  const [tipX, setTipX] = useState(0)
  useLayoutEffect(() => {
    const w = summary.current?.offsetWidth ?? 0
    if (w !== tipX) setTipX(w)
  })
  if (!rows.length) return null
  return (
    <div className="chart-table-wrap">
      <details className="chart-table">
        <summary ref={summary}>
          <Icon name="chevron-right" size={14} className="chart-table-chevron" />
          <Icon name="list" size={14} />
          <span>Дані ({rows.length})</span>
        </summary>
        <div className="chart-table-scroll">
          <table className="stats-table">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead>
              <tr>
                {head.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {note && <div className="chart-table-note">{note}</div>}
      </details>
      <span className="chart-table-tip" style={{ left: tipX }}>
        <InfoTip glossary="stats.dataTable" size={13} />
      </span>
    </div>
  )
}

const cell = (v: number | null | undefined, digits = 0): string => (v == null ? '—' : num(v, digits))

// --------------------------------------------------------------- KPI tiles

/** The period's anchor scan (the latest before it), then its own scans. */
export function withAnchor(data: ShopStatsPayload): StatsScanPoint[] {
  return data.anchor ? [data.anchor, ...data.scans] : data.scans
}

function firstLast(scans: StatsScanPoint[], pick: (s: StatsScanPoint) => number | null) {
  const known = scans.filter((s) => pick(s) != null)
  const last = known[known.length - 1]
  const first = known[0]
  return {
    value: last ? pick(last) : null,
    known: known.length,
    delta: known.length >= 2 ? pick(last)! - pick(first)! : null,
    from: known.length >= 2 ? first.at : null,
    to: known.length >= 2 ? last.at : null,
    span: known.length >= 2 ? `Зміна: ${fullDateTime(first.at)} → ${fullDateTime(last.at)}` : undefined
  }
}

/** "23.10, 04:15" this year, else "23.10.2025" — short enough for a tile caption. */
function sinceText(t: number): string {
  return new Date(t).getFullYear() === new Date().getFullYear() ? fullDateTime(t).replace(/\.\d{4},/, ',') : fullDate(t)
}

function KpiTile({
  label,
  glossary,
  value,
  fl,
  digits = 0,
  format = (v) => num(v, digits)
}: {
  label: string
  glossary: GlossaryKey
  value?: string
  fl: ReturnType<typeof firstLast>
  digits?: number
  format?: (v: number) => string
}): JSX.Element {
  const rounded = fl.delta == null ? null : Math.round(fl.delta * 10 ** digits) / 10 ** digits
  const caption =
    fl.known === 0
      ? 'немає даних'
      : rounded == null
        ? 'поки одне сканування'
        : rounded === 0
          ? `без змін з ${sinceText(fl.from!)} до ${sinceText(fl.to!)}`
          : `зміна з ${sinceText(fl.from!)} до ${sinceText(fl.to!)}`
  return (
    <Stat
      label={label}
      glossary={glossary}
      value={value ?? (fl.value == null ? '—' : format(fl.value))}
      delta={rounded ? rounded : null}
      deltaHint={fl.span}
      caption={caption}
    />
  )
}

function KpiRow({ data }: { data: ShopStatsPayload }): JSX.Element {
  const s = withAnchor(data)
  const r = data.reviews
  const rating = firstLast(s, (x) => x.reviewAverage)
  return (
    <div className="stats-kpis" data-testid="stats-kpis">
      <KpiTile label="Продажі магазину" glossary="salesCount" fl={firstLast(s, (x) => x.transactionSoldCount)} />
      <KpiTile label="Обране магазину" glossary="shopFavorers" fl={firstLast(s, (x) => x.numFavorers)} />
      <KpiTile label="Відгуків у магазині" glossary="stats.reviewsOnEtsy" fl={firstLast(s, (x) => x.reviewCount)} />
      {/* A shop without reviews reports an average of 0 — there is no rating yet. */}
      {rating.value === 0 ? (
        <Stat label="Рейтинг магазину" glossary="stats.ratingOnEtsy" value="—" caption="оцінок ще немає" />
      ) : (
        <KpiTile label="Рейтинг магазину" glossary="stats.ratingOnEtsy" fl={rating} digits={2} format={(v) => formatRating(v)} />
      )}
      <KpiTile label="Активних товарів" glossary="stats.activeCount" fl={firstLast(s, (x) => x.listingActiveCount)} />
      {/* The reviews the app stored (not Etsy's count): its own average, named so — it can differ from the rating. */}
      <Stat
        label={data.range === 'all' ? 'Відгуків збережено' : 'Відгуків за період'}
        glossary={data.range === 'all' ? 'stats.reviewsStored' : 'stats.reviewsInPeriod'}
        value={r.synced ? (r.complete ? '' : '≥ ') + formatCount(r.total) : '—'}
        caption={
          !r.synced
            ? 'відгуки ще не завантажено'
            : r.avg != null
              ? `середня за ними ${formatRating(r.avg)}`
              : 'відгуків немає'
        }
      />
    </div>
  )
}

// ------------------------------------------------------- scan-based charts

function ScanLine({
  label,
  data,
  pick,
  domain,
  digits = 0,
  minSpan,
  ceil,
  emptyHint = NO_STATS_HINT
}: {
  label: string
  data: ShopStatsPayload
  pick: (s: StatsScanPoint) => number | null
  domain: [number, number]
  digits?: number
  minSpan?: number
  ceil?: number
  /** Shown when no scan of the period knows the value. */
  emptyHint?: ReactNode
}): JSX.Element {
  if (!data.scans.length) return noScansEmpty()
  const series = withAnchor(data)
  const points = series.map((s) => ({ t: s.at, v: pick(s) }))
  const known = series.filter((s) => pick(s) != null)
  if (!known.length) return <Empty title={NO_DATA} icon="info">{emptyHint}</Empty>
  if (known.length < 2) {
    // One point is a stat, not a chart (the KPI row shows it too).
    const s = known[0]
    return (
      <Empty title={NEED_TWO_SCANS}>
        Графік покаже, як змінюється число від сканування до сканування.{' '}
        <span className="chart-empty-now">
          Зараз: <b className="empty-value">{num(pick(s)!, digits)}</b> ({fullDateTime(s.at)})
        </span>
      </Empty>
    )
  }
  return (
    <LineChart
      label={label}
      points={points}
      domain={domain}
      digits={digits}
      minSpan={minSpan}
      ceil={ceil}
      format={(v) => num(v, digits)}
      dateText={(t) => fullDateTime(t)}
    />
  )
}

/** Table rows, newest first; the anchor scan (before the period) is marked. */
function scanRows(data: ShopStatsPayload, cols: Array<(s: StatsScanPoint) => string>): ReactNode[][] {
  return [...withAnchor(data)]
    .reverse()
    .map((s) => [
      fullDateTime(s.at) + (s === data.anchor ? ' (до періоду)' : ''),
      ...cols.map((c) => c(s))
    ])
}

function SalesCard({ data, domain }: { data: ShopStatsPayload; domain: [number, number] }): JSX.Element {
  const known = withAnchor(data).filter((s) => s.transactionSoldCount != null)
  const rate = data.salesRate
  let rateBody: JSX.Element
  if (!data.scans.length) rateBody = noScansEmpty()
  else if (known.length < 2)
    rateBody = <Empty title={NEED_TWO_SCANS}>Оцінка з’явиться, коли буде з чим порівняти.</Empty>
  else if (!rate.length)
    rateBody = (
      <Empty title={`${NEED_TWO_SCANS} з інтервалом щонайменше 1 год`} icon="clock">
        Сканування надто близькі в часі — продажів між ними замало для оцінки.
      </Empty>
    )
  else if (rate.every((r) => r.sold === 0))
    // An empty plot of zero-height bars says nothing; say it in words (the table lists the intervals).
    rateBody = (
      <Empty title="Між скануваннями продажів не було.">Стовпчики з’являться, коли число продажів зросте.</Empty>
    )
  else
    rateBody = (
      <BarChart
        label="Продажі за день між скануваннями"
        domain={domain}
        digits={1}
        height={96}
        spanning
        bars={rate.map((r) => ({
          t: (r.from + r.to) / 2,
          t0: r.from,
          t1: r.to,
          v: r.perDay,
          tip: (
            <>
              <div className="tip-value">≈ {perDayText(r.perDay)} на день</div>
              <div className="tip-label">
                {formatDelta(r.sold) || '0'} {plural(r.sold, 'продаж', 'продажі', 'продажів')} за{' '}
                {num(r.days, r.days < 10 ? 1 : 0)} дн.
              </div>
              <div className="tip-label">
                {fullDateTime(r.from)} → {fullDateTime(r.to)}
              </div>
            </>
          )
        }))}
      />
    )
  return (
    <Card
      title="Продажі магазину"
      glossary="salesCount"
      desc="Скільки всього разів купували в магазині, за даними Etsy. Лінія піднімається — були продажі; рівна — продажів не було."
      wide
      testId="chart-sales"
    >
      <ScanLine label="Продано всього" data={data} pick={(s) => s.transactionSoldCount} domain={domain} />
      <SubTitle
        glossary="salesPerDay"
        badge={<Badge tone="info">розрахунок</Badge>}
        caption="Не число з Etsy, а оцінка програми: на скільки виросли продажі ÷ скільки днів минуло між двома скануваннями. Стовпчик займає весь проміжок, тож його площа — кількість продажів."
      >
        Продажі за день
      </SubTitle>
      {rateBody}
      <DataTable
        caption="Продажі за день між скануваннями"
        head={['Проміжок', 'Днів', 'Продано', 'За день']}
        rows={[...rate].reverse().map((r) => [
          `${fullDateTime(r.from)} → ${fullDateTime(r.to)}`,
          num(r.days, 2),
          formatDelta(r.sold) || '0',
          perDayText(r.perDay)
        ])}
      />
    </Card>
  )
}

const CHANGE_SERIES: Array<StackSeries & { glossary: GlossaryKey }> = [
  { key: 'added', label: 'Нові', className: 'c-added', glossary: 'listingNew' },
  { key: 'removed', label: 'Зникли', className: 'c-removed', glossary: 'listingRemoved' },
  { key: 'changed', label: 'Змінились', className: 'c-changed', glossary: 'listingChanged' },
  { key: 'returned', label: 'Повернулися', className: 'c-returned', glossary: 'listingReturned' }
]

function ChangesCard({ data, domain }: { data: ShopStatsPayload; domain: [number, number] }): JSX.Element {
  const scans = data.scans
  const any = scans.some((s) => s.added + s.removed + s.changed + s.returned > 0)
  return (
    <Card
      title="Зміни за сканування"
      glossary="stats.changesPerScan"
      desc={
        scans.length && !any
          ? 'У цьому періоді товари не змінювались. Кожне сканування позначено крапкою на осі.'
          : 'Скільки товарів з’явилось, зникло, змінилось чи повернулось під час кожного сканування. Крапка на осі — сканування.'
      }
      testId="chart-changes"
    >
      {scans.length ? (
        <>
          <Legend
            items={[
              // Nothing changed: no colours to explain — only the scan marks of the strip.
              ...(any ? CHANGE_SERIES.map((s) => ({ label: s.label, className: s.className, glossary: s.glossary })) : []),
              ...(scans.some((s) => !s.isBaseline)
                ? [{ label: 'сканування', className: 'c-scan', kind: 'dot' as const }]
                : []),
              ...(scans.some((s) => s.isBaseline)
                ? [{ label: 'базове сканування', className: 'c-marker', kind: 'ring' as const, glossary: 'baseline' as const }]
                : [])
            ]}
          />
          <StackedBarChart
            label="Зміни за сканування"
            series={CHANGE_SERIES}
            domain={domain}
            compact={!any}
            stacks={scans.map((s) => ({
              t: s.at,
              values: [s.added, s.removed, s.changed, s.returned],
              marker: s.isBaseline,
              tip: (
                <>
                  <div className="tip-label">{fullDateTime(s.at)}</div>
                  {s.isBaseline ? (
                    <div className="tip-value">Базове сканування: збережено {formatCount(s.total)} товарів</div>
                  ) : (
                    CHANGE_SERIES.map((c, j) => (
                      <div className="tip-row" key={c.key}>
                        <span className={`tip-key ${c.className}`} />
                        <b>{formatCount([s.added, s.removed, s.changed, s.returned][j])}</b> {c.label.toLowerCase()}
                      </div>
                    ))
                  )}
                  {s.truncated && <div className="tip-label">Магазин завеликий: Etsy віддав лише ≈12 100 товарів</div>}
                </>
              )
            }))}
          />
        </>
      ) : (
        noScansEmpty()
      )}
      <DataTable
        caption="Зміни товарів за кожне сканування"
        head={['Сканування', 'Нові', 'Зникли', 'Змінились', 'Повернулися']}
        rows={scanRows({ ...data, anchor: null }, [
          (s) => (s.isBaseline ? `базове (${formatCount(s.total)})` : formatCount(s.added)),
          (s) => formatCount(s.removed),
          (s) => formatCount(s.changed),
          (s) => formatCount(s.returned)
        ])}
      />
    </Card>
  )
}

// ------------------------------------------------------------------ reviews

/** "1 відгук", "3 відгуки", "12 відгуків". */
const reviewsText = (n: number): string => `${formatCount(n)} ${plural(n, 'відгук', 'відгуки', 'відгуків')}`

function bucketText(b: StatsReviewBucket, week: boolean): string {
  const s = b.start * 1000
  const e = b.end * 1000 - 1
  return week ? `${shortDate(s, true)}–${fullDate(e, true)}` : `${fullDate(s, true).slice(3)}`
}

function ReviewsCard({ data }: { data: ShopStatsPayload }): JSX.Element {
  const r = data.reviews
  const [gran, setGran] = useState<'auto' | 'week' | 'month'>('auto')
  const week = gran === 'week' || (gran === 'auto' && r.weeks.length <= MAX_AUTO_WEEKS)
  const buckets = week ? r.weeks : r.months
  const unit = week ? 'тиждень' : 'місяць'
  const anyPartial = buckets.some((b) => b.partial)
  let body: JSX.Element
  if (!r.synced)
    body = (
      <Empty title="Відгуки ще не синхронізовано." icon="review">
        Програма завантажує відгуки сама після сканування магазину. Великі магазини догружаються за кілька сканувань.
      </Empty>
    )
  else if (!buckets.length)
    body = (
      <Empty title="За цей період відгуків немає." icon="review">
        Виберіть довший період угорі.
      </Empty>
    )
  else {
    const domain: [number, number] = [buckets[0].start * 1000, buckets[buckets.length - 1].end * 1000]
    body = (
      <>
        {anyPartial && (
          <Legend
            items={[
              {
                label: `неповний ${unit} (контур, пунктир)`,
                className: 'c-partial',
                kind: 'outline',
                glossary: 'stats.partialBucket'
              }
            ]}
          />
        )}
        <BarChart
          label={week ? 'Відгуки по тижнях' : 'Відгуки по місяцях'}
          domain={domain}
          utc
          height={150}
          bars={buckets.map((b) => ({
            t: ((b.start + b.end) / 2) * 1000,
            t0: b.start * 1000,
            t1: b.end * 1000,
            v: b.count,
            partial: b.partial,
            tip: (
              <>
                <div className="tip-value">{reviewsText(b.count)}</div>
                <div className="tip-label">
                  {week ? 'Тиждень' : 'Місяць'} {bucketText(b, week)}
                  {b.partial ? ` (неповний ${unit})` : ''}
                </div>
                {b.avg != null && (
                  <div className="tip-label">
                    Оцінка {formatRating(b.avg)} · {[5, 4, 3, 2, 1].map((n) => `${n}★ ${b.ratings[n - 1]}`).join(' · ')}
                  </div>
                )}
              </>
            )
          }))}
        />
        <SubTitle glossary="rating" caption={`Від 1 до 5 зірок. Розрив у лінії — ${week ? 'тижні' : 'місяці'} без відгуків.`}>
          Середня оцінка за {unit}
        </SubTitle>
        <LineChart
          label={`Середня оцінка за ${unit}`}
          points={buckets.map((b) => ({ t: ((b.start + b.end) / 2) * 1000, v: b.avg, partial: b.partial }))}
          domain={domain}
          utc
          digits={1}
          minSpan={0.5}
          ceil={5}
          height={80}
          format={(v) => formatRating(v)}
          dateText={(t) => {
            const b = buckets.find((x) => x.start * 1000 <= t && t < x.end * 1000)
            return b
              ? `${bucketText(b, week)} · ${reviewsText(b.count)}${b.partial ? ` (неповний ${unit})` : ''}`
              : fullDate(t, true)
          }}
        />
      </>
    )
  }
  return (
    <Card
      title={week ? 'Відгуки по тижнях' : 'Відгуки по місяцях'}
      glossary="stats.reviewsByTime"
      desc={
        <>
          Скільки відгуків покупці залишили за кожен {unit}. Etsy не показує продажі окремих товарів, тож відгуки — найкраща
          підказка, як часто купують.
          {r.synced && !r.complete && (
            <span className="stats-card-note">
              {' '}
              Історія відгуків ще завантажується — справжні числа можуть бути більшими.
            </span>
          )}
        </>
      }
      wide
      testId="chart-reviews"
      actions={
        r.synced &&
        (r.weeks.length > 0 || r.months.length > 0) && (
          <Segmented
            size="sm"
            label="Групування відгуків"
            value={week ? 'week' : 'month'}
            onChange={(v) => setGran(v)}
            options={[
              { value: 'week', label: 'Тижні', hint: 'Тиждень — з понеділка до неділі' },
              { value: 'month', label: 'Місяці', hint: 'Календарні місяці' }
            ]}
          />
        )
      }
    >
      {body}
      <DataTable
        caption={week ? 'Відгуки по тижнях' : 'Відгуки по місяцях'}
        head={[week ? 'Тиждень' : 'Місяць', 'Відгуків', 'Оцінка', '5★', '4★', '3★', '2★', '1★']}
        rows={[...buckets].reverse().map((b) => [
          bucketText(b, week) + (b.partial ? ' *' : ''),
          formatCount(b.count),
          b.avg == null ? '—' : formatRating(b.avg),
          ...[5, 4, 3, 2, 1].map((n) => formatCount(b.ratings[n - 1]))
        ])}
        note={anyPartial ? `* неповний ${unit} (період або сьогоднішній день обрізає його)` : undefined}
      />
    </Card>
  )
}

// -------------------------------------------------------------- top growth

function TopTable({
  title,
  icon,
  sub,
  rows,
  empty,
  unit,
  testId,
  onOpen,
  total,
  times
}: {
  title: string
  icon: IconName
  sub: string
  rows: StatsTopRow[]
  empty: ReactNode
  /** The unit after a number: "переглядів", "в обраному", … (agrees with the number). */
  unit: (n: number) => string
  testId: string
  onOpen: (listingId: number) => void
  /** The rows count everything (not growth): show the number, no "+". */
  total?: boolean
  /** When each sparkline point was taken (scan times); else the points are equal slices. */
  times?: number[]
}): JSX.Element {
  return (
    <div className="top-table" data-testid={testId}>
      <h5 className="top-table-title">
        <Icon name={icon} size={15} />
        {title}
      </h5>
      <div className="top-table-sub">{sub}</div>
      {rows.length === 0 ? (
        typeof empty === 'string' ? <div className="top-empty">{empty}</div> : empty
      ) : (
        <ol>
          {rows.map((r, i) => {
            const inner = (
              <>
                <span className="top-rank num" aria-hidden="true">
                  {i + 1}
                </span>
                {r.imageId != null ? (
                  <img src={imageSrc({ id: r.imageId }, '75x75')} alt="" loading="lazy" />
                ) : (
                  <span className="thumb-ph" />
                )}
                <span className="top-title">{r.title}</span>
                <span className="top-nums">
                  {total ? (
                    <>
                      <span className="top-total">{formatCount(r.delta)}</span>
                      <span className="top-end">{unit(r.delta)}</span>
                    </>
                  ) : (
                    <>
                      <span className="top-delta">{formatDelta(r.delta)}</span>
                      <span className="top-end">
                        {formatCount(r.end)} {unit(r.end ?? 0)}
                      </span>
                    </>
                  )}
                </span>
                <Sparkline values={r.series} times={times} />
              </>
            )
            return (
              <li key={r.listingId} className={r.imageId != null ? 'ui-zoom-host' : undefined}>
                {r.stored ? (
                  <button type="button" className="top-row" onClick={() => onOpen(r.listingId)} title={r.title}>
                    {inner}
                  </button>
                ) : (
                  // A listing we never stored can't be opened.
                  <div className="top-row static" title="Товар не збережено — відкрити неможливо">
                    {inner}
                  </div>
                )}
                {r.imageId != null && (
                  // Over the row's thumbnail, a sibling of the row button: the photo full size.
                  <ZoomButton
                    images={{ src: imageSrc({ id: r.imageId }, 'fullxfull'), alt: r.title, caption: r.title, ref: photoRef(r.listingId, r.imageId) }}
                    label={`Відкрити фото на весь розмір: ${r.title}`}
                    className="ui-zoom-corner thumb-zoom top-zoom"
                  />
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function TopCard({ data, onOpen }: { data: ShopStatsPayload; onOpen: (id: number) => void }): JSX.Element {
  const t = data.top
  const span =
    t.fromAt != null && t.toAt != null && t.fromScanId !== t.toScanId
      ? `${fullDateTime(t.fromAt)} → ${fullDateTime(t.toAt)}`
      : null
  const scanEmpty: ReactNode = hasNoListings(data)
    ? noListingsEmpty('Перегляди й обране з’являться, коли продавець виставить товари.')
    : span
      ? 'Росту між цими скануваннями не було.'
      : `${NEED_TWO_SCANS} зі статистикою товарів.`
  return (
    <Card
      title="Найбільший ріст товарів"
      glossary="stats.topGrowth"
      desc="Які товари за період найбільше набрали переглядів, обраного й відгуків. Натисніть на товар, щоб відкрити його картку."
      wide
      testId="stats-top"
    >
      <div className="top-grid">
        <TopTable
          title="Перегляди"
          icon="eye"
          sub={span ?? 'між першим і останнім скануванням періоду'}
          rows={t.views}
          empty={scanEmpty}
          unit={(n) => plural(n, 'перегляд', 'перегляди', 'переглядів')}
          testId="top-views"
          onOpen={onOpen}
          times={t.seriesAt}
        />
        <TopTable
          title="Обране"
          icon="heart"
          sub={span ?? 'між першим і останнім скануванням періоду'}
          rows={t.favorers}
          empty={scanEmpty}
          unit={() => 'в обраному'}
          testId="top-favorers"
          onOpen={onOpen}
          times={t.seriesAt}
        />
        <TopTable
          title="Відгуки"
          icon="star"
          sub={data.range === 'all' ? 'усього відгуків за весь час' : `нових відгуків за ${RANGE_LABEL[data.range]}`}
          rows={t.reviews}
          empty={data.reviews.synced ? 'За цей період відгуків немає.' : 'Відгуки ще не синхронізовано.'}
          unit={(n) => plural(n, 'відгук', 'відгуки', 'відгуків') + (data.range === 'all' ? '' : ' усього')}
          testId="top-reviews"
          onOpen={onOpen}
          total={data.range === 'all'}
        />
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------- view

const hasStats = (s: StatsScanPoint): boolean =>
  s.transactionSoldCount != null ||
  s.numFavorers != null ||
  s.reviewCount != null ||
  s.listingActiveCount != null ||
  s.listingViews != null

/**
 * The shared x domain of the stats charts: only scans that recorded stats
 * (scans before v2 have none and would leave most of the plot empty). When the
 * period starts at an anchor scan, the domain starts at the period's start and
 * the lines/bars from the anchor enter at the left edge.
 */
export function statsDomain(data: ShopStatsPayload): [number, number] {
  const withStats = data.scans.filter(hasStats)
  const domain = timeDomain((withStats.length ? withStats : data.scans).map((s) => s.at))
  if (data.anchor && hasStats(data.anchor) && data.from != null) domain[0] = Math.min(domain[0], data.from)
  return domain
}

function Group({ title, desc, children }: { title: string; desc: string; children: ReactNode }): JSX.Element {
  const id = useId()
  return (
    <section className="stats-group" aria-labelledby={id}>
      <div className="stats-group-head">
        <h3 id={id}>{title}</h3>
        <p>{desc}</p>
      </div>
      <div className="stats-grid">{children}</div>
    </section>
  )
}

export function StatsView({ data, onOpen }: { data: ShopStatsPayload; onOpen: (id: number) => void }): JSX.Element {
  const domain = statsDomain(data)
  // The changes chart is about every scan (pre-v2 ones included), so it keeps its own domain.
  const changesDomain = timeDomain(data.scans.map((s) => s.at))
  const noListings = hasNoListings(data)
  // Etsy knows the shop's reviews and there are none at all (a 0 count at every scan that knows it).
  const knownCounts = withAnchor(data).filter((x) => x.reviewCount != null)
  const noReviews = knownCounts.length > 0 && knownCounts.every((x) => x.reviewCount === 0)
  return (
    <>
      <p className="stats-intro">
        <Icon name="info" size={15} />
        <span>
          Як змінювався магазин між скануваннями. Наведіть курсор на графік (або виберіть його клавішею Tab і
          стрілками), щоб побачити точне число; «Дані» під графіком — ті самі числа таблицею.
          {data.anchor && (
            <span className="stats-anchor">
              {' '}
              Зміни рахуються від сканування {fullDateTime(data.anchor.at)} <InfoTip glossary="stats.anchorScan" />
            </span>
          )}
        </span>
      </p>
      <KpiRow data={data} />
      <Group title="Магазин" desc="Продажі, відгуки, підписники й інтерес покупців до магазину загалом.">
        <SalesCard data={data} domain={domain} />
        <ReviewsCard data={data} />
        <Card
          title="Обране магазину"
          glossary="shopFavorers"
          desc="Скільки людей підписались на магазин. Росте — магазин стає відомішим."
          testId="chart-favorers"
        >
          <ScanLine label="Обране магазину" data={data} pick={(s) => s.numFavorers} domain={domain} />
          <DataTable
            caption="Обране магазину за скануваннями"
            head={['Сканування', 'Обране']}
            rows={scanRows(data, [(s) => cell(s.numFavorers)])}
          />
        </Card>
        <Card
          title="Активних товарів"
          glossary="stats.activeCount"
          desc="Скільки товарів було в продажу під час кожного сканування. Стрибок угору — продавець додав нові товари."
          testId="chart-active"
        >
          <ScanLine label="Активних товарів" data={data} pick={(s) => s.listingActiveCount} domain={domain} />
          <DataTable
            caption="Активних товарів за скануваннями"
            head={['Сканування', 'Активних']}
            rows={scanRows(data, [(s) => cell(s.listingActiveCount)])}
          />
        </Card>
        <Card
          title="Відгуки магазину"
          glossary="stats.reviewsOnEtsy"
          desc="Усі відгуки й середня оцінка, як їх показує Etsy на сторінці магазину."
          testId="chart-shop-reviews"
        >
          {noReviews ? (
            <Empty title="У магазину ще немає відгуків" icon="review">
              Графіки з’являться, коли покупці залишать перші відгуки.
            </Empty>
          ) : (
            <>
              <ScanLine label="Кількість відгуків" data={data} pick={(s) => s.reviewCount} domain={domain} />
              <SubTitle glossary="stats.ratingOnEtsy">Рейтинг магазину</SubTitle>
              {/* A shop without reviews reports an average of 0: no rating yet, not a 0-star one. */}
              <ScanLine
                label="Рейтинг магазину"
                data={data}
                pick={(s) => (s.reviewAverage === 0 ? null : s.reviewAverage)}
                domain={domain}
                digits={2}
                minSpan={0.2}
                ceil={5}
              />
            </>
          )}
          <DataTable
            caption="Відгуки магазину за скануваннями"
            head={['Сканування', 'Відгуків', 'Оцінка']}
            rows={scanRows(data, [(s) => cell(s.reviewCount), (s) => cell(s.reviewAverage || null, 2)])}
          />
        </Card>
        <Card
          title="Перегляди і обране всіх товарів"
          glossary="stats.listingSums"
          desc="Сума по всіх товарах, що зараз у продажу. Росте — інтерес до асортименту збільшується."
          testId="chart-listing-sums"
        >
          {noListings ? (
            noListingsEmpty('Нема що підсумовувати: суми з’являться, коли продавець виставить товари.')
          ) : (
            <>
              <SubTitle glossary="views">Перегляди</SubTitle>
              <ScanLine label="Перегляди всіх товарів" data={data} pick={(s) => s.listingViews} domain={domain} />
              <SubTitle glossary="favorites">Обране всіх товарів</SubTitle>
              <ScanLine label="Обране всіх товарів" data={data} pick={(s) => s.listingFavorers} domain={domain} />
            </>
          )}
          <DataTable
            caption="Перегляди і обране всіх товарів за скануваннями"
            head={['Сканування', 'Перегляди', 'Обране']}
            rows={scanRows(data, [(s) => cell(s.listingViews), (s) => cell(s.listingFavorers)])}
          />
        </Card>
      </Group>
      <Group title="Товари" desc="Як змінювався асортимент і які товари ростуть найшвидше.">
        <ChangesCard data={data} domain={changesDomain} />
        <Card
          title="Товарів зі знижкою"
          glossary="stats.discounted"
          desc="Скільки товарів продавались зі знижкою (акцією) під час кожного сканування — за цінами для покупця."
          testId="chart-discounted"
        >
          {noListings ? (
            noListingsEmpty('Знижки з’являться тут, коли в магазині будуть товари.')
          ) : (
            <ScanLine
              label="Товарів зі знижкою"
              data={data}
              pick={(s) => s.discounted ?? null}
              domain={domain}
              emptyHint={NO_BUYER_PRICES_HINT}
            />
          )}
          <DataTable
            caption="Товарів зі знижкою за скануваннями"
            head={['Сканування', 'Зі знижкою', 'З ціною для покупця']}
            rows={scanRows(data, [(s) => cell(s.discounted ?? null), (s) => cell(s.buyerPriced ?? null)])}
          />
        </Card>
        <TopCard data={data} onOpen={onOpen} />
      </Group>
    </>
  )
}

/** "Статистика" of one shop: KPI row + charts over the chosen period. */
export function StatsModal(): JSX.Element | null {
  const { statsShopId, shops } = useStore()
  const shop = shops.find((s) => s.id === statsShopId) ?? null
  // Keyed by shop and mounted only while open: every opening starts on "Усе"
  // with no stale data from the previous shop.
  return shop ? <StatsDialog key={shop.id} shop={shop} /> : null
}

function StatsDialog({ shop }: { shop: ShopSummary }): JSX.Element {
  const { openStats, openListing } = useStore()
  const close = (): void => openStats(null)
  const [range, setRange] = useState<StatsRange>('all')
  const [data, setData] = useState<ShopStatsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Refetch when a scan or a review sync of this shop finished.
  const version = `${shop.lastOkScan?.id}:${shop.reviews?.stored}:${shop.reviews?.lastSyncedAt}`
  const shopId = shop.id

  useEffect(() => {
    let alive = true
    setLoading(true)
    setFailed(false)
    window.api.getShopStats(shopId, range).then(
      (d) => {
        if (!alive) return
        setData(d)
        setLoading(false)
      },
      () => {
        if (!alive) return
        setFailed(true)
        setLoading(false)
      }
    )
    return () => {
      alive = false
    }
  }, [shopId, range, version, attempt])

  const shown = data && data.shopId === shop.id ? data : null
  const onOpen = (listingId: number): void => {
    void window.api.getListing(listingId).then((l) => {
      if (l) openListing(l)
    })
  }
  const scans = shown?.scans ?? []
  const subtitle = shown
    ? scans.length
      ? `Сканувань у періоді: ${scans.length} · ${fullDate(scans[0].at)} – ${fullDate(scans[scans.length - 1].at)}`
      : 'У цьому періоді немає успішних сканувань'
    : 'Як змінювався магазин між скануваннями'
  return (
    <Modal
      size="xl"
      className="stats-modal"
      bodyClassName="stats-scroll"
      onClose={close}
      ariaLabel={`Статистика ${shop.shopName}`}
      title={
        <span className="stats-title">
          <Icon name="stats" size={20} />
          <span className="stats-title-text">
            Статистика <span className="stats-title-sep">·</span>{' '}
            <span className="stats-title-shop">{shop.shopName}</span>
          </span>
        </span>
      }
      subtitle={subtitle}
      headerExtra={
        <div className="stats-period">
          {loading && shown && <Spinner size={14} label="Оновлення статистики…" />}
          <Segmented label="Період" value={range} onChange={setRange} options={RANGE_OPTIONS} />
          <InfoTip glossary="statsPeriod" />
        </div>
      }
    >
      {failed && (
        <Callout
          tone="error"
          className="stats-error"
          action={
            <Button size="sm" icon="refresh" onClick={() => setAttempt((a) => a + 1)}>
              Спробувати ще
            </Button>
          }
        >
          Не вдалося завантажити статистику.
        </Callout>
      )}
      {shown ? (
        // Refetch keeps the frame: the previous render stays, dimmed.
        <div className={`stats-body${loading ? ' loading' : ''}`} aria-busy={loading}>
          <StatsView data={shown} onOpen={onOpen} />
        </div>
      ) : (
        !failed && <Loading>Завантаження статистики…</Loading>
      )}
    </Modal>
  )
}
