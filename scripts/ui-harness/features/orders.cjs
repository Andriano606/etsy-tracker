// UI harness samples for feature "orders" (Мій магазин → Замовлення / Фінанси,
// own listing → Продажі). Shapes = src/shared/features/orders.ts.

const DAY = 86400
const NOW = Math.floor(Date.now() / 1000)
const usd = (v) => ({ amount: Math.round(v * 100), divisor: 100, currency: 'USD' })

function item(ctx, n, over = {}) {
  const l = ctx.myListings[n % ctx.myListings.length]
  return {
    transactionId: 7000 + n,
    receiptId: 3300000 + n,
    listingId: l.listingId,
    productId: 100 + n,
    title: l.title,
    quantity: 1 + (n % 3 === 0 ? 1 : 0),
    price: usd((l.priceAmount ?? 500) / (l.priceDivisor ?? 100)),
    shippingCost: usd(0),
    variations: n % 2 ? [{ name: 'Формат', value: 'A5, друкований' }, { name: 'Колір обкладинки', value: 'Шавлія' }] : [],
    sku: n % 2 ? `TFS-${200 + n}` : null,
    isDigital: n % 2 === 0,
    createdAt: NOW - n * DAY * 0.7,
    paidAt: NOW - n * DAY * 0.7,
    shippedAt: null,
    expectedShipDate: NOW + 2 * DAY,
    shippingMethod: 'Стандартна',
    shippingUpgrade: null,
    ...over
  }
}

const BUYERS = ['Olena Kovalenko', 'Sarah Mitchell', 'Jonas Becker', 'Emily R.', 'Marta Nowak', 'Chloé Dubois-Laurent', 'Mike T.', 'Anna Schmidt']

function order(ctx, n) {
  const items = [item(ctx, n), ...(n % 3 === 0 ? [item(ctx, n + 5, { receiptId: 3300000 + n })] : [])]
  const itemsTotal = items.reduce((s, i) => s + (i.price.amount * i.quantity) / 100, 0)
  const discount = n % 4 === 1 ? Math.round(itemsTotal * 20) / 100 : 0
  const shipping = n % 2 ? 8.5 : 0
  const tax = n % 5 === 2 ? 1.12 : 0
  const paid = n !== 4
  const shipped = n > 2 && n !== 4
  const canceled = n === 6
  return {
    receiptId: 3300000 + n,
    status: canceled ? 'canceled' : shipped ? 'completed' : paid ? 'paid' : 'open',
    createdAt: NOW - n * DAY * 0.7,
    updatedAt: NOW - n * DAY * 0.5,
    isPaid: paid,
    isShipped: shipped,
    isGift: n === 1,
    giftMessage: n === 1 ? 'З днем народження, сестричко! Нехай цей рік буде впорядкованим.' : null,
    giftSender: n === 1 ? 'Ірина' : null,
    buyerName: BUYERS[n % BUYERS.length],
    buyerEmail: n % 2 ? `buyer${n}@example.com` : null,
    address: {
      name: BUYERS[n % BUYERS.length],
      firstLine: '1428 Elm Street, Apt 5B',
      secondLine: null,
      city: 'Springfield',
      state: 'IL',
      zip: '62704',
      countryIso: 'US',
      formatted: `${BUYERS[n % BUYERS.length]}\n1428 Elm Street, Apt 5B\nSpringfield, IL 62704\nUnited States`
    },
    paymentMethod: n % 2 ? 'cc' : 'paypal',
    messageFromBuyer: n === 1 ? 'Чи можна вкласти листівку без ціни? Це подарунок.' : null,
    messageFromSeller: null,
    messageFromPayment: null,
    totals: {
      grandTotal: usd(itemsTotal - discount + shipping + tax + (n === 1 ? 2 : 0)),
      subtotal: usd(itemsTotal - discount),
      itemsTotal: usd(itemsTotal),
      shipping: usd(shipping),
      tax: usd(tax),
      vat: usd(0),
      discount: usd(discount),
      giftWrap: usd(n === 1 ? 2 : 0)
    },
    items,
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
    shipments: shipped ? [{ id: 900 + n, carrier: 'ukrposhta', trackingCode: `RR${123456780 + n}UA`, notifiedAt: NOW - n * DAY * 0.4 }] : [],
    refunds: n === 5 ? [{ amount: usd(2), createdAt: NOW - DAY, reason: 'Частина набору пошкоджена', note: null, status: 'complete' }] : []
  }
}

const payment = (o, id) => ({
  paymentId: id,
  receiptId: o.receiptId,
  status: 'settled',
  currency: 'USD',
  shopCurrency: 'USD',
  buyerCurrency: 'USD',
  gross: o.totals.grandTotal,
  fees: usd(Math.round(o.totals.grandTotal.amount * 0.03 + 25) / 100),
  net: usd((o.totals.grandTotal.amount - Math.round(o.totals.grandTotal.amount * 0.03 + 25)) / 100),
  postedGross: o.isShipped ? o.totals.grandTotal : null,
  postedFees: null,
  postedNet: o.isShipped ? usd((o.totals.grandTotal.amount - Math.round(o.totals.grandTotal.amount * 0.03 + 25)) / 100) : null,
  adjustedGross: null,
  adjustedFees: null,
  adjustedNet: o.refunds.length ? usd(10) : null,
  createdAt: o.createdAt,
  updatedAt: o.updatedAt,
  shippedAt: null,
  adjustments: o.refunds.length
    ? [{ id: 1, status: 'COMPLETED', isSuccess: true, reason: 'Частина набору пошкоджена', amount: usd(2), shopAmount: usd(2), buyerAmount: null, feeAmount: null, createdAt: NOW - DAY, items: [] }]
    : []
})

function ledger(a) {
  const lo = a.minCreated ?? NOW - 30 * DAY
  const rows = []
  let bal = 18450
  const push = (i, cents, description, type, extra = {}) => {
    bal += cents
    rows.push({
      entryId: 880000 + i,
      ledgerId: 1,
      sequence: i,
      amount: usd(cents / 100),
      balance: usd(bal / 100),
      description,
      type,
      referenceType: 'receipt',
      referenceId: String(3300000 + i),
      parentEntryId: null,
      createdAt: lo + i * DAY * 0.9,
      adjustments: [],
      ...extra
    })
  }
  push(1, 1450, 'Payment for order #3300001', 'PAYMENT')
  push(2, -20, 'Listing fee', 'listing', { referenceType: 'listing', referenceId: '4359785103' })
  push(3, -95, 'Transaction fee: Weekly Meal Planner Spreadsheet', 'transaction', { referenceType: 'transaction', referenceId: '7003' })
  push(4, -19, 'VAT: Transaction fee', 'vat_tax_ep', { parentEntryId: 880003 })
  push(5, -68, 'Processing fee', 'PAYMENT_PROCESSING_FEE')
  push(6, 2290, 'Payment for order #3300006', 'PAYMENT')
  push(7, -320, 'Etsy Ads', 'prolist')
  push(8, -15000, 'Deposit to your bank account', 'DISBURSE2')
  push(9, -200, 'Refund to buyer for order #3300005', 'REFUND')
  return rows.reverse()
}

module.exports = {
  list: (a, ctx) => {
    let rows = Array.from({ length: 8 }, (_, i) => order(ctx, i + 1))
    if (a.wasPaid !== undefined) rows = rows.filter((o) => o.isPaid === a.wasPaid)
    if (a.wasShipped !== undefined) rows = rows.filter((o) => o.isShipped === a.wasShipped)
    if (a.wasCanceled !== undefined) rows = rows.filter((o) => (o.status === 'canceled') === a.wasCanceled)
    const total = a.offset ? rows.length : rows.length + 40
    return { total, offset: a.offset ?? 0, orders: rows }
  },
  get: (a, ctx) => order(ctx, (a.receiptId ?? 3300001) - 3300000),
  payments: (a, ctx) => {
    const o = order(ctx, (a.receiptId ?? 3300001) - 3300000)
    return [payment(o, 41000 + (o.receiptId % 100))]
  },
  listings: (a, ctx) => {
    const o = order(ctx, (a.receiptId ?? 3300001) - 3300000)
    return o.items.map((i) => ctx.myListings.find((l) => l.listingId === i.listingId)).filter(Boolean)
  },
  ship: (a, ctx) => {
    const o = order(ctx, (a.receiptId ?? 3300001) - 3300000)
    return { ...o, isShipped: true, shipments: [...o.shipments, { id: 999, carrier: a.carrier ?? null, trackingCode: a.trackingCode ?? null, notifiedAt: NOW }] }
  },
  update: (a, ctx) => {
    const o = order(ctx, (a.receiptId ?? 3300001) - 3300000)
    return { ...o, ...(a.wasPaid !== undefined ? { isPaid: a.wasPaid } : {}), ...(a.wasShipped !== undefined ? { isShipped: a.wasShipped } : {}) }
  },
  ledger: (a) => {
    const entries = ledger(a)
    const totals = new Map()
    for (const e of entries) {
      const t = totals.get(e.type) ?? { type: e.type, count: 0, sum: usd(0) }
      t.count++
      t.sum = { ...t.sum, amount: t.sum.amount + e.amount.amount }
      totals.set(e.type, t)
    }
    return {
      minCreated: a.minCreated,
      maxCreated: a.maxCreated,
      total: entries.length,
      entries,
      totals: [...totals.values()].sort((x, y) => y.count - x.count),
      truncated: false
    }
  },
  ledgerPayments: (a, ctx) => [payment(order(ctx, 1), 41001)],
  ledgerEntry: (a) => ledger({}).find((e) => e.entryId === a.entryId) ?? ledger({})[0],
  sale: (a, ctx) => item(ctx, (a.transactionId ?? 7003) - 7000),
  sales: (a, ctx) => ({
    minCreated: a.minCreated,
    maxCreated: a.maxCreated,
    ordersRead: 48,
    ordersTotal: 48,
    excludedOrders: 1,
    truncated: false,
    sales: 61,
    quantity: 74,
    revenue: [usd(463.5)],
    lastSaleAt: NOW - DAY / 3,
    products: ctx.myListings.slice(0, 6).map((l, i) => ({
      listingId: l.listingId,
      title: l.title,
      sales: 18 - i * 3,
      quantity: 22 - i * 3,
      revenue: [usd(((22 - i * 3) * (l.priceAmount ?? 500)) / (l.priceDivisor ?? 100))],
      lastSaleAt: NOW - (i + 1) * DAY * 0.8
    }))
  }),
  listingSales: (a, ctx) => ({
    listingId: a.listingId,
    total: 37,
    scanned: 37,
    truncated: false,
    sales: 37,
    quantity: 41,
    revenue: [usd(201.72)],
    lastSaleAt: NOW - DAY / 2,
    recent: Array.from({ length: 6 }, (_, i) => item(ctx, i + 1, { listingId: a.listingId }))
  })
}
