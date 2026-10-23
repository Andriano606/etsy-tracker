import { type ReactNode, useEffect, useState } from 'react'
import type {
  ShopStatsPayload,
  ShopSummary,
  StatsRange,
  StatsReviewBucket,
  StatsScanPoint,
  StatsTopRow
} from '@shared/types'
import { formatCount, formatDelta, formatRating } from '@shared/format'
import { fullDate, fullDateTime, shortDate, timeDomain } from '../chartScale'
import { imageSrc } from '../imageUrl'
import { useStore } from '../store'
import { BarChart, Legend, LineChart, Sparkline, StackedBarChart, type StackSeries } from './Charts'
import { useEscape } from './useEscape'

export const RANGE_LABEL: Record<StatsRange, string> = {
  all: 'Усе',
  '90d': '90 днів',
  '30d': '30 днів',
  '7d': '7 днів'
}
const RANGES: StatsRange[] = ['all', '90d', '30d', '7d']

/** Weekly bars until there would be more than this many; then monthly (switchable). */
const MAX_AUTO_WEEKS = 120

export const NEED_TWO_SCANS = 'Потрібно щонайменше 2 сканування'
const NO_STATS_HINT =
  'Немає даних: ці показники записуються з кожним скануванням, починаючи з версії 2 (старші сканування їх не мають).'

const num = (v: number, digits = 0): string => v.toLocaleString('uk-UA', { maximumFractionDigits: digits })
const perDayText = (v: number): string => num(v, Math.abs(v) < 10 ? 1 : 0)

function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <div className="chart-empty">{children}</div>
}

function Card({
  title,
  sub,
  wide,
  children,
  testId,
  actions
}: {
  title: string
  sub?: ReactNode
  wide?: boolean
  children: ReactNode
  testId?: string
  /** Controls at the right of the header (e.g. weeks/months). */
  actions?: ReactNode
}): JSX.Element {
  return (
    <section className={`stats-card${wide ? ' wide' : ''}`} data-testid={testId}>
      <header>
        <div className="stats-card-title">
          <h3>{title}</h3>
          {sub && <div className="stats-sub">{sub}</div>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}

/** The accessible twin of a chart: every plotted value as a table, collapsed by default. */
function DataTable({
  head,
  rows,
  note
}: {
  head: string[]
  rows: ReactNode[][]
  /** A footnote under the table (e.g. what "*" means). */
  note?: string
}): JSX.Element | null {
  if (!rows.length) return null
  return (
    <details className="chart-table">
      <summary>Дані ({rows.length})</summary>
      <div className="chart-table-scroll">
        <table className="stats-history">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
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
  )
}

const cell = (v: number | null | undefined, digits = 0): string => (v == null ? '—' : num(v, digits))

// --------------------------------------------------------------- KPI tiles

interface Tile {
  label: string
  value: string
  delta?: number | null
  /** Which scans the delta compares (tooltip). */
  span?: string
  digits?: number
  note?: string
}

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
    delta: known.length >= 2 ? pick(last)! - pick(first)! : null,
    span: known.length >= 2 ? `Зміна: ${fullDateTime(first.at)} → ${fullDateTime(last.at)}` : undefined
  }
}

function KpiRow({ data }: { data: ShopStatsPayload }): JSX.Element {
  const s = withAnchor(data)
  const sold = firstLast(s, (x) => x.transactionSoldCount)
  const fav = firstLast(s, (x) => x.numFavorers)
  const rc = firstLast(s, (x) => x.reviewCount)
  const ra = firstLast(s, (x) => x.reviewAverage)
  const act = firstLast(s, (x) => x.listingActiveCount)
  const tiles: Tile[] = [
    { label: 'Продано', value: cell(sold.value), delta: sold.delta, span: sold.span },
    { label: 'Обране магазину', value: cell(fav.value), delta: fav.delta, span: fav.span },
    { label: 'Відгуків на Etsy', value: cell(rc.value), delta: rc.delta, span: rc.span },
    {
      label: 'Середня оцінка',
      value: ra.value == null ? '—' : formatRating(ra.value),
      delta: ra.delta,
      span: ra.span,
      digits: 2
    },
    { label: 'Активних товарів', value: cell(act.value), delta: act.delta, span: act.span },
    {
      label: data.range === 'all' ? 'Відгуків за весь час' : 'Відгуків за період',
      value: data.reviews.synced ? formatCount(data.reviews.total) : '—',
      note: data.reviews.avg != null ? `⭐ ${formatRating(data.reviews.avg)}` : undefined
    }
  ]
  return (
    <div className="kpi-row" data-testid="stats-kpis">
      {tiles.map((t) => {
        const rounded = t.delta == null ? null : Math.round(t.delta * 10 ** (t.digits ?? 0)) / 10 ** (t.digits ?? 0)
        const d = rounded != null ? formatDelta(rounded, t.digits ?? 0) : ''
        return (
          <div className="kpi" key={t.label}>
            <div className="kpi-label">{t.label}</div>
            <div className="kpi-value">{t.value}</div>
            <div className="kpi-delta">
              {d ? (
                <span className={`delta ${t.delta! > 0 ? 'up' : 'down'}`} title={t.span ?? 'Зміна за період'}>
                  {t.delta! > 0 ? '▲' : '▼'} {d}
                </span>
              ) : t.note ? (
                <span className="dim">{t.note}</span>
              ) : rounded === 0 ? (
                <span className="dim">без змін</span>
              ) : (
                <span className="dim">&nbsp;</span>
              )}
            </div>
          </div>
        )
      })}
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
  ceil
}: {
  label: string
  data: ShopStatsPayload
  pick: (s: StatsScanPoint) => number | null
  domain: [number, number]
  digits?: number
  minSpan?: number
  ceil?: number
}): JSX.Element {
  if (!data.scans.length) return <Empty>У цьому періоді немає успішних сканувань.</Empty>
  const series = withAnchor(data)
  const points = series.map((s) => ({ t: s.at, v: pick(s) }))
  const known = series.filter((s) => pick(s) != null)
  if (!known.length) return <Empty>{NO_STATS_HINT}</Empty>
  if (known.length < 2) {
    // One point is a stat, not a chart (the KPI row shows it too).
    const s = known[0]
    return (
      <Empty>
        {NEED_TWO_SCANS} — зараз: <b className="empty-value">{num(pick(s)!, digits)}</b> ({fullDateTime(s.at)})
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
  if (known.length < 2) rateBody = <Empty>{NEED_TWO_SCANS}</Empty>
  else if (!rate.length) rateBody = <Empty>{NEED_TWO_SCANS} з інтервалом щонайменше 1 год</Empty>
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
              <div className="tip-value">≈ {perDayText(r.perDay)} / день</div>
              <div className="tip-label">
                {formatDelta(r.sold) || '0'} продажів за {num(r.days, r.days < 10 ? 1 : 0)} дн.
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
    <Card title="Продажі магазину" sub="transaction_sold_count з Etsy" wide testId="chart-sales">
      <ScanLine label="Продано всього" data={data} pick={(s) => s.transactionSoldCount} domain={domain} />
      <h4 className="chart-subtitle">
        Продажі за день{' '}
        <span className="dim">
          — розрахунок: приріст «Продано» ÷ днів між скануваннями; стовпчик займає весь інтервал
        </span>
      </h4>
      {rateBody}
      <DataTable
        head={['Інтервал', 'Днів', 'Продано', 'За день']}
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

const CHANGE_SERIES: StackSeries[] = [
  { key: 'added', label: 'Нові', className: 'c-added' },
  { key: 'removed', label: 'Зникли', className: 'c-removed' },
  { key: 'changed', label: 'Змінились', className: 'c-changed' },
  { key: 'returned', label: 'Повернулися', className: 'c-returned' }
]

function ChangesCard({ data, domain }: { data: ShopStatsPayload; domain: [number, number] }): JSX.Element {
  const scans = data.scans
  const any = scans.some((s) => s.added + s.removed + s.changed + s.returned > 0)
  return (
    <Card
      title="Зміни за сканування"
      sub={scans.length && !any ? 'Змін у товарах не було' : 'Товари: нові / зниклі / змінені / повернулися'}
      wide
      testId="chart-changes"
    >
      {scans.length ? (
        <>
          <Legend
            items={[
              ...CHANGE_SERIES.map((s) => ({ label: s.label, className: s.className })),
              ...(scans.some((s) => !s.isBaseline)
                ? [{ label: 'сканування', className: 'c-scan', kind: 'dot' as const }]
                : []),
              ...(scans.some((s) => s.isBaseline)
                ? [{ label: 'базове сканування', className: 'c-marker', kind: 'ring' as const }]
                : [])
            ]}
          />
          <StackedBarChart
            label="Зміни за сканування"
            series={CHANGE_SERIES}
            domain={domain}
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
                  {s.truncated && <div className="tip-label">≈12 100 — список обрізано</div>}
                </>
              )
            }))}
          />
        </>
      ) : (
        <Empty>У цьому періоді немає успішних сканувань.</Empty>
      )}
      <DataTable
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
  if (!r.synced) body = <Empty>Відгуки ще не синхронізовано.</Empty>
  else if (!buckets.length) body = <Empty>За цей період відгуків немає.</Empty>
  else {
    const domain: [number, number] = [buckets[0].start * 1000, buckets[buckets.length - 1].end * 1000]
    body = (
      <>
        {anyPartial && (
          <Legend items={[{ label: `неповний ${unit} (контур, пунктир)`, className: 'c-partial', kind: 'outline' }]} />
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
                <div className="tip-value">{formatCount(b.count)} відгуків</div>
                <div className="tip-label">
                  {week ? 'Тиждень' : 'Місяць'} {bucketText(b, week)}
                  {b.partial ? ` (неповний ${unit})` : ''}
                </div>
                {b.avg != null && (
                  <div className="tip-label">
                    ⭐ {formatRating(b.avg)} · {[5, 4, 3, 2, 1].map((n) => `${n}★ ${b.ratings[n - 1]}`).join(' · ')}
                  </div>
                )}
              </>
            )
          }))}
        />
        <h4 className="chart-subtitle">
          Середня оцінка за {week ? 'тиждень' : 'місяць'}
        </h4>
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
              ? `${bucketText(b, week)} · ${formatCount(b.count)} відгуків${b.partial ? ` (неповний ${unit})` : ''}`
              : fullDate(t, true)
          }}
        />
      </>
    )
  }
  return (
    <Card
      title={week ? 'Відгуки по тижнях' : 'Відгуки по місяцях'}
      sub={
        <>
          з таблиці відгуків — найкращий доступний показник продажів
          {r.synced && !r.complete && ' · історія ще завантажується (значення — нижня межа)'}
          {' · '}
          <span className="dim">{week ? 'тижні з понеділка, UTC' : 'календарні місяці, UTC'}</span>
        </>
      }
      wide
      testId="chart-reviews"
      actions={r.synced && (r.weeks.length > 0 || r.months.length > 0) && (
        <div className="seg-control small" role="radiogroup" aria-label="Групування">
          {(
            [
              ['week', 'Тижні'],
              ['month', 'Місяці']
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              role="radio"
              aria-checked={(k === 'week') === week}
              className={(k === 'week') === week ? 'active' : ''}
              onClick={() => setGran(k)}
            >
              {l}
            </button>
          ))}
        </div>
      )}
    >
      {body}
      <DataTable
        head={[week ? 'Тиждень' : 'Місяць', 'Відгуків', '⭐', '5★', '4★', '3★', '2★', '1★']}
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
  sub: string
  rows: StatsTopRow[]
  empty: string
  unit: string
  testId: string
  onOpen: (listingId: number) => void
  /** The rows count everything (not growth): show the number, no "+". */
  total?: boolean
  /** When each sparkline point was taken (scan times); else the points are equal slices. */
  times?: number[]
}): JSX.Element {
  return (
    <div className="top-table" data-testid={testId}>
      <h4>{title}</h4>
      <div className="stats-sub">{sub}</div>
      {rows.length === 0 ? (
        <div className="top-empty">{empty}</div>
      ) : (
        <ol>
          {rows.map((r) => {
            const inner = (
              <>
                {r.imageId != null ? (
                  <img src={imageSrc({ id: r.imageId }, '75x75')} alt="" loading="lazy" />
                ) : (
                  <span className="thumb-ph" />
                )}
                <span className="top-title">{r.title}</span>
                <span className="top-nums">
                  {total ? (
                    <span className="top-total">{formatCount(r.delta)}</span>
                  ) : (
                    <>
                      <span className="delta up">{formatDelta(r.delta)}</span>
                      <span className="top-end">
                        {formatCount(r.end)} {unit}
                      </span>
                    </>
                  )}
                </span>
                <Sparkline values={r.series} times={times} />
              </>
            )
            return (
              <li key={r.listingId}>
                {r.stored ? (
                  <button className="top-row" onClick={() => onOpen(r.listingId)} title={r.title}>
                    {inner}
                  </button>
                ) : (
                  // A listing we never stored can't be opened.
                  <div className="top-row static" title="Товар не збережено — відкрити неможливо">
                    {inner}
                  </div>
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
  const scanEmpty = span ? 'Росту між цими скануваннями не було.' : `${NEED_TWO_SCANS} зі статистикою товарів.`
  return (
    <Card title="Топ товарів за ростом" sub="Клік — відкрити товар" wide testId="stats-top">
      <div className="top-grid">
        <TopTable
          title="👁 Перегляди"
          sub={span ?? 'між першим і останнім скануванням періоду'}
          rows={t.views}
          empty={scanEmpty}
          unit="переглядів"
          testId="top-views"
          onOpen={onOpen}
          times={t.seriesAt}
        />
        <TopTable
          title="❤ Обране"
          sub={span ?? 'між першим і останнім скануванням періоду'}
          rows={t.favorers}
          empty={scanEmpty}
          unit="в обраному"
          testId="top-favorers"
          onOpen={onOpen}
          times={t.seriesAt}
        />
        <TopTable
          title="⭐ Відгуки"
          sub={data.range === 'all' ? 'за весь час (з таблиці відгуків)' : `нових відгуків за ${RANGE_LABEL[data.range]}`}
          rows={t.reviews}
          empty={data.reviews.synced ? 'За цей період відгуків немає.' : 'Відгуки ще не синхронізовано.'}
          unit="всього"
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

export function StatsView({ data, onOpen }: { data: ShopStatsPayload; onOpen: (id: number) => void }): JSX.Element {
  const domain = statsDomain(data)
  // The changes chart is about every scan (pre-v2 ones included), so it keeps its own domain.
  const changesDomain = timeDomain(data.scans.map((s) => s.at))
  return (
    <>
      <KpiRow data={data} />
      <div className="stats-grid">
        <SalesCard data={data} domain={domain} />
        <ReviewsCard data={data} />
        <Card title="Обране магазину" sub="num_favorers" testId="chart-favorers">
          <ScanLine label="Обране магазину" data={data} pick={(s) => s.numFavorers} domain={domain} />
          <DataTable head={['Сканування', 'Обране']} rows={scanRows(data, [(s) => cell(s.numFavorers)])} />
        </Card>
        <Card title="Активних товарів" sub="listing_active_count" testId="chart-active">
          <ScanLine label="Активних товарів" data={data} pick={(s) => s.listingActiveCount} domain={domain} />
          <DataTable head={['Сканування', 'Активних']} rows={scanRows(data, [(s) => cell(s.listingActiveCount)])} />
        </Card>
        <Card title="Відгуки магазину" sub="кількість і середня оцінка на Etsy" testId="chart-shop-reviews">
          <ScanLine label="Кількість відгуків" data={data} pick={(s) => s.reviewCount} domain={domain} />
          <h4 className="chart-subtitle">Середня оцінка</h4>
          <ScanLine
            label="Середня оцінка"
            data={data}
            pick={(s) => s.reviewAverage}
            domain={domain}
            digits={2}
            minSpan={0.2}
            ceil={5}
          />
          <DataTable
            head={['Сканування', 'Відгуків', '⭐']}
            rows={scanRows(data, [(s) => cell(s.reviewCount), (s) => cell(s.reviewAverage, 2)])}
          />
        </Card>
        <Card title="Перегляди і обране всіх товарів" sub="сума по активних товарах" testId="chart-listing-sums">
          <ScanLine label="Перегляди всіх товарів" data={data} pick={(s) => s.listingViews} domain={domain} />
          <h4 className="chart-subtitle">Обране всіх товарів</h4>
          <ScanLine label="Обране всіх товарів" data={data} pick={(s) => s.listingFavorers} domain={domain} />
          <DataTable
            head={['Сканування', 'Перегляди', 'Обране']}
            rows={scanRows(data, [(s) => cell(s.listingViews), (s) => cell(s.listingFavorers)])}
          />
        </Card>
        <ChangesCard data={data} domain={changesDomain} />
        <TopCard data={data} onOpen={onOpen} />
      </div>
    </>
  )
}

/** "📊 Статистика" of one shop: KPI row + charts over the chosen period. */
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
  useEscape(close, true)
  const [range, setRange] = useState<StatsRange>('all')
  const [data, setData] = useState<ShopStatsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
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
  }, [shopId, range, version])

  const shown = data && data.shopId === shop.id ? data : null
  const onOpen = (listingId: number): void => {
    void window.api.getListing(listingId).then((l) => {
      if (l) openListing(l)
    })
  }
  const scans = shown?.scans ?? []
  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal stats-modal"
        role="dialog"
        aria-label={`Статистика ${shop.shopName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="stats-head">
          <div className="stats-head-text">
            <h2>📊 Статистика · {shop.shopName}</h2>
            <div className="stats-sub">
              {shown
                ? scans.length
                  ? `Успішних сканувань у періоді: ${scans.length} · ${fullDate(scans[0].at)} – ${fullDate(scans[scans.length - 1].at)}` +
                    (shown.anchor ? ` · зміни рахуються від сканування ${fullDateTime(shown.anchor.at)}` : '')
                  : 'У цьому періоді немає успішних сканувань'
                : ' '}
            </div>
          </div>
          <div className="seg-control" role="radiogroup" aria-label="Період">
            {RANGES.map((r) => (
              <button
                key={r}
                role="radio"
                aria-checked={r === range}
                className={r === range ? 'active' : ''}
                onClick={() => setRange(r)}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
          <button className="icon-btn stats-close" aria-label="Закрити" onClick={close}>
            ×
          </button>
        </div>
        {failed && <div className="banner err">Не вдалося завантажити статистику.</div>}
        {shown ? (
          // Refetch keeps the frame: the previous render stays, dimmed.
          <div className={`stats-body${loading ? ' loading' : ''}`} aria-busy={loading}>
            <StatsView data={shown} onOpen={onOpen} />
          </div>
        ) : (
          !failed && <div className="placeholder">Завантаження…</div>
        )}
      </div>
    </div>
  )
}
