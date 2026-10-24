// "Доставка" (Мій магазин): shipping profiles → one profile (origin,
// processing time) with its destinations and upgrades ("прискорена доставка");
// every form is the OAS request body of its call, carriers come from
// getShippingCarriers (read once per opened profile).

import { useState } from 'react'
import {
  daysText,
  moneyInput,
  moneyText,
  REGION_LABEL,
  type ShippingCarrier,
  type ShippingDestination,
  type ShippingProfile,
  type ShippingUpgrade
} from '@shared/features/shopConfig'
import { countryLabel } from '@shared/countries'
import { Button, EmptyState, Field, Icon, Loading, Segmented, Select } from '../../ui'
import {
  carrierText,
  CostExample,
  CountrySelect,
  DeliveryFields,
  deliveryFields,
  deliveryState,
  TextField,
  useCarriers,
  useChange,
  useLoad,
  type Change,
  type DeliveryState
} from './common'
import { Card, DataTable, ErrorNote, Facts, Intro, Note, Status, Step, Td } from './kit'

type Target = 'country' | 'eu' | 'non_eu' | 'none'

interface Carriers {
  carriers: ShippingCarrier[] | null
  error: string | null
}

function targetOf(d: ShippingDestination | null): Target {
  if (!d || d.destinationCountry) return 'country'
  return d.destinationRegion
}

function targetFields(t: Target, country: string): Record<string, string> {
  return t === 'country' ? { destination_country_iso: country } : { destination_region: t }
}

const whereText = (d: ShippingDestination): string =>
  d.destinationCountry ? countryLabel(d.destinationCountry) : REGION_LABEL[d.destinationRegion]

/** The delivery time: the days, or — when a carrier's mail class sets it — which tariff Etsy counts it by. */
function deliveryText(
  x: { carrierId: number | null; mailClass: string | null; minDeliveryDays: number | null; maxDeliveryDays: number | null },
  carriers: ShippingCarrier[] | null
): JSX.Element | string {
  if (x.carrierId && x.mailClass)
    return (
      <span title="Строк у днях рахує Etsy за тарифом цього перевізника">
        <span className="fx-meta">за тарифом:</span> {carrierText(carriers, x.carrierId, x.mailClass)}
      </span>
    )
  return daysText(x.minDeliveryDays, x.maxDeliveryDays)
}

/** The currency of a profile's prices (from any destination), for the money fields. */
const profileCurrency = (p: ShippingProfile): string | null => p.destinations.find((d) => d.primaryCost)?.primaryCost?.currency ?? null

function CarrierNote({ error }: { error: string | null }): JSX.Element | null {
  if (!error) return null
  return (
    <Note tone="warn">
      Перевізники: {error} Строк у днях можна вказати й без них.
    </Note>
  )
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
    <div className="ui-form-grid fx-grid-2">
      <Field
        label="Куди"
        glossary="features.shopConfig.region"
        hint={target === 'none' ? 'Для всіх країн, яких немає серед інших напрямків профілю.' : target === 'country' ? 'Одна країна зі своєю ціною.' : undefined}
      >
        <Select value={target} onChange={(v) => onTarget(v as Target)} fullWidth>
          <option value="country">Країна</option>
          <option value="eu">{REGION_LABEL.eu}</option>
          <option value="non_eu">{REGION_LABEL.non_eu}</option>
          {allowEverywhere && <option value="none">{REGION_LABEL.none}</option>}
        </Select>
      </Field>
      {target === 'country' && <CountrySelect label="Країна призначення" value={country} onChange={onCountry} />}
    </div>
  )
}

function CostFields({
  primary,
  secondary,
  onPrimary,
  onSecondary,
  currency
}: {
  primary: string
  secondary: string
  onPrimary: (v: string) => void
  onSecondary: (v: string) => void
  currency: string | null
}): JSX.Element {
  return (
    <>
      <div className="ui-form-grid fx-grid-2">
        <TextField
          label="Вартість за один товар"
          glossary="features.shopConfig.primaryCost"
          money
          aside={currency ?? undefined}
          placeholder="0,00"
          hint="0 — безкоштовна доставка."
          value={primary}
          onChange={onPrimary}
        />
        <TextField
          label="За кожен наступний товар"
          glossary="features.compete.secondaryCost"
          money
          aside={currency ?? undefined}
          placeholder="0,00"
          hint="Доплата за кожен додатковий товар в одному замовленні."
          value={secondary}
          onChange={onSecondary}
        />
      </div>
      <CostExample first={primary} next={secondary} currency={currency} />
    </>
  )
}

// --------------------------------------------------------------- destinations

function DestinationForm({
  profile,
  dest,
  carriers,
  onSaved,
  onCancel
}: {
  profile: ShippingProfile
  dest: ShippingDestination | null
  carriers: Carriers
  onSaved: (note: string) => void
  onCancel: () => void
}): JSX.Element {
  const [target, setTarget] = useState<Target>(targetOf(dest))
  const [country, setCountry] = useState(dest?.destinationCountry ?? 'US')
  const [primary, setPrimary] = useState(moneyInput(dest?.primaryCost ?? null))
  const [secondary, setSecondary] = useState(moneyInput(dest?.secondaryCost ?? null))
  const [delivery, setDelivery] = useState<DeliveryState>(deliveryState(dest))
  const ch = useChange()
  const where = target === 'country' ? countryLabel(country) : REGION_LABEL[target]
  const save = async (): Promise<void> => {
    const input = { primary_cost: primary, secondary_cost: secondary, ...targetFields(target, country), ...deliveryFields(delivery) }
    const change: Change = dest
      ? {
          confirmLabel: 'Зберегти доставку',
          confirm: `Зберегти доставку «${where}» у профілі «${profile.title}»?\nНові ціна й строк одразу діятимуть для всіх товарів із цим профілем.`,
          action: 'updateDestination',
          args: { profileId: profile.id, destinationId: dest.id, input },
          done: 'Напрямок збережено.'
        }
      : {
          confirmLabel: 'Додати доставку',
          confirm: `Додати доставку «${where}» у профіль «${profile.title}»?\nПокупці звідти зможуть купувати всі товари з цим профілем.`,
          action: 'createDestination',
          args: { profileId: profile.id, input },
          done: 'Напрямок додано.'
        }
    if (await ch.run<ShippingDestination>(change)) onSaved(change.done)
  }
  return (
    <Card
      tone="form"
      testId="sc-destination-form" reveal
      title={dest ? `Змінити напрямок «${whereText(dest)}»` : 'Новий напрямок доставки'}
      footer={
        <>
          <Button variant="primary" busy={ch.busy} onClick={() => void save()}>
            {dest ? 'Зберегти напрямок' : 'Додати напрямок'}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Скасувати
          </Button>
        </>
      }
    >
      <Step n={1} title="Куди відправляєте" glossary="features.shopConfig.destination">
        <TargetFields target={target} country={country} onTarget={setTarget} onCountry={setCountry} allowEverywhere />
      </Step>
      <Step n={2} title="Скільки коштує доставка для покупця">
        <CostFields primary={primary} secondary={secondary} onPrimary={setPrimary} onSecondary={setSecondary} currency={profileCurrency(profile)} />
      </Step>
      <Step n={3} title="Як довго посилка в дорозі" glossary="features.shopConfig.deliveryMode">
        <DeliveryFields value={delivery} onChange={setDelivery} carriers={carriers.carriers} />
        <CarrierNote error={carriers.error} />
      </Step>
      <Status error={ch.error} note={ch.note} />
    </Card>
  )
}

function Destinations({ profile, carriers }: { profile: ShippingProfile; carriers: Carriers }): JSX.Element {
  const list = useLoad<ShippingDestination[]>('destinations', { profileId: profile.id }, String(profile.id))
  const [editing, setEditing] = useState<ShippingDestination | 'new' | null>(null)
  const ch = useChange()
  const remove = async (d: ShippingDestination): Promise<void> => {
    const r = await ch.run({
      confirmLabel: 'Видалити доставку',
      danger: true,
      confirm: `Видалити доставку «${whereText(d)}» з профілю «${profile.title}»?\nПокупці звідти більше не зможуть купити товари з цим профілем.`,
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
    <Card
      testId="sc-destinations"
      title="Куди ви доставляєте"
      glossary="features.shopConfig.destination"
      desc="Кожен рядок — країна чи група країн зі своєю ціною і строком. Покупці з країн, яких тут немає, не зможуть купити товари з цим профілем."
      footer={
        !editing && (
          <Button icon="plus" onClick={() => setEditing('new')}>
            Додати напрямок
          </Button>
        )
      }
    >
      <ErrorNote error={list.error} />
      {!list.value && !list.error && <Loading inline>Завантаження напрямків…</Loading>}
      {list.value && list.value.length === 0 && <p className="fx-muted">Напрямків немає — додайте хоча б один, інакше товари з цим профілем не можна купити.</p>}
      {list.value && list.value.length > 0 && (
        <DataTable
          label="Напрямки доставки"
          stack="lg"
          columns={[
            { label: 'Куди' },
            { label: 'Один товар', glossary: 'features.shopConfig.primaryCost', align: 'end' },
            { label: 'Кожен наступний', glossary: 'features.compete.secondaryCost', align: 'end' },
            { label: 'Строк доставки', glossary: 'features.shopConfig.deliveryDays' },
            { label: 'Дії', srOnly: true }
          ]}
        >
          {list.value.map((d) => (
            <tr key={d.id}>
              <Td label="Куди" primary>
                <span className="fx-where">
                  <Icon name="globe" size={14} />
                  {whereText(d)}
                </span>
              </Td>
              <Td label="Один товар" align="end">
                <span className="num">{moneyText(d.primaryCost)}</span>
              </Td>
              <Td label="Кожен наступний" align="end">
                <span className="num">{moneyText(d.secondaryCost)}</span>
              </Td>
              <Td label="Строк доставки">{deliveryText(d, carriers.carriers)}</Td>
              <Td label="Дії" actions>
                <Button size="sm" icon="edit" aria-label={`Змінити доставку «${whereText(d)}»`} onClick={() => setEditing(d)}>
                  Змінити
                </Button>
                <Button size="sm" variant="danger" icon="trash" aria-label={`Видалити доставку «${whereText(d)}»`} disabled={ch.busy} onClick={() => void remove(d)}>
                  Видалити
                </Button>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
      <Status error={ch.error} note={ch.note} />
      {editing && (
        <DestinationForm
          key={editing === 'new' ? 'new' : editing.id}
          profile={profile}
          dest={editing === 'new' ? null : editing}
          carriers={carriers}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      )}
    </Card>
  )
}

// ------------------------------------------------------------------- upgrades

function UpgradeForm({
  profile,
  upgrade,
  carriers,
  onSaved,
  onCancel
}: {
  profile: ShippingProfile
  upgrade: ShippingUpgrade | null
  carriers: Carriers
  onSaved: (note: string) => void
  onCancel: () => void
}): JSX.Element {
  const [international, setInternational] = useState(upgrade?.international ?? false)
  const [name, setName] = useState(upgrade?.name ?? '')
  const [price, setPrice] = useState(moneyInput(upgrade?.price ?? null))
  const [secondary, setSecondary] = useState(moneyInput(upgrade?.secondaryPrice ?? null))
  const [delivery, setDelivery] = useState<DeliveryState>(deliveryState(upgrade))
  const ch = useChange()
  const currency = profileCurrency(profile)
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
          confirmLabel: 'Зберегти доставку',
          confirm: `Зберегти прискорену доставку «${name.trim()}» профілю «${profile.title}»?\nПокупці побачать зміни під час оформлення замовлення.`,
          action: 'updateUpgrade',
          args: { profileId: profile.id, upgradeId: upgrade.id, input },
          done: 'Прискорену доставку збережено.'
        }
      : {
          confirmLabel: 'Додати доставку',
          confirm: `Додати прискорену доставку «${name.trim()}» у профіль «${profile.title}»?\nПокупці зможуть вибрати її під час оформлення замовлення.`,
          action: 'createUpgrade',
          args: { profileId: profile.id, input },
          done: 'Прискорену доставку додано.'
        }
    if (await ch.run<ShippingUpgrade>(change)) onSaved(change.done)
  }
  return (
    <Card
      tone="form"
      testId="sc-upgrade-form" reveal
      title={upgrade ? `Змінити «${upgrade.name}»` : 'Нова прискорена доставка'}
      footer={
        <>
          <Button variant="primary" busy={ch.busy} disabled={!name.trim()} onClick={() => void save()}>
            {upgrade ? 'Зберегти' : 'Додати'}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Скасувати
          </Button>
        </>
      }
    >
      <Step n={1} title="Для кого і як називається">
        <div className="ui-field">
          <div className="ui-field-head">
            <span className="ui-field-label" aria-hidden="true">
              Для яких замовлень
            </span>
          </div>
          <Segmented
            label="Для яких замовлень"
            value={international ? 'intl' : 'domestic'}
            onChange={(v) => setInternational(v === 'intl')}
            options={[
              { value: 'domestic', label: 'Всередині країни', icon: 'store' },
              { value: 'intl', label: 'Міжнародна', icon: 'globe' }
            ]}
          />
        </div>
        <TextField
          label="Назва для покупців"
          glossary="features.shopConfig.upgradeName"
          placeholder="Наприклад, «Експрес, 1–2 дні»"
          value={name}
          onChange={setName}
        />
      </Step>
      <Step n={2} title="Скільки доплачує покупець" glossary="features.shopConfig.upgradePrice">
        <div className="ui-form-grid fx-grid-2">
          <TextField label="Доплата" money aside={currency ?? undefined} placeholder="0,00" hint="Понад звичайну доставку, за один товар." value={price} onChange={setPrice} />
          <TextField
            label="Доплата за кожен наступний товар"
            money
            aside={currency ?? undefined}
            placeholder="0,00"
            hint="Додатково за кожен наступний товар в одному замовленні."
            value={secondary}
            onChange={setSecondary}
          />
        </div>
        <CostExample first={price} next={secondary} currency={currency} lead="за прискорену доставку 3 товарів покупець доплатить" />
      </Step>
      <Step n={3} title="Як довго посилка в дорозі" glossary="features.shopConfig.deliveryMode">
        <DeliveryFields value={delivery} onChange={setDelivery} carriers={carriers.carriers} />
        <CarrierNote error={carriers.error} />
      </Step>
      <Status error={ch.error} note={ch.note} />
    </Card>
  )
}

function Upgrades({ profile, carriers }: { profile: ShippingProfile; carriers: Carriers }): JSX.Element {
  const list = useLoad<ShippingUpgrade[]>('upgrades', { profileId: profile.id }, String(profile.id))
  const [editing, setEditing] = useState<ShippingUpgrade | 'new' | null>(null)
  const ch = useChange()
  const remove = async (u: ShippingUpgrade): Promise<void> => {
    const r = await ch.run({
      confirmLabel: 'Видалити доставку',
      danger: true,
      confirm: `Видалити прискорену доставку «${u.name}» з профілю «${profile.title}»?\nПокупці більше не зможуть її вибрати.`,
      action: 'deleteUpgrade',
      args: { profileId: profile.id, upgradeId: u.id },
      done: 'Прискорену доставку видалено.'
    })
    if (r) list.reload()
  }
  const saved = (note: string): void => {
    setEditing(null)
    ch.notify(note)
    list.reload()
  }
  return (
    <Card
      testId="sc-upgrades"
      title="Прискорена доставка за доплату"
      glossary="features.compete.upgrades"
      desc="Необов’язково. Додаткові, швидші варіанти доставки, які покупець може вибрати під час оформлення замовлення, доплативши."
      footer={
        !editing && (
          <Button icon="plus" onClick={() => setEditing('new')}>
            Додати прискорену доставку
          </Button>
        )
      }
    >
      <ErrorNote error={list.error} />
      {!list.value && !list.error && <Loading inline>Завантаження…</Loading>}
      {list.value && list.value.length === 0 && <p className="fx-muted">Прискореної доставки немає — покупці бачать лише звичайну.</p>}
      {list.value && list.value.length > 0 && (
        <DataTable
          label="Прискорена доставка"
          stack="lg"
          columns={[
            { label: 'Назва' },
            { label: 'Для кого', glossary: 'features.shopConfig.upgradeScope' },
            { label: 'Доплата', glossary: 'features.shopConfig.upgradePrice', align: 'end' },
            { label: 'За наступний', align: 'end' },
            { label: 'Строк доставки' },
            { label: 'Дії', srOnly: true }
          ]}
        >
          {list.value.map((u) => (
            <tr key={u.id}>
              <Td label="Назва" primary>
                <span className="clamp-2 fx-title" title={u.name}>
                  {u.name}
                </span>
              </Td>
              <Td label="Для кого">{u.international ? 'Міжнародна' : 'Всередині країни'}</Td>
              <Td label="Доплата" align="end">
                <span className="num">{moneyText(u.price)}</span>
              </Td>
              <Td label="За наступний" align="end">
                <span className="num">{moneyText(u.secondaryPrice)}</span>
              </Td>
              <Td label="Строк доставки">{deliveryText(u, carriers.carriers)}</Td>
              <Td label="Дії" actions>
                <Button size="sm" icon="edit" aria-label={`Змінити прискорену доставку «${u.name}»`} onClick={() => setEditing(u)}>
                  Змінити
                </Button>
                <Button size="sm" variant="danger" icon="trash" aria-label={`Видалити прискорену доставку «${u.name}»`} disabled={ch.busy} onClick={() => void remove(u)}>
                  Видалити
                </Button>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
      <Status error={ch.error} note={ch.note} />
      {editing && (
        <UpgradeForm
          key={editing === 'new' ? 'new' : editing.id}
          profile={profile}
          upgrade={editing === 'new' ? null : editing}
          carriers={carriers}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      )}
    </Card>
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
    <div className="ui-form-grid fx-grid-3">
      <TextField label="Підготовка: від" type="number" aside="1–10" glossary="processingTime" value={min} onChange={onMin} />
      <TextField label="Підготовка: до" type="number" aside="1–10" value={max} onChange={onMax} />
      <div className="ui-field">
        <div className="ui-field-head">
          <span className="ui-field-label" aria-hidden="true">
            Одиниця
          </span>
        </div>
        <Segmented
          label="Одиниця"
          fullWidth
          value={unit}
          onChange={onUnit}
          options={[
            { value: 'business_days', label: 'робочі дні' },
            { value: 'weeks', label: 'тижні' }
          ]}
        />
      </div>
    </div>
  )
}

/**
 * Only what the user changed is sent: the origin only once picked (an unknown
 * one starts unset), an emptied postal code as '' (clears it), the processing
 * time only when typed. Stays mounted after a save, so its note stays too.
 */
function ProfileEditForm({ profile, onSaved, onClose }: { profile: ShippingProfile; onSaved: (p: ShippingProfile) => void; onClose: () => void }): JSX.Element {
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
  const changed = Object.keys(input).length > 0
  const save = async (): Promise<void> => {
    const p = await ch.run<ShippingProfile>({
      confirmLabel: 'Зберегти профіль',
      confirm: `Зберегти профіль доставки «${profile.title}»?\nЗміни одразу стосуються всіх товарів із цим профілем.`,
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
    <Card
      tone="form"
      testId="sc-profile-edit" reveal
      title="Змінити назву, звідки і час на підготовку"
      footer={
        <>
          <Button variant="primary" busy={ch.busy} disabled={!changed} onClick={() => void save()}>
            Зберегти профіль
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Закрити
          </Button>
        </>
      }
    >
      <TextField label="Назва профілю" hint="Бачите лише ви — щоб розрізняти профілі. Покупцям не показується." value={title} onChange={setTitle} />
      <div className="ui-form-grid fx-grid-2">
        <CountrySelect label="Країна відправлення" glossary="features.shopConfig.originCountry" value={origin} onChange={setOrigin} unset={!profile.originCountry} />
        <TextField label="Поштовий індекс відправлення" glossary="features.shopConfig.originPostalCode" value={postal} onChange={setPostal} />
      </div>
      <ProcessingTimeFields min={min} max={max} unit={unit} onMin={setMin} onMax={setMax} onUnit={setUnit} />
      <Note>Час на підготовку змінюється, лише якщо ви його вкажете: Etsy не повідомляє поточний час у профілі доставки.</Note>
      <Status error={ch.error} note={ch.note} />
    </Card>
  )
}

function ProfileBody({ profile, onSaved, onDeleted }: { profile: ShippingProfile; onSaved: (p: ShippingProfile) => void; onDeleted: () => void }): JSX.Element {
  const carriers = useCarriers(profile.originCountry)
  const [editing, setEditing] = useState(false)
  const ch = useChange()
  const remove = async (): Promise<void> => {
    const r = await ch.run({
      confirmLabel: 'Видалити профіль',
      danger: true,
      confirm: `Видалити профіль доставки «${profile.title}»?\nТовари з ним залишаться без доставки, доки ви не виберете їм інший профіль. Це не можна скасувати.`,
      action: 'deleteShippingProfile',
      args: { profileId: profile.id },
      done: 'Профіль видалено.'
    })
    if (r) onDeleted()
  }
  return (
    <>
      <Card
        testId="sc-profile-summary"
        footer={
          !editing && (
            <Button size="sm" icon="edit" onClick={() => setEditing(true)}>
              Змінити основне
            </Button>
          )
        }
      >
        <Facts
          items={[
            {
              label: 'Звідки',
              glossary: 'features.shopConfig.originCountry',
              value: (
                <>
                  {profile.originCountry ? countryLabel(profile.originCountry) : '—'}
                  {profile.originPostalCode ? `, ${profile.originPostalCode}` : ''}
                </>
              )
            },
            {
              label: 'Спосіб розрахунку',
              glossary: 'features.compete.profileType',
              value: profile.profileType === 'calculated' ? 'Розрахунковий (Etsy рахує за вагою)' : 'Фіксована вартість (ви задаєте ціни)'
            },
            (profile.profileType === 'calculated' || !!profile.domesticHandlingFee || !!profile.internationalHandlingFee) && {
              label: 'Плата за обробку',
              glossary: 'features.compete.handlingFee',
              value: (
                <>
                  {profile.domesticHandlingFee ?? 0} всередині країни · {profile.internationalHandlingFee ?? 0} міжнародна
                </>
              )
            }
          ]}
        />
      </Card>
      {editing && <ProfileEditForm profile={profile} onSaved={onSaved} onClose={() => setEditing(false)} />}
      <Destinations profile={profile} carriers={carriers} />
      <Upgrades profile={profile} carriers={carriers} />
      <Card
        tone="danger"
        title="Видалити профіль"
        desc="Товари, які зараз використовують цей профіль, залишаться без доставки, доки ви не виберете їм інший."
        footer={
          <Button variant="danger" icon="trash" busy={ch.busy} onClick={() => void remove()}>
            Видалити профіль
          </Button>
        }
      >
        <Status error={ch.error} note={ch.note} />
      </Card>
    </>
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
  const profile = fresh ?? loaded.value
  const title = profile?.title ?? `Профіль #${profileId}`
  return (
    <div className="fx-page" data-testid="sc-profile">
      <div className="fx-detail-head">
        <Button size="sm" variant="ghost" icon="chevron-left" onClick={() => onBack(null)}>
          Усі профілі
        </Button>
        <h3 className="fx-detail-title truncate" title={title}>
          {title}
        </h3>
      </div>
      <Status error={null} note={note} />
      <ErrorNote error={loaded.error} title="Не вдалося завантажити профіль" />
      {!profile && !loaded.error && <Loading>Завантаження профілю…</Loading>}
      {profile && <ProfileBody profile={profile} onSaved={setFresh} onDeleted={() => onBack('Профіль видалено.')} />}
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
  const carriers = useCarriers(origin)
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
      confirmLabel: 'Створити профіль',
      confirm: `Створити профіль доставки «${title.trim()}»?\nЙого одразу можна буде вибрати в товарах.`,
      action: 'createShippingProfile',
      args: { input },
      done: 'Профіль створено.'
    }
    const p = await ch.run<ShippingProfile>(change)
    if (p) onCreated(p.value, change.done)
  }
  return (
    <Card
      tone="form"
      testId="sc-profile-create" reveal
      title="Новий профіль доставки"
      desc="Профіль створюється разом із першим напрямком. Інші напрямки і прискорену доставку додасте потім, відкривши профіль."
      footer={
        <>
          <Button variant="primary" busy={ch.busy} disabled={!title.trim()} onClick={() => void create()}>
            Створити профіль
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Скасувати
          </Button>
        </>
      }
    >
      <Step n={1} title="Назва і звідки відправляєте">
        <TextField label="Назва профілю" hint="Бачите лише ви, наприклад «Друковані планери» або «Важкі посилки»." value={title} onChange={setTitle} />
        <div className="ui-form-grid fx-grid-2">
          <CountrySelect label="Країна відправлення" glossary="features.shopConfig.originCountry" value={origin} onChange={setOrigin} />
          <TextField
            label="Поштовий індекс відправлення"
            glossary="features.shopConfig.originPostalCode"
            hint="Потрібен, якщо в країні є індекси."
            value={postal}
            onChange={setPostal}
          />
        </div>
      </Step>
      <Step n={2} title="Скільки часу на підготовку" desc="Необов’язково: від оплати до відправлення, без часу доставки.">
        <ProcessingTimeFields min={min} max={max} unit={unit} onMin={setMin} onMax={setMax} onUnit={setUnit} />
      </Step>
      <Step n={3} title="Перший напрямок: куди і скільки коштує" glossary="features.shopConfig.destination">
        <TargetFields target={target} country={country} onTarget={setTarget} onCountry={setCountry} allowEverywhere={false} />
        <CostFields primary={primary} secondary={secondary} onPrimary={setPrimary} onSecondary={setSecondary} currency={null} />
      </Step>
      <Step n={4} title="Як довго посилка в дорозі" glossary="features.shopConfig.deliveryMode">
        <DeliveryFields value={delivery} onChange={setDelivery} carriers={carriers.carriers} />
        <CarrierNote error={carriers.error} />
      </Step>
      <Status error={ch.error} note={ch.note} />
    </Card>
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
    <div className="fx-page" data-testid="sc-shipping">
      <Intro
        title="Профілі доставки"
        glossary="shippingProfile"
        icon="truck"
        action={
          !creating && (
            <Button icon="plus" onClick={() => setCreating(true)}>
              Новий профіль доставки
            </Button>
          )
        }
      >
        Профіль — це готовий набір правил: звідки ви відправляєте, у які країни, скільки коштує доставка і як довго вона триває. Кожен фізичний
        товар використовує один профіль, тому, змінивши профіль, ви змінюєте доставку одразу в багатьох товарах.
      </Intro>
      <ErrorNote error={list.error} title="Не вдалося завантажити профілі" />
      {!list.value && !list.error && <Loading>Завантаження профілів…</Loading>}
      <Status error={null} note={note} />
      {list.value && list.value.length === 0 && !creating && (
        <EmptyState
          compact
          icon="truck"
          title="Профілів доставки ще немає."
          action={
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              Створити профіль
            </Button>
          }
        >
          Без профілю доставки фізичний товар не можна опублікувати.
        </EmptyState>
      )}
      {list.value && list.value.length > 0 && (
        <DataTable
          label="Профілі доставки"
          stack="sm"
          columns={[
            { label: 'Профіль' },
            { label: 'Звідки', glossary: 'features.shopConfig.originCountry' },
            { label: 'Напрямків', glossary: 'features.shopConfig.destination', align: 'end' },
            { label: 'Прискорених', glossary: 'features.compete.upgrades', align: 'end' },
            { label: 'Дії', srOnly: true }
          ]}
        >
          {list.value.map((p) => (
            <tr key={p.id}>
              <Td label="Профіль" primary>
                <span className="clamp-2 fx-title" title={p.title || `#${p.id}`}>
                  {p.title || `#${p.id}`}
                </span>
              </Td>
              <Td label="Звідки">{p.originCountry ? countryLabel(p.originCountry) : '—'}</Td>
              <Td label="Напрямків" align="end">
                <span className="num">{p.destinations.length}</span>
              </Td>
              <Td label="Прискорених" align="end">
                <span className="num">{p.upgrades.length}</span>
              </Td>
              <Td label="Дії" actions>
                <Button
                  size="sm"
                  icon="chevron-right"
                  aria-label={`Відкрити профіль доставки «${p.title || `#${p.id}`}»`}
                  onClick={() => {
                    setNote(null)
                    setOpen(p.id)
                  }}
                >
                  Відкрити
                </Button>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
      {creating && (
        <ProfileCreateForm
          onCreated={(p, n) => {
            setCreating(false)
            setNote(n)
            setOpen(p.id)
          }}
          onCancel={() => setCreating(false)}
        />
      )}
    </div>
  )
}
