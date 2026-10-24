// Feature "orders" — the own shop's orders, money and per-listing sales:
// "Мій магазин" tabs "Замовлення" and "Фінанси", and "Продажі" under the
// own-listing editor. The pieces live in features/orders/.

import type { FeatureUi } from './types'
import { FinanceTab } from './orders/FinanceTab'
import { ListingSalesSection } from './orders/ListingSalesSection'
import { OrdersTab } from './orders/OrdersTab'
import './orders.css'

export const ui: FeatureUi = {
  myShopTabs: [
    { id: 'orders', label: 'Замовлення', Component: OrdersTab },
    { id: 'orders-finance', label: 'Фінанси', Component: FinanceTab }
  ],
  ownListingSections: [
    Object.assign(
      { id: 'orders-sales', label: 'Продажі', Component: ListingSalesSection },
      // Read by the host (panelMeta) for the section's summary row.
      { icon: 'receipt' as const, description: 'Скільки разів цей товар купили, скільки штук і скільки він приніс.' }
    )
  ]
}
