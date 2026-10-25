// The listing's photos in rank order: alt text ("Опис фото для пошуку"), move
// up / make main, replace, delete (with "Повернути" in the result note — Etsy
// keeps a deleted photo re-attachable), add; the watermark switch sits in the
// header because every photo save sends it.

import { useRef, useState } from 'react'
import { MAX_ALT_TEXT, type MediaPhoto } from '@shared/features/media'
import { MAX_IMAGES } from '@shared/myShop'
import { photoRef } from '@shared/claudeRef'
import type { ViewerImage } from '../../store'
import { Badge, Button, EmptyState, GLOSSARY, InfoTip, Toggle, ZoomImage } from '../../ui'
import type { MediaOps } from './MediaSection'

/** The biggest URL Etsy gave for a photo (the viewer opens it), null when none. */
const fullSrc = (p: MediaPhoto): string | null => p.urlFull ?? p.url570 ?? p.url170 ?? p.url75

/** Every photo that has a picture, as a viewer gallery in rank order (each with its "Копіювати для Claude" reference). */
function photoGallery(photos: MediaPhoto[], listingId: number): { viewable: MediaPhoto[]; gallery: ViewerImage[] } {
  const viewable = photos.filter((p) => fullSrc(p) != null)
  return {
    viewable,
    gallery: viewable.map((p) => ({
      src: fullSrc(p) as string,
      alt: p.altText || `Фото №${p.position}`,
      caption: `Фото №${p.position}${p.altText ? ` — ${p.altText}` : ''}`,
      ref: photoRef(listingId, p.id)
    }))
  }
}

function AltText({ photo, ops, watermarked }: { photo: MediaPhoto; ops: MediaOps; watermarked: boolean }): JSX.Element {
  const [alt, setAlt] = useState(photo.altText)
  const id = `media-alt-${photo.id}`
  return (
    <div className="media-alt">
      <div className="media-alt-head">
        <label htmlFor={id} className="media-alt-label">
          Опис фото для пошуку
        </label>
        <InfoTip glossary="features.media.altText" size={13} />
        <span className="media-alt-count num">
          {alt.length}/{MAX_ALT_TEXT}
        </span>
      </div>
      <textarea
        id={id}
        rows={2}
        aria-label={`Опис фото №${photo.position} для пошуку`}
        placeholder="Що на фото? Напр., «Планер на столі, рожева обкладинка»"
        value={alt}
        maxLength={MAX_ALT_TEXT}
        onChange={(e) => setAlt(e.target.value)}
      />
      <div className="media-alt-save">
        <Button
          size="sm"
          disabled={ops.busy || alt === photo.altText}
          onClick={() =>
            void ops.run(
              'setAltText',
              { imageId: photo.id, altText: alt, watermarked },
              `Опис фото №${photo.position} збережено.`,
              ops.liveConfirm(`Змінити опис фото №${photo.position}?`)
            )
          }
        >
          Зберегти
        </Button>
      </div>
    </div>
  )
}

export function PhotoList({ photos, ops }: { photos: MediaPhoto[]; ops: MediaOps }): JSX.Element {
  const [watermarked, setWatermarked] = useState(false)
  const full = photos.length >= MAX_IMAGES
  // "Повернути" lives in the result note, so it reads the current switch and photos, not those of the delete.
  const latest = useRef({ watermarked, photos })
  latest.current = { watermarked, photos }

  const move = (p: MediaPhoto, toPosition: number): void =>
    void ops.run(
      'movePhoto',
      { imageId: p.id, toPosition, watermarked },
      toPosition === 1 ? 'Фото стало головним.' : `Фото пересунуто на позицію ${toPosition}.`,
      ops.liveConfirm(`Пересунути фото №${p.position} на позицію ${toPosition}?`)
    )

  const replace = async (p: MediaPhoto): Promise<void> => {
    const [f] = (await ops.pick('photo')) ?? []
    if (!f) return
    await ops.run(
      'replacePhoto',
      // The old alt text describes the old picture — the new one starts without it.
      { position: p.position, token: f.token, altText: '', watermarked },
      `Фото №${p.position} замінено. Додайте опис для нового фото.`,
      `Замінити фото №${p.position} на «${f.name}»? Старе фото буде знято з товару, а опис нового буде порожнім.`
    )
  }

  const undo = (p: MediaPhoto): void => ops.offer({ label: 'Повернути', icon: 'history', onClick: () => void restore(p) })

  const remove = async (p: MediaPhoto): Promise<void> => {
    const done = `Фото №${p.position} видалено. Etsy зберігає його копію, тож його можна повернути.`
    if (await ops.run('deletePhoto', { imageId: p.id }, done, `Видалити фото №${p.position} з товару?`)) undo(p)
  }

  const restore = async (p: MediaPhoto): Promise<void> => {
    const now = latest.current
    if (now.photos.length >= MAX_IMAGES) {
      ops.fail(`Уже ${MAX_IMAGES} фото — це максимум. Щоб повернути фото, спершу видаліть інше.`)
      return
    }
    const at = Math.min(p.position, now.photos.length + 1)
    const ok = await ops.run(
      'restorePhoto',
      { imageId: p.id, position: at, altText: p.altText, watermarked: now.watermarked },
      'Фото повернуто.',
      ops.liveConfirm(`Повернути видалене фото на позицію ${at}?`)
    )
    // Still re-attachable after a failure: offer it again on the error note.
    if (!ok) undo(p)
  }

  const add = async (): Promise<void> => {
    const files = await ops.pick('photo')
    if (!files) return
    if (photos.length + files.length > MAX_IMAGES) {
      ops.fail(`У товару може бути до ${MAX_IMAGES} фото: зараз ${photos.length}, можна додати ще ${MAX_IMAGES - photos.length}.`)
      return
    }
    await ops.run(
      'addPhotos',
      { tokens: files.map((f) => f.token), watermarked },
      `Додано фото: ${files.length}.`,
      ops.liveConfirm(`Додати ${files.length} фото в кінець галереї?`)
    )
  }

  const { viewable, gallery } = photoGallery(photos, ops.listing.listingId)
  return (
    <section className="media-block" data-testid="media-photos" aria-labelledby="media-photos-title">
      <div className="media-block-head">
        <h4 id="media-photos-title" className="media-block-title">
          Фото
        </h4>
        <InfoTip glossary="myshop.photos" />
        <Badge tone={full ? 'warn' : 'neutral'}>
          {photos.length} з {MAX_IMAGES}
        </Badge>
        <span className="media-block-spacer" />
        <Button size="sm" variant={photos.length === 0 ? 'primary' : 'secondary'} icon="plus" disabled={ops.busy || full} tooltip={full ? `Уже ${MAX_IMAGES} фото — це максимум` : undefined} onClick={() => void add()}>
          Додати фото
        </Button>
      </div>
      <p className="media-limits">
        JPG, PNG або GIF, до 20 МБ. Перше фото — головне: його видно в пошуку. Стрілка вгору міняє фото місцями з попереднім, зірочка робить його головним.
      </p>
      <Toggle
        className="media-watermark"
        switchFirst
        label="З водяним знаком"
        glossary="features.media.watermark"
        hint="Etsy не повідомляє, чи фото позначене «з водяним знаком», тож при кожному збереженні фото (додавання, заміна, опис, перестановка) позначка береться звідси."
        checked={watermarked}
        onChange={setWatermarked}
      />
      {photos.length === 0 ? (
        <EmptyState compact icon="image" title="Фото немає">
          Без фото товар не можна опублікувати. Додайте хоча б одне.
        </EmptyState>
      ) : (
        <ul className="media-photos">
          {photos.map((p) => {
            const src = p.url170 ?? p.url570 ?? p.url75
            const main = p.position === 1
            const at = viewable.findIndex((v) => v.id === p.id)
            return (
              <li key={p.id} data-testid={`media-photo-${p.id}`} className={main ? 'is-main' : undefined}>
                <div className="media-photo-img">
                  {src ? (
                    <ZoomImage
                      className="media-photo-zoom"
                      src={src}
                      alt={p.altText || `Фото №${p.position}`}
                      gallery={gallery}
                      index={Math.max(0, at)}
                    />
                  ) : (
                    <div className="media-thumb-empty" />
                  )}
                  <span className="media-photo-pos num" aria-hidden="true">
                    {p.position}
                  </span>
                  {main && (
                    <Badge tone="accent" solid icon="star" className="media-photo-main" hint={GLOSSARY['myshop.mainPhoto'].short}>
                      Головне
                    </Badge>
                  )}
                </div>
                <div className="media-meta">
                  <span className="sr-only">Фото №{p.position}. </span>
                  {p.width && p.height ? `${p.width}×${p.height} пікс.` : 'розмір невідомий'}
                </div>
                <AltText key={p.altText} photo={p} ops={ops} watermarked={watermarked} />
                <div className="media-actions" role="group" aria-label={`Дії з фото №${p.position}`}>
                  <Button size="sm" icon="arrow-up" iconOnly label="Пересунути вище" disabled={ops.busy || main} onClick={() => move(p, p.position - 1)} />
                  <Button size="sm" icon="star" iconOnly label="Зробити головним" disabled={ops.busy || main} onClick={() => move(p, 1)} />
                  <Button size="sm" icon="upload" aria-label="Замінити фото" tooltip="Завантажити інше фото на це місце" disabled={ops.busy} onClick={() => void replace(p)}>
                    Замінити
                  </Button>
                  <span className="media-block-spacer" />
                  <Button size="sm" variant="danger" icon="trash" iconOnly label="Видалити фото" disabled={ops.busy} onClick={() => void remove(p)} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
