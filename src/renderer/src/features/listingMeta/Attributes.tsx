// "Атрибути": the listing category's properties as a form — one property saved
// or removed at a time; properties set on the listing that the form doesn't
// cover are listed with "Прибрати". Etsy stores every value with both its id
// and its name, so only allowed values (with an id) can be picked — the OAS
// gives no id for free text.

import { useEffect, useMemo, useState } from 'react'
import {
  type CategoryProperty,
  type ListingAttributes,
  type ListingProperty,
  type PropertyInput,
  propertyProblems
} from '@shared/features/listingMeta'
import type { MyListing, TaxonomyOption } from '@shared/types'
import { useStore } from '../../store'
import { featureCall } from '../call'

const CATEGORY_RESULTS = 30

/** Pickable values for the current scale: those with an id (values without a scale fit every scale). */
const valuesFor = (def: CategoryProperty, scaleId: number | null) =>
  def.possibleValues.filter((v) => v.id != null && (scaleId == null || v.scaleId == null || v.scaleId === scaleId))

/** The editor's state → the request: each picked value with its id. */
function toInput(def: CategoryProperty, scaleId: number | null, picked: string[]): PropertyInput {
  const opts = valuesFor(def, scaleId).filter((v) => picked.includes(v.name))
  return { valueIds: opts.map((v) => v.id!), values: opts.map((v) => v.name), scaleId }
}

function AttributeRow({
  listingId,
  def,
  current,
  onSaved,
  onRemoved
}: {
  listingId: number
  def: CategoryProperty
  current: ListingProperty | undefined
  onSaved: (p: ListingProperty) => void
  onRemoved: (propertyId: number) => void
}): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [scaleId, setScaleId] = useState<number | null>(current?.scaleId ?? (def.scales.length === 1 ? def.scales[0].id : null))
  const [picked, setPicked] = useState<string[]>(current?.values ?? [])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const input = toInput(def, scaleId, picked)
  const problems = propertyProblems(input, def)
  const options = valuesFor(def, scaleId)
  const pickable = def.possibleValues.some((v) => v.id != null)
  const id = `lm-attr-${def.id}`

  const edit = (fn: () => void): void => {
    fn()
    setDirty(true)
    setNote(null)
  }

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    const r = await featureCall<ListingProperty>('listingMeta', 'saveAttribute', { listingId, propertyId: def.id, ...input })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setDirty(false)
    setNote('Збережено.')
    onSaved(r.value)
  }

  async function remove(): Promise<void> {
    if (!(await requestConfirm(`Прибрати атрибут «${def.displayName}» з лістингу на Etsy?`))) return
    setBusy(true)
    setError(null)
    const r = await featureCall('listingMeta', 'removeAttribute', { listingId, propertyId: def.id })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setPicked([])
    setDirty(false)
    setNote('Атрибут прибрано.')
    onRemoved(def.id)
  }

  const toggle = (name: string): void =>
    edit(() => setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name])))

  return (
    <div className="lm-attr" data-testid={id}>
      <div className="lm-attr-head">
        <strong>{def.displayName}</strong>
        {def.isRequired && <span className="lm-required"> · обов’язковий</span>}
        {def.isMultivalued && <span className="dim"> · кілька значень{def.maxValuesAllowed ? ` (до ${def.maxValuesAllowed})` : ''}</span>}
        {current && <span className="dim"> · зараз: {current.values.join(', ') || '—'}</span>}
      </div>
      {def.selectedValues.length > 0 && (
        <div className="hint">Завжди вибрано: {def.selectedValues.map((v) => v.name).join(', ')}</div>
      )}
      <div className="field-row">
        {def.scales.length > 0 && (
          <div className="field">
            <label htmlFor={`${id}-scale`}>Шкала</label>
            <select
              id={`${id}-scale`}
              value={scaleId ?? ''}
              onChange={(e) => edit(() => setScaleId(e.target.value ? Number(e.target.value) : null))}
            >
              <option value="">— виберіть —</option>
              {def.scales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {!pickable ? (
          <div className="hint">
            Etsy не дає для цього атрибута списку дозволених значень, а зберегти значення без його ідентифікатора API не
            дозволяє — задайте його на сайті Etsy.
          </div>
        ) : def.isMultivalued ? (
          <fieldset className="lm-values" aria-label={`Значення: ${def.displayName}`}>
            {options.map((v) => (
              <label key={`${v.id}-${v.name}`} className="check">
                <input type="checkbox" checked={picked.includes(v.name)} onChange={() => toggle(v.name)} />
                {v.name}
              </label>
            ))}
          </fieldset>
        ) : (
          <div className="field">
            <label htmlFor={`${id}-value`}>Значення</label>
            <select
              id={`${id}-value`}
              value={picked[0] ?? ''}
              onChange={(e) => edit(() => setPicked(e.target.value ? [e.target.value] : []))}
            >
              <option value="">— не вибрано —</option>
              {options.map((v) => (
                <option key={`${v.id}-${v.name}`} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {dirty && problems.length > 0 && <div className="hint warn">{problems.join(' ')}</div>}
      <div className="settings-actions">
        {pickable && (
          <button className="btn small primary" disabled={busy || !dirty || problems.length > 0} onClick={() => void save()}>
            Зберегти
          </button>
        )}
        {current && (
          <button className="btn small danger" disabled={busy} onClick={() => void remove()}>
            Прибрати
          </button>
        )}
      </div>
      {error && (
        <div className="test-result err" role="alert">
          {error}
        </div>
      )}
      {note && <div className="test-result ok">{note}</div>}
    </div>
  )
}

/** A property set on the listing that the category form doesn't show: read-only + "Прибрати". */
function OtherProperties({
  listingId,
  rows,
  onRemoved
}: {
  listingId: number
  rows: ListingProperty[]
  onRemoved: (propertyId: number) => void
}): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [error, setError] = useState<string | null>(null)
  async function remove(p: ListingProperty): Promise<void> {
    if (!(await requestConfirm(`Прибрати атрибут «${p.name ?? `#${p.propertyId}`}» з лістингу на Etsy?`))) return
    setError(null)
    const r = await featureCall('listingMeta', 'removeAttribute', { listingId, propertyId: p.propertyId })
    if (!r.ok) return setError(r.error)
    onRemoved(p.propertyId)
  }
  return (
    <>
      <table className="data-table" data-testid="lm-other-props">
        <thead>
          <tr>
            <th>Атрибут</th>
            <th>Значення</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.propertyId}>
              <td>{p.name ?? `#${p.propertyId}`}</td>
              <td>
                {p.values.join(', ') || '—'}
                {p.scaleName && <span className="dim"> ({p.scaleName})</span>}
              </td>
              <td>
                <button className="btn small danger" onClick={() => void remove(p)}>
                  Прибрати
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && (
        <div className="test-result err" role="alert">
          {error}
        </div>
      )}
    </>
  )
}

/** Pick the category by hand when Etsy didn't show the listing's. */
function CategoryPicker({ onPick }: { onPick: (t: TaxonomyOption) => void }): JSX.Element {
  const [all, setAll] = useState<TaxonomyOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    let alive = true
    void featureCall<TaxonomyOption[]>('listingMeta', 'categories').then((r) => {
      if (!alive) return
      if (r.ok) setAll(r.value)
      else setError(r.error)
    })
    return () => {
      alive = false
    }
  }, [])
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!all || s.length < 2) return []
    return all.filter((t) => t.path.toLowerCase().includes(s)).slice(0, CATEGORY_RESULTS)
  }, [all, q])
  return (
    <div className="field">
      <label htmlFor="lm-cat">Категорія лістингу</label>
      <input
        id="lm-cat"
        placeholder={all ? 'Почніть вводити назву категорії' : 'Завантаження категорій…'}
        disabled={!all}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {error && (
        <div className="test-result err" role="alert">
          {error}
        </div>
      )}
      {matches.length > 0 && (
        <ul className="cat-results" role="listbox" aria-label="Категорії">
          {matches.map((t) => (
            <li key={t.id}>
              <button role="option" aria-selected={false} onClick={() => onPick(t)}>
                {t.path}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function AttributesSection({ listing }: { listing: MyListing; onChanged: (l?: MyListing) => void }): JSX.Element {
  const [data, setData] = useState<ListingAttributes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [taxonomyId, setTaxonomyId] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    setError(null)
    void featureCall<ListingAttributes>('listingMeta', 'attributes', { listingId: listing.listingId, taxonomyId }).then((r) => {
      if (!alive) return
      if (r.ok) setData(r.value)
      else setError(r.error)
    })
    return () => {
      alive = false
    }
  }, [listing.listingId, taxonomyId])

  if (error) {
    return (
      <div className="test-result err" role="alert">
        {error}
      </div>
    )
  }
  if (!data) return <div className="hint">Завантаження…</div>

  const setProps = (fn: (p: ListingProperty[]) => ListingProperty[]): void =>
    setData((d) => (d ? { ...d, properties: fn(d.properties) } : d))
  const saved = (p: ListingProperty): void => setProps((ps) => [...ps.filter((x) => x.propertyId !== p.propertyId), p])
  const removed = (id: number): void => setProps((ps) => ps.filter((x) => x.propertyId !== id))
  const defs = [...(data.definitions ?? [])].sort((a, b) => Number(b.isRequired) - Number(a.isRequired))
  const others = data.properties.filter((p) => !defs.some((d) => d.id === p.propertyId))

  return (
    <div data-testid="lm-attributes">
      {data.taxonomyId != null ? (
        <div className="hint">
          Категорія: {data.categoryPath ?? `#${data.taxonomyId}`}. Кожен атрибут зберігається окремо.
        </div>
      ) : (
        <>
          {data.note && <div className="hint warn">{data.note}</div>}
          <CategoryPicker onPick={(t) => setTaxonomyId(t.id)} />
        </>
      )}
      {data.definitions && data.definitions.length === 0 && <div className="hint">Ця категорія не має атрибутів.</div>}
      {defs.map((d) => (
        <AttributeRow
          key={d.id}
          listingId={data.listingId}
          def={d}
          current={data.properties.find((p) => p.propertyId === d.id)}
          onSaved={saved}
          onRemoved={removed}
        />
      ))}
      {others.length > 0 && (
        <>
          <h4>{defs.length ? 'Інші атрибути лістингу' : 'Атрибути лістингу'}</h4>
          <OtherProperties listingId={data.listingId} rows={others} onRemoved={removed} />
        </>
      )}
      {!defs.length && !others.length && data.definitions == null && <div className="hint">Атрибутів не задано.</div>}
    </div>
  )
}
