// What a feature's UI module (features/<id>.tsx) may export; registry.ts collects them.

import type { Listing, MyListing, ShopSummary } from '@shared/types'

/** A tab in "Мій магазин" (signed in). */
export interface MyShopTab {
  id: string
  label: string
  Component: () => JSX.Element
}

/** A collapsible section under the own-listing editor (Мій магазин → Лістинги → Редагувати). */
export interface OwnListingSection {
  id: string
  label: string
  /** onChanged(listing?) = the listing changed on Etsy (refresh the row; pass the new one when known). */
  Component: (p: { listing: MyListing; onChanged: (l?: MyListing) => void }) => JSX.Element
}

/** A collapsible section in a tracked shop's "ℹ️ Більше" window (any shop; `mine` = the own one). */
export interface ShopPanel {
  id: string
  label: string
  Component: (p: { shop: ShopSummary; mine: boolean }) => JSX.Element
}

/** A collapsible section at the bottom of a tracked listing's window (live data). */
export interface ListingPanel {
  id: string
  label: string
  Component: (p: { listing: Listing; mine: boolean }) => JSX.Element
}

/** A window opened from a sidebar button (e.g. "🔎 Пошук по Etsy"). */
export interface TopModal {
  id: string
  /** The sidebar button text. */
  button: string
  title: string
  Component: () => JSX.Element
}

export interface FeatureUi {
  myShopTabs?: MyShopTab[]
  ownListingSections?: OwnListingSection[]
  shopPanels?: ShopPanel[]
  listingPanels?: ListingPanel[]
  topModals?: TopModal[]
}
