// "Мій магазин" → "Фінанси": the payment-account ledger for a chosen period
// (date, description, amount, balance), totals per entry type, and per entry:
// its payments, the related (parent) entry, the sale it refers to; plus the
// period's sales per listing.

import { useState } from 'react'
import type { LedgerEntry, LedgerPage, OrderItem, OrderPayment, SalesSummary } from '@shared/features/orders'
import { localDate, localDaySec } from '@shared/features/orders'
import { formatEtsyDate } from '@shared/format'
import { LazyDetails } from '../LazyDetails'
import { Alert, Loading, PaymentsList, fmtMoney, fmtMoneys, useOrders } from './common'

const DAY_MS = 86_400_000
/** The default period: the last 30 days. */
export const FINANCE_DAYS = 30

type Open = { entryId: number; kind: 'payments' | 'parent' | 'sale' }

/** A ledger entry refers to a sale (its reference_type names a transaction and the id is a number). */
export const saleRef = (e: LedgerEntry): number | null =>
  e.referenceType && /transaction/i.test(e.referenceType) && e.referenceId && /^\d+$/.test(e.referenceId) ? Number(e.referenceId) : null

function EntryPayments({ entryId }: { entryId: number }): JSX.Element {
  const p = useOrders<OrderPayment[]>('ledgerPayments', { entryId })
  if (p.error) return <Alert text={p.error} />
  if (!p.value) return <Loading />
  return <PaymentsList payments={p.value} />
}

function ParentEntry({ entryId }: { entryId: number }): JSX.Element {
  const e = useOrders<LedgerEntry>('ledgerEntry', { entryId })
  if (e.error) return <Alert text={e.error} />
  if (!e.value) return <Loading />
  const x = e.value
  return (
    <div className="hint" data-testid={`parent-${entryId}`}>
      Запис #{x.entryId} · {formatEtsyDate(x.createdAt)} · {x.description || x.type} · {fmtMoney(x.amount)}
    </div>
  )
}

function SaleRef({ transactionId }: { transactionId: number }): JSX.Element {
  const s = useOrders<OrderItem>('sale', { transactionId })
  if (s.error) return <Alert text={s.error} />
  if (!s.value) return <Loading />
  const t = s.value
  return (
    <div className="hint" data-testid={`sale-${transactionId}`}>
      {t.title} · {t.quantity} шт. × {fmtMoney(t.price)}
      {t.receiptId != null && ` · замовлення #${t.receiptId}`} · {formatEtsyDate(t.createdAt)}
    </div>
  )
}

function SalesByListing({ minCreated, maxCreated }: { minCreated: number; maxCreated: number }): JSX.Element {
  const s = useOrders<SalesSummary>('sales', { minCreated, maxCreated })
  if (s.error) return <Alert text={s.error} />
  if (!s.value) return <Loading />
  const v = s.value
  return (
    <div data-testid="sales-by-listing">
      <div className="hint">
        Продажів: {v.sales}, продано шт.: {v.quantity}, виручка: {fmtMoneys(v.revenue)} (ціна × кількість, без доставки, податків і знижок).
      </div>
      <div className="hint">
        За замовленнями цього періоду: без скасованих і повністю повернутих{v.excludedOrders > 0 && ` (повернутих пропущено: ${v.excludedOrders})`}; частково
        повернуті враховано повністю.
      </div>
      {v.truncated && (
        <div className="hint warn">
          Прочитано лише {v.ordersRead} найновіших замовлень із {v.ordersTotal} — старіші замовлення цього періоду не враховано. Виберіть коротший період.
        </div>
      )}
      {v.products.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Товар</th>
              <th>Продажів</th>
              <th>Шт.</th>
              <th>Виручка</th>
              <th>Останній продаж</th>
            </tr>
          </thead>
          <tbody>
            {v.products.map((p) => (
              <tr key={p.listingId ?? p.title}>
                <td>{p.title}</td>
                <td>{p.sales}</td>
                <td>{p.quantity}</td>
                <td>{fmtMoneys(p.revenue)}</td>
                <td>{formatEtsyDate(p.lastSaleAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function FinanceTab({ now = Date.now() }: { now?: number } = {}): JSX.Element {
  const [from, setFrom] = useState(() => localDate(now - FINANCE_DAYS * DAY_MS))
  const [to, setTo] = useState(() => localDate(now))
  const [range, setRange] = useState(() => ({ minCreated: localDaySec(localDate(now - FINANCE_DAYS * DAY_MS)), maxCreated: localDaySec(localDate(now), true) }))
  const [formError, setFormError] = useState<string | null>(null)
  const [open, setOpen] = useState<Open | null>(null)
  const ledger = useOrders<LedgerPage>('ledger', range)

  const apply = (): void => {
    const minCreated = localDaySec(from)
    const maxCreated = localDaySec(to, true)
    if (minCreated == null || maxCreated == null) return setFormError('Вкажіть обидві дати.')
    if (minCreated > maxCreated) return setFormError('Дата «від» пізніше за дату «до».')
    setFormError(null)
    setOpen(null)
    if (minCreated === range.minCreated && maxCreated === range.maxCreated) ledger.reload()
    else setRange({ minCreated, maxCreated })
  }
  const toggle = (o: Open): void => setOpen((cur) => (cur && cur.entryId === o.entryId && cur.kind === o.kind ? null : o))

  const page = ledger.value
  return (
    <div data-testid="finance-tab">
      <div className="field-row orders-filters">
        <div className="field">
          <label htmlFor="finance-from">Від дати</label>
          <input id="finance-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="finance-to">До дати</label>
          <input id="finance-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className="settings-actions">
        <button className="btn primary" onClick={apply}>
          Показати
        </button>
      </div>
      <Alert text={formError ?? ledger.error} />
      {ledger.loading && <Loading />}
      {page && !ledger.loading && (
        <>
          <div className="hint">Записів за період: {page.total}</div>
          {page.truncated && <div className="hint warn">Показано лише {page.entries.length} записів — виберіть коротший період, щоб побачити всі.</div>}
          {page.totals.length > 0 && (
            <>
              <h4>Підсумки за типами</h4>
              <table className="data-table" data-testid="ledger-totals">
                <thead>
                  <tr>
                    <th>Тип</th>
                    <th>Записів</th>
                    <th>Сума</th>
                  </tr>
                </thead>
                <tbody>
                  {page.totals.map((t) => (
                    <tr key={`${t.type}:${t.sum.currency}`}>
                      <td>{t.type}</td>
                      <td>{t.count}</td>
                      <td>{fmtMoney(t.sum)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <h4>Записи</h4>
          {page.entries.length === 0 ? (
            <div className="hint">За цей період записів немає.</div>
          ) : (
            <table className="data-table" data-testid="ledger-entries">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Опис</th>
                  <th>Сума</th>
                  <th>Баланс</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {page.entries.map((e) => {
                  const sale = saleRef(e)
                  return [
                    <tr key={e.entryId} data-testid={`entry-${e.entryId}`}>
                      <td>{formatEtsyDate(e.createdAt)}</td>
                      <td>
                        {e.description || '—'}
                        {e.type && e.type !== e.description && <div className="dim">{e.type}</div>}
                      </td>
                      <td className={e.amount.amount < 0 ? 'err' : 'ok'}>{fmtMoney(e.amount)}</td>
                      <td>{fmtMoney(e.balance)}</td>
                      <td className="orders-actions">
                        <button className="btn small" onClick={() => toggle({ entryId: e.entryId, kind: 'payments' })}>
                          Платежі
                        </button>
                        {e.parentEntryId != null && (
                          <button className="btn small" onClick={() => toggle({ entryId: e.entryId, kind: 'parent' })}>
                            Пов’язаний запис
                          </button>
                        )}
                        {sale != null && (
                          <button className="btn small" onClick={() => toggle({ entryId: e.entryId, kind: 'sale' })}>
                            Продаж
                          </button>
                        )}
                      </td>
                    </tr>,
                    open?.entryId === e.entryId && (
                      <tr key={`${e.entryId}-open`} className="orders-subrow">
                        <td colSpan={5}>
                          {open.kind === 'payments' && <EntryPayments entryId={e.entryId} />}
                          {open.kind === 'parent' && e.parentEntryId != null && <ParentEntry entryId={e.parentEntryId} />}
                          {open.kind === 'sale' && sale != null && <SaleRef transactionId={sale} />}
                        </td>
                      </tr>
                    )
                  ]
                })}
              </tbody>
            </table>
          )}
          <LazyDetails label="Продажі за товарами за цей період" testId="finance-sales" key={`${page.minCreated}-${page.maxCreated}`}>
            {() => <SalesByListing minCreated={page.minCreated} maxCreated={page.maxCreated} />}
          </LazyDetails>
        </>
      )}
    </div>
  )
}
