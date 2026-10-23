// Feature "shopConfig" — the own shop's configuration in "Мій магазин": tabs
// Розділи / Доставка / Обробка / Повернення / Свята / Партнери, and the own
// listing's "Розділ магазину" section (see features/types.ts).

import './shopConfig.css'
import { HolidaysTab, PartnersTab } from './shopConfig/Holidays'
import { ProcessingTab } from './shopConfig/Processing'
import { ReturnsTab } from './shopConfig/Returns'
import { ListingSectionPanel, SectionsTab } from './shopConfig/Sections'
import { ShippingTab } from './shopConfig/Shipping'
import type { FeatureUi } from './types'

export const ui: FeatureUi = {
  myShopTabs: [
    { id: 'shopConfig-sections', label: 'Розділи', Component: SectionsTab },
    { id: 'shopConfig-shipping', label: 'Доставка', Component: ShippingTab },
    { id: 'shopConfig-processing', label: 'Обробка', Component: ProcessingTab },
    { id: 'shopConfig-returns', label: 'Повернення', Component: ReturnsTab },
    { id: 'shopConfig-holidays', label: 'Свята', Component: HolidaysTab },
    { id: 'shopConfig-partners', label: 'Партнери', Component: PartnersTab }
  ],
  ownListingSections: [{ id: 'shopConfig-section', label: 'Розділ магазину', Component: ListingSectionPanel }]
}
