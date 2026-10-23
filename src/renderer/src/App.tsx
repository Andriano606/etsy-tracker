import { useEffect } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { ShopView } from './components/ShopView'
import { SettingsModal, TRADEMARK_NOTICE } from './components/SettingsModal'
import { AddShopModal } from './components/AddShopModal'
import { ListingModal } from './components/ListingModal'
import { HistoryModal } from './components/ScanHistory'
import { ConfirmModal } from './components/ConfirmModal'
import { NoKeyState, NoShopsState } from './components/EmptyStates'

export function App(): JSX.Element {
  const {
    loaded,
    keyStatus,
    shops,
    activeShopId,
    error,
    load,
    setShops,
    setScanning,
    setProgress,
    setQuota,
    setError,
    setImageSync
  } = useStore()

  useEffect(() => {
    void load()
    const offs = [
      window.api.onShopsChanged(setShops),
      window.api.onScanProgress(setProgress),
      window.api.onScanState(({ shopId, running }) => setScanning(shopId, running)),
      window.api.onQuota(setQuota),
      window.api.onImageSync(setImageSync)
    ]
    return () => offs.forEach((off) => off())
  }, [load, setShops, setProgress, setScanning, setQuota, setImageSync])

  let main: JSX.Element | null
  if (!loaded) main = <div className="placeholder">Завантаження…</div>
  else if (!keyStatus?.hasKey && shops.length === 0) main = <NoKeyState />
  else if (shops.length === 0) main = <NoShopsState />
  else if (activeShopId == null) main = <div className="placeholder">Виберіть магазин зліва.</div>
  else main = <ShopView />

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        {error && (
          <div className="banner err top" role="alert">
            {error}
            <button className="banner-close" aria-label="Закрити" onClick={() => setError(null)}>
              ×
            </button>
          </div>
        )}
        {main}
        <footer className="legal-footer">{TRADEMARK_NOTICE}</footer>
      </main>
      <SettingsModal />
      <AddShopModal />
      {/* A listing can be opened from the history modal — render it on top. */}
      <HistoryModal />
      <ListingModal />
      <ConfirmModal />
    </div>
  )
}
