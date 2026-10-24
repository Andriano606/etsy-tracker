// Feature "market": the "🔎 Пошук по Etsy" window — search every active listing
// on Etsy (keywords, buyer category, price range, sort, shop location), result
// cards with photos, a price summary, paging, and "Стежити за магазином".

import './market.css'
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
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
import type { ShopSummary } from '@shared/types'
import { useStore } from '../store'
import { Badge, Button, Callout, EmptyState, Field, GLOSSARY, Icon, InfoTip, Loading, Select, Term, Tooltip, ZoomImage } from '../ui'
import { featureCall } from './call'
import { ErrorNote, IconStat, scrollBehavior } from './compete/common'
import { LazyDetails } from './LazyDetails'
import type { FeatureUi } from './types'

const money = (value: number, currency: string): string => formatPrice(value, 1, currency)

// ------------------------------------------------------------------ category

export function CategoryPicker({
  value,
  onChange,
  describedBy
}: {
  value: MarketCategory | null
  onChange: (c: MarketCategory | null) => void
  describedBy?: string
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<MarketCategoryMatches | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The suggestion the arrow keys point at (-1 = none). */
  const [active, setActive] = useState(-1)
  const seq = useRef(0)
  const listId = useId()

  const search = async (q: string): Promise<void> => {
    setQuery(q)
    setActive(-1)
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

  const options = matches?.categories ?? []
  const open = options.length > 0
  const pick = (c: MarketCategory): void => {
    onChange(c)
    setQuery('')
    setMatches(null)
    setActive(-1)
  }
  // A combobox: ↓/↑ walk the suggestions, Enter picks one, Escape closes the list (not the window).
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (!open) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => (a < 0 && step < 0 ? options.length - 1 : (a + step + options.length) % options.length))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      pick(options[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setMatches(null)
      setActive(-1)
    }
  }
  const optionId = (i: number): string => `${listId}-o${i}`
  // Keep the highlighted suggestion visible in the scrolling list.
  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  if (value) {
    return (
      <div className="market-chosen-cat" data-testid="market-category">
        <span className="market-chosen-icon" aria-hidden="true">
          <Icon name="folder" size={15} />
        </span>
        <input id="market-cat" readOnly value={value.path} title={value.path} aria-describedby={describedBy} />
        <Button size="sm" icon="close" aria-label="Змінити категорію" tooltip="Прибрати категорію і вибрати іншу" onClick={() => onChange(null)}>
          Змінити
        </Button>
      </div>
    )
  }
  return (
    <div className="market-cat-picker">
      <div className="market-input-icon">
        <Icon name="search" size={15} />
        <input
          id="market-cat"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          placeholder="Почніть вводити англійською, напр. wall art або mugs"
          value={query}
          autoComplete="off"
          aria-describedby={describedBy}
          onChange={(e) => void search(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {loading && <Loading inline>Завантаження…</Loading>}
      {error && (
        <Callout tone="error" compact>
          {error}
        </Callout>
      )}
      {matches && !loading && matches.categories.length === 0 && <div className="market-cat-empty">Нічого не знайдено.</div>}
      {matches && open && (
        <div className="market-cat-results">
          <ul id={listId} role="listbox" aria-label="Категорії">
            {options.map((c, i) => (
              <li
                key={c.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'is-active' : undefined}
                title={c.path}
                // mousedown would blur the input first; keep the focus in it
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(c)}
              >
                {c.path}
              </li>
            ))}
          </ul>
          {matches.total > options.length && (
            <div className="market-cat-more">
              Показано {options.length} з {formatCount(matches.total)} — уточніть запит.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const VALUES_SHOWN = 40

export function CategoryProperties({ taxonomyId }: { taxonomyId: number }): JSX.Element {
  const [props, setProps] = useState<MarketProperty[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setError(null)
    void featureCall<MarketProperty[]>('market', 'properties', { taxonomyId }).then((r) => {
      if (!alive) return
      if (r.ok) setProps(r.value)
      else setError(r.error)
    })
    return () => {
      alive = false
    }
  }, [taxonomyId, attempt])
  if (error) return <ErrorNote error={error} onRetry={() => setAttempt((n) => n + 1)} />
  if (!props) return <Loading inline>Завантаження…</Loading>
  if (props.length === 0) return <div className="market-muted">У цієї категорії немає властивостей.</div>
  return (
    <ul className="market-props" data-testid="market-properties">
      {props.map((p) => {
        const values = p.possibleValues.map((v) => v.name)
        return (
          <li key={p.propertyId} className="market-prop" data-testid="market-property">
            <div className="market-prop-head">
              <strong>{p.displayName || p.name}</strong>
              {p.isRequired && (
                <Badge tone="warn" hint={GLOSSARY['features.market.requiredProperty'].short}>
                  обов’язкова
                </Badge>
              )}
              {p.isMultivalued && (
                <Badge tone="neutral" hint={GLOSSARY['features.market.multivalued'].short}>
                  кілька значень{p.maxValuesAllowed ? ` (до ${p.maxValuesAllowed})` : ''}
                </Badge>
              )}
              {p.scales.length > 0 && (
                <Badge tone="neutral" hint={GLOSSARY['features.market.scale'].short}>
                  шкали: {p.scales.map((s) => s.name).join(', ')}
                </Badge>
              )}
            </div>
            <div className="market-prop-values">
              {values.length === 0
                ? 'Довільне значення — продавець вписує своє.'
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
  tracked,
  note,
  busy,
  onTrack,
  onShow
}: {
  l: MarketListing
  /** The shop, when the user already tracks it. */
  tracked: ShopSummary | undefined
  note: Note | undefined
  busy: boolean
  onTrack: () => void
  /** Close the window and open the tracked shop in the app. */
  onShow: (shopId: number) => void
}): JSX.Element {
  const price = l.priceAmount != null && l.priceDivisor && l.currency ? formatPrice(l.priceAmount, l.priceDivisor, l.currency) : '—'
  return (
    <article className="market-card" data-testid="market-result">
      <div className="market-thumb">
        {l.imageUrl ? (
          <ZoomImage
            className="market-zoom"
            src={l.imageUrl}
            full={l.imageFullUrl ?? l.imageUrl}
            alt={l.title}
            caption={l.title}
            loading="lazy"
          />
        ) : (
          <span className="market-no-img">
            <Icon name="image" size={20} />
            Без фото
          </span>
        )}
      </div>
      <div className="market-card-body">
        <h3 className="market-card-title clamp-2" title={l.title}>
          {l.title}
        </h3>
        <div className="market-card-price">
          <span className="num">{price}</span>
          <InfoTip glossary="basePrice" label="Що це за ціна?" />
        </div>
        <div className="market-meta">
          {l.numFavorers != null && <IconStat icon="heart" label="В обраному" hint={GLOSSARY.favorites.short} value={formatCount(l.numFavorers)} />}
          {l.views != null && <IconStat icon="eye" label="Переглядів" hint={GLOSSARY.views.short} value={formatCount(l.views)} />}
        </div>
        {tracked ? (
          <div className="market-shop market-shop--tracked">
            <Icon name="store" size={13} />
            <span className="truncate" title={tracked.shopName}>
              {tracked.shopName}
            </span>
            <Badge tone="accent" icon="check" hint="Цей магазин уже у вашому списку зліва — програма стежить за його товарами.">
              ви стежите
            </Badge>
          </div>
        ) : (
          <Tooltip content={GLOSSARY['features.market.shopNumber'].short}>
            <span className="market-shop feat-stat" tabIndex={0}>
              <Icon name="store" size={13} />
              Магазин #{l.shopId}
            </span>
          </Tooltip>
        )}
        <div className="market-actions">
          {tracked ? (
            <Button size="sm" icon="store" variant="subtle" tooltip="Закрити пошук і відкрити цей магазин у програмі" onClick={() => onShow(tracked.id)}>
              Відкрити в програмі
            </Button>
          ) : (
            <Button size="sm" icon="plus" variant="subtle" disabled={busy} busy={busy} tooltip={GLOSSARY['features.market.follow'].short} onClick={onTrack}>
              Стежити за магазином
            </Button>
          )}
          <Button size="sm" icon="external" variant="ghost" disabled={!l.url} onClick={() => l.url && void window.api.openExternal(l.url)}>
            Відкрити на Etsy
          </Button>
        </div>
        {note && (
          <Callout tone={note.ok ? 'success' : 'error'} compact>
            {note.text}
          </Callout>
        )}
      </div>
    </article>
  )
}

function Summary({ r }: { r: MarketSearchResult }): JSX.Element {
  const stats = marketPriceStats(r.listings)
  return (
    <section className="market-summary" data-testid="market-summary" aria-label="Підсумок пошуку">
      <div className="market-summary-head">
        <Icon name="search" size={15} />
        <span>
          <Term glossary="features.market.found">Знайдено на Etsy</Term>: <strong className="num">{formatCount(r.count)}</strong> · завантажено{' '}
          {formatCount(r.listings.length)}
        </span>
      </div>
      {stats.length > 0 && (
        <div className="market-summary-prices">
          <span className="market-summary-label">Ціни серед завантажених:</span>
          {stats.map((s) => (
            <div key={s.currency} className="market-price-row">
              {s.currency} ({s.count}): від {money(s.min, s.currency)} · <Term glossary="features.market.median">медіана</Term>{' '}
              <strong>{money(s.median, s.currency)}</strong> · до {money(s.max, s.currency)}
            </div>
          ))}
        </div>
      )}
    </section>
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

const isEmpty = (f: Form): boolean => !f.keywords.trim() && !f.category && !f.minPrice.trim() && !f.maxPrice.trim() && !f.shopLocation.trim()

export function MarketSearch(): JSX.Element {
  const [form, setForm] = useState<Form>(EMPTY)
  const [query, setQuery] = useState<Record<string, unknown> | null>(null)
  const [result, setResult] = useState<MarketSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<number, Note>>({})
  /** Shops whose "Стежити за магазином" is in flight (each finishes on its own). */
  const [tracking, setTracking] = useState<ReadonlySet<number>>(new Set())
  /** The offset of the request that failed (what "Спробувати ще" repeats). */
  const [failedOffset, setFailedOffset] = useState(0)
  const shops = useStore((s) => s.shops)
  const set = (patch: Partial<Form>): void => setForm((f) => ({ ...f, ...patch }))
  const resultsRef = useRef<HTMLDivElement>(null)
  /** A new search answered: bring the results into view (at 900×560 the form fills the window). */
  const reveal = useRef(false)

  const run = async (q: Record<string, unknown>, offset: number): Promise<void> => {
    setLoading(true)
    setError(null)
    const r = await featureCall<MarketSearchResult>('market', 'search', { ...q, offset })
    setLoading(false)
    if (offset === 0) reveal.current = true
    if (!r.ok) {
      setFailedOffset(offset)
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

  useEffect(() => {
    if (!reveal.current || loading) return
    reveal.current = false
    resultsRef.current?.scrollIntoView?.({ block: 'start', behavior: scrollBehavior() })
  }, [result, error, loading])

  const showShop = (shopId: number): void => {
    const st = useStore.getState()
    st.openFeatureModal(null)
    void st.selectShop(shopId)
  }

  const nextOffset = result ? result.offset + result.limit : 0
  const more = result != null && query != null && result.listings.length < result.count && nextOffset <= MARKET_MAX_OFFSET

  return (
    <div className="market-search">
      <form className="market-form ui-card" onSubmit={submit} aria-label="Умови пошуку">
        <Field label="Ключові слова" glossary="features.market.keywords" id="market-keywords" className="market-keywords">
          {(p) => (
            <div className="market-input-icon">
              <Icon name="search" size={15} />
              <input
                {...p}
                value={form.keywords}
                maxLength={200}
                placeholder="Що шукає покупець, напр. budget planner"
                onChange={(e) => set({ keywords: e.target.value })}
              />
            </div>
          )}
        </Field>
        <div className="market-grid-2">
          <Field label="Категорія" glossary="category" id="market-cat" hint="Розділ каталогу Etsy — звужує пошук до одного виду товарів.">
            {(p) => <CategoryPicker value={form.category} onChange={(category) => set({ category })} describedBy={p['aria-describedby']} />}
          </Field>
          <Field label="Розташування магазину" glossary="features.market.shopLocation" id="market-location">
            <input placeholder="напр. Ukraine або Germany" value={form.shopLocation} maxLength={100} onChange={(e) => set({ shopLocation: e.target.value })} />
          </Field>
        </div>
        {form.category && (
          <LazyDetails
            key={form.category.id}
            label="Властивості категорії"
            icon="tag"
            description={GLOSSARY['features.market.categoryProperties'].short}
            testId="market-category-properties"
          >
            {() => <CategoryProperties taxonomyId={form.category!.id} />}
          </LazyDetails>
        )}
        <div className="market-grid-3">
          <Field label="Ціна від" glossary="features.market.priceRange" id="market-min">
            <input type="number" min={0} step="any" inputMode="decimal" placeholder="0" value={form.minPrice} onChange={(e) => set({ minPrice: e.target.value })} />
          </Field>
          <Field label="Ціна до" id="market-max">
            <input type="number" min={0} step="any" inputMode="decimal" placeholder="без межі" value={form.maxPrice} onChange={(e) => set({ maxPrice: e.target.value })} />
          </Field>
          <Field label="Сортування" glossary="features.market.sort" id="market-sort">
            <Select
              value={form.sort}
              onChange={(v) => set({ sort: v as MarketSort })}
              options={MARKET_SORT_KEYS.map((k) => ({ value: k, label: MARKET_SORTS[k].label }))}
            />
          </Field>
        </div>
        <div className="market-form-actions">
          <Button type="submit" variant="primary" icon="search" busy={loading}>
            Шукати
          </Button>
          <Button
            variant="ghost"
            disabled={loading || (isEmpty(form) && form.sort === 'relevance')}
            onClick={() => setForm(EMPTY)}
            tooltip="Очистити всі поля форми (знайдене залишиться)"
          >
            Очистити
          </Button>
          <p className="market-form-note">
            Заповніть хоча б одне поле. Ціни в результатах — у валюті продавця, без перерахунку.
          </p>
        </div>
      </form>

      <div className="market-results" aria-live="polite" ref={resultsRef}>
        {error && (
          <Callout
            tone="error"
            title="Пошук не вдався"
            action={
              query && (
                <Button icon="refresh" onClick={() => void run(query, failedOffset)}>
                  Спробувати ще
                </Button>
              )
            }
          >
            {error}
          </Callout>
        )}
        {!result && !loading && !error && (
          <EmptyState icon="search" title="Шукайте серед усіх товарів Etsy">
            Введіть, що шукає покупець, або виберіть категорію — і подивіться, які товари продаються, за якою ціною і хто їх продає. Цікавий
            магазин можна одразу додати до стеження.
          </EmptyState>
        )}
        {result && (
          <>
            <Summary r={result} />
            {!result.sorted && (
              <Callout tone="info" compact>
                Без ключових слів, категорії чи розташування Etsy не сортує — спершу найновіші.
              </Callout>
            )}
            {result.imagesError && (
              <Callout tone="warn" compact>
                {result.imagesError}
              </Callout>
            )}
            {result.listings.length === 0 ? (
              <EmptyState icon="search" title="Нічого не знайдено.">
                Спробуйте інші або коротші слова, ширшу категорію чи приберіть обмеження ціни.
              </EmptyState>
            ) : (
              <div className="market-grid">
                {result.listings.map((l) => (
                  <ResultCard
                    key={l.listingId}
                    l={l}
                    tracked={shops.find((s) => s.id === l.shopId)}
                    note={notes[l.shopId]}
                    busy={tracking.has(l.shopId)}
                    onTrack={() => void track(l.shopId)}
                    onShow={showShop}
                  />
                ))}
              </div>
            )}
          </>
        )}
        {loading && <Loading>Завантаження…</Loading>}
        {more && !loading && (
          <div className="market-more">
            <span className="market-muted">
              Показано {formatCount(result.listings.length)} з {formatCount(result.count)}
            </span>
            <Button icon="chevron-down" onClick={() => query && void run(query, nextOffset)}>
              Показати ще
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export const ui: FeatureUi = {
  topModals: [
    Object.assign(
      { id: 'market', button: '🔎 Пошук по Etsy', title: 'Пошук по всьому Etsy', Component: MarketSearch },
      // Read by the host (panelMeta) as the window's subtitle.
      { description: 'Товари всіх магазинів Etsy — щоб оцінити ціни, попит і конкурентів. Програма лише читає: нічого не купує й не змінює.' }
    )
  ]
}
