import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const query = '(prefers-color-scheme: dark)'

/** Follows the OS color scheme. */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => (window.matchMedia(query).matches ? 'dark' : 'light'))
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setTheme(mql.matches ? 'dark' : 'light')
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return theme
}
