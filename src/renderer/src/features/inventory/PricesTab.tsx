// "Ціни й залишки" in "Мій магазин": the active listings with their price
// range and total quantity; a listing without variations can be changed here
// (an edit row opens under it). Wide: a table; narrow: every listing is a card.

import { Fragment, useEffect, useState } from 'react'
import {
  INV_MAX_QUANTITY,
  inventorySummary,
  moneyValue,
  parseQuantity,
  type InvMoney,
  type InventoryOverviewPage,
  type InventoryOverviewRow,
  type ListingInventory
} from '@shared/features/inventory'
import { formatPrice } from '@shared/format'
import { parsePrice } from '@shared/myShop'
import { useStore } from '../../store'
import { Badge, Button, Callout, EmptyState, Field, InfoTip, Loading, Term, ZoomImage } from '../../ui'
import { featureCall } from '../call'
import { priceInput, variantsText } from './InventorySection'

const money = (m: InvMoney): string => formatPrice(m.amount, m.divisor, m.currency)

export function priceRange(r: Pick<InventoryOverviewRow, 'priceMin' | 'priceMax'>): string {
  if (!r.priceMin || !r.priceMax) return '—'
  return moneyValue(r.priceMin) === moneyValue(r.priceMax) ? money(r.priceMin) : `${money(r.priceMin)} – ${money(r.priceMax)}`
}

const COLS = 5

function QuickEdit({ row, onSaved, onCancel }: { row: InventoryOverviewRow; onSaved: (inv: ListingInventory) => void; onCancel: () => void }): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)
  const single = row.single!
  const [price, setPrice] = useState(single.price ? priceInput(String(moneyValue(single.price))) : '')
  const [quantity, setQuantity] = useState(String(single.quantity))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const p = parsePrice(price)
  const q = parseQuantity(quantity)
  const priceProblem = p == null ? 'Ціна — додатне число, напр. 5,99.' : null
  const qtyProblem = !Number.isSafeInteger(q) || q > INV_MAX_QUANTITY ? `Кількість — ціле число від 0 до ${INV_MAX_QUANTITY}.` : null

  const save = async (): Promise<void> => {
    const shown = formatPrice(Math.round((p as number) * 100), 100, single.price?.currency ?? '')
    const ok = await requestConfirm(`Змінити «${row.title}» на Etsy?\nЦіна: ${shown}, кількість: ${q}. Покупці одразу побачать зміни.`)
    if (!ok) return
    setSaving(true)
    setError(null)
    const r = await featureCall<ListingInventory>('inventory', 'quickUpdate', { listingId: row.listingId, price: p, quantity: q })
    setSaving(false)
    if (r.ok) onSaved(r.value)
    else setError(r.error)
  }

  return (
    <div className="inv-quick" data-testid={`quick-edit-${row.listingId}`}>
      <div className="inv-quick-fields">
        <Field
          label={`Ціна${single.price ? `, ${single.price.currency}` : ''}`}
          id={`qe-price-${row.listingId}`}
          hint={priceProblem ? undefined : 'Ваша ціна без податку і знижок'}
          error={priceProblem}
        >
          <input value={price} inputMode="decimal" autoFocus onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="Кількість" id={`qe-qty-${row.listingId}`} hint={qtyProblem ? undefined : `Від 0 до ${INV_MAX_QUANTITY}`} error={qtyProblem}>
          <input value={quantity} inputMode="numeric" onChange={(e) => setQuantity(e.target.value)} />
        </Field>
      </div>
      {error && <Callout tone="error">{error}</Callout>}
      <div className="inv-actions">
        <Button variant="primary" size="sm" icon="upload" busy={saving} disabled={!!priceProblem || !!qtyProblem} onClick={() => void save()}>
          {saving ? 'Збереження…' : 'Зберегти'}
        </Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          Скасувати
        </Button>
      </div>
    </div>
  )
}

export function PricesTab(): JSX.Element {
  const [rows, setRows] = useState<InventoryOverviewRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    void featureCall<InventoryOverviewPage>('inventory', 'overview', { offset: 0 }).then((r) => {
      if (!alive) return
      if (r.ok) {
        setRows(r.value.rows)
        setTotal(r.value.total)
      } else setError(r.error)
    })
    return () => {
      alive = false
    }
  }, [attempt])

  if (!rows) {
    return error ? (
      <Callout
        tone="error"
        action={
          <Button size="sm" icon="refresh" onClick={() => {
              setError(null)
              setAttempt((n) => n + 1)
            }}>
            Спробувати ще
          </Button>
        }
      >
        {error}
      </Callout>
    ) : (
      <Loading>Завантаження цін і залишків…</Loading>
    )
  }

  const more = async (): Promise<void> => {
    setLoadingMore(true)
    setError(null)
    const r = await featureCall<InventoryOverviewPage>('inventory', 'overview', { offset: rows.length })
    setLoadingMore(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    const page = r.value.rows
    setRows((rs) => rs && [...rs, ...page.filter((x) => !rs.some((y) => y.listingId === x.listingId))])
    setTotal(r.value.total)
  }

  const saved = (row: InventoryOverviewRow, inv: ListingInventory): void => {
    setRows((rs) => rs && rs.map((x) => (x.listingId === row.listingId ? { ...x, ...inventorySummary(inv) } : x)))
    setEditing(null)
    setNote(`Збережено на Etsy: «${row.title}».`)
  }

  return (
    <div className="inv-prices" data-testid="prices-tab">
      <p className="inv-intro">
        Ваші <Term glossary="listingActive">активні товари</Term>: ціна (від найнижчої до найвищої серед показаних варіантів) і скільки одиниць можна
        купити зараз. Товар без варіантів можна змінити просто тут; з <Term glossary="variations">варіантами</Term> — у вкладці «Товари»: «Редагувати» →
        «Ціна, кількість і варіанти».
      </p>
      {note && (
        <Callout tone="success" compact onClose={() => setNote(null)}>
          {note}
        </Callout>
      )}
      {error && <Callout tone="error">{error}</Callout>}
      {rows.length === 0 ? (
        <EmptyState icon="box" title="Активних товарів немає.">
          Коли ви опублікуєте товар на Etsy, його ціна й кількість з’являться тут.
        </EmptyState>
      ) : (
        <div className="inv-ov">
          <table className="inv-ov-table">
            <thead>
              <tr>
                <th>Товар</th>
                <th className="num">
                  <span className="inv-th">
                    Ціна <InfoTip glossary="features.inventory.priceRange" size={13} />
                  </span>
                </th>
                <th className="num">
                  <span className="inv-th">
                    Кількість <InfoTip glossary="features.inventory.totalQuantity" size={13} />
                  </span>
                </th>
                <th className="num">
                  <span className="inv-th">
                    Варіантів <InfoTip glossary="variations" size={13} />
                  </span>
                </th>
                <th>
                  <span className="sr-only">Дії</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const title = r.title || '(без назви)'
                return (
                  <Fragment key={r.listingId}>
                    <tr data-testid={`prices-row-${r.listingId}`} className={editing === r.listingId ? 'is-editing' : undefined}>
                      <td className="inv-ov-title">
                        <div className="inv-title-cell">
                          {r.imageUrl ? (
                            <ZoomImage className="inv-ov-zoom" src={r.imageUrl} full={r.imageFullUrl ?? r.imageUrl} alt={`Головне фото: ${title}`} caption={title} />
                          ) : (
                            <span className="inv-thumb-empty" />
                          )}
                          <span className="clamp-2" title={title}>
                            {title}
                          </span>
                        </div>
                      </td>
                      <td className="num" data-label="Ціна">
                        {priceRange(r)}
                      </td>
                      <td className="num" data-label="Кількість">
                        {r.totalQuantity === 0 ? (
                          <Badge tone="warn">0 · розпродано</Badge>
                        ) : (
                          r.totalQuantity
                        )}
                      </td>
                      <td className="num" data-label="Варіантів">
                        {!r.hasInventory ? '—' : r.single ? <span className="inv-dim">немає</span> : r.productCount}
                      </td>
                      <td className="inv-ov-action">
                        {r.single ? (
                          editing !== r.listingId && (
                            <Button
                              size="sm"
                              icon="edit"
                              aria-label={`Змінити ціну й кількість: ${r.title}`}
                              onClick={() => {
                                setEditing(r.listingId)
                                setNote(null)
                              }}
                            >
                              Змінити
                            </Button>
                          )
                        ) : (
                          <span className="inv-ov-where">
                            Змінюйте{' '}
                            <Term text={`У товару ${variantsText(r.productCount)}: відкрийте вкладку «Товари» → «Редагувати» → «Ціна, кількість і варіанти».`}>
                              в редакторі
                            </Term>
                          </span>
                        )}
                      </td>
                    </tr>
                    {editing === r.listingId && (
                      <tr className="inv-ov-edit">
                        <td colSpan={COLS}>
                          <QuickEdit row={r} onSaved={(inv) => saved(r, inv)} onCancel={() => setEditing(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length < total && (
        <div className="inv-more">
          <Button icon="chevron-down" busy={loadingMore} onClick={() => void more()}>
            {loadingMore ? 'Завантаження…' : `Показати ще (${total - rows.length})`}
          </Button>
        </div>
      )}
    </div>
  )
}
