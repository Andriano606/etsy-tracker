import { describe, expect, it } from 'vitest'
import { ordersFeature } from '../../../src/main/features/orders'
import { ORDERS_TOOL_SUMMARY } from '../../../src/shared/features/orders'
import { NOT_SIGNED_IN, WRITES_OFF } from '../../../src/main/mcpStoreTools'
import { OWN_SHOP, OWN_USER, callTool, featureCtx, mcpDeps, routedFetch, runAction, signedIn, signedOut, testClient } from '../../helpers/features'
import type { FakeReply } from '../../helpers/fakeFetch'

// ------------------------------------------------------------- fixtures (OAS shapes)

const S = `/v3/application/shops/${OWN_SHOP}`
const T0 = 1_760_000_000
const money = (amount: number, currency = 'USD', divisor = 100) => ({ amount, divisor, currency_code: currency })

const txn = (id: number, over: Record<string, unknown> = {}) => ({
  transaction_id: id,
  title: 'Budget &amp; Bills Planner — Etsy bestseller',
  description: 'A planner',
  seller_user_id: OWN_USER,
  buyer_user_id: 77,
  create_timestamp: T0 + id,
  created_timestamp: T0 + id,
  paid_timestamp: T0 + id + 10,
  shipped_timestamp: null,
  quantity: 2,
  listing_image_id: 11,
  receipt_id: 9001,
  is_digital: false,
  file_data: '',
  listing_id: 501,
  transaction_type: 'listing',
  product_id: 3,
  sku: 'SKU-1',
  price: money(1000),
  shipping_cost: money(300),
  variations: [{ property_id: 200, value_id: 1, formatted_name: 'Колір', formatted_value: 'Синій &amp; білий', question_id: null, mime_type: null }],
  product_data: [],
  shipping_profile_id: 1,
  min_processing_days: 1,
  max_processing_days: 3,
  shipping_method: 'Standard',
  shipping_upgrade: null,
  expected_ship_date: T0 + 500_000,
  buyer_coupon: 0,
  shop_coupon: 0,
  ...over
})

const receipt = (id: number, over: Record<string, unknown> = {}) => ({
  receipt_id: id,
  receipt_type: 0,
  seller_user_id: OWN_USER,
  seller_email: 'me@example.com',
  buyer_user_id: 77,
  buyer_email: 'buyer@example.com',
  name: 'Olena K',
  first_line: 'Main st 1',
  second_line: 'apt 2',
  city: 'Lviv',
  state: 'Lviv obl',
  zip: '79000',
  status: 'paid',
  formatted_address: 'Olena K\nMain st 1\napt 2\n79000 Lviv\nUkraine',
  country_iso: 'UA',
  payment_method: 'cc',
  payment_email: '',
  message_from_seller: null,
  message_from_buyer: 'Please wrap it &amp; see https://www.etsy.com/listing/1',
  message_from_payment: null,
  is_paid: true,
  is_shipped: false,
  create_timestamp: T0,
  created_timestamp: T0,
  update_timestamp: T0 + 100,
  updated_timestamp: T0 + 100,
  is_gift: true,
  gift_message: 'Happy birthday!',
  gift_sender: 'Ira',
  grandtotal: money(2600),
  subtotal: money(1800),
  total_price: money(2000),
  total_shipping_cost: money(300),
  total_tax_cost: money(500),
  total_vat_cost: money(0),
  discount_amt: money(200),
  gift_wrap_price: money(0),
  shipments: [],
  transactions: [txn(1), txn(2, { quantity: 1, variations: [] })],
  refunds: [],
  ...over
})

const payment = (id: number, over: Record<string, unknown> = {}) => ({
  payment_id: id,
  buyer_user_id: 77,
  shop_id: OWN_SHOP,
  receipt_id: 9001,
  amount_gross: money(2600),
  amount_fees: money(110),
  amount_net: money(2490),
  posted_gross: money(2600),
  posted_fees: money(110),
  posted_net: money(2490),
  adjusted_gross: null,
  adjusted_fees: null,
  adjusted_net: null,
  currency: 'USD',
  shop_currency: 'USD',
  buyer_currency: 'UAH',
  shipping_user_id: 77,
  shipping_address_id: 5,
  billing_address_id: 6,
  status: 'settled',
  shipped_timestamp: null,
  create_timestamp: T0,
  created_timestamp: T0,
  update_timestamp: T0 + 1,
  updated_timestamp: T0 + 1,
  payment_adjustments: [
    {
      payment_adjustment_id: 31,
      payment_id: id,
      status: 'COMPLETED',
      is_success: true,
      user_id: OWN_USER,
      reason_code: 'Etsy dispute',
      total_adjustment_amount: 500,
      shop_total_adjustment_amount: 500,
      buyer_total_adjustment_amount: 20000,
      total_fee_adjustment_amount: 20,
      create_timestamp: T0 + 5,
      created_timestamp: T0 + 5,
      update_timestamp: T0 + 5,
      updated_timestamp: T0 + 5,
      payment_adjustment_items: [
        { payment_adjustment_id: 31, payment_adjustment_item_id: 41, adjustment_type: 'refund', amount: 500, shop_amount: 500, transaction_id: 1, bill_payment_id: null, created_timestamp: T0 + 5, updated_timestamp: T0 + 5 }
      ]
    }
  ],
  ...over
})

const entry = (id: number, over: Record<string, unknown> = {}) => ({
  entry_id: id,
  ledger_id: 1,
  sequence_number: id,
  amount: 2490,
  currency: 'USD',
  description: 'Payment from Etsy order',
  balance: 10000 + id,
  create_date: T0 + id,
  created_timestamp: T0 + id,
  ledger_type: 'PAYMENT',
  reference_type: 'receipt',
  reference_id: '9001',
  parent_entry_id: id,
  payment_adjustments: [],
  ...over
})

const listingObj = (id: number) => ({
  listing_id: id,
  shop_id: OWN_SHOP,
  title: 'Budget &amp; Planner',
  description: 'd',
  state: 'active',
  quantity: 4,
  price: money(1000),
  url: `https://www.etsy.com/listing/${id}/planner`,
  tags: [],
  materials: []
})

const page = (results: unknown[], count = results.length): FakeReply => ({ body: { count, results } })

/** A paged endpoint over `rows` (honours limit / offset). */
const paged = (rows: unknown[]) => (url: URL): FakeReply => {
  const offset = Number(url.searchParams.get('offset') ?? 0)
  const limit = Number(url.searchParams.get('limit') ?? 25)
  return page(rows.slice(offset, offset + limit), rows.length)
}

const routes = {
  [`GET ${S}/receipts`]: page([receipt(9001), receipt(9002, { is_paid: false, status: 'open', transactions: [txn(3, { receipt_id: 9002, quantity: 5 })] })], 42),
  [`GET ${S}/receipts/{id}/transactions`]: page([txn(7, { receipt_id: 9003 })]),
  [`GET ${S}/receipts/{id}/listings`]: page([listingObj(501)]),
  [`GET ${S}/receipts/{id}/payments`]: page([payment(61)]),
  [`GET ${S}/receipts/{id}`]: { body: receipt(9001) },
  [`PUT ${S}/receipts/{id}`]: { body: receipt(9001, { is_shipped: true }) },
  [`POST ${S}/receipts/{id}/tracking`]: {
    body: receipt(9001, { is_shipped: true, shipments: [{ receipt_shipping_id: 3, shipment_notification_timestamp: T0 + 9, carrier_name: 'ukrposhta', tracking_code: 'RR123UA' }] })
  },
  [`GET ${S}/payments`]: page([payment(61), payment(62)]),
  [`GET ${S}/payment-account/ledger-entries/payments`]: page([payment(61)]),
  [`GET ${S}/payment-account/ledger-entries/{id}`]: { body: entry(70, { parent_entry_id: 69 }) },
  [`GET ${S}/payment-account/ledger-entries`]: page([
    entry(70),
    entry(71, { amount: -20, description: 'Transaction fee', ledger_type: 'transaction', reference_type: 'transaction', reference_id: '1', parent_entry_id: 70 }),
    entry(72, { amount: -30, description: 'Transaction fee', ledger_type: 'transaction', reference_type: 'transaction', reference_id: '2' })
  ]),
  [`GET ${S}/transactions/{id}`]: { body: txn(1) },
  [`GET ${S}/transactions`]: paged([
    txn(1),
    txn(2, { listing_id: 502, title: 'Habit tracker', quantity: 1, price: money(500), created_timestamp: T0 + 86_400 * 3 }),
    txn(3, { quantity: 3, created_timestamp: T0 + 86_400 * 5 }),
    txn(4, { listing_id: 503, title: 'Euro thing', price: money(700, 'EUR'), quantity: 1, created_timestamp: T0 - 86_400 * 10 })
  ]),
  [`GET ${S}/listings/{id}/transactions`]: paged([txn(1), txn(3, { quantity: 3, created_timestamp: T0 + 86_400 * 5 }), txn(5, { created_timestamp: T0 - 86_400 })])
}

/** Orders for the sales summaries: getShopReceipts honours min/max_created and paging (newest first). */
const salesReceipts = [
  receipt(9101, { created_timestamp: T0 + 86_400 * 5, transactions: [txn(3, { receipt_id: 9101, quantity: 3, created_timestamp: T0 + 86_400 * 5 })] }),
  receipt(9102, {
    created_timestamp: T0 + 86_400 * 3,
    transactions: [txn(2, { receipt_id: 9102, listing_id: 502, title: 'Habit tracker', quantity: 1, price: money(500), created_timestamp: T0 + 86_400 * 3 })]
  }),
  receipt(9104, { status: 'fully refunded', created_timestamp: T0 + 86_400, transactions: [txn(8, { receipt_id: 9104, quantity: 4 })] }),
  receipt(9103, { created_timestamp: T0, transactions: [txn(1, { receipt_id: 9103 })] }),
  // Lists no transactions → getShopReceiptTransactionsByReceipt.
  receipt(9105, { created_timestamp: T0 - 86_400 * 10, transactions: [] })
]
const salesRoutes = {
  [`GET ${S}/receipts`]: (url: URL): FakeReply => {
    const lo = Number(url.searchParams.get('min_created') ?? 0)
    const hi = Number(url.searchParams.get('max_created') ?? Infinity)
    return paged(salesReceipts.filter((r) => r.created_timestamp >= lo && r.created_timestamp <= hi))(url)
  },
  [`GET ${S}/receipts/{id}/transactions`]: page([
    txn(4, { receipt_id: 9105, listing_id: 503, title: 'Euro thing', price: money(700, 'EUR'), quantity: 1, created_timestamp: T0 - 86_400 * 10 })
  ])
}

const callOf = (fetch: { calls: Array<{ url: URL; method: string }> }, method: string, path: string) =>
  fetch.calls.find((c) => c.method === method && c.url.pathname === path)!
const query = (c: { url: URL }) => Object.fromEntries(c.url.searchParams)

// ------------------------------------------------------------------- actions

describe('orders feature — actions', () => {
  it('list: getShopReceipts with the OAS query; orders mapped (entities decoded, totals, item count)', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const p = (await runAction(ordersFeature, 'list', {}, ctx)) as any
    const c = callOf(fetch, 'GET', `${S}/receipts`)
    expect(query(c)).toEqual({ limit: '25', offset: '0' })
    expect(c.headers.authorization).toBe('Bearer tok')
    expect(p.total).toBe(42)
    expect(p.offset).toBe(0)
    const o = p.orders[0]
    expect(o).toMatchObject({
      receiptId: 9001,
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
      paymentMethod: 'cc',
      messageFromBuyer: 'Please wrap it & see https://www.etsy.com/listing/1',
      itemCount: 3,
      address: { name: 'Olena K', firstLine: 'Main st 1', secondLine: 'apt 2', city: 'Lviv', state: 'Lviv obl', zip: '79000', countryIso: 'UA' }
    })
    expect(o.totals).toEqual({
      grandTotal: { amount: 2600, divisor: 100, currency: 'USD' },
      subtotal: { amount: 1800, divisor: 100, currency: 'USD' },
      itemsTotal: { amount: 2000, divisor: 100, currency: 'USD' },
      shipping: { amount: 300, divisor: 100, currency: 'USD' },
      tax: { amount: 500, divisor: 100, currency: 'USD' },
      vat: { amount: 0, divisor: 100, currency: 'USD' },
      discount: { amount: 200, divisor: 100, currency: 'USD' },
      giftWrap: { amount: 0, divisor: 100, currency: 'USD' }
    })
    expect(o.items[0]).toEqual({
      transactionId: 1,
      receiptId: 9001,
      listingId: 501,
      productId: 3,
      title: 'Budget & Bills Planner — Etsy bestseller',
      quantity: 2,
      price: { amount: 1000, divisor: 100, currency: 'USD' },
      shippingCost: { amount: 300, divisor: 100, currency: 'USD' },
      variations: [{ name: 'Колір', value: 'Синій & білий' }],
      sku: 'SKU-1',
      isDigital: false,
      createdAt: T0 + 1,
      paidAt: T0 + 11,
      shippedAt: null,
      expectedShipDate: T0 + 500_000,
      shippingMethod: 'Standard',
      shippingUpgrade: null
    })
    expect(p.orders[1]).toMatchObject({ receiptId: 9002, isPaid: false, itemCount: 5 })
  })

  it('list: every OAS filter is sent under its OAS name', async () => {
    const { ctx, fetch } = featureCtx(routes)
    await runAction(
      ordersFeature,
      'list',
      {
        minCreated: 1_700_000_000,
        maxCreated: 1_760_000_000,
        minLastModified: 1_700_000_001,
        maxLastModified: 1_760_000_001,
        wasPaid: true,
        wasShipped: false,
        wasDelivered: false,
        wasCanceled: true,
        sortOn: 'receipt_id',
        sortOrder: 'asc',
        limit: 100,
        offset: 50
      },
      ctx
    )
    expect(query(callOf(fetch, 'GET', `${S}/receipts`))).toEqual({
      min_created: '1700000000',
      max_created: '1760000000',
      min_last_modified: '1700000001',
      max_last_modified: '1760000001',
      was_paid: 'true',
      was_shipped: 'false',
      was_delivered: 'false',
      was_canceled: 'true',
      sort_on: 'receipt_id',
      sort_order: 'asc',
      limit: '100',
      offset: '50'
    })
  })

  it('list: bad filters are refused before any request', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ minCreated: 100 }, 'не раніше 2000'],
      [{ minCreated: 1_760_000_000, maxCreated: 1_700_000_000 }, 'пізніше за кінець'],
      [{ wasPaid: 'yes' }, 'так/ні'],
      [{ sortOn: 'price' }, 'sortOn'],
      [{ sortOrder: 'sideways' }, 'sortOrder'],
      [{ limit: 101 }, 'від 1 до 100'],
      [{ offset: -1 }, 'offset']
    ]
    for (const [args, msg] of bad) await expect(runAction(ordersFeature, 'list', args, ctx)).rejects.toThrow(msg)
    expect(fetch.calls).toHaveLength(0)
  })

  it('signed out / without transactions_r / transactions_w: refused, no request', async () => {
    const out = featureCtx(routes, { status: signedOut })
    await expect(runAction(ordersFeature, 'list', {}, out.ctx)).rejects.toThrow('Увійдіть в Etsy')
    const noRead = featureCtx(routes, { status: signedIn({ scopes: ['listings_r'] }) })
    await expect(runAction(ordersFeature, 'get', { receiptId: 1 }, noRead.ctx)).rejects.toThrow('замовлення й фінанси')
    const noWrite = featureCtx(routes, { status: signedIn({ scopes: ['transactions_r'] }) })
    await expect(runAction(ordersFeature, 'ship', { receiptId: 1 }, noWrite.ctx)).rejects.toThrow('позначення замовлень відправленими')
    await expect(runAction(ordersFeature, 'update', { receiptId: 1, wasPaid: true }, noWrite.ctx)).rejects.toThrow('позначення замовлень')
    expect(out.fetch.calls.length + noRead.fetch.calls.length + noWrite.fetch.calls.length).toBe(0)
  })

  it('get: getShopReceipt with its transactions; bad id refused', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const o = (await runAction(ordersFeature, 'get', { receiptId: 9001 }, ctx)) as any
    expect(callOf(fetch, 'GET', `${S}/receipts/9001`)).toBeTruthy()
    expect(o.items.map((i: any) => i.transactionId)).toEqual([1, 2])
    expect(fetch.calls).toHaveLength(1)
    await expect(runAction(ordersFeature, 'get', { receiptId: 0 }, ctx)).rejects.toThrow('Некоректний receiptId')
  })

  it('get: a receipt without transactions → getShopReceiptTransactionsByReceipt', async () => {
    const { ctx, fetch } = featureCtx({ ...routes, [`GET ${S}/receipts/{id}`]: { body: receipt(9003, { transactions: undefined }) } })
    const o = (await runAction(ordersFeature, 'get', { receiptId: 9003 }, ctx)) as any
    expect(callOf(fetch, 'GET', `${S}/receipts/9003/transactions`)).toBeTruthy()
    expect(o.items.map((i: any) => i.transactionId)).toEqual([7])
    expect(o.itemCount).toBe(2)
  })

  it('get: Etsy 404 / 500 come back as their Ukrainian errors', async () => {
    const nf = featureCtx({ [`GET ${S}/receipts/{id}`]: { status: 404, body: { error: 'Receipt not found' } } })
    await expect(runAction(ordersFeature, 'get', { receiptId: 5 }, nf.ctx)).rejects.toThrow('HTTP 404')
    const se = featureCtx({ [`GET ${S}/receipts/{id}`]: { status: 500 } })
    await expect(runAction(ordersFeature, 'get', { receiptId: 5 }, se.ctx)).rejects.toThrow('HTTP 500')
  })

  it('update: updateShopReceipt = PUT form was_shipped / was_paid; empty patch refused', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const o = (await runAction(ordersFeature, 'update', { receiptId: 9001, wasShipped: true }, ctx)) as any
    const c = callOf(fetch, 'PUT', `${S}/receipts/9001`) as any
    expect(c.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(c.body).toBe('was_shipped=true')
    expect(o.isShipped).toBe(true)
    await runAction(ordersFeature, 'update', { receiptId: 9001, wasShipped: false, wasPaid: true }, ctx)
    expect(fetch.calls.at(-1)!.body).toBe('was_shipped=false&was_paid=true')
    await expect(runAction(ordersFeature, 'update', { receiptId: 9001 }, ctx)).rejects.toThrow('Нічого не змінено.')
    await expect(runAction(ordersFeature, 'update', { receiptId: 9001, wasPaid: 1 }, ctx)).rejects.toThrow('так/ні')
  })

  it('update / ship: an answer without transactions keeps the items (by-receipt call); an empty answer re-reads the order', async () => {
    const bare = featureCtx({
      ...routes,
      [`PUT ${S}/receipts/{id}`]: { body: receipt(9001, { is_shipped: true, transactions: [] }) },
      [`POST ${S}/receipts/{id}/tracking`]: { body: receipt(9001, { is_shipped: true, transactions: undefined }) }
    })
    const u = (await runAction(ordersFeature, 'update', { receiptId: 9001, wasShipped: true }, bare.ctx)) as any
    expect(bare.fetch.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([`PUT ${S}/receipts/9001`, `GET ${S}/receipts/9001/transactions`])
    expect(u).toMatchObject({ receiptId: 9001, isShipped: true, itemCount: 2 })
    expect(u.items.map((i: any) => i.transactionId)).toEqual([7])
    const sh = (await runAction(ordersFeature, 'ship', { receiptId: 9001 }, bare.ctx)) as any
    expect(sh.items.map((i: any) => i.transactionId)).toEqual([7])

    const empty = featureCtx({ ...routes, [`PUT ${S}/receipts/{id}`]: { status: 200 }, [`POST ${S}/receipts/{id}/tracking`]: { status: 200 } })
    const e = (await runAction(ordersFeature, 'update', { receiptId: 9001, wasPaid: true }, empty.ctx)) as any
    expect(empty.fetch.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([`PUT ${S}/receipts/9001`, `GET ${S}/receipts/9001`])
    expect(e).toMatchObject({ receiptId: 9001, itemCount: 3 })
    const es = (await runAction(ordersFeature, 'ship', { receiptId: 9001 }, empty.ctx)) as any
    expect(empty.fetch.calls.at(-1)!.url.pathname).toBe(`${S}/receipts/9001`)
    expect(es.receiptId).toBe(9001)
  })

  it('ship: createReceiptShipment = POST JSON tracking_code / carrier_name / send_bcc / note_to_buyer', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const o = (await runAction(
      ordersFeature,
      'ship',
      { receiptId: 9001, carrier: ' ukrposhta ', trackingCode: 'RR123UA', noteToBuyer: 'Дякую!', sendBcc: true },
      ctx
    )) as any
    const c = callOf(fetch, 'POST', `${S}/receipts/9001/tracking`) as any
    expect(c.headers['content-type']).toBe('application/json')
    expect(JSON.parse(c.body)).toEqual({ tracking_code: 'RR123UA', carrier_name: 'ukrposhta', send_bcc: true, note_to_buyer: 'Дякую!' })
    expect(o.isShipped).toBe(true)
    expect(o.shipments).toEqual([{ id: 3, carrier: 'ukrposhta', trackingCode: 'RR123UA', notifiedAt: T0 + 9 }])
  })

  it('ship: no carrier and no tracking = just "shipped" (empty JSON); one of them alone is refused', async () => {
    const { ctx, fetch } = featureCtx(routes)
    await runAction(ordersFeature, 'ship', { receiptId: 9001 }, ctx)
    expect(fetch.calls[0].body).toBe('{}')
    await expect(runAction(ordersFeature, 'ship', { receiptId: 9001, carrier: 'usps' }, ctx)).rejects.toThrow('і перевізника, і трек-номер')
    await expect(runAction(ordersFeature, 'ship', { receiptId: 9001, trackingCode: 'X', carrier: '  ' }, ctx)).rejects.toThrow('і перевізника')
    await expect(runAction(ordersFeature, 'ship', { receiptId: 9001, carrier: 'x'.repeat(256), trackingCode: 'X' }, ctx)).rejects.toThrow('довше за 255')
    expect(fetch.calls).toHaveLength(1)
  })

  it('ship: Etsy 409 / 403 (partner-only) → clear refusals; a 500 is not retried (POST)', async () => {
    const conflict = featureCtx({ [`POST ${S}/receipts/{id}/tracking`]: { status: 409, body: { error: 'Tracking already submitted' } } })
    await expect(runAction(ordersFeature, 'ship', { receiptId: 1, carrier: 'usps', trackingCode: '1Z' }, conflict.ctx)).rejects.toThrow(
      'Etsy відхилив відправлення (HTTP 409): Tracking already submitted.'
    )
    const partner = featureCtx({ [`POST ${S}/receipts/{id}/tracking`]: { status: 403, body: { error: 'Forbidden' } } })
    const refused = runAction(ordersFeature, 'ship', { receiptId: 1, carrier: 'usps', trackingCode: '1Z' }, partner.ctx)
    await expect(refused).rejects.toThrow('Preferred Partner Program')
    await expect(refused).rejects.toThrow('«Відправлено без трек-номера»')
    const server = featureCtx({ [`POST ${S}/receipts/{id}/tracking`]: { status: 500 } })
    await expect(runAction(ordersFeature, 'ship', { receiptId: 1, carrier: 'usps', trackingCode: '1Z' }, server.ctx)).rejects.toThrow('HTTP 500')
    expect(server.fetch.calls).toHaveLength(1)
  })

  it('listings: getListingsByShopReceipt (limit 100) → MyListing rows', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const l = (await runAction(ordersFeature, 'listings', { receiptId: 9001 }, ctx)) as any
    expect(query(callOf(fetch, 'GET', `${S}/receipts/9001/listings`))).toEqual({ limit: '100' })
    expect(l[0]).toMatchObject({ listingId: 501, title: 'Budget & Planner', state: 'active', quantity: 4, priceAmount: 1000, currency: 'USD' })
  })

  it('payments: getShopPaymentByReceiptId → payments with refunds (pennies in their currencies)', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const p = (await runAction(ordersFeature, 'payments', { receiptId: 9001 }, ctx)) as any
    expect(callOf(fetch, 'GET', `${S}/receipts/9001/payments`)).toBeTruthy()
    expect(p[0]).toMatchObject({
      paymentId: 61,
      receiptId: 9001,
      status: 'settled',
      currency: 'USD',
      buyerCurrency: 'UAH',
      gross: { amount: 2600, divisor: 100, currency: 'USD' },
      net: { amount: 2490, divisor: 100, currency: 'USD' },
      adjustedNet: null
    })
    expect(p[0].adjustments[0]).toEqual({
      id: 31,
      status: 'COMPLETED',
      isSuccess: true,
      reason: 'Etsy dispute',
      amount: { amount: 500, divisor: 100, currency: 'USD' },
      shopAmount: { amount: 500, divisor: 100, currency: 'USD' },
      buyerAmount: { amount: 20000, divisor: 100, currency: 'UAH' },
      feeAmount: { amount: 20, divisor: 100, currency: 'USD' },
      createdAt: T0 + 5,
      items: [{ id: 41, type: 'refund', amount: { amount: 500, divisor: 100, currency: 'USD' }, shopAmount: { amount: 500, divisor: 100, currency: 'USD' }, transactionId: 1, createdAt: T0 + 5 }]
    })
  })

  it('ledger: getShopPaymentAccountLedgerEntries with the required range; totals per type; newest first', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const l = (await runAction(ordersFeature, 'ledger', { minCreated: 1_759_000_000, maxCreated: 1_761_000_000 }, ctx)) as any
    expect(query(callOf(fetch, 'GET', `${S}/payment-account/ledger-entries`))).toEqual({
      min_created: '1759000000',
      max_created: '1761000000',
      limit: '100',
      offset: '0'
    })
    expect(l.total).toBe(3)
    expect(l.truncated).toBe(false)
    expect(l.entries.map((e: any) => e.entryId)).toEqual([72, 71, 70])
    expect(l.entries[2]).toMatchObject({
      entryId: 70,
      amount: { amount: 2490, divisor: 100, currency: 'USD' },
      balance: { amount: 10070, divisor: 100, currency: 'USD' },
      description: 'Payment from Etsy order',
      type: 'PAYMENT',
      referenceType: 'receipt',
      referenceId: '9001',
      parentEntryId: null,
      createdAt: T0 + 70
    })
    expect(l.entries[1].parentEntryId).toBe(70)
    expect(l.totals).toEqual([
      { type: 'transaction', count: 2, sum: { amount: -50, divisor: 100, currency: 'USD' } },
      { type: 'PAYMENT', count: 1, sum: { amount: 2490, divisor: 100, currency: 'USD' } }
    ])
  })

  it('ledger: pages through the range (offset += 100) and stops at 20 pages (truncated)', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => entry(i + 1))
    const two = featureCtx({ [`GET ${S}/payment-account/ledger-entries`]: paged(rows) })
    const l = (await runAction(ordersFeature, 'ledger', { minCreated: 1_759_000_000, maxCreated: 1_761_000_000 }, two.ctx)) as any
    expect(two.fetch.calls.map((c) => c.url.searchParams.get('offset'))).toEqual(['0', '100'])
    expect(l.entries).toHaveLength(150)
    expect(l.totals).toEqual([{ type: 'PAYMENT', count: 150, sum: { amount: 2490 * 150, divisor: 100, currency: 'USD' } }])

    const many = featureCtx({ [`GET ${S}/payment-account/ledger-entries`]: () => page(Array.from({ length: 100 }, (_, i) => entry(i + 1)), 5000) })
    const m = (await runAction(ordersFeature, 'ledger', { minCreated: 1_759_000_000, maxCreated: 1_761_000_000 }, many.ctx)) as any
    expect(many.fetch.calls).toHaveLength(20)
    expect(m.truncated).toBe(true)
    expect(m.total).toBe(5000)
  })

  it('ledger: amounts are minor units of the entry currency (JPY has none)', async () => {
    const { ctx } = featureCtx({
      [`GET ${S}/payment-account/ledger-entries`]: page([entry(80, { currency: 'JPY', amount: 1500, balance: 90000 }), entry(81, { currency: 'XYZ1', amount: 5 })])
    })
    const l = (await runAction(ordersFeature, 'ledger', { minCreated: 1_759_000_000, maxCreated: 1_761_000_000 }, ctx)) as any
    expect(l.entries[1]).toMatchObject({ amount: { amount: 1500, divisor: 1, currency: 'JPY' }, balance: { amount: 90000, divisor: 1, currency: 'JPY' } })
    expect(l.entries[0].amount).toEqual({ amount: 5, divisor: 100, currency: 'XYZ1' })
    expect(l.totals).toContainEqual({ type: 'PAYMENT', count: 1, sum: { amount: 1500, divisor: 1, currency: 'JPY' } })
  })

  it('ledger: both bounds required, in order', async () => {
    const { ctx, fetch } = featureCtx(routes)
    await expect(runAction(ordersFeature, 'ledger', { minCreated: 1_759_000_000 }, ctx)).rejects.toThrow('Вкажіть період')
    await expect(runAction(ordersFeature, 'ledger', { minCreated: 1_761_000_000, maxCreated: 1_759_000_000 }, ctx)).rejects.toThrow('пізніше')
    expect(fetch.calls).toHaveLength(0)
  })

  it('ledgerEntry / ledgerPayments / sale: their single-object endpoints', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const e = (await runAction(ordersFeature, 'ledgerEntry', { entryId: 70 }, ctx)) as any
    expect(callOf(fetch, 'GET', `${S}/payment-account/ledger-entries/70`)).toBeTruthy()
    expect(e).toMatchObject({ entryId: 70, parentEntryId: 69 })

    const p = (await runAction(ordersFeature, 'ledgerPayments', { entryId: 70 }, ctx)) as any
    expect(query(callOf(fetch, 'GET', `${S}/payment-account/ledger-entries/payments`))).toEqual({ ledger_entry_ids: '70' })
    expect(p.map((x: any) => x.paymentId)).toEqual([61])

    const t = (await runAction(ordersFeature, 'sale', { transactionId: 1 }, ctx)) as any
    expect(callOf(fetch, 'GET', `${S}/transactions/1`)).toBeTruthy()
    expect(t).toMatchObject({ transactionId: 1, title: 'Budget & Bills Planner — Etsy bestseller', quantity: 2 })
    await expect(runAction(ordersFeature, 'sale', { transactionId: 'x' }, ctx)).rejects.toThrow('Некоректний transactionId')
  })

  it('listingSales: getShopReceiptTransactionsByListing, every page; units, revenue, newest first', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const s = (await runAction(ordersFeature, 'listingSales', { listingId: 501 }, ctx)) as any
    expect(query(callOf(fetch, 'GET', `${S}/listings/501/transactions`))).toEqual({ limit: '100', offset: '0' })
    expect(s).toMatchObject({
      listingId: 501,
      total: 3,
      scanned: 3,
      truncated: false,
      sales: 3,
      quantity: 7,
      revenue: [{ amount: 7000, divisor: 100, currency: 'USD' }],
      lastSaleAt: T0 + 86_400 * 5
    })
    expect(s.recent.map((t: any) => t.transactionId)).toEqual([3, 1, 5])
  })

  it('sales: the period\'s orders (newest first, no canceled), fully refunded left out, grouped per listing', async () => {
    const { ctx, fetch } = featureCtx({ ...routes, ...salesRoutes })
    const all = (await runAction(ordersFeature, 'sales', {}, ctx)) as any
    expect(query(callOf(fetch, 'GET', `${S}/receipts`))).toEqual({ was_canceled: 'false', sort_on: 'created', sort_order: 'desc', limit: '100', offset: '0' })
    expect(callOf(fetch, 'GET', `${S}/receipts/9105/transactions`)).toBeTruthy()
    expect(fetch.calls.some((c) => c.url.pathname === `${S}/transactions`)).toBe(false)
    expect(all).toMatchObject({ ordersRead: 5, ordersTotal: 5, excludedOrders: 1, truncated: false, sales: 4, quantity: 7 })
    expect(all.revenue).toEqual([
      { amount: 5500, divisor: 100, currency: 'USD' },
      { amount: 700, divisor: 100, currency: 'EUR' }
    ])
    expect(all.products.map((p: any) => [p.listingId, p.sales, p.quantity])).toEqual([
      [501, 2, 5],
      [503, 1, 1],
      [502, 1, 1]
    ])
    const ranged = (await runAction(ordersFeature, 'sales', { minCreated: T0, maxCreated: T0 + 86_400 * 4 }, ctx)) as any
    expect(query(fetch.calls.filter((c) => c.url.pathname === `${S}/receipts`).at(-1)!)).toEqual({
      min_created: String(T0),
      max_created: String(T0 + 86_400 * 4),
      was_canceled: 'false',
      sort_on: 'created',
      sort_order: 'desc',
      limit: '100',
      offset: '0'
    })
    expect(ranged).toMatchObject({ ordersRead: 3, excludedOrders: 1 })
    expect(ranged.products.map((p: any) => [p.listingId, p.quantity])).toEqual([
      [501, 2],
      [502, 1]
    ])
    await expect(runAction(ordersFeature, 'sales', { minCreated: T0 + 10, maxCreated: T0 }, ctx)).rejects.toThrow('пізніше')
  })

  it('sales: more orders than 20 pages → the newest 2000 read, truncated', async () => {
    const many = featureCtx({ [`GET ${S}/receipts`]: () => page(Array.from({ length: 100 }, (_, i) => receipt(i + 1)), 5000) })
    const s = (await runAction(ordersFeature, 'sales', {}, many.ctx)) as any
    expect(many.fetch.calls).toHaveLength(20)
    expect(many.fetch.calls.map((c) => c.url.searchParams.get('offset')).slice(0, 2)).toEqual(['0', '100'])
    expect(s).toMatchObject({ ordersRead: 2000, ordersTotal: 5000, truncated: true })
  })

  it('sales / listingSales: signed out and Etsy errors', async () => {
    const out = featureCtx(salesRoutes, { status: signedOut })
    await expect(runAction(ordersFeature, 'sales', {}, out.ctx)).rejects.toThrow('Увійдіть в Etsy')
    expect(out.fetch.calls).toHaveLength(0)
    const se = featureCtx({ [`GET ${S}/receipts`]: { status: 500 } })
    await expect(runAction(ordersFeature, 'sales', {}, se.ctx)).rejects.toThrow('HTTP 500')
    const nf = featureCtx({ [`GET ${S}/listings/{id}/transactions`]: { status: 404, body: { error: 'Listing not found' } } })
    await expect(runAction(ordersFeature, 'listingSales', { listingId: 5 }, nf.ctx)).rejects.toThrow('HTTP 404')
  })
})

// ----------------------------------------------------------------------- MCP

describe('orders feature — MCP tools', () => {
  it('the tools match ORDERS_TOOL_SUMMARY (names, order, write flags); closed schemas', () => {
    const tools = ordersFeature.mcpTools!(mcpDeps(routes).deps)
    expect(tools.map((t) => t.name)).toEqual(ORDERS_TOOL_SUMMARY.map((t) => t.name))
    for (const t of tools) {
      const s = ORDERS_TOOL_SUMMARY.find((x) => x.name === t.name)!
      expect(t.readOnly === false).toBe(!!s.write)
      if (s.write) expect(t.destructive).toBe(true)
      expect(t.inputSchema.additionalProperties).toBe(false)
    }
  })

  it('list_my_orders: filters → the OAS query (UTC days); no email / street by default', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const r = await callTool(ordersFeature, deps, 'list_my_orders', {
      created_from: '2026-10-01',
      created_to: '2026-10-02',
      modified_from: '2026-10-01T12:00:00Z',
      paid: true,
      shipped: false,
      delivered: true,
      canceled: false,
      sort_by: 'order_id',
      sort_order: 'asc',
      limit: 10,
      offset: 20
    })
    expect(r.isError).toBe(false)
    expect(query(callOf(fetch, 'GET', `${S}/receipts`))).toEqual({
      min_created: String(Date.UTC(2026, 9, 1) / 1000),
      max_created: String(Date.UTC(2026, 9, 3) / 1000 - 1),
      min_last_modified: String(Date.UTC(2026, 9, 1, 12) / 1000),
      was_paid: 'true',
      was_shipped: 'false',
      was_delivered: 'true',
      was_canceled: 'false',
      sort_on: 'receipt_id',
      sort_order: 'asc',
      limit: '10',
      offset: '20'
    })
    expect(r.json).toMatchObject({ total: 42, offset: 20, count: 2 })
    expect(r.json.orders[0]).toEqual({
      id: 9001,
      created_at: new Date(T0 * 1000).toISOString(),
      updated_at: new Date((T0 + 100) * 1000).toISOString(),
      status: 'paid',
      paid: true,
      shipped: false,
      canceled: false,
      gift: true,
      item_count: 3,
      totals: {
        grand_total: { value: 26, currency: 'USD' },
        subtotal: { value: 18, currency: 'USD' },
        items_total: { value: 20, currency: 'USD' },
        shipping: { value: 3, currency: 'USD' },
        tax: { value: 5, currency: 'USD' },
        vat: { value: 0, currency: 'USD' },
        discount: { value: 2, currency: 'USD' },
        gift_wrap: { value: 0, currency: 'USD' }
      },
      buyer_name: 'Olena K',
      city: 'Lviv',
      country: 'UA'
    })
    expect(r.text).not.toContain('buyer@example.com')
    expect(r.text).not.toContain('Main st')
  })

  it('list_my_orders / get_my_order: include_shipping_address adds email and the full address', async () => {
    const { deps } = mcpDeps(routes)
    const l = await callTool(ordersFeature, deps, 'list_my_orders', { include_shipping_address: true })
    expect(l.json.orders[0].buyer_email).toBe('buyer@example.com')
    expect(l.json.orders[0].shipping_address).toMatchObject({ line1: 'Main st 1', line2: 'apt 2', zip: '79000', city: 'Lviv', country: 'UA' })
    const g = await callTool(ordersFeature, deps, 'get_my_order', { order_id: 9001, include_shipping_address: true })
    expect(g.json.shipping_address.formatted).toContain('Main st 1')
  })

  it('list_my_orders: bad dates / reversed range → tool errors, no request', async () => {
    const { deps, fetch } = mcpDeps(routes)
    expect((await callTool(ordersFeature, deps, 'list_my_orders', { created_from: 'yesterday' })).text).toContain('must be a date')
    expect((await callTool(ordersFeature, deps, 'list_my_orders', { created_from: '1999-12-31' })).text).toContain('2000-01-01')
    const rev = await callTool(ordersFeature, deps, 'list_my_orders', { created_from: '2026-10-05', created_to: '2026-10-01' })
    expect(rev.isError).toBe(true)
    expect(rev.text).toContain('must not be after')
    expect((await callTool(ordersFeature, deps, 'list_my_orders', { limit: 101 })).isError).toBe(true)
    expect(fetch.calls).toHaveLength(0)
  })

  it('get_my_order: items, totals, messages (as Etsy has them), gift, shipments, refunds; no address by default', async () => {
    const withRefund = {
      ...routes,
      [`GET ${S}/receipts/{id}`]: {
        body: receipt(9001, {
          shipments: [{ receipt_shipping_id: 3, shipment_notification_timestamp: T0 + 9, carrier_name: 'usps', tracking_code: '1Z' }],
          refunds: [{ amount: money(500), created_timestamp: T0 + 20, reason: 'damaged', note_from_issuer: 'sorry', status: 'complete' }]
        })
      }
    }
    const { deps, fetch } = mcpDeps(withRefund)
    const r = await callTool(ordersFeature, deps, 'get_my_order', { order_id: 9001 })
    expect(callOf(fetch, 'GET', `${S}/receipts/9001`)).toBeTruthy()
    expect(r.json).toMatchObject({
      id: 9001,
      payment_method: 'cc',
      buyer_message: 'Please wrap it & see https://www.etsy.com/listing/1',
      gift_message: 'Happy birthday!',
      gift_sender: 'Ira',
      shipments: [{ carrier: 'usps', tracking_code: '1Z', buyer_notified_at: new Date((T0 + 9) * 1000).toISOString() }],
      refunds: [{ amount: { value: 5, currency: 'USD' }, reason: 'damaged', note: 'sorry', status: 'complete' }]
    })
    expect(r.json.items[0]).toMatchObject({
      sale_id: 1,
      order_id: 9001,
      product_id: 501,
      title: 'Budget & Bills Planner — Etsy bestseller',
      quantity: 2,
      unit_price: { value: 10, currency: 'USD' },
      variations: [{ name: 'Колір', value: 'Синій & білий' }]
    })
    expect(r.json.buyer_email).toBeUndefined()
    expect(r.json.shipping_address).toBeUndefined()
  })

  it('reads: signed out → the sign-in note; no transactions_r → the permission note; Etsy errors with Etsy\'s detail', async () => {
    const out = await callTool(ordersFeature, mcpDeps(routes, { status: signedOut }).deps, 'list_my_orders')
    expect(out.isError).toBe(true)
    expect(out.text).toBe(NOT_SIGNED_IN)
    const noScope = await callTool(ordersFeature, mcpDeps(routes, { status: signedIn({ scopes: ['listings_r'] }) }).deps, 'get_my_order', { order_id: 1 })
    expect(noScope.isError).toBe(true)
    expect(noScope.text).toContain('(transactions_r)')
    const nf = await callTool(ordersFeature, mcpDeps({ [`GET ${S}/receipts/{id}`]: { status: 404, body: { error: 'Etsy receipt 5 not found' } } }).deps, 'get_my_order', {
      order_id: 5
    })
    expect(nf.text).toBe('Not found on Etsy (HTTP 404): Etsy receipt 5 not found.')
    const se = await callTool(ordersFeature, mcpDeps({ [`GET ${S}/receipts`]: { status: 503 } }).deps, 'list_my_orders')
    expect(se.isError).toBe(true)
    expect(se.text).toContain('HTTP 503')
  })

  it('mark_my_order_shipped: POST JSON; returns the shipped order', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const r = await callTool(ordersFeature, deps, 'mark_my_order_shipped', {
      order_id: 9001,
      carrier: 'ukrposhta',
      tracking_code: ' RR123UA ',
      note_to_buyer: 'Дякую',
      send_copy_to_me: false
    })
    expect(r.isError).toBe(false)
    const c = callOf(fetch, 'POST', `${S}/receipts/9001/tracking`) as any
    expect(JSON.parse(c.body)).toEqual({ tracking_code: 'RR123UA', carrier_name: 'ukrposhta', send_bcc: false, note_to_buyer: 'Дякую' })
    expect(r.json.shipped).toBe(true)
    expect(r.json.order).toMatchObject({ id: 9001, shipped: true, shipments: [{ carrier: 'ukrposhta', tracking_code: 'RR123UA' }] })
    expect(r.json.order.buyer_email).toBeUndefined()
  })

  it('mark_my_order_shipped: writes off / no transactions_w / signed out / blank / missing / 409 → errors', async () => {
    const args = { order_id: 9001, carrier: 'usps', tracking_code: '1Z' }
    const off = mcpDeps(routes, { writes: false })
    expect((await callTool(ordersFeature, off.deps, 'mark_my_order_shipped', args)).text).toBe(WRITES_OFF)
    const noW = mcpDeps(routes, { status: signedIn({ scopes: ['transactions_r'] }) })
    expect((await callTool(ordersFeature, noW.deps, 'mark_my_order_shipped', args)).text).toContain('(transactions_w)')
    const out = mcpDeps(routes, { status: signedOut })
    expect((await callTool(ordersFeature, out.deps, 'mark_my_order_shipped', args)).text).toBe(NOT_SIGNED_IN)
    const ok = mcpDeps(routes)
    expect((await callTool(ordersFeature, ok.deps, 'mark_my_order_shipped', { ...args, carrier: '   ' })).text).toContain('must not be blank')
    expect((await callTool(ordersFeature, ok.deps, 'mark_my_order_shipped', { order_id: 9001, carrier: 'usps' })).text).toContain(
      'Missing required argument "tracking_code"'
    )
    expect(off.fetch.calls.length + noW.fetch.calls.length + out.fetch.calls.length + ok.fetch.calls.length).toBe(0)
    const conflict = mcpDeps({ [`POST ${S}/receipts/{id}/tracking`]: { status: 409, body: { error: 'Etsy says: already shipped' } } })
    const c = await callTool(ordersFeature, conflict.deps, 'mark_my_order_shipped', args)
    expect(c.isError).toBe(true)
    expect(c.text).toBe('Etsy refused to record this shipment (HTTP 409): Etsy says: already shipped.')
    const partner = mcpDeps({ [`POST ${S}/receipts/{id}/tracking`]: { status: 403, body: { error: 'Forbidden' } } })
    const f = await callTool(ordersFeature, partner.deps, 'mark_my_order_shipped', args)
    expect(f.isError).toBe(true)
    expect(f.text).toContain('HTTP 403')
    expect(f.text).toContain('only approved fulfillment-partner apps')
    expect(f.text).toContain('update_my_order (shipped: true)')
    expect(f.text).toMatch(/^Etsy refused to record this shipment \(HTTP 403\)/)
    expect(f.text).toContain('Shop Manager')
  })

  it('update_my_order: PUT form was_paid / was_shipped; needs a flag; writes off refused', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const r = await callTool(ordersFeature, deps, 'update_my_order', { order_id: 9001, paid: false, shipped: true })
    expect(r.isError).toBe(false)
    const c = callOf(fetch, 'PUT', `${S}/receipts/9001`) as any
    expect(c.body).toBe('was_shipped=true&was_paid=false')
    expect(r.json).toMatchObject({ updated: true, order: { id: 9001, shipped: true } })
    expect((await callTool(ordersFeature, deps, 'update_my_order', { order_id: 9001 })).text).toContain('Give "paid" and/or "shipped"')
    const off = mcpDeps(routes, { writes: false })
    expect((await callTool(ordersFeature, off.deps, 'update_my_order', { order_id: 1, paid: true })).isError).toBe(true)
    expect(off.fetch.calls).toHaveLength(0)
  })

  it('list_my_sales: per product from the period\'s orders; product_id filters the same orders', async () => {
    const { deps, fetch } = mcpDeps({ ...routes, ...salesRoutes })
    const r = await callTool(ordersFeature, deps, 'list_my_sales', { from: '2025-09-01', limit: 2 })
    expect(r.isError).toBe(false)
    expect(query(callOf(fetch, 'GET', `${S}/receipts`))).toEqual({
      min_created: String(Date.UTC(2025, 8, 1) / 1000),
      was_canceled: 'false',
      sort_on: 'created',
      sort_order: 'desc',
      limit: '100',
      offset: '0'
    })
    expect(r.json).toMatchObject({
      from: '2025-09-01T00:00:00.000Z',
      to: null,
      orders_read: 5,
      orders_total: 5,
      excluded_orders: 1,
      partial: false,
      sales: 4,
      units: 7
    })
    expect(r.json.revenue).toEqual([
      { value: 55, currency: 'USD' },
      { value: 7, currency: 'EUR' }
    ])
    expect(r.json.products).toHaveLength(2)
    expect(r.json.products[0]).toEqual({
      product_id: 501,
      title: 'Budget & Bills Planner — Etsy bestseller',
      sales: 2,
      units: 5,
      revenue: [{ value: 50, currency: 'USD' }],
      last_sale_at: new Date((T0 + 86_400 * 5) * 1000).toISOString()
    })

    const one = mcpDeps({ ...routes, ...salesRoutes })
    const p = await callTool(ordersFeature, one.deps, 'list_my_sales', { product_id: 501, from: '2025-10-09' })
    expect(callOf(one.fetch, 'GET', `${S}/receipts`)).toBeTruthy()
    expect(one.fetch.calls.some((c) => c.url.pathname.includes('/listings/'))).toBe(false)
    expect(p.json).toMatchObject({ sales: 2, units: 5, products: [{ product_id: 501, sales: 2, units: 5 }] })

    const none = await callTool(ordersFeature, mcpDeps({ ...routes, ...salesRoutes }).deps, 'list_my_sales', { product_id: 501, from: '2030-01-01' })
    expect(none.json).toMatchObject({ sales: 0, orders_read: 0, products: [] })
  })

  it('get_my_product_sales / get_my_sale', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const r = await callTool(ordersFeature, deps, 'get_my_product_sales', { product_id: 501, recent: 2 })
    expect(query(callOf(fetch, 'GET', `${S}/listings/501/transactions`))).toEqual({ limit: '100', offset: '0' })
    expect(r.json).toMatchObject({ product_id: 501, total_sales: 3, units: 7, revenue: [{ value: 70, currency: 'USD' }], partial: false })
    expect(r.json.recent.map((s: any) => s.sale_id)).toEqual([3, 1])
    const s = await callTool(ordersFeature, deps, 'get_my_sale', { sale_id: 1 })
    expect(callOf(fetch, 'GET', `${S}/transactions/1`)).toBeTruthy()
    expect(s.json).toMatchObject({ sale_id: 1, order_id: 9001, quantity: 2, shipping_method: 'Standard', sku: 'SKU-1' })
  })

  it('browse_my_sales: one page of getShopReceiptTransactionsByShop; signed out / errors', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const r = await callTool(ordersFeature, deps, 'browse_my_sales', { limit: 2, offset: 1 })
    expect(query(callOf(fetch, 'GET', `${S}/transactions`))).toEqual({ limit: '2', offset: '1' })
    expect(r.json).toMatchObject({ total: 4, offset: 1, count: 2 })
    expect(r.json.sales.map((x: any) => x.sale_id)).toEqual([2, 3])
    expect(r.json.sales[0]).toMatchObject({ product_id: 502, title: 'Habit tracker', unit_price: { value: 5, currency: 'USD' } })
    await callTool(ordersFeature, deps, 'browse_my_sales')
    expect(query(fetch.calls.at(-1)!)).toEqual({ limit: '25', offset: '0' })
    expect((await callTool(ordersFeature, deps, 'browse_my_sales', { limit: 101 })).isError).toBe(true)
    const out = mcpDeps(routes, { status: signedOut })
    expect((await callTool(ordersFeature, out.deps, 'browse_my_sales')).text).toBe(NOT_SIGNED_IN)
    expect(out.fetch.calls).toHaveLength(0)
    const se = await callTool(ordersFeature, mcpDeps({ [`GET ${S}/transactions`]: { status: 500 } }).deps, 'browse_my_sales')
    expect(se.isError).toBe(true)
    expect(se.text).toContain('HTTP 500')
  })

  it('list_my_ledger: the range (required) → entries + totals; amounts as decimals', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const r = await callTool(ordersFeature, deps, 'list_my_ledger', { from: '2025-10-01', to: '2025-10-31', limit: 1 })
    expect(query(callOf(fetch, 'GET', `${S}/payment-account/ledger-entries`))).toEqual({
      min_created: String(Date.UTC(2025, 9, 1) / 1000),
      max_created: String(Date.UTC(2025, 10, 1) / 1000 - 1),
      limit: '100',
      offset: '0'
    })
    expect(r.json).toMatchObject({ total: 3, partial: false })
    expect(r.json.totals).toEqual([
      { type: 'transaction', count: 2, sum: { value: -0.5, currency: 'USD' } },
      { type: 'PAYMENT', count: 1, sum: { value: 24.9, currency: 'USD' } }
    ])
    expect(r.json.entries).toEqual([
      {
        entry_id: 72,
        created_at: new Date((T0 + 72) * 1000).toISOString(),
        description: 'Transaction fee',
        type: 'transaction',
        amount: { value: -0.3, currency: 'USD' },
        balance_after: { value: 100.72, currency: 'USD' },
        reference_type: 'transaction',
        reference_id: '2',
        related_entry_id: null,
        refunds: []
      }
    ])
    expect((await callTool(ordersFeature, deps, 'list_my_ledger', { from: '2025-10-01' })).text).toContain('Missing required argument "to"')
  })

  it('get_my_ledger_entry: the entry + its payments (unless include_payments false)', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const r = await callTool(ordersFeature, deps, 'get_my_ledger_entry', { entry_id: 70 })
    expect(r.json).toMatchObject({ entry_id: 70, related_entry_id: 69, description: 'Payment from Etsy order', payments: [{ payment_id: 61 }] })
    expect(query(callOf(fetch, 'GET', `${S}/payment-account/ledger-entries/payments`))).toEqual({ ledger_entry_ids: '70' })
    const n = mcpDeps(routes)
    const r2 = await callTool(ordersFeature, n.deps, 'get_my_ledger_entry', { entry_id: 70, include_payments: false })
    expect(r2.json.payments).toBeUndefined()
    expect(n.fetch.calls).toHaveLength(1)
  })

  it('get_my_payments: by order, by payment ids, by ledger entries; exactly one way', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const byOrder = await callTool(ordersFeature, deps, 'get_my_payments', { order_id: 9001 })
    expect(callOf(fetch, 'GET', `${S}/receipts/9001/payments`)).toBeTruthy()
    expect(byOrder.json.payments[0]).toMatchObject({
      payment_id: 61,
      order_id: 9001,
      gross: { value: 26, currency: 'USD' },
      fees: { value: 1.1, currency: 'USD' },
      net: { value: 24.9, currency: 'USD' },
      adjusted_net: null,
      refunds: [{ id: 31, amount: { value: 5, currency: 'USD' }, buyer_currency_amount: { value: 200, currency: 'UAH' }, reason: 'Etsy dispute' }]
    })
    expect(byOrder.json.payments[0].buyer_user_id).toBeUndefined()

    const byIds = await callTool(ordersFeature, deps, 'get_my_payments', { payment_ids: [61, 62, 61] })
    expect(query(callOf(fetch, 'GET', `${S}/payments`))).toEqual({ payment_ids: '61,62' })
    expect(byIds.json.count).toBe(2)

    await callTool(ordersFeature, deps, 'get_my_payments', { ledger_entry_ids: [70, 71] })
    expect(query(callOf(fetch, 'GET', `${S}/payment-account/ledger-entries/payments`))).toEqual({ ledger_entry_ids: '70,71' })

    const calls = fetch.calls.length
    expect((await callTool(ordersFeature, deps, 'get_my_payments', {})).text).toContain('exactly one')
    expect((await callTool(ordersFeature, deps, 'get_my_payments', { order_id: 1, payment_ids: [1] })).text).toContain('exactly one')
    expect((await callTool(ordersFeature, deps, 'get_my_payments', { payment_ids: [0] })).text).toContain('positive integer ids')
    expect((await callTool(ordersFeature, deps, 'get_my_payments', { payment_ids: [] })).isError).toBe(true)
    expect(fetch.calls.length).toBe(calls)
  })

  it('honesty: Etsy\'s own text reaches the client unchanged; no CDN URL, raw JSON or token in anything sent', async () => {
    const ETSY_TEXT = 'Etsy Star Seller — see https://www.etsy.com/shop/TidyFoxSheets'
    const CDN = 'https://i.etsystatic.com/12345/r/il/abcdef/678_570xN.jpg'
    const TOKEN = 'oauth-access-token-XYZ987'
    // Keys the app never forwards (a CDN image URL, a raw-JSON-like blob) ride along on every object.
    const extra = { image_url_570xN: CDN, url_fullxfull: CDN, raw_json: `{"token":"${TOKEN}"}` }
    const t = (id: number, over: Record<string, unknown> = {}) =>
      txn(id, {
        ...extra,
        title: ETSY_TEXT,
        shipping_method: ETSY_TEXT,
        shipping_upgrade: ETSY_TEXT,
        variations: [{ property_id: 513, value_id: null, formatted_name: ETSY_TEXT, formatted_value: ETSY_TEXT }],
        ...over
      })
    const r = (id: number) =>
      receipt(id, {
        ...extra,
        city: ETSY_TEXT,
        message_from_buyer: ETSY_TEXT,
        message_from_seller: ETSY_TEXT,
        gift_message: ETSY_TEXT,
        gift_sender: ETSY_TEXT,
        transactions: [t(1, { receipt_id: id })],
        shipments: [{ receipt_shipping_id: 3, shipment_notification_timestamp: T0 + 9, carrier_name: ETSY_TEXT, tracking_code: '1Z' }],
        refunds: [{ amount: money(500), created_timestamp: T0 + 20, reason: ETSY_TEXT, note_from_issuer: ETSY_TEXT, status: 'complete' }]
      })
    const pay = (id: number) => {
      const p: any = payment(id, extra)
      p.payment_adjustments[0] = { ...p.payment_adjustments[0], ...extra, reason_code: ETSY_TEXT }
      return p
    }
    const ent = (id: number) => entry(id, { ...extra, description: ETSY_TEXT, ledger_type: ETSY_TEXT })
    const fetch = routedFetch({
      [`GET ${S}/receipts`]: page([r(9001)]),
      [`GET ${S}/receipts/{id}/payments`]: page([pay(61)]),
      [`GET ${S}/receipts/{id}`]: { body: r(9001) },
      [`PUT ${S}/receipts/{id}`]: { body: { ...r(9001), is_shipped: true } },
      [`POST ${S}/receipts/{id}/tracking`]: { body: { ...r(9001), is_shipped: true } },
      [`GET ${S}/payments`]: page([pay(61)]),
      [`GET ${S}/payment-account/ledger-entries/payments`]: page([pay(61)]),
      [`GET ${S}/payment-account/ledger-entries/{id}`]: { body: ent(70) },
      [`GET ${S}/payment-account/ledger-entries`]: page([ent(70)]),
      [`GET ${S}/transactions/{id}`]: { body: t(1) },
      [`GET ${S}/transactions`]: page([t(1)]),
      [`GET ${S}/listings/{id}/transactions`]: page([t(1)])
    })
    const { deps } = mcpDeps({}, { client: testClient(fetch, TOKEN), accessToken: async () => TOKEN })
    const runs: Array<[string, Record<string, unknown>]> = [
      ['list_my_orders', { include_shipping_address: true }],
      ['get_my_order', { order_id: 9001, include_shipping_address: true }],
      ['mark_my_order_shipped', { order_id: 9001, carrier: 'usps', tracking_code: '1Z' }],
      ['update_my_order', { order_id: 9001, shipped: true }],
      ['list_my_sales', {}],
      ['list_my_sales', { product_id: 501 }],
      ['get_my_product_sales', { product_id: 501 }],
      ['get_my_sale', { sale_id: 1 }],
      ['browse_my_sales', {}],
      ['list_my_ledger', { from: '2025-10-01', to: '2025-10-31' }],
      ['get_my_ledger_entry', { entry_id: 70 }],
      ['get_my_payments', { order_id: 9001 }],
      ['get_my_payments', { payment_ids: [61] }],
      ['get_my_payments', { ledger_entry_ids: [70] }]
    ]
    const texts: string[] = []
    for (const [name, args] of runs) {
      const res = await callTool(ordersFeature, deps, name, args)
      expect(res.isError, `${name}: ${res.text}`).toBe(false)
      // (a) every tool hands back some of Etsy's free text, exactly as Etsy wrote it.
      expect(res.text, name).toContain(ETSY_TEXT)
      texts.push(res.text)
    }
    // The token really was used (so not finding it below means something).
    expect(fetch.calls.length).toBeGreaterThan(runs.length - 1)
    expect(fetch.calls.every((c) => c.headers.authorization === `Bearer ${TOKEN}`)).toBe(true)

    const order = (await callTool(ordersFeature, deps, 'get_my_order', { order_id: 9001 })).json
    expect(order).toMatchObject({
      city: ETSY_TEXT,
      buyer_message: ETSY_TEXT,
      seller_message: ETSY_TEXT,
      gift_message: ETSY_TEXT,
      gift_sender: ETSY_TEXT,
      shipments: [{ carrier: ETSY_TEXT }],
      refunds: [{ reason: ETSY_TEXT, note: ETSY_TEXT }]
    })
    expect(order.items[0]).toMatchObject({
      title: ETSY_TEXT,
      shipping_method: ETSY_TEXT,
      shipping_upgrade: ETSY_TEXT,
      variations: [{ name: ETSY_TEXT, value: ETSY_TEXT }]
    })
    const ledgerOut = (await callTool(ordersFeature, deps, 'list_my_ledger', { from: '2025-10-01', to: '2025-10-31' })).json
    expect(ledgerOut.entries[0]).toMatchObject({ description: ETSY_TEXT, type: ETSY_TEXT })
    expect(ledgerOut.totals[0].type).toBe(ETSY_TEXT)
    const pays = (await callTool(ordersFeature, deps, 'get_my_payments', { order_id: 9001 })).json
    expect(pays.payments[0].refunds[0].reason).toBe(ETSY_TEXT)

    // (b) nothing a client gets — tool results or the tool listing — has a CDN URL, raw JSON or a credential.
    for (const tool of ordersFeature.mcpTools!(deps)) texts.push(tool.name, tool.title ?? '', tool.description, JSON.stringify(tool.inputSchema))
    for (const text of texts) {
      expect(text).not.toMatch(/etsystatic\.com/i)
      expect(text).not.toContain('raw_json')
      expect(text).not.toContain(TOKEN)
      expect(text).not.toContain('keystring:secret')
    }
  })
})
