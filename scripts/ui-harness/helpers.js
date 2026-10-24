// Injected into the page before every scene: tiny DOM helpers for scenes.
window.__h = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  /** The first visible element whose trimmed text equals `text` (else contains it), optionally within `root`. */
  find(text, sel = 'button, [role=tab], a, summary, label, [role=option], li, h1, h2, h3, span, div', root = document) {
    const all = [...root.querySelectorAll(sel)].filter((e) => e.offsetParent !== null || e.tagName === 'SUMMARY')
    return all.find((e) => e.textContent.trim() === text) ?? all.find((e) => e.textContent.trim().startsWith(text)) ?? all.find((e) => e.textContent.includes(text)) ?? null
  },
  async click(text, sel) {
    const el = typeof text === 'string' ? this.find(text, sel) : text
    if (!el) throw new Error(`no element with text: ${text}`)
    el.click()
    await this.sleep(350)
  },
  /** Wait until `selector` matches (data loads asynchronously). */
  async waitFor(selector, timeout = 4000) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const el = document.querySelector(selector)
      if (el) return el
      await this.sleep(100)
    }
    throw new Error(`timed out waiting for ${selector}`)
  },
  async clickSel(selector) {
    await this.waitFor(selector).catch(() => null)
    const el = document.querySelector(selector)
    if (!el) throw new Error(`no element: ${selector}`)
    el.click()
    await this.sleep(350)
  },
  /** Open a <details> by its summary text (fires toggle like a click would). */
  async open(summaryText) {
    const s = this.find(summaryText, 'summary')
    if (!s) throw new Error(`no summary: ${summaryText}`)
    s.parentElement.open = true
    await this.sleep(500)
  },
  /** Type into the control a label points to. */
  async type(labelText, value) {
    const l = this.find(labelText, 'label')
    const el = (l && (l.control ?? document.getElementById(l.htmlFor))) || null
    if (!el) throw new Error(`no field: ${labelText}`)
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await this.sleep(250)
  },
  async scroll(selector, y) {
    const el = document.querySelector(selector)
    if (el) el.scrollTop = y
    await this.sleep(200)
  }
}
