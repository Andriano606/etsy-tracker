// "Ціни й залишки" in "Мій магазин": the active listings with their price
// range and total quantity; a listing without variations can be changed here.

import { useEffect, useState } from 'react'
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
import { featureCall } from '../call'

const money = (m: InvMoney): string => formatPrice(m.amount, m.divisor, m.currency)

export function priceRange(r: Pick<InventoryOverviewRow, 'priceMin' | 'priceMax'>): string {
  if (!r.priceMin || !r.priceMax) return '—'
  return moneyValue(r.priceMin) === moneyValue(r.priceMax) ? money(r.priceMin) : `${money(r.priceMin)} – ${money(r.priceMax)}`
}

function QuickEdit({ row, onSaved, onCancel }: { row: InventoryOverviewRow; onSaved: (inv: ListingInventory) => void; onCancel: () => void }): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)
  const single = row.single!
  const [price, setPrice] = useState(single.price ? String(moneyValue(single.price)) : '')
  const [quantity, setQuantity] = useState(String(single.quantity))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const p = parsePrice(price)
  const q = parseQuantity(quantity)
  const problems = [
    ...(p == null ? ['Ціна — додатне число, напр. 5.99.'] : []),
    ...(!Number.isSafeInteger(q) || q > INV_MAX_QUANTITY ? [`Кількість — ціле число від 0 до ${INV_MAX_QUANTITY}.`] : [])
  ]

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
    <div data-testid={`quick-edit-${row.listingId}`}>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`qe-price-${row.listingId}`}>Ціна{single.price && `, ${single.price.currency}`}</label>
          <input id={`qe-price-${row.listingId}`} value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`qe-qty-${row.listingId}`}>Кількість</label>
          <input id={`qe-qty-${row.listingId}`} value={quantity} inputMode="numeric" onChange={(e) => setQuantity(e.target.value)} />
        </div>
      </div>
      {problems.map((x) => (
        <div key={x} className="hint warn">
          {x}
        </div>
      ))}
      {error && (
        <div className="test-result err" role="alert">
          {error}
        </div>
      )}
      <div className="settings-actions">
        <button className="btn small primary" disabled={problems.length > 0 || saving} onClick={() => void save()}>
          {saving ? 'Збереження…' : 'Зберегти'}
        </button>
        <button className="btn small" disabled={saving} onClick={onCancel}>
          Скасувати
        </button>
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
  }, [])

  if (!rows) {
    return error ? (
      <div className="test-result err" role="alert">
        {error}
      </div>
    ) : (
      <div className="hint">Завантаження…</div>
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
    <div data-testid="prices-tab">
      <p className="hint">
        Активні лістинги: ціна (від найнижчої до найвищої серед увімкнених варіантів) і загальна кількість. Лістинг без варіацій можна змінити тут; з
        варіаціями — у «Лістинги → Редагувати → Ціна, кількість і варіації».
      </p>
      {note && <div className="test-result ok">{note}</div>}
      {error && (
        <div className="test-result err" role="alert">
          {error}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="hint">Активних лістингів немає.</div>
      ) : (
        <table className="data-table inv-table">
          <thead>
            <tr>
              <th>Лістинг</th>
              <th className="num">Ціна</th>
              <th className="num">Кількість</th>
              <th className="num">Варіантів</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.listingId} data-testid={`prices-row-${r.listingId}`}>
                <td>
                  <div className="inv-title-cell">
                    {r.imageUrl ? <img src={r.imageUrl} alt="" /> : <span className="thumb-empty" />}
                    <span>{r.title || '(без назви)'}</span>
                  </div>
                  {editing === r.listingId && <QuickEdit row={r} onSaved={(inv) => saved(r, inv)} onCancel={() => setEditing(null)} />}
                </td>
                <td className="num">{priceRange(r)}</td>
                <td className="num">{r.totalQuantity}</td>
                <td className="num">{r.hasInventory ? r.productCount : '—'}</td>
                <td>
                  {r.single && editing !== r.listingId && (
                    <button
                      className="btn small"
                      aria-label={`Змінити ціну й кількість: ${r.title}`}
                      onClick={() => {
                        setEditing(r.listingId)
                        setNote(null)
                      }}
                    >
                      Змінити
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length < total && (
        <button className="btn" disabled={loadingMore} onClick={() => void more()}>
          {loadingMore ? 'Завантаження…' : `Показати ще (${total - rows.length})`}
        </button>
      )}
    </div>
  )
}
