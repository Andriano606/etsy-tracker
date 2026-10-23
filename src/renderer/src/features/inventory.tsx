// Feature "inventory" — its UI pieces (see features/types.ts): the variants
// table and the variation photos under the own-listing editor, and the
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
    { id: 'inventory', label: 'Ціна, кількість і варіації', Component: InventorySection },
    { id: 'variation-images', label: 'Фото варіацій', Component: VariationImagesSection }
  ]
}
