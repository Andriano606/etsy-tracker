// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { App } from '../../../src/renderer/src/App'
import { useStore } from '../../../src/renderer/src/store'
import type { ShopStatsPayload, StatsReviewBucket, StatsScanPoint } from '../../../src/shared/types'
import { emptyStats, mkListing, mkScan, mkShop, setupRenderer, type Api } from '../helpers'
import { M } from '../../../src/renderer/src/components/Charts'
import { fullDateTime } from '../../../src/renderer/src/chartScale'

let api: Api
beforeEach(() => {
  api = setupRenderer()
})

const DAY = 86_400_000
const T0 = Date.UTC(2026, 9, 1, 9)

const pt = (i: number, over: Partial<StatsScanPoint> = {}): StatsScanPoint => ({
  scanId: i + 1,
  at: T0 + i * 1.7 * DAY,
  isBaseline: i === 0,
  truncated: false,
  total: 57,
  added: i % 3,
  removed: 0,
  changed: i % 2,
  returned: 0,
  numFavorers: 7000 + i * 10,
  transactionSoldCount: 110_000 + i * 35,
  reviewCount: 9300 + i * 2,
  reviewAverage: 4.75,
  listingActiveCount: 57,
  listingViews: 2_500_000 + i * 1000,
  listingFavorers: 58_000 + i * 20,
  ...over
})

const week = (i: number, count: number): StatsReviewBucket => {
  const start = Date.UTC(2026, 8, 7) / 1000 + i * 7 * 86400
  return { start, end: start + 7 * 86400, count, avg: count ? 4.5 : null, ratings: [0, 0, 1, 0, count - 1].map((n) => Math.max(0, n)) as StatsReviewBucket['ratings'], partial: false }
}

function many(n = 10): ShopStatsPayload {
  const scans = Array.from({ length: n }, (_, i) => pt(i))
  return emptyStats(1, 'all', {
    scans,
    salesRate: scans.slice(1).map((s, i) => ({
      fromScanId: scans[i].scanId,
      toScanId: s.scanId,
      from: scans[i].at,
      to: s.at,
      days: 1.7,
      sold: 35,
      perDay: 35 / 1.7
    })),
    reviews: {
      synced: true,
      complete: true,
      total: 30,
      avg: 4.6,
      weeks: [week(0, 4), week(1, 0), week(2, 12), week(3, 14)],
      months: [{ ...week(0, 30), end: week(3, 0).end }]
    },
    top: {
      fromScanId: 1,
      toScanId: n,
      fromAt: scans[0].at,
      toAt: scans[n - 1].at,
      seriesAt: [scans[0].at, scans[1]?.at ?? scans[0].at + 1, scans[n - 1].at],
      views: [
        { listingId: 7, title: 'Budget planner', imageId: 70, start: 100, end: 900, delta: 800, series: [100, 500, 900], stored: true },
        { listingId: 8, title: 'Meal planner', imageId: null, start: 10, end: 50, delta: 40, series: [10, null, 50], stored: true }
      ],
      favorers: [],
      reviews: [
        { listingId: 9, title: 'Chore chart', imageId: 90, start: 0, end: 12, delta: 12, series: [1, 2, 9], stored: true },
        { listingId: 11, title: 'Товар #11', imageId: null, start: 0, end: 3, delta: 3, series: [1, 1, 1], stored: false }
      ]
    }
  })
}

async function renderApp() {
  api.listShops.mockResolvedValue([mkShop({ lastOkScan: mkScan({ id: 7 }) })])
  render(<App />)
  await screen.findByRole('heading', { level: 1, name: /CeramicStudioUA/ })
}

async function openStats(payload?: ShopStatsPayload) {
  if (payload) api.getShopStats.mockResolvedValue(payload)
  await renderApp()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /Статистика/ })))
  return screen.getByRole('dialog', { name: /Статистика CeramicStudioUA/ })
}

const escape = () => act(() => void fireEvent.keyDown(document.body, { key: 'Escape' }))

describe('📊 Статистика', () => {
  it('the shop header button opens the view for that shop; Escape closes it', async () => {
    const dlg = await openStats()
    expect(api.getShopStats).toHaveBeenCalledWith(1, 'all')
    expect(useStore.getState().statsShopId).toBe(1)
    expect(within(dlg).getByRole('radio', { name: 'Усе' })).toHaveAttribute('aria-checked', 'true')
    escape()
    expect(useStore.getState().statsShopId).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('0 points: empty states instead of charts', async () => {
    const dlg = await openStats(emptyStats(1))
    expect(within(dlg).getAllByText('У цьому періоді немає успішних сканувань.').length).toBeGreaterThan(3)
    expect(within(dlg).getByText('Потрібно щонайменше 2 сканування')).toBeInTheDocument()
    expect(within(dlg).getAllByText('Відгуки ще не синхронізовано.').length).toBe(2)
    expect(within(dlg).getAllByText(/Потрібно щонайменше 2 сканування зі статистикою товарів/).length).toBe(2)
    expect(dlg.querySelectorAll('.chart')).toHaveLength(0)
  })

  it('1 point: no one-dot charts — the value as a stat with a note; the changes chart marks the scan', async () => {
    const dlg = await openStats(emptyStats(1, 'all', { scans: [pt(0)] }))
    const sales = within(dlg).getByTestId('chart-sales')
    expect(within(sales).queryByRole('group', { name: 'Продано всього' })).toBeNull()
    expect(sales.querySelectorAll('.chart')).toHaveLength(0)
    const empties = sales.querySelectorAll('.chart-empty')
    expect(empties[0]).toHaveTextContent(/Потрібно щонайменше 2 сканування — зараз: 110\s000 \(01\.10\.2026, /)
    expect(empties[1]).toHaveTextContent(/^Потрібно щонайменше 2 сканування$/)
    for (const id of ['chart-favorers', 'chart-active', 'chart-shop-reviews', 'chart-listing-sums']) {
      expect(within(dlg).getByTestId(id).querySelectorAll('.chart')).toHaveLength(0)
    }
    // The baseline scan is marked on the changes chart.
    expect(within(dlg).getByTestId('chart-changes').querySelectorAll('circle.marker')).toHaveLength(1)
  })

  it('scans without shop stats (before v2) say so', async () => {
    const dlg = await openStats(
      emptyStats(1, 'all', {
        scans: [pt(0, { transactionSoldCount: null, numFavorers: null, listingActiveCount: null, reviewCount: null, reviewAverage: null, listingViews: null, listingFavorers: null })]
      })
    )
    expect(within(dlg).getAllByText(/починаючи з версії 2/).length).toBeGreaterThan(3)
  })

  it('many points: lines, dots, rate bars, weekly review bars, KPI deltas', async () => {
    const dlg = await openStats(many(10))
    const sales = within(dlg).getByTestId('chart-sales')
    expect(sales.querySelectorAll('polyline.line')).toHaveLength(1)
    expect(sales.querySelectorAll('circle.dot')).toHaveLength(10)
    expect(sales.querySelectorAll('path.bar')).toHaveLength(9)
    const reviews = within(dlg).getByTestId('chart-reviews')
    expect(within(reviews).getByRole('heading', { name: 'Відгуки по тижнях' })).toBeInTheDocument()
    expect(reviews.querySelectorAll('path.bar')).toHaveLength(3) // the 0 week draws nothing
    fireEvent.click(within(reviews).getByRole('radio', { name: 'Місяці' }))
    expect(within(reviews).getByRole('heading', { name: 'Відгуки по місяцях' })).toBeInTheDocument()
    expect(reviews.querySelectorAll('path.bar')).toHaveLength(1)
    const kpis = within(dlg).getByTestId('stats-kpis')
    expect(within(kpis).getByText(/▲ \+315/)).toBeInTheDocument() // sold 110 000 → 110 315
    // Every chart has its data table twin.
    expect(within(sales).getByText('Дані (9)')).toBeInTheDocument()
  })

  it('switching the period refetches with that range', async () => {
    const dlg = await openStats(many(4))
    await act(async () => fireEvent.click(within(dlg).getByRole('radio', { name: '30 днів' })))
    expect(api.getShopStats).toHaveBeenLastCalledWith(1, '30d')
    expect(within(dlg).getByRole('radio', { name: '30 днів' })).toHaveAttribute('aria-checked', 'true')
    await act(async () => fireEvent.click(within(dlg).getByRole('radio', { name: '7 днів' })))
    expect(api.getShopStats).toHaveBeenLastCalledWith(1, '7d')
  })

  it('the tooltip shows the exact value and date on hover and on keyboard focus', async () => {
    const dlg = await openStats(many(5))
    const chart = within(dlg).getByRole('group', { name: 'Обране магазину' })
    act(() => void fireEvent.focus(chart))
    let tip = within(chart).getByRole('status')
    expect(tip).toHaveTextContent(/7\s040/) // the last point
    expect(tip).toHaveTextContent(/08\.10\.2026/)
    fireEvent.keyDown(chart, { key: 'Home' })
    tip = within(chart).getByRole('status')
    expect(tip).toHaveTextContent(/7\s000/)
    expect(tip).toHaveTextContent(/01\.10\.2026/)
    fireEvent.blur(chart)
    expect(within(chart).queryByRole('status')).toBeNull()
    // Mouse: jsdom has no layout, the chart is 640px wide from x = 0.
    fireEvent.mouseMove(chart, { clientX: 600 })
    expect(within(chart).getByRole('status')).toHaveTextContent(/7\s040/)
    fireEvent.mouseLeave(chart)
    expect(within(chart).queryByRole('status')).toBeNull()
  })

  it('a bar tooltip: reviews of a week with the rating mix', async () => {
    const dlg = await openStats(many(3))
    const chart = within(dlg).getByRole('group', { name: 'Відгуки по тижнях' })
    act(() => void fireEvent.focus(chart))
    expect(within(chart).getByRole('status')).toHaveTextContent(/14 відгуків/)
    expect(within(chart).getByRole('status')).toHaveTextContent(/Тиждень 28\.09–04\.10\.2026/)
  })

  it('clicking a top-growth row opens the listing on top of the statistics', async () => {
    api.getListing.mockResolvedValue(mkListing(7, { title: 'Budget planner' }))
    const dlg = await openStats(many(3))
    const views = within(dlg).getByTestId('top-views')
    expect(within(views).getByText('+800')).toBeInTheDocument()
    expect(views.querySelector('img')!.getAttribute('src')).toBe('etsyimg://img/70/75x75')
    await act(async () => fireEvent.click(within(views).getByRole('button', { name: /Budget planner/ })))
    expect(api.getListing).toHaveBeenCalledWith(7)
    expect(useStore.getState().detailListing?.listingId).toBe(7)
    expect(screen.getByTestId('listing-description')).toBeInTheDocument()
    // Escape closes the listing first, then the statistics.
    escape()
    expect(useStore.getState().detailListing).toBeNull()
    expect(useStore.getState().statsShopId).toBe(1)
    escape()
    expect(useStore.getState().statsShopId).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"Усе": the reviews top table shows totals, not growth', async () => {
    const dlg = await openStats(many(3))
    const reviews = within(dlg).getByTestId('top-reviews')
    expect(within(reviews).getByText('12')).toBeInTheDocument()
    expect(within(reviews).queryByText('+12')).toBeNull()
  })

  it('a top row for a listing we never stored is not a button', async () => {
    const dlg = await openStats(many(3))
    const reviews = within(dlg).getByTestId('top-reviews')
    expect(within(reviews).getByRole('button', { name: /Chore chart/ })).toBeInTheDocument()
    expect(within(reviews).queryByRole('button', { name: /Товар #11/ })).toBeNull()
    expect(within(reviews).getByTitle(/Товар не збережено/)).toHaveTextContent('Товар #11')
  })

  it('a failed load says so instead of charts', async () => {
    api.getShopStats.mockRejectedValue(new Error('boom'))
    const dlg = await openStats()
    expect(within(dlg).getByText('Не вдалося завантажити статистику.')).toBeInTheDocument()
    expect(within(dlg).queryByText('Завантаження…')).toBeNull()
    expect(dlg.querySelectorAll('.chart')).toHaveLength(0)
  })

  it('a new successful scan of the shop refetches the open view', async () => {
    await openStats(many(3))
    expect(api.getShopStats).toHaveBeenCalledTimes(1)
    await act(async () => useStore.setState({ shops: [mkShop({ lastOkScan: mkScan({ id: 8 }) })] }))
    expect(api.getShopStats).toHaveBeenCalledTimes(2)
    expect(api.getShopStats).toHaveBeenLastCalledWith(1, 'all')
  })

  it('every opening starts on "Усе" — the period of the previous shop is not carried over', async () => {
    api.listShops.mockResolvedValue([
      mkShop({ lastOkScan: mkScan({ id: 7 }) }),
      mkShop({ id: 2, shopName: 'WoodToysUA', lastOkScan: mkScan({ id: 9, shopId: 2 }) })
    ])
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: /CeramicStudioUA/ })
    await act(async () => useStore.getState().openStats(1))
    let dlg = screen.getByRole('dialog', { name: /Статистика CeramicStudioUA/ })
    await act(async () => fireEvent.click(within(dlg).getByRole('radio', { name: '7 днів' })))
    expect(api.getShopStats).toHaveBeenLastCalledWith(1, '7d')
    escape()
    await act(async () => useStore.getState().openStats(2))
    dlg = screen.getByRole('dialog', { name: /Статистика WoodToysUA/ })
    expect(within(dlg).getByRole('radio', { name: 'Усе' })).toHaveAttribute('aria-checked', 'true')
    expect(api.getShopStats).toHaveBeenLastCalledWith(2, 'all')
    escape()
    await act(async () => useStore.getState().openStats(1))
    dlg = screen.getByRole('dialog', { name: /Статистика CeramicStudioUA/ })
    expect(within(dlg).getByRole('radio', { name: 'Усе' })).toHaveAttribute('aria-checked', 'true')
  })

  it('sales/day: scans under 1 h apart say so; rate bars span their whole interval', async () => {
    const close = emptyStats(1, 'all', { scans: [pt(0), pt(0, { scanId: 2, at: T0 + 20 * 60_000 })] })
    let dlg = await openStats(close)
    expect(within(dlg).getByTestId('chart-sales')).toHaveTextContent(
      'Потрібно щонайменше 2 сканування з інтервалом щонайменше 1 год'
    )
    escape()
    api.getShopStats.mockResolvedValue(many(4))
    await act(async () => useStore.getState().openStats(1))
    dlg = screen.getByRole('dialog')
    const chart = within(dlg).getByRole('group', { name: 'Продажі за день між скануваннями' })
    const extent = (el: Element): [number, number] => {
      const xs = [...el.getAttribute('d')!.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[1]))
      return [Math.min(...xs), Math.max(...xs)]
    }
    const ex = [...chart.querySelectorAll('path.bar')].map(extent)
    expect(ex).toHaveLength(3)
    // Contiguous intervals → contiguous bars with a 2px gap, each wider than the old 24px cap.
    expect(ex[1][0] - ex[0][1]).toBeCloseTo(2, 0)
    expect(ex[2][0] - ex[1][1]).toBeCloseTo(2, 0)
    expect(ex[0][1] - ex[0][0]).toBeGreaterThan(24)
  })

  it('pre-v2 scans without stats do not squeeze the stats charts; the changes chart still shows them', async () => {
    const none = {
      transactionSoldCount: null,
      numFavorers: null,
      listingActiveCount: null,
      reviewCount: null,
      reviewAverage: null,
      listingViews: null,
      listingFavorers: null
    }
    const scans = [
      pt(0, { ...none, at: T0 - 60 * DAY }),
      pt(1, { ...none, at: T0 - 59 * DAY }),
      pt(2, { at: T0 }),
      pt(3, { at: T0 + DAY }),
      pt(4, { at: T0 + 2 * DAY })
    ]
    const dlg = await openStats(emptyStats(1, 'all', { scans }))
    const dots = [...within(dlg).getByTestId('chart-favorers').querySelectorAll('circle.dot')].map((c) =>
      Number(c.getAttribute('cx'))
    )
    expect(dots).toHaveLength(3)
    const plotW = 640 - M.left - M.right
    expect(Math.max(...dots) - Math.min(...dots)).toBeGreaterThan(plotW * 0.8)
    const changes = within(dlg).getByTestId('chart-changes')
    expect(changes.querySelectorAll('circle.scan-tick').length + changes.querySelectorAll('circle.marker').length).toBe(5)
  })

  it('a period starts at the scan before it: the line enters from the left, KPI Δ and the header say from when', async () => {
    const anchor = pt(0, { isBaseline: false, at: T0 - 1.5 * DAY, transactionSoldCount: 100, numFavorers: 7000 })
    const inside = pt(1, { at: T0 + 6 * DAY, transactionSoldCount: 170, numFavorers: 7010 })
    const dlg = await openStats(
      emptyStats(1, '7d', {
        from: T0,
        scans: [inside],
        anchor,
        salesRate: [
          { fromScanId: anchor.scanId, toScanId: inside.scanId, from: anchor.at, to: inside.at, days: 7.5, sold: 70, perDay: 70 / 7.5 }
        ]
      })
    )
    expect(dlg).toHaveTextContent(`зміни рахуються від сканування ${fullDateTime(anchor.at)}`)
    const kpis = within(dlg).getByTestId('stats-kpis')
    expect(within(kpis).getByText(/▲ \+70/)).toHaveAttribute('title', `Зміна: ${fullDateTime(anchor.at)} → ${fullDateTime(inside.at)}`)
    const sales = within(dlg).getByTestId('chart-sales')
    const line = within(sales).getByRole('group', { name: 'Продано всього' })
    // Two points (the anchor + one in the period); only the in-period one gets a dot, the line is clipped.
    expect(line.querySelectorAll('polyline.line')).toHaveLength(1)
    expect(line.querySelectorAll('circle.dot')).toHaveLength(1)
    expect(line.querySelector('g[clip-path]')).not.toBeNull()
    expect(within(sales).getByRole('group', { name: 'Продажі за день між скануваннями' }).querySelectorAll('path.bar')).toHaveLength(1)
    expect(within(within(dlg).getByTestId('chart-favorers')).getByText(/\(до періоду\)/)).toBeInTheDocument()
    // The changes chart shows only the period's own scans.
    expect(within(dlg).getByTestId('chart-changes').querySelectorAll('circle.scan-tick')).toHaveLength(1)
  })

  it('the current (partial) review week: outlined bar, legend, dashed line end, no end label, a table footnote', async () => {
    const data = many(3)
    data.reviews.weeks = [week(0, 4), week(1, 6), { ...week(2, 3), avg: 3.9, partial: true }]
    const dlg = await openStats(data)
    const reviews = within(dlg).getByTestId('chart-reviews')
    expect(reviews.querySelectorAll('path.bar.partial')).toHaveLength(1)
    expect(within(reviews).getByText(/неповний тиждень \(контур/)).toBeInTheDocument()
    const avg = within(reviews).getByRole('group', { name: 'Середня оцінка за тиждень' })
    expect(avg.querySelectorAll('line.line.dashed')).toHaveLength(1)
    expect(avg.querySelectorAll('circle.dot.partial')).toHaveLength(1)
    expect(avg.querySelector('text.end-label')).toBeNull()
    expect(within(reviews).getByText(/^\* неповний тиждень/)).toBeInTheDocument()
  })

  it('a lone value between empty weeks keeps a dot even when a long series hides the dots', async () => {
    const data = many(3)
    data.reviews.weeks = Array.from({ length: 60 }, (_, i) => week(i, i === 29 || i === 31 ? 0 : 2))
    const dlg = await openStats(data)
    const avg = within(within(dlg).getByTestId('chart-reviews')).getByRole('group', { name: 'Середня оцінка за тиждень' })
    expect(avg.querySelectorAll('circle.dot')).toHaveLength(1) // week 30
    expect(avg.querySelectorAll('polyline.line')).toHaveLength(2)
  })
})

describe('📊 Статистика: товарів зі знижкою', () => {
  it('draws the count per scan, with the data table (discounted / with a buyer price)', async () => {
    const p = many(4)
    p.scans = p.scans.map((s, i) => ({ ...s, discounted: [null, 3, 5, 2][i], buyerPriced: [null, 57, 57, 56][i] }))
    const dlg = await openStats(p)
    const card = within(dlg).getByTestId('chart-discounted')
    expect(within(card).getByText('Товарів зі знижкою')).toBeInTheDocument()
    expect(card.querySelectorAll('polyline.line')).toHaveLength(1)
    expect(card.querySelectorAll('circle.dot')).toHaveLength(3)
    const rows = card.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent(/2\s*56$/)
    expect(rows[3]).toHaveTextContent(/——$/)
  })

  it('scans without buyer prices (before v4, or Etsy refused them) say so', async () => {
    const dlg = await openStats(many(3))
    expect(within(within(dlg).getByTestId('chart-discounted')).getByText(/починаючи з версії 4/)).toBeInTheDocument()
  })

  it('one scan with buyer prices: the value as a stat', async () => {
    const p = many(3)
    p.scans = p.scans.map((s, i) => ({ ...s, discounted: i === 2 ? 4 : null, buyerPriced: i === 2 ? 57 : null }))
    const dlg = await openStats(p)
    expect(within(dlg).getByTestId('chart-discounted').querySelector('.chart-empty')).toHaveTextContent(
      /Потрібно щонайменше 2 сканування — зараз: 4/
    )
  })
})
