// The listing's video (one per listing): thumbnail + state, re-check the
// state (Etsy processes an upload for a while), delete, upload / replace.

import { MAX_VIDEO_BYTES, VIDEO_STATE_LABEL, VIDEO_UPLOADS_PER_DAY, type MediaVideo, type VideoState } from '@shared/features/media'
import { Badge, Button, EmptyState, InfoTip, ZoomImage, type BadgeTone } from '../../ui'
import { featureCall } from '../call'
import type { MediaOps } from './MediaSection'

const stateLabel = (s: string | null): string => (s ? (VIDEO_STATE_LABEL[s as VideoState] ?? s) : 'невідомий')
const STATE_TONE: Record<VideoState, BadgeTone> = { active: 'accent', inactive: 'warn', deleted: 'neutral', flagged: 'danger' }

export function VideoBlock({ videos, ops }: { videos: MediaVideo[]; ops: MediaOps }): JSX.Element {
  const video = videos.find((v) => v.state !== 'deleted') ?? null

  const recheck = async (v: MediaVideo): Promise<void> => {
    const r = await featureCall<MediaVideo>('media', 'video', { listingId: ops.listing.listingId, videoId: v.id })
    if (r.ok) ops.patchVideo(r.value)
    else ops.fail(r.error)
  }

  const upload = async (): Promise<void> => {
    const [f] = (await ops.pick('video')) ?? []
    if (!f) return
    await ops.run(
      'uploadVideo',
      { token: f.token },
      `Відео «${f.name}» завантажено. Etsy ще може його обробляти — перевірте стан за хвилину.`,
      video ? `Замінити відео товару на «${f.name}»? Поточне відео буде знято після того, як нове завантажиться.` : ops.liveConfirm(`Завантажити відео «${f.name}»?`)
    )
  }

  return (
    <section className="media-block" data-testid="media-video" aria-labelledby="media-video-title">
      <div className="media-block-head">
        <h4 id="media-video-title" className="media-block-title">
          Відео
        </h4>
        <InfoTip glossary="features.media.video" />
        <Badge>{video ? '1 з 1' : '0 з 1'}</Badge>
        <span className="media-block-spacer" />
        <Button size="sm" icon="upload" disabled={ops.busy} onClick={() => void upload()}>
          {video ? 'Замінити відео' : 'Завантажити відео'}
        </Button>
      </div>
      <p className="media-limits">
        Одне відео на товар: 5–15 секунд, до {MAX_VIDEO_BYTES / 1024 / 1024} МБ, звук не відтворюється; не більше {VIDEO_UPLOADS_PER_DAY}{' '}
        завантажень на добу.
      </p>
      {video ? (
        <div className="media-video">
          {video.thumbnailUrl ? (
            <ZoomImage className="media-video-zoom" src={video.thumbnailUrl} alt="Кадр відео" caption="Кадр відео (Etsy дає лише цей кадр, не саме відео)" />
          ) : (
            <div className="media-thumb-empty" />
          )}
          <div className="media-video-info">
            <div className="media-video-state">
              <span>Стан: </span>
              <Badge tone={STATE_TONE[video.state as VideoState] ?? 'neutral'}>{stateLabel(video.state)}</Badge>
              <InfoTip glossary="features.compete.videoState" size={13} />
            </div>
            {video.width && video.height ? <div className="media-meta">{`${video.width}×${video.height} пікс.`}</div> : null}
            {video.state === 'inactive' && (
              <p className="media-limits">Щойно завантажене відео Etsy обробляє кілька хвилин — натисніть «Перевірити стан» трохи згодом.</p>
            )}
            <div className="media-actions">
              <Button size="sm" icon="refresh" disabled={ops.busy} onClick={() => void recheck(video)}>
                Перевірити стан
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon="trash"
                disabled={ops.busy}
                onClick={() => void ops.run('deleteVideo', { videoId: video.id }, 'Відео видалено.', 'Видалити відео з товару?')}
              >
                Видалити відео
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState compact icon="video" title="Відео немає.">
          Відео допомагає покупцю роздивитися товар. Воно необов’язкове.
        </EmptyState>
      )}
    </section>
  )
}
