// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { InventorySection, PricesTab, VariationImagesSection, ui } from '../../../src/renderer/src/features/inventory'
import type {
  InventoryOverviewPage,
  InventoryOverviewRow,
  InvProduct,
  ListingInventory,
  VariationImagesData
} from '../../../src/shared/features/inventory'
import { mkMyListing, mockFeature, setupRenderer, type Api } from '../helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
})

const usd = (amount: number) => ({ amount, divisor: 100, currency: 'USD' })

const product = (id: number, size: string, valueId: number, price: number, quantity = 5): InvProduct => ({
  productId: id,
  sku: `SKU-${size}`,
  propertyValues: [{ propertyId: 513, propertyName: 'Size', scaleId: null, scaleName: null, valueIds: [valueId], values: [size] }],
  offerings: [{ offeringId: id * 10, price: usd(price), quantity, isEnabled: true, readinessStateId: 77 }]
})

const SIZED: ListingInventory = {
  listingId: 1001,
  products: [product(1, 'S', 901, 1000), product(2, 'M', 902, 1200), product(3, 'L', 903, 1400)],
  priceOnProperty: [513],
  quantityOnProperty: [],
  skuOnProperty: [513],
  readinessStateOnProperty: []
}

const SIMPLE: ListingInventory = {
  listingId: 1002,
  products: [{ productId: 11, sku: '', propertyValues: [], offerings: [{ offeringId: 111, price: usd(500), quantity: 3, isEnabled: true, readinessStateId: null }] }],
  priceOnProperty: [],
  quantityOnProperty: [],
  skuOnProperty: [],
  readinessStateOnProperty: []
}

const featureCalls = (action: string) => api.featureCall.mock.calls.filter((c) => c[0] === 'inventory' && c[1] === action)

/** Answer the in-app confirmation (ConfirmModal). */
async function confirm(ok: boolean) {
  const modal = screen.getByRole('heading', { name: 'Підтвердження' }).closest('.modal') as HTMLElement
  await act(async () => {
    fireEvent.click(within(modal).getByRole('button', { name: ok ? 'Підтвердити' : 'Скасувати' }))
  })
}

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el)
  })
}

describe('ui registration', () => {
  it('a "Мій магазин" tab and two own-listing sections', () => {
    expect(ui.myShopTabs!.map((t) => t.label)).toEqual(['Ціни й залишки'])
    expect(ui.ownListingSections!.map((s) => s.label)).toEqual(['Ціна, кількість і варіації', 'Фото варіацій'])
  })
})

describe('Ціна, кількість і варіації', () => {
  async function renderSection(listingId = 1001, onChanged = vi.fn()) {
    render(
      <>
        <InventorySection listing={mkMyListing(listingId)} onChanged={onChanged} />
        <ConfirmModal />
      </>
    )
    expect(screen.getByText('Завантаження…')).toBeInTheDocument()
    await act(async () => {})
    return onChanged
  }

  it('loads the inventory: a row per variant with its values, SKU, price, quantity, shown', async () => {
    mockFeature({ 'inventory.get': SIZED })
    await renderSection()
    expect(api.featureCall).toHaveBeenCalledWith('inventory', 'get', { listingId: 1001 })
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Ціна, USD' })).toBeInTheDocument()
    expect(within(table).getByText('M')).toBeInTheDocument()
    expect(screen.getByLabelText('Ціна: M')).toHaveValue('12')
    expect(screen.getByLabelText('SKU: L')).toHaveValue('SKU-L')
    expect(screen.getByLabelText('Кількість: S')).toHaveValue('5')
    expect(screen.getByLabelText('Показувати: S')).toBeChecked()
    expect(screen.getAllByRole('checkbox', { name: 'Size' }).map((c) => (c as HTMLInputElement).checked)).toEqual([true, false, true])
    expect(screen.getByRole('button', { name: 'Зберегти на Etsy' })).toBeDisabled()
  })

  it('a price that varies by size changes one row; a quantity that does not changes every row; saved after confirming', async () => {
    const saved: ListingInventory = { ...SIZED, products: [product(21, 'S', 901, 900, 9), product(22, 'M', 902, 1300, 9), product(23, 'L', 903, 1400, 9)] }
    mockFeature({ 'inventory.get': SIZED, 'inventory.update': saved })
    const onChanged = await renderSection()
    fireEvent.change(screen.getByLabelText('Ціна: M'), { target: { value: '13' } })
    expect(screen.getByLabelText('Ціна: S')).toHaveValue('10')
    fireEvent.change(screen.getByLabelText('Кількість: S'), { target: { value: '9' } })
    expect(screen.getByLabelText('Кількість: L')).toHaveValue('9')
    fireEvent.click(screen.getByLabelText('Показувати: L'))
    await click(screen.getByRole('button', { name: 'Зберегти на Etsy' }))
    expect(screen.getByText(/Зберегти ціни, кількість і SKU \(3 варіанти\) на Etsy\?/)).toBeInTheDocument()
    await confirm(true)
    const [[, , args]] = featureCalls('update')
    expect(args).toEqual({
      listingId: 1001,
      inventory: {
        products: [
          { sku: 'SKU-S', price: 10, enabled: true },
          { sku: 'SKU-M', price: 13, enabled: true },
          { sku: 'SKU-L', price: 14, enabled: false }
        ].map((r, i) => ({
          sku: r.sku,
          propertyValues: [{ propertyId: 513, propertyName: 'Size', scaleId: null, valueIds: [901 + i], values: [['S', 'M', 'L'][i]] }],
          offerings: [{ price: r.price, quantity: 9, isEnabled: r.enabled, readinessStateId: 77 }]
        })),
        priceOnProperty: [513],
        quantityOnProperty: [],
        skuOnProperty: [513],
        readinessStateOnProperty: []
      }
    })
    expect(screen.getByText('Збережено на Etsy.')).toBeInTheDocument()
    expect(screen.getByLabelText('Ціна: S')).toHaveValue('9')
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ listingId: 1001, priceAmount: 900, priceDivisor: 100, quantity: 27 }))
  })

  it('cancelling the confirmation sends nothing; "Скасувати зміни" restores the values', async () => {
    mockFeature({ 'inventory.get': SIZED })
    await renderSection()
    fireEvent.change(screen.getByLabelText('Ціна: M'), { target: { value: '13' } })
    await click(screen.getByRole('button', { name: 'Зберегти на Etsy' }))
    await confirm(false)
    expect(featureCalls('update')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати зміни' }))
    expect(screen.getByLabelText('Ціна: M')).toHaveValue('12')
  })

  it('invalid values are listed and block saving', async () => {
    mockFeature({ 'inventory.get': SIZED })
    await renderSection()
    fireEvent.change(screen.getByLabelText('Ціна: M'), { target: { value: 'abc' } })
    fireEvent.change(screen.getByLabelText('Кількість: S'), { target: { value: '1000' } })
    const problems = screen.getByTestId('inventory-problems')
    expect(problems).toHaveTextContent('Варіант «M»: ціна — додатне число')
    expect(problems).toHaveTextContent('кількість — ціле число від 0 до 999')
    expect(screen.getByRole('button', { name: 'Зберегти на Etsy' })).toBeDisabled()
  })

  it('price no longer varying by size: prices must match — editing one row then sets them all', async () => {
    mockFeature({ 'inventory.get': SIZED })
    await renderSection()
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Size' })[0])
    expect(screen.getByTestId('inventory-problems')).toHaveTextContent('Ціна: значення мають збігатися в усіх варіантах')
    fireEvent.change(screen.getByLabelText('Ціна: L'), { target: { value: '11' } })
    expect(screen.getByLabelText('Ціна: S')).toHaveValue('11')
    expect(screen.queryByTestId('inventory-problems')).toBeNull()
    expect(screen.getByRole('button', { name: 'Зберегти на Etsy' })).toBeEnabled()
  })

  it('a listing without variations: one row, no "залежить від"', async () => {
    mockFeature({ 'inventory.get': SIMPLE })
    await renderSection(1002)
    expect(screen.getByLabelText('Ціна')).toHaveValue('5')
    expect(screen.queryByText(/залежить від/)).toBeNull()
    expect(screen.getAllByRole('row')).toHaveLength(2)
  })

  it('a load error is shown', async () => {
    mockFeature({ 'inventory.get': { ok: false, error: 'Увійдіть в Etsy' } })
    await renderSection()
    expect(screen.getByRole('alert')).toHaveTextContent('Увійдіть в Etsy')
  })

  it('a refused save shows Etsy’s reason and keeps the edits', async () => {
    mockFeature({ 'inventory.get': SIZED, 'inventory.update': { ok: false, error: 'Etsy відхилив запит як некоректний (HTTP 400).' } })
    await renderSection()
    fireEvent.change(screen.getByLabelText('Ціна: M'), { target: { value: '13' } })
    await click(screen.getByRole('button', { name: 'Зберегти на Etsy' }))
    await confirm(true)
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 400')
    expect(screen.getByLabelText('Ціна: M')).toHaveValue('13')
  })
})

const VARIATIONS: VariationImagesData = {
  listingId: 1001,
  properties: [{ propertyId: 513, name: 'Size', values: [{ valueId: 901, value: 'S' }, { valueId: 902, value: 'M' }] }],
  photos: [
    { imageId: 5001, url: 'https://i.etsystatic.com/1/a.jpg', rank: 1, alt: null },
    { imageId: 5002, url: 'https://i.etsystatic.com/1/b.jpg', rank: 2, alt: null },
    { imageId: 5003, url: null, rank: 3, alt: null }
  ],
  assigned: [{ propertyId: 513, valueId: 901, value: 'S', imageId: 5002 }]
}

describe('Фото варіацій', () => {
  async function renderSection() {
    render(
      <>
        <VariationImagesSection listing={mkMyListing(1001)} />
        <ConfirmModal />
      </>
    )
    expect(screen.getByText('Завантаження…')).toBeInTheDocument()
    await act(async () => {})
  }

  it('shows the linked photo per value; picking and saving sends every link after confirming', async () => {
    mockFeature({
      'inventory.variationImages': VARIATIONS,
      'inventory.saveVariationImages': (a: { items: Array<{ propertyId: number; valueId: number; imageId: number }> }) =>
        a.items.map((x) => ({ ...x, value: x.valueId === 901 ? 'S' : 'M' }))
    })
    await renderSection()
    expect(api.featureCall).toHaveBeenCalledWith('inventory', 'variationImages', { listingId: 1001 })
    expect(screen.getByRole('button', { name: '«S»: фото 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '«M»: без фото' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '«M»: фото 3' })).toHaveTextContent('3')
    const save = screen.getByRole('button', { name: 'Зберегти фото варіацій' })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '«M»: фото 1' }))
    await click(save)
    expect(screen.getByText(/замінить усі прив’язки фото/)).toBeInTheDocument()
    await confirm(true)
    expect(featureCalls('saveVariationImages')[0][2]).toEqual({
      listingId: 1001,
      items: [
        { propertyId: 513, valueId: 901, imageId: 5002 },
        { propertyId: 513, valueId: 902, imageId: 5001 }
      ]
    })
    expect(screen.getByText('Фото варіацій збережено на Etsy.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Зберегти фото варіацій' })).toBeDisabled()
  })

  it('cancel sends nothing; a refused save is shown', async () => {
    mockFeature({ 'inventory.variationImages': VARIATIONS, 'inventory.saveVariationImages': { ok: false, error: 'Etsy не дозволив цю дію (HTTP 403)' } })
    await renderSection()
    fireEvent.click(screen.getByRole('button', { name: '«S»: без фото' }))
    await click(screen.getByRole('button', { name: 'Зберегти фото варіацій' }))
    await confirm(false)
    expect(featureCalls('saveVariationImages')).toHaveLength(0)
    await click(screen.getByRole('button', { name: 'Зберегти фото варіацій' }))
    await confirm(true)
    expect(featureCalls('saveVariationImages')[0][2]).toEqual({ listingId: 1001, items: [] })
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 403')
  })

  it('two properties: choosing the other one starts from its own links', async () => {
    mockFeature({
      'inventory.variationImages': {
        ...VARIATIONS,
        properties: [...VARIATIONS.properties, { propertyId: 200, name: 'Color', values: [{ valueId: 1, value: 'Red' }] }]
      }
    })
    await renderSection()
    expect(screen.getByRole('radio', { name: 'Size' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Color' }))
    expect(screen.getByRole('button', { name: '«Red»: без фото' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('S')).toBeNull()
    expect(screen.getByRole('button', { name: 'Зберегти фото варіацій' })).toBeEnabled()
  })

  it('no variations', async () => {
    mockFeature({ 'inventory.variationImages': { ...VARIATIONS, properties: [] } })
    await renderSection()
    expect(screen.getByText('У цього лістингу немає варіацій.')).toBeInTheDocument()
  })

  it('no photos', async () => {
    mockFeature({ 'inventory.variationImages': { ...VARIATIONS, photos: [] } })
    await renderSection()
    expect(screen.getByText('У цього лістингу немає фото.')).toBeInTheDocument()
  })

  it('a load error', async () => {
    mockFeature({ 'inventory.variationImages': { ok: false, error: 'Немає з’єднання з Etsy.' } })
    await renderSection()
    expect(screen.getByRole('alert')).toHaveTextContent('Немає з’єднання з Etsy.')
  })
})

const row = (over: Partial<InventoryOverviewRow>): InventoryOverviewRow => ({
  listingId: 1001,
  title: 'Sized planner',
  state: 'active',
  imageUrl: 'https://i.etsystatic.com/1/s.jpg',
  priceMin: usd(1000),
  priceMax: usd(1400),
  totalQuantity: 15,
  productCount: 3,
  enabledCount: 3,
  single: null,
  hasInventory: true,
  ...over
})

const PAGE: InventoryOverviewPage = {
  total: 3,
  offset: 0,
  rows: [
    row({}),
    row({
      listingId: 1002,
      title: 'Simple planner',
      imageUrl: null,
      priceMin: usd(500),
      priceMax: usd(500),
      totalQuantity: 3,
      productCount: 1,
      enabledCount: 1,
      single: { productId: 11, offeringId: 111, sku: '', price: usd(500), quantity: 3, isEnabled: true }
    })
  ]
}

describe('Мій магазин → Ціни й залишки', () => {
  async function renderTab() {
    render(
      <>
        <PricesTab />
        <ConfirmModal />
      </>
    )
    expect(screen.getByText('Завантаження…')).toBeInTheDocument()
    await act(async () => {})
  }

  it('lists the active listings with price range, total quantity and variants', async () => {
    mockFeature({ 'inventory.overview': PAGE })
    await renderTab()
    expect(api.featureCall).toHaveBeenCalledWith('inventory', 'overview', { offset: 0 })
    const sized = screen.getByTestId('prices-row-1001')
    expect(sized).toHaveTextContent(/10,00\sUSD – 14,00\sUSD/)
    expect(sized).toHaveTextContent('15')
    expect(within(sized).queryByRole('button')).toBeNull()
    const simple = screen.getByTestId('prices-row-1002')
    expect(simple).toHaveTextContent(/5,00\sUSD/)
    expect(simple).not.toHaveTextContent('–')
    expect(within(simple).getByRole('button', { name: 'Змінити ціну й кількість: Simple planner' })).toBeInTheDocument()
  })

  it('quick edit of a listing without variations: confirm, save, the row updates', async () => {
    const saved: ListingInventory = {
      ...SIMPLE,
      products: [{ ...SIMPLE.products[0], productId: 12, offerings: [{ offeringId: 112, price: usd(750), quantity: 4, isEnabled: true, readinessStateId: null }] }]
    }
    mockFeature({ 'inventory.overview': PAGE, 'inventory.quickUpdate': saved })
    await renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Змінити ціну й кількість: Simple planner' }))
    const edit = screen.getByTestId('quick-edit-1002')
    expect(within(edit).getByLabelText('Ціна, USD')).toHaveValue('5')
    fireEvent.change(within(edit).getByLabelText('Ціна, USD'), { target: { value: '7,5' } })
    fireEvent.change(within(edit).getByLabelText('Кількість'), { target: { value: '4' } })
    await click(within(edit).getByRole('button', { name: 'Зберегти' }))
    expect(screen.getByText(/Змінити «Simple planner» на Etsy\?/)).toHaveTextContent(/Ціна: 7,50\sUSD, кількість: 4/)
    await confirm(true)
    expect(featureCalls('quickUpdate')[0][2]).toEqual({ listingId: 1002, price: 7.5, quantity: 4 })
    expect(screen.queryByTestId('quick-edit-1002')).toBeNull()
    expect(screen.getByTestId('prices-row-1002')).toHaveTextContent(/7,50\sUSD/)
    expect(screen.getByText('Збережено на Etsy: «Simple planner».')).toBeInTheDocument()
  })

  it('quick edit: invalid values disable saving; cancel; a refused save; cancelling the confirm', async () => {
    mockFeature({ 'inventory.overview': PAGE, 'inventory.quickUpdate': { ok: false, error: 'Etsy відхилив запит' } })
    await renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Змінити ціну й кількість: Simple planner' }))
    const edit = screen.getByTestId('quick-edit-1002')
    fireEvent.change(within(edit).getByLabelText('Ціна, USD'), { target: { value: '0' } })
    fireEvent.change(within(edit).getByLabelText('Кількість'), { target: { value: '1000' } })
    expect(edit).toHaveTextContent('Ціна — додатне число')
    expect(edit).toHaveTextContent('Кількість — ціле число від 0 до 999.')
    expect(within(edit).getByRole('button', { name: 'Зберегти' })).toBeDisabled()
    fireEvent.change(within(edit).getByLabelText('Ціна, USD'), { target: { value: '6' } })
    fireEvent.change(within(edit).getByLabelText('Кількість'), { target: { value: '2' } })
    await click(within(edit).getByRole('button', { name: 'Зберегти' }))
    await confirm(false)
    expect(featureCalls('quickUpdate')).toHaveLength(0)
    await click(within(edit).getByRole('button', { name: 'Зберегти' }))
    await confirm(true)
    expect(screen.getByRole('alert')).toHaveTextContent('Etsy відхилив запит')
    fireEvent.click(within(edit).getByRole('button', { name: 'Скасувати' }))
    expect(screen.queryByTestId('quick-edit-1002')).toBeNull()
  })

  it('"Показати ще" loads the next page from the current count', async () => {
    mockFeature({
      'inventory.overview': (a: { offset: number }) =>
        a.offset === 0 ? PAGE : { total: 3, offset: 2, rows: [row({ listingId: 1003, title: 'Third', hasInventory: false, productCount: 0 })] }
    })
    await renderTab()
    await click(screen.getByRole('button', { name: 'Показати ще (1)' }))
    expect(api.featureCall).toHaveBeenLastCalledWith('inventory', 'overview', { offset: 2 })
    expect(screen.getByTestId('prices-row-1003')).toHaveTextContent('Third')
    expect(screen.queryByRole('button', { name: /Показати ще/ })).toBeNull()
  })

  it('"Показати ще" and a quick-edit save finishing in either order keep both results', async () => {
    const saved: ListingInventory = {
      ...SIMPLE,
      products: [{ ...SIMPLE.products[0], offerings: [{ offeringId: 111, price: usd(750), quantity: 4, isEnabled: true, readinessStateId: null }] }]
    }
    const third: InventoryOverviewPage = { total: 3, offset: 2, rows: [row({ listingId: 1003, title: 'Third', hasInventory: false, productCount: 0 })] }
    for (const first of ['save', 'more'] as const) {
      const pending: Record<string, (v: unknown) => void> = {}
      const later = (key: string, v: unknown) => () => new Promise((res) => (pending[key] = () => res(v)))
      mockFeature({
        'inventory.overview': (a: { offset: number }) => (a.offset === 0 ? PAGE : later('more', third)()),
        'inventory.quickUpdate': later('save', saved)
      })
      const view = render(
        <>
          <PricesTab />
          <ConfirmModal />
        </>
      )
      await act(async () => {})
      await click(screen.getByRole('button', { name: 'Показати ще (1)' }))
      fireEvent.click(screen.getByRole('button', { name: 'Змінити ціну й кількість: Simple planner' }))
      const edit = screen.getByTestId('quick-edit-1002')
      fireEvent.change(within(edit).getByLabelText('Ціна, USD'), { target: { value: '7,5' } })
      fireEvent.change(within(edit).getByLabelText('Кількість'), { target: { value: '4' } })
      await click(within(edit).getByRole('button', { name: 'Зберегти' }))
      await confirm(true)
      const second = first === 'save' ? 'more' : 'save'
      await act(async () => pending[first](undefined))
      await act(async () => pending[second](undefined))
      expect(screen.getByTestId('prices-row-1003')).toHaveTextContent('Third')
      expect(screen.getByTestId('prices-row-1002')).toHaveTextContent(/7,50\sUSD/)
      view.unmount()
    }
  })

  it('no active listings', async () => {
    mockFeature({ 'inventory.overview': { total: 0, offset: 0, rows: [] } })
    await renderTab()
    expect(screen.getByText('Активних лістингів немає.')).toBeInTheDocument()
  })

  it('a load error is shown', async () => {
    mockFeature({ 'inventory.overview': { ok: false, error: 'Для цього потрібен дозвіл: читання лістингів.' } })
    await renderTab()
    expect(screen.getByRole('alert')).toHaveTextContent('читання лістингів')
  })
})
