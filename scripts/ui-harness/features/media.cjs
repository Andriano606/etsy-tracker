// UI harness samples for feature "media" (see ../fake-api.cjs): the own
// listing's photos (from the tracked copy of the same listing), one video and
// two buyer files; listing 1 = empty states, 2 = a load error, 3 = the video unreadable.

const which = (listingId, ctx) => ctx.myListings.filter((l) => l.state === 'active').findIndex((l) => l.listingId === listingId)

function load({ listingId }, ctx) {
  if (which(listingId, ctx) === 2) return { ok: false, error: 'Etsy не відповідає (тайм-аут 30 с). Перевірте інтернет і спробуйте ще раз.' }
  const empty = which(listingId, ctx) === 1
  const tracked = ctx.allListings.find((x) => x.listingId === listingId)
  const photos = (tracked?.images ?? []).map((im, i) => ({
    id: im.id,
    position: i + 1,
    rank: i + 1,
    url75: im.url75,
    url170: im.url170,
    url570: im.url570,
    urlFull: im.urlFull,
    width: im.width,
    height: im.height,
    altText: i === 0 ? 'Таблиця бюджету на місяць у рожевих тонах' : '',
    hexCode: im.hexCode,
    isBlackAndWhite: false
  }))
  // 1 = empty states (no video, no files); 3 = the video couldn't be read (main returns videos: null + a note).
  if (empty) return { listingId, photos: photos.slice(0, 2), videos: [], files: [], notes: [] }
  if (which(listingId, ctx) === 3) {
    return {
      listingId,
      photos: photos.slice(0, 3),
      videos: null,
      files: [],
      notes: ['Відео: немає дозволу читати відео цього товару. Вийдіть і увійдіть в Etsy ще раз («Мій магазин»).']
    }
  }
  return {
    listingId,
    photos,
    videos: [{ id: 77001, width: 1920, height: 1080, thumbnailUrl: photos[0]?.url570 ?? null, state: 'inactive' }],
    files: [
      { id: 88001, rank: 1, name: 'Monthly-Budget-Spreadsheet-Instructions.pdf', sizeBytes: 1_258_291, sizeLabel: '1.2 MB', type: 'application/pdf' },
      { id: 88002, rank: 2, name: 'bonus-templates.zip', sizeBytes: null, sizeLabel: '20 KB', type: 'application/zip' }
    ],
    notes: []
  }
}

module.exports = {
  load,
  setAltText: load,
  movePhoto: load,
  replacePhoto: load,
  deletePhoto: load,
  restorePhoto: load,
  addPhotos: load,
  uploadVideo: load,
  deleteVideo: load,
  addFiles: load,
  replaceFile: load,
  deleteFile: load,
  video: () => ({ id: 77001, width: 1920, height: 1080, thumbnailUrl: null, state: 'active' })
}
