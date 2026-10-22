import { useState } from 'react'

/** Shop icon from Etsy's CDN, or its initial on a tint when missing/broken. */
export function ShopIcon({
  url,
  name,
  size = 28
}: {
  url: string | null
  name: string
  size?: number
}): JSX.Element {
  const [broken, setBroken] = useState(false)
  if (url && !broken) {
    return (
      <img
        className="shop-icon"
        src={url}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    )
  }
  return (
    <span className="shop-icon initial" style={{ width: size, height: size }}>
      {(name[0] ?? '?').toUpperCase()}
    </span>
  )
}
