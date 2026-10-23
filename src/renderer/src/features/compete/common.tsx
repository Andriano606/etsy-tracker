// Small pieces the "compete" panels share: loading an action's answer, the
// loading/error states, money and a list of listing rows.

import { useEffect, useState } from 'react'
import type { CompeteListingRow, CompeteMoney } from '@shared/features/compete'
import { formatPrice } from '@shared/format'
import { featureCall } from '../call'

export interface Loaded<T> {
  data: T | null
  error: string | null
  loading: boolean
}

/** The answer of compete.`action`(args), loaded on mount and whenever args change. */
export function useCompete<T>(action: string, args: Record<string, unknown>): Loaded<T> {
  const key = JSON.stringify(args)
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
  }, [action, key])
  return state
}

export function ErrorNote({ error }: { error: string }): JSX.Element {
  return (
    <div className="test-result err" role="alert">
      {error}
    </div>
  )
}

/** "Завантаження…" / the error / the content once there is data. */
export function LoadedView<T>({ state, children }: { state: Loaded<T>; children: (data: T) => JSX.Element }): JSX.Element {
  if (state.error) return <ErrorNote error={state.error} />
  if (state.data == null) return <div className="hint">Завантаження…</div>
  return children(state.data)
}

export const money = (m: CompeteMoney | null | undefined): string => (m ? formatPrice(m.amount, m.divisor, m.currency) : '—')

export const yesNo = (v: boolean | null | undefined): string => (v == null ? '—' : v ? 'так' : 'ні')

/** A link to the listing on etsy.com (opened in the browser through main's allow-list). */
export function EtsyLink({ url, label = 'На Etsy ↗' }: { url: string | null; label?: string }): JSX.Element | null {
  if (!url) return null
  return (
    <button className="btn small" onClick={() => void window.api.openExternal(url)}>
      {label}
    </button>
  )
}

export function ListingRows({ listings }: { listings: CompeteListingRow[] }): JSX.Element {
  return (
    <ul className="my-listings">
      {listings.map((l) => (
        <li key={l.listingId}>
          <div className="my-listing-text">
            <div className="my-listing-title" title={l.title}>
              {l.title || `Товар #${l.listingId}`}
            </div>
            <div className="dim">
              {money(l.price)}
              {l.featuredRank != null && ` · ★ ${l.featuredRank}`}
              {l.numFavorers != null && ` · ❤ ${l.numFavorers}`}
              {l.state && l.state !== 'active' && ` · ${l.state}`}
            </div>
          </div>
          <EtsyLink url={l.url} />
        </li>
      ))}
    </ul>
  )
}
