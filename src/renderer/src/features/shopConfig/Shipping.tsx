// "Доставка" (Мій магазин): shipping profiles → one profile (origin,
// processing time) with its destinations and upgrades; every form is the OAS
// request body of its call, carriers come from getShippingCarriers.

import { useState } from 'react'
import {
  daysText,
  moneyInput,
  moneyText,
  REGION_LABEL,
  type ShippingDestination,
  type ShippingProfile,
  type ShippingUpgrade
} from '@shared/features/shopConfig'
import { countryLabel } from '@shared/countries'
import {
  CountrySelect,
  DeliveryFields,
  deliveryFields,
  deliveryState,
  ErrorNote,
  Loading,
  Status,
  TextField,
  useCarriers,
  useChange,
  useLoad,
  type Change,
  type DeliveryState
} from './common'

type Target = 'country' | 'eu' | 'non_eu' | 'none'

function targetOf(d: ShippingDestination | null): Target {
  if (!d || d.destinationCountry) return 'country'
  return d.destinationRegion
}

function targetFields(t: Target, country: string): Record<string, string> {
  return t === 'country' ? { destination_country_iso: country } : { destination_region: t }
}

const whereText = (d: ShippingDestination): string =>
  d.destinationCountry ? countryLabel(d.destinationCountry) : REGION_LABEL[d.destinationRegion]

function deliveryText(x: { carrierId: number | null; mailClass: string | null; minDeliveryDays: number | null; maxDeliveryDays: number | null }): string {
  if (x.carrierId && x.mailClass) return `перевізник #${x.carrierId} · ${x.mailClass}`
  return daysText(x.minDeliveryDays, x.maxDeliveryDays)
}

function TargetFields({
  target,
  country,
  onTarget,
  onCountry,
  allowEverywhere
}: {
  target: Target
  country: string
  onTarget: (t: Target) => void
  onCountry: (c: string) => void
  allowEverywhere: boolean
}): JSX.Element {
  return (
    <div className="field-row">
      <div className="field">
        <label>
          Куди
          <select value={target} onChange={(e) => onTarget(e.target.value as Target)}>
            <option value="country">Країна</option>
            <option value="eu">{REGION_LABEL.eu}</option>
            <option value="non_eu">{REGION_LABEL.non_eu}</option>
            {allowEverywhere && <option value="none">{REGION_LABEL.none}</option>}
          </select>
        </label>
      </div>
      {target === 'country' && <CountrySelect label="Країна призначення" value={country} onChange={onCountry} />}
    </div>
  )
}

// --------------------------------------------------------------- destinations

function DestinationForm({
  profile,
  dest,
  onSaved,
  onCancel
}: {
  profile: ShippingProfile
  dest: ShippingDestination | null
  onSaved: (note: string) => void
  onCancel: () => void
}): JSX.Element {
  const [target, setTarget] = useState<Target>(targetOf(dest))
  const [country, setCountry] = useState(dest?.destinationCountry ?? 'US')
  const [primary, setPrimary] = useState(moneyInput(dest?.primaryCost ?? null))
  const [secondary, setSecondary] = useState(moneyInput(dest?.secondaryCost ?? null))
  const [delivery, setDelivery] = useState<DeliveryState>(deliveryState(dest))
  const { carriers, error: carrierError } = useCarriers(profile.originCountry)
  const ch = useChange()
  const where = target === 'country' ? countryLabel(country) : REGION_LABEL[target]
  const save = async (): Promise<void> => {
    const input = { primary_cost: primary, secondary_cost: secondary, ...targetFields(target, country), ...deliveryFields(delivery) }
    const change: Change = dest
      ? {
          confirm: `Зберегти доставку «${where}» у профілі «${profile.title}»? Це змінить вартість/строк для всіх лістингів із цим профілем.`,
          action: 'updateDestination',
          args: { profileId: profile.id, destinationId: dest.id, input },
          done: 'Напрямок збережено.'
        }
      : {
          confirm: `Додати доставку «${where}» у профіль «${profile.title}»? Покупці побачать її у всіх лістингах із цим профілем.`,
          action: 'createDestination',
          args: { profileId: profile.id, input },
          done: 'Напрямок додано.'
        }
    if (await ch.run<ShippingDestination>(change)) onSaved(change.done)
  }
  return (
    <div className="sc-form" data-testid="sc-destination-form">
      <h4>{dest ? 'Змінити напрямок' : 'Новий напрямок'}</h4>
      <TargetFields target={target} country={country} onTarget={setTarget} onCountry={setCountry} allowEverywhere />
      <div className="field-row">
        <TextField label="Вартість за один товар" value={primary} onChange={setPrimary} hint="У валюті магазину." />
        <TextField label="За кожен наступний товар" value={secondary} onChange={setSecondary} />
      </div>
      <DeliveryFields value={delivery} onChange={setDelivery} carriers={carriers} idPrefix={`dest-${dest?.id ?? 'new'}`} />
      {carrierError && <div className="hint warn">Перевізники: {carrierError}</div>}
      <div className="settings-actions">
        <button className="btn primary" disabled={ch.busy} onClick={() => void save()}>
          {dest ? 'Зберегти напрямок' : 'Додати напрямок'}
        </button>
        <button className="btn" onClick={onCancel}>
          Скасувати
        </button>
      </div>
      <Status error={ch.error} note={ch.note} />
    </div>
  )
}

function Destinations({ profile }: { profile: ShippingProfile }): JSX.Element {
  const list = useLoad<ShippingDestination[]>('destinations', { profileId: profile.id }, String(profile.id))
  const [editing, setEditing] = useState<ShippingDestination | 'new' | null>(null)
  const ch = useChange()
  const remove = async (d: ShippingDestination): Promise<void> => {
    const r = await ch.run({
      confirm: `Видалити доставку «${whereText(d)}» з профілю «${profile.title}»? Покупці звідти більше не зможуть купити лістинги з цим профілем.`,
      action: 'deleteDestination',
      args: { profileId: profile.id, destinationId: d.id },
      done: 'Напрямок видалено.'
    })
    if (r) list.reload()
  }
  const saved = (note: string): void => {
    setEditing(null)
    ch.notify(note)
    list.reload()
  }
  return (
    <div data-testid="sc-destinations">
      <h4>Напрямки доставки</h4>
      <ErrorNote error={list.error} />
      {!list.value && !list.error && <Loading />}
      {list.value && list.value.length === 0 && <div className="hint">Напрямків немає.</div>}
      {list.value && list.value.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Куди</th>
              <th>Один товар</th>
              <th>Кожен наступний</th>
              <th>Доставка</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.value.map((d) => (
              <tr key={d.id}>
                <td>{whereText(d)}</td>
                <td>{moneyText(d.primaryCost)}</td>
                <td>{moneyText(d.secondaryCost)}</td>
                <td>{deliveryText(d)}</td>
                <td className="sc-actions">
                  <button className="btn small" onClick={() => setEditing(d)}>
                    Змінити
                  </button>
                  <button className="btn small danger" disabled={ch.busy} onClick={() => void remove(d)}>
                    Видалити
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Status error={ch.error} note={ch.note} />
      {editing ? (
        <DestinationForm
          key={editing === 'new' ? 'new' : editing.id}
          profile={profile}
          dest={editing === 'new' ? null : editing}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div className="settings-actions">
          <button className="btn" onClick={() => setEditing('new')}>
            ＋ Додати напрямок
          </button>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------- upgrades

function UpgradeForm({
  profile,
  upgrade,
  onSaved,
  onCancel
}: {
  profile: ShippingProfile
  upgrade: ShippingUpgrade | null
  onSaved: (note: string) => void
  onCancel: () => void
}): JSX.Element {
  const [international, setInternational] = useState(upgrade?.international ?? false)
  const [name, setName] = useState(upgrade?.name ?? '')
  const [price, setPrice] = useState(moneyInput(upgrade?.price ?? null))
  const [secondary, setSecondary] = useState(moneyInput(upgrade?.secondaryPrice ?? null))
  const [delivery, setDelivery] = useState<DeliveryState>(deliveryState(upgrade))
  const { carriers, error: carrierError } = useCarriers(profile.originCountry)
  const ch = useChange()
  const save = async (): Promise<void> => {
    const input = {
      type: international ? 1 : 0,
      upgrade_name: name,
      price,
      secondary_price: secondary,
      ...deliveryFields(delivery)
    }
    const change: Change = upgrade
      ? {
          confirm: `Зберегти апгрейд «${name.trim()}» профілю «${profile.title}»? Покупці побачать його при оформленні замовлення.`,
          action: 'updateUpgrade',
          args: { profileId: profile.id, upgradeId: upgrade.id, input },
          done: 'Апгрейд збережено.'
        }
      : {
          confirm: `Додати апгрейд «${name.trim()}» у профіль «${profile.title}»? Покупці побачать його при оформленні замовлення.`,
          action: 'createUpgrade',
          args: { profileId: profile.id, input },
          done: 'Апгрейд додано.'
        }
    if (await ch.run<ShippingUpgrade>(change)) onSaved(change.done)
  }
  return (
    <div className="sc-form" data-testid="sc-upgrade-form">
      <h4>{upgrade ? 'Змінити апгрейд' : 'Новий апгрейд доставки'}</h4>
      <div className="radio-row" role="radiogroup" aria-label="Тип апгрейду">
        <label>
          <input type="radio" name={`upg-${upgrade?.id ?? 'new'}`} checked={!international} onChange={() => setInternational(false)} /> Всередині
          країни
        </label>
        <label>
          <input type="radio" name={`upg-${upgrade?.id ?? 'new'}`} checked={international} onChange={() => setInternational(true)} /> Міжнародний
        </label>
      </div>
      <TextField label="Назва (бачать покупці)" value={name} onChange={setName} />
      <div className="field-row">
        <TextField label="Доплата" value={price} onChange={setPrice} hint="У валюті магазину." />
        <TextField label="Доплата за кожен наступний товар" value={secondary} onChange={setSecondary} />
      </div>
      <DeliveryFields value={delivery} onChange={setDelivery} carriers={carriers} idPrefix={`upg-${upgrade?.id ?? 'new'}-d`} />
      {carrierError && <div className="hint warn">Перевізники: {carrierError}</div>}
      <div className="settings-actions">
        <button className="btn primary" disabled={ch.busy} onClick={() => void save()}>
          {upgrade ? 'Зберегти апгрейд' : 'Додати апгрейд'}
        </button>
        <button className="btn" onClick={onCancel}>
          Скасувати
        </button>
      </div>
      <Status error={ch.error} note={ch.note} />
    </div>
  )
}

function Upgrades({ profile }: { profile: ShippingProfile }): JSX.Element {
  const list = useLoad<ShippingUpgrade[]>('upgrades', { profileId: profile.id }, String(profile.id))
  const [editing, setEditing] = useState<ShippingUpgrade | 'new' | null>(null)
  const ch = useChange()
  const remove = async (u: ShippingUpgrade): Promise<void> => {
    const r = await ch.run({
      confirm: `Видалити апгрейд «${u.name}» з профілю «${profile.title}»?`,
      action: 'deleteUpgrade',
      args: { profileId: profile.id, upgradeId: u.id },
      done: 'Апгрейд видалено.'
    })
    if (r) list.reload()
  }
  const saved = (note: string): void => {
    setEditing(null)
    ch.notify(note)
    list.reload()
  }
  return (
    <div data-testid="sc-upgrades">
      <h4>Апгрейди (швидша доставка за доплату)</h4>
      <ErrorNote error={list.error} />
      {!list.value && !list.error && <Loading />}
      {list.value && list.value.length === 0 && <div className="hint">Апгрейдів немає.</div>}
      {list.value && list.value.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Назва</th>
              <th>Тип</th>
              <th>Доплата</th>
              <th>За наступний</th>
              <th>Доставка</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.value.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.international ? 'Міжнародний' : 'Всередині країни'}</td>
                <td>{moneyText(u.price)}</td>
                <td>{moneyText(u.secondaryPrice)}</td>
                <td>{deliveryText(u)}</td>
                <td className="sc-actions">
                  <button className="btn small" onClick={() => setEditing(u)}>
                    Змінити
                  </button>
                  <button className="btn small danger" disabled={ch.busy} onClick={() => void remove(u)}>
                    Видалити
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Status error={ch.error} note={ch.note} />
      {editing ? (
        <UpgradeForm
          key={editing === 'new' ? 'new' : editing.id}
          profile={profile}
          upgrade={editing === 'new' ? null : editing}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div className="settings-actions">
          <button className="btn" onClick={() => setEditing('new')}>
            ＋ Додати апгрейд
          </button>
        </div>
      )}
    </div>
  )
}

// -------------------------------------------------------------------- profile

type Unit = 'business_days' | 'weeks'

function ProcessingTimeFields({
  min,
  max,
  unit,
  onMin,
  onMax,
  onUnit
}: {
  min: string
  max: string
  unit: Unit
  onMin: (v: string) => void
  onMax: (v: string) => void
  onUnit: (u: Unit) => void
}): JSX.Element {
  return (
    <div className="field-row">
      <TextField label="Обробка: мін. (1–10)" type="number" value={min} onChange={onMin} />
      <TextField label="Обробка: макс. (1–10)" type="number" value={max} onChange={onMax} />
      <div className="field">
        <label>
          Одиниця
          <select value={unit} onChange={(e) => onUnit(e.target.value as Unit)}>
            <option value="business_days">робочі дні</option>
            <option value="weeks">тижні</option>
          </select>
        </label>
      </div>
    </div>
  )
}

/**
 * Only what the user changed is sent: the origin only once picked (an unknown
 * one starts unset), an emptied postal code as '' (clears it), the processing
 * time only when typed. Stays mounted after a save, so its note stays too.
 */
function ProfileEditForm({ profile, onSaved }: { profile: ShippingProfile; onSaved: (p: ShippingProfile) => void }): JSX.Element {
  const [title, setTitle] = useState(profile.title)
  const [origin, setOrigin] = useState(profile.originCountry ?? '')
  const [postal, setPostal] = useState(profile.originPostalCode ?? '')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [unit, setUnit] = useState<Unit>('business_days')
  const ch = useChange()
  const input: Record<string, unknown> = {}
  if (title.trim() !== profile.title) input.title = title
  if (origin && origin !== profile.originCountry) input.origin_country_iso = origin
  if (postal.trim() !== (profile.originPostalCode ?? '')) input.origin_postal_code = postal.trim()
  if (min || max) Object.assign(input, { min_processing_time: min, max_processing_time: max, processing_time_unit: unit })
  const save = async (): Promise<void> => {
    const p = await ch.run<ShippingProfile>({
      confirm: `Зберегти профіль доставки «${profile.title}»? Зміни стосуються всіх лістингів із цим профілем.`,
      action: 'updateShippingProfile',
      args: { profileId: profile.id, input },
      done: 'Профіль збережено.'
    })
    if (p) {
      setMin('')
      setMax('')
      onSaved(p.value)
    }
  }
  return (
    <div className="sc-form" data-testid="sc-profile-edit">
      <TextField label="Назва профілю" value={title} onChange={setTitle} />
      <div className="field-row">
        <CountrySelect label="Країна відправлення" value={origin} onChange={setOrigin} unset={!profile.originCountry} />
        <TextField label="Поштовий індекс відправлення" value={postal} onChange={setPostal} />
      </div>
      <ProcessingTimeFields min={min} max={max} unit={unit} onMin={setMin} onMax={setMax} onUnit={setUnit} />
      <div className="hint">Час обробки змінюється лише якщо ви його вкажете (Etsy не повертає поточний у профілі).</div>
      <div className="settings-actions">
        <button className="btn primary" disabled={ch.busy || Object.keys(input).length === 0} onClick={() => void save()}>
          Зберегти профіль
        </button>
      </div>
      <Status error={ch.error} note={ch.note} />
    </div>
  )
}

/** `note`: a note to show on opening (the profile was just created); `onBack(note)`: back to the list, with a note to show there. */
function ProfileDetail({
  profileId,
  note,
  onBack
}: {
  profileId: number
  note: string | null
  onBack: (note: string | null) => void
}): JSX.Element {
  const loaded = useLoad<ShippingProfile>('shippingProfile', { profileId }, String(profileId))
  const [fresh, setFresh] = useState<ShippingProfile | null>(null)
  const ch = useChange()
  const profile = fresh ?? loaded.value
  const remove = async (): Promise<void> => {
    if (!profile) return
    const r = await ch.run({
      confirm: `Видалити профіль доставки «${profile.title}»? Лістинги з ним залишаться без доставки.`,
      action: 'deleteShippingProfile',
      args: { profileId },
      done: 'Профіль видалено.'
    })
    if (r) onBack('Профіль видалено.')
  }
  return (
    <div data-testid="sc-profile">
      <div className="editor-head">
        <button className="btn small" onClick={() => onBack(null)}>
          ← Усі профілі
        </button>
        <strong>{profile?.title ?? `Профіль #${profileId}`}</strong>
      </div>
      <Status error={null} note={note} />
      <ErrorNote error={loaded.error} />
      {!profile && !loaded.error && <Loading />}
      {profile && (
        <>
          <dl className="listing-facts">
            <dt>Звідки</dt>
            <dd>
              {profile.originCountry ? countryLabel(profile.originCountry) : '—'}
              {profile.originPostalCode ? `, ${profile.originPostalCode}` : ''}
            </dd>
            <dt>Тип</dt>
            <dd>{profile.profileType === 'calculated' ? 'Розрахунковий (за вагою)' : 'Фіксована вартість'}</dd>
            <dt>Плата за обробку</dt>
            <dd>
              {profile.domesticHandlingFee ?? 0} всередині країни · {profile.internationalHandlingFee ?? 0} міжнародна
            </dd>
          </dl>
          <ProfileEditForm profile={profile} onSaved={setFresh} />
          <Destinations profile={profile} />
          <Upgrades profile={profile} />
          <div className="settings-actions">
            <button className="btn danger" disabled={ch.busy} onClick={() => void remove()}>
              Видалити профіль
            </button>
          </div>
          <Status error={ch.error} note={ch.note} />
        </>
      )}
    </div>
  )
}

function ProfileCreateForm({
  onCreated,
  onCancel
}: {
  onCreated: (p: ShippingProfile, note: string) => void
  onCancel: () => void
}): JSX.Element {
  const [title, setTitle] = useState('')
  const [origin, setOrigin] = useState('UA')
  const [postal, setPostal] = useState('')
  const [target, setTarget] = useState<Target>('country')
  const [country, setCountry] = useState('US')
  const [primary, setPrimary] = useState('')
  const [secondary, setSecondary] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [unit, setUnit] = useState<Unit>('business_days')
  const [delivery, setDelivery] = useState<DeliveryState>(deliveryState(null))
  const { carriers, error: carrierError } = useCarriers(origin)
  const ch = useChange()
  const create = async (): Promise<void> => {
    const input = {
      title,
      origin_country_iso: origin,
      origin_postal_code: postal,
      primary_cost: primary,
      secondary_cost: secondary,
      ...targetFields(target, country),
      min_processing_time: min,
      max_processing_time: max,
      ...(min || max ? { processing_time_unit: unit } : {}),
      ...deliveryFields(delivery)
    }
    const change: Change = {
      confirm: `Створити профіль доставки «${title.trim()}»?`,
      action: 'createShippingProfile',
      args: { input },
      done: 'Профіль створено.'
    }
    const p = await ch.run<ShippingProfile>(change)
    if (p) onCreated(p.value, change.done)
  }
  return (
    <div className="sc-form" data-testid="sc-profile-create">
      <h4>Новий профіль доставки</h4>
      <TextField label="Назва профілю" value={title} onChange={setTitle} />
      <div className="field-row">
        <CountrySelect label="Країна відправлення" value={origin} onChange={setOrigin} />
        <TextField label="Поштовий індекс відправлення" value={postal} onChange={setPostal} hint="Потрібен, якщо в країні є індекси." />
      </div>
      <ProcessingTimeFields min={min} max={max} unit={unit} onMin={setMin} onMax={setMax} onUnit={setUnit} />
      <h4>Перший напрямок</h4>
      <TargetFields target={target} country={country} onTarget={setTarget} onCountry={setCountry} allowEverywhere={false} />
      <div className="field-row">
        <TextField label="Вартість за один товар" value={primary} onChange={setPrimary} hint="У валюті магазину." />
        <TextField label="За кожен наступний товар" value={secondary} onChange={setSecondary} />
      </div>
      <DeliveryFields value={delivery} onChange={setDelivery} carriers={carriers} idPrefix="new-profile" />
      {carrierError && <div className="hint warn">Перевізники: {carrierError}</div>}
      <div className="settings-actions">
        <button className="btn primary" disabled={ch.busy} onClick={() => void create()}>
          Створити профіль
        </button>
        <button className="btn" onClick={onCancel}>
          Скасувати
        </button>
      </div>
      <Status error={ch.error} note={ch.note} />
    </div>
  )
}

export function ShippingTab(): JSX.Element {
  const list = useLoad<ShippingProfile[]>('shippingProfiles')
  const [open, setOpen] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  if (open != null) {
    return (
      <ProfileDetail
        profileId={open}
        note={note}
        onBack={(n) => {
          setOpen(null)
          setNote(n)
          list.reload()
        }}
      />
    )
  }
  return (
    <div data-testid="sc-shipping">
      <ErrorNote error={list.error} />
      {!list.value && !list.error && <Loading />}
      <Status error={null} note={note} />
      {list.value && list.value.length === 0 && <div className="hint">Профілів доставки ще немає.</div>}
      {list.value && list.value.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Профіль</th>
              <th>Звідки</th>
              <th>Напрямків</th>
              <th>Апгрейдів</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.value.map((p) => (
              <tr key={p.id}>
                <td>{p.title || `#${p.id}`}</td>
                <td>{p.originCountry ? countryLabel(p.originCountry) : '—'}</td>
                <td>{p.destinations.length}</td>
                <td>{p.upgrades.length}</td>
                <td className="sc-actions">
                  <button
                    className="btn small"
                    onClick={() => {
                      setNote(null)
                      setOpen(p.id)
                    }}
                  >
                    Відкрити
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating ? (
        <ProfileCreateForm
          onCreated={(p, n) => {
            setCreating(false)
            setNote(n)
            setOpen(p.id)
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <div className="settings-actions">
          <button className="btn" onClick={() => setCreating(true)}>
            ＋ Новий профіль доставки
          </button>
        </div>
      )}
    </div>
  )
}
