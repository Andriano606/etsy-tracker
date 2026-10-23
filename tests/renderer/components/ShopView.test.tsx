// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ShopView } from '../../../src/renderer/src/components/ShopView'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { HistoryModal } from '../../../src/renderer/src/components/ScanHistory'
import { useStore } from '../../../src/renderer/src/store'
import { idleSync, mkChange, mkListing, mkScan, mkShop, setupRenderer, withKey, type Api } from '../helpers'

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
