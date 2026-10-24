// UI harness: renders the BUILT renderer (out/renderer) with a fake window.api
// over .ui-harness/fixtures.json and screenshots scenes at several window sizes
// into .ui-harness/shots/<scene>@<w>x<h>.png. No real main process, no Etsy calls.
//
//   npm run build && npx electron scripts/ui-harness/main.cjs --no-sandbox --disable-gpu \
//     [--scenes=a,b] [--sizes=900x560,1280x820] [--signed-out] [--out=out] [--shots=.ui-harness/shots]
//   A parallel build of your own: UIH_OUT=.ui-harness/build-x node_modules/.bin/electron-vite build
//   then --out=.ui-harness/build-x --shots=.ui-harness/shots-x
//
// Listing photos come from the CDN URLs in the fixtures (cached in .ui-harness/img-cache).

const { app, BrowserWindow, protocol, net } = require('electron')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const OUT = path.join(ROOT, '.ui-harness')
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1]
const sizes = arg('sizes', '900x560,1280x820,1680x1050').split(',').map((s) => s.split('x').map(Number))
const only = arg('scenes', '')
const BUILD = path.resolve(ROOT, arg('out', 'out'))
const SHOTS = path.resolve(ROOT, arg('shots', '.ui-harness/shots'))
// Every scenes/*.cjs file (one per UI area) exports an array of {name, code}.
const scenes = fs
  .readdirSync(path.join(__dirname, 'scenes'))
  .filter((f) => f.endsWith('.cjs'))
  .sort()
  .flatMap((f) => require(path.join(__dirname, 'scenes', f)))
  .filter((s) => !only || only.split(',').includes(s.name))
process.env.UIH_FIXTURES = path.join(OUT, 'fixtures.json')
if (process.argv.includes('--signed-out')) process.env.UIH_SIGNED_OUT = '1'
const fx = JSON.parse(fs.readFileSync(process.env.UIH_FIXTURES, 'utf8'))
const helpers = fs.readFileSync(path.join(__dirname, 'helpers.js'), 'utf8')

app.setPath('userData', path.join(OUT, 'userdata'))
app.commandLine.appendSwitch('no-sandbox')
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')
protocol.registerSchemesAsPrivileged([{ scheme: 'etsyimg', privileges: { standard: true, secure: true } }])

async function image(req) {
  const u = new URL(req.url)
  const m = u.pathname.match(/^\/(\d+)\/([\w]+)$/)
  if (u.hostname !== 'img' || !m) return new Response(null, { status: 404 })
  const url = fx.images[m[1]]?.[m[2]] ?? fx.images[m[1]]?.['570xN']
  if (!url) return new Response(null, { status: 404 })
  const cache = path.join(OUT, 'img-cache', `${m[1]}-${m[2]}`)
  if (fs.existsSync(cache)) return new Response(fs.readFileSync(cache), { headers: { 'content-type': 'image/jpeg' } })
  try {
    const res = await net.fetch(url, { headers: { accept: 'image/jpeg,image/png,image/*' } })
    const buf = Buffer.from(await res.arrayBuffer())
    fs.mkdirSync(path.dirname(cache), { recursive: true })
    fs.writeFileSync(cache, buf)
    return new Response(buf, { headers: { 'content-type': res.headers.get('content-type') ?? 'image/jpeg' } })
  } catch {
    return new Response(null, { status: 502 })
  }
}

app.whenReady().then(async () => {
  protocol.handle('etsyimg', image)
  fs.mkdirSync(SHOTS, { recursive: true })
  const win = new BrowserWindow({
    show: false,
    width: sizes[0][0],
    height: sizes[0][1],
    useContentSize: true,
    backgroundColor: '#1b1d23',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: false, contextIsolation: true, offscreen: true }
  })
  win.webContents.setFrameRate(30)
  const failures = []
  for (const [w, h] of sizes) {
    win.setContentSize(w, h)
    for (const s of scenes) {
      if (process.env.UIH_DEBUG) console.log('load', s.name, w, h)
      await win.webContents.session.clearStorageData({ storages: ['localstorage'] })
      await win.loadFile(path.join(BUILD, 'renderer/index.html'))
      await new Promise((r) => setTimeout(r, 900))
      try {
        await win.webContents.executeJavaScript(`${helpers}\n;(async () => { ${s.code} })()`)
        await new Promise((r) => setTimeout(r, 700))
      } catch (e) {
        failures.push(`${s.name}@${w}x${h}: ${e.message}`)
      }
      const img = await win.webContents.capturePage()
      const file = path.join(SHOTS, `${s.name}@${w}x${h}.png`)
      fs.writeFileSync(file, img.toPNG())
      // Layout problems the eye might miss: horizontal overflow of the page or a modal.
      const overflow = await win.webContents.executeJavaScript(`(() => {
        const out = []
        const vw = document.documentElement.clientWidth
        for (const el of document.querySelectorAll('button, .btn, input, select, textarea, .modal, .shop-header, .shop-actions *'))
          { const r = el.getBoundingClientRect(); if (r.width && (r.right > vw + 1 || r.left < -1)) out.push((el.className || el.tagName) + ' ' + (el.textContent||'').trim().slice(0,30)) }
        const se = document.scrollingElement; if (se.scrollWidth > se.clientWidth + 1) out.push('page scrolls horizontally')
        return out.slice(0, 10)
      })()`)
      console.log(`${path.relative(ROOT, file)}${overflow.length ? '  ⚠ overflow: ' + overflow.join(' | ') : ''}`)
    }
  }
  if (failures.length) console.log('SCENE ERRORS:\n' + failures.join('\n'))
  app.quit()
})
