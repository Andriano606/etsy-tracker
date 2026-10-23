// Feature "media": "Фото, відео й файли" under the own-listing editor
// (Мій магазин → Лістинги → Редагувати).

import './media.css'
import { MediaSection } from './media/MediaSection'
import type { FeatureUi } from './types'

export const ui: FeatureUi = {
  ownListingSections: [{ id: 'media', label: 'Фото, відео й файли', Component: MediaSection }]
}
