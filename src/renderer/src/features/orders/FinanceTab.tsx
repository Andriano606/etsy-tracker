// "Мій магазин" → "Фінанси": the payment-account ledger for a chosen period
// (quick periods or dates): what came in, what went out, the balance; totals
// per entry type; the entries (date, description, signed amount, balance) and
// per entry: its payments, the related (parent) entry, the sale it refers to;
// plus the period's sales per listing.

import { useState } from 'react'
import type { LedgerEntry, LedgerPage, OrderItem, OrderMoney, OrderPayment, SalesSummary } from '@shared/features/orders'
import { addByCurrency, localDate, localDaySec } from '@shared/features/orders'
import { formatEtsyDate } from '@shared/format'
import { Button, EmptyState, Field, Segmented, Stat } from '../../ui'
import { LazyDetails } from '../LazyDetails'
import { DataTable, Intro, Note as InfoNote, Td } from '../shopConfig/kit'
import { Alert, Loading, PaymentsList, fmtMoney, fmtMoneys, signedMoney, useOrders } from './common'

const DAY_MS = 86_400_000
/** The default period: the last 30 days. */
export const FINANCE_DAYS = 30
const QUICK = [7, 30, 90] as const

type Open = { entryId: number; kind: 'payments' | 'parent' | 'sale' }

/** A ledger entry refers to a sale (its reference_type names a transaction and the id is a number). */
export const saleRef = (e: LedgerEntry): number | null =>
  e.referenceType && /transaction/i.test(e.referenceType) && e.referenceId && /^\d+$/.test(e.referenceId) ? Number(e.referenceId) : null

/** Etsy's ledger types we can name in Ukrainian (lower-case keys); others are shown as Etsy wrote them. */
const LEDGER_TYPE: Record<string, string> = {
  payment: 'Оплата замовлення',
  sale: 'Оплата замовлення',
  transaction: 'Комісія за продаж',
  transaction_quantity: 'Комісія за продаж',
  shipping_transaction: 'Комісія з доставки',
  listing: 'Плата за розміщення',
  renew: 'Поновлення товару',
  renew_sold: 'Поновлення після продажу',
  renew_sold_auto: 'Поновлення після продажу',
  renew_expired: 'Поновлення товару',
  payment_processing_fee: 'Комісія за обробку платежу',
  prolist: 'Реклама на Etsy',
  offsite_ads_fee: 'Зовнішня реклама Etsy',
  vat_tax_ep: 'ПДВ на комісії Etsy',
  sales_tax: 'Податок з продажу',
  disburse: 'Виплата на ваш рахунок',
  disburse2: 'Виплата на ваш рахунок',
  refund: 'Повернення покупцю',
  shipping_labels: 'Етикетки доставки',
  shipping_label: 'Етикетка доставки'
}
export const ledgerTypeLabel = (t: string): string | null => LEDGER_TYPE[t.toLowerCase()] ?? null

/** A payout of the seller's own money to their bank card (Etsy's disburse* types) — not a cost. */
export const isPayout = (e: Pick<LedgerEntry, 'type'>): boolean => /^disburse/i.test(e.type ?? '')

function Amount({ m }: { m: OrderMoney }): JSX.Element {
  return <span className={'num fx-amount ' + (m.amount < 0 ? 'is-out' : m.amount > 0 ? 'is-in' : '')}>{signedMoney(m)}</span>
}

/** The type in Ukrainian (Etsy's own code only as a tooltip); an unknown type as Etsy wrote it. */
function TypeName({ type }: { type: string }): JSX.Element {
  const uk = ledgerTypeLabel(type)
  return uk ? <span title={`Тип в Etsy: ${type}`}>{uk}</span> : <>{type || '—'}</>
}

function EntryPayments({ entryId }: { entryId: number }): JSX.Element {
  const p = useOrders<OrderPayment[]>('ledgerPayments', { entryId })
  if (p.error) return <Alert text={p.error} />
  if (!p.value) return <Loading>Завантаження платежів…</Loading>
  return <PaymentsList payments={p.value} />
}

function ParentEntry({ entryId }: { entryId: number }): JSX.Element {
  const e = useOrders<LedgerEntry>('ledgerEntry', { entryId })
  if (e.error) return <Alert text={e.error} />
  if (!e.value) return <Loading />
  const x = e.value
  return (
    <div className="ord-sub" data-testid={`parent-${entryId}`}>
      Запис #{x.entryId} · {formatEtsyDate(x.createdAt)} · {x.description || x.type} · {signedMoney(x.amount)}
    </div>
  )
}

function SaleRef({ transactionId }: { transactionId: number }): JSX.Element {
  const s = useOrders<OrderItem>('sale', { transactionId })
  if (s.error) return <Alert text={s.error} />
  if (!s.value) return <Loading />
  const t = s.value
  return (
    <div className="ord-sub" data-testid={`sale-${transactionId}`}>
      {t.title} · {t.quantity} шт. × {fmtMoney(t.price)}
      {t.receiptId != null && ` · замовлення #${t.receiptId}`} · {formatEtsyDate(t.createdAt)}
    </div>
  )
}

function SalesByListing({ minCreated, maxCreated }: { minCreated: number; maxCreated: number }): JSX.Element {
  const s = useOrders<SalesSummary>('sales', { minCreated, maxCreated })
  if (s.error) return <Alert text={s.error} />
  if (!s.value) return <Loading>Підрахунок продажів…</Loading>
  const v = s.value
  return (
    <div className="fx-page fx-page--compact" data-testid="sales-by-listing">
      <div className="ui-stat-grid">
        <Stat compact label="Продажів" glossary="transaction" value={v.sales} />
        <Stat compact label="Продано шт." glossary="features.orders.unitsSold" value={v.quantity} />
        <Stat compact label="Виручка" glossary="features.orders.revenue" value={fmtMoneys(v.revenue)} />
      </div>
      <p className="fx-muted">
        Виручка — ціна × кількість, без доставки, податків і знижок. Враховано замовлення цього періоду, крім скасованих і повністю повернутих
        {v.excludedOrders > 0 && ` (повернутих пропущено: ${v.excludedOrders})`}; частково повернуті враховано повністю.
      </p>
      {v.truncated && (
        <InfoNote tone="warn">
          Прочитано лише {v.ordersRead} найновіших замовлень із {v.ordersTotal} — старіші замовлення цього періоду не враховано. Виберіть коротший період.
        </InfoNote>
      )}
      {v.products.length > 0 && (
        <DataTable
          label="Продажі за товарами"
          stack="lg"
          columns={[
            { label: 'Товар' },
            { label: 'Продажів', align: 'end' },
            { label: 'Шт.', align: 'end' },
            { label: 'Виручка', align: 'end' },
            { label: 'Останній продаж' }
          ]}
        >
          {v.products.map((p) => (
            <tr key={p.listingId ?? p.title}>
              <Td label="Товар" primary>
                <span className="clamp-2 fx-title" title={p.title}>
                  {p.title}
                </span>
              </Td>
              <Td label="Продажів" align="end">
                <span className="num">{p.sales}</span>
              </Td>
              <Td label="Шт." align="end">
                <span className="num">{p.quantity}</span>
              </Td>
              <Td label="Виручка" align="end">
                <span className="num">{fmtMoneys(p.revenue)}</span>
              </Td>
              <Td label="Останній продаж">
                <span className="num">{formatEtsyDate(p.lastSaleAt)}</span>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  )
}

/**
 * Money in and out of the period (per currency): what came in, what Etsy took
 * (fees, ads, refunds, taxes), what is left of it (earned), the payouts to the
 * seller's own card apart — they are the seller's money moving, not a cost —
 * and the balance after the newest entry.
 */
function Summary({ page }: { page: LedgerPage }): JSX.Element | null {
  if (!page.entries.length) return null
  let income: OrderMoney[] = []
  let expense: OrderMoney[] = []
  let payouts: OrderMoney[] = []
  for (const e of page.entries) {
    if (e.amount.amount > 0) income = addByCurrency(income, e.amount)
    else if (e.amount.amount < 0) {
      if (isPayout(e)) payouts = addByCurrency(payouts, e.amount)
      else expense = addByCurrency(expense, e.amount)
    }
  }
  const earned = expense.reduce(addByCurrency, income)
  const newest = [...page.entries].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || (b.sequence ?? 0) - (a.sequence ?? 0))[0]
  const signed = (list: OrderMoney[]): string => (list.length ? list.map(signedMoney).join(' · ') : '0')
  return (
    <div className="ui-stat-grid" data-testid="ledger-summary">
      <Stat compact icon="plus" label="Надійшло" glossary="features.orders.income" value={<span className="fx-amount is-in">{signed(income)}</span>} />
      <Stat compact icon="minus" label="Списано" glossary="features.orders.expense" value={<span className="fx-amount is-out">{signed(expense)}</span>} />
      <Stat
        compact
        icon="money"
        label="Заробили"
        glossary="features.orders.earned"
        value={<span className={'fx-amount ' + (earned.some((m) => m.amount < 0) ? 'is-out' : 'is-in')}>{signed(earned)}</span>}
        caption="надійшло мінус списано"
      />
      {payouts.length > 0 && (
        <Stat
          compact
          icon="arrow-up"
          label="Виплачено на картку"
          glossary="features.orders.payout"
          value={<span className="fx-amount">{payouts.map((m) => fmtMoney({ ...m, amount: -m.amount })).join(' · ')}</span>}
          caption="ваші гроші, не витрата"
        />
      )}
      <Stat
        compact
        icon="wallet"
        label="Баланс"
        glossary="balance"
        value={newest.balance ? fmtMoney(newest.balance) : '—'}
        caption={`після запису від ${formatEtsyDate(newest.createdAt)}`}
      />
    </div>
  )
}

export function FinanceTab({ now = Date.now() }: { now?: number } = {}): JSX.Element {
  const today = localDate(now)
  const daysAgo = (n: number): string => localDate(now - n * DAY_MS)
  const [from, setFrom] = useState(() => daysAgo(FINANCE_DAYS))
  const [to, setTo] = useState(today)
  const [range, setRange] = useState(() => ({ minCreated: localDaySec(daysAgo(FINANCE_DAYS)), maxCreated: localDaySec(today, true) }))
  const [formError, setFormError] = useState<string | null>(null)
  const [open, setOpen] = useState<Open | null>(null)
  const ledger = useOrders<LedgerPage>('ledger', range)

  const applyDates = (f: string, t: string): void => {
    const minCreated = localDaySec(f)
    const maxCreated = localDaySec(t, true)
    if (minCreated == null || maxCreated == null) return setFormError('Вкажіть обидві дати.')
    if (minCreated > maxCreated) return setFormError('Дата «від» пізніше за дату «до».')
    setFormError(null)
    setOpen(null)
    if (minCreated === range.minCreated && maxCreated === range.maxCreated) ledger.reload()
    else setRange({ minCreated, maxCreated })
  }
  const apply = (): void => applyDates(from, to)
  const quick = (v: string): void => {
    const f = daysAgo(Number(v))
    setFrom(f)
    setTo(today)
    applyDates(f, today)
  }
  const quickValue = to === today ? (QUICK.find((n) => daysAgo(n) === from) ?? '') : ''
  const toggle = (o: Open): void => setOpen((cur) => (cur && cur.entryId === o.entryId && cur.kind === o.kind ? null : o))
  const isOpen = (entryId: number, kind: Open['kind']): boolean => open?.entryId === entryId && open.kind === kind

  const page = ledger.value
  return (
    <div className="fx-page" data-testid="finance-tab">
      <Intro title="Рух коштів" glossary="ledger" icon="wallet">
        Кожна операція на вашому рахунку в Etsy: оплати замовлень (+), комісії, плата за розміщення й рекламу, виплати на картку (−). Так видно,
        скільки ви насправді заробили за період.
      </Intro>

      <div className="ord-period" role="group" aria-label="Період">
        <div className="ui-field">
          <div className="ui-field-head">
            <span className="ui-field-label" aria-hidden="true">
              Період
            </span>
          </div>
          <Segmented
            label="Швидкий період"
            value={String(quickValue)}
            onChange={quick}
            options={QUICK.map((n) => ({ value: String(n), label: `${n} дн.`, hint: `Останні ${n} днів до сьогодні` }))}
          />
        </div>
        <Field label="Від дати" id="finance-from">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="До дати" id="finance-to">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Button variant="primary" onClick={apply}>
          Показати
        </Button>
      </div>

      <Alert text={formError ?? ledger.error} />
      {ledger.loading && <Loading>Завантаження записів…</Loading>}
      {page && !ledger.loading && (
        <>
          <Summary page={page} />
          <div className="fx-muted">Записів за період: {page.total}</div>
          {page.truncated && (
            <InfoNote tone="warn">Показано лише {page.entries.length} записів — виберіть коротший період, щоб побачити всі.</InfoNote>
          )}
          {page.totals.length > 0 && (
            <section className="fx-block">
              <h4 className="fx-subhead">Підсумки за типами операцій</h4>
              <DataTable
                label="Підсумки за типами"
                testId="ledger-totals"
                stack="sm"
                columns={[
                  { label: 'Тип', glossary: 'features.orders.ledgerType' },
                  { label: 'Записів', align: 'end' },
                  { label: 'Сума', align: 'end' }
                ]}
              >
                {page.totals.map((t) => (
                  <tr key={`${t.type}:${t.sum.currency}`}>
                    <Td label="Тип" primary>
                      <TypeName type={t.type} />
                    </Td>
                    <Td label="Записів" align="end">
                      <span className="num">{t.count}</span>
                    </Td>
                    <Td label="Сума" align="end">
                      <Amount m={t.sum} />
                    </Td>
                  </tr>
                ))}
              </DataTable>
            </section>
          )}
          <section className="fx-block">
            <h4 className="fx-subhead">Записи</h4>
            {page.entries.length === 0 ? (
              <EmptyState compact icon="wallet" title="За цей період записів немає.">
                Виберіть довший період.
              </EmptyState>
            ) : (
              <ul className="ord-ledger" aria-label="Записи руху коштів" data-testid="ledger-entries">
                {page.entries.map((e) => {
                  const sale = saleRef(e)
                  const typeUk = e.type ? ledgerTypeLabel(e.type) : null
                  // Ukrainian first; Etsy's English description is the second line.
                  const title = typeUk ?? (e.description || e.type || '—')
                  const original = typeUk && e.description ? e.description : null
                  const link = (kind: Open['kind'], text: string): JSX.Element => (
                    <button
                      type="button"
                      className={'ord-link' + (isOpen(e.entryId, kind) ? ' is-on' : '')}
                      aria-expanded={isOpen(e.entryId, kind)}
                      onClick={() => toggle({ entryId: e.entryId, kind })}
                    >
                      {text}
                    </button>
                  )
                  return (
                    <li key={e.entryId} className={'ord-entry' + (open?.entryId === e.entryId ? ' is-open' : '')} data-testid={`entry-${e.entryId}`}>
                      <div className="ord-entry-main min-w-0">
                        <div className="fx-title clamp-2" title={e.type ? `Тип в Etsy: ${e.type}` : undefined}>
                          {title}
                        </div>
                        <div className="ord-entry-meta">
                          <span className="num">{formatEtsyDate(e.createdAt)}</span>
                          {original && (
                            <span className="ord-entry-orig truncate" title={`Як записав Etsy: ${original}`}>
                              {original}
                            </span>
                          )}
                          <span className="ord-entry-links">
                            {link('payments', 'Платежі')}
                            {e.parentEntryId != null && link('parent', 'Пов’язаний запис')}
                            {sale != null && link('sale', 'Продаж')}
                          </span>
                        </div>
                      </div>
                      <div className="ord-entry-sum">
                        <Amount m={e.amount} />
                        <span className="fx-meta num">баланс {fmtMoney(e.balance)}</span>
                      </div>
                      {open?.entryId === e.entryId && (
                        <div className="ord-entry-open">
                          {open.kind === 'payments' && <EntryPayments entryId={e.entryId} />}
                          {open.kind === 'parent' && e.parentEntryId != null && <ParentEntry entryId={e.parentEntryId} />}
                          {open.kind === 'sale' && sale != null && <SaleRef transactionId={sale} />}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
          <LazyDetails
            label="Продажі за товарами за цей період"
            icon="stats"
            description="Які товари продавались найкраще: кількість продажів, штук і виручка кожного."
            testId="finance-sales"
            key={`${page.minCreated}-${page.maxCreated}`}
          >
            {() => <SalesByListing minCreated={page.minCreated} maxCreated={page.maxCreated} />}
          </LazyDetails>
        </>
      )}
    </div>
  )
}
