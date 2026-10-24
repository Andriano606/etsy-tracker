// "Свята" and "Партнери" (Мій магазин).

import { useState } from 'react'
import type { HolidayPreference, ProductionPartner } from '@shared/features/shopConfig'
import { countryLabel } from '@shared/countries'
import { Badge, EmptyState, Icon, Loading, Toggle } from '../../ui'
import { useChange, useLoad } from './common'
import { ErrorNote, Intro, Status } from './kit'

export function HolidaysTab(): JSX.Element {
  const list = useLoad<HolidayPreference[]>('holidays')
  const [changed, setChanged] = useState<Record<number, boolean>>({})
  const ch = useChange()
  const toggle = async (h: HolidayPreference, isWorking: boolean): Promise<void> => {
    const r = await ch.run<HolidayPreference>({
      confirmLabel: isWorking ? 'Працювати у свято' : 'Зробити вихідним',
      confirm: isWorking
        ? `Працювати у свято «${h.name}»?\nEtsy рахуватиме цей день робочим, і строки доставки для покупців навколо нього стануть коротшими.`
        : `Зробити свято «${h.name}» вихідним?\nEtsy додасть цей день до строків доставки, тож покупці побачать трохи пізнішу дату.`,
      action: 'setHoliday',
      args: { holidayId: h.holidayId, isWorking },
      done: `«${h.name}»: ${isWorking ? 'магазин працює' : 'вихідний'}.`
    })
    if (r) setChanged((c) => ({ ...c, [h.holidayId]: r.value.isWorking }))
  }
  return (
    <div className="fx-page" data-testid="sc-holidays">
      <Intro title="Святкові вихідні" glossary="features.shopConfig.holiday" icon="calendar">
        Позначте, у які державні свята ви відправляєте замовлення. Вимкнене свято — вихідний: Etsy додасть його до строку доставки, щоб покупець не
        чекав посилку раніше, ніж ви її відправите. Etsy підтримує це лише для магазинів у США та Канаді.
      </Intro>
      <ErrorNote error={list.error} title="Не вдалося завантажити свята" />
      {!list.value && !list.error && <Loading>Завантаження свят…</Loading>}
      {list.value && list.value.length === 0 && (
        <EmptyState compact icon="calendar" title="Для країни вашого магазину свят немає.">
          Etsy веде список свят лише для США та Канади. Для інших країн нічого налаштовувати не треба.
        </EmptyState>
      )}
      {list.value && list.value.length > 0 && (
        <ul className="fx-switch-list" aria-label="Свята">
          {list.value.map((h) => {
            const working = changed[h.holidayId] ?? h.isWorking
            return (
              <li key={h.holidayId} className="fx-switch-row">
                <div className="fx-switch-text min-w-0">
                  <div className="fx-title truncate" title={h.name}>
                    {h.name}
                  </div>
                  <div className="fx-meta">{h.countryIso ? countryLabel(h.countryIso) : 'Країна не вказана'}</div>
                </div>
                <Badge tone={working ? 'accent' : 'neutral'}>{working ? 'працюємо' : 'вихідний'}</Badge>
                <Toggle ariaLabel={`Працює: ${h.name}`} checked={working} disabled={ch.busy} onChange={(v) => void toggle(h, v)} />
              </li>
            )
          })}
        </ul>
      )}
      <Status error={ch.error} note={ch.note} />
    </div>
  )
}

export function PartnersTab(): JSX.Element {
  const list = useLoad<ProductionPartner[]>('partners')
  return (
    <div className="fx-page" data-testid="sc-partners">
      <Intro title="Виробничі партнери" glossary="features.shopConfig.partner" icon="layers">
        Хто допомагає вам виготовляти товари — друкарня, майстерня, фабрика. Etsy показує це покупцям для чесності. Тут список лише для
        перегляду: додають і змінюють партнерів на сайті Etsy (Shop Manager → Налаштування → Виробничі партнери).
      </Intro>
      <ErrorNote error={list.error} title="Не вдалося завантажити партнерів" />
      {!list.value && !list.error && <Loading />}
      {list.value && list.value.length === 0 && (
        <EmptyState compact icon="layers" title="Виробничих партнерів немає.">
          Якщо ви робите все самі, нічого вказувати не треба.
        </EmptyState>
      )}
      {list.value && list.value.length > 0 && (
        <ul className="fx-cards" aria-label="Виробничі партнери">
          {list.value.map((p) => (
            <li key={p.id} className="fx-mini-card">
              <Icon name="store" size={18} className="fx-mini-icon" />
              <div className="min-w-0">
                <div className="fx-title">{p.name}</div>
                {p.location && <div className="fx-meta">{p.location}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
