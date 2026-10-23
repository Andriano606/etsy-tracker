// "Продажі" under the own-listing editor: the listing's sales
// (getShopReceiptTransactionsByListing) — count, units, revenue per currency,
// the latest sales. A sale carries no order status, so canceled / refunded
// orders are counted too, and the OAS documents no order: with more sales than
// were read the totals are partial and the newest may be missing.

import type { ListingSales } from '@shared/features/orders'
import { formatEtsyDate } from '@shared/format'
import type { MyListing } from '@shared/types'
import { Alert, Loading, fmtMoney, fmtMoneys, useOrders } from './common'

export function ListingSalesSection({ listing }: { listing: MyListing; onChanged: (l?: MyListing) => void }): JSX.Element {
  const s = useOrders<ListingSales>('listingSales', { listingId: listing.listingId })
  if (s.error) return <Alert text={s.error} />
  if (!s.value) return <Loading />
  const v = s.value
  if (v.total === 0) return <div className="hint">Продажів цього лістингу ще не було.</div>
  return (
    <div data-testid="listing-sales">
      <dl className="listing-facts">
        <dt>Продажів</dt>
        <dd>{v.total}</dd>
        <dt>Продано шт.</dt>
        <dd>{v.quantity}</dd>
        <dt>Виручка</dt>
        <dd>{fmtMoneys(v.revenue)}</dd>
        <dt>Останній продаж</dt>
        <dd>{formatEtsyDate(v.lastSaleAt)}</dd>
      </dl>
      <div className="hint">
        Виручка = ціна × кількість, без доставки, податків і знижок. Враховано всі продажі, зокрема зі скасованих і повернутих замовлень (Etsy
        не повідомляє стан замовлення для окремого продажу).
      </div>
      {v.truncated && (
        <div className="hint warn">
          Прочитано лише {v.scanned} продажів із {v.total} (у порядку, який обирає Etsy) — підсумки неповні, найновіші продажі можуть бути відсутні.
        </div>
      )}
      <h4>{v.truncated ? 'Найновіші з прочитаних продажів' : 'Останні продажі'}</h4>
      <table className="data-table">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Шт.</th>
            <th>Ціна за од.</th>
            <th>Варіанти</th>
            <th>Замовлення</th>
          </tr>
        </thead>
        <tbody>
          {v.recent.map((t) => (
            <tr key={t.transactionId}>
              <td>{formatEtsyDate(t.createdAt)}</td>
              <td>{t.quantity}</td>
              <td>{fmtMoney(t.price)}</td>
              <td>{t.variations.map((x) => `${x.name}: ${x.value}`).join('; ') || '—'}</td>
              <td>{t.receiptId != null ? `#${t.receiptId}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
