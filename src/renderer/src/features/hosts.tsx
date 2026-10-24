// Where the feature registries render: a tracked shop's "ℹ️ Більше" window and
// the sidebar windows (TOP_MODALS). The own-shop tabs/sections and the listing
// panels render inside MyShopModal / ListingModal.

import { ownShopId, useStore } from '../store'
import { Button, Modal, Term } from '../ui'
import { LazyDetails, panelMeta } from './LazyDetails'
import { SHOP_PANELS, TOP_MODALS } from './registry'

/** "ℹ️ Більше" for a tracked shop: every feature's shop panel, each loaded when opened. */
export function ShopPanelsModal(): JSX.Element | null {
  const { shopPanelsFor, openShopPanels, shops, etsyAuth } = useStore()
  const close = (): void => openShopPanels(null)
  const shop = shops.find((s) => s.id === shopPanelsFor)
  if (shopPanelsFor == null || !shop) return null
  const mine = shop.id === ownShopId({ etsyAuth })
  return (
    <Modal
      size="lg"
      className="shop-panels-modal"
      onClose={close}
      title={`${shop.shopName}: більше даних з Etsy`}
      subtitle={
        <>
          <Term glossary="features.compete.liveData">Живі дані</Term> прямо з Etsy. Кожен розділ завантажується, лише коли ви його відкриваєте.
        </>
      }
      footer={<Button onClick={close}>Закрити</Button>}
    >
      <div className="feature-panels">
        {SHOP_PANELS.map((p) => {
          const meta = panelMeta(p)
          return (
            <LazyDetails key={p.id} label={p.label} description={meta.description} icon={meta.icon} testId={`shop-panel-${p.id}`}>
              {() => <p.Component shop={shop} mine={mine} />}
            </LazyDetails>
          )
        })}
      </div>
    </Modal>
  )
}

/** A sidebar window (TOP_MODALS), e.g. "🔎 Пошук по Etsy". */
export function FeatureModalHost(): JSX.Element | null {
  const { featureModal, openFeatureModal } = useStore()
  const close = (): void => openFeatureModal(null)
  const m = TOP_MODALS.find((x) => x.id === featureModal)
  if (!m) return null
  const subtitle = panelMeta(m).description
  return (
    <Modal size="xl" className="feature-modal" onClose={close} title={m.title} subtitle={subtitle} footer={<Button onClick={close}>Закрити</Button>}>
      <m.Component />
    </Modal>
  )
}
