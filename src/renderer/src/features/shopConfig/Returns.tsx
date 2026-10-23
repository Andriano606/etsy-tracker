// "Повернення" (Мій магазин): return policies — create/edit/delete, merge one
// into another (consolidate) and the listings that use a policy.

import { useState } from 'react'
import { RETURN_DEADLINES, type PolicyListing, type ReturnPolicy } from '@shared/features/shopConfig'
import { ErrorNote, Loading, Status, useChange, useLoad, type Change } from './common'

export function policyText(p: ReturnPolicy): string {
  const what = [p.acceptsReturns && 'повернення', p.acceptsExchanges && 'обмін'].filter(Boolean).join(' і ')
  if (!what) return 'Без повернень і обміну'
  return `${what[0].toUpperCase()}${what.slice(1)} протягом ${p.returnDeadline ?? '?'} дн.`
}

function PolicyForm({
  policy,
  onSaved,
  onCancel
}: {
  policy: ReturnPolicy | null
  onSaved: (note: string) => void
  onCancel: () => void
}): JSX.Element {
  const [returns, setReturns] = useState(policy?.acceptsReturns ?? true)
  const [exchanges, setExchanges] = useState(policy?.acceptsExchanges ?? false)
  const [deadline, setDeadline] = useState(String(policy?.returnDeadline ?? 30))
  const ch = useChange()
  const accepts = returns || exchanges
  const save = async (): Promise<void> => {
    const input = { accepts_returns: returns, accepts_exchanges: exchanges, ...(accepts ? { return_deadline: deadline } : {}) }
    const what = policyText({ id: 0, acceptsReturns: returns, acceptsExchanges: exchanges, returnDeadline: Number(deadline) })
    const change: Change = policy
      ? {
          confirm: `Зберегти політику повернення («${what}»)? Покупці побачать нові умови в усіх лістингах із цією політикою.`,
          action: 'updateReturnPolicy',
          args: { id: policy.id, input },
          done: 'Політику збережено.'
        }
      : {
          confirm: `Створити політику повернення («${what}»)?`,
          action: 'createReturnPolicy',
          args: { input },
          done: 'Політику створено.'
        }
    if (await ch.run<ReturnPolicy>(change)) onSaved(change.done)
  }
  return (
    <div className="sc-form" data-testid="sc-return-form">
      <h4>{policy ? 'Змінити політику' : 'Нова політика повернення'}</h4>
      <label className="check">
        <input type="checkbox" checked={returns} onChange={(e) => setReturns(e.target.checked)} /> Приймаю повернення
      </label>
      <label className="check">
        <input type="checkbox" checked={exchanges} onChange={(e) => setExchanges(e.target.checked)} /> Приймаю обмін
      </label>
      {accepts && (
        <div className="field">
          <label>
            Строк (днів після доставки)
            <select value={deadline} onChange={(e) => setDeadline(e.target.value)}>
              {RETURN_DEADLINES.map((d) => (
                <option key={d} value={String(d)}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="settings-actions">
        <button className="btn primary" disabled={ch.busy} onClick={() => void save()}>
          {policy ? 'Зберегти' : 'Створити'}
        </button>
        <button className="btn" onClick={onCancel}>
          Скасувати
        </button>
      </div>
      <Status error={ch.error} note={ch.note} />
    </div>
  )
}

function PolicyListings({ policy }: { policy: ReturnPolicy }): JSX.Element {
  const list = useLoad<PolicyListing[]>('returnPolicyListings', { id: policy.id }, String(policy.id))
  return (
    <div data-testid="sc-policy-listings">
      <h4>Лістинги з політикою «{policyText(policy)}»</h4>
      <ErrorNote error={list.error} />
      {!list.value && !list.error && <Loading />}
      {list.value && list.value.length === 0 && <div className="hint">Жоден лістинг не використовує цю політику.</div>}
      {list.value && list.value.length > 0 && (
        <ul className="plain-list">
          {list.value.map((l) => (
            <li key={l.listingId}>
              {l.title} <span className="dim">· #{l.listingId} · {l.state}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Consolidate({ policies, onDone }: { policies: ReturnPolicy[]; onDone: (note: string) => void }): JSX.Element {
  const [source, setSource] = useState('')
  const [dest, setDest] = useState('')
  const ch = useChange()
  const name = (id: string): string => {
    const p = policies.find((x) => String(x.id) === id)
    return p ? `«${policyText(p)}» (#${p.id})` : id
  }
  const run = async (): Promise<void> => {
    const change: Change = {
      confirm: `Перенести всі лістинги з політики ${name(source)} у ${name(dest)} і видалити ${name(source)}?`,
      action: 'consolidateReturnPolicies',
      args: { sourceId: Number(source), destinationId: Number(dest) },
      done: 'Політики об’єднано.'
    }
    if (await ch.run<ReturnPolicy>(change)) {
      setSource('')
      setDest('')
      onDone(change.done)
    }
  }
  const options = (except: string): JSX.Element[] =>
    policies
      .filter((p) => String(p.id) !== except)
      .map((p) => (
        <option key={p.id} value={String(p.id)}>
          {policyText(p)} (#{p.id})
        </option>
      ))
  return (
    <div className="sc-form" data-testid="sc-consolidate">
      <h4>Об’єднати політики</h4>
      <div className="hint">Лістинги переносяться в іншу політику, а перша видаляється (так видаляють політику, яку ще використовують).</div>
      <div className="field-row">
        <div className="field">
          <label>
            З політики
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">— виберіть —</option>
              {options(dest)}
            </select>
          </label>
        </div>
        <div className="field">
          <label>
            У політику
            <select value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="">— виберіть —</option>
              {options(source)}
            </select>
          </label>
        </div>
      </div>
      <div className="settings-actions">
        <button className="btn danger" disabled={ch.busy || !source || !dest} onClick={() => void run()}>
          Об’єднати
        </button>
      </div>
      <Status error={ch.error} note={ch.note} />
    </div>
  )
}

export function ReturnsTab(): JSX.Element {
  const list = useLoad<ReturnPolicy[]>('returnPolicies')
  const [editing, setEditing] = useState<ReturnPolicy | 'new' | null>(null)
  const [showing, setShowing] = useState<ReturnPolicy | null>(null)
  const ch = useChange()
  const remove = async (p: ReturnPolicy): Promise<void> => {
    const r = await ch.run({
      confirm: `Видалити політику «${policyText(p)}»? Etsy дозволяє це лише для політики без лістингів — інакше спершу об’єднайте її з іншою.`,
      action: 'deleteReturnPolicy',
      args: { id: p.id },
      done: 'Політику видалено.'
    })
    if (r) {
      if (showing?.id === p.id) setShowing(null)
      list.reload()
    }
  }
  const saved = (note: string): void => {
    setEditing(null)
    setShowing(null)
    ch.notify(note)
    list.reload()
  }
  return (
    <div data-testid="sc-returns">
      <ErrorNote error={list.error} />
      {!list.value && !list.error && <Loading />}
      {list.value && list.value.length === 0 && <div className="hint">Політик повернення ще немає.</div>}
      {list.value && list.value.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Умови</th>
              <th>Повернення</th>
              <th>Обмін</th>
              <th>Строк</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.value.map((p) => (
              <tr key={p.id}>
                <td>
                  {policyText(p)} <span className="dim">#{p.id}</span>
                </td>
                <td>{p.acceptsReturns ? 'так' : 'ні'}</td>
                <td>{p.acceptsExchanges ? 'так' : 'ні'}</td>
                <td>{p.returnDeadline != null ? `${p.returnDeadline} дн.` : '—'}</td>
                <td className="sc-actions">
                  <button className="btn small" onClick={() => setShowing(p)}>
                    Лістинги
                  </button>
                  <button className="btn small" onClick={() => setEditing(p)}>
                    Змінити
                  </button>
                  <button className="btn small danger" disabled={ch.busy} onClick={() => void remove(p)}>
                    Видалити
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Status error={ch.error} note={ch.note} />
      {showing && <PolicyListings key={showing.id} policy={showing} />}
      {editing ? (
        <PolicyForm key={editing === 'new' ? 'new' : editing.id} policy={editing === 'new' ? null : editing} onSaved={saved} onCancel={() => setEditing(null)} />
      ) : (
        <div className="settings-actions">
          <button className="btn" onClick={() => setEditing('new')}>
            ＋ Нова політика
          </button>
        </div>
      )}
      {list.value && list.value.length > 1 && <Consolidate policies={list.value} onDone={saved} />}
    </div>
  )
}
