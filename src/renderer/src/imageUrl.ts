import { isEtsyCdnUrl } from '@shared/externalUrl'
import type { ImageSize, ListingImage, ListingVideo } from '@shared/types'

/**
 * The URL an <img> uses for a listing image: main's etsyimg:// protocol serves
 * the MinIO copy, or the Etsy CDN when there is none. The renderer never needs
 * to know which.
 */
export function imageSrc(img: Pick<ListingImage, 'id'>, size: ImageSize): string {
  return `etsyimg://img/${img.id}/${size}`
}

/** A review photo (only the original exists): MinIO copy, else the Etsy CDN — via main. */
export function reviewImageSrc(review: { id: number }): string {
  return `etsyimg://review/${review.id}/fullxfull`
}

/** A stored listing video's preview frame (Etsy CDN, via main). */
export function videoThumbSrc(video: { id: number }): string {
  return `etsyimg://video/${video.id}/thumbnail`
}

/**
 * The URL a <video> plays (CSP media-src: Etsy's CDN only — videos are never
 * copied to MinIO): only an https etsystatic.com URL of a video Etsy shows
 * (state active, or not said); null otherwise.
 */
export function playableVideo(video: { videoUrl?: string | null; state?: string | null }): string | null {
  if (video.state != null && video.state !== 'active') return null
  return video.videoUrl && isEtsyCdnUrl(video.videoUrl) ? video.videoUrl : null
}

/** A listing's videos that can be played, in Etsy's order. */
export function playableVideos(videos: ListingVideo[] | null | undefined): (ListingVideo & { videoUrl: string })[] {
  return (videos ?? []).filter((v): v is ListingVideo & { videoUrl: string } => playableVideo(v) != null)
}
