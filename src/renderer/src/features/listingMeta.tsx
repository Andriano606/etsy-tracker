// Feature "listingMeta": sections under the own-listing editor (Мій магазин →
// Лістинги → Редагувати): attributes, personalization, translations, delete.

import { AttributesSection } from './listingMeta/Attributes'
import { DangerZoneSection } from './listingMeta/DangerZone'
import { PersonalizationSection } from './listingMeta/Personalization'
import { TranslationsSection } from './listingMeta/Translations'
import { useDeletedListings } from './listingMeta/deleted'
import type { FeatureUi, OwnListingSection } from './types'
import './listingMeta.css'

type Section = OwnListingSection['Component']

/** The section, or a note once the listing was deleted in "Небезпечна зона". */
function unlessDeleted(Body: Section): Section {
  return function Guarded(p) {
    const gone = useDeletedListings((s) => s.ids.includes(p.listing.listingId))
    return gone ? <div className="hint">Лістинг видалено з Etsy — редагувати нічого.</div> : <Body {...p} />
  }
}

export const ui: FeatureUi = {
  ownListingSections: [
    { id: 'attributes', label: 'Атрибути', Component: unlessDeleted(AttributesSection) },
    { id: 'personalization', label: 'Персоналізація', Component: unlessDeleted(PersonalizationSection) },
    { id: 'translations', label: 'Переклади', Component: unlessDeleted(TranslationsSection) },
    { id: 'danger', label: 'Небезпечна зона', Component: DangerZoneSection }
  ]
}
