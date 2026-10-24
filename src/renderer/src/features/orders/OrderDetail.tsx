// One order: what to do next, items, totals, buyer + address, messages, gift,
// shipments, refunds, payment, the order's listings, and the updates (mark
// shipped with tracking → createReceiptShipment; paid/shipped flags →
// updateShopReceipt).

import { useEffect, useRef, useState } from 'react'
import type { Order, OrderPayment, OrderUpdate } from '@shared/features/orders'
import type { ShippingProfile } from '@shared/features/shopConfig'
import { orderStatusLabel } from '@shared/features/orders'
import { STATE_LABEL } from '@shared/myShop'
import { isAllowedExternalUrl } from '@shared/externalUrl'
import { formatEtsyDate, formatPrice } from '@shared/format'
import type { MyListing } from '@shared/types'
import { ownShopId, useStore } from '../../store'
import { confirmWith } from '../../components/ConfirmModal'
import { Badge, Button, Callout, Field, Icon, Select, Toggle, type BadgeTone, type IconName } from '../../ui'
import { featureCall } from '../call'
import { LazyDetails } from '../LazyDetails'
import { useCarriers, useLoad } from '../shopConfig/common'
import { Card, Facts, Note as InfoNote } from '../shopConfig/kit'
import { Alert, Loading, Note, PaymentsList, fmtMoney, signedMoney, useOrders } from './common'

const COPY_FEEDBACK_MS = 2000

const STATUS_TONE: Record<string, BadgeTone> = {
  canceled: 'danger',
  'fully refunded': 'danger',
  'partially refunded': 'warn',
  completed: 'accent',
  'payment processing': 'info',
  open: 'neutral'
}

/** The order's status chips: its Etsy status (unless plain "paid"), paid, shipped, gift. Icons + words, never colour alone. */
export function OrderBadges({ o }: { o: Order }): JSX.Element {
  const canceled = /cancel|refunded/i.test(o.status)
  const chip = (tone: BadgeTone, icon: IconName, text: string): JSX.Element => (
    <Badge tone={tone} icon={icon}>
      {text}
    </Badge>
  )
  return (
    <span className="order-badges">
      {o.status && o.status !== 'paid' && chip(STATUS_TONE[o.status.toLowerCase()] ?? 'neutral', canceled ? 'close' : 'info', orderStatusLabel(o.status))}
      {o.isPaid ? chip('accent', 'check', 'оплачено') : chip('warn', 'clock', 'не оплачено')}
      {o.isShipped ? chip('accent', 'truck', 'відправлено') : chip(o.isPaid && !canceled ? 'warn' : 'neutral', 'box', 'не відправлено')}
      {o.isGift && chip('info', 'sparkle', 'подарунок')}
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

/** Cancelled or the whole sum went back to the buyer: nothing to send. */
const isCanceled = (o: Order): boolean => /cancel|fully refunded/i.test(o.status)
/** The order is waiting for its parcel: paid, not cancelled (shipped ones may get another shipment). */
const canShip = (o: Order): boolean => o.isPaid && !isCanceled(o)

/** What the seller should do with this order now. */
function NextStep({ o, onShip }: { o: Order; onShip: () => void }): JSX.Element {
  if (isCanceled(o))
    return (
      <InfoNote title="Замовлення скасоване" icon="close">
        Відправляти нічого не треба. Гроші покупцю повертає Etsy.
      </InfoNote>
    )
  if (!o.isPaid)
    return (
      <InfoNote tone="warn" title="Покупець ще не заплатив" icon="clock">
        Не відправляйте товар, доки замовлення не стане оплаченим.
      </InfoNote>
    )
  if (!o.isShipped)
    return (
      <Callout
        tone="warn"
        role="note"
        compact
        icon="truck"
        title="Замовлення оплачене і чекає відправлення"
        action={
          <Button size="sm" variant="primary" icon="truck" onClick={onShip}>
            Як відправити
          </Button>
        }
      >
        Запакуйте і відправте посилку, а потім позначте замовлення відправленим — Etsy повідомить покупця.
      </Callout>
    )
  return (
    <InfoNote title="Замовлення відправлене" icon="success">
      Посилка в дорозі — нічого робити не треба. Трек-номер, якщо його вказано, — нижче, у «Відправлення».
    </InfoNote>
  )
}

function Totals({ o }: { o: Order }): JSX.Element {
  const t = o.totals
  const neg = (m: typeof t.discount) => (m && m.amount ? { ...m, amount: -m.amount } : null)
  return (
    <Facts
      testId="order-totals"
      className="fx-facts--money ord-totals"
      items={[
        !!t.itemsTotal && { label: 'Товари', glossary: 'features.orders.itemsTotal', value: fmtMoney(t.itemsTotal) },
        !!neg(t.discount) && { label: 'Знижка', glossary: 'features.orders.discount', value: signedMoney(neg(t.discount)!) },
        !!t.subtotal && { label: 'Підсумок', info: 'Вартість товарів мінус знижка.', value: fmtMoney(t.subtotal) },
        !!t.shipping && { label: 'Доставка', glossary: 'shippingCost', value: fmtMoney(t.shipping) },
        !!(t.tax && t.tax.amount) && { label: 'Податок', glossary: 'features.orders.tax', value: fmtMoney(t.tax) },
        !!(t.vat && t.vat.amount) && { label: 'ПДВ', glossary: 'vat', value: fmtMoney(t.vat) },
        !!(t.giftWrap && t.giftWrap.amount) && { label: 'Подарункове пакування', glossary: 'features.orders.giftWrap', value: fmtMoney(t.giftWrap) },
        { label: 'Разом', glossary: 'features.orders.grandTotal', value: fmtMoney(t.grandTotal), strong: true }
      ]}
    />
  )
}

function OrderPayments({ receiptId }: { receiptId: number }): JSX.Element {
  const p = useOrders<OrderPayment[]>('payments', { receiptId })
  if (p.error) return <Alert text={p.error} />
  if (!p.value) return <Loading>Завантаження платежу…</Loading>
  return <PaymentsList payments={p.value} />
}

function OrderListings({ receiptId }: { receiptId: number }): JSX.Element {
  const l = useOrders<MyListing[]>('listings', { receiptId })
  if (l.error) return <Alert text={l.error} />
  if (!l.value) return <Loading>Завантаження товарів…</Loading>
  if (!l.value.length) return <p className="fx-muted">Товарів немає (їх могли видалити з Etsy).</p>
  return (
    <ul className="fx-list" data-testid="order-listings">
      {l.value.map((x) => (
        <li key={x.listingId} className="fx-list-row ord-listing">
          <div className="min-w-0">
            <div className="fx-title clamp-2" title={x.title}>
              {x.title}
            </div>
            <div className="fx-meta">
              {STATE_LABEL[x.state] ?? x.state}
              {x.priceAmount != null && x.priceDivisor != null && x.currency && ` · ${formatPrice(x.priceAmount, x.priceDivisor, x.currency)}`}
              {x.quantity != null && ` · у наявності: ${x.quantity}`}
            </div>
          </div>
          {x.url && isAllowedExternalUrl(x.url) && (
            <Button size="sm" variant="ghost" icon="external" onClick={() => void window.api.openExternal(x.url!)}>
              Відкрити на Etsy
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

/** What a carrier choice sends when the shop's carrier isn't in Etsy's list. */
export const OTHER_CARRIER = 'other'

/**
 * Etsy's carriers for the shop's origin country: the own shop's shipping-from
 * country when the app tracks that shop, else the origin of its first shipping
 * profile. `carriers` is null while loading, [] when unknown (→ a text field).
 */
function useShipCarriers(): { carriers: ReturnType<typeof useCarriers>['carriers'] } {
  const tracked = useStore((s) => {
    const id = ownShopId(s)
    const shop = id == null ? null : s.shops.find((x) => x.id === id)
    return shop?.profile?.shippingFromCountryIso ?? shop?.profile?.countryIso ?? null
  })
  const profiles = useLoad<ShippingProfile[]>('shippingProfiles', {}, '', tracked != null)
  const fromProfile = profiles.value?.find((p) => p.originCountry)?.originCountry ?? null
  const country = tracked ?? fromProfile
  const { carriers } = useCarriers(country)
  if (!tracked && !profiles.value && !profiles.error) return { carriers: null }
  return { carriers }
}

function CarrierField({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
  const { carriers } = useShipCarriers()
  const listed = carriers != null && carriers.length > 0
  return (
    <Field
      label="Перевізник"
      id="ship-carrier"
      glossary="features.orders.carrierName"
      hint={listed ? 'Необов’язково, але разом із трек-номером.' : 'Необов’язково, але разом із трек-номером. Назва латиницею або «other».'}
    >
      {carriers == null ? (
        <Select value="" onChange={() => {}} disabled fullWidth>
          <option value="">Завантаження перевізників…</option>
        </Select>
      ) : listed ? (
        <Select value={value} onChange={onChange} fullWidth>
          <option value="">— не вказано —</option>
          {carriers.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
          <option value={OTHER_CARRIER}>Інша служба (немає в списку)</option>
        </Select>
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="напр. Ukrposhta або other" />
      )}
    </Field>
  )
}

function ShipForm({ o, onDone }: { o: Order; onDone: (o: Order) => void }): JSX.Element {
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
    const ok = await confirmWith({
      message: `Позначити замовлення #${o.receiptId} відправленим?\nEtsy одразу надішле покупцю лист про відправлення${code ? ` з трек-номером ${code}` : ''}. Це не можна скасувати.`,
      confirmLabel: 'Позначити відправленим'
    })
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
    <Card
      testId="ship-form"
      className="ord-ship"
      title="Позначити відправленим"
      glossary="features.orders.shipped"
      footer={
        <Button variant="primary" icon="truck" busy={busy} disabled={half} onClick={() => void submit()}>
          Позначити відправленим
        </Button>
      }
    >
      <InfoNote title="Що станеться" icon="info">
        Etsy одразу надішле покупцю лист, що посилка в дорозі — з трек-номером і вашим повідомленням, якщо вкажете. Скасувати це не можна, тож
        позначайте, коли посилка вже у пошти.
      </InfoNote>
      {o.isShipped && <InfoNote>Замовлення вже позначене відправленим — новий трек-номер додасть ще одне відправлення.</InfoNote>}
      <div className="ui-form-grid fx-grid-2">
        <CarrierField value={carrier} onChange={setCarrier} />
        <Field label="Трек-номер" id="ship-tracking" glossary="features.orders.trackingCode" hint="Номер з квитанції пошти.">
          <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="напр. RR123456789UA" />
        </Field>
      </div>
      <Field label="Повідомлення покупцю" id="ship-note" glossary="features.orders.noteToBuyer">
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Дякуємо за покупку! Посилка вже в дорозі." />
      </Field>
      <Toggle label="Надіслати копію листа мені" hint="Etsy надішле вам ту саму копію листа, що й покупцю." checked={bcc} onChange={setBcc} />
      {half && (
        <InfoNote tone="warn">Вкажіть і перевізника, і трек-номер (або жодного — тоді замовлення лише позначиться відправленим).</InfoNote>
      )}
      <Alert text={error} />
      <Note text={done} />
    </Card>
  )
}

const UPDATE_TEXT: Record<'paid' | 'unpaid' | 'shipped' | 'unshipped', { patch: OrderUpdate; label: string; ask: string; done: string; icon: IconName }> = {
  paid: { patch: { wasPaid: true }, label: 'Позначити оплаченим', ask: 'позначити оплаченим', done: 'Позначено оплаченим.', icon: 'check' },
  unpaid: { patch: { wasPaid: false }, label: 'Зняти позначку «оплачено»', ask: 'позначити неоплаченим', done: 'Позначку «оплачено» знято.', icon: 'close' },
  shipped: {
    patch: { wasShipped: true },
    label: 'Відправлено без трек-номера',
    ask: 'позначити відправленим без трек-номера',
    done: 'Позначено відправленим.',
    icon: 'truck'
  },
  unshipped: {
    patch: { wasShipped: false },
    label: 'Зняти позначку «відправлено»',
    ask: 'позначити невідправленим',
    done: 'Позначку «відправлено» знято.',
    icon: 'close'
  }
}

function FlagButtons({ o, onDone }: { o: Order; onDone: (o: Order) => void }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const kinds = [o.isPaid ? 'unpaid' : 'paid', o.isShipped ? 'unshipped' : 'shipped'] as const

  const run = async (kind: keyof typeof UPDATE_TEXT): Promise<void> => {
    const u = UPDATE_TEXT[kind]
    setError(null)
    setDone(null)
    const ok = await confirmWith({
      message: `Замовлення #${o.receiptId}: ${u.ask}?\nЗміна одразу потрапить на Etsy, покупець може її побачити.`,
      confirmLabel: u.label
    })
    if (!ok) return
    setBusy(true)
    const r = await featureCall<Order>('orders', 'update', { receiptId: o.receiptId, ...u.patch })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setDone(u.done)
    onDone(r.value)
  }

  return (
    <Card
      testId="order-flags"
      title="Інші позначки"
      desc="Виправити позначку, поставлену помилково, або позначити відправленим без трек-номера. Зміна одразу потрапляє на Etsy."
      footer={kinds.map((k) => (
        <Button key={k} icon={UPDATE_TEXT[k].icon} disabled={busy} onClick={() => void run(k)}>
          {UPDATE_TEXT[k].label}
        </Button>
      ))}
    >
      <Alert text={error} />
      <Note text={done} />
    </Card>
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
  const shipRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState<boolean | null>(null)
  // "Скопійовано" / "Не вдалося" for 2 s, then the button says what it does again.
  useEffect(() => {
    if (copied == null) return
    const t = setTimeout(() => setCopied(null), COPY_FEEDBACK_MS)
    return () => clearTimeout(t)
  }, [copied])
  const changed = (o: Order): void => {
    d.set(o)
    onChanged(o)
  }
  const back = (
    <Button size="sm" variant="ghost" icon="chevron-left" onClick={onBack}>
      До списку
    </Button>
  )
  if (d.error) {
    return (
      <div className="fx-page">
        <div className="fx-detail-head">{back}</div>
        <Alert text={d.error} title="Не вдалося відкрити замовлення" />
      </div>
    )
  }
  const o = d.value
  if (!o) return <Loading>Завантаження замовлення…</Loading>
  const address = addressLines(o)
  const copyAddress = async (): Promise<void> => setCopied(await window.api.copyText(address.join('\n')).catch(() => false))
  const toShip = (): void => {
    shipRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    shipRef.current?.querySelector<HTMLElement>('select, input')?.focus({ preventScroll: true })
  }
  return (
    <div className="fx-page order-detail" data-testid="order-detail">
      <div className="fx-detail-head">
        {back}
        <h3 className="fx-detail-title truncate" title={`Замовлення #${o.receiptId}`}>
          Замовлення #{o.receiptId} від {formatEtsyDate(o.createdAt)}
        </h3>
      </div>
      <OrderBadges o={o} />
      <NextStep o={o} onShip={toShip} />

      <div className="ord-grid">
        <Card title="Що купили" glossary="transaction">
          <ul className="ord-items" data-testid="order-items">
            {o.items.map((i) => (
              <li key={i.transactionId} className="ord-item">
                <div className="min-w-0">
                  <div className="fx-title clamp-2" title={i.title}>
                    {i.title}
                  </div>
                  {i.variations.length > 0 && (
                    <div className="ord-vars">
                      {i.variations.map((v) => (
                        <span key={`${v.name}:${v.value}`} className="ord-var">
                          {v.name}: {v.value}
                        </span>
                      ))}
                    </div>
                  )}
                  {i.sku && <div className="fx-meta">Артикул: {i.sku}</div>}
                </div>
                <div className="ord-item-sum num">
                  <span className="fx-meta">{i.quantity} ×</span> {fmtMoney(i.price)}
                </div>
              </li>
            ))}
          </ul>
          <Totals o={o} />
        </Card>

        <Card title="Покупець і доставка">
          <Facts
            items={[
              { label: 'Покупець', value: o.buyerName ?? '—' },
              !!o.buyerEmail && { label: 'Електронна пошта', value: <span className="ord-break">{o.buyerEmail}</span> },
              {
                label: 'Адреса доставки',
                value: (
                  <>
                    <div data-testid="order-address" className="ord-address">
                      {address.length ? address.map((line) => <div key={line}>{line}</div>) : '—'}
                    </div>
                    {address.length > 0 && (
                      <Button size="sm" variant="ghost" icon={copied ? 'check' : 'copy'} onClick={() => void copyAddress()}>
                        {copied ? 'Скопійовано' : copied === false ? 'Не вдалося скопіювати' : 'Копіювати адресу'}
                      </Button>
                    )}
                  </>
                )
              },
              { label: 'Спосіб оплати', value: o.paymentMethod === 'cc' ? 'картка' : (o.paymentMethod ?? '—') },
              o.isGift && {
                label: 'Подарунок',
                value: (
                  <>
                    {o.giftMessage ? <div className="orders-text">«{o.giftMessage}»</div> : 'так'}
                    {o.giftSender && <div className="fx-meta">від: {o.giftSender}</div>}
                  </>
                )
              }
            ]}
          />
          {o.messageFromBuyer && (
            <div className="ord-message" data-testid="buyer-message">
              <div className="ord-message-head">
                <Icon name="review" size={14} /> Повідомлення від покупця
              </div>
              <div className="orders-text">{o.messageFromBuyer}</div>
            </div>
          )}
        </Card>
      </div>

      {o.shipments.length > 0 && (
        <Card title="Відправлення" glossary="features.orders.trackingCode">
          <ul className="fx-list" data-testid="order-shipments">
            {o.shipments.map((s, idx) => (
              <li key={s.id ?? idx} className="fx-list-row">
                <span>
                  <Icon name="truck" size={14} /> {s.carrier ?? '—'} · {s.trackingCode ?? 'без трек-номера'}
                </span>
                {s.notifiedAt != null && <span className="fx-meta">покупця сповіщено {formatEtsyDate(s.notifiedAt)}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {o.refunds.length > 0 && (
        <Card title="Повернення коштів" glossary="features.orders.refund">
          <ul className="fx-list">
            {o.refunds.map((r, idx) => (
              <li key={idx} className="fx-list-row">
                <span>
                  {fmtMoney(r.amount)} · {formatEtsyDate(r.createdAt)}
                  {r.reason && ` — ${r.reason}`}
                </span>
                {r.note && <span className="fx-meta">({r.note})</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="ord-lazy">
        <LazyDetails
          label="Платіж"
          icon="wallet"
          description="Скільки заплатив покупець, скільки забрали комісії Etsy і скільки отримаєте ви."
          testId="order-payments"
        >
          {() => <OrderPayments receiptId={o.receiptId} />}
        </LazyDetails>
        <LazyDetails
          label="Товари цього замовлення на Etsy"
          icon="box"
          description="Як ці товари виглядають у магазині зараз: стан, ціна, скільки лишилось."
          testId="order-listings-section"
        >
          {() => <OrderListings receiptId={o.receiptId} />}
        </LazyDetails>
      </div>

      <div ref={shipRef} className="ord-ship-anchor">
        {canShip(o) ? (
          <ShipForm o={o} onDone={changed} />
        ) : (
          <LazyDetails
            label="Все одно позначити відправленим…"
            icon="truck"
            description={isCanceled(o) ? 'Замовлення скасоване — зазвичай відправляти нічого не треба.' : 'Покупець ще не заплатив — зазвичай варто зачекати.'}
            testId="ship-anyway"
          >
            {() => (
              <div className="fx-page fx-page--compact">
                <InfoNote tone="warn" title={isCanceled(o) ? 'Замовлення скасоване' : 'Замовлення ще не оплачене'} icon="warning">
                  {isCanceled(o)
                    ? 'Позначайте відправленим, лише якщо посилку справді вже відправлено — Etsy надішле покупцю лист.'
                    : 'Не відправляйте товар, доки покупець не заплатить. Позначайте, лише якщо посилку справді вже відправлено.'}
                </InfoNote>
                <ShipForm o={o} onDone={changed} />
              </div>
            )}
          </LazyDetails>
        )}
      </div>
      <FlagButtons o={o} onDone={changed} />
    </div>
  )
}
