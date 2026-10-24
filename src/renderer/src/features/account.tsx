// Feature "account" (the reference UI — copy its shape): the "Акаунт" tab in "Мій магазин".

import './account.css'
import { useEffect, useState } from 'react'
import type { AccountAddress, AccountSummary } from '@shared/features/account'
// The permissions in the words "Мій магазин" uses ("товар", not Etsy's "лістинг").
import { scopeText } from '../components/MyShopModal'
import { Badge, Button, Callout, EmptyState, Icon, InfoTip, Loading, ZoomImage } from '../ui'
import { featureCall } from './call'
import type { FeatureUi } from './types'

const addressLine = (x: AccountAddress): string =>
  [x.firstLine, x.secondLine, x.city, x.state, x.zip, x.countryName ?? x.countryIso].filter(Boolean).join(', ')

function AccountTab(): JSX.Element {
  const [a, setA] = useState<AccountSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setError(null)
    void featureCall<AccountSummary>('account', 'summary').then((r) => {
      if (!alive) return
      if (r.ok) setA(r.value)
      else setError(r.error)
    })
    return () => {
      alive = false
    }
  }, [attempt])
  if (error) {
    return (
      <Callout
        tone="error"
        title="Не вдалося прочитати акаунт"
        action={
          <Button icon="refresh" onClick={() => setAttempt((n) => n + 1)}>
            Спробувати ще
          </Button>
        }
      >
        {error}
      </Callout>
    )
  }
  if (!a) return <Loading>Завантаження акаунта…</Loading>
  const name = [a.firstName, a.lastName].filter(Boolean).join(' ')
  return (
    <div className="account-tab ui-stack" data-testid="account-tab">
      <section className="ui-card account-head" aria-label="Акаунт Etsy">
        {a.avatarUrl ? (
          // Etsy gives the avatar only at 75×75 — the viewer opens that.
          <div className="account-avatar">
            <ZoomImage className="account-avatar-zoom" src={a.avatarUrl} alt={name ? `Фото профілю: ${name}` : 'Фото профілю'} />
          </div>
        ) : (
          <div className="account-avatar" aria-hidden="true">
            <Icon name="user" size={26} />
          </div>
        )}
        <div className="account-who">
          <div className="account-kicker">
            Ваш акаунт Etsy <InfoTip glossary="features.account.account" />
          </div>
          <div className="account-name truncate" title={name || undefined}>
            {name || 'Ім’я не вказано'}
          </div>
          <dl className="account-facts">
            <dt>Пошта</dt>
            <dd className="truncate" title={a.email ?? undefined}>
              {a.email ?? <span className="dim">невідома</span>}
            </dd>
            <dt>Магазин</dt>
            <dd className="truncate" title={a.shopName ?? undefined}>
              {a.shopName ? (
                a.shopName
              ) : (
                <span className="dim">немає</span>
              )}
            </dd>
          </dl>
        </div>
      </section>

      <section className="ui-card">
        <h3 className="ui-section-title">
          <Icon name="key" size={15} /> Дозволи входу <InfoTip glossary="permissions" />
        </h3>
        <p className="ui-section-desc">Що ви дозволили програмі робити від вашого імені, коли входили в Etsy.</p>
        {a.grantedScopes ? (
          a.grantedScopes.length === 0 ? (
            <div className="dim">Дозволів немає.</div>
          ) : (
            <ul className="account-scopes" aria-label="Видані дозволи">
              {a.grantedScopes.map((s) => (
                <li key={s}>
                  <Badge tone="accent" icon="check">
                    {scopeText(s)}
                  </Badge>
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="dim">Etsy не сказав, які дозволи має вхід.</div>
        )}
      </section>

      {a.addresses && (
        <section className="ui-card">
          <h3 className="ui-section-title">
            <Icon name="globe" size={15} /> Адреси <InfoTip glossary="features.account.addresses" />
          </h3>
          {a.addresses.length === 0 ? (
            <EmptyState compact icon="globe" title="Адрес немає.">
              У вашому профілі Etsy не збережено жодної адреси.
            </EmptyState>
          ) : (
            <ul className="account-addresses">
              {a.addresses.map((x) => (
                <li key={x.id} className="account-address">
                  <div className="account-address-name">
                    {x.name || 'Без імені'}
                    {x.isDefaultShipping && (
                      <Badge tone="info" hint="Etsy підставляє цю адресу, коли ви самі щось купуєте.">
                        для доставки за замовчуванням
                      </Badge>
                    )}
                  </div>
                  <div className="account-address-line">{addressLine(x) || '—'}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {a.notes.length > 0 && (
        <div className="ui-stack">
          {a.notes.map((n) => (
            <Callout key={n} tone="warn" compact>
              {n}
            </Callout>
          ))}
        </div>
      )}
    </div>
  )
}

export const ui: FeatureUi = {
  myShopTabs: [{ id: 'account', label: 'Акаунт', Component: AccountTab }]
}
