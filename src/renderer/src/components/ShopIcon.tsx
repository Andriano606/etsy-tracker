import { useState } from 'react'
import { useStore } from '../store'
import { Icon } from '../ui'

/**
 * Shop icon from Etsy's CDN, or its initial on a tint when missing/broken.
 * `zoomable` (the shop header): the icon is a button that opens it full size in
 * the image viewer (the URL is the CDN's fullxfull). Never zoomable inside
 * another button (the sidebar's shop items).
 */
export function ShopIcon({
  url,
  name,
  size = 28,
  zoomable = false
}: {
  url: string | null
  name: string
  size?: number
  zoomable?: boolean
}): JSX.Element {
  const [broken, setBroken] = useState(false)
  const openImage = useStore((s) => s.openImage)
  if (url && !broken) {
    const img = (
      <img
        className="shop-icon"
        src={url}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        decoding="async"
        onError={() => setBroken(true)}
      />
    )
    if (!zoomable) return img
    const label = `Відкрити логотип магазину ${name} на весь розмір`
    return (
      <button
        type="button"
        className="ui-zoom shop-icon-zoom"
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation()
          openImage({ src: url, alt: `Логотип магазину ${name}`, caption: name })
        }}
      >
        {img}
        <span className="ui-zoom-badge" aria-hidden="true">
          <Icon name="zoom-in" size={12} />
        </span>
      </button>
    )
  }
  return (
    <span className="shop-icon initial" style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }} aria-hidden="true">
      {(name[0] ?? '?').toUpperCase()}
    </span>
  )
}
