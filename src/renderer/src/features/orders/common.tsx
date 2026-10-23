// Small pieces the "orders" UI shares: loading a feature action, money, errors, payments.

import { useCallback, useEffect, useState } from 'react'
import type { OrderMoney, OrderPayment } from '@shared/features/orders'
import { formatEtsyDate, formatPrice } from '@shared/format'
import { featureCall } from '../call'

export const fmtMoney = (m: OrderMoney | null | undefined): string => (m ? formatPrice(m.amount, m.divisor, m.currency) : '—')
export const fmtMoneys = (list: OrderMoney[]): string => (list.length ? list.map(fmtMoney).join(' + ') : '—')

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

export function Alert({ text }: { text: string | null }): JSX.Element | null {
  if (!text) return null
  return (
    <div className="test-result err" role="alert">
      {text}
    </div>
  )
}

export function Note({ text }: { text: string | null }): JSX.Element | null {
  if (!text) return null
  return (
    <div className="test-result ok" role="status">
      {text}
    </div>
  )
}

export const Loading = (): JSX.Element => <div className="hint">Завантаження…</div>

/** Payments (OAS Payment) as fact lists: gross, fees, net, posted / adjusted amounts, refunds. */
export function PaymentsList({ payments }: { payments: OrderPayment[] }): JSX.Element {
  if (!payments.length) return <div className="hint">Платежів немає.</div>
  return (
    <>
      {payments.map((p) => (
        <div key={p.paymentId} className="orders-payment" data-testid={`payment-${p.paymentId}`}>
          <div className="orders-sub-title">
            Платіж #{p.paymentId}
            {p.receiptId != null && <span className="dim"> · замовлення #{p.receiptId}</span>}
            {p.status && <span className="dim"> · {p.status}</span>}
          </div>
          <dl className="listing-facts">
            <dt>Сплачено покупцем</dt>
            <dd>{fmtMoney(p.gross)}</dd>
            <dt>Комісії</dt>
            <dd>{fmtMoney(p.fees)}</dd>
            <dt>Вам (чистими)</dt>
            <dd>{fmtMoney(p.net)}</dd>
            {p.postedNet && (
              <>
                <dt>Зараховано після відправлення</dt>
                <dd>{fmtMoney(p.postedNet)}</dd>
              </>
            )}
            {p.adjustedNet && (
              <>
                <dt>Після повернень</dt>
                <dd>{fmtMoney(p.adjustedNet)}</dd>
              </>
            )}
            <dt>Дата</dt>
            <dd>{formatEtsyDate(p.createdAt)}</dd>
          </dl>
          {p.adjustments.length > 0 && (
            <ul className="plain-list">
              {p.adjustments.map((a) => (
                <li key={a.id}>
                  Повернення {fmtMoney(a.amount)}
                  {a.reason && ` — ${a.reason}`}
                  {a.status && <span className="dim"> · {a.status}</span>}
                  <span className="dim"> · {formatEtsyDate(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </>
  )
}
