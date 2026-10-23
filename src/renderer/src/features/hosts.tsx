// Where the feature registries render: a tracked shop's "ℹ️ Більше" window and
// the sidebar windows (TOP_MODALS). The own-shop tabs/sections and the listing
// panels render inside MyShopModal / ListingModal.

import { ownShopId, useStore } from '../store'
import { useEscape } from '../components/useEscape'
import { LazyDetails } from './LazyDetails'
import { SHOP_PANELS, TOP_MODALS } from './registry'

/** "ℹ️ Більше" for a tracked shop: every feature's shop panel, each loaded when opened. */
export function ShopPanelsModal(): JSX.Element | null {
  const { shopPanelsFor, openShopPanels, shops, etsyAuth } = useStore()
  const close = (): void => openShopPanels(null)
  useEscape(close, shopPanelsFor != null)
  const shop = shops.find((s) => s.id === shopPanelsFor)
  if (shopPanelsFor == null || !shop) return null
  const mine = shop.id === ownShopId({ etsyAuth })
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal my-shop-modal" role="dialog" aria-labelledby="panels-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="panels-title">{shop.shopName}: більше даних з Etsy</h2>
        <p className="hint">Живі дані з Etsy API — кожен розділ завантажується, коли ви його відкриваєте.</p>
        {SHOP_PANELS.map((p) => (
          <LazyDetails key={p.id} label={p.label} testId={`shop-panel-${p.id}`}>
            {() => <p.Component shop={shop} mine={mine} />}
          </LazyDetails>
        ))}
        <div className="modal-actions">
          <button className="btn" onClick={close}>
            Закрити
          </button>
        </div>
      </div>
    </div>
  )
}

/** A sidebar window (TOP_MODALS), e.g. "🔎 Пошук по Etsy". */
export function FeatureModalHost(): JSX.Element | null {
  const { featureModal, openFeatureModal } = useStore()
  const close = (): void => openFeatureModal(null)
  useEscape(close, featureModal != null)
  const m = TOP_MODALS.find((x) => x.id === featureModal)
  if (!m) return null
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal feature-modal" role="dialog" aria-labelledby="feature-modal-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="feature-modal-title">{m.title}</h2>
        <m.Component />
        <div className="modal-actions">
          <button className="btn" onClick={close}>
            Закрити
          </button>
        </div>
      </div>
    </div>
  )
}
