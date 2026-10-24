// "Продажі" under the own-listing editor: the listing's sales
// (getShopReceiptTransactionsByListing) — count, units, revenue per currency,
// the latest sales. A sale carries no order status, so canceled / refunded
// orders are counted too, and the OAS documents no order: with more sales than
// were read the totals are partial and the newest may be missing.

import type { ListingSales } from '@shared/features/orders'
import { formatEtsyDate } from '@shared/format'
import type { MyListing } from '@shared/types'
import { EmptyState, Stat } from '../../ui'
import { Note } from '../shopConfig/kit'
import { Alert, Loading, fmtMoney, fmtMoneys, useOrders } from './common'

export function ListingSalesSection({ listing }: { listing: MyListing; onChanged: (l?: MyListing) => void }): JSX.Element {
  const s = useOrders<ListingSales>('listingSales', { listingId: listing.listingId })
  if (s.error) return <Alert text={s.error} title="Не вдалося завантажити продажі" />
  if (!s.value) return <Loading>Завантаження продажів…</Loading>
  const v = s.value
  if (v.total === 0)
    return (
      <EmptyState compact icon="receipt" title="Продажів цього товару ще не було.">
        Коли товар куплять, тут з’являться кількість, виручка і останні продажі.
      </EmptyState>
    )
  return (
    <div className="fx-page fx-page--compact" data-testid="listing-sales">
      <div className="ui-stat-grid">
        <Stat compact label="Продажів" glossary="transaction" value={v.total} caption={v.truncated ? `прочитано ${v.scanned}` : 'за весь час'} />
        <Stat compact label="Продано шт." glossary="features.orders.unitsSold" value={v.quantity} />
        <Stat compact label="Виручка" glossary="features.orders.revenue" value={fmtMoneys(v.revenue)} />
        <Stat compact label="Останній продаж" value={formatEtsyDate(v.lastSaleAt)} />
      </div>
      <p className="fx-muted">
        Виручка = ціна × кількість, без доставки, податків і знижок. Враховано всі продажі, зокрема зі скасованих і повернутих замовлень (Etsy не
        повідомляє стан замовлення для окремого продажу).
      </p>
      {v.truncated && (
        <Note tone="warn">
          Прочитано лише {v.scanned} продажів із {v.total} (у порядку, який обирає Etsy) — підсумки неповні, найновіші продажі можуть бути відсутні.
        </Note>
      )}
      <h4 className="fx-subhead">{v.truncated ? 'Найновіші з прочитаних продажів' : 'Останні продажі'}</h4>
      <ul className="fx-list ord-sales" aria-label="Останні продажі">
        {v.recent.map((t) => (
          <li key={t.transactionId} className="fx-list-row">
            <span>
              <span className="num">{formatEtsyDate(t.createdAt)}</span>
              {t.receiptId != null && <span className="fx-meta"> · замовлення #{t.receiptId}</span>}
            </span>
            <span className="num fx-title">
              {t.quantity} шт. × {fmtMoney(t.price)}
            </span>
            {t.variations.length > 0 && <span className="ord-sales-vars fx-meta">{t.variations.map((x) => `${x.name}: ${x.value}`).join('; ')}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
