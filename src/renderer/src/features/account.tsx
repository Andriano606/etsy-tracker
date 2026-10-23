// Feature "account" (the reference UI — copy its shape): the "Акаунт" tab in "Мій магазин".

import { useEffect, useState } from 'react'
import type { AccountSummary } from '@shared/features/account'
import { SCOPE_LABEL } from '@shared/myShop'
import { featureCall } from './call'
import type { FeatureUi } from './types'

function AccountTab(): JSX.Element {
  const [a, setA] = useState<AccountSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void featureCall<AccountSummary>('account', 'summary').then((r) => {
      if (!alive) return
      if (r.ok) setA(r.value)
      else setError(r.error)
    })
    return () => {
      alive = false
    }
  }, [])
  if (error) {
    return (
      <div className="test-result err" role="alert">
        {error}
      </div>
    )
  }
  if (!a) return <div className="hint">Завантаження…</div>
  const name = [a.firstName, a.lastName].filter(Boolean).join(' ')
  return (
    <div data-testid="account-tab">
      <dl className="listing-facts">
        <dt>Ім’я</dt>
        <dd>{name || '—'}</dd>
        <dt>Email</dt>
        <dd>{a.email ?? '—'}</dd>
        <dt>Магазин</dt>
        <dd>{a.shopName ? `${a.shopName} (#${a.shopId})` : '—'}</dd>
        <dt>Дозволи входу</dt>
        <dd>{a.grantedScopes ? a.grantedScopes.map((s) => SCOPE_LABEL[s] ?? s).join(', ') : '—'}</dd>
      </dl>
      {a.addresses && (
        <>
          <h4>Адреси</h4>
          {a.addresses.length === 0 ? (
            <div className="hint">Адрес немає.</div>
          ) : (
            <ul className="plain-list">
              {a.addresses.map((x) => (
                <li key={x.id}>
                  {[x.name, x.firstLine, x.secondLine, x.city, x.state, x.zip, x.countryName ?? x.countryIso].filter(Boolean).join(', ')}
                  {x.isDefaultShipping && <span className="dim"> · для доставки за замовчуванням</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {a.notes.map((n) => (
        <div key={n} className="hint warn">
          {n}
        </div>
      ))}
    </div>
  )
}

export const ui: FeatureUi = {
  myShopTabs: [{ id: 'account', label: 'Акаунт', Component: AccountTab }]
}
