// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ShopView } from '../../../src/renderer/src/components/ShopView'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { HistoryModal } from '../../../src/renderer/src/components/ScanHistory'
import { useStore } from '../../../src/renderer/src/store'
import { idleReviews, idleSync, mkBuyerPrice, mkChange, mkListing, mkPromotion, mkReview, mkScan, mkShop, setupRenderer, withKey, type Api } from '../helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
})

function show(over: Parameters<typeof useStore.setState>[0] = {}) {
  useStore.setState({ keyStatus: withKey, activeShopId: 1, ...(over as object) })
  return render(
    <>
      <ShopView />
      <ConfirmModal />
    </>
  )
}

describe('ShopView', () => {
  it('shows new items first in the results panel, with NEW badges in the grid', () => {
    const old1 = mkListing(1)
    const old2 = mkListing(2)
    const fresh = mkListing(3, { title: 'Brand new mug' })
    show({
      shops: [mkShop({ lastOkScan: mkScan({ added: 1 }), newCount: 1 })],
      listings: [old1, old2, fresh],
      lastChanges: [mkChange(1, 'added', fresh)]
    })
    const results = screen.getByTestId('scan-results')
    expect(results).toHaveTextContent('Нові з минулого сканування: 1')
    const cards = screen.getAllByTestId('listing-card')
    // The results panel (rendered before the grid) leads with the new listing.
    expect(cards[0]).toHaveTextContent('Brand new mug')
    expect(within(results).getByText('NEW')).toBeInTheDocument()
    // In the full grid exactly one card carries the badge.
    expect(screen.getAllByText('NEW')).toHaveLength(2)
    expect(cards.filter((c) => c.classList.contains('is-new'))).toHaveLength(2)
  })

  it('a baseline scan says how many were saved, with no NEW badges', () => {
    show({
      shops: [mkShop({ lastOkScan: mkScan({ isBaseline: true, total: 42 }) })],
      listings: [mkListing(1)]
    })
    expect(screen.getByText('Базове сканування: збережено 42 товарів')).toBeInTheDocument()
    expect(screen.queryByText('NEW')).toBeNull()
  })

  it('lists removed / changed groups with old → new prices', () => {
    const changed = mkListing(5)
    show({
      shops: [mkShop({ lastOkScan: mkScan({ removed: 1, changed: 1 }) })],
      listings: [changed],
      lastChanges: [
        mkChange(1, 'removed', mkListing(4, { title: 'Gone mug', removedAt: 1 })),
        mkChange(2, 'changed', changed, {
          oldValue: { priceAmount: 1000, priceDivisor: 100, currency: 'UAH' },
          newValue: { priceAmount: 1500, priceDivisor: 100, currency: 'UAH' }
        })
      ]
    })
    expect(screen.getByText('Нові з минулого сканування:')).toBeInTheDocument()
    expect(screen.getByText('Нових товарів немає.')).toBeInTheDocument()
    expect(screen.getByText('Зникли: 1')).toBeInTheDocument()
    expect(screen.getByText('Gone mug')).toBeInTheDocument()
    expect(screen.getByText(/^Змінились: 1/)).toBeInTheDocument()
    expect(screen.getByTestId('changed-summary')).toHaveTextContent('(ціна)')
    expect(screen.getByText(/10,00/)).toBeInTheDocument()
    expect(screen.getByText(/15,00/)).toBeInTheDocument()
  })

  it('returned listings get their own "Повернулися" group and no NEW badge', () => {
    const back = mkListing(6, { title: 'Back again mug' })
    show({
      shops: [mkShop({ lastOkScan: mkScan({ returned: 1 }) })],
      listings: [mkListing(1), back],
      lastChanges: [mkChange(1, 'returned', back)]
    })
    expect(screen.getByText('Повернулися: 1')).toBeInTheDocument()
    expect(screen.getByText('Нових товарів немає.')).toBeInTheDocument()
    expect(screen.queryByText('NEW')).toBeNull()
    expect(screen.getAllByTestId('listing-card').filter((c) => c.classList.contains('is-new'))).toHaveLength(0)
  })

  it('a truncated scan warns that removals were not detected', () => {
    show({ shops: [mkShop({ lastOkScan: mkScan({ truncated: true }) })] })
    expect(screen.getByText(/≈12 100/)).toHaveTextContent(/зниклі товари не визначалися/)
  })

  it('without truncation there is no such warning', () => {
    show({ shops: [mkShop({ lastOkScan: mkScan() })] })
    expect(screen.queryByText(/≈12 100/)).toBeNull()
  })

  it('a stored key that cannot be decrypted says so instead of "not set"', () => {
    show({
      shops: [mkShop({ lastOkScan: mkScan() })],
      keyStatus: { hasKey: false, masked: null, encrypted: false, unreadable: true }
    })
    expect(screen.getByText(/не вдалося розшифрувати/)).toBeInTheDocument()
    expect(screen.queryByText(/не задано/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Сканувати повторно' })).toBeDisabled()
  })

  it('shows a failed latest scan on top of the previous results', () => {
    show({
      shops: [
        mkShop({
          lastOkScan: mkScan({ id: 1 }),
          lastScan: mkScan({ id: 2, status: 'error', error: 'Сервер Etsy повернув помилку (HTTP 500).' })
        })
      ]
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/не вдалося: Сервер Etsy повернув помилку/)
    expect(screen.getByRole('alert')).toHaveTextContent(/попереднього успішного/)
  })

  it('warns when data is older than 6 hours', () => {
    const old = Date.now() - 7 * 3600_000
    show({ shops: [mkShop({ lastOkScan: mkScan({ finishedAt: old }) })] })
    expect(screen.getByText(/старші за 6 годин/)).toBeInTheDocument()
  })

  it('search filters by title and tag; sort by price', () => {
    show({
      shops: [mkShop({ lastOkScan: mkScan() })],
      listings: [
        mkListing(1, { title: 'Blue mug', priceAmount: 3000 }),
        mkListing(2, { title: 'Red plate', tags: ['kitchen'], priceAmount: 1000 }),
        mkListing(3, { title: 'Green bowl', priceAmount: 2000 })
      ]
    })
    const titles = () => screen.getAllByTestId('listing-card').map((c) => c.querySelector('.card-title')!.textContent)
    expect(titles()).toEqual(['Green bowl', 'Red plate', 'Blue mug'])
    fireEvent.change(screen.getByLabelText('Сортування'), { target: { value: 'price-asc' } })
    expect(titles()).toEqual(['Red plate', 'Green bowl', 'Blue mug'])
    fireEvent.change(screen.getByPlaceholderText(/Пошук/), { target: { value: 'KITCHEN' } })
    expect(titles()).toEqual(['Red plate'])
    fireEvent.change(screen.getByPlaceholderText(/Пошук/), { target: { value: 'zzz' } })
    expect(screen.getByText('Нічого не знайдено.')).toBeInTheDocument()
  })

  it('Сканувати повторно calls main and shows progress while running', async () => {
    const shop = mkShop({ lastOkScan: mkScan() })
    api.listShops.mockResolvedValue([shop])
    show({ shops: [shop] })
    await act(async () => {
      fireEvent.click(screen.getByText('Сканувати повторно'))
    })
    expect(api.scanShop).toHaveBeenCalledWith(1)
    await waitFor(() => expect(useStore.getState().scanning[1]).toBe(false))
    act(() => {
      useStore.setState({ scanning: { 1: true }, progress: { 1: { shopId: 1, phase: 'pages', done: 2, total: 5, label: 'Сторінка 2/5' } } })
    })
    expect(await screen.findByText('Сторінка 2/5')).toBeInTheDocument()
  })

  it('Видалити asks for confirmation first', async () => {
    show({ shops: [mkShop()] })
    fireEvent.click(screen.getByText('Видалити'))
    expect(await screen.findByText(/Усі збережені товари/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Скасувати'))
    expect(api.removeShop).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Видалити'))
    const confirm = await screen.findByText('Підтвердити')
    await act(async () => {
      fireEvent.click(confirm)
    })
    await waitFor(() => expect(api.removeShop).toHaveBeenCalledWith(1))
    await waitFor(() => expect(useStore.getState().shops).toEqual([]))
  })

  it('clicking a card opens the detail modal', () => {
    const l = mkListing(7)
    show({ shops: [mkShop({ lastOkScan: mkScan() })], listings: [l] })
    fireEvent.click(screen.getByTestId('listing-card'))
    expect(useStore.getState().detailListing).toBe(l)
  })

  it('scan history rows open that scan’s changes', async () => {
    const s = mkScan({ id: 9, added: 2 })
    show({ shops: [mkShop({ lastOkScan: s })], scans: [s, mkScan({ id: 8, status: 'error', error: 'boom' })] })
    expect(screen.getByText('Історія сканувань (2)')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByText(/\+2 −0 ~0/))
    })
    await waitFor(() => expect(api.getScanChanges).toHaveBeenCalledWith(9))
    expect(useStore.getState().historyScan?.id).toBe(9)
  })
})

describe('HistoryModal', () => {
  it('groups a past scan’s changes by kind, returned ones under "Повернулися"', () => {
    useStore.setState({
      historyScan: mkScan({ id: 4, added: 1, returned: 1 }),
      historyChanges: [
        mkChange(1, 'added', mkListing(1, { title: 'Fresh one' })),
        mkChange(2, 'returned', mkListing(2, { title: 'Came back' }))
      ]
    })
    render(<HistoryModal />)
    expect(screen.getByRole('heading', { name: 'Повернулися: 1' })).toBeInTheDocument()
    expect(screen.getByText('Came back')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toHaveLength(2)
    expect(screen.queryByText('NEW')).toBeNull()
  })
})

describe('ShopView: popularity, image sync, what changed', () => {
  it('cards show ❤ favorers with +N growth, 👁 views and ★ featured rank', () => {
    show({
      shops: [mkShop({ lastOkScan: mkScan() })],
      listings: [
        mkListing(1, { numFavorers: 87, favorersDelta: 5, views: 1342, featuredRank: 2 }),
        mkListing(2, { numFavorers: 3, favorersDelta: 0, views: null, featuredRank: -1 })
      ]
    })
    const [b, a] = screen.getAllByTestId('card-stats') // newest (#2) first
    expect(a.textContent!.replace(/\s/g, ' ')).toBe('❤ 87 +5👁 1 342★ 2')
    expect(b.textContent).toBe('❤ 3')
  })

  it('sorts by favorers, views and favorers growth', () => {
    show({
      shops: [mkShop({ lastOkScan: mkScan() })],
      listings: [
        mkListing(1, { title: 'A', numFavorers: 1, views: 300, favorersDelta: 9 }),
        mkListing(2, { title: 'B', numFavorers: 50, views: 10, favorersDelta: 1 }),
        mkListing(3, { title: 'C', numFavorers: 20, views: 200, favorersDelta: 4 })
      ]
    })
    const titles = () => screen.getAllByTestId('listing-card').map((c) => c.querySelector('.card-title')!.textContent)
    const sort = screen.getByLabelText('Сортування')
    expect(screen.getByRole('option', { name: 'Найпопулярніші (обране)' })).toBeInTheDocument()
    fireEvent.change(sort, { target: { value: 'favorites' } })
    expect(titles()).toEqual(['B', 'C', 'A'])
    fireEvent.change(sort, { target: { value: 'views' } })
    expect(titles()).toEqual(['A', 'C', 'B'])
    fireEvent.change(sort, { target: { value: 'favorites-growth' } })
    expect(titles()).toEqual(['A', 'C', 'B'])
  })

  it('the header shows shop stats with deltas', () => {
    show({
      shops: [
        mkShop({
          lastOkScan: mkScan(),
          stats: { numFavorers: 1530, transactionSoldCount: 2410, reviewCount: 512, reviewAverage: 4.9, listingActiveCount: 3 },
          statsDelta: { numFavorers: 10, transactionSoldCount: 3, reviewCount: 0, reviewAverage: -0.05, listingActiveCount: 0 }
        })
      ]
    })
    const t = screen.getByTestId('shop-stats').textContent!.replace(/\s/g, ' ')
    expect(t).toContain('Продано: 2 410 +3')
    expect(t).toContain('★ 4,9 −0,05 (512 відгуків)')
    expect(t).toContain('❤ 1 530 +10')
  })

  it('no stats yet → no stats line', () => {
    show({ shops: [mkShop({ lastOkScan: mkScan(), stats: null })] })
    expect(screen.queryByTestId('shop-stats')).toBeNull()
  })

  it('image sync status: "Фото: stored/total", errors, progress, and a manual retry', async () => {
    show({
      shops: [mkShop({ lastOkScan: mkScan() })],
      imageCounts: { total: 430, stored: 120, pending: 308, error: 2 },
      imageSync: { ...idleSync, lastError: 'MinIO недоступний (ECONNREFUSED). Запустіть: docker compose up -d' }
    })
    const line = screen.getByTestId('image-sync')
    expect(line).toHaveTextContent('Фото: 120/430')
    expect(line).toHaveTextContent('помилок: 2')
    expect(line).toHaveTextContent(/MinIO недоступний/)
    await act(async () => {
      fireEvent.click(screen.getByText('Синхронізувати фото'))
    })
    expect(api.syncImages).toHaveBeenCalledWith(1)
    act(() => {
      useStore.setState({ imageSync: { ...idleSync, running: true, done: 12, total: 310 } })
    })
    expect(screen.getByTestId('image-sync')).toHaveTextContent('синхронізація 12/310')
    expect(screen.queryByText('Синхронізувати фото')).toBeNull()
  })

  it('"Змінились" says what changed, per group and per listing', () => {
    const a = mkListing(5, { title: 'Mug' })
    const b = mkListing(6, { title: 'Plate' })
    show({
      shops: [mkShop({ lastOkScan: mkScan({ changed: 2 }) })],
      listings: [a, b],
      lastChanges: [
        mkChange(1, 'changed', a, {
          oldValue: { priceAmount: 1000, priceDivisor: 100, currency: 'UAH', description: 'old', images: [1, 2] },
          newValue: { priceAmount: 1500, priceDivisor: 100, currency: 'UAH', description: 'new', images: [3, 1, 2] }
        }),
        mkChange(2, 'changed', b, { oldValue: { tags: ['a'] }, newValue: { tags: ['a', 'b'] } })
      ]
    })
    expect(screen.getByTestId('changed-summary')).toHaveTextContent('(ціна, опис, фото, теги)')
    const rows = screen.getAllByTestId('change-fields')
    expect(rows[0]).toHaveTextContent('Змінилось: ціна, опис, фото')
    expect(rows[1]).toHaveTextContent('Змінилось: теги')
    expect(screen.getByText(/Фото: 2 → 3 \(нових 1\)/)).toBeInTheDocument()
    expect(screen.getByText('Теги: +b')).toBeInTheDocument()
  })
})

describe('ShopView: reviews', () => {
  const info = (over = {}) => ({
    synced: true,
    stored: 3200,
    average: 4.87,
    backfillComplete: false,
    estimate: 9300,
    lastSyncedAt: 1,
    lastError: null,
    newCount: 0,
    photos: { total: 40, stored: 12, pending: 28, error: 0 },
    ...over
  })

  it('cards show ⭐ avg (count), "≥" while the history is partial, and +N new reviews', () => {
    show({
      shops: [mkShop({ lastOkScan: mkScan() })],
      listings: [
        mkListing(1, { reviewCount: 123, reviewAvg: 4.9, reviewsNew: 2, reviewsPartial: false }),
        mkListing(2, { reviewCount: 1200, reviewAvg: 4.5, reviewsNew: 0, reviewsPartial: true }),
        mkListing(3, { reviewCount: 0, reviewAvg: null, reviewsNew: 0 })
      ]
    })
    const badges = screen.getAllByTestId('card-reviews').map((b) => b.textContent!.replace(/\s/g, ' '))
    // Newest first: #3 has none (no badge), then #2, #1.
    expect(badges).toEqual(['⭐ 4,5 (≥ 1 200)', '⭐ 4,9 (123) +2'])
  })

  it('sorts "Найбільше відгуків" and "Ріст відгуків"', () => {
    show({
      shops: [mkShop({ lastOkScan: mkScan() })],
      listings: [
        mkListing(1, { title: 'A', reviewCount: 5, reviewsNew: 3 }),
        mkListing(2, { title: 'B', reviewCount: 50, reviewsNew: 1 }),
        mkListing(3, { title: 'C', reviewCount: null, reviewsNew: null })
      ]
    })
    const titles = () => screen.getAllByTestId('listing-card').map((c) => c.querySelector('.card-title')!.textContent)
    const sort = screen.getByLabelText('Сортування')
    fireEvent.change(sort, { target: { value: 'reviews' } })
    expect(titles()).toEqual(['B', 'A', 'C'])
    fireEvent.change(sort, { target: { value: 'reviews-growth' } })
    expect(titles()).toEqual(['A', 'B', 'C'])
    expect(screen.getByRole('option', { name: 'Найбільше відгуків' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ріст відгуків' })).toBeInTheDocument()
  })

  it('the header shows stored / ~estimate, sync progress, errors and "Синхронізувати відгуки"', async () => {
    show({ shops: [mkShop({ lastOkScan: mkScan(), reviews: info() })] })
    const line = () => screen.getByTestId('review-sync').textContent!.replace(/\s/g, ' ')
    expect(line()).toContain('Відгуки: 3 200 / ~9 300 · ⭐ 4,87')
    expect(line()).toContain('історія завантажується')
    expect(line()).toContain('фото відгуків: 12/40')
    await act(async () => {
      fireEvent.click(screen.getByText('Синхронізувати відгуки'))
    })
    expect(api.syncReviews).toHaveBeenCalledWith(1)
    // While running: live numbers, no button.
    act(() => {
      useStore.setState({ reviewSync: { 1: idleReviews(1, { running: true, phase: 'backfill', stored: 3300, estimate: 9300, requests: 4 }) } })
    })
    expect(line()).toContain('Відгуки: 3 300 / ~9 300')
    expect(line()).toContain('синхронізація (історія, запитів: 4)')
    expect(screen.queryByText('Синхронізувати відгуки')).toBeNull()
  })

  it('a complete history shows no estimate; an unavailable endpoint shows the friendly error', () => {
    show({
      shops: [
        mkShop({
          lastOkScan: mkScan(),
          reviews: info({ stored: 9312, backfillComplete: true, lastError: 'Відгуки цього магазину недоступні (HTTP 404). Товари скануються як і раніше.' })
        })
      ]
    })
    const t = screen.getByTestId('review-sync').textContent!.replace(/\s/g, ' ')
    expect(t).toContain('Відгуки: 9 312 · ⭐ 4,87')
    expect(t).not.toContain('~')
    expect(t).not.toContain('історія завантажується')
    expect(t).toContain('недоступні (HTTP 404)')
  })

  it('never synced: says so and offers the sync', () => {
    show({ shops: [mkShop({ lastOkScan: mkScan(), reviews: null })] })
    expect(screen.getByTestId('review-sync')).toHaveTextContent('Відгуки ще не синхронізовано')
    expect(screen.getByText('Синхронізувати відгуки')).toBeEnabled()
  })

  it('only failed runs so far (403): "not synced" + the error, no "0" and no "історія завантажується"', () => {
    const err = 'Etsy не дозволяє читати відгуки цього магазину з цим ключем (HTTP 403). Товари скануються як і раніше.'
    show({
      shops: [
        mkShop({
          lastOkScan: mkScan(),
          reviews: info({ synced: false, stored: 0, average: null, estimate: null, lastError: err, photos: { total: 0, stored: 0, pending: 0, error: 0 } })
        })
      ]
    })
    const t = screen.getByTestId('review-sync').textContent!.replace(/\s/g, ' ')
    expect(t).toContain('Відгуки ще не синхронізовано')
    expect(t).toContain('HTTP 403')
    expect(t).not.toContain('Відгуки: 0')
    expect(t).not.toContain('історія завантажується')
  })

  it('"Нові відгуки" shows the real count when the list main sent is capped', () => {
    show({
      shops: [mkShop({ lastOkScan: mkScan(), reviews: info({ newCount: 350 }) })],
      newReviews: Array.from({ length: 200 }, (_, i) => mkReview(i + 1))
    })
    const group = screen.getByTestId('new-reviews')
    expect(group.querySelector('summary')!.textContent!.replace(/\s/g, ' ')).toBe('Нові відгуки: 350 (показано 200 з 350)')
    expect(group.querySelectorAll('.review-item')).toHaveLength(200)
  })

  it('"Нові відгуки" group in the scan results: stars, text excerpt, listing, date, photo; opens the listing', async () => {
    const listing = mkListing(1, { title: 'Blue mug' })
    api.getListing.mockResolvedValue(listing)
    show({
      shops: [mkShop({ lastOkScan: mkScan() })],
      newReviews: [
        mkReview(1, { rating: 4, text: 'Lovely!\nWould buy again', listingTitle: 'Blue mug', listingImageId: 10, hasImage: true, createdAt: 1_760_000_000 }),
        mkReview(2, { rating: 5, text: 'x'.repeat(400), listingTitle: 'Plate', listingImageId: null })
      ]
    })
    const group = screen.getByTestId('new-reviews')
    expect(group).toHaveTextContent('Нові відгуки: 2')
    expect(group).toHaveTextContent('★★★★☆')
    expect(group).toHaveTextContent('Lovely!')
    expect(group).toHaveTextContent('09.10.2025')
    expect(group.textContent).toContain('…') // long text is an excerpt
    expect(group.querySelector('img.review-photo')!.getAttribute('src')).toBe('etsyimg://review/1/fullxfull')
    expect(group.querySelector('.review-listing img')!.getAttribute('src')).toBe('etsyimg://img/10/75x75')
    await act(async () => {
      fireEvent.click(within(group).getByTitle('Blue mug'))
    })
    expect(api.getListing).toHaveBeenCalledWith(1)
    expect(useStore.getState().detailListing).toBe(listing)
  })

  it('no new reviews → no group (also for a baseline scan)', () => {
    show({ shops: [mkShop({ lastOkScan: mkScan({ isBaseline: true }) })], newReviews: [] })
    expect(screen.queryByTestId('new-reviews')).toBeNull()
  })
})

describe('ShopView: buyer prices and promotions', () => {
  const sale = (pct: number) =>
    mkBuyerPrice({ discountPercentage: pct, discounted: { amount: 300 - pct * 3, divisor: 100 } })
  const grid = () => screen.getAllByTestId('listing-card').map((c) => c.querySelector('.card-title')!.textContent)

  it('"Найбільша знижка" sorts the grid; "Зі знижкою" filters it', async () => {
    show({
      shops: [mkShop({ lastOkScan: mkScan() })],
      listings: [
        mkListing(1, { title: 'No sale' }),
        mkListing(2, { title: 'Ten', buyerPrice: sale(10) }),
        mkListing(3, { title: 'Sixty', buyerPrice: sale(60) }),
        mkListing(4, { title: 'VAT only', buyerPrice: mkBuyerPrice({ discount: false }) })
      ]
    })
    fireEvent.change(screen.getByLabelText('Сортування'), { target: { value: 'discount' } })
    expect(useStore.getState().sort).toBe('discount')
    expect(grid()).toEqual(['Sixty', 'Ten', 'VAT only', 'No sale'])
    fireEvent.click(screen.getByLabelText('Зі знижкою'))
    expect(useStore.getState().discountOnly).toBe(true)
    expect(grid()).toEqual(['Sixty', 'Ten'])
    fireEvent.click(screen.getByLabelText('Зі знижкою'))
    expect(grid()).toHaveLength(4)
  })

  it('"Зі знижкою" with no discounted listing says nothing was found', () => {
    show({ shops: [mkShop({ lastOkScan: mkScan() })], listings: [mkListing(1)], discountOnly: true })
    expect(screen.getByText('Нічого не знайдено.')).toBeInTheDocument()
  })

  it('the scan results list promotions that started / ended; a row opens the listing', async () => {
    const l = mkListing(5, { title: 'Sale mug' })
    api.getListing.mockResolvedValue(l)
    show({
      shops: [mkShop({ lastOkScan: mkScan({ promotionsStarted: 1, promotionsEnded: 1 }) })],
      listings: [l],
      scanPromotions: {
        started: [mkPromotion(1, { listingId: 5, listingTitle: 'Sale mug', listingImageId: 50 })],
        ended: [mkPromotion(2, { listingId: 6, listingTitle: 'Old sale', discountPercentage: 15, endedAt: 1, endReason: 'ended' })]
      }
    })
    const group = screen.getByTestId('scan-promotions')
    expect(group.querySelector('summary')).toHaveTextContent('Акції: почалися 1, закінчилися 1')
    const started = within(screen.getByTestId('promotions-started'))
    expect(started.getByText('Sale mug')).toBeInTheDocument()
    expect(started.getByText('−60%')).toBeInTheDocument()
    expect(within(screen.getByTestId('promotions-started')).getByRole('button').querySelector('img')).toHaveAttribute(
      'src',
      'etsyimg://img/50/75x75'
    )
    expect(within(screen.getByTestId('promotions-ended')).getByText('−15%')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(started.getByText('Sale mug'))
    })
    expect(api.getListing).toHaveBeenCalledWith(5)
    expect(useStore.getState().detailListing).toBe(l)
  })

  it('"Акції" counts come from the scan (main caps the lists at 200): "(показано 2 з 430)"', () => {
    show({
      shops: [mkShop({ lastOkScan: mkScan({ promotionsStarted: 430, promotionsEnded: 0 }) })],
      listings: [mkListing(1)],
      scanPromotions: { started: [mkPromotion(1, { listingId: 1 }), mkPromotion(2, { listingId: 2 })], ended: [] }
    })
    const group = screen.getByTestId('scan-promotions')
    expect(group.querySelector('summary')!.textContent).toBe('Акції: почалися 430')
    expect(group.querySelector('h4')).toHaveTextContent('Почалися (показано 2 з 430)')
    expect(screen.getByTestId('promotions-started').children).toHaveLength(2)
    expect(screen.queryByTestId('promotions-ended')).toBeNull()
  })

  it('"Акції" with only ended promotions: no "почалися", only the ended list, no "(показано …)" when all are listed', () => {
    show({
      shops: [mkShop({ lastOkScan: mkScan({ promotionsStarted: 0, promotionsEnded: 1 }) })],
      listings: [mkListing(1)],
      scanPromotions: { started: [], ended: [mkPromotion(3, { listingId: 1, endedAt: 1, endReason: 'ended' })] }
    })
    const group = screen.getByTestId('scan-promotions')
    expect(group.querySelector('summary')!.textContent).toBe('Акції: закінчилися 1')
    expect(screen.queryByTestId('promotions-started')).toBeNull()
    expect(group.querySelector('h4')!.textContent).toBe('Закінчилися')
  })

  it('"Акції" rows: fixed amount, no terms at all, a listing we never stored, no original price or currency', () => {
    show({
      shops: [mkShop({ lastOkScan: mkScan({ promotionsStarted: 3, promotionsEnded: 0 }) })],
      listings: [mkListing(1)],
      scanPromotions: {
        started: [
          mkPromotion(1, { listingId: 1, listingTitle: 'Fixed', listingImageId: 10, discountPercentage: null }),
          mkPromotion(2, { listingId: 2, listingTitle: 'Bare', listingImageId: 20, discountPercentage: null, discountAmount: null }),
          mkPromotion(3, { listingId: 6, listingTitle: null, listingImageId: null, original: null, currency: null })
        ],
        ended: []
      }
    })
    const rows = screen.getByTestId('promotions-started').querySelectorAll('li')
    expect(rows[0].querySelector('.badge-discount')!.textContent!.replace(/\s/g, ' ')).toBe('−1,80 USD')
    expect(rows[0].querySelector('s.price-was')).toHaveTextContent('3,00')
    expect(rows[0]).toHaveTextContent('стара ціна')
    expect(rows[1].querySelector('.badge-discount')!.textContent).toBe('знижка')
    expect(within(rows[2] as HTMLElement).getByText('Товар 6')).toBeInTheDocument()
    expect(rows[2].querySelector('button')).toHaveAttribute('title', 'Товар 6')
    expect(rows[2].querySelector('img')).toBeNull()
    expect(rows[2].querySelector('.no-img')).toHaveTextContent('—')
    expect(rows[2].querySelector('s.price-was')).toBeNull()
    expect(rows[2].querySelector('.promo-terms')).toHaveTextContent('1.20')
  })

  it('no promotion events: no "Акції" group', () => {
    show({ shops: [mkShop({ lastOkScan: mkScan() })], listings: [mkListing(1)] })
    expect(screen.queryByTestId('scan-promotions')).toBeNull()
  })

  it('says when Etsy did not serve buyer prices, and when a new country waits for the next scan', () => {
    const { unmount } = show({
      shops: [mkShop({ lastOkScan: mkScan({ buyerCountry: 'UA', buyerPrices: 'unavailable' }) })],
      listings: [mkListing(1)],
      buyerCountry: 'UA'
    })
    expect(screen.getByTestId('buyer-prices-unavailable')).toHaveTextContent('показано базові ціни продавця')
    expect(screen.queryByTestId('buyer-country-pending')).toBeNull()
    unmount()
    show({
      shops: [mkShop({ lastOkScan: mkScan({ buyerCountry: 'UA', buyerPrices: 'ok' }) })],
      listings: [mkListing(1)],
      buyerCountry: 'DE'
    })
    expect(screen.queryByTestId('buyer-prices-unavailable')).toBeNull()
    expect(screen.getByTestId('buyer-country-pending')).toHaveTextContent(
      'Ціни показано для покупця з UA; нова країна (DE) застосується з наступного сканування.'
    )
  })

  it('grid cards show the buyer price', () => {
    show({ shops: [mkShop({ lastOkScan: mkScan() })], listings: [mkListing(1, { buyerPrice: mkBuyerPrice() })] })
    expect(screen.getByTestId('discount-badge')).toHaveTextContent('−60%')
  })
})
