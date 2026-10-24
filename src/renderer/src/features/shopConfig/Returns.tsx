// "Повернення" (Мій магазин): return policies — create/edit/delete, merge one
// into another (consolidate) and the listings that use a policy.

import { useState } from 'react'
import { RETURN_DEADLINES, type PolicyListing, type ReturnPolicy } from '@shared/features/shopConfig'
import { STATE_LABEL } from '@shared/myShop'
import { Button, EmptyState, Field, Icon, Loading, Select, Toggle } from '../../ui'
import { useChange, useLoad, type Change } from './common'
import { Card, DataTable, ErrorNote, Intro, Note, Status, Td } from './kit'

export function policyText(p: ReturnPolicy): string {
  const what = [p.acceptsReturns && 'повернення', p.acceptsExchanges && 'обмін'].filter(Boolean).join(' і ')
  if (!what) return 'Без повернень і обміну'
  return `${what[0].toUpperCase()}${what.slice(1)} протягом ${p.returnDeadline ?? '?'} дн.`
}

/** "так" / "ні" with an icon, so the answer doesn't rely on colour. */
function YesNo({ yes }: { yes: boolean }): JSX.Element {
  return (
    <span className={'fx-yesno' + (yes ? ' is-yes' : '')}>
      <Icon name={yes ? 'check' : 'minus'} size={14} />
      {yes ? 'так' : 'ні'}
    </span>
  )
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
  const what = policyText({ id: 0, acceptsReturns: returns, acceptsExchanges: exchanges, returnDeadline: Number(deadline) })
  const save = async (): Promise<void> => {
    const input = { accepts_returns: returns, accepts_exchanges: exchanges, ...(accepts ? { return_deadline: deadline } : {}) }
    const change: Change = policy
      ? {
          confirmLabel: 'Зберегти правила',
          confirm: `Зберегти правила повернення («${what}»)?\nПокупці одразу побачать нові умови в усіх товарах із цими правилами.`,
          action: 'updateReturnPolicy',
          args: { id: policy.id, input },
          done: 'Політику збережено.'
        }
      : {
          confirmLabel: 'Створити правила',
          confirm: `Створити правила повернення («${what}»)?`,
          action: 'createReturnPolicy',
          args: { input },
          done: 'Політику створено.'
        }
    if (await ch.run<ReturnPolicy>(change)) onSaved(change.done)
  }
  return (
    <Card
      tone="form"
      testId="sc-return-form" reveal
      title={policy ? 'Змінити правила повернення' : 'Нові правила повернення'}
      footer={
        <>
          <Button variant="primary" busy={ch.busy} onClick={() => void save()}>
            {policy ? 'Зберегти' : 'Створити'}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Скасувати
          </Button>
        </>
      }
    >
      <div className="fx-toggles">
        <Toggle
          label="Приймаю повернення"
          hint="Покупець може надіслати товар назад і отримати гроші. Доставку назад зазвичай оплачує покупець."
          checked={returns}
          onChange={setReturns}
        />
        <Toggle
          label="Приймаю обмін"
          hint="Покупець може замінити товар на інший — наприклад, інший розмір чи колір."
          checked={exchanges}
          onChange={setExchanges}
        />
      </div>
      {accepts ? (
        <Field label="Строк (днів після доставки)" glossary="features.compete.returnDeadline" hint="Скільки днів після отримання посилки покупець має, щоб написати вам.">
          <Select value={deadline} onChange={setDeadline}>
            {RETURN_DEADLINES.map((d) => (
              <option key={d} value={String(d)}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Note>Покупці побачать, що повернення й обмін не приймаються. Попросити скасувати замовлення до відправлення вони все одно можуть.</Note>
      )}
      <p className="fx-example">
        Покупці побачать: <strong>{what}</strong>
      </p>
      <Status error={ch.error} note={ch.note} />
    </Card>
  )
}

function PolicyListings({ policy, onClose }: { policy: ReturnPolicy; onClose: () => void }): JSX.Element {
  const list = useLoad<PolicyListing[]>('returnPolicyListings', { id: policy.id }, String(policy.id))
  return (
    <Card
      testId="sc-policy-listings" reveal
      title={`Товари з правилами «${policyText(policy)}»`}
      footer={
        <Button variant="ghost" size="sm" onClick={onClose}>
          Сховати список
        </Button>
      }
    >
      <ErrorNote error={list.error} />
      {!list.value && !list.error && <Loading inline>Завантаження товарів…</Loading>}
      {list.value && list.value.length === 0 && <p className="fx-muted">Жоден товар не використовує ці правила — їх можна видалити.</p>}
      {list.value && list.value.length > 0 && (
        <ul className="fx-list">
          {list.value.map((l) => (
            <li key={l.listingId} className="fx-list-row">
              <span className="truncate fx-title" title={l.title}>
                {l.title}
              </span>
              <span className="fx-meta">
                #{l.listingId} · {STATE_LABEL[l.state as keyof typeof STATE_LABEL] ?? l.state}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
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
      confirmLabel: 'Об’єднати правила',
      danger: true,
      confirm: `Перенести всі товари з правил ${name(source)} у ${name(dest)} і видалити ${name(source)}?\nЦе не можна скасувати.`,
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
    <Card
      testId="sc-consolidate"
      title="Об’єднати правила"
      glossary="features.shopConfig.consolidate"
      desc="Так видаляють правила, які ще використовують товари: товари переходять на інші правила, а ці зникають."
      footer={
        <Button variant="danger" icon="layers" busy={ch.busy} disabled={!source || !dest} onClick={() => void run()}>
          Об’єднати
        </Button>
      }
    >
      <div className="ui-form-grid fx-grid-2">
        <Field label="Які правила прибрати" hint="Ці правила буде видалено.">
          <Select value={source} onChange={setSource} fullWidth>
            <option value="">— виберіть —</option>
            {options(dest)}
          </Select>
        </Field>
        <Field label="Куди перенести товари" hint="Ці правила отримають усі товари з перших.">
          <Select value={dest} onChange={setDest} fullWidth>
            <option value="">— виберіть —</option>
            {options(source)}
          </Select>
        </Field>
      </div>
      <Status error={ch.error} note={ch.note} />
    </Card>
  )
}

export function ReturnsTab(): JSX.Element {
  const list = useLoad<ReturnPolicy[]>('returnPolicies')
  const [editing, setEditing] = useState<ReturnPolicy | 'new' | null>(null)
  const [showing, setShowing] = useState<ReturnPolicy | null>(null)
  const ch = useChange()
  const remove = async (p: ReturnPolicy): Promise<void> => {
    const r = await ch.run({
      confirmLabel: 'Видалити правила',
      danger: true,
      confirm: `Видалити правила «${policyText(p)}»?\nEtsy дозволяє це лише для правил без товарів — інакше спершу об’єднайте їх з іншими (нижче).`,
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
    <div className="fx-page" data-testid="sc-returns">
      <Intro
        title="Повернення й обмін"
        glossary="returnPolicy"
        icon="history"
        action={
          !editing && (
            <Button icon="plus" onClick={() => setEditing('new')}>
              Нові правила
            </Button>
          )
        }
      >
        Чи можуть покупці повернути або обміняти товар і скільки днів на це мають. Кожен товар використовує одні з цих правил; покупці бачать їх на
        сторінці товару. Чесні й щедрі умови підвищують довіру.
      </Intro>
      <ErrorNote error={list.error} title="Не вдалося завантажити правила" />
      {!list.value && !list.error && <Loading>Завантаження правил…</Loading>}
      {list.value && list.value.length === 0 && !editing && (
        <EmptyState
          compact
          icon="history"
          title="Політик повернення ще немає."
          action={
            <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
              Створити правила
            </Button>
          }
        />
      )}
      {list.value && list.value.length > 0 && (
        <DataTable
          label="Правила повернення"
          stack="lg"
          columns={[
            { label: 'Умови' },
            { label: 'Повернення', glossary: 'features.compete.returns' },
            { label: 'Обмін', glossary: 'features.compete.exchanges' },
            { label: 'Строк', glossary: 'features.compete.returnDeadline' },
            { label: 'Дії', srOnly: true }
          ]}
        >
          {list.value.map((p) => (
            <tr key={p.id}>
              <Td label="Умови" primary>
                {policyText(p)} <span className="fx-meta">#{p.id}</span>
              </Td>
              <Td label="Повернення">
                <YesNo yes={p.acceptsReturns} />
              </Td>
              <Td label="Обмін">
                <YesNo yes={p.acceptsExchanges} />
              </Td>
              <Td label="Строк">
                <span className="num">{p.returnDeadline != null ? `${p.returnDeadline} дн.` : '—'}</span>
              </Td>
              <Td label="Дії" actions>
                <Button size="sm" variant="ghost" icon="list" aria-label={`Товари з правилами «${policyText(p)}» (#${p.id})`} aria-expanded={showing?.id === p.id} onClick={() => setShowing(showing?.id === p.id ? null : p)}>
                  Товари
                </Button>
                <Button size="sm" icon="edit" aria-label={`Змінити правила «${policyText(p)}» (#${p.id})`} onClick={() => setEditing(p)}>
                  Змінити
                </Button>
                <Button size="sm" variant="danger" icon="trash" aria-label={`Видалити правила «${policyText(p)}» (#${p.id})`} disabled={ch.busy} onClick={() => void remove(p)}>
                  Видалити
                </Button>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
      <Status error={ch.error} note={ch.note} />
      {showing && <PolicyListings key={showing.id} policy={showing} onClose={() => setShowing(null)} />}
      {editing && (
        <PolicyForm key={editing === 'new' ? 'new' : editing.id} policy={editing === 'new' ? null : editing} onSaved={saved} onCancel={() => setEditing(null)} />
      )}
      {list.value && list.value.length > 1 && <Consolidate policies={list.value} onDone={saved} />}
    </div>
  )
}
