// Every feature's UI pieces, in FEATURES order (main/features/index.ts).

import type { FeatureUi, ListingPanel, MyShopTab, OwnListingSection, ShopPanel, TopModal } from './types'
import { ui as market } from './market'
import { ui as compete } from './compete'
import { ui as inventory } from './inventory'
import { ui as media } from './media'
import { ui as listingMeta } from './listingMeta'
import { ui as shopConfig } from './shopConfig'
import { ui as orders } from './orders'
import { ui as account } from './account'

const ALL: FeatureUi[] = [market, compete, inventory, media, listingMeta, shopConfig, orders, account]

export const MY_SHOP_TABS: MyShopTab[] = ALL.flatMap((u) => u.myShopTabs ?? [])
export const OWN_LISTING_SECTIONS: OwnListingSection[] = ALL.flatMap((u) => u.ownListingSections ?? [])
export const SHOP_PANELS: ShopPanel[] = ALL.flatMap((u) => u.shopPanels ?? [])
export const LISTING_PANELS: ListingPanel[] = ALL.flatMap((u) => u.listingPanels ?? [])
export const TOP_MODALS: TopModal[] = ALL.flatMap((u) => u.topModals ?? [])
