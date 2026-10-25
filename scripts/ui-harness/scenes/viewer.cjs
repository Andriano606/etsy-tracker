// The full-size image viewer (ui/ImageViewer.tsx) from every kind of opener, and the
// drafts' file downloads + Etsy links (DraftsModal). Each starts from a fresh app
// (first shop = SimplyOrganizedPro selected). Run signed in.

const H = `
const viewer = () => __h.waitFor('.ui-viewer')
const loaded = async () => { await viewer(); const end = Date.now() + 6000; while (Date.now() < end && document.querySelector('.ui-viewer .ui-viewer-note')) await __h.sleep(100); await __h.sleep(250) }
const cardOf = (text) => { const c = __h.find(text, '.listing-card'); if (!c) throw new Error('no card ' + text); return c }
const openListing = async (text) => { const c = text ? cardOf(text) : document.querySelector('.listing-card'); c.scrollIntoView({ block: 'center' }); c.click(); await __h.waitFor('.listing-modal'); await __h.sleep(600) }
const action = async (label) => {
  const b = __h.find(label, '.shop-header button, .shop-head-row button')
  if (b) return __h.click(b)
  await __h.clickSel('.shop-header .ui-actionbar-more button, .shop-head-row .ui-actionbar-more button')
  await __h.click(label, '[role=menuitem]')
}
const own = async () => { await __h.click('TidyFoxSheets', '.shop-item'); await __h.sleep(300) }
const openDrafts = async () => { await own(); await action('Чернетки'); await __h.sleep(400) }
const openDraft = async (n) => { await openDrafts(); const bs = [...document.querySelectorAll('.my-rows button')].filter((b) => /Відкрити|Переглянути/.test(b.textContent)); await __h.click(bs[n]); await __h.sleep(500) }
const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
`
const scene = (name, code) => ({ name, code: H + code })

module.exports = [
  // Hover over the first card: its corner magnifier shows (a real mouse move, see main.cjs __hoverSel).
  scene('viewer-card-hover', ";(await __h.waitFor('.listing-card-host')).scrollIntoView({ block: 'center' }); await __h.sleep(300); window.__hoverSel = '.listing-card-host .thumb'"),
  // The magnifier on a card with a light photo / a dark photo — forced visible to check contrast on each.
  scene(
    'viewer-card-corners',
    ";(await __h.waitFor('.listing-card-host')).scrollIntoView({ block: 'start' }); const st = document.createElement('style'); st.textContent = '.ui-zoom-host > .ui-zoom-corner { opacity: 1 !important }'; document.head.append(st); await __h.sleep(800)"
  ),
  // Same on OneWayCollection (dark product photos).
  scene(
    'viewer-card-corners-dark',
    "await __h.click('OneWayCollection', '.shop-item'); await __h.sleep(600); (await __h.waitFor('.listing-card-host')).scrollIntoView({ block: 'start' }); const st = document.createElement('style'); st.textContent = '.ui-zoom-host > .ui-zoom-corner { opacity: 1 !important }'; document.head.append(st); await __h.sleep(1200)"
  ),
  scene('viewer-from-card', "await __h.waitFor('.card-zoom'); document.querySelector('.card-zoom').click(); await loaded()"),
  scene('viewer-from-modal', "await openListing(); await __h.clickSel('.listing-modal .lm-gallery-zoom'); await loaded()"),
  scene('viewer-step', "await openListing(); await __h.clickSel('.listing-modal .lm-gallery-zoom'); await loaded(); key('ArrowRight'); await __h.sleep(100); key('ArrowRight'); await loaded()"),
  scene('viewer-copy-ref', "await openListing(); await __h.clickSel('.listing-modal .lm-gallery-zoom'); await loaded(); await __h.clickSel('[data-testid=viewer-copy-ref]'); await __h.sleep(300)"),
  scene('viewer-copy-ref-failed', "await window.api.__setCopyFail(true); await openListing(); await __h.clickSel('.listing-modal .lm-gallery-zoom'); await loaded(); await __h.clickSel('[data-testid=viewer-copy-ref]'); await __h.sleep(300)"),
  scene('viewer-copy-ref-single', "await __h.clickSel('.shop-icon-zoom'); await loaded()"),
  scene('viewer-modal-photo-icons', "await openListing(); const st = document.createElement('style'); st.textContent = '.listing-modal .lm-gallery-zoom .ui-zoom-badge, .listing-modal .lm-gallery-nav { opacity: 1 !important }'; document.head.append(st); await __h.sleep(300)"),
  scene('viewer-modal-photo-copied', "await openListing(); const st = document.createElement('style'); st.textContent = '.listing-modal .lm-gallery-zoom .ui-zoom-badge, .listing-modal .lm-gallery-nav { opacity: 1 !important }'; document.head.append(st); await __h.clickSel('.listing-modal [data-testid=copy-for-claude]'); await __h.sleep(300)"),
  scene('viewer-modal-photo-failed', "await window.api.__setCopyFail(true); await openListing(); await __h.clickSel('.listing-modal [data-testid=copy-for-claude]'); await __h.sleep(300)"),
  scene('viewer-actual', "await openListing(); await __h.clickSel('.listing-modal .lm-gallery-zoom'); await loaded(); await __h.click(document.querySelector('.ui-viewer-bar .ui-viewer-btn')); await __h.sleep(500)"),
  scene(
    'viewer-actual-scrolled',
    "await openListing(); await __h.clickSel('.listing-modal .lm-gallery-zoom'); await loaded(); await __h.click(document.querySelector('.ui-viewer-bar .ui-viewer-btn')); await __h.sleep(500); const s = document.querySelector('.ui-viewer-stage'); s.scrollTop = s.scrollHeight; s.scrollLeft = s.scrollWidth; await __h.sleep(200)"
  ),
  // The review photo inside the listing window ("Збережені відгуки") and the viewer opened from it.
  scene(
    'viewer-review-photo',
    "await openListing('Client Tracker Excel CRM'); await __h.open('Збережені відгуки'); await __h.waitFor('.review-photo-zoom', 6000); document.querySelector('.review-photo-zoom').scrollIntoView({ block: 'center' }); window.__hoverSel = '.review-photo-zoom'"
  ),
  scene(
    'viewer-from-review',
    "await openListing('Client Tracker Excel CRM'); await __h.open('Збережені відгуки'); await __h.waitFor('.review-photo-zoom', 6000); document.querySelector('.review-photo-zoom').click(); await loaded()"
  ),
  scene('viewer-logo-hover', "await __h.waitFor('.shop-icon-zoom'); window.__hoverSel = '.shop-icon-zoom'"),
  scene('viewer-from-logo', "await __h.clickSel('.shop-icon-zoom'); await loaded()"),
  // Drafts: the list, a draft with files (download buttons) + after a download, a sent one (Etsy links).
  scene('viewer-drafts-list', 'await openDrafts()'),
  scene("viewer-draft-files", "await openDraft(0); const f = document.querySelector('.draft-files'); f && f.scrollIntoView({ block: 'center' }); await __h.sleep(300)"),
  scene(
    'viewer-draft-downloaded',
    "await openDraft(0); const f = document.querySelector('.draft-files'); f.scrollIntoView({ block: 'center' }); await __h.click(f.querySelector('button[aria-label^=\"Завантажити\"]')); await __h.sleep(400)"
  ),
  scene('viewer-draft-photo', "await openDraft(0); await __h.clickSel('.draft-photo-zoom'); await loaded()"),
  scene('viewer-draft-sent', 'await openDraft(1)'),
  scene("viewer-draft-sent-files", "await openDraft(1); await __h.scroll('.ui-modal-body', 99999)"),
  scene('viewer-draft-sent-unpublished', 'await openDraft(2)')
]
