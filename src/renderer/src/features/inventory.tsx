// Feature "inventory" — its UI pieces (see features/types.ts): the variants
// table and the variant photos under the own-listing editor, and the
// "Ціни й залишки" tab of "Мій магазин".

import { InventorySection } from './inventory/InventorySection'
import { PricesTab } from './inventory/PricesTab'
import { VariationImagesSection } from './inventory/VariationImagesSection'
import type { FeatureUi } from './types'
import './inventory.css'

export { InventorySection, PricesTab, VariationImagesSection }

export const ui: FeatureUi = {
  myShopTabs: [{ id: 'inventory', label: 'Ціни й залишки', Component: PricesTab }],
  ownListingSections: [
    // icon + description: read by the host (panelMeta) for the section's summary row.
    Object.assign(
      { id: 'inventory', label: 'Ціна, кількість і варіанти', Component: InventorySection },
      { icon: 'money' as const, description: 'Ціна, скільки штук можна купити, і варіанти (розмір, колір) — кожен зі своєю ціною.' }
    ),
    Object.assign(
      { id: 'variation-images', label: 'Фото варіантів', Component: VariationImagesSection },
      { icon: 'layers' as const, description: 'Яке фото покупець побачить, коли вибере колір чи інший варіант.' }
    )
  ]
}
