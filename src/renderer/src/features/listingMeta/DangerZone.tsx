// "Небезпечна зона": delete the listing on Etsy — only after the title is
// typed exactly and the confirmation dialog says yes.

import { useState } from 'react'
import type { MyListing } from '@shared/types'
import { useStore } from '../../store'
import { featureCall } from '../call'
import { useDeletedListings } from './deleted'

export function DangerZoneSection({ listing, onChanged }: { listing: MyListing; onChanged: (l?: MyListing) => void }): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)
  const markDeleted = useDeletedListings((s) => s.markDeleted)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleted, setDeleted] = useState(false)

  async function remove(): Promise<void> {
    if (!(await requestConfirm(`Видалити лістинг «${listing.title}» з Etsy назавжди?\nЙого не можна буде відновити.`))) return
    setBusy(true)
    setError(null)
    const r = await featureCall('listingMeta', 'deleteListing', { listingId: listing.listingId })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setDeleted(true)
    markDeleted(listing.listingId)
    onChanged()
  }

  if (deleted) return <div className="test-result ok">Лістинг «{listing.title}» видалено з Etsy.</div>
  return (
    <div data-testid="lm-danger" className="lm-danger">
      <p className="hint">
        Видалення лістингу на Etsy остаточне: його не можна відновити. Etsy дозволяє видаляти чернетки, неактивні, прострочені,
        розпродані й активні лістинги.
      </p>
      <div className="field">
        <label htmlFor="lm-del-title">Щоб підтвердити, введіть назву лістингу точно: «{listing.title}»</label>
        <input id="lm-del-title" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </div>
      <div className="settings-actions">
        <button className="btn danger" disabled={busy || typed !== listing.title} onClick={() => void remove()}>
          Видалити лістинг назавжди
        </button>
      </div>
      {error && (
        <div className="test-result err" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
