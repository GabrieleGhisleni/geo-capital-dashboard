import { useState } from 'react'
import { formatMetric, formatMetricCompact, positionOn, rampGradient, type Scale } from '../scale'
import type { Metric } from '../types'
import { METRIC_BY_ID } from '../views'

type Props = {
  scale: Scale | null
  metric: Metric
  /** What the colors refer to, e.g. "Europa" or "Regioni · Italia". */
  scope: string
  /** Value under the cursor, marked on the bar. */
  hoverValue: number | null
  note?: string
}

const STORAGE_KEY = 'legend-collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function Legend({ scale, metric, scope, hoverValue, note }: Props) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  if (metric === 'none' || !scale) return null
  const info = METRIC_BY_ID[metric]
  const toggle = () => {
    setCollapsed(!collapsed)
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '0' : '1')
    } catch {
      // Private mode: the preference just isn't remembered.
    }
  }
  const pct = (v: number) => `${(positionOn(v, scale) * 100).toFixed(2)}%`

  return (
    <section className={`legend${collapsed ? ' legend-collapsed' : ''}`} aria-label="Legenda">
      <button type="button" className="legend-head" onClick={toggle} aria-expanded={!collapsed}>
        <span className="legend-title">{info.label}</span>
        <span className="legend-scope">{scope}</span>
        <span className="legend-chevron" aria-hidden>
          {collapsed ? '▸' : '▾'}
        </span>
      </button>
      <div className="legend-bar-wrap">
        <div className="legend-bar" style={{ background: rampGradient(scale.ramp) }}>
          {hoverValue != null && (
            <span className="legend-marker" style={{ left: pct(hoverValue) }} title={formatMetric(hoverValue, metric)} />
          )}
        </div>
        {!collapsed && (
          <div className="legend-ticks" aria-hidden>
            {scale.ticks.map((t) => (
              <span key={t} style={{ left: pct(t) }}>
                {formatMetricCompact(t, metric)}
              </span>
            ))}
          </div>
        )}
      </div>
      {!collapsed && (
        <p className="legend-foot">
          <span className="legend-nodata" /> n.d.
          <span className="legend-hint">
            {hoverValue != null ? formatMetric(hoverValue, metric) : note ?? (scale.kind === 'log' ? 'scala logaritmica' : 'scala lineare')}
          </span>
        </p>
      )}
    </section>
  )
}
