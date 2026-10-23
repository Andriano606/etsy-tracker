// "Мій магазин" → "Замовлення": filters (paid / shipped / delivered / canceled,
// creation dates, order), the list (getShopReceipts, 25 per page) and one
// order's detail.

import { useRef, useState } from 'react'
import type { Order, OrdersPage } from '@shared/features/orders'
import { localDaySec } from '@shared/features/orders'
import { formatEtsyDate } from '@shared/format'
import { featureCall } from '../call'
import { Alert, Loading, fmtMoney, useOrders } from './common'
import { OrderBadges, OrderDetail } from './OrderDetail'

export const ORDERS_PAGE = 25

type Tri = '' | 'yes' | 'no'
type Sort = 'new' | 'old' | 'updated'

export interface OrderForm {
  paid: Tri
  shipped: Tri
  delivered: Tri
  canceled: Tri
  from: string
  to: string
  sort: Sort
}

const EMPTY: OrderForm = { paid: '', shipped: '', delivered: '', canceled: '', from: '', to: '', sort: 'new' }

const SORTS: Record<Sort, { sortOn: string; sortOrder: string }> = {
  new: { sortOn: 'created', sortOrder: 'desc' },
  old: { sortOn: 'created', sortOrder: 'asc' },
  updated: { sortOn: 'updated', sortOrder: 'desc' }
}

/** The form → the `orders.list` args (OrderFilters); dates are local days. */
export function orderQuery(f: OrderForm, offset = 0): Record<string, unknown> {
  const q: Record<string, unknown> = { ...SORTS[f.sort], limit: ORDERS_PAGE, offset }
  const tri = (v: Tri): boolean | undefined => (v === '' ? undefined : v === 'yes')
  const flags = { wasPaid: tri(f.paid), wasShipped: tri(f.shipped), wasDelivered: tri(f.delivered), wasCanceled: tri(f.canceled) }
  for (const [k, v] of Object.entries(flags)) if (v !== undefined) q[k] = v
  const lo = f.from ? localDaySec(f.from) : null
  const hi = f.to ? localDaySec(f.to, true) : null
  if (lo != null) q.minCreated = lo
  if (hi != null) q.maxCreated = hi
  return q
}

function TriSelect({ id, label, value, yes, no, onChange }: { id: string; label: string; value: Tri; yes: string; no: string; onChange: (v: Tri) => void }): JSX.Element {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as Tri)}>
        <option value="">усі</option>
        <option value="yes">{yes}</option>
        <option value="no">{no}</option>
      </select>
    </div>
  )
}

export function OrdersTab(): JSX.Element {
  const [form, setForm] = useState<OrderForm>(EMPTY)
  const [query, setQuery] = useState<Record<string, unknown>>(() => orderQuery(EMPTY))
  const page = useOrders<OrdersPage>('list', query)
  /** Bumped by every "Показати": a "more" answer asked before it is dropped. */
  const generation = useRef(0)
  const [more, setMore] = useState<Order[]>([])
  const [moreError, setMoreError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const [patched, setPatched] = useState<Record<number, Order>>({})
  const set = <K extends keyof OrderForm>(k: K, v: OrderForm[K]): void => setForm((f) => ({ ...f, [k]: v }))

  const apply = (): void => {
    generation.current++
    setMore([])
    setMoreError(null)
    setLoadingMore(false)
    const q = orderQuery(form)
    if (JSON.stringify(q) === JSON.stringify(query)) page.reload()
    else setQuery(q)
  }

  const loadMore = async (): Promise<void> => {
    if (!page.value) return
    const asked = generation.current
    const offset = page.value.orders.length + more.length
    setLoadingMore(true)
    setMoreError(null)
    const r = await featureCall<OrdersPage>('orders', 'list', { ...query, offset })
    if (generation.current !== asked) return
    setLoadingMore(false)
    if (r.ok) setMore((m) => [...m, ...r.value.orders])
    else setMoreError(r.error)
  }

  if (open != null) {
    return (
      <OrderDetail
        receiptId={open}
        onBack={() => setOpen(null)}
        onChanged={(o) => setPatched((p) => ({ ...p, [o.receiptId]: o }))}
      />
    )
  }

  const orders = [...(page.value?.orders ?? []), ...more].map((o) => patched[o.receiptId] ?? o)
  const total = page.value?.total ?? 0
  return (
    <div data-testid="orders-tab">
      <div className="field-row orders-filters">
        <TriSelect id="orders-paid" label="Оплата" value={form.paid} yes="оплачені" no="неоплачені" onChange={(v) => set('paid', v)} />
        <TriSelect id="orders-shipped" label="Відправка" value={form.shipped} yes="відправлені" no="не відправлені" onChange={(v) => set('shipped', v)} />
        <TriSelect id="orders-delivered" label="Доставка" value={form.delivered} yes="доставлені" no="не доставлені" onChange={(v) => set('delivered', v)} />
        <TriSelect id="orders-canceled" label="Скасовані" value={form.canceled} yes="лише скасовані" no="без скасованих" onChange={(v) => set('canceled', v)} />
      </div>
      <div className="field-row orders-filters">
        <div className="field">
          <label htmlFor="orders-from">Від дати</label>
          <input id="orders-from" type="date" value={form.from} onChange={(e) => set('from', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="orders-to">До дати</label>
          <input id="orders-to" type="date" value={form.to} onChange={(e) => set('to', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="orders-sort">Порядок</label>
          <select id="orders-sort" value={form.sort} onChange={(e) => set('sort', e.target.value as Sort)}>
            <option value="new">спершу нові</option>
            <option value="old">спершу старі</option>
            <option value="updated">нещодавно змінені</option>
          </select>
        </div>
      </div>
      <div className="settings-actions">
        <button className="btn primary" onClick={apply}>
          Показати
        </button>
      </div>

      <Alert text={page.error} />
      {page.loading && <Loading />}
      {page.value && !page.loading && (
        <>
          <div className="hint">Знайдено замовлень: {total}</div>
          {orders.length === 0 ? (
            <div className="hint">Замовлень немає.</div>
          ) : (
            <table className="data-table" data-testid="orders-list">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Замовлення</th>
                  <th>Покупець</th>
                  <th>Товарів</th>
                  <th>Сума</th>
                  <th>Стан</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.receiptId} data-testid={`order-row-${o.receiptId}`}>
                    <td>{formatEtsyDate(o.createdAt)}</td>
                    <td>#{o.receiptId}</td>
                    <td>{o.buyerName ?? '—'}</td>
                    <td>{o.itemCount}</td>
                    <td>{fmtMoney(o.totals.grandTotal)}</td>
                    <td>
                      <OrderBadges o={o} />
                    </td>
                    <td>
                      <button className="btn small" onClick={() => setOpen(o.receiptId)}>
                        Відкрити
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {orders.length < total && (
            <div className="settings-actions">
              <button className="btn" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? 'Завантаження…' : 'Показати ще'}
              </button>
            </div>
          )}
          <Alert text={moreError} />
        </>
      )}
    </div>
  )
}
