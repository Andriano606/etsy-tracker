// The "compete" sections of a tracked shop's "ℹ️ Більше" window: shop
// sections (open one → its listings), featured listings, return policies.

import { Fragment, useEffect, useRef, useState } from 'react'
import type { CompeteListingRow, CompeteListingsPage, ReturnPolicyInfo, ShopSectionInfo } from '@shared/features/compete'
import { formatCount } from '@shared/format'
import type { ShopSummary } from '@shared/types'
import { Badge, Button, Icon, InfoTip, Loading } from '../../ui'
import { featureCall } from '../call'
import { EmptyNote, ErrorNote, ListingRows, LoadedView, MoreBar, useCompete, useReveal, YesNo } from './common'

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
  if (rows == null) return error ? <ErrorNote error={error} onRetry={() => void load(0)} /> : <Loading inline>Завантаження товарів…</Loading>
  return (
    <div className="ui-stack">
      {rows.length === 0 ? <EmptyNote icon="box">{empty}</EmptyNote> : <ListingRows listings={rows} />}
      {error && <ErrorNote error={error} onRetry={() => void load(rows.length)} />}
      <MoreBar shown={rows.length} total={count} busy={busy} onMore={() => void load(rows.length)} />
    </div>
  )
}

const sectionTitle = (s: { id: number; title: string } | null, id: number): string => s?.title || `Розділ #${id}`

/** One opened section: fresh details (getShopSection) + its listings. */
function SectionView({ shopId, sectionId, onClose }: { shopId: number; sectionId: number; onClose: () => void }): JSX.Element {
  const section = useCompete<ShopSectionInfo>('section', { shopId, sectionId })
  const title = sectionTitle(section.data, sectionId)
  const { box, heading } = useReveal<HTMLDivElement, HTMLHeadingElement>()
  return (
    <div ref={box} className="compete-section ui-card" data-testid="compete-section-view">
      <div className="compete-head">
        <h4 ref={heading} tabIndex={-1} className="truncate" title={title}>
          {title}
        </h4>
        {section.data?.activeListingCount != null && (
          <Badge tone="info" icon="box">
            активних товарів: {formatCount(section.data.activeListingCount)}
          </Badge>
        )}
        <span className="ui-spacer" />
        <Button size="sm" variant="ghost" icon="close" onClick={onClose}>
          Закрити розділ
        </Button>
      </div>
      {section.error && <ErrorNote error={section.error} onRetry={section.reload} />}
      <PagedListings key={sectionId} action="sectionListings" args={{ shopId, sectionId }} empty="У цьому розділі немає активних товарів." />
    </div>
  )
}

function SectionsPanel({ shop }: { shop: ShopSummary }): JSX.Element {
  const state = useCompete<ShopSectionInfo[]>('sections', { shopId: shop.id })
  const [open, setOpen] = useState<number | null>(null)
  // "Закрити розділ" gives the focus back to that section's "Відкрити".
  const openers = useRef(new Map<number, HTMLButtonElement>())
  const returnTo = useRef<number | null>(null)
  useEffect(() => {
    if (open != null || returnTo.current == null) return
    openers.current.get(returnTo.current)?.focus()
    returnTo.current = null
  }, [open])
  const close = (id: number): void => {
    returnTo.current = id
    setOpen(null)
  }
  return (
    <LoadedView state={state}>
      {(sections) =>
        sections.length === 0 ? (
          <EmptyNote icon="folder" hint="Продавець не ділив товари на групи — усі вони на головній сторінці магазину.">
            У магазині немає розділів.
          </EmptyNote>
        ) : (
          <div className="ui-stack" data-testid="compete-sections">
            <ul className="feat-rows">
              {sections.map((s) => (
                <Fragment key={s.id}>
                <li className={'feat-row' + (open === s.id ? ' is-open' : '')}>
                  <span className="feat-row-thumb compete-section-icon" aria-hidden="true">
                    <Icon name="folder" size={18} />
                  </span>
                  <div className="feat-row-text">
                    <div className="feat-row-title truncate" title={sectionTitle(s, s.id)}>
                      {sectionTitle(s, s.id)}
                    </div>
                    <div className="feat-row-meta">
                      {s.activeListingCount == null ? 'кількість товарів невідома' : `${formatCount(s.activeListingCount)} ${plural(s.activeListingCount)}`}
                    </div>
                  </div>
                  <div className="feat-row-actions">
                    <Button
                      ref={(b) => {
                        if (b) openers.current.set(s.id, b)
                        else openers.current.delete(s.id)
                      }}
                      size="sm"
                      icon="list"
                      disabled={open === s.id}
                      aria-expanded={open === s.id}
                      onClick={() => setOpen(s.id)}
                    >
                      Відкрити
                    </Button>
                  </div>
                </li>
                {/* The opened section right under its row, not after the whole list. */}
                {open === s.id && (
                  <li className="feat-row-expanded">
                    <SectionView shopId={shop.id} sectionId={s.id} onClose={() => close(s.id)} />
                  </li>
                )}
                </Fragment>
              ))}
            </ul>
          </div>
        )
      }
    </LoadedView>
  )
}

/** "1 товар", "3 товари", "5 товарів". */
function plural(n: number): string {
  const d = n % 10
  const h = n % 100
  if (d === 1 && h !== 11) return 'товар'
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return 'товари'
  return 'товарів'
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
          <EmptyNote icon="box" hint="Тоді діють загальні правила Etsy для покупців.">
            Магазин не має правил повернення.
          </EmptyNote>
        ) : (
          <div className="ui-stack">
            {policies.length > 1 && (
              <p className="ui-section-desc">Різні товари магазину можуть мати різні правила — тут усі, що є в магазині.</p>
            )}
            <div className="table-wrap">
              <table className="data-table" data-testid="compete-policies">
                <thead>
                  <tr>
                    <th>
                      Повернення <InfoTip glossary="features.compete.returns" />
                    </th>
                    <th>
                      Обмін <InfoTip glossary="features.compete.exchanges" />
                    </th>
                    <th>
                      Строк повернення <InfoTip glossary="features.compete.returnDeadline" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <YesNo value={p.acceptsReturns} />
                      </td>
                      <td>
                        <YesNo value={p.acceptsExchanges} />
                      </td>
                      <td>{deadlineText(p.returnDeadline)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      }
    </LoadedView>
  )
}

export const SHOP_PANELS = [
  {
    id: 'compete-sections',
    label: 'Розділи магазину',
    icon: 'folder' as const,
    description: 'Групи, на які продавець поділив свої товари, і що в кожній. Показує, як магазин організовує асортимент.',
    Component: SectionsPanel
  },
  {
    id: 'compete-featured',
    label: 'Рекомендовані товари',
    icon: 'star' as const,
    description: 'Товари, які продавець сам виніс нагору магазину, — зазвичай його найкращі продажі або новинки.',
    Component: FeaturedPanel
  },
  {
    id: 'compete-return-policies',
    label: 'Правила повернення',
    icon: 'refresh' as const,
    description: 'Чи можна повернути або обміняти товар цього магазину і за скільки днів.',
    Component: ReturnPoliciesPanel
  }
]
