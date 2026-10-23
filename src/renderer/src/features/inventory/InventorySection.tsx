// "Ціна, кількість і варіації" under the own-listing editor: every product
// (variant) of the listing with its SKU, price, quantity and "показувати";
// "Зберегти на Etsy" sends the FULL inventory (updateListingInventory).

import { useEffect, useState } from 'react'
import {
  inventoryProblems,
  inventoryProperties,
  inventorySummary,
  inventoryToWrite,
  rowsFromInventory,
  writeFromRows,
  type InvOnProperty,
  type InvRowEdit,
  type ListingInventory
} from '@shared/features/inventory'
import type { MyListing } from '@shared/types'
import { useStore } from '../../store'
import { featureCall } from '../call'

type OnKey = keyof InvOnProperty

const ON_LABEL: Record<OnKey, string> = { price: 'Ціна', quantity: 'Кількість', sku: 'SKU' }

const valuesOf = (inv: ListingInventory, i: number, ids: number[]): string =>
  JSON.stringify(ids.map((id) => inv.products[i].propertyValues.find((v) => v.propertyId === id)?.values ?? null))

const rowName = (inv: ListingInventory, i: number): string =>
  inv.products[i].propertyValues.map((v) => v.values.join(', ')).join(' / ')

/** "1 варіант", "3 варіанти", "5 варіантів", "11 варіантів". */
function variantsText(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 14
  const word = !teen && n % 10 === 1 ? 'варіант' : !teen && n % 10 >= 2 && n % 10 <= 4 ? 'варіанти' : 'варіантів'
  return `${n} ${word}`
}

/** The listing row after a save: lowest enabled price and the total quantity. */
function listingAfter(listing: MyListing, inv: ListingInventory): MyListing {
  const s = inventorySummary(inv)
  return {
    ...listing,
    priceAmount: s.priceMin?.amount ?? listing.priceAmount,
    priceDivisor: s.priceMin?.divisor ?? listing.priceDivisor,
    currency: s.priceMin?.currency ?? listing.currency,
    quantity: s.totalQuantity
  }
}

export function InventorySection({ listing, onChanged }: { listing: MyListing; onChanged: (l?: MyListing) => void }): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [inv, setInv] = useState<ListingInventory | null>(null)
  const [rows, setRows] = useState<InvRowEdit[]>([])
  const [on, setOn] = useState<InvOnProperty>({ price: [], quantity: [], sku: [] })
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const reset = (i: ListingInventory): void => {
    setInv(i)
    setRows(rowsFromInventory(i))
    setOn({ price: i.priceOnProperty, quantity: i.quantityOnProperty, sku: i.skuOnProperty })
  }

  useEffect(() => {
    let alive = true
    void featureCall<ListingInventory>('inventory', 'get', { listingId: listing.listingId }).then((r) => {
      if (!alive) return
      if (r.ok) reset(r.value)
      else setError(r.error)
    })
    return () => {
      alive = false
    }
  }, [listing.listingId])

  if (!inv) {
    return error ? (
      <div className="test-result err" role="alert">
        {error}
      </div>
    ) : (
      <div className="hint">Завантаження…</div>
    )
  }
  if (!inv.products.length) return <div className="hint">Etsy не повернув жодного варіанта цього лістингу.</div>

  const props = inventoryProperties(inv.products)
  const write = writeFromRows(inv, rows, on)
  const problems = inventoryProblems(write).map((p) => p.uk)
  const changed = JSON.stringify(write) !== JSON.stringify(inventoryToWrite(inv))
  const currency = inventorySummary(inv).priceMin?.currency ?? listing.currency ?? ''

  /** A value that doesn't vary by an option is the same in every row sharing the options it does vary by. */
  const edit = (i: number, key: keyof InvRowEdit, value: string | boolean): void => {
    setNote(null)
    const ids = key === 'enabled' ? null : on[key]
    setRows((rs) => rs.map((r, j) => (j === i || (ids && valuesOf(inv, i, ids) === valuesOf(inv, j, ids)) ? { ...r, [key]: value } : r)))
  }

  const toggleOn = (key: OnKey, id: number, checked: boolean): void => {
    setNote(null)
    setOn((o) => ({ ...o, [key]: checked ? [...o[key], id] : o[key].filter((x) => x !== id) }))
  }

  const save = async (): Promise<void> => {
    const ok = await requestConfirm(
      `Зберегти ціни, кількість і SKU (${variantsText(inv.products.length)}) на Etsy?\n` +
        'Etsy замінить увесь інвентар лістингу — покупці одразу побачать зміни.'
    )
    if (!ok) return
    setSaving(true)
    setError(null)
    const r = await featureCall<ListingInventory>('inventory', 'update', { listingId: listing.listingId, inventory: write })
    setSaving(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    reset(r.value)
    setNote('Збережено на Etsy.')
    onChanged(listingAfter(listing, r.value))
  }

  return (
    <div data-testid="inventory-section">
      {props.length > 0 &&
        (Object.keys(ON_LABEL) as OnKey[]).map((key) => (
          <div className="inv-on" key={key}>
            <span>{ON_LABEL[key]} залежить від:</span>
            {props.map((p) => (
              <label className="check" key={p.propertyId}>
                <input type="checkbox" checked={on[key].includes(p.propertyId)} onChange={(e) => toggleOn(key, p.propertyId, e.target.checked)} />
                {p.name}
              </label>
            ))}
          </div>
        ))}
      <table className="data-table inv-table">
        <thead>
          <tr>
            {props.map((p) => (
              <th key={p.propertyId}>{p.name}</th>
            ))}
            <th>SKU</th>
            <th className="num">Ціна{currency && `, ${currency}`}</th>
            <th className="num">Кількість</th>
            <th>Показувати</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const name = rowName(inv, i)
            const label = (what: string): string => (name ? `${what}: ${name}` : what)
            return (
              <tr key={inv.products[i].productId ?? i}>
                {props.map((p) => (
                  <td key={p.propertyId}>{inv.products[i].propertyValues.find((v) => v.propertyId === p.propertyId)?.values.join(', ') ?? '—'}</td>
                ))}
                <td>
                  <input type="text" aria-label={label('SKU')} value={r.sku} onChange={(e) => edit(i, 'sku', e.target.value)} />
                </td>
                <td className="num inv-narrow">
                  <input type="text" inputMode="decimal" aria-label={label('Ціна')} value={r.price} onChange={(e) => edit(i, 'price', e.target.value)} />
                </td>
                <td className="num inv-narrow">
                  <input type="text" inputMode="numeric" aria-label={label('Кількість')} value={r.quantity} onChange={(e) => edit(i, 'quantity', e.target.value)} />
                </td>
                <td>
                  <input type="checkbox" aria-label={label('Показувати')} checked={r.enabled} onChange={(e) => edit(i, 'enabled', e.target.checked)} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {props.length > 0 && (
        <p className="hint">Значення, що не залежить від властивості, змінюється одразу в усіх відповідних варіантах.</p>
      )}
      {problems.length > 0 && (
        <ul className="hint warn" data-testid="inventory-problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {error && (
        <div className="test-result err" role="alert">
          {error}
        </div>
      )}
      {note && <div className="test-result ok">{note}</div>}
      <div className="settings-actions">
        <button className="btn primary" disabled={!changed || problems.length > 0 || saving} onClick={() => void save()}>
          {saving ? 'Збереження…' : 'Зберегти на Etsy'}
        </button>
        <button
          className="btn"
          disabled={!changed || saving}
          onClick={() => {
            reset(inv)
            setNote(null)
          }}
        >
          Скасувати зміни
        </button>
      </div>
    </div>
  )
}
