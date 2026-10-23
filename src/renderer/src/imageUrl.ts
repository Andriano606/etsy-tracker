import type { ImageSize, ListingImage } from '@shared/types'

/**
 * The URL an <img> uses for a listing image: main's etsyimg:// protocol serves
 * the MinIO copy, or the Etsy CDN when there is none. The renderer never needs
 * to know which.
 */
export function imageSrc(img: Pick<ListingImage, 'id'>, size: ImageSize): string {
  return `etsyimg://img/${img.id}/${size}`
}
