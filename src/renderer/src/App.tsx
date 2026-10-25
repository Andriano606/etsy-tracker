import { useEffect } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { ShopView } from './components/ShopView'
import { SettingsModal, TRADEMARK_NOTICE } from './components/SettingsModal'
import { McpModal } from './components/McpModal'
import { MyShopModal } from './components/MyShopModal'
import { DraftsModal } from './components/DraftsModal'
import { FeatureModalHost, ShopPanelsModal } from './features/hosts'
import { AddShopModal } from './components/AddShopModal'
import { ListingModal } from './components/ListingModal'
import { HistoryModal } from './components/ScanHistory'
import { ConfirmModal } from './components/ConfirmModal'
import { StatsModal } from './components/StatsModal'
import { NoKeyState, NoShopsState } from './components/EmptyStates'
import { Callout, EmptyState, ImageViewer, Loading } from './ui'

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
    setImageSync,
    setReviewSync,
    setEtsyAuth,
    setDrafts,
    marksChanged
  } = useStore()

  useEffect(() => {
    void load()
    const offs = [
      window.api.onShopsChanged(setShops),
      window.api.onScanProgress(setProgress),
      window.api.onScanState(({ shopId, running }) => setScanning(shopId, running)),
      window.api.onQuota(setQuota),
      window.api.onImageSync(setImageSync),
      window.api.onReviewSync(setReviewSync),
      window.api.onEtsyAuth(setEtsyAuth),
      window.api.onDraftsChanged(setDrafts),
      // Claude set a mark, or a published draft completed its example's mark.
      window.api.onMarksChanged(({ listingIds }) => void marksChanged(listingIds))
    ]
    return () => offs.forEach((off) => off())
  }, [load, setShops, setProgress, setScanning, setQuota, setImageSync, setReviewSync, setEtsyAuth, setDrafts, marksChanged])

  let main: JSX.Element | null
  if (!loaded)
    main = (
      <div className="placeholder">
        <Loading>Завантаження…</Loading>
      </div>
    )
  else if (!keyStatus?.hasKey && shops.length === 0) main = <NoKeyState />
  else if (shops.length === 0) main = <NoShopsState />
  else if (activeShopId == null)
    main = (
      <div className="placeholder">
        <EmptyState icon="store" title="Виберіть магазин зліва">
          Натисніть на магазин у списку, щоб побачити його товари і що в ньому змінилось.
        </EmptyState>
      </div>
    )
  else main = <ShopView />

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        {error && (
          <div className="app-error">
            <Callout tone="error" onClose={() => setError(null)}>
              {error}
            </Callout>
          </div>
        )}
        {main}
        <footer className="legal-footer">{TRADEMARK_NOTICE}</footer>
      </main>
      <SettingsModal />
      <McpModal />
      <MyShopModal />
      <DraftsModal />
      <ShopPanelsModal />
      <FeatureModalHost />
      <AddShopModal />
      {/* A listing can be opened from the statistics or the history — render it on top. */}
      <StatsModal />
      <HistoryModal />
      <ListingModal />
      <ConfirmModal />
      {/* Any picture opened full size — over every window. */}
      <ImageViewer />
    </div>
  )
}
