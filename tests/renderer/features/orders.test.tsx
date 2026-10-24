// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ui } from '../../../src/renderer/src/features/orders'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { useStore } from '../../../src/renderer/src/store'
import type { LedgerEntry, LedgerPage, ListingSales, Order, OrderItem, OrderPayment, SalesSummary } from '../../../src/shared/features/orders'
import { localDate, localDaySec } from '../../../src/shared/features/orders'
import { formatEtsyDate, formatPrice } from '../../../src/shared/format'
import { etsyIn, mkMyListing, mockFeature, setupRenderer, type Api } from '../helpers'
import { fakeLayout } from '../ui/measure'

let api: Api
beforeEach(() => {
  api = setupRenderer()
  useStore.setState({ etsyAuth: etsyIn() })
})

const T0 = 1_760_000_000
const usd = (amount: number) => ({ amount, divisor: 100, currency: 'USD' })
/** As the UI prints it, with Intl's non-breaking spaces as plain ones (jest-dom normalizes the element side only). */
const price = (amount: number, currency = 'USD') => formatPrice(amount, 100, currency).replace(/\s/g, ' ')

const mkItem = (id: number, over: Partial<OrderItem> = {}): OrderItem => ({
  transactionId: id,
  receiptId: 9001,
  listingId: 501,
  productId: 3,
  title: `Planner ${id}`,
  quantity: 2,
  price: usd(1000),
  shippingCost: usd(300),
  variations: [{ name: 'Колір', value: 'Синій' }],
  sku: 'SKU-1',
  isDigital: false,
  createdAt: T0 + id,
  paidAt: T0 + id,
  shippedAt: null,
  expectedShipDate: null,
  shippingMethod: 'Standard',
  shippingUpgrade: null,
  ...over
})

const mkOrder = (id: number, over: Partial<Order> = {}): Order => ({
  receiptId: id,
  status: 'paid',
  createdAt: T0,
  updatedAt: T0 + 100,
  isPaid: true,
  isShipped: false,
  isGift: true,
  giftMessage: 'Happy birthday!',
  giftSender: 'Ira',
  buyerName: 'Olena K',
  buyerEmail: 'buyer@example.com',
  address: {
    name: 'Olena K',
    firstLine: 'Main st 1',
    secondLine: null,
    city: 'Lviv',
    state: null,
    zip: '79000',
    countryIso: 'UA',
    formatted: 'Olena K\nMain st 1\n79000 Lviv\nUkraine'
  },
  paymentMethod: 'cc',
  messageFromBuyer: 'Please wrap it',
  messageFromSeller: null,
  messageFromPayment: null,
  totals: {
    grandTotal: usd(2600),
    subtotal: usd(1800),
    itemsTotal: usd(2000),
    shipping: usd(300),
    tax: usd(500),
    vat: usd(0),
    discount: usd(200),
    giftWrap: usd(0)
  },
  items: [mkItem(1), mkItem(2, { quantity: 1, variations: [] })],
  itemCount: 3,
  shipments: [],
  refunds: [],
  ...over
})

const mkPayment = (id: number): OrderPayment => ({
  paymentId: id,
  receiptId: 9001,
  status: 'settled',
  currency: 'USD',
  shopCurrency: 'USD',
  buyerCurrency: 'UAH',
  gross: usd(2600),
  fees: usd(110),
  net: usd(2490),
  postedGross: null,
  postedFees: null,
  postedNet: null,
  adjustedGross: null,
  adjustedFees: null,
  adjustedNet: usd(1990),
  createdAt: T0,
  updatedAt: T0,
  shippedAt: null,
  adjustments: [
    { id: 31, status: 'COMPLETED', isSuccess: true, reason: 'damaged', amount: usd(500), shopAmount: usd(500), buyerAmount: null, feeAmount: null, createdAt: T0, items: [] }
  ]
})

const tab = (id: string) => ui.myShopTabs!.find((t) => t.id === id)!.Component

async function renderTab(id: string) {
  const C = tab(id)
  const r = render(
    <>
      <C />
      <ConfirmModal />
    </>
  )
  await act(async () => {})
  return r
}

async function openDetails(testId: string) {
  const details = screen.getByTestId(testId) as HTMLDetailsElement
  await act(async () => {
    details.open = true
    details.dispatchEvent(new Event('toggle'))
  })
}

const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el)
  })
}

const cleanupAll = () => cleanup()
/** The open confirmation's confirm button — it says the verb of the change. */
const confirmDialog = (name: string) =>
  within(screen.getByText('Підтвердження').closest('[role="alertdialog"]') as HTMLElement).getByRole('button', { name })
/** The open confirmation's whole text. */
const confirmText = () => (screen.getByText('Підтвердження').closest('[role="alertdialog"], [role="dialog"], .modal') as HTMLElement).textContent ?? ''

/** The value shown next to `label` in a fact list or a number tile (whitespace normalized like price()). */
function valueOf(root: HTMLElement, label: string): string {
  const el = within(root).getAllByText(label, { selector: '.fx-fact-label, .ui-stat-label-text' })[0]
  const box = el.closest('.fx-fact, .ui-stat') as HTMLElement
  return (box.querySelector('dd, .ui-stat-value')?.textContent ?? '').replace(/\s/g, ' ')
}

/** A ledger amount as the UI prints it: a sign, a typographic minus. */
const signed = (amount: number) => (amount > 0 ? '+' : amount < 0 ? '−' : '') + price(Math.abs(amount))

describe('ui registration', () => {
  it('two "Мій магазин" tabs and the own-listing "Продажі" section', () => {
    expect(ui.myShopTabs!.map((t) => t.label)).toEqual(['Замовлення', 'Фінанси'])
    expect(ui.ownListingSections!.map((s) => s.label)).toEqual(['Продажі'])
  })
})

describe('Мій магазин → Замовлення', () => {
  it('loads the newest orders and lists date, buyer, items, total and status badges', async () => {
    mockFeature({ 'orders.list': { total: 2, offset: 0, orders: [mkOrder(9001), mkOrder(9002, { isPaid: false, status: 'open', isGift: false, buyerName: 'Petro' })] } })
    await renderTab('orders')
    expect(api.featureCall).toHaveBeenCalledWith('orders', 'list', { sortOn: 'created', sortOrder: 'desc', limit: 25, offset: 0 })
    const row = screen.getByTestId('order-row-9001')
    expect(row).toHaveTextContent('#9001Olena K')
    expect(row).toHaveTextContent(`${formatEtsyDate(T0)} · товарів: 3`)
    expect(row).toHaveTextContent(price(2600))
    // Status chips: words (with icons), not colour alone; the gift chip has no emoji.
    expect(row).toHaveTextContent(/оплачено\s*не відправлено\s*подарунок\s*Відкрити$/)
    // The row's button names its order (a screen reader's button list tells the rows apart).
    expect(within(row).getByRole('button', { name: 'Відкрити замовлення #9001' })).toBeInTheDocument()
    const row2 = screen.getByTestId('order-row-9002')
    expect(row2).toHaveTextContent('відкрите')
    expect(row2).toHaveTextContent('не оплачено')
    expect(screen.getByText('Знайдено замовлень: 2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Показати ще' })).toBeNull()
  })

  it('filters (paid, shipped, delivered, canceled, dates, order) go to orders.list', async () => {
    mockFeature({ 'orders.list': { total: 0, offset: 0, orders: [] } })
    await renderTab('orders')
    expect(screen.getByText('Замовлень немає.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Оплата'), { target: { value: 'yes' } })
    fireEvent.change(screen.getByLabelText('Відправка'), { target: { value: 'no' } })
    fireEvent.change(screen.getByLabelText('Доставка'), { target: { value: 'no' } })
    fireEvent.change(screen.getByLabelText('Скасовані'), { target: { value: 'no' } })
    fireEvent.change(screen.getByLabelText('Від дати'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('До дати'), { target: { value: '2026-10-15' } })
    fireEvent.change(screen.getByLabelText('Порядок'), { target: { value: 'updated' } })
    await click(screen.getByRole('button', { name: 'Показати' }))
    expect(api.featureCall).toHaveBeenLastCalledWith('orders', 'list', {
      sortOn: 'updated',
      sortOrder: 'desc',
      limit: 25,
      offset: 0,
      wasPaid: true,
      wasShipped: false,
      wasDelivered: false,
      wasCanceled: false,
      minCreated: localDaySec('2026-10-01'),
      maxCreated: localDaySec('2026-10-15', true)
    })
    // The same filters again: reloaded.
    const n = api.featureCall.mock.calls.length
    await click(screen.getByRole('button', { name: 'Показати' }))
    expect(api.featureCall.mock.calls.length).toBe(n + 1)
  })

  it('"Показати ще" loads the next page and appends it; a failure is shown', async () => {
    let fail = false
    mockFeature({
      'orders.list': (args: Record<string, unknown>) =>
        fail ? { ok: false, error: 'Перевищено ліміт' } : { total: 30, offset: args.offset, orders: [mkOrder(Number(args.offset) + 1)] }
    })
    await renderTab('orders')
    await click(screen.getByRole('button', { name: 'Показати ще' }))
    expect(api.featureCall).toHaveBeenLastCalledWith('orders', 'list', { sortOn: 'created', sortOrder: 'desc', limit: 25, offset: 1 })
    expect(screen.getByTestId('order-row-2')).toBeInTheDocument()
    fail = true
    await click(screen.getByRole('button', { name: 'Показати ще' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Перевищено ліміт')
  })

  it('a failing reload drops the previous rows: no stale list under new filters, no mixed "Показати ще"', async () => {
    let fail = false
    mockFeature({
      'orders.list': (args: Record<string, unknown>) =>
        fail ? { ok: false, error: 'Сервер Etsy повернув помилку (HTTP 500).' } : { total: 30, offset: args.offset, orders: [mkOrder(Number(args.offset) + 1)] }
    })
    await renderTab('orders')
    expect(screen.getByTestId('order-row-1')).toBeInTheDocument()
    fail = true
    fireEvent.change(screen.getByLabelText('Оплата'), { target: { value: 'yes' } })
    await click(screen.getByRole('button', { name: 'Показати' }))
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 500')
    expect(screen.queryByTestId('order-row-1')).toBeNull()
    expect(screen.queryByTestId('orders-list')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Показати ще' })).toBeNull()
    fail = false
    await click(screen.getByRole('button', { name: 'Показати' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('order-row-1')).toBeInTheDocument()
  })

  it('a "Показати ще" answer that arrives after new filters were applied is dropped', async () => {
    let release: (v: unknown) => void = () => {}
    mockFeature({
      'orders.list': (args: Record<string, unknown>) =>
        args.offset === 0
          ? { total: 30, offset: 0, orders: [mkOrder(args.wasPaid ? 500 : 1)] }
          : new Promise((resolve) => (release = () => resolve({ ok: true, value: { total: 30, offset: 1, orders: [mkOrder(2)] } })))
    })
    await renderTab('orders')
    await click(screen.getByRole('button', { name: 'Показати ще' }))
    fireEvent.change(screen.getByLabelText('Оплата'), { target: { value: 'yes' } })
    await click(screen.getByRole('button', { name: 'Показати' }))
    expect(screen.getByTestId('order-row-500')).toBeInTheDocument()
    await act(async () => release(undefined))
    expect(screen.queryByTestId('order-row-2')).toBeNull()
    expect(screen.getByRole('button', { name: 'Показати ще' })).toBeEnabled()
  })

  it('a failing list shows the error', async () => {
    mockFeature({ 'orders.list': { ok: false, error: 'Для цього потрібен дозвіл: замовлення й фінанси.' } })
    await renderTab('orders')
    expect(screen.getByRole('alert')).toHaveTextContent('замовлення й фінанси')
  })

  async function openOrder(over: Partial<Order> = {}) {
    mockFeature({
      'orders.list': { total: 1, offset: 0, orders: [mkOrder(9001, over)] },
      'orders.get': mkOrder(9001, over)
    })
    await renderTab('orders')
    await click(screen.getByRole('button', { name: 'Відкрити замовлення #9001' }))
    expect(api.featureCall).toHaveBeenCalledWith('orders', 'get', { receiptId: 9001 })
  }

  it('the order: items with variations, totals, buyer + address, message, gift, shipments, refunds', async () => {
    await openOrder({
      shipments: [{ id: 3, carrier: 'usps', trackingCode: '1Z', notifiedAt: T0 + 9 }],
      refunds: [{ amount: usd(500), createdAt: T0, reason: 'damaged', note: 'sorry', status: 'complete' }]
    })
    const d = screen.getByTestId('order-detail')
    expect(d).toHaveTextContent('Замовлення #9001 від ' + formatEtsyDate(T0))
    const items = screen.getByTestId('order-items')
    expect(items).toHaveTextContent('Planner 1')
    expect(items).toHaveTextContent('Колір: Синій')
    expect(items).toHaveTextContent(price(1000))
    const totals = screen.getByTestId('order-totals')
    expect(valueOf(totals, 'Товари')).toBe(price(2000))
    // A typographic minus, like every other signed sum (Платіж, Фінанси).
    expect(valueOf(totals, 'Знижка')).toBe(signed(-200))
    expect(valueOf(totals, 'Підсумок')).toBe(price(1800))
    expect(valueOf(totals, 'Доставка')).toBe(price(300))
    expect(valueOf(totals, 'Податок')).toBe(price(500))
    expect(valueOf(totals, 'Разом')).toBe(price(2600))
    // Zero VAT / gift wrap are left out; every line explains itself.
    expect(within(totals).queryByText('ПДВ')).toBeNull()
    expect(within(totals).queryByText('Подарункове пакування')).toBeNull()
    expect(within(totals).getByRole('button', { name: 'Що таке «Податок з продажу»?' })).toBeInTheDocument()
    expect(d).toHaveTextContent('buyer@example.com')
    expect([...screen.getByTestId('order-address').children].map((x) => x.textContent)).toEqual(['Olena K', 'Main st 1', '79000 Lviv', 'Ukraine'])
    expect(screen.getByTestId('buyer-message')).toHaveTextContent('Please wrap it')
    expect(d).toHaveTextContent('«Happy birthday!»')
    expect(d).toHaveTextContent('від: Ira')
    expect(screen.getByTestId('order-shipments')).toHaveTextContent('usps · 1Z')
    expect(d).toHaveTextContent(`${price(500)} · ${formatEtsyDate(T0)} — damaged`)
    // Paid, not shipped: the next step is said first.
    expect(d).toHaveTextContent('Замовлення оплачене і чекає відправлення')
    await click(screen.getByRole('button', { name: 'До списку' }))
    expect(screen.getByTestId('orders-tab')).toBeInTheDocument()
  })

  it('the payment and the order listings load only when opened', async () => {
    await openOrder()
    mockFeature({
      'orders.payments': [mkPayment(61)],
      'orders.listings': [mkMyListing(501, { title: 'Planner live', state: 'active', quantity: 4 })]
    })
    expect(api.featureCall).not.toHaveBeenCalledWith('orders', 'payments', expect.anything())
    await openDetails('order-payments')
    expect(api.featureCall).toHaveBeenCalledWith('orders', 'payments', { receiptId: 9001 })
    const p = screen.getByTestId('payment-61')
    expect(valueOf(p, 'Сплачено покупцем')).toBe(price(2600))
    expect(valueOf(p, 'Комісії')).toBe('−' + price(110))
    expect(valueOf(p, 'Вам (чистими)')).toBe(price(2490))
    expect(valueOf(p, 'Після повернень')).toBe(price(1990))
    expect(within(p).queryByText('Зараховано після відправлення')).toBeNull()
    expect(p).toHaveTextContent('зараховано')
    expect(p).toHaveTextContent(`Повернення ${price(500)} — damaged`)

    await openDetails('order-listings-section')
    expect(api.featureCall).toHaveBeenCalledWith('orders', 'listings', { receiptId: 9001 })
    expect(screen.getByTestId('order-listings')).toHaveTextContent('Planner live')
    expect(screen.getByTestId('order-listings')).toHaveTextContent('у наявності: 4')
    await click(screen.getByRole('button', { name: 'Відкрити на Etsy' }))
    expect(api.openExternal).toHaveBeenCalledWith('https://www.etsy.com/listing/501/x')
  })

  it('a failing order load shows the error and keeps the way back', async () => {
    mockFeature({ 'orders.list': { total: 1, offset: 0, orders: [mkOrder(9001)] }, 'orders.get': { ok: false, error: 'Etsy не знайшов (HTTP 404).' } })
    await renderTab('orders')
    await click(screen.getByRole('button', { name: 'Відкрити замовлення #9001' }))
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 404')
    await click(screen.getByRole('button', { name: 'До списку' }))
    expect(screen.getByTestId('order-row-9001')).toBeInTheDocument()
  })

  it('mark shipped: asks first (cancel = nothing sent), then sends carrier, tracking, note, copy; the list follows', async () => {
    await openOrder()
    const shipped = mkOrder(9001, { isShipped: true, shipments: [{ id: 3, carrier: 'ukrposhta', trackingCode: 'RR1UA', notifiedAt: T0 }] })
    mockFeature({ 'orders.ship': shipped })
    fireEvent.change(screen.getByLabelText('Перевізник'), { target: { value: ' ukrposhta ' } })
    fireEvent.change(screen.getByLabelText('Трек-номер'), { target: { value: 'RR1UA' } })
    fireEvent.change(screen.getByLabelText('Повідомлення покупцю'), { target: { value: 'Дякую!' } })
    fireEvent.click(screen.getByLabelText('Надіслати копію листа мені'))

    await click(screen.getByRole('button', { name: 'Позначити відправленим' }))
    expect(confirmText()).toContain('Позначити замовлення #9001 відправленим?')
    expect(confirmText()).toContain('з трек-номером RR1UA')
    await click(screen.getByRole('button', { name: 'Скасувати' }))
    expect(api.featureCall).not.toHaveBeenCalledWith('orders', 'ship', expect.anything())

    await click(screen.getByRole('button', { name: 'Позначити відправленим' }))
    await click(confirmDialog('Позначити відправленим'))
    expect(api.featureCall).toHaveBeenCalledWith('orders', 'ship', {
      receiptId: 9001,
      carrier: 'ukrposhta',
      trackingCode: 'RR1UA',
      noteToBuyer: 'Дякую!',
      sendBcc: true
    })
    expect(screen.getByRole('status')).toHaveTextContent('покупцю надіслано лист')
    expect(screen.getByTestId('order-shipments')).toHaveTextContent('ukrposhta · RR1UA')
    expect(screen.getByLabelText('Трек-номер')).toHaveValue('')
    await click(screen.getByRole('button', { name: 'До списку' }))
    expect(screen.getByTestId('order-row-9001')).toHaveTextContent('відправлено')
    expect(screen.getByTestId('order-row-9001')).not.toHaveTextContent('не відправлено')
  })

  it('mark shipped: only one of carrier / tracking blocks the button; an Etsy refusal is shown', async () => {
    await openOrder()
    fireEvent.change(screen.getByLabelText('Перевізник'), { target: { value: 'usps' } })
    expect(screen.getByRole('button', { name: 'Позначити відправленим' })).toBeDisabled()
    expect(screen.getByTestId('ship-form')).toHaveTextContent('Вкажіть і перевізника, і трек-номер')
    fireEvent.change(screen.getByLabelText('Трек-номер'), { target: { value: '1Z' } })
    mockFeature({ 'orders.ship': { ok: false, error: 'Etsy відхилив відправлення (HTTP 409).' } })
    await click(screen.getByRole('button', { name: 'Позначити відправленим' }))
    await click(confirmDialog('Позначити відправленим'))
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 409')
  })

  it('flags: paid / shipped switches go through updateShopReceipt after a confirm', async () => {
    await openOrder()
    mockFeature({ 'orders.update': (a: Record<string, unknown>) => mkOrder(9001, { isPaid: a.wasPaid !== false, isShipped: a.wasShipped === true }) })
    const flags = screen.getByTestId('order-flags')
    await click(within(flags).getByRole('button', { name: 'Зняти позначку «оплачено»' }))
    await click(screen.getByRole('button', { name: 'Скасувати' }))
    expect(api.featureCall).not.toHaveBeenCalledWith('orders', 'update', expect.anything())
    await click(within(flags).getByRole('button', { name: 'Зняти позначку «оплачено»' }))
    await click(confirmDialog('Зняти позначку «оплачено»'))
    expect(api.featureCall).toHaveBeenCalledWith('orders', 'update', { receiptId: 9001, wasPaid: false })
    expect(screen.getByRole('status')).toHaveTextContent('Позначку «оплачено» знято.')
    expect(within(flags).getByRole('button', { name: 'Позначити оплаченим' })).toBeInTheDocument()

    await click(within(flags).getByRole('button', { name: 'Відправлено без трек-номера' }))
    expect(confirmText()).toContain('позначити відправленим без трек-номера?')
    await click(confirmDialog('Відправлено без трек-номера'))
    // (the ship form that came back reads the shop's carriers, so look at the updates only)
    expect(api.featureCall.mock.calls.filter((c) => c[1] === 'update').at(-1)).toEqual(['orders', 'update', { receiptId: 9001, wasShipped: true }])

    mockFeature({ 'orders.update': { ok: false, error: 'Etsy не дозволив цю дію (HTTP 403)' } })
    await click(within(flags).getByRole('button', { name: 'Зняти позначку «відправлено»' }))
    await click(confirmDialog('Зняти позначку «відправлено»'))
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 403')
  })
})

describe('Мій магазин → Фінанси', () => {
  const NOW = new Date(2026, 9, 24, 15, 0).getTime()
  const entry = (id: number, over: Partial<LedgerEntry> = {}): LedgerEntry => ({
    entryId: id,
    ledgerId: 1,
    sequence: id,
    amount: usd(2490),
    balance: usd(10000 + id),
    description: 'Payment',
    type: 'PAYMENT',
    referenceType: 'receipt',
    referenceId: '9001',
    parentEntryId: null,
    createdAt: T0 + id,
    adjustments: [],
    ...over
  })
  const mkLedger = (over: Partial<LedgerPage> = {}): LedgerPage => ({
    minCreated: localDaySec('2026-09-24')!,
    maxCreated: localDaySec('2026-10-24', true)!,
    total: 2,
    entries: [
      entry(71, { amount: usd(-20), description: 'Transaction fee', type: 'transaction', referenceType: 'transaction', referenceId: '1', parentEntryId: 70 }),
      entry(70)
    ],
    totals: [
      { type: 'transaction', count: 1, sum: usd(-20) },
      { type: 'PAYMENT', count: 1, sum: usd(2490) }
    ],
    truncated: false,
    ...over
  })

  async function renderFinance() {
    const C = ui.myShopTabs!.find((t) => t.id === 'orders-finance')!.Component as (p: { now?: number }) => JSX.Element
    render(<C now={NOW} />)
    await act(async () => {})
  }

  it('loads the last 30 days: totals per type, entries with date, description, amount, balance', async () => {
    mockFeature({ 'orders.ledger': mkLedger() })
    await renderFinance()
    expect(localDate(NOW)).toBe('2026-10-24')
    expect(api.featureCall).toHaveBeenCalledWith('orders', 'ledger', { minCreated: localDaySec('2026-09-24'), maxCreated: localDaySec('2026-10-24', true) })
    expect(screen.getByLabelText('Від дати')).toHaveValue('2026-09-24')
    expect(screen.getByText('Записів за період: 2')).toBeInTheDocument()
    const totals = screen.getByTestId('ledger-totals')
    // Known Etsy types are named in Ukrainian only (Etsy's own code is a tooltip); amounts carry a sign.
    expect(totals).toHaveTextContent('Комісія за продаж1' + signed(-20))
    expect(totals).toHaveTextContent('Оплата замовлення1' + signed(2490))
    expect(totals).not.toHaveTextContent('PAYMENT')
    expect(within(totals).getByText('Оплата замовлення')).toHaveAttribute('title', 'Тип в Etsy: PAYMENT')
    const e = screen.getByTestId('entry-71')
    expect(e).toHaveTextContent(formatEtsyDate(T0 + 71))
    // The Ukrainian type is the entry's title; Etsy's English description is the second line, after the date.
    expect(e.querySelector('.fx-title')).toHaveTextContent(/^Комісія за продаж$/)
    expect(e).toHaveTextContent(`Комісія за продаж${formatEtsyDate(T0 + 71)}Transaction fee`)
    expect(e).toHaveTextContent(signed(-20))
    expect(e).toHaveTextContent('баланс ' + price(10071))
    expect(within(e).getByText(signed(-20))).toHaveClass('is-out')
    expect(within(screen.getByTestId('entry-70')).getByText(signed(2490))).toHaveClass('is-in')
    // The period in one look: money in, money out, the balance after the newest entry.
    const sum = screen.getByTestId('ledger-summary')
    expect(valueOf(sum, 'Надійшло')).toBe(signed(2490))
    expect(valueOf(sum, 'Списано')).toBe(signed(-20))
    expect(valueOf(sum, 'Заробили')).toBe(signed(2470))
    // No payout in the period → no payout tile.
    expect(within(sum).queryByText('Виплачено на картку')).toBeNull()
    expect(valueOf(sum, 'Баланс')).toBe(price(10071))
    expect(screen.getByRole('radio', { name: '30 дн.' })).toBeChecked()
    expect(within(screen.getByTestId('entry-70')).queryByRole('button', { name: 'Продаж' })).toBeNull()
  })

  it('another period → reloaded; a reversed one is refused locally; a failure is shown', async () => {
    mockFeature({ 'orders.ledger': mkLedger() })
    await renderFinance()
    fireEvent.change(screen.getByLabelText('Від дати'), { target: { value: '2026-10-10' } })
    fireEvent.change(screen.getByLabelText('До дати'), { target: { value: '2026-10-01' } })
    const n = api.featureCall.mock.calls.length
    await click(screen.getByRole('button', { name: 'Показати' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Дата «від» пізніше за дату «до».')
    expect(api.featureCall.mock.calls.length).toBe(n)

    mockFeature({ 'orders.ledger': { ok: false, error: 'Сервер Etsy повернув помилку (HTTP 500).' } })
    fireEvent.change(screen.getByLabelText('До дати'), { target: { value: '2026-10-20' } })
    await click(screen.getByRole('button', { name: 'Показати' }))
    expect(api.featureCall).toHaveBeenLastCalledWith('orders', 'ledger', { minCreated: localDaySec('2026-10-10'), maxCreated: localDaySec('2026-10-20', true) })
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 500')
    // The previous period's entries and totals are gone.
    expect(screen.queryByTestId('ledger-entries')).toBeNull()
    expect(screen.queryByTestId('ledger-totals')).toBeNull()
    expect(screen.queryByText('Записів за період: 2')).toBeNull()
  })

  it('a truncated range says so', async () => {
    mockFeature({ 'orders.ledger': mkLedger({ total: 5000, truncated: true }) })
    await renderFinance()
    expect(screen.getByText(/Показано лише 2 записів/)).toBeInTheDocument()
  })

  it('per entry: its payments, the related entry, the sale it refers to', async () => {
    const sale: OrderItem = mkItem(1, { title: 'Planner sold', quantity: 3 })
    mockFeature({
      'orders.ledger': mkLedger(),
      'orders.ledgerPayments': [mkPayment(61)],
      'orders.ledgerEntry': entry(70, { description: 'Payment for order' }),
      'orders.sale': sale
    })
    await renderFinance()
    const row = screen.getByTestId('entry-71')
    await click(within(row).getByRole('button', { name: 'Платежі' }))
    expect(api.featureCall).toHaveBeenCalledWith('orders', 'ledgerPayments', { entryId: 71 })
    expect(screen.getByTestId('payment-61')).toBeInTheDocument()
    await click(within(row).getByRole('button', { name: 'Пов’язаний запис' }))
    expect(api.featureCall).toHaveBeenCalledWith('orders', 'ledgerEntry', { entryId: 70 })
    expect(screen.getByTestId('parent-70')).toHaveTextContent('Payment for order')
    expect(screen.queryByTestId('payment-61')).toBeNull()
    await click(within(row).getByRole('button', { name: 'Продаж' }))
    expect(api.featureCall).toHaveBeenCalledWith('orders', 'sale', { transactionId: 1 })
    expect(screen.getByTestId('sale-1')).toHaveTextContent(`Planner sold · 3 шт. × ${price(1000)} · замовлення #9001`)
    await click(within(row).getByRole('button', { name: 'Продаж' }))
    expect(screen.queryByTestId('sale-1')).toBeNull()
  })

  it('"Продажі за товарами" for the period loads when opened', async () => {
    const summary: SalesSummary = {
      minCreated: 1,
      maxCreated: 2,
      ordersRead: 2000,
      ordersTotal: 2600,
      excludedOrders: 3,
      truncated: true,
      sales: 4,
      quantity: 7,
      revenue: [usd(5500), { amount: 700, divisor: 100, currency: 'EUR' }],
      lastSaleAt: T0,
      products: [{ listingId: 501, title: 'Planner', sales: 2, quantity: 5, revenue: [usd(5000)], lastSaleAt: T0 }]
    }
    mockFeature({ 'orders.ledger': mkLedger(), 'orders.sales': summary })
    await renderFinance()
    expect(api.featureCall).not.toHaveBeenCalledWith('orders', 'sales', expect.anything())
    await openDetails('finance-sales')
    expect(api.featureCall).toHaveBeenCalledWith('orders', 'sales', { minCreated: localDaySec('2026-09-24'), maxCreated: localDaySec('2026-10-24', true) })
    const s = screen.getByTestId('sales-by-listing')
    expect(valueOf(s, 'Продажів')).toBe('4')
    expect(valueOf(s, 'Продано шт.')).toBe('7')
    expect(valueOf(s, 'Виручка')).toBe(`${price(5500)} + ${price(700, 'EUR')}`)
    expect(s).toHaveTextContent('крім скасованих і повністю повернутих (повернутих пропущено: 3)')
    expect(s).toHaveTextContent('Прочитано лише 2000 найновіших замовлень із 2600 — старіші замовлення цього періоду не враховано.')
    expect(s).toHaveTextContent('Planner25' + price(5000))
  })
})

describe('Own listing → Продажі', () => {
  const Section = ui.ownListingSections![0].Component
  const sales = (over: Partial<ListingSales> = {}): ListingSales => ({
    listingId: 501,
    total: 3,
    scanned: 3,
    truncated: false,
    sales: 3,
    quantity: 7,
    revenue: [usd(7000)],
    lastSaleAt: T0 + 5,
    recent: [mkItem(3, { quantity: 3, receiptId: 9002 }), mkItem(1)],
    ...over
  })

  it('count, units, revenue, last sale and the recent sales of this listing', async () => {
    mockFeature({ 'orders.listingSales': sales() })
    render(<Section listing={mkMyListing(501)} onChanged={() => {}} />)
    await act(async () => {})
    expect(api.featureCall).toHaveBeenCalledWith('orders', 'listingSales', { listingId: 501 })
    const s = screen.getByTestId('listing-sales')
    expect(valueOf(s, 'Продажів')).toBe('3')
    expect(valueOf(s, 'Продано шт.')).toBe('7')
    expect(valueOf(s, 'Виручка')).toBe(price(7000))
    expect(valueOf(s, 'Останній продаж')).toBe(formatEtsyDate(T0 + 5))
    const first = within(screen.getByRole('list', { name: 'Останні продажі' })).getAllByRole('listitem')[0]
    expect(first).toHaveTextContent(`${formatEtsyDate(T0 + 3)} · замовлення #9002`)
    expect(first).toHaveTextContent(`3 шт. × ${price(1000)}`)
    expect(first).toHaveTextContent('Колір: Синій')
    expect(s).toHaveTextContent('зокрема зі скасованих і повернутих замовлень')
    expect(screen.getByRole('heading', { name: 'Останні продажі' })).toBeInTheDocument()
  })

  it('no sales / truncated / an error', async () => {
    mockFeature({ 'orders.listingSales': sales({ total: 0, recent: [], quantity: 0, revenue: [] }) })
    const r = render(<Section listing={mkMyListing(501)} onChanged={() => {}} />)
    await act(async () => {})
    expect(screen.getByText('Продажів цього товару ще не було.')).toBeInTheDocument()
    r.unmount()

    mockFeature({ 'orders.listingSales': sales({ total: 2500, scanned: 2000, truncated: true }) })
    const r2 = render(<Section listing={mkMyListing(501)} onChanged={() => {}} />)
    await act(async () => {})
    expect(screen.getByText(/Прочитано лише 2000 продажів із 2500 \(у порядку, який обирає Etsy\) — підсумки неповні/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Найновіші з прочитаних продажів' })).toBeInTheDocument()
    r2.unmount()

    mockFeature({ 'orders.listingSales': { ok: false, error: 'Увійдіть в Etsy' } })
    render(<Section listing={mkMyListing(501)} onChanged={() => {}} />)
    await act(async () => {})
    expect(screen.getByRole('alert')).toHaveTextContent('Увійдіть в Etsy')
  })
})

describe('Мій магазин → Замовлення: quick views, next step, address', () => {
  it('"Треба відправити" = paid, not shipped, not canceled — applied at once; "Скинути фільтри" goes back to all', async () => {
    mockFeature({ 'orders.list': { total: 0, offset: 0, orders: [] } })
    await renderTab('orders')
    expect(screen.getByRole('radio', { name: 'Усі' })).toBeChecked()
    await click(screen.getByRole('radio', { name: /Треба відправити/ }))
    expect(api.featureCall).toHaveBeenLastCalledWith('orders', 'list', {
      sortOn: 'created',
      sortOrder: 'desc',
      limit: 25,
      offset: 0,
      wasPaid: true,
      wasShipped: false,
      wasCanceled: false
    })
    expect(screen.getByRole('radio', { name: /Треба відправити/ })).toBeChecked()
    // The full filters show the same choice.
    expect(screen.getByLabelText('Оплата')).toHaveValue('yes')
    expect(screen.getByLabelText('Відправка')).toHaveValue('no')
    expect(screen.getByText('Спробуйте інший фільтр.')).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Скинути фільтри' }))
    expect(api.featureCall).toHaveBeenLastCalledWith('orders', 'list', { sortOn: 'created', sortOrder: 'desc', limit: 25, offset: 0 })
    expect(screen.getByRole('radio', { name: 'Усі' })).toBeChecked()
    expect(screen.getByText('Коли хтось купить у вашому магазині, замовлення з’явиться тут.')).toBeInTheDocument()
  })

  it('a custom filter checks no quick view until it matches one', async () => {
    mockFeature({ 'orders.list': { total: 0, offset: 0, orders: [] } })
    await renderTab('orders')
    fireEvent.change(screen.getByLabelText('Доставка'), { target: { value: 'yes' } })
    expect(screen.getByTestId('orders-filters')).toHaveTextContent('є незастосовані зміни')
    await click(screen.getByRole('button', { name: 'Показати' }))
    for (const name of ['Усі', /Треба відправити/, 'Відправлено', 'Скасовано']) expect(screen.getByRole('radio', { name })).not.toBeChecked()
    expect(screen.getByTestId('orders-filters')).not.toHaveTextContent('є незастосовані зміни')
  })

  async function openOne(over: Partial<Order>) {
    mockFeature({ 'orders.list': { total: 1, offset: 0, orders: [mkOrder(9001, over)] }, 'orders.get': mkOrder(9001, over) })
    await renderTab('orders')
    await click(screen.getByRole('button', { name: 'Відкрити замовлення #9001' }))
  }

  it('says what to do next: unpaid → wait, shipped → nothing, canceled → nothing to send', async () => {
    await openOne({ isPaid: false, status: 'open' })
    expect(screen.getByTestId('order-detail')).toHaveTextContent('Покупець ще не заплатив')
    cleanupAll()
    await openOne({ isShipped: true, status: 'completed' })
    expect(screen.getByTestId('order-detail')).toHaveTextContent('Замовлення відправлене')
    expect(screen.getByTestId('order-detail')).toHaveTextContent('виконано')
    cleanupAll()
    await openOne({ status: 'canceled' })
    expect(screen.getByTestId('order-detail')).toHaveTextContent('Замовлення скасоване')
  })

  it('"Як відправити" moves to the ship form; the address can be copied', async () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    await openOne({})
    await click(screen.getByRole('button', { name: 'Як відправити' }))
    expect(scrolled).toHaveBeenCalled()
    expect(screen.getByLabelText('Перевізник')).toHaveFocus()
    await click(screen.getByRole('button', { name: 'Копіювати адресу' }))
    expect(api.copyText).toHaveBeenCalledWith('Olena K\nMain st 1\n79000 Lviv\nUkraine')
    expect(screen.getByRole('button', { name: 'Скопійовано' })).toBeInTheDocument()
  })

  it('the copy feedback goes back to "Копіювати адресу" after 2 s', async () => {
    await openOne({})
    vi.useFakeTimers()
    try {
      await click(screen.getByRole('button', { name: 'Копіювати адресу' }))
      expect(screen.getByRole('button', { name: 'Скопійовано' })).toBeInTheDocument()
      await act(async () => {
        vi.advanceTimersByTime(1900)
      })
      expect(screen.getByRole('button', { name: 'Скопійовано' })).toBeInTheDocument()
      await act(async () => {
        vi.advanceTimersByTime(200)
      })
      expect(screen.getByRole('button', { name: 'Копіювати адресу' })).toBeInTheDocument()
      // A refused copy says so, and comes back too.
      api.copyText.mockResolvedValueOnce(false)
      await click(screen.getByRole('button', { name: 'Копіювати адресу' }))
      expect(screen.getByRole('button', { name: 'Не вдалося скопіювати' })).toBeInTheDocument()
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })
      expect(screen.getByRole('button', { name: 'Копіювати адресу' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a cancelled or unpaid order offers no ship form — only behind "Все одно позначити відправленим…" with a warning', async () => {
    for (const [over, warn] of [
      [{ status: 'canceled' }, 'Замовлення скасоване'],
      [{ status: 'fully refunded' }, 'Замовлення скасоване'],
      [{ isPaid: false, status: 'open' }, 'Замовлення ще не оплачене']
    ] as const) {
      await openOne(over)
      expect(screen.queryByTestId('ship-form')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Позначити відправленим' })).toBeNull()
      expect(screen.getByTestId('ship-anyway')).toHaveTextContent('Все одно позначити відправленим…')
      await openDetails('ship-anyway')
      expect(screen.getByTestId('ship-anyway')).toHaveTextContent(warn)
      expect(within(screen.getByTestId('ship-anyway')).getByTestId('ship-form')).toBeInTheDocument()
      cleanupAll()
    }
    // Paid (shipped or not): the form is right there.
    await openOne({ isShipped: true, status: 'completed' })
    expect(screen.getByTestId('ship-form')).toHaveTextContent('Замовлення вже позначене відправленим')
    expect(screen.queryByTestId('ship-anyway')).toBeNull()
  })

  it('the carrier is chosen from Etsy\'s list for the shop\'s origin country (or "Інша служба" = other)', async () => {
    mockFeature({
      'shopConfig.shippingProfiles': [{ id: 21, title: 'Main', originCountry: 'UA', destinations: [], upgrades: [] }],
      'shopConfig.carriers': [
        { id: 2, name: 'Ukrposhta', domesticClasses: [], internationalClasses: [] },
        { id: 3, name: 'Nova Poshta', domesticClasses: [], internationalClasses: [] }
      ],
      'orders.ship': mkOrder(9001, { isShipped: true })
    })
    await openOne({})
    expect(api.featureCall).toHaveBeenCalledWith('shopConfig', 'carriers', { country: 'UA' })
    const carrier = screen.getByLabelText('Перевізник') as HTMLSelectElement
    expect(carrier.tagName).toBe('SELECT')
    expect([...carrier.options].map((o) => o.text)).toEqual(['— не вказано —', 'Ukrposhta', 'Nova Poshta', 'Інша служба (немає в списку)'])
    fireEvent.change(carrier, { target: { value: 'Nova Poshta' } })
    fireEvent.change(screen.getByLabelText('Трек-номер'), { target: { value: '2045' } })
    await click(screen.getByRole('button', { name: 'Позначити відправленим' }))
    await click(confirmDialog('Позначити відправленим'))
    expect(api.featureCall).toHaveBeenCalledWith('orders', 'ship', { receiptId: 9001, carrier: 'Nova Poshta', trackingCode: '2045', noteToBuyer: undefined, sendBcc: false })
    cleanupAll()

    await openOne({})
    fireEvent.change(screen.getByLabelText('Перевізник'), { target: { value: 'other' } })
    fireEvent.change(screen.getByLabelText('Трек-номер'), { target: { value: 'X1' } })
    await click(screen.getByRole('button', { name: 'Позначити відправленим' }))
    await click(confirmDialog('Позначити відправленим'))
    expect(api.featureCall).toHaveBeenLastCalledWith('orders', 'ship', expect.objectContaining({ carrier: 'other', trackingCode: 'X1' }))
  })

  it('the own tracked shop\'s shipping-from country picks the carriers (no profile read)', async () => {
    useStore.setState({
      etsyAuth: { loggedIn: true, redirectUri: '', pending: false, encrypted: true, shopId: 77 },
      shops: [{ id: 77, profile: { shippingFromCountryIso: 'PL', countryIso: 'UA' } } as never]
    })
    mockFeature({ 'shopConfig.carriers': [{ id: 5, name: 'InPost', domesticClasses: [], internationalClasses: [] }] })
    await openOne({})
    expect(api.featureCall).toHaveBeenCalledWith('shopConfig', 'carriers', { country: 'PL' })
    expect(api.featureCall).not.toHaveBeenCalledWith('shopConfig', 'shippingProfiles', expect.anything())
    expect(within(screen.getByLabelText('Перевізник')).getByRole('option', { name: 'InPost' })).toBeInTheDocument()
  })

  it('the ship form explains what happens; the copy switch is a toggle', async () => {
    await openOne({})
    const form = screen.getByTestId('ship-form')
    expect(form).toHaveTextContent('Etsy одразу надішле покупцю лист')
    const copy = within(form).getByRole('switch', { name: 'Надіслати копію листа мені' })
    expect(copy).not.toBeChecked()
    await click(copy)
    expect(copy).toBeChecked()
  })
})

describe('Мій магазин → Фінанси: quick periods, types, narrow tables', () => {
  const NOW = new Date(2026, 9, 24, 15, 0).getTime()
  const page = (over: Partial<LedgerPage> = {}): LedgerPage => ({
    minCreated: 1,
    maxCreated: 2,
    total: 1,
    entries: [
      {
        entryId: 5,
        ledgerId: 1,
        sequence: 1,
        amount: usd(-15000),
        balance: usd(100),
        description: 'Deposit',
        type: 'SOMETHING_NEW',
        referenceType: null,
        referenceId: null,
        parentEntryId: null,
        createdAt: T0,
        adjustments: []
      }
    ],
    totals: [{ type: 'SOMETHING_NEW', count: 1, sum: usd(-15000) }],
    truncated: false,
    ...over
  })
  async function renderFinance() {
    const C = ui.myShopTabs!.find((t) => t.id === 'orders-finance')!.Component as (p: { now?: number }) => JSX.Element
    render(<C now={NOW} />)
    await act(async () => {})
  }

  it('a quick period sets the dates and loads at once', async () => {
    mockFeature({ 'orders.ledger': page() })
    await renderFinance()
    await click(screen.getByRole('radio', { name: '7 дн.' }))
    expect(api.featureCall).toHaveBeenLastCalledWith('orders', 'ledger', { minCreated: localDaySec('2026-10-17'), maxCreated: localDaySec('2026-10-24', true) })
    expect(screen.getByLabelText('Від дати')).toHaveValue('2026-10-17')
    expect(screen.getByRole('radio', { name: '7 дн.' })).toBeChecked()
    // Own dates: no quick period is checked.
    fireEvent.change(screen.getByLabelText('Від дати'), { target: { value: '2026-10-02' } })
    expect(screen.getByRole('radio', { name: '7 дн.' })).not.toBeChecked()
  })

  it('an unknown Etsy type is shown as Etsy wrote it; nothing came in → +0', async () => {
    mockFeature({ 'orders.ledger': page() })
    await renderFinance()
    expect(screen.getByTestId('ledger-totals')).toHaveTextContent('SOMETHING_NEW1' + signed(-15000))
    expect(valueOf(screen.getByTestId('ledger-summary'), 'Надійшло')).toBe('0')
    // No Ukrainian name: the entry's own description is its title.
    expect(screen.getByTestId('entry-5').querySelector('.fx-title')).toHaveTextContent(/^Deposit$/)
  })

  it('payouts to the own card are a tile of their own, not a cost: "Списано" = fees etc., "Заробили" = in − out', async () => {
    const e = (entryId: number, amount: number, type: string, description: string): LedgerEntry => ({
      ...page().entries[0],
      entryId,
      sequence: entryId,
      amount: usd(amount),
      type,
      description,
      createdAt: T0 + entryId
    })
    mockFeature({
      'orders.ledger': page({
        total: 4,
        entries: [e(4, -15000, 'DISBURSE2', 'Deposit to your bank account'), e(3, -722, 'transaction', 'Transaction fee'), e(2, 3740, 'PAYMENT', 'Payment'), e(1, -20, 'prolist', 'Etsy Ads')],
        totals: []
      })
    })
    await renderFinance()
    const sum = screen.getByTestId('ledger-summary')
    expect(valueOf(sum, 'Надійшло')).toBe(signed(3740))
    expect(valueOf(sum, 'Списано')).toBe(signed(-742))
    expect(valueOf(sum, 'Заробили')).toBe(signed(2998))
    expect(valueOf(sum, 'Виплачено на картку')).toBe(price(15000))
    expect(within(sum).getByText('Виплачено на картку').closest('.ui-stat')).toHaveTextContent('ваші гроші, не витрата')
    expect(screen.getByTestId('entry-4').querySelector('.fx-title')).toHaveTextContent(/^Виплата на ваш рахунок$/)
  })

  it('a narrow pane turns the tables into cards (each value keeps its column name)', async () => {
    const layout = fakeLayout({ 'fx-table-wrap': 900 })
    try {
      mockFeature({ 'orders.ledger': page() })
      await renderFinance()
      const table = screen.getByTestId('ledger-totals')
      expect(table).not.toHaveClass('is-stacked')
      // The 3-column totals fit long: they stack only below 480 px.
      layout.resize('fx-table-wrap', 500)
      expect(table).not.toHaveClass('is-stacked')
      layout.resize('fx-table-wrap', 460)
      expect(table).toHaveClass('is-stacked')
      expect(within(table).getAllByRole('cell')[2]).toHaveAttribute('data-label', 'Сума')
      layout.resize('fx-table-wrap', 800)
      expect(table).not.toHaveClass('is-stacked')
    } finally {
      layout.restore()
    }
  })
})
