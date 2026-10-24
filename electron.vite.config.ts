import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// UI harness builds (scripts/ui-harness): UIH_OUT=<dir> puts main/preload/renderer
// under <dir>/ instead of out/, so parallel builds don't clash.
const harnessOut = (part: string): { outDir?: string } =>
  process.env.UIH_OUT ? { outDir: resolve(__dirname, process.env.UIH_OUT, part) } : {}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      ...harnessOut('main'),
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      ...harnessOut('preload'),
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      ...harnessOut('renderer'),
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    plugins: [react()]
  }
})
