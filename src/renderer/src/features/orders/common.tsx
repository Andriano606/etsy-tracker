// Small pieces the "orders" UI shares: loading a feature action, money, errors, payments.

import { useCallback, useEffect, useState } from 'react'
import type { OrderMoney, OrderPayment } from '@shared/features/orders'
import { formatEtsyDate, formatPrice } from '@shared/format'
import { Badge, Loading as UiLoading } from '../../ui'
import { ErrorNote, Facts, Status } from '../shopConfig/kit'
import { featureCall } from '../call'

export const fmtMoney = (m: OrderMoney | null | undefined): string => (m ? formatPrice(m.amount, m.divisor, m.currency) : '—')
export const fmtMoneys = (list: OrderMoney[]): string => (list.length ? list.map(fmtMoney).join(' + ') : '—')

/** "+24,90 USD" / "−0,20 USD": a ledger amount with its sign (a typographic minus) for the eye. */
export function signedMoney(m: OrderMoney): string {
  const abs = fmtMoney({ ...m, amount: Math.abs(m.amount) })
  return m.amount > 0 ? `+${abs}` : m.amount < 0 ? `−${abs}` : abs
}

export interface Loaded<T> {
  value: T | null
  error: string | null
  loading: boolean
  reload: () => void
  set: (v: T) => void
}

/**
 * Call `orders.<action>(args)` on mount and whenever `args` change (null = don't
 * call). `value` is only ever the answer to the current args: a failed load
 * clears it, so a list of the previous filters never stays under new ones.
 */
export function useOrders<T>(action: string, args: Record<string, unknown> | null): Loaded<T> {
  const [data, setData] = useState<{ key: string; value: T } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const key = args ? JSON.stringify([action, args]) : null
  useEffect(() => {
    if (key == null) return
    let alive = true
    setLoading(true)
    setError(null)
    void featureCall<T>('orders', action, JSON.parse(key)[1]).then((r) => {
      if (!alive) return
      setLoading(false)
      if (r.ok) setData({ key, value: r.value })
      else {
        setData(null)
        setError(r.error)
      }
    })
    return () => {
      alive = false
    }
  }, [action, key, nonce])
  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const set = useCallback((value: T) => key != null && setData({ key, value }), [key])
  return { value: data && data.key === key ? data.value : null, error, loading, reload, set }
}

/** An error (role="alert"). */
export function Alert({ text, title }: { text: string | null; title?: string }): JSX.Element | null {
  return <ErrorNote error={text} title={title} />
}

/** A success note (role="status"). */
export function Note({ text }: { text: string | null }): JSX.Element | null {
  return <Status error={null} note={text} />
}

export const Loading = ({ children }: { children?: string }): JSX.Element => <UiLoading inline>{children ?? 'Завантаження…'}</UiLoading>

/** Etsy's payment status words → Ukrainian (unknown ones as Etsy wrote them). */
const PAYMENT_STATUS: Record<string, string> = {
  settled: 'зараховано',
  authed: 'авторизовано',
  pending: 'очікує',
  refunded: 'повернуто',
  completed: 'виконано',
  complete: 'виконано',
  failed: 'не вдалося'
}
const paymentStatus = (s: string): string => PAYMENT_STATUS[s.toLowerCase()] ?? s

/** Payments (OAS Payment) as fact lists: gross, fees, net, posted / adjusted amounts, refunds. */
export function PaymentsList({ payments }: { payments: OrderPayment[] }): JSX.Element {
  if (!payments.length) return <p className="fx-muted">Платежів немає.</p>
  return (
    <div className="ord-payments">
      {payments.map((p) => (
        <div key={p.paymentId} className="ord-payment" data-testid={`payment-${p.paymentId}`}>
          <div className="ord-payment-head">
            <span className="fx-title">Платіж #{p.paymentId}</span>
            {p.receiptId != null && <span className="fx-meta">замовлення #{p.receiptId}</span>}
            {p.status && <Badge tone={/settled|complete/i.test(p.status) ? 'accent' : 'neutral'}>{paymentStatus(p.status)}</Badge>}
            <span className="fx-meta">{formatEtsyDate(p.createdAt)}</span>
          </div>
          <Facts
            className="fx-facts--money"
            items={[
              { label: 'Сплачено покупцем', glossary: 'features.orders.grandTotal', value: fmtMoney(p.gross) },
              { label: 'Комісії', glossary: 'features.orders.fees', value: p.fees ? `−${fmtMoney(p.fees)}` : '—' },
              { label: 'Вам (чистими)', glossary: 'features.orders.net', value: fmtMoney(p.net), strong: true },
              p.postedNet && { label: 'Зараховано після відправлення', glossary: 'features.orders.posted', value: fmtMoney(p.postedNet) },
              p.adjustedNet && { label: 'Після повернень', glossary: 'features.orders.adjusted', value: fmtMoney(p.adjustedNet) }
            ]}
          />
          {p.adjustments.length > 0 && (
            <ul className="fx-list">
              {p.adjustments.map((a) => (
                <li key={a.id} className="fx-list-row">
                  <span>
                    Повернення {fmtMoney(a.amount)}
                    {a.reason && ` — ${a.reason}`}
                  </span>
                  <span className="fx-meta">
                    {a.status && `${paymentStatus(a.status)} · `}
                    {formatEtsyDate(a.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}
