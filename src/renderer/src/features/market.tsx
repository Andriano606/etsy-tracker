// Feature "market": the "🔎 Пошук по Etsy" window — search every active listing
// on Etsy (keywords, buyer category, price range, sort, shop location), result
// cards with photos, a price summary, paging, and "Стежити за магазином".

import './market.css'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import {
  MARKET_MAX_OFFSET,
  MARKET_PAGE_SIZE,
  MARKET_SORTS,
  MARKET_SORT_KEYS,
  marketPriceStats,
  type MarketCategory,
  type MarketCategoryMatches,
  type MarketListing,
  type MarketProperty,
  type MarketSearchResult,
  type MarketSort
} from '@shared/features/market'
import { formatCount, formatPrice } from '@shared/format'
import { featureCall } from './call'
import { LazyDetails } from './LazyDetails'
import type { FeatureUi } from './types'

const money = (value: number, currency: string): string => formatPrice(value, 1, currency)

// ------------------------------------------------------------------ category

export function CategoryPicker({
  value,
  onChange
}: {
  value: MarketCategory | null
  onChange: (c: MarketCategory | null) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<MarketCategoryMatches | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const search = async (q: string): Promise<void> => {
    setQuery(q)
    const n = ++seq.current
    if (!q.trim()) {
      setMatches(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const r = await featureCall<MarketCategoryMatches>('market', 'categories', { query: q })
    if (n !== seq.current) return
    setLoading(false)
    if (r.ok) {
      setMatches(r.value)
      setError(null)
    } else {
      setMatches(null)
      setError(r.error)
    }
  }

  if (value) {
    return (
      <div className="chosen-cat" data-testid="market-category">
        <input id="market-cat" readOnly value={value.path} />
        <button type="button" className="btn small" aria-label="Змінити категорію" onClick={() => onChange(null)}>
          Змінити
        </button>
      </div>
    )
  }
  return (
    <>
      <input id="market-cat" placeholder="Почніть вводити, напр. wall art або mugs" value={query} onChange={(e) => void search(e.target.value)} />
      {loading && <div className="hint">Завантаження…</div>}
      {error && (
        <div className="test-result err" role="alert">
          {error}
        </div>
      )}
      {matches && !loading && matches.categories.length === 0 && <div className="hint">Нічого не знайдено.</div>}
      {matches && matches.categories.length > 0 && (
        <ul className="cat-results" role="listbox" aria-label="Категорії">
          {matches.categories.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onChange(c)
                  setQuery('')
                  setMatches(null)
                }}
              >
                {c.path}
              </button>
            </li>
          ))}
          {matches.total > matches.categories.length && (
            <li className="hint">Показано {matches.categories.length} з {formatCount(matches.total)} — уточніть запит.</li>
          )}
        </ul>
      )}
    </>
  )
}

const VALUES_SHOWN = 40

export function CategoryProperties({ taxonomyId }: { taxonomyId: number }): JSX.Element {
  const [props, setProps] = useState<MarketProperty[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void featureCall<MarketProperty[]>('market', 'properties', { taxonomyId }).then((r) => {
      if (!alive) return
      if (r.ok) setProps(r.value)
      else setError(r.error)
    })
    return () => {
      alive = false
    }
  }, [taxonomyId])
  if (error) {
    return (
      <div className="test-result err" role="alert">
        {error}
      </div>
    )
  }
  if (!props) return <div className="hint">Завантаження…</div>
  if (props.length === 0) return <div className="hint">У цієї категорії немає властивостей.</div>
  return (
    <ul className="plain-list" data-testid="market-properties">
      {props.map((p) => {
        const values = p.possibleValues.map((v) => v.name)
        return (
          <li key={p.propertyId}>
            <strong>{p.displayName || p.name}</strong>
            {p.isRequired && <span className="dim"> · обов’язкова</span>}
            {p.isMultivalued && <span className="dim"> · кілька значень{p.maxValuesAllowed ? ` (до ${p.maxValuesAllowed})` : ''}</span>}
            {p.scales.length > 0 && <span className="dim"> · шкали: {p.scales.map((s) => s.name).join(', ')}</span>}
            <div className="hint">
              {values.length === 0
                ? 'Довільне значення.'
                : values.slice(0, VALUES_SHOWN).join(', ') + (values.length > VALUES_SHOWN ? ` … і ще ${values.length - VALUES_SHOWN}` : '')}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ------------------------------------------------------------------- results

type Note = { ok: boolean; text: string }

function ResultCard({
  l,
  note,
  busy,
  onTrack
}: {
  l: MarketListing
  note: Note | undefined
  busy: boolean
  onTrack: () => void
}): JSX.Element {
  return (
    <div className="listing-card market-card" data-testid="market-result">
      <div className="thumb">{l.imageUrl ? <img src={l.imageUrl} alt="" loading="lazy" /> : <span className="no-img">Без фото</span>}</div>
      <div className="card-body">
        <div className="card-title" title={l.title}>
          {l.title}
        </div>
        <div className="card-price">
          {l.priceAmount != null && l.priceDivisor && l.currency ? formatPrice(l.priceAmount, l.priceDivisor, l.currency) : '—'}
        </div>
        <div className="market-meta">
          {l.numFavorers != null && <span title="Додали в обране">❤ {formatCount(l.numFavorers)}</span>}
          {l.views != null && <span title="Перегляди">👁 {formatCount(l.views)}</span>}
          <span>Магазин #{l.shopId}</span>
        </div>
        <div className="market-actions">
          <button type="button" className="btn small" disabled={!l.url} onClick={() => l.url && void window.api.openExternal(l.url)}>
            Відкрити на Etsy
          </button>
          <button type="button" className="btn small" disabled={busy} onClick={onTrack}>
            Стежити за магазином
          </button>
        </div>
        {note && (
          <div className={`test-result ${note.ok ? 'ok' : 'err'}`} role={note.ok ? 'status' : 'alert'}>
            {note.text}
          </div>
        )}
      </div>
    </div>
  )
}

function Summary({ r }: { r: MarketSearchResult }): JSX.Element {
  const stats = marketPriceStats(r.listings)
  return (
    <div className="market-summary" data-testid="market-summary">
      <div>
        Знайдено на Etsy: <strong>{formatCount(r.count)}</strong> · завантажено {formatCount(r.listings.length)}
      </div>
      {stats.map((s) => (
        <div key={s.currency} className="hint">
          {s.currency} ({s.count}): від {money(s.min, s.currency)} · медіана {money(s.median, s.currency)} · до {money(s.max, s.currency)}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------- form

interface Form {
  keywords: string
  category: MarketCategory | null
  minPrice: string
  maxPrice: string
  sort: MarketSort
  shopLocation: string
}

const EMPTY: Form = { keywords: '', category: null, minPrice: '', maxPrice: '', sort: 'relevance', shopLocation: '' }

const queryOf = (f: Form): Record<string, unknown> => ({
  keywords: f.keywords.trim() || null,
  taxonomyId: f.category?.id ?? null,
  minPrice: f.minPrice.trim() || null,
  maxPrice: f.maxPrice.trim() || null,
  sort: f.sort,
  shopLocation: f.shopLocation.trim() || null,
  limit: MARKET_PAGE_SIZE
})

export function MarketSearch(): JSX.Element {
  const [form, setForm] = useState<Form>(EMPTY)
  const [query, setQuery] = useState<Record<string, unknown> | null>(null)
  const [result, setResult] = useState<MarketSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<number, Note>>({})
  /** Shops whose "Стежити за магазином" is in flight (each finishes on its own). */
  const [tracking, setTracking] = useState<ReadonlySet<number>>(new Set())
  const set = (patch: Partial<Form>): void => setForm((f) => ({ ...f, ...patch }))

  const run = async (q: Record<string, unknown>, offset: number): Promise<void> => {
    setLoading(true)
    setError(null)
    const r = await featureCall<MarketSearchResult>('market', 'search', { ...q, offset })
    setLoading(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setResult((prev) => {
      if (offset === 0 || !prev) return r.value
      const seen = new Set(prev.listings.map((l) => l.listingId))
      return {
        ...r.value,
        listings: [...prev.listings, ...r.value.listings.filter((l) => !seen.has(l.listingId))],
        imagesError: r.value.imagesError ?? prev.imagesError
      }
    })
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const q = queryOf(form)
    setQuery(q)
    setResult(null)
    setNotes({})
    void run(q, 0)
  }

  const track = async (shopId: number): Promise<void> => {
    setTracking((t) => new Set(t).add(shopId))
    const name = await featureCall<string>('market', 'shopName', { shopId })
    const note: Note = !name.ok
      ? { ok: false, text: name.error }
      : await window.api.addShop(name.value).then((res) =>
          res.ok ? { ok: true, text: `Магазин «${name.value}» додано — він у списку зліва.` } : { ok: false, text: res.error }
        )
    setNotes((n) => ({ ...n, [shopId]: note }))
    setTracking((t) => {
      const next = new Set(t)
      next.delete(shopId)
      return next
    })
  }

  const nextOffset = result ? result.offset + result.limit : 0
  const more = result != null && query != null && result.listings.length < result.count && nextOffset <= MARKET_MAX_OFFSET

  return (
    <div className="market-search">
      <form onSubmit={submit}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="market-keywords">Ключові слова</label>
            <input id="market-keywords" value={form.keywords} maxLength={200} onChange={(e) => set({ keywords: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="market-location">Розташування магазину</label>
            <input
              id="market-location"
              placeholder="напр. Ukraine або Germany"
              value={form.shopLocation}
              maxLength={100}
              onChange={(e) => set({ shopLocation: e.target.value })}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="market-cat">Категорія</label>
          <CategoryPicker value={form.category} onChange={(category) => set({ category })} />
        </div>
        {form.category && (
          <LazyDetails key={form.category.id} label="Властивості категорії" testId="market-category-properties">
            {() => <CategoryProperties taxonomyId={form.category!.id} />}
          </LazyDetails>
        )}
        <div className="field-row">
          <div className="field">
            <label htmlFor="market-min">Ціна від</label>
            <input id="market-min" type="number" min={0} step="any" value={form.minPrice} onChange={(e) => set({ minPrice: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="market-max">Ціна до</label>
            <input id="market-max" type="number" min={0} step="any" value={form.maxPrice} onChange={(e) => set({ maxPrice: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="market-sort">Сортування</label>
            <select id="market-sort" value={form.sort} onChange={(e) => set({ sort: e.target.value as MarketSort })}>
              {MARKET_SORT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {MARKET_SORTS[k].label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="hint">
          Потрібні ключові слова, категорія, розташування або ціна. Сортування діє лише разом із ключовими словами, категорією чи
          розташуванням. У якій валюті Etsy порівнює ціну «від/до», не задокументовано; ціни в результатах — у валюті продавця, без
          перерахунку.
        </div>
        <div className="settings-actions market-submit">
          <button type="submit" className="btn primary" disabled={loading}>
            Шукати
          </button>
        </div>
      </form>

      {error && (
        <div className="test-result err" role="alert">
          {error}
        </div>
      )}
      {result && (
        <>
          <Summary r={result} />
          {!result.sorted && <div className="hint">Без ключових слів, категорії чи розташування Etsy не сортує — спершу найновіші.</div>}
          {result.imagesError && <div className="hint warn">{result.imagesError}</div>}
          {result.listings.length === 0 ? (
            <div className="hint">Нічого не знайдено.</div>
          ) : (
            <div className="grid market-grid">
              {result.listings.map((l) => (
                <ResultCard key={l.listingId} l={l} note={notes[l.shopId]} busy={tracking.has(l.shopId)} onTrack={() => void track(l.shopId)} />
              ))}
            </div>
          )}
        </>
      )}
      {loading && <div className="hint">Завантаження…</div>}
      {more && !loading && (
        <div className="settings-actions market-more">
          <button type="button" className="btn" onClick={() => query && void run(query, nextOffset)}>
            Показати ще
          </button>
        </div>
      )}
    </div>
  )
}

export const ui: FeatureUi = {
  topModals: [{ id: 'market', button: '🔎 Пошук по Etsy', title: 'Пошук по всьому Etsy', Component: MarketSearch }]
}
