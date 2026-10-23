// Shared pieces of the shop configuration UI: loading a feature action,
// running a (confirmed) change, status lines, country/delivery fields.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ShippingCarrier } from '@shared/features/shopConfig'
import { COMMON_COUNTRIES, countryLabel, ISO_COUNTRIES } from '@shared/countries'
import { useStore } from '../../store'
import { featureCall } from '../call'

export const FEATURE = 'shopConfig'

export interface Loaded<T> {
  value: T | null
  error: string | null
  reload: () => void
}

/** Calls `action` on mount (and on reload / when `key` changes). */
export function useLoad<T>(action: string, args: Record<string, unknown> = {}, key = ''): Loaded<T> {
  const [value, setValue] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
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
  }, [action, key, n])
  const reload = useCallback(() => setN((x) => x + 1), [])
  return { value, error, reload }
}

export interface Change {
  /** Asked first (requestConfirm); the change runs only when confirmed. */
  confirm: string
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
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const run = useCallback(
    async <T,>(c: Change): Promise<{ value: T } | null> => {
      setError(null)
      setNote(null)
      if (!(await requestConfirm(c.confirm))) return null
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
    [requestConfirm]
  )
  const notify = useCallback((n: string) => {
    setError(null)
    setNote(n)
  }, [])
  return { busy, error, note, run, notify }
}

export function Loading(): JSX.Element {
  return <div className="hint">Завантаження…</div>
}

export function ErrorNote({ error }: { error: string | null }): JSX.Element | null {
  if (!error) return null
  return (
    <div className="test-result err" role="alert">
      {error}
    </div>
  )
}

export function Status({ error, note }: { error: string | null; note: string | null }): JSX.Element | null {
  if (error) return <ErrorNote error={error} />
  if (!note) return null
  return (
    <div className="test-result ok" role="status">
      {note}
    </div>
  )
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
  unset = false
}: {
  label: string
  value: string
  onChange: (code: string) => void
  unset?: boolean
}): JSX.Element {
  const options = useMemo(countryOptions, [])
  return (
    <div className="field">
      <label>
        {label}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {unset && <option value="">— не вказано —</option>}
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  hint
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'number'
  hint?: string
}): JSX.Element {
  return (
    <div className="field">
      <label>
        {label}
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
      {hint && <div className="hint">{hint}</div>}
    </div>
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

export function DeliveryFields({
  value,
  onChange,
  carriers,
  idPrefix
}: {
  value: DeliveryState
  onChange: (d: DeliveryState) => void
  carriers: ShippingCarrier[] | null
  idPrefix: string
}): JSX.Element {
  const set = (patch: Partial<DeliveryState>): void => onChange({ ...value, ...patch })
  const carrier = carriers?.find((c) => String(c.id) === value.carrierId)
  return (
    <>
      <div className="radio-row" role="radiogroup" aria-label="Строк доставки">
        <label>
          <input type="radio" name={`${idPrefix}-mode`} checked={value.mode === 'days'} onChange={() => set({ mode: 'days' })} /> Строк
          доставки в днях
        </label>
        <label>
          <input type="radio" name={`${idPrefix}-mode`} checked={value.mode === 'carrier'} onChange={() => set({ mode: 'carrier' })} />{' '}
          Перевізник і клас пошти
        </label>
      </div>
      {value.mode === 'days' ? (
        <div className="field-row">
          <TextField label="Мін. днів у дорозі (1–45)" type="number" value={value.minDays} onChange={(v) => set({ minDays: v })} />
          <TextField label="Макс. днів у дорозі (1–45)" type="number" value={value.maxDays} onChange={(v) => set({ maxDays: v })} />
        </div>
      ) : (
        <div className="field-row">
          <div className="field">
            <label>
              Перевізник
              <select value={value.carrierId} onChange={(e) => set({ carrierId: e.target.value, mailClass: '' })}>
                <option value="">{carriers ? '— виберіть —' : 'Завантаження…'}</option>
                {carriers?.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field">
            <label>
              Клас пошти
              <select value={value.mailClass} onChange={(e) => set({ mailClass: e.target.value })}>
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
              </select>
            </label>
          </div>
        </div>
      )}
    </>
  )
}

/** Carriers for an origin country (public call; null while loading, [] when it failed). */
export function useCarriers(country: string | null): { carriers: ShippingCarrier[] | null; error: string | null } {
  const l = useLoad<ShippingCarrier[]>('carriers', { country }, country ?? '')
  return { carriers: l.error ? [] : l.value, error: l.error }
}
