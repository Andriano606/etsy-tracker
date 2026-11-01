// UI harness scenes: listing videos — the card's "відео" badge, the listing
// window's gallery with a video thumbnail and the video playing in place, and
// the full-size viewer playing it (see ../main.cjs). Videos stream from Etsy's
// CDN, so a shot shows a frame only when the network answers.

const PRE = `
await __h.click('SimplyOrganizedPro', '.shop-item').catch(() => undefined)
await __h.sleep(700)
const reveal = async (sel) => {
  const el = document.querySelector(sel)
  const sc = document.querySelector('.shop-scroll')
  if (el && sc) sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8
  await __h.sleep(400)
}
const videoCard = () => document.querySelector('[data-testid=card-video-badge]').closest('.listing-card-host')
`
const openVideo = `${PRE} videoCard().querySelector('.listing-card').click(); await __h.waitFor('.listing-modal .gallery-thumb.is-video'); await __h.sleep(500); document.querySelector('.listing-modal .gallery-thumb.is-video').click(); await __h.sleep(2500);`

module.exports = [
  { name: 'videos-card', code: `${PRE} await reveal('[data-testid=card-video-badge]')` },
  { name: 'videos-modal', code: openVideo },
  {
    name: 'videos-viewer',
    code: `${openVideo} document.querySelector('.listing-modal .lm-video-zoom').click(); await __h.sleep(2500)`
  }
]
