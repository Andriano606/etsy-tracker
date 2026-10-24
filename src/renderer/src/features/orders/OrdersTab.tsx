// "Мій магазин" → "Замовлення": quick views (all / to ship / shipped /
// canceled), the full filters (paid / shipped / delivered / canceled,
// creation dates, order), the list (getShopReceipts, 25 per page) and one
// order's detail.

import { useRef, useState } from 'react'
import type { Order, OrdersPage } from '@shared/features/orders'
import { localDaySec } from '@shared/features/orders'
import { formatEtsyDate } from '@shared/format'
import { Button, EmptyState, Field, Segmented, Select } from '../../ui'
import { featureCall } from '../call'
import { Card, Intro } from '../shopConfig/kit'
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

type Preset = 'all' | 'toShip' | 'shipped' | 'canceled'

/** The quick views: the status filters each sets (dates and order stay). */
const PRESETS: Record<Preset, Pick<OrderForm, 'paid' | 'shipped' | 'delivered' | 'canceled'>> = {
  all: { paid: '', shipped: '', delivered: '', canceled: '' },
  toShip: { paid: 'yes', shipped: 'no', delivered: '', canceled: 'no' },
  shipped: { paid: '', shipped: 'yes', delivered: '', canceled: 'no' },
  canceled: { paid: '', shipped: '', delivered: '', canceled: 'yes' }
}

const presetOf = (f: OrderForm): Preset | '' =>
  (Object.keys(PRESETS) as Preset[]).find((k) => {
    const p = PRESETS[k]
    return p.paid === f.paid && p.shipped === f.shipped && p.delivered === f.delivered && p.canceled === f.canceled
  }) ?? ''

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

function TriSelect({
  id,
  label,
  value,
  yes,
  no,
  onChange,
  glossary
}: {
  id: string
  label: string
  value: Tri
  yes: string
  no: string
  onChange: (v: Tri) => void
  glossary: 'features.orders.paid' | 'features.orders.shipped' | 'features.orders.delivered' | 'features.orders.canceled'
}): JSX.Element {
  return (
    <Field label={label} id={id} glossary={glossary}>
      <Select value={value} onChange={(v) => onChange(v as Tri)} fullWidth>
        <option value="">усі</option>
        <option value="yes">{yes}</option>
        <option value="no">{no}</option>
      </Select>
    </Field>
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
  const [applied, setApplied] = useState<OrderForm>(EMPTY)
  const set = <K extends keyof OrderForm>(k: K, v: OrderForm[K]): void => setForm((f) => ({ ...f, [k]: v }))

  const applyForm = (f: OrderForm): void => {
    generation.current++
    setMore([])
    setMoreError(null)
    setLoadingMore(false)
    setApplied(f)
    const q = orderQuery(f)
    if (JSON.stringify(q) === JSON.stringify(query)) page.reload()
    else setQuery(q)
  }
  const apply = (): void => applyForm(form)
  const preset = (p: Preset): void => {
    const f = { ...form, ...PRESETS[p] }
    setForm(f)
    applyForm(f)
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
  const dirty = JSON.stringify(form) !== JSON.stringify(applied)
  return (
    <div className="fx-page" data-testid="orders-tab">
      <Intro title="Замовлення" glossary="orders" icon="receipt">
        Усі покупки у вашому магазині: хто купив, що, на яку суму і чи відправлено. Відкрийте замовлення, щоб побачити адресу і позначити його
        відправленим.
      </Intro>

      <div className="ord-toolbar">
        <Segmented
          label="Швидкий вибір"
          size="sm"
          value={presetOf(applied) as Preset}
          onChange={preset}
          options={[
            { value: 'all', label: 'Усі' },
            { value: 'toShip', label: 'Треба відправити', icon: 'truck', hint: 'Оплачені, ще не відправлені й не скасовані — їх чекають покупці.' },
            { value: 'shipped', label: 'Відправлено' },
            { value: 'canceled', label: 'Скасовано' }
          ]}
        />
      </div>

      <details className="ord-filters" data-testid="orders-filters">
        <summary>
          Фільтри і порядок
          {dirty && <span className="fx-meta"> · є незастосовані зміни</span>}
        </summary>
        <Card tone="form">
          <div className="ui-form-grid ord-filter-grid">
            <TriSelect id="orders-paid" label="Оплата" glossary="features.orders.paid" value={form.paid} yes="оплачені" no="неоплачені" onChange={(v) => set('paid', v)} />
            <TriSelect
              id="orders-shipped"
              label="Відправка"
              glossary="features.orders.shipped"
              value={form.shipped}
              yes="відправлені"
              no="не відправлені"
              onChange={(v) => set('shipped', v)}
            />
            <TriSelect
              id="orders-delivered"
              label="Доставка"
              glossary="features.orders.delivered"
              value={form.delivered}
              yes="доставлені"
              no="не доставлені"
              onChange={(v) => set('delivered', v)}
            />
            <TriSelect
              id="orders-canceled"
              label="Скасовані"
              glossary="features.orders.canceled"
              value={form.canceled}
              yes="лише скасовані"
              no="без скасованих"
              onChange={(v) => set('canceled', v)}
            />
            <Field label="Від дати" id="orders-from" hint="Коли замовлення оформили.">
              <input type="date" value={form.from} onChange={(e) => set('from', e.target.value)} />
            </Field>
            <Field label="До дати" id="orders-to">
              <input type="date" value={form.to} onChange={(e) => set('to', e.target.value)} />
            </Field>
            <Field label="Порядок" id="orders-sort">
              <Select value={form.sort} onChange={(v) => set('sort', v as Sort)} fullWidth>
                <option value="new">спершу нові</option>
                <option value="old">спершу старі</option>
                <option value="updated">нещодавно змінені</option>
              </Select>
            </Field>
          </div>
          <div className="fx-card-foot">
            <Button variant="primary" icon="filter" onClick={apply}>
              Показати
            </Button>
            <Button
              variant="ghost"
              disabled={JSON.stringify(form) === JSON.stringify(EMPTY)}
              onClick={() => {
                setForm(EMPTY)
                applyForm(EMPTY)
              }}
            >
              Скинути фільтри
            </Button>
          </div>
        </Card>
      </details>

      <Alert text={page.error} title="Не вдалося завантажити замовлення" />
      {page.loading && <Loading>Завантаження замовлень…</Loading>}
      {page.value && !page.loading && (
        <>
          <div className="ord-count fx-muted">Знайдено замовлень: {total}</div>
          {orders.length === 0 ? (
            <EmptyState compact icon="receipt" title="Замовлень немає.">
              {presetOf(applied) === 'all' && !applied.from && !applied.to ? 'Коли хтось купить у вашому магазині, замовлення з’явиться тут.' : 'Спробуйте інший фільтр.'}
            </EmptyState>
          ) : (
            <ul className="ord-list" aria-label="Замовлення" data-testid="orders-list">
              {orders.map((o) => (
                <li key={o.receiptId} className="ord-row" data-testid={`order-row-${o.receiptId}`}>
                  <div className="ord-row-main min-w-0">
                    <div className="ord-row-title">
                      <span className="fx-title">#{o.receiptId}</span>
                      <span className="truncate ord-buyer" title={o.buyerName ?? undefined}>
                        {o.buyerName ?? '—'}
                      </span>
                    </div>
                    <div className="fx-meta">
                      <span className="num">{formatEtsyDate(o.createdAt)}</span> · товарів: <span className="num">{o.itemCount}</span>
                    </div>
                  </div>
                  <div className="ord-row-sum num">{fmtMoney(o.totals.grandTotal)}</div>
                  <div className="ord-row-status">
                    <OrderBadges o={o} />
                  </div>
                  <Button
                    size="sm"
                    icon="chevron-right"
                    className="ord-row-open"
                    aria-label={`Відкрити замовлення #${o.receiptId}`}
                    onClick={() => setOpen(o.receiptId)}
                  >
                    Відкрити
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {orders.length < total && (
            <div className="fx-center">
              <Button busy={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? 'Завантаження…' : 'Показати ще'}
              </Button>
              <span className="fx-meta">
                показано {orders.length} з {total}
              </span>
            </div>
          )}
          <Alert text={moreError} />
        </>
      )}
    </div>
  )
}
