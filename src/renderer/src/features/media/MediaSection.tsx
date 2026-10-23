// "Фото, відео й файли" under the own-listing editor: loads the listing's
// media when opened; every change goes through `run` (confirm → call →
// result note) and shows what Etsy has afterwards.

import { useCallback, useEffect, useState } from 'react'
import type { ListingMedia, MediaKind, MediaProgress, MediaVideo } from '@shared/features/media'
import { mediaProblemText } from '@shared/features/media'
import type { MyListing, PickedFile } from '@shared/types'
import { useStore } from '../../store'
import { featureCall } from '../call'
import { FileList } from './FileList'
import { PhotoList } from './PhotoList'
import { VideoBlock } from './VideoBlock'

export interface MediaOps {
  listing: MyListing
  busy: boolean
  /** Ask `confirm` (if any), run a write action, show its result; true = done. */
  run: (action: string, args: Record<string, unknown>, done: string, confirm?: string | null) => Promise<boolean>
  /** Pick files of a kind and check them (type, size); null = cancelled or refused (the reason is shown). */
  pick: (kind: MediaKind) => Promise<PickedFile[] | null>
  /** `text` + "the change is visible at once" for an active listing; null otherwise (no confirm needed). */
  liveConfirm: (text: string) => string | null
  /** Show a re-read video (its state) in place of the shown one. */
  patchVideo: (v: MediaVideo) => void
  /** Show an error note. */
  fail: (text: string) => void
}

const PICKER: Record<MediaKind, 'images' | 'videos' | 'files'> = { photo: 'images', video: 'videos', file: 'files' }
const KIND_LABEL: Record<MediaKind, string> = { photo: 'Фото', video: 'Відео', file: 'Файл' }

function progressText(p: MediaProgress): string {
  const n = p.total > 1 ? ` ${p.index}/${p.total}` : ''
  return `${KIND_LABEL[p.kind]}${n}: «${p.name}» — завантаження…`
}

export function MediaSection({ listing, onChanged }: { listing: MyListing; onChanged: (l?: MyListing) => void }): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)
  const id = listing.listingId
  const [media, setMedia] = useState<ListingMedia | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<MediaProgress | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const r = await featureCall<ListingMedia>('media', 'load', { listingId: id })
    if (r.ok) {
      setMedia(r.value)
      setLoadError(null)
    } else setLoadError(r.error)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(
    () =>
      window.api.onFeatureEvent((e) => {
        const p = e.payload as MediaProgress
        if (e.feature === 'media' && e.type === 'progress' && p?.listingId === id) setProgress(p)
      }),
    [id]
  )

  const show = (m: ListingMedia): void => {
    const before = media?.photos?.[0]?.url170 ?? null
    setMedia(m)
    const first = m.photos?.[0]?.url170 ?? null
    if (m.photos && first !== before) onChanged({ ...listing, imageUrl: first })
  }

  const ops: MediaOps = {
    listing,
    busy,
    run: async (action, args, done, confirm) => {
      if (confirm && !(await requestConfirm(confirm))) return false
      setBusy(true)
      setNote(null)
      setProgress(null)
      const r = await featureCall<ListingMedia>('media', action, { listingId: id, ...args })
      setBusy(false)
      setProgress(null)
      if (r.ok) {
        show(r.value)
        setNote({ ok: true, text: done })
        return true
      }
      setNote({ ok: false, text: r.error })
      // A change may have stopped half-way: show what Etsy has now.
      await load()
      return false
    },
    pick: async (kind) => {
      const files = await window.api.pickListingFiles(PICKER[kind])
      if (!files.length) return null
      const problems = files.map((f) => mediaProblemText(kind, f.name, f.size)).filter((p): p is string => !!p)
      if (problems.length) {
        setNote({ ok: false, text: problems.join(' ') })
        return null
      }
      return files
    },
    liveConfirm: (text) => (listing.state === 'active' ? `${text}\nЛістинг активний — покупці побачать зміну одразу.` : null),
    patchVideo: (v) => setMedia((m) => m && { ...m, videos: m.videos?.map((x) => (x.id === v.id ? v : x)) ?? null }),
    fail: (text) => setNote({ ok: false, text })
  }

  if (!media) {
    if (!loadError) return <div className="hint">Завантаження…</div>
    return (
      <div>
        <div className="test-result err" role="alert">
          {loadError}
        </div>
        <button className="btn small" onClick={() => void load()}>
          Спробувати ще
        </button>
      </div>
    )
  }
  return (
    <div className="media-section" data-testid="media-section">
      {media.notes.map((n) => (
        <div key={n} className="hint warn">
          {n}
        </div>
      ))}
      {media.photos && <PhotoList photos={media.photos} ops={ops} />}
      {media.videos && <VideoBlock videos={media.videos} ops={ops} />}
      {media.files && <FileList files={media.files} ops={ops} />}
      {busy && <div className="hint">{progress ? progressText(progress) : 'Зачекайте…'}</div>}
      {note && (
        <div className={`test-result ${note.ok ? 'ok' : 'err'}`} role={note.ok ? 'status' : 'alert'}>
          {note.text}
        </div>
      )}
    </div>
  )
}
