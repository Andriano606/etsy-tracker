// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { CategoryProperties, MarketSearch, ui } from '../../../src/renderer/src/features/market'
import type { MarketListing, MarketSearchResult } from '../../../src/shared/features/market'
import { formatPrice as fmt } from '../../../src/shared/format'
import { GLOSSARY } from '../../../src/shared/glossary'
import { useStore } from '../../../src/renderer/src/store'
import { ImageViewer } from '../../../src/renderer/src/ui'
import { mkShop, mockFeature, setupRenderer, type Api } from '../helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
})
afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

const mk = (id: number, over: Partial<MarketListing> = {}): MarketListing => ({
  listingId: id,
  shopId: 7000 + id,
  title: `Planner ${id}`,
  priceAmount: 1000 * id,
  priceDivisor: 100,
  currency: 'USD',
  url: `https://www.etsy.com/listing/${id}/x`,
  tags: [],
  numFavorers: 1200 + id,
  views: 30 + id,
  createdAt: 1_700_000_000,
  imageUrl: `https://i.etsystatic.com/1/il_570xN.${id}.jpg`,
  imageFullUrl: `https://i.etsystatic.com/1/il_fullxfull.${id}.jpg`,
  ...over
})

const page = (listings: MarketListing[], over: Partial<MarketSearchResult> = {}): MarketSearchResult => ({
  count: listings.length,
  offset: 0,
  limit: 24,
  sorted: true,
  listings,
  imagesError: null,
  ...over
})

const CATS = {
  total: 2,
  categories: [
    { id: 111, name: 'Mugs', level: 2, parentId: 11, path: 'Home & Living › Kitchen › Mugs' },
    { id: 112, name: 'Mug rugs', level: 2, parentId: 11, path: 'Home & Living › Kitchen › Mug rugs' }
  ]
}

const PROPS = [
  {
    propertyId: 200,
    name: 'primary_color',
    displayName: 'Primary color',
    isRequired: true,
    supportsAttributes: true,
    supportsVariations: true,
    isMultivalued: true,
    maxValuesAllowed: 2,
    scales: [{ scaleId: 5, name: 'Inches', description: null }],
    possibleValues: [
      { valueId: 1, name: 'Red', scaleId: null },
      { valueId: 2, name: 'Blue', scaleId: null }
    ]
  },
  {
    propertyId: 201,
    name: 'occasion',
    displayName: 'Occasion',
    isRequired: false,
    supportsAttributes: true,
    supportsVariations: false,
    isMultivalued: false,
    maxValuesAllowed: null,
    scales: [],
    possibleValues: []
  }
]

/** The formatted price with Intl's no-break spaces as plain ones (toHaveTextContent normalizes the element's). */
const formatPrice = (amount: number, divisor: number, currency: string) => fmt(amount, divisor, currency).replace(/\s/g, ' ')

const typeIn = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

async function search() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Шукати' }))
  })
}

describe('Пошук по всьому Etsy', () => {
  it('is a sidebar window', () => {
    expect(ui.topModals).toEqual([
      {
        id: 'market',
        button: '🔎 Пошук по Etsy',
        title: 'Пошук по всьому Etsy',
        description: expect.stringMatching(/^Товари всіх магазинів Etsy/),
        Component: MarketSearch
      }
    ])
  })

  it('before the first search: an explanation of what the window is for; the fields explain themselves', () => {
    render(<MarketSearch />)
    expect(screen.getByText('Шукайте серед усіх товарів Etsy')).toBeInTheDocument()
    expect(screen.queryByTestId('market-summary')).toBeNull()
    expect(screen.getByRole('button', { name: 'Що таке «Ключові слова»?' })).toHaveAccessibleDescription(GLOSSARY['features.market.keywords'].short)
    expect(screen.getByRole('button', { name: 'Що таке «Порядок результатів»?' })).toHaveAccessibleDescription(GLOSSARY['features.market.sort'].short)
    expect(screen.getByRole('button', { name: 'Що таке «Розташування магазину»?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Що таке «Категорія»?' })).toBeInTheDocument()
    expect(screen.getByLabelText('Категорія')).toHaveAccessibleDescription(/звужує пошук/)
  })

  it('"Очистити" empties the form (not the results); disabled while the form is empty', async () => {
    mockFeature({ 'market.search': page([mk(1)]) })
    render(<MarketSearch />)
    const clear = screen.getByRole('button', { name: 'Очистити' })
    expect(clear).toBeDisabled()
    typeIn('Ключові слова', 'mug')
    typeIn('Ціна до', '9')
    fireEvent.change(screen.getByLabelText('Сортування'), { target: { value: 'newest' } })
    await search()
    expect(clear).toBeEnabled()
    fireEvent.click(clear)
    expect(screen.getByLabelText('Ключові слова')).toHaveValue('')
    expect(screen.getByLabelText('Ціна до')).toHaveValue(null)
    expect(screen.getByLabelText('Сортування')).toHaveValue('relevance')
    expect(clear).toBeDisabled()
    expect(screen.getAllByTestId('market-result')).toHaveLength(1)
  })

  it('searches with the form, shows cards and the price summary', async () => {
    mockFeature({ 'market.search': page([mk(1), mk(2), mk(3, { currency: 'EUR', numFavorers: null, views: null, imageUrl: null })], { count: 12345 }) })
    render(<MarketSearch />)
    typeIn('Ключові слова', ' planner ')
    typeIn('Розташування магазину', 'Germany')
    typeIn('Ціна від', '5')
    typeIn('Ціна до', '50')
    fireEvent.change(screen.getByLabelText('Сортування'), { target: { value: 'price_low' } })
    expect(screen.getByRole('option', { name: 'Ціна: від низької' })).toBeInTheDocument()
    await search()
    expect(api.featureCall).toHaveBeenCalledWith('market', 'search', {
      keywords: 'planner',
      taxonomyId: null,
      minPrice: '5',
      maxPrice: '50',
      sort: 'price_low',
      shopLocation: 'Germany',
      limit: 24,
      offset: 0
    })
    const cards = screen.getAllByTestId('market-result')
    expect(cards).toHaveLength(3)
    expect(within(cards[0]).getByRole('heading', { name: 'Planner 1' })).toHaveAttribute('title', 'Planner 1')
    expect(cards[0]).toHaveTextContent(formatPrice(1000, 100, 'USD'))
    expect(within(cards[0]).getByText(/^В обраному/).parentElement).toHaveTextContent('В обраному: 1 201')
    expect(within(cards[0]).getByText(/^В обраному/).parentElement).toHaveAccessibleDescription(GLOSSARY.favorites.short)
    expect(within(cards[0]).getByText(/^Переглядів/).parentElement).toHaveTextContent('Переглядів: 31')
    expect(within(cards[0]).getByText(/^Переглядів/).parentElement).toHaveAccessibleDescription(GLOSSARY.views.short)
    expect(within(cards[0]).getByText('Магазин #7001')).toHaveAccessibleDescription(GLOSSARY['features.market.shopNumber'].short)
    expect(within(cards[0]).getByRole('button', { name: 'Що це за ціна?' })).toHaveAccessibleDescription(GLOSSARY.basePrice.short)
    expect(cards[0].querySelector('img')).toHaveAttribute('src', 'https://i.etsystatic.com/1/il_570xN.1.jpg')
    expect(cards[2]).toHaveTextContent('Без фото')
    expect(cards[2]).not.toHaveTextContent('В обраному')
    expect(cards[2]).not.toHaveTextContent('Переглядів')
    const summary = screen.getByTestId('market-summary')
    expect(within(summary).getByText('Знайдено на Etsy')).toHaveAccessibleDescription(GLOSSARY['features.market.found'].short)
    expect(summary.firstElementChild).toHaveTextContent(new RegExp(`Знайдено на Etsy.*: 12 345 · завантажено 3$`))
    const [usd, eur] = within(summary).getAllByText(/^(USD|EUR) \(/)
    expect(usd).toHaveTextContent(new RegExp(`^USD \\(2\\): від ${formatPrice(10, 1, 'USD')} · медіана.* ${formatPrice(15, 1, 'USD')} · до ${formatPrice(20, 1, 'USD')}$`))
    expect(within(usd).getByText('медіана')).toHaveAccessibleDescription(GLOSSARY['features.market.median'].short)
    expect(eur).toHaveTextContent(`EUR (1): від ${formatPrice(30, 1, 'EUR')}`)
    expect(screen.getByRole('button', { name: 'Показати ще' })).toBeInTheDocument()
    expect(screen.queryByText(/Etsy не сортує/)).toBeNull()
  })

  it('a price range alone: the hint says the sort needs a search option; an unsorted answer says so', async () => {
    mockFeature({ 'market.search': page([mk(1)], { sorted: false }) })
    render(<MarketSearch />)
    // What sorting needs and what the price range compares are explained by the fields' ⓘ.
    expect(screen.getByLabelText('Сортування').closest('.ui-field')!.querySelector('.ui-infotip')).toHaveAccessibleDescription(
      /Діє лише разом із ключовими словами, категорією чи розташуванням/
    )
    expect(screen.getByRole('button', { name: 'Що таке «Ціна від і до»?' })).toHaveAccessibleDescription(/у якій валюті їх порівнює/)
    expect(screen.getByText('Заповніть хоча б одне поле. Ціни в результатах — у валюті продавця, без перерахунку.')).toBeInTheDocument()
    typeIn('Ціна до', '20')
    await search()
    expect(api.featureCall).toHaveBeenCalledWith('market', 'search', expect.objectContaining({ keywords: null, maxPrice: '20', offset: 0 }))
    expect(screen.getByText('Без ключових слів, категорії чи розташування Etsy не сортує — спершу найновіші.')).toBeInTheDocument()
  })

  it('"Показати ще" loads the next page with the submitted query and appends it', async () => {
    mockFeature({
      'market.search': (a: Record<string, unknown>) =>
        a.offset === 0
          ? page([mk(1), mk(2)], { count: 30, limit: 24 })
          : page([mk(2), mk(3)], { count: 30, offset: 24, limit: 24 })
    })
    render(<MarketSearch />)
    typeIn('Ключові слова', 'mug')
    await search()
    typeIn('Ключові слова', 'changed but not submitted')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Показати ще' }))
    })
    expect(api.featureCall).toHaveBeenLastCalledWith('market', 'search', expect.objectContaining({ keywords: 'mug', offset: 24 }))
    expect(screen.getAllByTestId('market-result').map((c) => c.textContent)).toEqual([
      expect.stringContaining('Planner 1'),
      expect.stringContaining('Planner 2'),
      expect.stringContaining('Planner 3')
    ])
    expect(screen.getByTestId('market-summary')).toHaveTextContent('завантажено 3')
    expect(screen.getByRole('button', { name: 'Показати ще' })).toBeInTheDocument()
  })

  it('no "Показати ще" past the offset cap', async () => {
    mockFeature({ 'market.search': page([mk(1)], { count: 50_000, offset: 12000, limit: 24 }) })
    render(<MarketSearch />)
    typeIn('Ключові слова', 'mug')
    await search()
    expect(screen.queryByRole('button', { name: 'Показати ще' })).toBeNull()
  })

  it('an error is shown; empty results and a photo problem are said', async () => {
    mockFeature({ 'market.search': { ok: false, error: 'Вкажіть ключові слова, категорію або розташування магазину.' } })
    render(<MarketSearch />)
    await search()
    expect(screen.getByRole('alert')).toHaveTextContent('Вкажіть ключові слова')
    mockFeature({ 'market.search': page([], { imagesError: null }) })
    typeIn('Ключові слова', 'zzz')
    await search()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Нічого не знайдено.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Показати ще' })).toBeNull()
    mockFeature({ 'market.search': page([mk(1, { imageUrl: null })], { imagesError: 'Фото не завантажилися: HTTP 500' }) })
    await search()
    expect(screen.getByText('Фото не завантажилися: HTTP 500')).toBeInTheDocument()
  })

  it('category: search the paths, pick one (sent as taxonomyId), see its properties, change it', async () => {
    mockFeature({
      'market.categories': (a: Record<string, unknown>) => (a.query === 'mug' ? CATS : { total: 0, categories: [] }),
      'market.properties': PROPS,
      'market.search': page([mk(1)])
    })
    render(<MarketSearch />)
    await act(async () => {
      typeIn('Категорія', 'zz')
    })
    expect(screen.getByText('Нічого не знайдено.')).toBeInTheDocument()
    await act(async () => {
      typeIn('Категорія', 'mug')
    })
    expect(api.featureCall).toHaveBeenCalledWith('market', 'categories', { query: 'mug' })
    const list = screen.getByRole('listbox', { name: 'Категорії' })
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Home & Living › Kitchen › Mugs',
      'Home & Living › Kitchen › Mug rugs'
    ])
    fireEvent.click(within(list).getByRole('option', { name: 'Home & Living › Kitchen › Mugs' }))
    // The chosen category keeps the "Категорія" label.
    expect(screen.getByLabelText('Категорія')).toHaveValue('Home & Living › Kitchen › Mugs')
    expect(screen.getByLabelText('Категорія')).toHaveAttribute('readonly')
    expect(within(screen.getByTestId('market-category')).getByLabelText('Категорія')).toBeInTheDocument()

    const details = screen.getByTestId('market-category-properties') as HTMLDetailsElement
    expect(api.featureCall).not.toHaveBeenCalledWith('market', 'properties', expect.anything())
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(api.featureCall).toHaveBeenCalledWith('market', 'properties', { taxonomyId: 111 })
    const [color, occasion] = within(screen.getByTestId('market-properties')).getAllByTestId('market-property')
    expect(color).toHaveTextContent('Primary color')
    expect(within(color).getByText('обов’язкова')).toHaveAccessibleDescription(GLOSSARY['features.market.requiredProperty'].short)
    expect(within(color).getByText('кілька значень (до 2)')).toHaveAccessibleDescription(GLOSSARY['features.market.multivalued'].short)
    expect(within(color).getByText('шкали: Inches')).toHaveAccessibleDescription(GLOSSARY['features.market.scale'].short)
    expect(color).toHaveTextContent('Red, Blue')
    expect(occasion).toHaveTextContent('Occasion')
    expect(occasion).not.toHaveTextContent('обов’язкова')
    expect(occasion).toHaveTextContent('Довільне значення — продавець вписує своє.')

    await search()
    expect(api.featureCall).toHaveBeenLastCalledWith('market', 'search', expect.objectContaining({ taxonomyId: 111, keywords: null }))

    fireEvent.click(screen.getByRole('button', { name: 'Змінити категорію' }))
    expect(screen.queryByTestId('market-category')).toBeNull()
    expect(screen.queryByTestId('market-category-properties')).toBeNull()
    expect(screen.getByLabelText('Категорія')).toHaveValue('')
  })

  it('category search failing → alert; many matches → a "уточніть" note', async () => {
    mockFeature({ 'market.categories': { ok: false, error: 'Немає з’єднання з Etsy.' } })
    render(<MarketSearch />)
    await act(async () => {
      typeIn('Категорія', 'mug')
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Немає з’єднання з Etsy.')
    mockFeature({ 'market.categories': { ...CATS, total: 340 } })
    await act(async () => {
      typeIn('Категорія', 'mugs')
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Показано 2 з 340 — уточніть запит.')).toBeInTheDocument()
  })

  it('clearing the category query clears a previous error too', async () => {
    mockFeature({ 'market.categories': { ok: false, error: 'Немає з’єднання з Etsy.' } })
    render(<MarketSearch />)
    await act(async () => {
      typeIn('Категорія', 'mug')
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Немає з’єднання з Etsy.')
    await act(async () => {
      typeIn('Категорія', '')
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.featureCall).toHaveBeenCalledTimes(1)
  })

  it('category properties: loading, empty, error', async () => {
    let resolve: (v: unknown) => void = () => {}
    mockFeature({ 'market.properties': () => new Promise((r) => (resolve = r)) })
    const { unmount } = render(<CategoryProperties taxonomyId={5} />)
    expect(screen.getByText('Завантаження…')).toBeInTheDocument()
    await act(async () => resolve([]))
    expect(screen.getByText('У цієї категорії немає властивостей.')).toBeInTheDocument()
    unmount()
    mockFeature({ 'market.properties': { ok: false, error: 'Etsy не знайшов цей магазин або товар (HTTP 404).' } })
    render(<CategoryProperties taxonomyId={6} />)
    await act(async () => {})
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 404')
  })

  it('"Відкрити на Etsy" opens the listing; without a valid link the button is disabled', async () => {
    mockFeature({ 'market.search': page([mk(1), mk(2, { url: null })]) })
    render(<MarketSearch />)
    typeIn('Ключові слова', 'mug')
    await search()
    const [a, b] = screen.getAllByTestId('market-result')
    fireEvent.click(within(a).getByRole('button', { name: 'Відкрити на Etsy' }))
    expect(api.openExternal).toHaveBeenCalledWith('https://www.etsy.com/listing/1/x')
    expect(within(b).getByRole('button', { name: 'Відкрити на Etsy' })).toBeDisabled()
  })

  it('a result photo opens at full size in the viewer; nothing else happens', async () => {
    mockFeature({ 'market.search': page([mk(1), mk(2, { imageFullUrl: null }), mk(3, { imageUrl: null, imageFullUrl: null })]) })
    render(
      <>
        <MarketSearch />
        <ImageViewer />
      </>
    )
    typeIn('Ключові слова', 'mug')
    await search()
    const [a, b, c] = screen.getAllByTestId('market-result')
    expect(within(c).queryByRole('button', { name: /на весь розмір/ })).toBeNull()
    expect(c).toHaveTextContent('Без фото')
    await act(async () => {
      fireEvent.click(within(a).getByRole('button', { name: 'Відкрити на весь розмір: Planner 1' }))
    })
    const dialog = screen.getByRole('dialog', { name: 'Перегляд зображення' })
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'https://i.etsystatic.com/1/il_fullxfull.1.jpg')
    expect(dialog).toHaveTextContent('Planner 1')
    expect(api.openExternal).not.toHaveBeenCalled()
    expect(api.addShop).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(screen.queryByRole('dialog', { name: 'Перегляд зображення' })).toBeNull()
    // no full size from main → the 570xN it has
    await act(async () => {
      fireEvent.click(within(b).getByRole('button', { name: 'Відкрити на весь розмір: Planner 2' }))
    })
    expect(useStore.getState().viewer!.images[0].src).toBe('https://i.etsystatic.com/1/il_570xN.2.jpg')
  })

  it('"Стежити за магазином": shop name → addShop → the result is shown on that shop\'s cards', async () => {
    mockFeature({
      'market.search': page([mk(1), mk(2, { shopId: 7001 }), mk(3)]),
      'market.shopName': (a: Record<string, unknown>) => (a.shopId === 7001 ? 'FoxPrints' : { ok: false, error: 'Etsy не знайшов цей магазин або товар (HTTP 404).' })
    })
    api.addShop.mockResolvedValueOnce({ ok: false, error: 'Магазин «FoxPrints» уже додано.' })
    render(<MarketSearch />)
    typeIn('Ключові слова', 'mug')
    await search()
    const cards = screen.getAllByTestId('market-result')
    await act(async () => {
      fireEvent.click(within(cards[0]).getByRole('button', { name: 'Стежити за магазином' }))
    })
    expect(api.featureCall).toHaveBeenCalledWith('market', 'shopName', { shopId: 7001 })
    expect(api.addShop).toHaveBeenCalledWith('FoxPrints')
    expect(within(cards[0]).getByRole('alert')).toHaveTextContent('Магазин «FoxPrints» уже додано.')
    expect(within(cards[1]).getByRole('alert')).toHaveTextContent('уже додано')

    await act(async () => {
      fireEvent.click(within(cards[1]).getByRole('button', { name: 'Стежити за магазином' }))
    })
    expect(within(cards[0]).getByRole('status')).toHaveTextContent('Магазин «FoxPrints» додано — він у списку зліва.')

    await act(async () => {
      fireEvent.click(within(cards[2]).getByRole('button', { name: 'Стежити за магазином' }))
    })
    expect(api.addShop).toHaveBeenCalledTimes(2)
    expect(within(cards[2]).getByRole('alert')).toHaveTextContent('HTTP 404')
  })

  it('following two shops at once: each button stays disabled until its own follow finishes', async () => {
    const pending: Record<number, (v: unknown) => void> = {}
    mockFeature({
      'market.search': page([mk(1), mk(2)]),
      'market.shopName': (a: Record<string, unknown>) => new Promise((r) => (pending[a.shopId as number] = r))
    })
    render(<MarketSearch />)
    typeIn('Ключові слова', 'mug')
    await search()
    const [a, b] = screen.getAllByTestId('market-result')
    const follow = (card: HTMLElement) => within(card).getByRole('button', { name: 'Стежити за магазином' })
    await act(async () => {
      fireEvent.click(follow(a))
      fireEvent.click(follow(b))
    })
    expect(follow(a)).toBeDisabled()
    expect(follow(b)).toBeDisabled()
    await act(async () => pending[7001]('ShopA'))
    expect(api.addShop).toHaveBeenCalledWith('ShopA')
    expect(within(a).getByRole('status')).toHaveTextContent('Магазин «ShopA» додано')
    expect(follow(a)).toBeEnabled()
    expect(follow(b)).toBeDisabled()
    await act(async () => pending[7002]('ShopB'))
    expect(follow(b)).toBeEnabled()
    expect(within(b).getByRole('status')).toHaveTextContent('Магазин «ShopB» додано')
    expect(api.addShop).toHaveBeenCalledTimes(2)
  })

  it('shows "Завантаження…" while searching and disables the button', async () => {
    let resolve: (v: unknown) => void = () => {}
    mockFeature({ 'market.search': () => new Promise((r) => (resolve = r)) })
    render(<MarketSearch />)
    typeIn('Ключові слова', 'mug')
    await search()
    expect(screen.getByText('Завантаження…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Шукати' })).toBeDisabled()
    await act(async () => resolve(page([mk(1)])))
    expect(screen.queryByText('Завантаження…')).toBeNull()
    expect(screen.getAllByTestId('market-result')).toHaveLength(1)
  })

  it('a shop the user already tracks: its name, "ви стежите" and "Відкрити в програмі" instead of following it again', async () => {
    useStore.setState({ shops: [mkShop({ id: 7001, shopName: 'FoxPrints' })], featureModal: 'market' })
    mockFeature({ 'market.search': page([mk(1), mk(2)]) })
    render(<MarketSearch />)
    typeIn('Ключові слова', 'mug')
    await search()
    const [tracked, other] = screen.getAllByTestId('market-result')
    expect(tracked).toHaveTextContent('FoxPrints')
    expect(tracked).not.toHaveTextContent('Магазин #7001')
    expect(within(tracked).getByText('ви стежите')).toHaveAccessibleDescription(/уже у вашому списку зліва/)
    expect(within(tracked).queryByRole('button', { name: 'Стежити за магазином' })).toBeNull()
    expect(within(other).getByText('Магазин #7002')).toBeInTheDocument()
    expect(within(other).getByRole('button', { name: 'Стежити за магазином' })).toBeEnabled()
    await act(async () => {
      fireEvent.click(within(tracked).getByRole('button', { name: 'Відкрити в програмі' }))
    })
    expect(api.featureCall).not.toHaveBeenCalledWith('market', 'shopName', expect.anything())
    expect(api.addShop).not.toHaveBeenCalled()
    expect(useStore.getState().featureModal).toBeNull()
    expect(useStore.getState().activeShopId).toBe(7001)
  })

  it('the category input is a combobox: ↓/↑ walk the suggestions, Enter picks, Escape closes the list only', async () => {
    mockFeature({ 'market.categories': CATS, 'market.properties': [] })
    render(<MarketSearch />)
    const input = screen.getByRole('combobox', { name: 'Категорія' })
    expect(input).toHaveAttribute('aria-expanded', 'false')
    await act(async () => {
      typeIn('Категорія', 'mug')
    })
    expect(input).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('listbox', { name: 'Категорії' })
    expect(input).toHaveAttribute('aria-controls', list.id)
    const options = within(list).getAllByRole('option')
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'false'])
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id)
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id)
    // Escape closes the suggestions; the event is marked handled, so the window stays open.
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      input.dispatchEvent(esc)
    })
    expect(esc.defaultPrevented).toBe(true)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input).toHaveAttribute('aria-expanded', 'false')
    await act(async () => {
      typeIn('Категорія', 'mugs')
    })
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Категорія' }), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Категорія' }), { key: 'Enter' })
    expect(screen.getByLabelText('Категорія')).toHaveValue('Home & Living › Kitchen › Mug rugs')
    expect(screen.getByTestId('market-category-properties')).toHaveTextContent(GLOSSARY['features.market.categoryProperties'].short)
  })

  it('a failed search offers "Спробувати ще" (the same query again)', async () => {
    mockFeature({ 'market.search': { ok: false, error: 'Немає з’єднання з Etsy.' } })
    render(<MarketSearch />)
    typeIn('Ключові слова', 'mug')
    await search()
    expect(screen.getByRole('alert')).toHaveTextContent('Немає з’єднання з Etsy.')
    mockFeature({ 'market.search': page([mk(1)]) })
    typeIn('Ключові слова', 'changed but not submitted')
    await act(async () => {
      fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Спробувати ще' }))
    })
    expect(api.featureCall).toHaveBeenLastCalledWith('market', 'search', expect.objectContaining({ keywords: 'mug', offset: 0 }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getAllByTestId('market-result')).toHaveLength(1)
  })

  it('a failed "Показати ще" retries that page', async () => {
    mockFeature({ 'market.search': (a: Record<string, unknown>) => (a.offset === 0 ? page([mk(1)], { count: 30 }) : { ok: false, error: 'HTTP 500' }) })
    render(<MarketSearch />)
    typeIn('Ключові слова', 'mug')
    await search()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Показати ще' }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 500')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще' }))
    })
    expect(api.featureCall).toHaveBeenLastCalledWith('market', 'search', expect.objectContaining({ offset: 24 }))
    expect(screen.getAllByTestId('market-result')).toHaveLength(1)
  })

  it('a new search brings its results into view (the form fills a small window); "Показати ще" does not jump', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    mockFeature({ 'market.search': (a: Record<string, unknown>) => page([mk(a.offset === 0 ? 1 : 2)], { count: 30, offset: a.offset as number }) })
    render(<MarketSearch />)
    typeIn('Ключові слова', 'mug')
    await search()
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll.mock.instances[0]).toBe(screen.getByTestId('market-summary').parentElement)
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Показати ще' }))
    })
    expect(screen.getAllByTestId('market-result')).toHaveLength(2)
    expect(scroll).toHaveBeenCalledTimes(1)
  })

  it('category properties failing → "Спробувати ще" loads them again', async () => {
    mockFeature({ 'market.properties': { ok: false, error: 'HTTP 503' } })
    render(<CategoryProperties taxonomyId={6} />)
    await act(async () => {})
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 503')
    mockFeature({ 'market.properties': PROPS })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще' }))
    })
    expect(api.featureCall).toHaveBeenCalledTimes(2)
    expect(screen.getAllByTestId('market-property')).toHaveLength(2)
  })
})
