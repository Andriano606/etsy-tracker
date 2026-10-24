// "Фото варіантів" under the own-listing editor: for each value of one
// variation property pick one of the listing's photos (updateVariationImages
// replaces every link of the listing). Each value is a radio group (one tab
// stop; arrows move the choice).

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ListingPhoto, VariationImage, VariationImageInput, VariationImagesData } from '@shared/features/inventory'
import type { MyListing } from '@shared/types'
import { useStore, type ViewerImage } from '../../store'
import { Button, Callout, EmptyState, Icon, Loading, Segmented, Term, ZoomButton } from '../../ui'
import { featureCall } from '../call'

type Choice = Record<number, number | null>

const choiceFor = (assigned: VariationImage[], propertyId: number | null): Choice =>
  Object.fromEntries(assigned.filter((a) => a.propertyId === propertyId).map((a) => [a.valueId, a.imageId]))

const ROVING_KEYS = new Set(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'])

/** Arrow keys on a magnifier must not move the radio group's choice (the radios keep their roving keys). */
const keepArrowsOnZoom = (e: KeyboardEvent<HTMLSpanElement>): void => {
  if (ROVING_KEYS.has(e.key) && (e.target as HTMLElement).classList.contains('ui-zoom-btn')) e.stopPropagation()
}

/** The listing's photos that have a picture, as one viewer gallery (biggest URL first), + where each photo sits in it. */
function photoGallery(photos: ListingPhoto[]): { images: ViewerImage[]; index: Map<number, number> } {
  const images: ViewerImage[] = []
  const index = new Map<number, number>()
  photos.forEach((ph, n) => {
    const src = ph.urlFull ?? ph.url
    if (!src) return
    index.set(ph.imageId, images.length)
    images.push({ src, alt: ph.alt ?? `Фото ${n + 1}`, caption: `Фото ${n + 1}${ph.alt ? ` — ${ph.alt}` : ''}` })
  })
  return { images, index }
}

/** One value's photo choice: «без фото» + every photo, as radios with a roving tab stop. */
function PhotoChoice({
  value,
  photos,
  selected,
  onPick
}: {
  value: string
  photos: ListingPhoto[]
  selected: number | null
  onPick: (imageId: number | null) => void
}): JSX.Element {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const gallery = photoGallery(photos)
  const ids: Array<number | null> = [null, ...photos.map((p) => p.imageId)]
  const at = ids.indexOf(selected)
  const stop = at < 0 ? 0 : at
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const move: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    let next: number
    if (e.key in move) next = (stop + move[e.key] + ids.length) % ids.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = ids.length - 1
    else return
    e.preventDefault()
    onPick(ids[next])
    refs.current[next]?.focus()
  }
  const radio = (n: number) => ({
    ref: (el: HTMLButtonElement | null) => {
      refs.current[n] = el
    },
    type: 'button' as const,
    role: 'radio',
    'aria-checked': n === at,
    tabIndex: n === stop ? 0 : -1,
    onClick: () => onPick(ids[n])
  })
  return (
    <div className="inv-thumbs" role="radiogroup" aria-label={`Фото для «${value}»`} onKeyDown={onKey}>
      <button {...radio(0)} className="inv-thumb none" aria-label={`«${value}»: без фото`}>
        без фото
        <span className="inv-thumb-check" aria-hidden="true">
          <Icon name="check" size={12} />
        </span>
      </button>
      {photos.map((ph, n) => {
        const pick = (
          <button {...radio(n + 1)} className="inv-thumb" aria-label={`«${value}»: фото ${n + 1}`} title={`Фото ${n + 1}`}>
            {ph.url ? <img src={ph.url} alt="" /> : <span className="inv-thumb-n">{n + 1}</span>}
            <span className="inv-thumb-check" aria-hidden="true">
              <Icon name="check" size={12} />
            </span>
          </button>
        )
        const at = gallery.index.get(ph.imageId)
        // The radio picks the photo; the magnifier beside it (never inside it) opens the photo at full size.
        return at == null ? (
          <span key={ph.imageId} className="inv-thumb-host">
            {pick}
          </span>
        ) : (
          <span key={ph.imageId} className="inv-thumb-host ui-zoom-host" onKeyDown={keepArrowsOnZoom}>
            {pick}
            <ZoomButton className="ui-zoom-corner inv-thumb-zoom" images={gallery.images} index={at} label={`Відкрити фото ${n + 1} на весь розмір`} />
          </span>
        )
      })}
    </div>
  )
}

export function VariationImagesSection({ listing }: { listing: MyListing }): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [data, setData] = useState<VariationImagesData | null>(null)
  const [prop, setProp] = useState<number | null>(null)
  const [choice, setChoice] = useState<Choice>({})
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const reset = (d: VariationImagesData): void => {
    const p = d.assigned[0]?.propertyId ?? d.properties[0]?.propertyId ?? null
    setData(d)
    setProp(p)
    setChoice(choiceFor(d.assigned, p))
  }

  useEffect(() => {
    let alive = true
    void featureCall<VariationImagesData>('inventory', 'variationImages', { listingId: listing.listingId }).then((r) => {
      if (!alive) return
      if (r.ok) reset(r.value)
      else setError(r.error)
    })
    return () => {
      alive = false
    }
  }, [listing.listingId, attempt])

  if (!data) {
    return error ? (
      <Callout
        tone="error"
        action={
          <Button size="sm" icon="refresh" onClick={() => {
              setError(null)
              setAttempt((n) => n + 1)
            }}>
            Спробувати ще
          </Button>
        }
      >
        {error}
      </Callout>
    ) : (
      <Loading />
    )
  }
  if (!data.properties.length) {
    return (
      <EmptyState compact icon="layers" title="У цього товару немає варіантів.">
        Фото прив’язують до значень варіантів (наприклад, кольорів). Спершу додайте варіанти товару на Etsy.
      </EmptyState>
    )
  }
  if (!data.photos.length) {
    return (
      <EmptyState compact icon="image" title="У цього товару немає фото.">
        Додайте фото в розділі «Фото, відео й файли», а потім прив’яжіть їх тут.
      </EmptyState>
    )
  }

  const property = data.properties.find((p) => p.propertyId === prop) ?? data.properties[0]
  const items: VariationImageInput[] = property.values
    .filter((v) => v.valueId != null && choice[v.valueId] != null)
    .map((v) => ({ propertyId: property.propertyId, valueId: v.valueId as number, imageId: choice[v.valueId as number] as number }))
  const current = data.assigned.map((a) => `${a.propertyId}:${a.valueId}:${a.imageId}`).sort().join()
  const changed = items.map((a) => `${a.propertyId}:${a.valueId}:${a.imageId}`).sort().join() !== current

  const pick = (valueId: number, imageId: number | null): void => {
    setNote(null)
    setChoice((c) => ({ ...c, [valueId]: imageId }))
  }

  const save = async (): Promise<void> => {
    const ok = await requestConfirm(
      'Зберегти фото варіантів на Etsy?\nЦе замінить усі прив’язки фото до варіантів цього товару — покупці одразу побачать зміни.'
    )
    if (!ok) return
    setSaving(true)
    setError(null)
    const r = await featureCall<VariationImage[]>('inventory', 'saveVariationImages', { listingId: listing.listingId, items })
    setSaving(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    reset({ ...data, assigned: r.value })
    setNote('Фото варіантів збережено на Etsy.')
  }

  return (
    <div className="inv-section" data-testid="variation-images-section">
      <p className="inv-intro">
        Коли покупець вибирає <Term glossary="variations">варіант</Term> (наприклад, колір), Etsy показує{' '}
        <Term glossary="features.compete.variationImages">прив’язане до нього фото</Term>. Виберіть для кожного значення одне з фото товару або «без фото».
      </p>
      {data.properties.length > 1 && (
        <div className="inv-varimg-prop">
          <span className="inv-varimg-prop-label">Фото залежить від</span>
          <Segmented
            size="sm"
            label="Властивість з фото"
            value={String(property.propertyId)}
            onChange={(v) => {
              const id = Number(v)
              setProp(id)
              setChoice(choiceFor(data.assigned, id))
              setNote(null)
            }}
            options={data.properties.map((p) => ({ value: String(p.propertyId), label: p.name }))}
          />
          <p className="inv-hint">Фото можна прив’язати лише до однієї властивості — збереження прибере прив’язки до інших.</p>
        </div>
      )}
      <ul className="inv-varimg-list">
        {property.values.map((v) => (
          <li key={`${v.valueId}-${v.value}`} className="inv-varimg-row">
            <div className="inv-varimg-value clamp-2" title={v.value}>
              {v.value}
            </div>
            {v.valueId == null ? (
              <span className="inv-hint">Etsy не дав ідентифікатор цього значення — фото до нього не прив’язати.</span>
            ) : (
              <PhotoChoice value={v.value} photos={data.photos} selected={choice[v.valueId] ?? null} onPick={(img) => pick(v.valueId as number, img)} />
            )}
          </li>
        ))}
      </ul>
      {error && <Callout tone="error">{error}</Callout>}
      {note && (
        <Callout tone="success" compact>
          {note}
        </Callout>
      )}
      <div className="inv-actions">
        <Button variant="primary" icon="upload" busy={saving} disabled={!changed} onClick={() => void save()}>
          {saving ? 'Збереження…' : 'Зберегти фото варіантів'}
        </Button>
      </div>
    </div>
  )
}
