// Small pieces the "compete" panels share: loading an action's answer, the
// loading/error/empty states, money, yes/no and a list of listing rows.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { CompeteListingRow, CompeteMoney } from '@shared/features/compete'
import { formatCount, formatPrice } from '@shared/format'
import { Badge, Button, Callout, EmptyState, GLOSSARY, Icon, Loading, Tooltip, type IconName } from '../../ui'
import { featureCall } from '../call'

export interface Loaded<T> {
  data: T | null
  error: string | null
  loading: boolean
  /** Ask Etsy again (after an error). */
  reload: () => void
}

/** The answer of compete.`action`(args), loaded on mount, whenever args change and on `reload()`. */
export function useCompete<T>(action: string, args: Record<string, unknown>): Loaded<T> {
  const key = JSON.stringify(args)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, error: null, loading: true }))
    void featureCall<T>('compete', action, JSON.parse(key) as Record<string, unknown>).then((r) => {
      if (!alive) return
      setState(r.ok ? { data: r.value, error: null, loading: false } : { data: null, error: r.error, loading: false })
    })
    return () => {
      alive = false
    }
  }, [action, key, attempt])
  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...state, reload }
}

/** An Etsy error inside a panel: what happened (main's Ukrainian text) + "Спробувати ще" when it can be retried. */
export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }): JSX.Element {
  return (
    <Callout
      tone="error"
      compact
      action={
        onRetry && (
          <Button size="sm" icon="refresh" onClick={onRetry}>
            Спробувати ще
          </Button>
        )
      }
    >
      {error}
    </Callout>
  )
}

/** Smooth unless the user asked the system for less motion. */
export const scrollBehavior = (): ScrollBehavior =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'

/**
 * For a card that opens on a click (a section, a photo's details): once mounted,
 * scroll it to the top of the window (its CSS scroll-margin-top keeps the row
 * that opened it visible above; the content arrives later, so "nearest" would
 * leave it below the fold) and move focus to its heading (tabIndex -1), so the
 * user sees — and a screen reader hears — what opened.
 */
export function useReveal<C extends HTMLElement, H extends HTMLElement>(): { box: React.RefObject<C>; heading: React.RefObject<H> } {
  const box = useRef<C>(null)
  const heading = useRef<H>(null)
  useEffect(() => {
    box.current?.scrollIntoView?.({ block: 'start', behavior: scrollBehavior() })
    heading.current?.focus({ preventScroll: true })
  }, [])
  return { box, heading }
}

/** A number with an icon and a tooltip saying what it is (the screen-reader text says it too); focusable for the tooltip. */
export function IconStat({ icon, label, hint, value }: { icon: IconName; label: string; hint: ReactNode; value: ReactNode }): JSX.Element {
  return (
    <Tooltip content={hint}>
      <span className="feat-stat" tabIndex={0}>
        <Icon name={icon} size={13} />
        <span className="sr-only">{label}: </span>
        {value}
      </span>
    </Tooltip>
  )
}

/** "Nothing here" inside a panel: an icon + the sentence. */
export function EmptyNote({ icon = 'info', children, hint }: { icon?: IconName; children: string; hint?: ReactNode }): JSX.Element {
  return (
    <EmptyState compact icon={icon} title={children}>
      {hint}
    </EmptyState>
  )
}

/** "Завантаження…" / the error / the content once there is data. */
export function LoadedView<T>({ state, children }: { state: Loaded<T>; children: (data: T) => JSX.Element }): JSX.Element {
  if (state.error) return <ErrorNote error={state.error} onRetry={state.reload} />
  if (state.data == null) return <Loading inline>Завантаження…</Loading>
  return children(state.data)
}

export const money = (m: CompeteMoney | null | undefined): string => (m ? formatPrice(m.amount, m.divisor, m.currency) : '—')

export const yesNo = (v: boolean | null | undefined): string => (v == null ? '—' : v ? 'так' : 'ні')

/** "так" with a green check / "ні" with a dash — the meaning is in the word, the icon only helps. */
export function YesNo({ value }: { value: boolean | null | undefined }): JSX.Element {
  if (value == null) return <span className="dim">—</span>
  return (
    <span className={value ? 'feat-yes' : 'feat-no'}>
      <Icon name={value ? 'check' : 'minus'} size={13} />
      {value ? 'так' : 'ні'}
    </span>
  )
}

/** A link to the listing on etsy.com (opened in the browser through main's allow-list). */
export function EtsyLink({ url, label = 'Відкрити на Etsy' }: { url: string | null; label?: string }): JSX.Element | null {
  if (!url) return null
  return (
    <Button size="sm" variant="ghost" icon="external" onClick={() => void window.api.openExternal(url)}>
      {label}
    </Button>
  )
}

/** Listing states other than "active", in Ukrainian. */
const STATE_UA: Record<string, string> = {
  draft: 'чернетка',
  inactive: 'знятий з продажу',
  expired: 'прострочений',
  sold_out: 'розпроданий',
  removed: 'видалений',
  edit: 'редагується'
}

export function ListingRows({ listings }: { listings: CompeteListingRow[] }): JSX.Element {
  return (
    <ul className="feat-rows">
      {listings.map((l) => {
        const title = l.title || `Товар #${l.listingId}`
        return (
          <li key={l.listingId} className="feat-row" data-testid="compete-listing-row">
            <div className="feat-row-text">
              <div className="feat-row-title truncate" title={title}>
                {title}
              </div>
              <div className="feat-row-meta">
                <span className="feat-price">{money(l.price)}</span>
                {l.featuredRank != null && l.featuredRank >= 1 && (
                  <IconStat
                    icon="star"
                    label="Місце серед рекомендованих"
                    hint={`Місце №${l.featuredRank} серед рекомендованих. ${GLOSSARY['features.compete.featured'].short}`}
                    value={l.featuredRank}
                  />
                )}
                {l.numFavorers != null && (
                  <IconStat icon="heart" label="В обраному" hint={GLOSSARY.favorites.short} value={formatCount(l.numFavorers)} />
                )}
                {l.state && l.state !== 'active' && <Badge tone="warn">{STATE_UA[l.state] ?? l.state}</Badge>}
              </div>
            </div>
            <div className="feat-row-actions">
              <EtsyLink url={l.url} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** "Показано N з M" + a "Показати ще" button while there is more. */
export function MoreBar({
  shown,
  total,
  busy,
  onMore,
  unit = ''
}: {
  shown: number
  total: number
  busy: boolean
  onMore: () => void
  unit?: string
}): JSX.Element | null {
  if (shown === 0) return null
  return (
    <div className="feat-more">
      <span>
        Показано {formatCount(shown)} з {formatCount(total)}
        {unit}
      </span>
      {shown < total && (
        <Button size="sm" icon="chevron-down" busy={busy} onClick={onMore}>
          Показати ще
        </Button>
      )}
    </div>
  )
}
