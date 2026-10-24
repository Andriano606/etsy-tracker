// "Атрибути": the listing category's properties as a form — one property saved
// or removed at a time; properties set on the listing that the form doesn't
// cover are listed with "Прибрати". Etsy stores every value with both its id
// and its name, so only allowed values (with an id) can be picked — the OAS
// gives no id for free text.

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import {
  type CategoryProperty,
  type ListingAttributes,
  type ListingProperty,
  type PropertyInput,
  propertyProblems
} from '@shared/features/listingMeta'
import type { MyListing, TaxonomyOption } from '@shared/types'
import { useStore } from '../../store'
import { Badge, Button, Callout, EmptyState, Field, GLOSSARY, Icon, InfoTip, Loading, Term } from '../../ui'
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
    if (!(await requestConfirm(`Прибрати атрибут «${def.displayName}» з товару на Etsy?`))) return
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

  const missing = def.isRequired && !current
  return (
    <div className={'lm-attr' + (missing ? ' is-missing' : '')} data-testid={id}>
      <div className="lm-attr-head">
        <span className="lm-attr-name">{def.displayName}</span>
        {def.isRequired && (
          <Badge tone="warn" hint={GLOSSARY['features.market.requiredProperty'].short}>
            обов’язковий
          </Badge>
        )}
        {def.isMultivalued && (
          <Badge hint={GLOSSARY['features.market.multivalued'].short}>
            кілька значень{def.maxValuesAllowed ? ` (до ${def.maxValuesAllowed})` : ''}
          </Badge>
        )}
        <span className="lm-attr-current">
          {current ? (
            <>
              <Icon name="check" size={13} /> Зараз на Etsy: {current.values.join(', ') || '—'}
            </>
          ) : (
            'Не заповнено'
          )}
        </span>
      </div>
      {def.selectedValues.length > 0 && (
        <div className="lm-hint">Завжди вибрано: {def.selectedValues.map((v) => v.name).join(', ')}</div>
      )}
      {!pickable ? (
        <Callout tone="info" role="note" compact>
          Etsy не дає для цього атрибута списку дозволених значень, тож змінити його тут не можна — задайте його на сайті Etsy.
        </Callout>
      ) : (
        <div className="lm-attr-body">
          {def.scales.length > 0 && (
            <Field label="Шкала" id={`${id}-scale`} glossary="features.market.scale" className="lm-attr-scale">
              <select value={scaleId ?? ''} onChange={(e) => edit(() => setScaleId(e.target.value ? Number(e.target.value) : null))}>
                <option value="">— виберіть —</option>
                {def.scales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {def.isMultivalued ? (
            <fieldset className="lm-values" aria-label={`Значення: ${def.displayName}`}>
              {options.length === 0 && <span className="lm-hint">Спершу виберіть шкалу.</span>}
              {options.map((v) => {
                const on = picked.includes(v.name)
                return (
                  <label key={`${v.id}-${v.name}`} className={'lm-chip' + (on ? ' is-on' : '')}>
                    <input type="checkbox" checked={on} onChange={() => toggle(v.name)} />
                    <Icon name={on ? 'check' : 'plus'} size={12} />
                    {v.name}
                  </label>
                )
              })}
            </fieldset>
          ) : (
            <Field label="Значення" id={`${id}-value`} className="lm-attr-value">
              <select value={picked[0] ?? ''} onChange={(e) => edit(() => setPicked(e.target.value ? [e.target.value] : []))}>
                <option value="">— не вибрано —</option>
                {options.map((v) => (
                  <option key={`${v.id}-${v.name}`} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      )}
      {dirty && problems.length > 0 && (
        <Callout tone="warn" role="note" compact>
          {problems.join(' ')}
        </Callout>
      )}
      {(pickable || current) && (
        <div className="lm-actions">
          {pickable && (
            <Button size="sm" variant="primary" busy={busy} disabled={!dirty || problems.length > 0} onClick={() => void save()}>
              Зберегти
            </Button>
          )}
          {current && (
            <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={() => void remove()}>
              Прибрати
            </Button>
          )}
          {dirty && problems.length === 0 && (
            <Badge tone="warn" icon="edit">
              Не збережено
            </Badge>
          )}
        </div>
      )}
      {error && <Callout tone="error">{error}</Callout>}
      {note && (
        <Callout tone="success" compact>
          {note}
        </Callout>
      )}
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
    if (!(await requestConfirm(`Прибрати атрибут «${p.name ?? `#${p.propertyId}`}» з товару на Etsy?`))) return
    setError(null)
    const r = await featureCall('listingMeta', 'removeAttribute', { listingId, propertyId: p.propertyId })
    if (!r.ok) return setError(r.error)
    onRemoved(p.propertyId)
  }
  return (
    <>
      <ul className="lm-other" data-testid="lm-other-props">
        {rows.map((p) => (
          <li key={p.propertyId} className="lm-other-row">
            <span className="lm-other-name">{p.name ?? `#${p.propertyId}`}</span>
            <span className="lm-other-value">
              {p.values.join(', ') || '—'}
              {p.scaleName && <span className="lm-dim"> ({p.scaleName})</span>}
            </span>
            <Button size="sm" variant="danger" icon="trash" onClick={() => void remove(p)}>
              Прибрати
            </Button>
          </li>
        ))}
      </ul>
      {error && <Callout tone="error">{error}</Callout>}
    </>
  )
}

/**
 * Pick the category by hand when Etsy didn't show the listing's: a combobox —
 * type to filter, ↑/↓ move through the results, Enter picks, a click picks.
 */
function CategoryPicker({ onPick }: { onPick: (t: TaxonomyOption) => void }): JSX.Element {
  const [all, setAll] = useState<TaxonomyOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(-1)
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
  const listId = 'lm-cat-results'
  const optionId = (t: TaxonomyOption): string => `${listId}-${t.id}`
  const current = active >= 0 && active < matches.length ? matches[active] : null
  useEffect(() => {
    if (current) document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (!matches.length) return
    if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, matches.length - 1))
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
    else if (e.key === 'Enter' && current) onPick(current)
    else return
    e.preventDefault()
  }
  return (
    <div className="lm-cat">
      <Field label="Категорія товару" id="lm-cat" glossary="category" hint="Введіть щонайменше 2 літери англійською, наприклад «planner», і виберіть зі списку (стрілки ↑/↓ і Enter або клік).">
        <input
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={matches.length > 0}
          aria-controls={listId}
          aria-activedescendant={current ? optionId(current) : undefined}
          autoComplete="off"
          placeholder={all ? 'Почніть вводити назву категорії' : 'Завантаження категорій…'}
          disabled={!all}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(-1)
          }}
          onKeyDown={onKey}
        />
      </Field>
      {error && <Callout tone="error">{error}</Callout>}
      <ul id={listId} className="lm-cat-results" role="listbox" aria-label="Категорії" hidden={matches.length === 0}>
        {matches.map((t, i) => (
          <li
            key={t.id}
            id={optionId(t)}
            role="option"
            aria-selected={i === active}
            className={i === active ? 'is-active' : undefined}
            // Keep the focus in the input; the click picks.
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(t)}
          >
            {t.path}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AttributesSection({ listing }: { listing: MyListing; onChanged: (l?: MyListing) => void }): JSX.Element {
  const [data, setData] = useState<ListingAttributes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [taxonomyId, setTaxonomyId] = useState<number | null>(null)
  const [attempt, setAttempt] = useState(0)

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
  }, [listing.listingId, taxonomyId, attempt])

  if (error) {
    return (
      <Callout tone="error" action={
          <Button size="sm" icon="refresh" onClick={() => setAttempt((n) => n + 1)}>
            Спробувати ще
          </Button>
        }>
        {error}
      </Callout>
    )
  }
  if (!data) return <Loading>Завантаження атрибутів…</Loading>

  const setProps = (fn: (p: ListingProperty[]) => ListingProperty[]): void =>
    setData((d) => (d ? { ...d, properties: fn(d.properties) } : d))
  const saved = (p: ListingProperty): void => setProps((ps) => [...ps.filter((x) => x.propertyId !== p.propertyId), p])
  const removed = (id: number): void => setProps((ps) => ps.filter((x) => x.propertyId !== id))
  const defs = [...(data.definitions ?? [])].sort((a, b) => Number(b.isRequired) - Number(a.isRequired))
  const others = data.properties.filter((p) => !defs.some((d) => d.id === p.propertyId))
  const filled = defs.filter((d) => data.properties.some((p) => p.propertyId === d.id)).length
  const missingRequired = defs.filter((d) => d.isRequired && !data.properties.some((p) => p.propertyId === d.id)).length

  return (
    <div className="lm-section" data-testid="lm-attributes">
      <p className="lm-intro">
        <Term glossary="attributes">Атрибути</Term> — характеристики товару з довідника Etsy: колір, свято, формат. Покупці фільтрують за ними
        пошук, тож заповнені атрибути допомагають знайти ваш товар. Кожен атрибут зберігається окремо — кнопкою «Зберегти» під ним.
      </p>
      {data.taxonomyId != null ? (
        <div className="lm-cat-line">
          <Icon name="folder" size={14} />
          <span className="lm-cat-path">Категорія: {data.categoryPath ?? `#${data.taxonomyId}`}</span>
          <InfoTip glossary="category" size={13} />
        </div>
      ) : (
        <>
          {data.note && (
            <Callout tone="warn" role="note" compact>
              {data.note}
            </Callout>
          )}
          <CategoryPicker onPick={(t) => setTaxonomyId(t.id)} />
        </>
      )}
      {defs.length > 0 && (
        <div className="lm-progress">
          <span className="num">
            Заповнено {filled} з {defs.length}
          </span>
          {missingRequired > 0 && (
            <Badge tone="warn" icon="warning">
              не заповнено обов’язкових: {missingRequired}
            </Badge>
          )}
        </div>
      )}
      {data.definitions && data.definitions.length === 0 && (
        <EmptyState compact icon="tag" title="Ця категорія не має атрибутів.">
          Etsy не пропонує для неї додаткових характеристик.
        </EmptyState>
      )}
      {defs.length > 0 && (
        <div className="lm-attrs">
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
        </div>
      )}
      {others.length > 0 && (
        <div className="lm-sub">
          <div className="lm-sub-head">
            <h4 className="lm-sub-title">{defs.length ? 'Інші атрибути товару' : 'Атрибути товару'}</h4>
            <InfoTip glossary="features.listingMeta.otherAttributes" />
          </div>
          <OtherProperties listingId={data.listingId} rows={others} onRemoved={removed} />
        </div>
      )}
      {!defs.length && !others.length && data.definitions == null && (
        <EmptyState compact icon="tag" title="Атрибутів не задано.">
          Виберіть категорію вище, щоб побачити, які атрибути можна заповнити.
        </EmptyState>
      )}
    </div>
  )
}
