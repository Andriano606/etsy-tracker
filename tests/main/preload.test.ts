import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

// Preload and main must agree on every IPC channel name: the renderer tests use
// a stubbed window.api and ipc.test calls handlers by name, so a typo on either
// side would otherwise pass the whole suite.
const { exposed, invoked, subscribed, handlers } = vi.hoisted(() => ({
  exposed: new Map<string, Record<string, (...a: unknown[]) => unknown>>(),
  invoked: new Set<string>(),
  subscribed: new Set<string>(),
  handlers: new Set<string>()
}))
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: Record<string, (...a: unknown[]) => unknown>) =>
      exposed.set(name, api)
  },
  ipcRenderer: {
    invoke: (ch: string) => {
      invoked.add(ch)
      return Promise.resolve(undefined)
    },
    on: (ch: string) => subscribed.add(ch),
    removeListener: () => {}
  },
  ipcMain: { handle: (ch: string) => handlers.add(ch) },
  shell: { openExternal: async () => {} }
}))

import '../../src/preload/index'
import { registerIpc, type IpcContext } from '../../src/main/ipc'

const SRC = join(__dirname, '../../src')

describe('preload ↔ main IPC channels', () => {
  const api = exposed.get('api')!
  for (const [name, fn] of Object.entries(api)) {
    // Subscriptions take a callback; invokers take plain arguments.
    if (name.startsWith('on')) fn(() => {})
    else void fn(1, 'x')
  }
  registerIpc({} as IpcContext)

  it('exposes window.api with every method wired', () => {
    expect(Object.keys(api).length).toBeGreaterThan(10)
    expect(invoked.size + subscribed.size).toBe(Object.keys(api).length)
  })

  it('every channel the preload invokes has an ipcMain.handle in main', () => {
    const missing = [...invoked].filter((ch) => !handlers.has(ch))
    expect(missing).toEqual([])
  })

  it('every channel the preload subscribes to is sent by main', () => {
    const mainSrc = ['main/index.ts', 'main/ipc.ts'].map((f) => readFileSync(join(SRC, f), 'utf8')).join('\n')
    const sent = new Set([...mainSrc.matchAll(/send(?:ToRenderer)?\((?:ctx, )?'([^']+)'/g)].map((m) => m[1]))
    expect([...subscribed].filter((ch) => !sent.has(ch))).toEqual([])
  })

  it('imports nothing but electron at runtime (required by sandbox: true)', () => {
    const src = readFileSync(join(SRC, 'preload/index.ts'), 'utf8')
    const runtime = [...src.matchAll(/^import\s+(?!type\b)[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(runtime).toEqual(['electron'])
    expect(src).not.toMatch(/\brequire\(/)
    expect(readFileSync(join(SRC, 'main/index.ts'), 'utf8')).toMatch(/sandbox: true/)
  })
})
