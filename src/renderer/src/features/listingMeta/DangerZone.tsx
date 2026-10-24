// "Небезпечна зона": delete the listing on Etsy — only after the title is
// typed exactly and the confirmation dialog says yes.

import { useState } from 'react'
import type { MyListing } from '@shared/types'
import { useStore } from '../../store'
import { Button, Callout, Field, Icon, InfoTip, Term } from '../../ui'
import { featureCall } from '../call'
import { useDeletedListings } from './deleted'

export function DangerZoneSection({ listing, onChanged }: { listing: MyListing; onChanged: (l?: MyListing) => void }): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)
  const markDeleted = useDeletedListings((s) => s.markDeleted)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleted, setDeleted] = useState(false)
  const matches = typed === listing.title

  async function remove(): Promise<void> {
    if (!(await requestConfirm(`Видалити товар «${listing.title}» з Etsy назавжди?\nЙого не можна буде відновити.`))) return
    setBusy(true)
    setError(null)
    const r = await featureCall('listingMeta', 'deleteListing', { listingId: listing.listingId })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setDeleted(true)
    markDeleted(listing.listingId)
    onChanged()
  }

  if (deleted) {
    return <Callout tone="success">Товар «{listing.title}» видалено з Etsy.</Callout>
  }
  return (
    <div data-testid="lm-danger" className="lm-danger">
      <div className="lm-danger-head">
        <Icon name="warning" size={18} />
        <h4 className="lm-danger-title">
          Видалити <Term glossary="listing">товар (лістинг)</Term> з Etsy
        </h4>
        <InfoTip glossary="features.listingMeta.deleteListing" />
      </div>
      <ul className="lm-danger-list">
        <li>Товар зникне з вашого магазину й пошуку Etsy назавжди — відновити його не можна, лише створити заново.</li>
        <li>
          Хочете лише тимчасово зняти товар з продажу? Зробіть його неактивним у формі вище — це можна скасувати будь-коли.
        </li>
        <li>Дані, які програма вже зібрала про товар під час сканувань, не видаляться.</li>
      </ul>
      <Field
        label="Щоб підтвердити, введіть назву товару точно"
        id="lm-del-title"
        hint={
          <>
            Назва: <span className="lm-danger-name">«{listing.title}»</span>
          </>
        }
        className="lm-danger-field"
      >
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
      </Field>
      {typed && (
        <div className={'lm-danger-match' + (matches ? ' is-ok' : '')} aria-live="polite">
          <Icon name={matches ? 'check' : 'close'} size={13} />
          {matches ? 'Назва збігається' : 'Поки не збігається (важать великі літери й пробіли)'}
        </div>
      )}
      <div className="lm-actions">
        <Button variant="danger" icon="trash" busy={busy} disabled={!matches} onClick={() => void remove()}>
          Видалити товар назавжди
        </Button>
      </div>
      {error && <Callout tone="error">{error}</Callout>}
    </div>
  )
}
