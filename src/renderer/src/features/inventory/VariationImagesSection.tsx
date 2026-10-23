// "Фото варіацій" under the own-listing editor: for each value of one
// variation property pick one of the listing's photos (updateVariationImages
// replaces every link of the listing).

import { useEffect, useState } from 'react'
import type { VariationImage, VariationImageInput, VariationImagesData } from '@shared/features/inventory'
import type { MyListing } from '@shared/types'
import { useStore } from '../../store'
import { featureCall } from '../call'

type Choice = Record<number, number | null>

const choiceFor = (assigned: VariationImage[], propertyId: number | null): Choice =>
  Object.fromEntries(assigned.filter((a) => a.propertyId === propertyId).map((a) => [a.valueId, a.imageId]))

export function VariationImagesSection({ listing }: { listing: MyListing }): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [data, setData] = useState<VariationImagesData | null>(null)
  const [prop, setProp] = useState<number | null>(null)
  const [choice, setChoice] = useState<Choice>({})
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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
  }, [listing.listingId])

  if (!data) {
    return error ? (
      <div className="test-result err" role="alert">
        {error}
      </div>
    ) : (
      <div className="hint">Завантаження…</div>
    )
  }
  if (!data.properties.length) return <div className="hint">У цього лістингу немає варіацій.</div>
  if (!data.photos.length) return <div className="hint">У цього лістингу немає фото.</div>

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
      'Зберегти фото варіацій на Etsy?\nЦе замінить усі прив’язки фото до варіацій цього лістингу — покупці одразу побачать зміни.'
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
    setNote('Фото варіацій збережено на Etsy.')
  }

  return (
    <div data-testid="variation-images-section">
      {data.properties.length > 1 && (
        <>
          <div className="radio-row" role="radiogroup" aria-label="Властивість з фото">
            {data.properties.map((p) => (
              <label className="check" key={p.propertyId}>
                <input
                  type="radio"
                  name={`var-img-prop-${listing.listingId}`}
                  checked={p.propertyId === property.propertyId}
                  onChange={() => {
                    setProp(p.propertyId)
                    setChoice(choiceFor(data.assigned, p.propertyId))
                    setNote(null)
                  }}
                />
                {p.name}
              </label>
            ))}
          </div>
          <p className="hint">Фото можна прив’язати лише до однієї властивості — збереження прибере прив’язки до інших.</p>
        </>
      )}
      <table className="data-table">
        <tbody>
          {property.values.map((v) => (
            <tr key={`${v.valueId}-${v.value}`}>
              <td>{v.value}</td>
              <td>
                {v.valueId == null ? (
                  <span className="dim">Etsy не дав ідентифікатор цього значення.</span>
                ) : (
                  <div className="inv-thumbs">
                    <button
                      className="inv-thumb none"
                      aria-pressed={choice[v.valueId] == null}
                      aria-label={`«${v.value}»: без фото`}
                      onClick={() => pick(v.valueId as number, null)}
                    >
                      без фото
                    </button>
                    {data.photos.map((ph, n) => (
                      <button
                        key={ph.imageId}
                        className="inv-thumb"
                        aria-pressed={choice[v.valueId as number] === ph.imageId}
                        aria-label={`«${v.value}»: фото ${n + 1}`}
                        onClick={() => pick(v.valueId as number, ph.imageId)}
                      >
                        {ph.url ? <img src={ph.url} alt="" /> : <span>{n + 1}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && (
        <div className="test-result err" role="alert">
          {error}
        </div>
      )}
      {note && <div className="test-result ok">{note}</div>}
      <div className="settings-actions">
        <button className="btn primary" disabled={!changed || saving} onClick={() => void save()}>
          {saving ? 'Збереження…' : 'Зберегти фото варіацій'}
        </button>
      </div>
    </div>
  )
}
