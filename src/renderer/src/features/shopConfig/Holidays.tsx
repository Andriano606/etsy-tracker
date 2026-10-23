// "Свята" and "Партнери" (Мій магазин).

import { useState } from 'react'
import type { HolidayPreference, ProductionPartner } from '@shared/features/shopConfig'
import { countryLabel } from '@shared/countries'
import { ErrorNote, Loading, Status, useChange, useLoad } from './common'

export function HolidaysTab(): JSX.Element {
  const list = useLoad<HolidayPreference[]>('holidays')
  const [changed, setChanged] = useState<Record<number, boolean>>({})
  const ch = useChange()
  const toggle = async (h: HolidayPreference, isWorking: boolean): Promise<void> => {
    const r = await ch.run<HolidayPreference>({
      confirm: isWorking
        ? `Обробляти замовлення у свято «${h.name}»? Строки доставки для покупців рахуватимуть цей день робочим.`
        : `Не обробляти замовлення у свято «${h.name}»? Покупці побачать довші строки доставки навколо цього дня.`,
      action: 'setHoliday',
      args: { holidayId: h.holidayId, isWorking },
      done: `«${h.name}»: ${isWorking ? 'магазин працює' : 'вихідний'}.`
    })
    if (r) setChanged((c) => ({ ...c, [h.holidayId]: r.value.isWorking }))
  }
  return (
    <div data-testid="sc-holidays">
      <p className="hint">У які державні свята магазин обробляє замовлення. Etsy підтримує це лише для магазинів у США та Канаді.</p>
      <ErrorNote error={list.error} />
      {!list.value && !list.error && <Loading />}
      {list.value && list.value.length === 0 && <div className="hint">Для країни вашого магазину свят немає.</div>}
      {list.value && list.value.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Свято</th>
              <th>Країна</th>
              <th>Магазин працює</th>
            </tr>
          </thead>
          <tbody>
            {list.value.map((h) => {
              const working = changed[h.holidayId] ?? h.isWorking
              return (
                <tr key={h.holidayId}>
                  <td>{h.name}</td>
                  <td>{h.countryIso ? countryLabel(h.countryIso) : '—'}</td>
                  <td>
                    <label className="check">
                      <input
                        type="checkbox"
                        aria-label={`Працює: ${h.name}`}
                        checked={working}
                        disabled={ch.busy}
                        onChange={(e) => void toggle(h, e.target.checked)}
                      />
                      {working ? 'так' : 'ні'}
                    </label>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <Status error={ch.error} note={ch.note} />
    </div>
  )
}

export function PartnersTab(): JSX.Element {
  const list = useLoad<ProductionPartner[]>('partners')
  return (
    <div data-testid="sc-partners">
      <p className="hint">Виробничі партнери, яких ви вказали на Etsy (хто допомагає виготовляти товари). Додаються й змінюються на сайті Etsy.</p>
      <ErrorNote error={list.error} />
      {!list.value && !list.error && <Loading />}
      {list.value && list.value.length === 0 && <div className="hint">Виробничих партнерів немає.</div>}
      {list.value && list.value.length > 0 && (
        <ul className="plain-list">
          {list.value.map((p) => (
            <li key={p.id}>
              {p.name}
              {p.location && <span className="dim"> · {p.location}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
