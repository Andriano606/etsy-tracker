// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeLayout, type FakeLayout } from '../ui/measure'
import { ShopView, imageErrorText } from '../../../src/renderer/src/components/ShopView'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { HistoryModal } from '../../../src/renderer/src/components/ScanHistory'
import { useStore } from '../../../src/renderer/src/store'
import { ImageViewer } from '../../../src/renderer/src/ui'
import { GLOSSARY } from '../../../src/shared/glossary'
import { etsyIn, idleReviews, idleSync, mkBuyerPrice, mkChange, mkListing, mkPromotion, mkReview, mkScan, mkShop, setupRenderer, withKey, type Api } from '../helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
})

/** What a sighted user reads: the text without hidden tooltip texts and screen-reader-only words. */
function visibleText(el: Element): string {
  const c = el.cloneNode(true) as Element
  c.querySelectorAll('[hidden], .sr-only').forEach((n) => n.remove())
  return c.textContent!.replace(/\s+/g, ' ').trim()
}

/** A stat tile of the overview by its label: value + change. */
function tile(label: string) {
  const t = within(screen.getByTestId('shop-stats')).getByText(label).closest('.ui-stat') as HTMLElement
  const text = (sel: string) => t.querySelector(sel)?.textContent!.replace(/\s/g, ' ') ?? null
  return { value: text('.ui-stat-value'), delta: text('.ui-stat-delta'), caption: text('.ui-stat-caption') }
}

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
  it('shows new items first in the results panel, with «Новий» badges in the grid', () => {
    const old1 = mkListing(1)
    const old2 = mkListing(2)
    const fresh = mkListing(3, { title: 'Brand new mug' })
    show({
      shops: [mkShop({ lastOkScan: mkScan({ added: 1 }), newCount: 1 })],
      listings: [old1, old2, fresh],
      lastChanges: [mkChange(1, 'added', fresh)]
    })
    const results = screen.getByTestId('scan-results')
    expect(results).toHaveTextContent('Що змінилось з минулого сканування')
    expect(within(results).getByRole('heading', { name: /^Нові товари: 1/ })).toBeInTheDocument()
    const cards = screen.getAllByTestId('listing-card')
    // The results panel (rendered before the grid) leads with the new listing.
    expect(cards[0]).toHaveTextContent('Brand new mug')
    expect(within(results).getByText('Новий')).toBeInTheDocument()
    // In the full grid exactly one card carries the badge.
    expect(screen.getAllByText('Новий')).toHaveLength(2)
    expect(cards.filter((c) => c.classList.contains('is-new'))).toHaveLength(2)
  })

  it('a baseline scan says how many were saved, with no «Новий» badges', () => {
    show({
      shops: [mkShop({ lastOkScan: mkScan({ isBaseline: true, total: 42 }) })],
      listings: [mkListing(1)]
    })
    // The right plural: 42 товари (not "42 товарів").
    expect(screen.getByText('Базове сканування: збережено 42 товари')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Що таке «Базове сканування»?' })).toHaveAccessibleDescription(GLOSSARY.baseline.short)
    expect(screen.queryByText('Новий')).toBeNull()
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
    expect(screen.getByRole('heading', { name: /^Нові товари: 0/ })).toBeInTheDocument()
    expect(screen.getByText('Нових товарів немає.')).toBeInTheDocument()
    expect(screen.getByText('Зникли: 1')).toBeInTheDocument()
    // Every group says in plain words what it means.
    expect(screen.getByText('Зникли: 1').closest('summary')).toHaveTextContent(GLOSSARY.listingRemoved.short)
    expect(screen.getByText(/^Змінились: 1/).closest('summary')).toHaveTextContent(GLOSSARY.listingChanged.short)
    expect(screen.getByText('Gone mug')).toBeInTheDocument()
    expect(screen.getByText(/^Змінились: 1/)).toBeInTheDocument()
    expect(screen.getByTestId('changed-summary')).toHaveTextContent('(ціна)')
    expect(screen.getByText(/10,00/)).toBeInTheDocument()
    expect(screen.getByText(/15,00/)).toBeInTheDocument()
  })

  it('returned listings get their own "Повернулися" group and no «Новий» badge', () => {
    const back = mkListing(6, { title: 'Back again mug' })
    show({
      shops: [mkShop({ lastOkScan: mkScan({ returned: 1 }) })],
      listings: [mkListing(1), back],
      lastChanges: [mkChange(1, 'returned', back)]
    })
    expect(screen.getByText('Повернулися: 1')).toBeInTheDocument()
    expect(screen.getByText('Нових товарів немає.')).toBeInTheDocument()
    expect(screen.queryByText('Новий')).toBeNull()
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
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Останнє сканування не вдалося')
    expect(alert).toHaveTextContent(/Сервер Etsy повернув помилку \(HTTP 500\)/)
    expect(alert).toHaveTextContent(/попереднього успішного/)
  })

  it('warns when data is older than 6 hours', () => {
    const old = Date.now() - 7 * 3600_000
    show({ shops: [mkShop({ lastOkScan: mkScan({ finishedAt: old }) })] })
    expect(screen.getByText(/старші за 6 годин/)).toBeInTheDocument()
    expect(screen.getByText('Дані застаріли')).toBeInTheDocument()
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

  it('Сканувати повторно calls main and shows progress in plain words while running (the button label stays put)', async () => {
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
    expect(await screen.findByTestId('scan-progress')).toHaveTextContent('Читаю список товарів: сторінка 2 з 5')
    expect(screen.queryByText('Сторінка 2/5')).toBeNull()
    const button = screen.getByRole('button', { name: 'Сканування…' })
    expect(button).toHaveAccessibleDescription('Читаю список товарів: сторінка 2 з 5')
    act(() => {
      useStore.setState({ progress: { 1: { shopId: 1, phase: 'details', done: 100, total: 430, label: 'Деталі 100/430' } } })
    })
    expect(screen.getByTestId('scan-progress')).toHaveTextContent('Читаю фото й деталі товарів: 100 з 430')
    expect(screen.getByRole('button', { name: 'Сканування…' })).toBe(button)
    act(() => {
      useStore.setState({ progress: { 1: { shopId: 1, phase: 'verify', done: 0, total: 3, label: 'Перевірка зниклих (3)…' } } })
    })
    expect(screen.getByTestId('scan-progress')).toHaveTextContent('Перевіряю товари, яких не стало в списку…')
    act(() => {
      useStore.setState({ progress: { 1: { shopId: 1, phase: 'saving', done: 0, total: 1, label: 'Збереження…' } } })
    })
    expect(screen.getByTestId('scan-progress')).toHaveTextContent('Зберігаю результати…')
  })

  it('Видалити asks for confirmation first', async () => {
    show({ shops: [mkShop()] })
    fireEvent.click(screen.getByText('Видалити'))
    expect(await screen.findByText(/Усі збережені товари/)).toBeInTheDocument()
    // The shop's name (not its tagline), a heading and a verb on the button; Etsy itself is untouched.
    expect(screen.getByText(/Видалити магазин «CeramicStudioUA» з програми\?/)).toBeInTheDocument()
    expect(screen.getAllByText(/На Etsy нічого не зміниться/).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Видалити магазин?' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Скасувати'))
    expect(api.removeShop).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Видалити'))
    const confirm = await screen.findByRole('button', { name: 'Видалити магазин' })
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
    // A failed scan can't be opened; its status is a word, not a colour.
    expect(screen.getByText('boom').closest('button')).toBeDisabled()
    expect(screen.getByText('boom').closest('button')).toHaveTextContent('Помилка')
    await act(async () => {
      fireEvent.click(screen.getByText('нові 2 · усього 3 товари'))
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
    expect(screen.queryByText('Новий')).toBeNull()
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
    const stat = (card: HTMLElement, id: string) => {
      const el = within(card).queryByTestId(id)
      return el && visibleText(el)
    }
    expect(stat(a, 'card-favorites')).toBe('87 +5')
    expect(stat(a, 'card-views')).toBe('1 342')
    expect(stat(a, 'card-featured')).toBe('№2')
    // Screen readers hear what each number is.
    expect(within(a).getByTestId('card-favorites')).toHaveTextContent('87 в обраному')
    expect(within(a).getByTestId('card-views')).toHaveTextContent('1 342 переглядів')
    expect(stat(b, 'card-favorites')).toBe('3')
    expect(stat(b, 'card-views')).toBeNull()
    expect(stat(b, 'card-featured')).toBeNull()
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
    expect(screen.getByRole('option', { name: 'Найбільше в обраному' })).toBeInTheDocument()
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
    expect(tile('Продажі')).toEqual({ value: '2 410', delta: '+3', caption: 'за весь час' })
    expect(tile('Рейтинг')).toEqual({ value: '4,9', delta: '−0,05', caption: 'середня оцінка з 5' })
    // No change → no "0" (a calm tile).
    expect(tile('Відгуки')).toEqual({ value: '512', delta: null, caption: 'за весь час' })
    expect(tile('Обране')).toEqual({ value: '1 530', delta: '+10', caption: 'додали магазин в обране' })
    // Each number is explained, and so is what the change means.
    expect(screen.getByRole('button', { name: 'Що таке «Продажі магазину»?' })).toHaveAccessibleDescription(GLOSSARY.salesCount.short)
    expect(screen.getByRole('button', { name: 'Що таке «Обране магазину»?' })).toHaveAccessibleDescription(GLOSSARY.shopFavorers.short)
    expect(screen.getByRole('button', { name: 'Що таке «Магазин зараз»?' })).toHaveAccessibleDescription(GLOSSARY['shop.overview'].short)
    expect(screen.getByText('+3').closest('.ui-stat-delta')).toHaveAttribute('title', 'Зміна з попереднього сканування')
  })

  it('no stats yet → no stats line', () => {
    show({ shops: [mkShop({ lastOkScan: mkScan(), stats: null })] })
    expect(screen.queryByTestId('shop-stats')).toBeNull()
  })

  it('image sync status: "Фото: stored/total", errors, progress — no button of its own (the scan does it)', async () => {
    show({
      shops: [mkShop({ lastOkScan: mkScan() })],
      imageCounts: { total: 430, stored: 120, pending: 308, error: 2 },
      imageSync: { ...idleSync, lastError: 'MinIO недоступний (ECONNREFUSED). Запустіть: docker compose up -d' }
    })
    const line = screen.getByTestId('image-sync')
    expect(visibleText(line)).toContain('Фото товарів')
    expect(visibleText(line)).toContain('збережено 120 з 430')
    expect(visibleText(line)).toContain('не вдалося: 2')
    // The store error in plain words; the technical text only in the details tip.
    const err = screen.getByTestId('image-sync-error')
    expect(visibleText(err)).toBe('Сховище фото на цьому комп’ютері не відповідає — поки що фото показуються прямо з Etsy.')
    expect(visibleText(line)).not.toMatch(/MinIO|ECONNREFUSED|docker/)
    expect(within(err).getByText('Сховище фото')).toHaveAccessibleDescription(GLOSSARY.minio.short)
    expect(within(err).getByRole('button', { name: 'Технічні деталі помилки' })).toHaveAccessibleDescription(
      'MinIO недоступний (ECONNREFUSED). Запустіть: docker compose up -d'
    )
    await act(async () => {
      fireEvent.click(within(line).getByRole('button', { name: 'Відкрити Налаштування' }))
    })
    expect(useStore.getState().showSettings).toBe(true)
    // One button refreshes everything: no separate photo sync, a note says so.
    expect(screen.queryByText('Синхронізувати фото')).toBeNull()
    expect(screen.getByText(/Фото й відгуки оновлюються самі після кожного сканування/)).toBeInTheDocument()
    act(() => {
      useStore.setState({ imageSync: { ...idleSync, running: true, done: 12, total: 310 } })
    })
    expect(visibleText(screen.getByTestId('image-sync'))).toContain('копіюються 12 з 310')
    expect(screen.queryByText('Синхронізувати фото')).toBeNull()
    expect(screen.queryByTestId('image-sync-error')).toBeNull()
  })

  it('other photo-store errors read as plain words too', () => {
    const text = (raw: string) => Object.values(imageErrorText(raw)).join('')
    expect(text('MinIO відхилив облікові дані (AccessDenied). Перевірте Access key і Secret key.')).toBe(
      'Сховище фото не прийняло логін і пароль — перевірте їх у Налаштуваннях. Поки що фото показуються прямо з Etsy.'
    )
    expect(text('У MinIO закінчилось місце на диску — звільніть місце там, де лежать його дані (MINIO_DATA_DIR). Фото докопіюються пізніше.')).toBe(
      'У сховищі фото закінчилось місце на диску — звільніть місце, і фото докопіюються пізніше.'
    )
    expect(text('Помилка MinIO: XYZ: boom')).toBe('Не вдалося скопіювати фото у сховище на цьому комп’ютері — поки що фото показуються прямо з Etsy.')
  })

  it('change rows name whose price they show: the buyer price like the cards, else the seller price (без ПДВ)', () => {
    const back = mkListing(5, { title: 'Back', priceAmount: 250, priceDivisor: 100, currency: 'USD', buyerPrice: mkBuyerPrice() })
    const gone = mkListing(6, { title: 'Gone', priceAmount: 492, priceDivisor: 100, currency: 'USD', buyerPrice: null })
    const edited = mkListing(7, { title: 'Edited' })
    show({
      shops: [mkShop({ lastOkScan: mkScan({ returned: 1, removed: 1, changed: 1 }) })],
      listings: [back, edited],
      lastChanges: [
        mkChange(1, 'returned', back),
        mkChange(2, 'removed', gone),
        mkChange(3, 'changed', edited, {
          oldValue: { priceAmount: 1000, priceDivisor: 100, currency: 'USD' },
          newValue: { priceAmount: 1500, priceDivisor: 100, currency: 'USD' }
        })
      ]
    })
    const row = (title: string) => within(screen.getByTestId('scan-results')).getByText(title).closest('.change-row') as HTMLElement
    const returned = row('Back').querySelector('.change-price')!
    expect(visibleText(returned)).toMatch(/^Ціна для покупця з UA: 1,20\sUSD 3,00\sUSD −60%$/)
    expect(returned.querySelector('s.price-was')).toHaveTextContent('3,00')
    expect(visibleText(row('Gone').querySelector('.change-price')!)).toMatch(/^Ціна продавця \(без ПДВ\): 4,92\sUSD$/)
    expect(row('Edited')).toHaveTextContent(/Ціна продавця \(без ПДВ\): 10,00\sUSD → 15,00\sUSD/)
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
    const badges = screen.getAllByTestId('card-reviews').map(visibleText)
    // Newest first: #3 has none (no badge), then #2, #1.
    expect(badges).toEqual(['4,5 (≥ 1 200)', '4,9 (123) +2'])
    expect(screen.getAllByTestId('card-reviews')[1]).toHaveTextContent('Оцінка 4,9 (123) відгуків +2')
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
    expect(screen.getByRole('option', { name: 'Найбільше нових відгуків' })).toBeInTheDocument()
  })

  it('the header shows stored / ~estimate and sync progress — no button of its own (the scan does it)', async () => {
    show({ shops: [mkShop({ lastOkScan: mkScan(), reviews: info() })] })
    const line = () => visibleText(screen.getByTestId('review-sync'))
    expect(line()).toContain('Відгуки покупців')
    expect(line()).toContain('завантажено 3 200 з ~9 300')
    expect(line()).toContain('середня оцінка 4,87')
    expect(line()).toContain('історія ще завантажується')
    expect(line()).toContain('фото відгуків: 12 з 40')
    expect(screen.queryByText('Синхронізувати відгуки')).toBeNull()
    // While running (after a scan): live numbers.
    act(() => {
      useStore.setState({ reviewSync: { 1: idleReviews(1, { running: true, phase: 'backfill', stored: 3300, estimate: 9300, requests: 4 }) } })
    })
    expect(line()).toContain('завантажено 3 300 з ~9 300')
    expect(line()).toContain('завантажуються (історія, запитів: 4)')
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
    const t = visibleText(screen.getByTestId('review-sync'))
    expect(t).toContain('завантажено 9 312')
    expect(t).toContain('середня оцінка 4,87')
    expect(t).not.toContain('~')
    expect(t).not.toContain('історія ще завантажується')
    expect(t).toContain('Etsy зараз не показує відгуки цього магазину. Товари скануються як і раніше.')
    expect(t).not.toContain('HTTP')
    expect(screen.getByRole('button', { name: 'Технічні деталі помилки' })).toHaveAccessibleDescription(/недоступні \(HTTP 404\)/)
  })

  it('never synced: says so (the next scan loads them)', () => {
    show({ shops: [mkShop({ lastOkScan: mkScan(), reviews: null })] })
    expect(visibleText(screen.getByTestId('review-sync'))).toContain('ще не завантажено')
    expect(screen.queryByText('Синхронізувати відгуки')).toBeNull()
  })

  it('the scan button says it refreshes everything (products, prices, reviews, photos)', () => {
    show({ shops: [mkShop({ lastOkScan: mkScan() })] })
    expect(screen.getByRole('button', { name: 'Сканувати повторно' })).toHaveAccessibleDescription(/товари, ціни, популярність, відгуки й фото/)
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
    const t = visibleText(screen.getByTestId('review-sync'))
    expect(t).toContain('ще не завантажено')
    expect(t).toContain('Etsy не дає читати відгуки цього магазину з вашим ключем.')
    expect(t).not.toContain('HTTP')
    expect(screen.getByTestId('review-sync-error')).toHaveAttribute('title', err)
    expect(screen.getByRole('button', { name: 'Технічні деталі помилки' })).toHaveAccessibleDescription(err)
    expect(t).not.toContain('завантажено 0')
    expect(t).not.toContain('історія ще завантажується')
  })

  it('"Нові відгуки" shows the real count when the list main sent is capped', () => {
    show({
      shops: [mkShop({ lastOkScan: mkScan(), reviews: info({ newCount: 350 }) })],
      newReviews: Array.from({ length: 200 }, (_, i) => mkReview(i + 1))
    })
    const group = screen.getByTestId('new-reviews')
    expect(group.querySelector('summary .group-label')!.textContent!.replace(/\s/g, ' ')).toBe('Нові відгуки: 350 (показано 200 з 350)')
    expect(group.querySelector('summary')).toHaveTextContent(GLOSSARY.newReviews.short)
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
    expect(screen.getByRole('switch', { name: 'Зі знижкою' })).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('Зі знижкою'))
    expect(useStore.getState().discountOnly).toBe(true)
    expect(screen.getByRole('switch', { name: 'Зі знижкою' })).toBeChecked()
    expect(screen.getByText('показано 2 з 4')).toBeInTheDocument()
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
    expect(within(screen.getByTestId('promotions-started')).getByRole('button', { name: 'Sale mug' }).querySelector('img')).toHaveAttribute(
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
    expect(group.querySelector('summary .group-label')!.textContent).toBe('Акції: почалися 430')
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
    expect(group.querySelector('summary .group-label')!.textContent).toBe('Акції: закінчилися 1')
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

describe('ShopView: header, explanations and empty states (redesign)', () => {
  let layout: FakeLayout | null = null
  afterEach(() => {
    layout?.restore()
    layout = null
  })

  it('the actions are one labelled group: scan first (explained), delete red and explained', () => {
    show({ shops: [mkShop({ lastOkScan: mkScan() })] })
    const bar = screen.getByRole('group', { name: 'Дії з магазином' })
    const names = within(bar).getAllByRole('button').map((b) => b.textContent)
    expect(names[0]).toBe('Сканувати повторно')
    expect(names).toContain('Статистика')
    expect(names.at(-1)).toBe('Видалити')
    expect(screen.getByRole('button', { name: 'Сканувати повторно' })).toHaveAccessibleDescription(/показати, що змінилось/)
    const del = screen.getByRole('button', { name: 'Видалити' })
    expect(del).toHaveClass('danger')
    expect(del).toHaveAccessibleDescription(/На Etsy нічого не зміниться/)
  })

  it('a narrow window keeps the title and the scan button; the rest goes into the "⋯" menu, delete stays red', async () => {
    layout = fakeLayout({ 'ui-actionbar': 260, 'ui-actionbar-item': 120, 'ui-menu-trigger': 36 })
    show({ shops: [mkShop({ lastOkScan: mkScan() })] })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('CeramicStudioUA')
    expect(screen.getByRole('button', { name: 'Сканувати повторно' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Видалити' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Ще дії' }))
    const del = screen.getByRole('menuitem', { name: /Видалити/ })
    expect(del.className).toMatch(/danger/)
    await userEvent.click(del)
    // Still asks first.
    expect(await screen.findByText(/Усі збережені товари/)).toBeInTheDocument()
    expect(api.removeShop).not.toHaveBeenCalled()
  })

  it('the own shop: an explained "мій" badge, and "Керувати" stays visible even when narrow', () => {
    layout = fakeLayout({ 'ui-actionbar': 300, 'ui-actionbar-item': 120, 'ui-menu-trigger': 36 })
    const own = mkShop({ id: 5, lastOkScan: mkScan({ shopId: 5 }) })
    show({ shops: [own], activeShopId: 5, etsyAuth: etsyIn({ shopId: 5 }) })
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(within(h1).getByText('мій')).toHaveAccessibleDescription(GLOSSARY['shop.mine'].short)
    expect(screen.getByRole('button', { name: 'Сканувати повторно' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Керувати' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Статистика' })).toBeNull()
  })

  it('the status line: when it was updated, how many products, a link to the shop — each explained', () => {
    show({ shops: [mkShop({ lastOkScan: mkScan({ finishedAt: Date.now() - 2 * 3600_000 }), activeCount: 22 })] })
    expect(screen.getByText('Оновлено')).toHaveAccessibleDescription(GLOSSARY['shop.lastUpdate'].short)
    expect(screen.getByText('22 товари у продажу')).toHaveAccessibleDescription(GLOSSARY['shop.activeCount'].short)
    expect(screen.getByText(/2 год тому/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Відкрити на Etsy/ })).toBeInTheDocument()
  })

  it('no key: a warning with a way out to Settings; scanning is disabled and says why', async () => {
    show({ shops: [mkShop({ lastOkScan: mkScan() })], keyStatus: { hasKey: false, masked: null, encrypted: false } })
    expect(screen.getByText('Немає ключа доступу до Etsy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сканувати повторно' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Сканувати повторно' })).toHaveAccessibleDescription(/ключ доступу/)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Відкрити Налаштування' }))
    })
    expect(useStore.getState().showSettings).toBe(true)
  })

  it('never scanned: says what scanning does and how many products Etsy has', () => {
    show({ shops: [mkShop({ lastOkScan: null, lastScan: null, etsyActiveCount: 1234 })] })
    expect(screen.getByText('Магазин ще не скановано')).toBeInTheDocument()
    expect(screen.getByText(/на Etsy їх зараз 1\s234/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сканувати' })).toBeEnabled()
    expect(screen.queryByTestId('scan-results')).toBeNull()
  })

  it('a scanned shop with no products says so', () => {
    show({ shops: [mkShop({ lastOkScan: mkScan() })], listings: [] })
    expect(screen.getByText('Товарів у продажу немає')).toBeInTheDocument()
  })

  it('nothing found: one button resets the search and the discount filter', async () => {
    show({ shops: [mkShop({ lastOkScan: mkScan() })], listings: [mkListing(1, { title: 'Mug' })], search: 'zzz', discountOnly: true })
    expect(screen.getByText('Нічого не знайдено.')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Скинути пошук і фільтр' }))
    })
    expect(useStore.getState().search).toBe('')
    expect(useStore.getState().discountOnly).toBe(false)
    expect(screen.getAllByTestId('listing-card')).toHaveLength(1)
  })

  it('nothing found by the search alone: no word about «Зі знижкою», the button resets only the search', async () => {
    show({ shops: [mkShop({ lastOkScan: mkScan() })], listings: [mkListing(1, { title: 'Mug' })], search: 'zzz', discountOnly: false })
    const empty = screen.getByText('Нічого не знайдено.').closest('.ui-empty') as HTMLElement
    expect(empty).toHaveTextContent('Спробуйте інше слово.')
    expect(empty).not.toHaveTextContent('Зі знижкою')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Скинути пошук' }))
    })
    expect(useStore.getState().search).toBe('')
    expect(screen.getAllByTestId('listing-card')).toHaveLength(1)
  })

  it('nothing on sale (no search): says so and the button turns the filter off', async () => {
    show({ shops: [mkShop({ lastOkScan: mkScan() })], listings: [mkListing(1, { title: 'Mug', buyerPrice: null })], discountOnly: true })
    expect(screen.getByText(/Зараз жоден товар магазину не має знижки/)).toBeInTheDocument()
    expect(screen.queryByText(/Спробуйте інше слово/)).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Вимкнути «Зі знижкою»' }))
    })
    expect(useStore.getState().discountOnly).toBe(false)
    expect(screen.getAllByTestId('listing-card')).toHaveLength(1)
  })

  it('headings keep clean names: the ⓘ sits beside them, not inside', () => {
    show({ shops: [mkShop({ lastOkScan: mkScan({ added: 1 }) })], listings: [mkListing(1)], lastChanges: [mkChange(1, 'added', mkListing(1))] })
    expect(screen.getByRole('heading', { level: 2, name: 'Магазин зараз' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /^Усі товари магазину\s*1$/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: /^Нові товари:\s*1$/ })).toBeInTheDocument()
    for (const h of screen.getAllByRole('heading')) expect(h.querySelector('.ui-infotip')).toBeNull()
    expect(screen.getByRole('button', { name: 'Що таке «Усі товари магазину»?' })).toHaveAccessibleDescription(GLOSSARY['shop.allListings'].short)
  })

  it('the grid toolbar: a labelled search, a plain-words sort, an explained "Зі знижкою" switch', () => {
    show({ shops: [mkShop({ lastOkScan: mkScan() })], listings: [mkListing(1)] })
    expect(screen.getByRole('searchbox', { name: 'Пошук товарів за назвою або тегом' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Сортування' })).toHaveValue('newest')
    expect(screen.getByRole('option', { name: 'Спершу дешевші' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Що таке «Фільтр «Зі знижкою»»?' })).toHaveAccessibleDescription(GLOSSARY['shop.discountOnly'].short)
  })

  it('photos all saved: no sync button; reviews with no rating yet show "—", not "0"', () => {
    show({
      shops: [
        mkShop({
          lastOkScan: mkScan(),
          stats: { numFavorers: 0, transactionSoldCount: 0, reviewCount: 0, reviewAverage: 0, listingActiveCount: 0 },
          statsDelta: null
        })
      ],
      imageCounts: { total: 10, stored: 10, pending: 0, error: 0 },
      imageSync: idleSync
    })
    expect(visibleText(screen.getByTestId('image-sync'))).toContain('збережено 10 з 10')
    expect(screen.queryByRole('button', { name: 'Синхронізувати фото' })).toBeNull()
    expect(tile('Рейтинг')).toEqual({ value: '—', delta: null, caption: 'ще немає оцінок' })
  })

  it('scan history rows read as words: "без змін", "базове: N товарів"; neither an unchanged nor a baseline row opens an empty dialog', () => {
    const scans = [mkScan({ id: 4, total: 5, changed: 1 }), mkScan({ id: 3, total: 5 }), mkScan({ id: 2, isBaseline: true, total: 5 })]
    show({ shops: [mkShop({ lastOkScan: scans[0] })], scans })
    const unchanged = screen.getByText('без змін · усього 5 товарів').closest('button')!
    expect(unchanged).toBeDisabled()
    expect(unchanged).toHaveAttribute('title', 'У цьому скануванні нічого не змінилось')
    expect(unchanged.querySelector('.history-go')).toBeNull()
    const changed = screen.getByText('змінились 1 · усього 5 товарів').closest('button')!
    expect(changed).toBeEnabled()
    expect(changed.querySelector('.history-go')).not.toBeNull()
    expect(screen.getByText('базове: 5 товарів').closest('button')).toBeDisabled()
    expect(screen.getAllByText('Успішно')).toHaveLength(3)
  })
})

describe('HistoryModal (redesign)', () => {
  it('is a dialog named after the scan, explains each group and closes with ×', async () => {
    useStore.setState({
      historyScan: mkScan({ id: 4, removed: 1 }),
      historyChanges: [mkChange(1, 'removed', mkListing(1, { title: 'Gone' }))]
    })
    render(<HistoryModal />)
    const dialog = screen.getByRole('dialog', { name: /^Сканування / })
    expect(within(dialog).getByRole('heading', { name: 'Зникли: 1' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent(GLOSSARY.listingRemoved.short)
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Закрити' }))
    })
    expect(useStore.getState().historyScan).toBeNull()
  })

  it('explains this scan against the one before it (not "the two latest")', () => {
    useStore.setState({ historyScan: mkScan({ id: 4, removed: 1 }), historyChanges: [mkChange(1, 'removed', mkListing(1))] })
    render(<HistoryModal />)
    const tip = screen.getByRole('button', { name: 'Що таке «Зміни сканування»?' })
    expect(tip).toHaveAccessibleDescription(GLOSSARY['shop.scanChanges'].short)
  })

  it('a scan without changes says so', () => {
    useStore.setState({ historyScan: mkScan({ id: 4 }), historyChanges: [] })
    render(<HistoryModal />)
    expect(screen.getByText('Змін не було.')).toBeInTheDocument()
  })
})

describe('ShopView: every picture opens full size in the image viewer', () => {
  const showWithViewer = (over: Parameters<typeof useStore.setState>[0]) => {
    useStore.setState({ keyStatus: withKey, activeShopId: 1, ...(over as object) })
    return render(
      <>
        <ShopView />
        <ImageViewer />
      </>
    )
  }
  const viewerImg = () => screen.getByRole('dialog', { name: 'Перегляд зображення' }).querySelector('img')!

  it('the header shop logo opens the icon URL; without a logo there is nothing to open', async () => {
    const icon = 'https://i.etsystatic.com/isla/abc/iusa_fullxfull.1.jpg'
    const { unmount } = showWithViewer({ shops: [mkShop({ iconUrl: icon, lastOkScan: mkScan() })], listings: [] })
    const btn = screen.getByRole('button', { name: 'Відкрити логотип магазину CeramicStudioUA на весь розмір' })
    expect(btn.querySelector('img')).toHaveAttribute('src', icon)
    await act(async () => fireEvent.click(btn))
    expect(useStore.getState().viewer?.images[0].src).toBe(icon)
    expect(useStore.getState().viewer?.images[0].ref).toBe('etsy-tracker://store/1/logo')
    expect(viewerImg()).toHaveAttribute('src', icon)
    unmount()
    act(() => useStore.getState().closeImage())
    showWithViewer({ shops: [mkShop({ iconUrl: null, lastOkScan: mkScan() })], listings: [] })
    expect(screen.queryByRole('button', { name: /логотип магазину/ })).toBeNull()
  })

  it('new reviews: the buyer photo opens full; the listing thumbnail opens its photo, not the listing', async () => {
    showWithViewer({
      shops: [mkShop({ lastOkScan: mkScan() })],
      newReviews: [mkReview(1, { listingId: 3, listingTitle: 'Blue mug', listingImageId: 10, hasImage: true })]
    })
    const group = screen.getByTestId('new-reviews')
    await act(async () => fireEvent.click(within(group).getByRole('button', { name: /Відкрити на весь розмір: Фото покупця/ })))
    expect(viewerImg()).toHaveAttribute('src', 'etsyimg://review/1/fullxfull')
    expect(useStore.getState().viewer?.images[0].ref).toBe('etsy-tracker://review/1/photo')
    act(() => useStore.getState().closeImage())
    const zoom = within(group).getByRole('button', { name: 'Відкрити фото на весь розмір: Blue mug' })
    expect(within(group).getByTitle('Blue mug').contains(zoom)).toBe(false)
    await act(async () => fireEvent.click(zoom))
    expect(api.getListing).not.toHaveBeenCalled()
    expect(useStore.getState().detailListing).toBeNull()
    expect(viewerImg()).toHaveAttribute('src', 'etsyimg://img/10/fullxfull')
    expect(useStore.getState().viewer?.images[0].ref).toBe('etsy-tracker://product/3/photo/10')
  })

  it('a promotion row: the thumbnail magnifier opens the photo, the row still opens the listing', async () => {
    const l = mkListing(5, { title: 'Sale mug' })
    api.getListing.mockResolvedValue(l)
    showWithViewer({
      shops: [mkShop({ lastOkScan: mkScan({ promotionsStarted: 1 }) })],
      listings: [l],
      scanPromotions: { started: [mkPromotion(1, { listingId: 5, listingTitle: 'Sale mug', listingImageId: 50 })], ended: [] }
    })
    const started = within(screen.getByTestId('promotions-started'))
    await act(async () => fireEvent.click(started.getByRole('button', { name: 'Відкрити фото на весь розмір: Sale mug' })))
    expect(viewerImg()).toHaveAttribute('src', 'etsyimg://img/50/fullxfull')
    expect(useStore.getState().viewer?.images[0].ref).toBe('etsy-tracker://product/5/photo/50')
    expect(api.getListing).not.toHaveBeenCalled()
    act(() => useStore.getState().closeImage())
    await act(async () => fireEvent.click(started.getByRole('button', { name: 'Sale mug' })))
    expect(api.getListing).toHaveBeenCalledWith(5)
    expect(useStore.getState().viewer).toBeNull()
  })

  it('a changed row: the thumbnail magnifier opens the listing photos as a gallery; the row still opens the listing', async () => {
    const img = (id: number, rank: number) => ({ ...mkListing(1).images[0], id, rank })
    const changed = mkListing(7, { title: 'Edited mug', images: [img(71, 1), img(72, 2)] })
    showWithViewer({
      shops: [mkShop({ lastOkScan: mkScan({ changed: 1 }) })],
      listings: [changed],
      lastChanges: [mkChange(1, 'changed', changed, { oldValue: { title: 'Old' }, newValue: { title: 'Edited mug' } })]
    })
    const zoom = screen.getAllByRole('button', { name: 'Відкрити фото на весь розмір: Edited mug' }).find((b) => b.classList.contains('change-zoom'))!
    const row = zoom.parentElement!.querySelector('.change-row') as HTMLElement
    expect(row.contains(zoom)).toBe(false)
    await act(async () => fireEvent.click(zoom))
    expect(useStore.getState().detailListing).toBeNull()
    expect(useStore.getState().viewer?.images.map((i) => i.src)).toEqual(['etsyimg://img/71/fullxfull', 'etsyimg://img/72/fullxfull'])
    expect(useStore.getState().viewer?.images.map((i) => i.ref)).toEqual(['etsy-tracker://product/7/photo/71', 'etsy-tracker://product/7/photo/72'])
    expect(viewerImg()).toHaveAttribute('src', 'etsyimg://img/71/fullxfull')
    act(() => useStore.getState().closeImage())
    await act(async () => fireEvent.click(row))
    expect(useStore.getState().detailListing?.listingId).toBe(7)
    expect(useStore.getState().viewer).toBeNull()
  })

  it('a new listing card in the results and the grid: the magnifier opens the photo, not the listing', async () => {
    const fresh = mkListing(3, { title: 'Brand new mug' })
    showWithViewer({
      shops: [mkShop({ lastOkScan: mkScan({ added: 1 }), newCount: 1 })],
      listings: [fresh],
      lastChanges: [mkChange(1, 'added', fresh)]
    })
    const zooms = screen.getAllByRole('button', { name: /^Відкрити фото на весь розмір: / })
    expect(zooms.length).toBeGreaterThanOrEqual(2) // the results card + the grid card
    await act(async () => fireEvent.click(zooms[0]))
    expect(useStore.getState().detailListing).toBeNull()
    expect(viewerImg()).toHaveAttribute('src', 'etsyimg://img/30/fullxfull')
  })
})
