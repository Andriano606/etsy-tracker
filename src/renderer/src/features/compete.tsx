// Feature "compete": live data of any shop / listing — the shop panels in a
// tracked shop's "ℹ️ Більше" window and the listing panels at the bottom of a
// tracked listing's window (see compete/shopPanels.tsx, compete/listingPanels.tsx).

import './compete.css'
import { LISTING_PANELS } from './compete/listingPanels'
import { SHOP_PANELS } from './compete/shopPanels'
import type { FeatureUi } from './types'

export const ui: FeatureUi = {
  shopPanels: SHOP_PANELS,
  listingPanels: LISTING_PANELS
}
