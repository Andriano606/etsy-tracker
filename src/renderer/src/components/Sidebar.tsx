import { formatAgo, formatCount, isStale } from '@shared/format'
import { glossaryEntry, type GlossaryKey } from '@shared/glossary'
import type { Quota, ShopSummary } from '@shared/types'
import { ownShopId, useStore } from '../store'
import { scanProgressText } from './ShopView'
import { TOP_MODALS } from '../features/registry'
import { Button, Icon, InfoTip, Spinner, Tooltip, type IconName } from '../ui'
import { ShopIcon } from './ShopIcon'

/** "1 товар" / "3 товари" / "12 товарів". */
export function itemsWord(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'товар'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'товари'
  return 'товарів'
}

// The sidebar windows' labels come with a leading emoji ("🔎 Пошук по Etsy").
// The sidebar shows one icon set instead: the emoji is replaced by an icon and
// kept only as hidden text, so the label is still findable by its full text.
const LEADING_EMOJI = /^(\p{Extended_Pictographic}️?)\s*/u
const NAV_ICONS: Record<string, IconName> = { market: 'search' }
const NAV_HINTS: Record<string, GlossaryKey> = { market: 'shell.marketSearch' }

function NavButton({
  text,
  icon,
  hint,
  onClick,
  className
}: {
  text: string
  icon: IconName
  hint?: string
  onClick: () => void
  className?: string
}): JSX.Element {
  const m = text.match(LEADING_EMOJI)
  const label = m ? text.slice(m[0].length) : text
  return (
    <Tooltip content={hint}>
      <button type="button" className={'sidebar-nav-item' + (className ? ' ' + className : '')} onClick={onClick}>
        <Icon name={icon} size={16} />
        {m && <span hidden>{m[1]} </span>}
        <span className="truncate">{label}</span>
      </button>
    </Tooltip>
  )
}

function ShopMeta({ shop, busy, label }: { shop: ShopSummary; busy: boolean; label?: string }): JSX.Element {
  if (busy) return <span className="shop-item-progress">{label ?? 'Сканування…'}</span>
  if (shop.lastScan?.status === 'error')
    return (
      <span className="shop-item-error">
        <Icon name="warning" size={12} />
        <span>помилка сканування</span>
      </span>
    )
  if (!shop.lastOkScan) return <span>ще не скановано</span>
  const at = shop.lastOkScan.finishedAt ?? shop.lastOkScan.startedAt
  const stale = isStale(at)
  return (
    <>
      <span>
        {formatCount(shop.activeCount)} {itemsWord(shop.activeCount)}
      </span>
      <span className={stale ? 'shop-item-ago is-stale' : 'shop-item-ago'}>
        {' · '}
        {formatAgo(at)}
      </span>
    </>
  )
}

const short = (k: GlossaryKey): string => glossaryEntry(k)?.short ?? ''

/**
 * The tooltip of a shop row (also its accessible description, so it is read on
 * keyboard focus): the full name + tagline, then what the row's status, the
 * amber age and the "+N" badge mean — plain sentences from the glossary.
 * A plain function (not a component): the Tooltip reads the description from the elements' text.
 */
function shopHint(shop: ShopSummary, busy: boolean, mine: boolean): JSX.Element {
  const lines: string[] = []
  if (mine) lines.push('Ваш власний магазин — ви увійшли в Etsy.')
  if (!busy) {
    if (shop.lastScan?.status === 'error') lines.push(short('shell.scanFailed'))
    else if (!shop.lastOkScan) lines.push(short('shell.notScanned'))
    else if (isStale(shop.lastOkScan.finishedAt ?? shop.lastOkScan.startedAt)) lines.push(short('shell.staleData'))
    if (shop.newCount > 0) lines.push(`«+${shop.newCount}»: ${short('shell.newBadge')}`)
  }
  return (
    <span className="shop-hint">
      <b className="shop-hint-name">
        {shop.shopName}
        {(shop.title || lines.length > 0) && <span className="sr-only">.</span>}
      </b>
      {shop.title && <span className="shop-hint-title"> {shop.title}</span>}
      {lines.map((l) => (
        <span key={l} className="shop-hint-line">
          {' '}
          {l}
        </span>
      ))}
    </span>
  )
}

function QuotaMeter({ quota }: { quota: Quota }): JSX.Element | null {
  const left = quota.remainingToday
  if (left == null) return null
  const limit = quota.limitPerDay
  const pct = limit ? Math.max(0, Math.min(100, (left / limit) * 100)) : null
  const tone = pct == null ? '' : pct < 5 ? ' is-low' : pct < 20 ? ' is-warn' : ''
  return (
    <div className="quota">
      <div className="quota-head">
        <span>Запити до Etsy на сьогодні</span>
        <InfoTip glossary="quota" />
      </div>
      {pct != null && (
        <div
          className={'quota-bar' + tone}
          role="meter"
          aria-label="Залишок запитів на сьогодні"
          aria-valuemin={0}
          aria-valuemax={limit ?? undefined}
          aria-valuenow={left}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="quota-text num">
        Залишилось {formatCount(left)}
        {limit != null && ` з ${formatCount(limit)}`}
      </div>
    </div>
  )
}

export function Sidebar(): JSX.Element {
  const {
    shops,
    activeShopId,
    scanning,
    progress,
    quota,
    keyStatus,
    selectShop,
    setShowAddShop,
    setShowSettings,
    setShowMcp,
    setShowMyShop,
    openFeatureModal,
    etsyAuth,
    mcpStatus,
    scanAll
  } = useStore()
  const anyScanning = Object.values(scanning).some(Boolean)
  const hasKey = !!keyStatus?.hasKey
  const mine = ownShopId({ etsyAuth })
  // Signed in, the own shop is simply in the list (marked "мій"); the button is for signing in.
  const showMyShopButton = mine == null || !shops.some((s) => s.id === mine)
  const mcpState = mcpStatus?.running
    ? 'Зараз увімкнено і працює.'
    : mcpStatus?.enabled && mcpStatus.error
      ? 'Увімкнено, але не вдалося запустити — відкрийте, щоб побачити причину.'
      : 'Зараз вимкнено.'

  return (
    <aside className="sidebar" aria-label="Бічна панель">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <span className="sidebar-logo" aria-hidden="true">
            <Icon name="store" size={16} />
          </span>
          <div className="sidebar-brand-text">
            <div className="sidebar-title">Etsy Tracker</div>
            <div className="sidebar-tagline truncate">стеження за магазинами</div>
          </div>
        </div>
        <Tooltip
          side="bottom"
          content={
            <>
              <b>Доступ для Claude.</b> {short('mcp')} {mcpState}
            </>
          }
        >
          <button type="button" className="sidebar-icon-btn mcp-btn" aria-label="MCP-сервер для Claude" onClick={() => setShowMcp(true)}>
            <Icon name="server" size={17} />
            {mcpStatus?.running && <span className="dot-ok" />}
            {mcpStatus?.enabled && mcpStatus.error && <span className="dot-warn" />}
          </button>
        </Tooltip>
        <Tooltip content={hasKey ? 'Налаштування: ключ доступу, країна покупця, сховище фото' : 'Налаштування — спершу додайте ключ доступу до Etsy'} side="bottom">
          <button type="button" className="sidebar-icon-btn" aria-label="Налаштування" onClick={() => setShowSettings(true)}>
            <Icon name="settings" size={17} />
            {!hasKey && <span className="dot-warn" />}
          </button>
        </Tooltip>
      </div>

      <div className="sidebar-actions">
        <button type="button" className="add-shop" onClick={() => setShowAddShop(true)}>
          <Icon name="plus" size={16} />
          <span>Додати магазин</span>
        </button>
        {(TOP_MODALS.length > 0 || showMyShopButton) && (
          <nav className="sidebar-nav" aria-label="Інструменти">
            {TOP_MODALS.map((m) => {
              const hint = NAV_HINTS[m.id]
              return (
                <NavButton
                  key={m.id}
                  text={m.button}
                  icon={NAV_ICONS[m.id] ?? 'layers'}
                  hint={hint ? glossaryEntry(hint)?.short : m.title}
                  onClick={() => openFeatureModal(m.id)}
                />
              )
            })}
            {showMyShopButton && (
              <NavButton
                text="✏️ Мій магазин"
                icon="user"
                className="my-shop-btn"
                hint={etsyAuth?.loggedIn ? 'Ви увійшли в Etsy — керуйте своїм магазином' : glossaryEntry('shell.myShop')?.short}
                onClick={() => setShowMyShop(true)}
              />
            )}
          </nav>
        )}
      </div>

      <div className="sidebar-section-head">
        <span>Магазини</span>
        {shops.length > 0 && <span className="sidebar-section-count num">{shops.length}</span>}
        <InfoTip glossary="shell.shopList" />
      </div>

      {shops.length === 0 ? (
        <div className="sidebar-empty">Тут з’являться магазини, за якими ви стежите. Додайте перший кнопкою «Додати магазин».</div>
      ) : (
        <ul className="shop-list" aria-label="Магазини">
          {shops.map((s) => {
            const busy = !!scanning[s.id]
            const active = s.id === activeShopId
            return (
              <li key={s.id}>
                <Tooltip content={shopHint(s, busy, s.id === mine)} side="bottom" align="start">
                  <button
                    type="button"
                    className={`shop-item${active ? ' active' : ''}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => void selectShop(s.id)}
                  >
                    <ShopIcon url={s.iconUrl} name={s.shopName} size={32} />
                    <span className="shop-item-text">
                      <span className="shop-item-name">
                        <span className="shop-item-label">{s.shopName}</span>
                        {s.id === mine && <span className="shop-item-mine">мій</span>}
                      </span>
                      <span className="meta">
                        <ShopMeta shop={s} busy={busy} label={progress[s.id] ? scanProgressText(progress[s.id]) : undefined} />
                      </span>
                    </span>
                    {busy ? (
                      <Spinner size={14} label="Сканування" className="shop-item-spinner" />
                    ) : s.newCount > 0 ? (
                      <>
                        <span className="sr-only">нових товарів:</span>
                        <span className="new-badge num">+{s.newCount}</span>
                      </>
                    ) : null}
                  </button>
                </Tooltip>
              </li>
            )
          })}
        </ul>
      )}

      <div className="sidebar-footer">
        <div className="scan-all-row">
          <Button
            variant="subtle"
            icon="refresh"
            fullWidth
            busy={anyScanning}
            disabled={!shops.length || !hasKey}
            onClick={() => void scanAll()}
          >
            {anyScanning ? 'Сканування…' : 'Сканувати всі'}
          </Button>
          <InfoTip glossary="shell.scanAll" />
        </div>
        {!hasKey && shops.length > 0 && <p className="sidebar-note">Щоб сканувати, додайте ключ доступу в Налаштуваннях.</p>}
        {quota && <QuotaMeter quota={quota} />}
      </div>
    </aside>
  )
}
