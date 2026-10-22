import { app, BrowserWindow, Menu, safeStorage, shell } from 'electron'
import { join } from 'path'
import type { Quota } from '../shared/types'
import { isAllowedExternalUrl } from '../shared/externalUrl'
import { openDb } from './db'
import { createEtsyClient } from './etsyApi'
import { registerIpc, type IpcContext } from './ipc'
import { createScanner } from './scanner'
import { createKeyStore } from './settings'

// One fixed app name for dev and the packaged app alike: Linux safeStorage names
// its keyring secret after it ("<name> Safe Storage") and X11 uses it as WM_CLASS
// (matched by StartupWMClass in scripts/install-desktop.sh).
app.setName('etsy-tracker')
// One fixed userData dir for dev and the packaged app alike (~/.config/etsy-tracker),
// independent of productName.
app.setPath('userData', join(app.getPath('appData'), 'etsy-tracker'))

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
      // The renderer decodes remote (etsystatic.com) images — keep Chromium's
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
    const scanner = createScanner({ db, client, onProgress: (p) => send('scan:progress', p) })
    const ctx: IpcContext = { db, keyStore, client, scanner, getQuota: () => quota, getWindow }
    registerIpc(ctx)
    createWindow()

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
