// One order: items, totals, buyer + address, messages, gift, shipments,
// refunds, payment, the order's listings, and the updates (mark shipped with
// tracking → createReceiptShipment; paid/shipped flags → updateShopReceipt).

import { useState } from 'react'
import type { Order, OrderPayment, OrderUpdate } from '@shared/features/orders'
import { orderStatusLabel } from '@shared/features/orders'
import { STATE_LABEL } from '@shared/myShop'
import { isAllowedExternalUrl } from '@shared/externalUrl'
import { formatEtsyDate, formatPrice } from '@shared/format'
import type { MyListing } from '@shared/types'
import { useStore } from '../../store'
import { featureCall } from '../call'
import { LazyDetails } from '../LazyDetails'
import { Alert, Loading, Note, PaymentsList, fmtMoney, useOrders } from './common'

export function OrderBadges({ o }: { o: Order }): JSX.Element {
  return (
    <span className="order-badges">
      {o.status && o.status !== 'paid' && <span className="order-badge">{orderStatusLabel(o.status)}</span>}
      <span className={`order-badge ${o.isPaid ? 'ok' : 'warn'}`}>{o.isPaid ? 'оплачено' : 'не оплачено'}</span>
      <span className={`order-badge ${o.isShipped ? 'ok' : 'warn'}`}>{o.isShipped ? 'відправлено' : 'не відправлено'}</span>
      {o.isGift && <span className="order-badge">🎁 подарунок</span>}
    </span>
  )
}

function addressLines(o: Order): string[] {
  const a = o.address
  if (a.formatted) return a.formatted.split('\n').filter(Boolean)
  return [a.name, a.firstLine, a.secondLine, [a.zip, a.city, a.state].filter(Boolean).join(' '), a.countryIso].filter(
    (x): x is string => !!x
  )
}

function Totals({ o }: { o: Order }): JSX.Element {
  const t = o.totals
  const rows: Array<[string, typeof t.grandTotal]> = [
    ['Товари', t.itemsTotal],
    ['Знижка', t.discount && t.discount.amount ? { ...t.discount, amount: -t.discount.amount } : null],
    ['Підсумок', t.subtotal],
    ['Доставка', t.shipping],
    ['Податок', t.tax && t.tax.amount ? t.tax : null],
    ['ПДВ', t.vat && t.vat.amount ? t.vat : null],
    ['Подарункове пакування', t.giftWrap && t.giftWrap.amount ? t.giftWrap : null]
  ]
  return (
    <dl className="listing-facts" data-testid="order-totals">
      {rows
        .filter(([, m]) => m)
        .map(([label, m]) => (
          <div key={label} className="orders-fact">
            <dt>{label}</dt>
            <dd>{fmtMoney(m)}</dd>
          </div>
        ))}
      <div className="orders-fact orders-grand">
        <dt>Разом</dt>
        <dd>{fmtMoney(t.grandTotal)}</dd>
      </div>
    </dl>
  )
}

function OrderPayments({ receiptId }: { receiptId: number }): JSX.Element {
  const p = useOrders<OrderPayment[]>('payments', { receiptId })
  if (p.error) return <Alert text={p.error} />
  if (!p.value) return <Loading />
  return <PaymentsList payments={p.value} />
}

function OrderListings({ receiptId }: { receiptId: number }): JSX.Element {
  const l = useOrders<MyListing[]>('listings', { receiptId })
  if (l.error) return <Alert text={l.error} />
  if (!l.value) return <Loading />
  if (!l.value.length) return <div className="hint">Лістингів немає.</div>
  return (
    <ul className="my-listings" data-testid="order-listings">
      {l.value.map((x) => (
        <li key={x.listingId}>
          <div className="my-listing-text">
            <div className="my-listing-title">{x.title}</div>
            <div className="dim">
              {STATE_LABEL[x.state] ?? x.state}
              {x.priceAmount != null && x.priceDivisor != null && x.currency && ` · ${formatPrice(x.priceAmount, x.priceDivisor, x.currency)}`}
              {x.quantity != null && ` · у наявності: ${x.quantity}`}
            </div>
          </div>
          {x.url && isAllowedExternalUrl(x.url) && (
            <button className="btn small" onClick={() => void window.api.openExternal(x.url!)}>
              Відкрити на Etsy
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function ShipForm({ o, onDone }: { o: Order; onDone: (o: Order) => void }): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [note, setNote] = useState('')
  const [bcc, setBcc] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const half = !carrier.trim() !== !tracking.trim()

  const submit = async (): Promise<void> => {
    setError(null)
    setDone(null)
    const code = tracking.trim()
    const ok = await requestConfirm(
      `Позначити замовлення #${o.receiptId} відправленим?\nEtsy одразу надішле покупцю лист про відправлення${code ? ` з трек-номером ${code}` : ''}. Це не можна скасувати.`
    )
    if (!ok) return
    setBusy(true)
    const r = await featureCall<Order>('orders', 'ship', {
      receiptId: o.receiptId,
      carrier: carrier.trim() || undefined,
      trackingCode: code || undefined,
      noteToBuyer: note.trim() || undefined,
      sendBcc: bcc
    })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setDone('Замовлення позначено відправленим — покупцю надіслано лист.')
    setCarrier('')
    setTracking('')
    setNote('')
    onDone(r.value)
  }

  return (
    <div className="orders-ship" data-testid="ship-form">
      <h4>Позначити відправленим</h4>
      {o.isShipped && <div className="hint">Замовлення вже позначене відправленим — новий трек-номер додасть ще одне відправлення.</div>}
      <div className="field-row">
        <div className="field">
          <label htmlFor="ship-carrier">Перевізник</label>
          <input id="ship-carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="напр. ukrposhta, usps або other" />
        </div>
        <div className="field">
          <label htmlFor="ship-tracking">Трек-номер</label>
          <input id="ship-tracking" value={tracking} onChange={(e) => setTracking(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="ship-note">Повідомлення покупцю</label>
        <textarea id="ship-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <label className="check">
        <input type="checkbox" checked={bcc} onChange={(e) => setBcc(e.target.checked)} /> Надіслати копію листа мені
      </label>
      {half && <div className="hint warn">Вкажіть і перевізника, і трек-номер (або жодного — тоді замовлення лише позначиться відправленим).</div>}
      <div className="settings-actions">
        <button className="btn primary" disabled={busy || half} onClick={() => void submit()}>
          {busy ? 'Надсилання…' : 'Позначити відправленим'}
        </button>
      </div>
      <Alert text={error} />
      <Note text={done} />
    </div>
  )
}

const UPDATE_TEXT: Record<'paid' | 'unpaid' | 'shipped' | 'unshipped', { patch: OrderUpdate; label: string; ask: string; done: string }> = {
  paid: { patch: { wasPaid: true }, label: 'Позначити оплаченим', ask: 'позначити оплаченим', done: 'Позначено оплаченим.' },
  unpaid: { patch: { wasPaid: false }, label: 'Зняти позначку «оплачено»', ask: 'позначити неоплаченим', done: 'Позначку «оплачено» знято.' },
  shipped: {
    patch: { wasShipped: true },
    label: 'Відправлено без трек-номера',
    ask: 'позначити відправленим без трек-номера',
    done: 'Позначено відправленим.'
  },
  unshipped: {
    patch: { wasShipped: false },
    label: 'Зняти позначку «відправлено»',
    ask: 'позначити невідправленим',
    done: 'Позначку «відправлено» знято.'
  }
}

function FlagButtons({ o, onDone }: { o: Order; onDone: (o: Order) => void }): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const kinds = [o.isPaid ? 'unpaid' : 'paid', o.isShipped ? 'unshipped' : 'shipped'] as const

  const run = async (kind: keyof typeof UPDATE_TEXT): Promise<void> => {
    const u = UPDATE_TEXT[kind]
    setError(null)
    setDone(null)
    if (!(await requestConfirm(`Замовлення #${o.receiptId}: ${u.ask}?\nЗміна одразу потрапить на Etsy, покупець може її побачити.`))) return
    setBusy(true)
    const r = await featureCall<Order>('orders', 'update', { receiptId: o.receiptId, ...u.patch })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setDone(u.done)
    onDone(r.value)
  }

  return (
    <div data-testid="order-flags">
      <div className="settings-actions">
        {kinds.map((k) => (
          <button key={k} className="btn" disabled={busy} onClick={() => void run(k)}>
            {UPDATE_TEXT[k].label}
          </button>
        ))}
      </div>
      <Alert text={error} />
      <Note text={done} />
    </div>
  )
}

export function OrderDetail({
  receiptId,
  onBack,
  onChanged
}: {
  receiptId: number
  onBack: () => void
  onChanged: (o: Order) => void
}): JSX.Element {
  const d = useOrders<Order>('get', { receiptId })
  const changed = (o: Order): void => {
    d.set(o)
    onChanged(o)
  }
  const back = (
    <button className="btn small" onClick={onBack}>
      ← До списку
    </button>
  )
  if (d.error) {
    return (
      <div>
        {back}
        <Alert text={d.error} />
      </div>
    )
  }
  const o = d.value
  if (!o) return <Loading />
  const address = addressLines(o)
  return (
    <div className="order-detail" data-testid="order-detail">
      <div className="editor-head">
        {back}
        <strong>
          Замовлення #{o.receiptId} від {formatEtsyDate(o.createdAt)}
        </strong>
        <OrderBadges o={o} />
      </div>

      <table className="data-table" data-testid="order-items">
        <thead>
          <tr>
            <th>Товар</th>
            <th>К-сть</th>
            <th>Ціна за од.</th>
          </tr>
        </thead>
        <tbody>
          {o.items.map((i) => (
            <tr key={i.transactionId}>
              <td>
                {i.title}
                {i.variations.map((v) => (
                  <div key={`${v.name}:${v.value}`} className="dim">
                    {v.name}: {v.value}
                  </div>
                ))}
                {i.sku && <div className="dim">SKU: {i.sku}</div>}
              </td>
              <td>{i.quantity}</td>
              <td>{fmtMoney(i.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Totals o={o} />

      <dl className="listing-facts">
        <dt>Покупець</dt>
        <dd>{o.buyerName ?? '—'}</dd>
        {o.buyerEmail && (
          <>
            <dt>Email</dt>
            <dd>{o.buyerEmail}</dd>
          </>
        )}
        <dt>Адреса доставки</dt>
        <dd data-testid="order-address">
          {address.length
            ? address.map((line) => (
                <div key={line}>{line}</div>
              ))
            : '—'}
        </dd>
        <dt>Оплата</dt>
        <dd>{o.paymentMethod ?? '—'}</dd>
        {o.isGift && (
          <>
            <dt>Подарунок</dt>
            <dd>
              {o.giftMessage ? <div className="orders-text">«{o.giftMessage}»</div> : 'так'}
              {o.giftSender && <div className="dim">від: {o.giftSender}</div>}
            </dd>
          </>
        )}
      </dl>

      {o.messageFromBuyer && (
        <div className="orders-message" data-testid="buyer-message">
          <div className="orders-sub-title">Повідомлення від покупця</div>
          <div className="orders-text">{o.messageFromBuyer}</div>
        </div>
      )}

      {o.shipments.length > 0 && (
        <>
          <h4>Відправлення</h4>
          <ul className="plain-list" data-testid="order-shipments">
            {o.shipments.map((s, idx) => (
              <li key={s.id ?? idx}>
                {s.carrier ?? '—'} · {s.trackingCode ?? 'без трек-номера'}
                {s.notifiedAt != null && <span className="dim"> · покупця сповіщено {formatEtsyDate(s.notifiedAt)}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {o.refunds.length > 0 && (
        <>
          <h4>Повернення коштів</h4>
          <ul className="plain-list">
            {o.refunds.map((r, idx) => (
              <li key={idx}>
                {fmtMoney(r.amount)} · {formatEtsyDate(r.createdAt)}
                {r.reason && ` — ${r.reason}`}
                {r.note && <span className="dim"> ({r.note})</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      <LazyDetails label="Платіж" testId="order-payments">
        {() => <OrderPayments receiptId={o.receiptId} />}
      </LazyDetails>
      <LazyDetails label="Лістинги цього замовлення" testId="order-listings-section">
        {() => <OrderListings receiptId={o.receiptId} />}
      </LazyDetails>

      <ShipForm o={o} onDone={changed} />
      <h4>Інші позначки</h4>
      <FlagButtons o={o} onDone={changed} />
    </div>
  )
}
