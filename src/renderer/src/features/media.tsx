// Feature "media": "Фото, відео й файли" under the own-listing editor
// (Мій магазин → Товари → Редагувати).

import './media.css'
import { MediaSection } from './media/MediaSection'
import type { FeatureUi } from './types'

export const ui: FeatureUi = {
  ownListingSections: [
    // icon + description: read by the host (panelMeta) for the section's summary row.
    Object.assign(
      { id: 'media', label: 'Фото, відео й файли', Component: MediaSection },
      { icon: 'photo' as const, description: 'Фото й відео на сторінці товару, а для цифрового товару — файли, які отримає покупець.' }
    )
  ]
}
