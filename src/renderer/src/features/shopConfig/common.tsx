// Shared pieces of the shop configuration UI: loading a feature action,
// running a (confirmed) change, country/text/money fields, the delivery-time
// choice (days or a carrier's mail class). Layout pieces live in ./kit.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { parseCost, type ShippingCarrier } from '@shared/features/shopConfig'
import { COMMON_COUNTRIES, countryLabel, ISO_COUNTRIES } from '@shared/countries'
import { confirmWith } from '../../components/ConfirmModal'
import { Field, Segmented, Select, type GlossaryKey } from '../../ui'
import { featureCall } from '../call'

export { ErrorNote, Status } from './kit'
export { Loading } from '../../ui'

export const FEATURE = 'shopConfig'

export interface Loaded<T> {
  value: T | null
  error: string | null
  reload: () => void
}

/** Calls `action` on mount (and on reload / when `key` changes); `skip` = don't call (yet). */
export function useLoad<T>(action: string, args: Record<string, unknown> = {}, key = '', skip = false): Loaded<T> {
  const [value, setValue] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    if (skip) return
    let alive = true
    setError(null)
    void featureCall<T>(FEATURE, action, args).then((r) => {
      if (!alive) return
      if (r.ok) setValue(r.value)
      else setError(r.error)
    })
    return () => {
      alive = false
    }
    // `key` stands for `args` (a new object on every render).
  }, [action, key, n, skip])
  const reload = useCallback(() => setN((x) => x + 1), [])
  return { value, error, reload }
}

export interface Change {
  /** Asked first (the confirm dialog); the change runs only when confirmed. */
  confirm: string
  /** The confirm button's verb ("Видалити розділ"); default "Підтвердити". */
  confirmLabel?: string
  /** Red confirm (deleting, merging) — said explicitly rather than guessed from the wording. */
  danger?: boolean
  action: string
  args: Record<string, unknown>
  /** The success note. */
  done: string
}

/**
 * A confirmed change: busy flag, the error or success note; `run` answers null
 * when cancelled or refused. `notify` shows a note of a change made elsewhere —
 * a form that closes on success hands its note to the list that stays.
 */
export function useChange() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const run = useCallback(
    async <T,>(c: Change): Promise<{ value: T } | null> => {
      setError(null)
      setNote(null)
      if (!(await confirmWith({ message: c.confirm, confirmLabel: c.confirmLabel, danger: c.danger }))) return null
      setBusy(true)
      const r = await featureCall<T>(FEATURE, c.action, c.args)
      setBusy(false)
      if (!r.ok) {
        setError(r.error)
        return null
      }
      setNote(c.done)
      return { value: r.value }
    },
    []
  )
  const notify = useCallback((n: string) => {
    setError(null)
    setNote(n)
  }, [])
  return { busy, error, note, run, notify }
}

/** Every ISO country: the common ones first, then the rest by name. */
function countryOptions(): Array<{ code: string; label: string }> {
  const common = COMMON_COUNTRIES.map((c) => c.code)
  const rest = [...ISO_COUNTRIES].filter((c) => !common.includes(c)).map((code) => ({ code, label: countryLabel(code) }))
  rest.sort((a, b) => a.label.localeCompare(b.label, 'uk'))
  return [...common.map((code) => ({ code, label: countryLabel(code) })), ...rest]
}

/** `unset`: offer an empty "— не вказано —" choice (the value isn't known yet). */
export function CountrySelect({
  label,
  value,
  onChange,
  unset = false,
  glossary,
  hint
}: {
  label: string
  value: string
  onChange: (code: string) => void
  unset?: boolean
  glossary?: GlossaryKey
  hint?: ReactNode
}): JSX.Element {
  const options = useMemo(countryOptions, [])
  return (
    <Field label={label} glossary={glossary} hint={hint}>
      <Select value={value} onChange={onChange} fullWidth>
        {unset && <option value="">— не вказано —</option>}
        <optgroup label="Часто вибирають">
          {options.slice(0, COMMON_COUNTRIES.length).map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Усі країни">
          {options.slice(COMMON_COUNTRIES.length).map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </optgroup>
      </Select>
    </Field>
  )
}

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  glossary,
  info,
  aside,
  placeholder,
  money,
  maxLength
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'number'
  hint?: ReactNode
  glossary?: GlossaryKey
  info?: ReactNode
  aside?: ReactNode
  placeholder?: string
  /** A price: decimal keyboard, comma or dot. */
  money?: boolean
  maxLength?: number
}): JSX.Element {
  return (
    <Field label={label} hint={hint} glossary={glossary} info={info} aside={aside}>
      <input
        type={type}
        inputMode={money ? 'decimal' : undefined}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

/** A money value typed by the user ("7,5" / "7.50") → a number, or null. */
export function typedMoney(v: string): number | null {
  if (!v.trim()) return null
  const n = parseCost(v)
  return n == null || !Number.isFinite(n) ? null : n
}

const fmt2 = (n: number): string => new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

/**
 * "For 3 items the buyer pays 5,00 + 2 × 1,50 = 8,00" — what the two costs mean
 * in practice (null until both parse).
 */
export function CostExample({
  first,
  next,
  currency,
  lead = 'за доставку 3 товарів в одному замовленні покупець заплатить'
}: {
  first: string
  next: string
  currency?: string | null
  lead?: string
}): JSX.Element | null {
  const a = typedMoney(first)
  const b = typedMoney(next)
  if (a == null || b == null) return null
  const cur = currency ? ` ${currency}` : ''
  return (
    <p className="fx-example" data-testid="cost-example">
      Приклад: {lead} {fmt2(a)} + 2 × {fmt2(b)} ={' '}
      <strong className="num">
        {fmt2(a + 2 * b)}
        {cur}
      </strong>
      .
    </p>
  )
}

/** How a destination/upgrade says its delivery time: a carrier's mail class, or days. */
export interface DeliveryState {
  mode: 'carrier' | 'days'
  carrierId: string
  mailClass: string
  minDays: string
  maxDays: string
}

export function deliveryState(d: {
  carrierId: number | null
  mailClass: string | null
  minDeliveryDays: number | null
  maxDeliveryDays: number | null
} | null): DeliveryState {
  return {
    mode: d?.carrierId && d.mailClass ? 'carrier' : 'days',
    carrierId: d?.carrierId ? String(d.carrierId) : '',
    mailClass: d?.mailClass ?? '',
    minDays: d?.minDeliveryDays != null ? String(d.minDeliveryDays) : '',
    maxDays: d?.maxDeliveryDays != null ? String(d.maxDeliveryDays) : ''
  }
}

/** The OAS fields of a delivery choice (carrier 0 = none when the days are used). */
export function deliveryFields(d: DeliveryState): Record<string, string | number> {
  return d.mode === 'carrier'
    ? { shipping_carrier_id: d.carrierId, mail_class: d.mailClass }
    : { shipping_carrier_id: 0, min_delivery_days: d.minDays, max_delivery_days: d.maxDays }
}

/** A carrier's name and the name of its mail class, when the carriers list knows them. */
export function carrierText(carriers: ShippingCarrier[] | null | undefined, carrierId: number | null, mailClass: string | null): string {
  const c = carriers?.find((x) => x.id === carrierId)
  const m = c && [...c.domesticClasses, ...c.internationalClasses].find((x) => x.key === mailClass)
  return `${c?.name ?? `перевізник #${carrierId}`} · ${m?.name ?? mailClass}`
}

export function DeliveryFields({
  value,
  onChange,
  carriers
}: {
  value: DeliveryState
  onChange: (d: DeliveryState) => void
  carriers: ShippingCarrier[] | null
  /** Kept for callers; the inputs get generated ids. */
  idPrefix?: string
}): JSX.Element {
  const set = (patch: Partial<DeliveryState>): void => onChange({ ...value, ...patch })
  const carrier = carriers?.find((c) => String(c.id) === value.carrierId)
  return (
    <div className="fx-delivery">
      <div className="fx-delivery-mode">
        <Segmented
          label="Строк доставки"
          value={value.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'days', label: 'Строк у днях', hint: 'Ви самі вказуєте, скільки днів посилка в дорозі.' },
            { value: 'carrier', label: 'Перевізник і клас пошти', hint: 'Etsy порахує строк за тарифом перевізника.' }
          ]}
        />
      </div>
      {value.mode === 'days' ? (
        <div className="ui-form-grid fx-grid-2">
          <TextField
            label="Найменше днів у дорозі"
            type="number"
            aside="1–45"
            glossary="features.shopConfig.deliveryDays"
            value={value.minDays}
            onChange={(v) => set({ minDays: v })}
          />
          <TextField label="Найбільше днів у дорозі" type="number" aside="1–45" value={value.maxDays} onChange={(v) => set({ maxDays: v })} />
        </div>
      ) : (
        <div className="ui-form-grid fx-grid-2">
          <Field label="Перевізник" glossary="features.shopConfig.carrier">
            <Select value={value.carrierId} onChange={(v) => set({ carrierId: v, mailClass: '' })} fullWidth>
              <option value="">{carriers ? '— виберіть —' : 'Завантаження…'}</option>
              {carriers?.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Клас пошти" glossary="features.compete.mailClass" hint={!carrier ? 'Спершу виберіть перевізника.' : undefined}>
            <Select value={value.mailClass} onChange={(v) => set({ mailClass: v })} disabled={!carrier} fullWidth>
              <option value="">— виберіть —</option>
              {carrier && carrier.domesticClasses.length > 0 && (
                <optgroup label="Всередині країни">
                  {carrier.domesticClasses.map((m) => (
                    <option key={`d-${m.key}`} value={m.key}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {carrier && carrier.internationalClasses.length > 0 && (
                <optgroup label="Міжнародні">
                  {carrier.internationalClasses.map((m) => (
                    <option key={`i-${m.key}`} value={m.key}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </Field>
        </div>
      )}
    </div>
  )
}

/** Carriers for an origin country (public call; null while loading, [] when it failed or no country is known). */
export function useCarriers(country: string | null): { carriers: ShippingCarrier[] | null; error: string | null } {
  const l = useLoad<ShippingCarrier[]>('carriers', { country }, country ?? '', !country)
  if (!country) return { carriers: [], error: null }
  return { carriers: l.error ? [] : l.value, error: l.error }
}
