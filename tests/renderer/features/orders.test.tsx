// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ui } from '../../../src/renderer/src/features/orders'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { useStore } from '../../../src/renderer/src/store'
import type { LedgerEntry, LedgerPage, ListingSales, Order, OrderItem, OrderPayment, SalesSummary } from '../../../src/shared/features/orders'
import { localDate, localDaySec } from '../../../src/shared/features/orders'
import { formatEtsyDate, formatPrice } from '../../../src/shared/format'
import { etsyIn, mkMyListing, mockFeature, setupRenderer, type Api } from '../helpers'

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

const confirmDialog = () => screen.getByRole('button', { name: 'Підтвердити' })

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
    expect(row).toHaveTextContent(formatEtsyDate(T0))
    expect(row).toHaveTextContent('#9001')
    expect(row).toHaveTextContent('Olena K')
    expect(row).toHaveTextContent(price(2600))
    expect(row).toHaveTextContent(/^\S+#9001Olena K3.+USDоплаченоне відправлено🎁 подарунокВідкрити$/)
    expect(row).toHaveTextContent('🎁 подарунок')
    expect(within(row).getAllByRole('cell')[3]).toHaveTextContent('3')
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
    await click(screen.getByRole('button', { name: 'Відкрити' }))
    expect(api.featureCall).toHaveBeenLastCalledWith('orders', 'get', { receiptId: 9001 })
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
    expect(totals).toHaveTextContent('Товари' + price(2000))
    expect(totals).toHaveTextContent('Знижка' + price(-200))
    expect(totals).toHaveTextContent('Доставка' + price(300))
    expect(totals).toHaveTextContent('Податок' + price(500))
    expect(totals).toHaveTextContent('Разом' + price(2600))
    expect(totals).not.toHaveTextContent('ПДВ')
    expect(d).toHaveTextContent('buyer@example.com')
    expect([...screen.getByTestId('order-address').children].map((x) => x.textContent)).toEqual(['Olena K', 'Main st 1', '79000 Lviv', 'Ukraine'])
    expect(screen.getByTestId('buyer-message')).toHaveTextContent('Please wrap it')
    expect(d).toHaveTextContent('«Happy birthday!»')
    expect(d).toHaveTextContent('від: Ira')
    expect(screen.getByTestId('order-shipments')).toHaveTextContent('usps · 1Z')
    expect(d).toHaveTextContent(`${price(500)} · ${formatEtsyDate(T0)} — damaged`)
    await click(screen.getByRole('button', { name: '← До списку' }))
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
    expect(p).toHaveTextContent('Сплачено покупцем' + price(2600))
    expect(p).toHaveTextContent('Комісії' + price(110))
    expect(p).toHaveTextContent('Вам (чистими)' + price(2490))
    expect(p).toHaveTextContent('Після повернень' + price(1990))
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
    await click(screen.getByRole('button', { name: 'Відкрити' }))
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 404')
    await click(screen.getByRole('button', { name: '← До списку' }))
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
    expect(screen.getByText(/Позначити замовлення #9001 відправленим\?/)).toHaveTextContent('з трек-номером RR1UA')
    await click(screen.getByRole('button', { name: 'Скасувати' }))
    expect(api.featureCall).not.toHaveBeenCalledWith('orders', 'ship', expect.anything())

    await click(screen.getByRole('button', { name: 'Позначити відправленим' }))
    await click(confirmDialog())
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
    await click(screen.getByRole('button', { name: '← До списку' }))
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
    await click(confirmDialog())
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
    await click(confirmDialog())
    expect(api.featureCall).toHaveBeenCalledWith('orders', 'update', { receiptId: 9001, wasPaid: false })
    expect(screen.getByRole('status')).toHaveTextContent('Позначку «оплачено» знято.')
    expect(within(flags).getByRole('button', { name: 'Позначити оплаченим' })).toBeInTheDocument()

    await click(within(flags).getByRole('button', { name: 'Відправлено без трек-номера' }))
    expect(screen.getByText(/позначити відправленим без трек-номера\?/)).toBeInTheDocument()
    await click(confirmDialog())
    expect(api.featureCall).toHaveBeenLastCalledWith('orders', 'update', { receiptId: 9001, wasShipped: true })

    mockFeature({ 'orders.update': { ok: false, error: 'Etsy не дозволив цю дію (HTTP 403)' } })
    await click(within(flags).getByRole('button', { name: 'Зняти позначку «відправлено»' }))
    await click(confirmDialog())
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
    expect(totals).toHaveTextContent('transaction1' + price(-20))
    expect(totals).toHaveTextContent('PAYMENT1' + price(2490))
    const e = screen.getByTestId('entry-71')
    expect(e).toHaveTextContent(formatEtsyDate(T0 + 71))
    expect(e).toHaveTextContent('Transaction fee')
    expect(e).toHaveTextContent(price(-20))
    expect(e).toHaveTextContent(price(10071))
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
    expect(s).toHaveTextContent(`Продажів: 4, продано шт.: 7, виручка: ${price(5500)} + ${price(700, 'EUR')}`)
    expect(s).toHaveTextContent('без скасованих і повністю повернутих (повернутих пропущено: 3)')
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
    expect(s).toHaveTextContent('Продажів3')
    expect(s).toHaveTextContent('Продано шт.7')
    expect(s).toHaveTextContent('Виручка' + price(7000))
    expect(s).toHaveTextContent(`${formatEtsyDate(T0 + 3)}3${price(1000)}Колір: Синій#9002`)
    expect(s).toHaveTextContent('зокрема зі скасованих і повернутих замовлень')
    expect(screen.getByRole('heading', { name: 'Останні продажі' })).toBeInTheDocument()
  })

  it('no sales / truncated / an error', async () => {
    mockFeature({ 'orders.listingSales': sales({ total: 0, recent: [], quantity: 0, revenue: [] }) })
    const r = render(<Section listing={mkMyListing(501)} onChanged={() => {}} />)
    await act(async () => {})
    expect(screen.getByText('Продажів цього лістингу ще не було.')).toBeInTheDocument()
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
