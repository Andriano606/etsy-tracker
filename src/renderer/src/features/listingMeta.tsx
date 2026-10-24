// Feature "listingMeta": sections under the own-listing editor (Мій магазин →
// Товари → Редагувати): attributes, personalization, translations, delete.

import { AttributesSection } from './listingMeta/Attributes'
import { DangerZoneSection } from './listingMeta/DangerZone'
import { PersonalizationSection } from './listingMeta/Personalization'
import { TranslationsSection } from './listingMeta/Translations'
import { useDeletedListings } from './listingMeta/deleted'
import type { FeatureUi, OwnListingSection } from './types'
import { Callout } from '../ui'
import './listingMeta.css'

type Section = OwnListingSection['Component']

/** The section, or a note once the listing was deleted in "Небезпечна зона". */
function unlessDeleted(Body: Section): Section {
  return function Guarded(p) {
    const gone = useDeletedListings((s) => s.ids.includes(p.listing.listingId))
    return gone ? (
      <Callout tone="info" role="note" compact>
        Товар видалено з Etsy — редагувати нічого.
      </Callout>
    ) : (
      <Body {...p} />
    )
  }
}

export const ui: FeatureUi = {
  // icon + description: read by the host (panelMeta) for each section's summary row.
  ownListingSections: [
    Object.assign(
      { id: 'attributes', label: 'Атрибути', Component: unlessDeleted(AttributesSection) },
      { icon: 'list' as const, description: 'Властивості для фільтрів пошуку Etsy: колір, розмір, свято, стиль. Допомагають покупцям знайти товар.' }
    ),
    Object.assign(
      { id: 'personalization', label: 'Персоналізація', Component: unlessDeleted(PersonalizationSection) },
      { icon: 'edit' as const, description: 'Що покупець вказує під час замовлення: ім’я, дату, вибір зі списку чи фото.' }
    ),
    Object.assign(
      { id: 'translations', label: 'Переклади', Component: unlessDeleted(TranslationsSection) },
      { icon: 'globe' as const, description: 'Назва, опис і теги іншими мовами — для покупців з інших країн.' }
    ),
    Object.assign(
      { id: 'danger', label: 'Видалити товар з Etsy', Component: DangerZoneSection },
      { icon: 'trash' as const, description: 'Назавжди прибрати товар з магазину. Цю дію не можна скасувати.' }
    )
  ]
}
