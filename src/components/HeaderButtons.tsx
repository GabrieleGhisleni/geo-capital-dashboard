import { useEffect, useState } from 'react'
import type { Theme } from '../useTheme'

/** Shares the current address (the page state lives in its hash): the system sheet on phones, else the clipboard. */
export function ShareButton({ title, label }: { title: string; label: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(id)
  }, [copied])
  const share = async () => {
    const url = window.location.href
    if (navigator.share && window.matchMedia('(hover: none)').matches) {
      await navigator.share({ title: document.title, url }).catch(() => undefined) // dismissed: nothing to do
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      window.prompt('Copia il link:', url) // clipboard blocked (insecure origin, permissions)
    }
  }
  return (
    <button
      type="button"
      className={`icon-button share-button${copied ? ' is-done' : ''}`}
      onClick={share}
      title={title}
      aria-label={copied ? 'Link copiato' : label}
    >
      {copied ? (
        '✓'
      ) : (
        <svg viewBox="0 0 20 20" aria-hidden>
          <path
            d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      )}
      <span className="share-toast" aria-live="polite">
        {copied ? 'Link copiato' : ''}
      </span>
    </button>
  )
}

export function ThemeButton({ theme, onTheme }: { theme: Theme; onTheme: (t: Theme) => void }) {
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      className="icon-button"
      onClick={() => onTheme(dark ? 'light' : 'dark')}
      aria-pressed={dark}
      title={dark ? 'Tema chiaro' : 'Tema scuro'}
      aria-label="Tema scuro"
    >
      <svg viewBox="0 0 20 20" aria-hidden>
        {dark ? (
          <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <circle cx="10" cy="10" r="3.4" />
            <path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3 6 14M14 6l1.3-1.3" />
          </g>
        ) : (
          <path
            d="M16 12.2A6.5 6.5 0 0 1 7.8 4a6.5 6.5 0 1 0 8.2 8.2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </button>
  )
}
