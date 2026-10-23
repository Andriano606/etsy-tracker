// The "compete" sections of a tracked shop's "ℹ️ Більше" window: shop
// sections (open one → its listings), featured listings, return policies.

import { useEffect, useState } from 'react'
import type { CompeteListingRow, CompeteListingsPage, ReturnPolicyInfo, ShopSectionInfo } from '@shared/features/compete'
import type { ShopSummary } from '@shared/types'
import { featureCall } from '../call'
import { ErrorNote, ListingRows, LoadedView, useCompete, yesNo } from './common'

/** Listing pages of compete.`action` (offset paging, "Показати ще"). */
function PagedListings({ action, args, empty }: { action: string; args: Record<string, unknown>; empty: string }): JSX.Element {
  const [rows, setRows] = useState<CompeteListingRow[] | null>(null)
  const [count, setCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async (offset: number): Promise<void> => {
    setBusy(true)
    setError(null)
    const r = await featureCall<CompeteListingsPage>('compete', action, { ...args, offset })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setCount(r.value.count)
    setRows((prev) => [...(offset ? (prev ?? []) : []), ...r.value.listings])
  }
  // Loaded once per mount: the parent remounts this for another section/shop (key).
  useEffect(() => {
    void load(0)
  }, [])
  if (rows == null) return error ? <ErrorNote error={error} /> : <div className="hint">Завантаження…</div>
  return (
    <div>
      {rows.length === 0 ? <div className="hint">{empty}</div> : <ListingRows listings={rows} />}
      {error && <ErrorNote error={error} />}
      {rows.length > 0 && <div className="hint">Показано {rows.length} з {count}</div>}
      {rows.length < count && (
        <button className="btn small" disabled={busy} onClick={() => void load(rows.length)}>
          {busy ? 'Завантаження…' : 'Показати ще'}
        </button>
      )}
    </div>
  )
}

/** One opened section: fresh details (getShopSection) + its listings. */
function SectionView({ shopId, sectionId, onClose }: { shopId: number; sectionId: number; onClose: () => void }): JSX.Element {
  const section = useCompete<ShopSectionInfo>('section', { shopId, sectionId })
  return (
    <div className="compete-section" data-testid="compete-section-view">
      <div className="compete-head">
        <h4>{section.data ? section.data.title || `Розділ #${sectionId}` : `Розділ #${sectionId}`}</h4>
        {section.data?.activeListingCount != null && <span className="dim">активних товарів: {section.data.activeListingCount}</span>}
        <button className="btn small" onClick={onClose}>
          Закрити розділ
        </button>
      </div>
      {section.error && <ErrorNote error={section.error} />}
      <PagedListings key={sectionId} action="sectionListings" args={{ shopId, sectionId }} empty="У цьому розділі немає активних товарів." />
    </div>
  )
}

function SectionsPanel({ shop }: { shop: ShopSummary }): JSX.Element {
  const state = useCompete<ShopSectionInfo[]>('sections', { shopId: shop.id })
  const [open, setOpen] = useState<number | null>(null)
  return (
    <LoadedView state={state}>
      {(sections) =>
        sections.length === 0 ? (
          <div className="hint">У магазині немає розділів.</div>
        ) : (
          <div data-testid="compete-sections">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Розділ</th>
                  <th>Активних товарів</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sections.map((s) => (
                  <tr key={s.id}>
                    <td>{s.title || `Розділ #${s.id}`}</td>
                    <td>{s.activeListingCount ?? '—'}</td>
                    <td>
                      <button className="btn small" disabled={open === s.id} onClick={() => setOpen(s.id)}>
                        Відкрити
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {open != null && <SectionView key={open} shopId={shop.id} sectionId={open} onClose={() => setOpen(null)} />}
          </div>
        )
      }
    </LoadedView>
  )
}

function FeaturedPanel({ shop }: { shop: ShopSummary }): JSX.Element {
  return (
    <div data-testid="compete-featured">
      <PagedListings key={shop.id} action="featured" args={{ shopId: shop.id }} empty="Магазин не має рекомендованих товарів." />
    </div>
  )
}

export const deadlineText = (days: number | null): string => (days == null ? '—' : `${days} дн.`)

function ReturnPoliciesPanel({ shop }: { shop: ShopSummary }): JSX.Element {
  const state = useCompete<ReturnPolicyInfo[]>('returnPolicies', { shopId: shop.id })
  return (
    <LoadedView state={state}>
      {(policies) =>
        policies.length === 0 ? (
          <div className="hint">Магазин не має політик повернення.</div>
        ) : (
          <table className="data-table" data-testid="compete-policies">
            <thead>
              <tr>
                <th>Повернення</th>
                <th>Обмін</th>
                <th>Строк повернення</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id}>
                  <td>{yesNo(p.acceptsReturns)}</td>
                  <td>{yesNo(p.acceptsExchanges)}</td>
                  <td>{deadlineText(p.returnDeadline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </LoadedView>
  )
}

export const SHOP_PANELS = [
  { id: 'compete-sections', label: 'Розділи магазину', Component: SectionsPanel },
  { id: 'compete-featured', label: 'Рекомендовані товари', Component: FeaturedPanel },
  { id: 'compete-return-policies', label: 'Політики повернення', Component: ReturnPoliciesPanel }
]
