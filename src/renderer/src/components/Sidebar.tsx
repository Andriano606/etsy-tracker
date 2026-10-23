import { useStore } from '../store'
import { ShopIcon } from './ShopIcon'

function GearIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
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
    mcpStatus,
    scanAll
  } = useStore()
  const anyScanning = Object.values(scanning).some(Boolean)

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Etsy Tracker</h1>
        <button
          className="icon-btn mcp-btn"
          title={mcpStatus?.running ? 'MCP-сервер для Claude: працює' : 'MCP-сервер для Claude'}
          aria-label="MCP-сервер для Claude"
          onClick={() => setShowMcp(true)}
        >
          MCP
          {mcpStatus?.running && <span className="dot-ok" />}
          {mcpStatus?.enabled && mcpStatus.error && <span className="dot-warn" />}
        </button>
        <button
          className="icon-btn"
          title="Налаштування"
          aria-label="Налаштування"
          onClick={() => setShowSettings(true)}
        >
          <GearIcon />
          {!keyStatus?.hasKey && <span className="dot-warn" />}
        </button>
      </div>

      <button className="add-shop" onClick={() => setShowAddShop(true)}>
        + Додати магазин
      </button>

      <div className="shop-list" role="list">
        {shops.length === 0 && (
          <div className="empty-hint">Магазинів ще немає. Додайте перший за посиланням.</div>
        )}
        {shops.map((s) => {
          const busy = !!scanning[s.id]
          const p = progress[s.id]
          const failed = s.lastScan?.status === 'error'
          return (
            <button
              key={s.id}
              role="listitem"
              className={`shop-item${s.id === activeShopId ? ' active' : ''}`}
              onClick={() => void selectShop(s.id)}
              title={s.title ?? s.shopName}
            >
              <ShopIcon url={s.iconUrl} name={s.shopName} />
              <div className="shop-item-text">
                <div className="shop-item-name">{s.shopName}</div>
                <div className="meta">
                  {busy ? (
                    <span className="scan-progress">{p?.label ?? 'Сканування…'}</span>
                  ) : failed ? (
                    <span className="err">помилка сканування</span>
                  ) : s.lastOkScan ? (
                    `${s.activeCount} товарів`
                  ) : (
                    'ще не скановано'
                  )}
                </div>
              </div>
              {busy ? (
                <span className="spinner" aria-label="Сканування" />
              ) : s.newCount > 0 ? (
                <span className="new-badge" title="Нових з минулого сканування">
                  +{s.newCount}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="sidebar-footer">
        <button
          className="btn subtle full"
          disabled={!shops.length || anyScanning || !keyStatus?.hasKey}
          onClick={() => void scanAll()}
        >
          {anyScanning ? 'Сканування…' : 'Сканувати всі'}
        </button>
        {quota?.remainingToday != null && (
          <div className="quota" title="Залишок денного ліміту запитів Etsy API (ковзне вікно 24 год)">
            Запитів сьогодні: {quota.remainingToday.toLocaleString('uk-UA')}
            {quota.limitPerDay != null && ` / ${quota.limitPerDay.toLocaleString('uk-UA')}`}
          </div>
        )}
      </div>
    </aside>
  )
}
