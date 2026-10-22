import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// Self-hosted IBM Plex (CSP-safe — bundled woff2, no Google Fonts fetch). The
// design's UI sans / mono. Weights: Sans 400/500/600, Mono 400/500.
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
