// "Ціна, кількість і варіації" under the own-listing editor: every product
// (variant) of the listing with its SKU, price, quantity and "показувати";
// an invalid price/quantity is marked on its field and listed (as a link to it)
// above the save button;
// "Зберегти на Etsy" sends the FULL inventory (updateListingInventory).
// Wide: a table; narrow (container query): every variant is a card.

import { useEffect, useState } from 'react'
import {
  INV_MAX_QUANTITY,
  inventoryProblems,
  inventoryProperties,
  inventorySummary,
  inventoryToWrite,
  parseQuantity,
  rowsFromInventory,
  writeFromRows,
  type InvMoney,
  type InvOnProperty,
  type InvRowEdit,
  type ListingInventory
} from '@shared/features/inventory'
import { formatPrice } from '@shared/format'
import { parsePrice } from '@shared/myShop'
import type { MyListing } from '@shared/types'
import { useStore } from '../../store'
import { Badge, Button, Callout, EmptyState, InfoTip, Loading, Term, Toggle } from '../../ui'
import { featureCall } from '../call'

type OnKey = keyof InvOnProperty

/** The "depends on" rows: what the value is and how the matrix names it. */
const ON_ROWS: Array<{ key: OnKey; label: string; name: string }> = [
  { key: 'price', label: 'Ціна', name: 'Ціна' },
  { key: 'quantity', label: 'Кількість', name: 'Кількість' },
  { key: 'sku', label: 'Артикул', name: 'Артикул' }
]

const valuesOf = (inv: ListingInventory, i: number, ids: number[]): string =>
  JSON.stringify(ids.map((id) => inv.products[i].propertyValues.find((v) => v.propertyId === id)?.values ?? null))

const rowName = (inv: ListingInventory, i: number): string =>
  inv.products[i].propertyValues.map((v) => v.values.join(', ')).join(' / ')

/** "1 варіант", "3 варіанти", "5 варіантів", "11 варіантів". */
export function variantsText(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 14
  const word = !teen && n % 10 === 1 ? 'варіант' : !teen && n % 10 >= 2 && n % 10 <= 4 ? 'варіанти' : 'варіантів'
  return `${n} ${word}`
}

const money = (m: InvMoney): string => formatPrice(m.amount, m.divisor, m.currency)

/** A price as the field shows it: "12.5" → "12,50" (like the tiles); more decimals stay as they are. */
export function priceInput(raw: string): string {
  const n = Number(raw)
  if (!raw.trim() || !Number.isFinite(n)) return raw
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 ? n.toFixed(2).replace('.', ',') : raw.replace('.', ',')
}

/** The table's rows as the fields show them. */
const editRows = (inv: ListingInventory): InvRowEdit[] => rowsFromInventory(inv).map((r) => ({ ...r, price: priceInput(r.price) }))

const PRICE_PROBLEM = 'ціна — додатне число, не більше 2 знаків після коми.'
const QTY_PROBLEM = `кількість — ціле число від 0 до ${INV_MAX_QUANTITY}.`
/** inventoryProblems' own texts for these fields (shown per field instead). */
const isFieldProblem = (uk: string): boolean => uk.includes(`: ${PRICE_PROBLEM}`) || uk.includes(`: ${QTY_PROBLEM}`)

type FieldKey = 'price' | 'quantity'

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
  const [attempt, setAttempt] = useState(0)

  const reset = (i: ListingInventory): void => {
    setInv(i)
    setRows(editRows(i))
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
  }, [listing.listingId, attempt])

  if (!inv) {
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
      <Loading />
    )
  }
  if (!inv.products.length) {
    return (
      <EmptyState compact icon="layers" title="Варіантів немає">
        Etsy не повернув жодного варіанта цього товару.
      </EmptyState>
    )
  }

  const props = inventoryProperties(inv.products)
  const write = writeFromRows(inv, rows, on)
  const changed = JSON.stringify(write) !== JSON.stringify(inventoryToWrite(inv))
  const summary = inventorySummary(inv)
  const currency = summary.priceMin?.currency ?? listing.currency ?? ''
  const original = editRows(inv)
  const fieldId = (i: number, key: FieldKey | 'sku'): string => `inv-${listing.listingId}-${i}-${key}`
  // The same checks as inventoryProblems, per field, so each bad input is marked and linked.
  const fieldErrors = rows.map((r, i) => {
    if (!inv.products[i]?.offerings.length) return { price: null, quantity: null }
    const q = parseQuantity(r.quantity)
    return {
      price: parsePrice(r.price) == null ? PRICE_PROBLEM : null,
      quantity: !Number.isSafeInteger(q) || q < 0 || q > INV_MAX_QUANTITY ? QTY_PROBLEM : null
    }
  })
  const fieldProblems = fieldErrors.flatMap((e, i) => {
    const name = rowName(inv, i)
    const who = name ? `Варіант «${name}»` : `Варіант №${i + 1}`
    return (['price', 'quantity'] as const).flatMap((k) => (e[k] ? [{ text: `${who}: ${e[k]}`, target: fieldId(i, k) }] : []))
  })
  const otherProblems = inventoryProblems(write)
    .map((p) => p.uk)
    .filter((p) => !isFieldProblem(p))
  const problemCount = fieldProblems.length + otherProblems.length

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
      props.length > 0
        ? `Зберегти ціни, кількість і артикули (${variantsText(inv.products.length)}) на Etsy?\n` +
            'Etsy замінить дані всіх варіантів товару — покупці одразу побачать зміни.'
        : 'Зберегти ціну, кількість і артикул на Etsy?\nПокупці одразу побачать зміни.'
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

  const cls = (base: string, i: number, key: keyof InvRowEdit): string =>
    base + (original[i] && original[i][key] !== rows[i][key] ? ' is-changed' : '')

  return (
    <div className="inv-section" data-testid="inventory-section">
      {props.length > 0 ? (
        <p className="inv-intro">
          Кожен рядок — один <Term glossary="variations">варіант</Term> товару (наприклад, розмір чи колір) зі своєю ціною, кількістю й{' '}
          <Term glossary="sku">артикулом</Term>. Ціна — ваша базова, без податку і знижок. Змініть значення й натисніть «Зберегти на Etsy» —
          покупці побачать зміни одразу.
        </p>
      ) : (
        <p className="inv-intro">
          У товару немає <Term glossary="variations">варіантів</Term> — тут його ціна, кількість і <Term glossary="sku">артикул</Term>. Ціна —
          ваша базова, без податку і знижок. Змініть значення й натисніть «Зберегти на Etsy» — покупці побачать зміни одразу.
        </p>
      )}

      <div className="inv-facts" aria-label={props.length > 0 ? 'Коротко про варіанти' : 'Коротко про товар'}>
        {props.length > 0 && (
          <span className="inv-fact">
            <span className="inv-fact-label">Варіантів</span>
            <span className="inv-fact-value num">
              {summary.enabledCount === summary.productCount ? summary.productCount : `${summary.enabledCount} з ${summary.productCount} показано`}
            </span>
          </span>
        )}
        {summary.priceMin && summary.priceMax && (
          <span className="inv-fact">
            <span className="inv-fact-label">
              Ціна <InfoTip glossary="features.inventory.priceRange" size={13} />
            </span>
            <span className="inv-fact-value num">
              {summary.priceMin.amount * summary.priceMax.divisor === summary.priceMax.amount * summary.priceMin.divisor
                ? money(summary.priceMin)
                : `${money(summary.priceMin)} – ${money(summary.priceMax)}`}
            </span>
          </span>
        )}
        <span className="inv-fact">
          <span className="inv-fact-label">
            У наявності <InfoTip glossary="features.inventory.totalQuantity" size={13} />
          </span>
          <span className="inv-fact-value num">{summary.totalQuantity}</span>
        </span>
      </div>

      {props.length > 0 && (
        <div className="inv-depends" role="group" aria-label="Що залежить від варіанта">
          <div className="inv-depends-head">
            <span className="inv-depends-title">Що залежить від варіанта</span>
            <InfoTip glossary="features.inventory.dependsOn" />
          </div>
          <div className="inv-depends-grid" style={{ gridTemplateColumns: `minmax(84px, max-content) repeat(${props.length}, minmax(0, max-content))` }}>
            <span />
            {props.map((p) => (
              <span key={p.propertyId} className="inv-depends-prop truncate" title={p.name}>
                {p.name}
              </span>
            ))}
            {ON_ROWS.map((row) => (
              <div className="inv-depends-row" key={row.key} role="presentation">
                <span className="inv-depends-label">{row.label}</span>
                {props.map((p) => (
                  <Toggle
                    key={p.propertyId}
                    size="sm"
                    ariaLabel={`${row.name} залежить від «${p.name}»`}
                    checked={on[row.key].includes(p.propertyId)}
                    onChange={(c) => toggleOn(row.key, p.propertyId, c)}
                  />
                ))}
              </div>
            ))}
          </div>
          <p className="inv-depends-note">Вимкнено — значення однакове для всіх варіантів: зміна в одному рядку переноситься в усі відповідні.</p>
        </div>
      )}

      <div className="inv-variants">
        <table className="inv-table">
          <thead>
            <tr>
              {props.map((p) => (
                <th key={p.propertyId}>{p.name}</th>
              ))}
              <th>
                <span className="inv-th">
                  Артикул <InfoTip glossary="sku" size={13} />
                </span>
              </th>
              <th className="num">Ціна{currency && `, ${currency}`}</th>
              <th className="num">Кількість</th>
              <th className="inv-col-show">Показувати</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const name = rowName(inv, i)
              const label = (what: string): string => (name ? `${what}: ${name}` : what)
              const err = fieldErrors[i]
              /** aria + class of a price/quantity field: invalid → red border, described by its error. */
              const invalid = (k: FieldKey) =>
                err[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${fieldId(i, k)}-err` } : {}
              return (
                <tr key={inv.products[i].productId ?? i} className={r.enabled ? undefined : 'is-off'}>
                  {props.map((p) => (
                    <td key={p.propertyId} className="inv-prop" data-label={p.name}>
                      {inv.products[i].propertyValues.find((v) => v.propertyId === p.propertyId)?.values.join(', ') ?? '—'}
                    </td>
                  ))}
                  <td data-label="Артикул">
                    <input
                      type="text"
                      id={fieldId(i, 'sku')}
                      className={cls('inv-input', i, 'sku')}
                      aria-label={label('Артикул')}
                      placeholder="—"
                      value={r.sku}
                      onChange={(e) => edit(i, 'sku', e.target.value)}
                    />
                  </td>
                  <td className="num" data-label={`Ціна${currency && `, ${currency}`}`}>
                    <input
                      type="text"
                      inputMode="decimal"
                      id={fieldId(i, 'price')}
                      className={cls('inv-input inv-input-num', i, 'price') + (err.price ? ' is-invalid' : '')}
                      aria-label={label('Ціна')}
                      {...invalid('price')}
                      value={r.price}
                      onChange={(e) => edit(i, 'price', e.target.value)}
                    />
                    {err.price && (
                      <span id={`${fieldId(i, 'price')}-err`} className="sr-only">
                        {`Помилка: ${err.price}`}
                      </span>
                    )}
                  </td>
                  <td className="num" data-label="Кількість">
                    <input
                      type="text"
                      inputMode="numeric"
                      id={fieldId(i, 'quantity')}
                      className={cls('inv-input inv-input-num', i, 'quantity') + (err.quantity ? ' is-invalid' : '')}
                      aria-label={label('Кількість')}
                      {...invalid('quantity')}
                      value={r.quantity}
                      onChange={(e) => edit(i, 'quantity', e.target.value)}
                    />
                    {err.quantity && (
                      <span id={`${fieldId(i, 'quantity')}-err`} className="sr-only">
                        {`Помилка: ${err.quantity}`}
                      </span>
                    )}
                  </td>
                  <td className="inv-col-show" data-label="Показувати">
                    <Toggle size="sm" ariaLabel={label('Показувати')} checked={r.enabled} onChange={(c) => edit(i, 'enabled', c)} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="inv-hint">
        Перемикач «Показувати» <InfoTip glossary="features.inventory.showVariant" size={13} /> ховає варіант від покупців, не видаляючи його.
        Ціна — додатне число (напр. 12,50), кількість — від 0 до {INV_MAX_QUANTITY}.
      </p>

      {problemCount > 0 && (
        <div data-testid="inventory-problems">
          <Callout tone="warn" role="note" compact title="Перш ніж зберегти, виправте:">
            <ul className="inv-problems">
              {fieldProblems.map((p) => (
                <li key={p.target}>
                  <button type="button" className="inv-problem-link" title="Перейти до поля" onClick={() => document.getElementById(p.target)?.focus()}>
                    {p.text}
                  </button>
                </li>
              ))}
              {otherProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Callout>
        </div>
      )}
      {error && <Callout tone="error">{error}</Callout>}
      {note && (
        <Callout tone="success" compact>
          {note}
        </Callout>
      )}
      <div className="inv-actions">
        <Button variant="primary" icon="upload" busy={saving} disabled={!changed || problemCount > 0} onClick={() => void save()}>
          {saving ? 'Збереження…' : 'Зберегти на Etsy'}
        </Button>
        <Button
          variant="ghost"
          disabled={!changed || saving}
          onClick={() => {
            reset(inv)
            setNote(null)
          }}
        >
          Скасувати зміни
        </Button>
        {changed && !saving && (
          <Badge tone="warn" icon="edit">
            Є незбережені зміни
          </Badge>
        )}
      </div>
    </div>
  )
}
