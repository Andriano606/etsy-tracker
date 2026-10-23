import { app, BrowserWindow, Menu, net, protocol, safeStorage, shell } from 'electron'
import { join } from 'path'
import type { Quota } from '../shared/types'
import { isAllowedExternalUrl } from '../shared/externalUrl'
import { markImageMissing, markReviewImageMissing, openDb } from './db'
import { createEtsyClient } from './etsyApi'
import { IMAGE_SCHEME, createImageProtocolHandler } from './imageProtocol'
import { type ImageStore, ImageStoreError, createMinioImageStore } from './imageStore'
import { createImageSyncer } from './imageSync'
import { onReviewSyncDone, registerIpc, startImageSync, type IpcContext } from './ipc'
import { createReviewSyncer } from './reviewSync'
import { createScanner } from './scanner'
import { type MinioConfig, createBuyerCountryStore, createKeyStore, createMinioSettingsStore } from './settings'

// One fixed app name for dev and the packaged app alike: Linux safeStorage names
// its keyring secret after it ("<name> Safe Storage") and X11 uses it as WM_CLASS
// (matched by StartupWMClass in scripts/install-desktop.sh).
app.setName('etsy-tracker')
// One fixed userData dir for dev and the packaged app alike (~/.config/etsy-tracker),
// independent of productName.
app.setPath('userData', join(app.getPath('appData'), 'etsy-tracker'))

// Listing images reach the renderer as etsyimg://img/{listing_image_id}/{size}
// (imageProtocol.ts: MinIO copy, else the Etsy CDN). Must be registered before
// `ready`. `standard` gives the URLs a host/path; `secure` keeps them from being
// treated as mixed content; no fetch/CORS/service-worker privileges are needed
// for <img>.
protocol.registerSchemesAsPrivileged([
  { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true } }
])

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#1b1d23',
    title: 'Etsy Tracker',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer decodes remote images (etsystatic.com shop icons, listing
      // photos via etsyimg://) — keep Chromium's
      // process sandbox on. The preload only needs `electron` (contextBridge +
      // ipcRenderer), which a sandboxed preload supports; tests/main/preload.test.ts
      // guards that it imports nothing else at runtime.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // Never open windows; hand allowed etsy.com links to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    e.preventDefault()
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    const userData = app.getPath('userData')
    const db = openDb(join(userData, 'etsy-tracker.db'))
    const keyStore = createKeyStore(join(userData, 'settings.json'), safeStorage)
    const minio = createMinioSettingsStore(join(userData, 'settings.json'), safeStorage)
    const buyerCountry = createBuyerCountryStore(join(userData, 'settings.json'))

    let quota: Quota | null = null
    const getWindow = (): Electron.WebContents | null => mainWindow?.webContents ?? null
    const send = (channel: string, payload: unknown): void => {
      const wc = getWindow()
      if (wc && !wc.isDestroyed()) wc.send(channel, payload)
    }
    const client = createEtsyClient({
      getApiKey: () => keyStore.getKey(),
      onQuota: (q) => {
        quota = q
        send('quota:changed', q)
      }
    })
    const scanner = createScanner({
      db,
      client,
      onProgress: (p) => send('scan:progress', p),
      getBuyerCountry: () => buyerCountry.get()
    })

    // One MinIO client per distinct config; rebuilt after Settings → MinIO is saved.
    const makeStore = (cfg: MinioConfig): Promise<ImageStore> => createMinioImageStore(cfg)
    let cached: { sig: string; store: Promise<ImageStore> } | null = null
    const getStore = async (): Promise<ImageStore | null> => {
      const cfg = minio.getConfig()
      if (!cfg) {
        throw new ImageStoreError(
          'Збережений Secret key MinIO не вдалося розшифрувати — введіть його ще раз у Налаштуваннях.'
        )
      }
      if (!cfg.enabled) return null
      const sig = JSON.stringify(cfg)
      if (cached?.sig !== sig) cached = { sig, store: makeStore(cfg) }
      return cached.store
    }
    // Only https etsystatic.com URLs reach this (isEtsyCdnUrl); never route
    // them through our own etsyimg: handler or any other custom protocol.
    const cdnFetch: typeof fetch = (input, init) =>
      net.fetch(input as string, { ...init, bypassCustomProtocolHandlers: true })
    const images = createImageSyncer({
      db,
      getStore,
      fetch: cdnFetch,
      onState: (s) => send('images:progress', s)
    })
    protocol.handle(
      IMAGE_SCHEME,
      createImageProtocolHandler({
        db,
        getStore,
        fetch: cdnFetch,
        onMissing: (row) => {
          markImageMissing(db, row)
          void images.sync({ shopId: row.shop_id }).catch(() => undefined)
        },
        onReviewMissing: (row) => {
          markReviewImageMissing(db, row.id)
          void images.sync({ shopId: row.shop_id }).catch(() => undefined)
        }
      })
    )

    // Reviews of the whole shop, after each ok scan (ipc.ts) or on demand;
    // resumable and capped per run (reviewSync.ts).
    let ctxRef: IpcContext | null = null
    const reviews = createReviewSyncer({
      db,
      client,
      getQuota: () => quota,
      onState: (s) => send('reviews:progress', s),
      onDone: (s) => {
        if (ctxRef) onReviewSyncDone(ctxRef, s)
      }
    })

    const ctx: IpcContext = {
      db,
      keyStore,
      client,
      scanner,
      getQuota: () => quota,
      getWindow,
      minio,
      images,
      makeStore,
      onMinioChanged: () => {
        cached = null
      },
      reviews,
      buyerCountry
    }
    ctxRef = ctx
    registerIpc(ctx)
    createWindow()
    // Images left 'pending' (MinIO was down, the app quit mid-sync, or rows
    // backfilled by migration v2) are retried shortly after start.
    setTimeout(() => startImageSync(ctx, null), 5000)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
    app.on('will-quit', () => {
      try {
        db.close()
      } catch {
        // already closed
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
