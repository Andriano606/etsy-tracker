// The listing window (ListingModal): top, scrolled, every collapsible section opened, tips.
const openCard = "await __h.clickSel('.listing-card'); await __h.waitFor('.listing-modal'); await __h.sleep(600);"
// A listing the seller features at the top of the shop (its card has the featured badge).
const openFeatured =
  "const f = await __h.waitFor('.listing-card [data-testid=card-featured]'); f.closest('.listing-card').click(); await __h.waitFor('.listing-modal'); await __h.sleep(600);"
const section = (summary, sel) =>
  `${openCard} await __h.open(${JSON.stringify(summary)}); await __h.sleep(500); document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'start' }); await __h.sleep(300)`

module.exports = [
  { name: 'listing', code: openCard },
  { name: 'listing-scrolled', code: `${openCard} await __h.scroll('.ui-modal-body', 520)` },
  { name: 'listing-details', code: `${openCard} document.querySelector('.listing-modal [data-testid=listing-details]').scrollIntoView({ block: 'start' }); await __h.sleep(300)` },
  {
    name: 'listing-description',
    code: `${openCard} await __h.click('Показати весь опис', 'button'); document.querySelector('.listing-modal .description').scrollIntoView({ block: 'start' }); await __h.sleep(300)`
  },
  { name: 'listing-bottom', code: `${openCard} await __h.scroll('.ui-modal-body', 99999)` },
  { name: 'listing-reviews', code: section('Збережені відгуки', '.listing-modal .reviews-details') },
  { name: 'listing-prices', code: section('Ціни та акції', '.listing-modal .price-details') },
  { name: 'listing-popularity', code: section('Історія популярності', '.listing-modal .stats-details') },
  { name: 'listing-advanced', code: section('Для досвідчених: технічні дані', '.listing-modal .raw-json') },
  { name: 'listing-live', code: section('Характеристики', '.listing-modal [data-testid=listing-panel-compete-properties]') },
  { name: 'listing-tip', code: `${openCard} await __h.clickSel('.listing-modal .lm-price .ui-infotip'); await __h.sleep(300)` },
  { name: 'listing-featured', code: `${openFeatured} document.querySelector('.listing-modal .lm-stats').scrollIntoView({ block: 'center' }); await __h.sleep(300)` },
  {
    name: 'listing-keys',
    code: `${openCard} for (let i = 0; i < 3; i++) { document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await __h.sleep(150) } await __h.sleep(300)`
  },
  {
    name: 'listing-closed-sections',
    code: `${openCard} document.querySelector('.listing-modal .lm-more').scrollIntoView({ block: 'start' }); await __h.sleep(300)`
  },
  { name: 'listing-gallery-next', code: `${openCard} await __h.clickSel('.listing-modal .lm-gallery-nav.is-next'); await __h.clickSel('.listing-modal .lm-gallery-nav.is-next'); await __h.sleep(400)` }
]
