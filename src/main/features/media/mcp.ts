// MCP tools of feature "media": the photos, video and digital files of a
// listing in the user's own Etsy shop, live over the Etsy API ("product" =
// listing). No CDN URLs — photos are described by id, position, size, alt
// text and colour.

import { MAX_ALT_TEXT, mediaProblemEnglish, type ListingMedia, type MediaKind } from '../../../shared/features/media'
import { MAX_DIGITAL_FILES, MAX_IMAGES } from '../../../shared/myShop'
import { type JsonSchema, type McpTool, type McpToolResult, ToolInputError, errorResult, textResult } from '../../mcpProtocol'
import { MEDIA_ITEM, resolveMedia } from '../../mcpStoreTools'
import { mcpFail, mcpOwnShop, mcpWritable, mcpErrorText } from '../common'
import type { FeatureMcpDeps } from '../types'
import {
  type MediaPart,
  MediaError,
  READ_SCOPES,
  WRITE_SCOPES,
  type Upload,
  deleteFile,
  deletePhoto,
  deleteVideo,
  loadMedia,
  mimeFor,
  replaceFile,
  replacePhoto,
  replaceVideo,
  setAltText
} from './ops'

const WRITE_NOTE =
  'Changes the user\'s live Etsy shop (OAuth listings_r + listings_w; needs the "allow changes" switch in the app\'s MCP window) — only call it when the user asked for this change.'

const PART_EN: Record<MediaPart, string> = { photos: 'photos', videos: 'video', files: 'files' }

/** One MEDIA_ITEM → bytes to send, checked like the app checks a picked file. */
async function oneUpload(deps: FeatureMcpDeps, item: unknown, kind: MediaKind): Promise<Upload> {
  const own = {
    client: deps.client!,
    status: deps.authStatus,
    writesAllowed: deps.writesAllowed,
    taxonomy: deps.taxonomy,
    readFile: deps.readFile,
    statFile: deps.statFile
  }
  const photo = kind === 'photo'
  const m = await resolveMedia(own, photo ? [item] : [], photo ? [] : [item])
  const f = m.registry.get(photo ? m.photos[0] : m.files[0])!
  const problem = mediaProblemEnglish(kind, f.name, f.size)
  if (problem) throw new ToolInputError(problem)
  return { data: await m.readFile(f.path), name: f.name, type: mimeFor(kind, f.name) }
}

function mediaOut(m: ListingMedia) {
  const video = m.videos?.find((v) => v.state !== 'deleted') ?? null
  return {
    product_id: m.listingId,
    photos:
      m.photos?.map((p) => ({
        id: p.id,
        position: p.position,
        width: p.width,
        height: p.height,
        sizes: [p.url75 && 'thumbnail_75', p.url170 && 'thumbnail_170', p.url570 && 'medium_570', p.urlFull && 'full'].filter(Boolean),
        alt_text: p.altText,
        average_color_hex: p.hexCode,
        black_and_white: p.isBlackAndWhite
      })) ?? null,
    max_photos: MAX_IMAGES,
    video: video && { id: video.id, state: video.state, width: video.width, height: video.height },
    files:
      m.files?.map((f) => ({
        id: f.id,
        position: f.rank,
        name: f.name,
        size_bytes: f.sizeBytes,
        size: f.sizeLabel,
        type: f.type
      })) ?? null,
    max_files: MAX_DIGITAL_FILES,
    notes: m.notes
  }
}

const fresh = (deps: FeatureMcpDeps, shopId: number, productId: number): Promise<ListingMedia> =>
  loadMedia(deps.client!, shopId, productId, (part, e) => `The ${PART_EN[part]} could not be read: ${mcpErrorText(e)}`)

function fail(e: unknown): McpToolResult {
  if (e instanceof MediaError) return errorResult(e.cause ? `${e.en}: ${mcpErrorText(e.cause)}` : e.en)
  return mcpFail(e)
}

const PRODUCT_ID: JsonSchema = { type: 'integer', minimum: 1, description: 'The Etsy listing id (from list_my_products).' }
const WATERMARKED: JsonSchema = {
  type: 'boolean',
  description: "Mark the photo as watermarked (default false). Etsy's API doesn't report this mark, so it is always set anew."
}
const watermarked = (a: Record<string, unknown>): boolean => a.watermarked === true

/** A write tool: own Etsy shop + scopes + changes allowed; answers the listing's media read afresh. Every one calls Etsy (openWorld). */
function writeTool(
  deps: FeatureMcpDeps,
  t: Omit<McpTool, 'run' | 'readOnly' | 'openWorld'> & { change: (shopId: number, productId: number, a: Record<string, unknown>) => Promise<string> }
): McpTool {
  const { change, ...tool } = t
  return {
    ...tool,
    readOnly: false,
    openWorld: true,
    run: async (a) => {
      try {
        const shopId = mcpWritable(deps, WRITE_SCOPES)
        const productId = Number(a.product_id)
        const done = await change(shopId, productId, a)
        return textResult({ done, ...mediaOut(await fresh(deps, shopId, productId)) })
      } catch (e) {
        return fail(e)
      }
    }
  }
}

export function mediaTools(deps: FeatureMcpDeps): McpTool[] {
  const client = () => deps.client!
  return [
    {
      name: 'list_my_product_media',
      title: 'Photos, video and files of my Etsy listing',
      openWorld: true,
      description: `Live from the Etsy API (3 requests: getListingImages, getListingVideos, getAllListingFiles — the files need OAuth listings_r): for a listing in the user's own Etsy shop — the photos (id, position — 1 is the main photo, full width/height, which sizes Etsy has, alt text, average colour, black and white), the current video (id, state: active/inactive/flagged, width/height; null = none) and the digital files buyers download (id, position, name, size, type; [] for a physical listing). Etsy allows at most ${MAX_IMAGES} photos, 1 video and ${MAX_DIGITAL_FILES} files. A part Etsy refused is null with a note. No image bytes or URLs: to look at a photo of a listing the app has scanned, use get_product_image. To add photos or files, use add_product_media.`,
      inputSchema: { type: 'object', properties: { product_id: PRODUCT_ID }, required: ['product_id'], additionalProperties: false },
      run: async (a) => {
        try {
          const shopId = mcpOwnShop(deps, READ_SCOPES)
          return textResult(mediaOut(await fresh(deps, shopId, Number(a.product_id))))
        } catch (e) {
          return fail(e)
        }
      }
    },
    writeTool(deps, {
      name: 'delete_my_product_photo',
      title: 'Delete a photo of my Etsy listing',
      destructive: true,
      description: `${WRITE_NOTE} Removes one photo (photo_id from list_my_product_media) from a listing in the user's own Etsy shop (deleteListingImage); the photos after it move up. Returns done + the listing's media read afresh (as list_my_product_media).`,
      inputSchema: {
        type: 'object',
        properties: { product_id: PRODUCT_ID, photo_id: { type: 'integer', minimum: 1 } },
        required: ['product_id', 'photo_id'],
        additionalProperties: false
      },
      change: async (shop, id, a) => {
        await deletePhoto(client(), shop, id, Number(a.photo_id))
        return `photo ${a.photo_id} deleted`
      }
    }),
    writeTool(deps, {
      name: 'replace_my_product_photo',
      title: 'Replace a photo of my Etsy listing',
      destructive: true,
      description: `${WRITE_NOTE} Uploads a new photo (JPG/PNG/GIF, up to 20 MB) in place of the photo at \`position\` (1 = the main photo) of a listing in the user's own Etsy shop (uploadListingImage with overwrite at that photo's rank); the old photo is taken off. alt_text = the new photo's description for screen readers (empty when omitted — the old photo's text is not carried over); watermarked = whether it carries a watermark (default false). Returns done + the listing's media read afresh (as list_my_product_media).`,
      inputSchema: {
        type: 'object',
        properties: {
          product_id: PRODUCT_ID,
          position: { type: 'integer', minimum: 1, maximum: MAX_IMAGES },
          photo: MEDIA_ITEM,
          alt_text: { type: 'string', maxLength: MAX_ALT_TEXT },
          watermarked: WATERMARKED
        },
        required: ['product_id', 'position', 'photo'],
        additionalProperties: false
      },
      change: async (shop, id, a) => {
        const image = await oneUpload(deps, a.photo, 'photo')
        await replacePhoto(client(), shop, id, Number(a.position), image, {
          altText: typeof a.alt_text === 'string' ? a.alt_text : '',
          watermarked: watermarked(a)
        })
        return `photo at position ${a.position} replaced`
      }
    }),
    writeTool(deps, {
      name: 'set_my_photo_alt_text',
      title: 'Set the alt text of a photo of my Etsy listing',
      description: `${WRITE_NOTE} Sets the alt text (the description screen readers read, up to ${MAX_ALT_TEXT} characters; empty clears it) of one photo of a listing in the user's own Etsy shop. Etsy has no call to edit a photo, so the photo is re-attached at its own rank (uploadListingImage with listing_image_id + overwrite) and keeps its position; its "watermarked" mark is set anew to \`watermarked\` (default false — pass true for a watermarked photo). Returns done + the listing's media read afresh (as list_my_product_media).`,
      inputSchema: {
        type: 'object',
        properties: {
          product_id: PRODUCT_ID,
          photo_id: { type: 'integer', minimum: 1 },
          alt_text: { type: 'string', maxLength: MAX_ALT_TEXT },
          watermarked: WATERMARKED
        },
        required: ['product_id', 'photo_id', 'alt_text'],
        additionalProperties: false
      },
      change: async (shop, id, a) => {
        await setAltText(client(), shop, id, Number(a.photo_id), String(a.alt_text), { watermarked: watermarked(a) })
        return `alt text of photo ${a.photo_id} set`
      }
    }),
    writeTool(deps, {
      name: 'upload_my_product_video',
      title: 'Upload the video of my Etsy listing',
      destructive: true,
      description: `${WRITE_NOTE} Uploads the video (MP4/MOV/M4V/WEBM/AVI/MKV, up to 100 MB; 5–15 seconds recommended; send a big video by path — an MCP request is limited to 32 MB, base64 included) of a listing in the user's own Etsy shop (uploadListingVideo). A listing has one video: the new one is uploaded first and the current one is removed only after that succeeded, so a failed upload (Etsy's limit of 10 video uploads per listing per day included) keeps the current video. Only if Etsy refuses a second video (HTTP 409) is the current one removed first and put back when the upload fails (should that put-back fail too, the listing is left without a video and the error says so). The new video may show state "inactive" while Etsy processes it. Returns done + the listing's media read afresh (as list_my_product_media).`,
      inputSchema: {
        type: 'object',
        properties: { product_id: PRODUCT_ID, video: MEDIA_ITEM },
        required: ['product_id', 'video'],
        additionalProperties: false
      },
      change: async (shop, id, a) => {
        const video = await oneUpload(deps, a.video, 'video')
        await replaceVideo(client(), shop, id, video)
        return `video "${video.name}" uploaded`
      }
    }),
    writeTool(deps, {
      name: 'delete_my_product_video',
      title: 'Delete the video of my Etsy listing',
      destructive: true,
      description: `${WRITE_NOTE} Removes the video (video_id from list_my_product_media) from a listing in the user's own Etsy shop (deleteListingVideo). Returns done + the listing's media read afresh (as list_my_product_media).`,
      inputSchema: {
        type: 'object',
        properties: { product_id: PRODUCT_ID, video_id: { type: 'integer', minimum: 1 } },
        required: ['product_id', 'video_id'],
        additionalProperties: false
      },
      change: async (shop, id, a) => {
        await deleteVideo(client(), shop, id, Number(a.video_id))
        return `video ${a.video_id} deleted`
      }
    }),
    writeTool(deps, {
      name: 'delete_my_product_file',
      title: 'Delete a digital file of my Etsy listing',
      destructive: true,
      description: `${WRITE_NOTE} Removes one digital file buyers download (file_id from list_my_product_media) from a digital listing in the user's own Etsy shop (deleteListingFile). Deleting the LAST file turns it into a physical listing on Etsy — ask the user first. Returns done + the listing's media read afresh (as list_my_product_media).`,
      inputSchema: {
        type: 'object',
        properties: { product_id: PRODUCT_ID, file_id: { type: 'integer', minimum: 1 } },
        required: ['product_id', 'file_id'],
        additionalProperties: false
      },
      change: async (shop, id, a) => {
        await deleteFile(client(), shop, id, Number(a.file_id))
        return `file ${a.file_id} deleted`
      }
    }),
    writeTool(deps, {
      name: 'replace_my_product_file',
      title: 'Replace a digital file of my Etsy listing',
      destructive: true,
      description: `${WRITE_NOTE} Uploads a new digital file (any type, up to 20 MB) in place of the file file_id (from list_my_product_media) of a digital listing in the user's own Etsy shop, at the same position; buyers get the new file from then on. Below ${MAX_DIGITAL_FILES} files the new file goes in before the old one is deleted; at ${MAX_DIGITAL_FILES} the old one goes first and is put back if the upload fails. Returns done + the listing's media read afresh (as list_my_product_media).`,
      inputSchema: {
        type: 'object',
        properties: { product_id: PRODUCT_ID, file_id: { type: 'integer', minimum: 1 }, file: MEDIA_ITEM },
        required: ['product_id', 'file_id', 'file'],
        additionalProperties: false
      },
      change: async (shop, id, a) => {
        const file = await oneUpload(deps, a.file, 'file')
        await replaceFile(client(), shop, id, Number(a.file_id), file)
        return `file ${a.file_id} replaced with "${file.name}"`
      }
    })
  ]
}
