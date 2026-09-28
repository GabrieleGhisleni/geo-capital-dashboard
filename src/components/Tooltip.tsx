import type { Dataset } from '../data'
import { formatMetric, formatNumber, metricValue } from '../scale'
import type { HoverTarget } from '../types'

type Props = {
  data: Dataset
  hover: { target: HoverTarget; x: number; y: number }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="tt-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function Body({ data, target }: { data: Dataset; target: HoverTarget }) {
  switch (target.kind) {
    case 'country': {
      const c = data.countries[target.id]
      if (!c) return null
      const top = (data.citiesByCountry[c.id] ?? []).slice(0, 4)
      return (
        <>
          <div className="tt-title">{c.name}</div>
          {c.capitals.length > 0 && <div className="tt-sub">Capitale: {c.capitals.map((x) => x.name).join(' / ')}</div>}
          <Row label={`Popolazione${c.populationYear ? ` (${c.populationYear})` : ''}`} value={formatNumber(c.population)} />
          <Row label="Superficie" value={formatMetric(c.area, 'area')} />
          <Row label="Densità" value={formatMetric(metricValue(c, 'density'), 'density')} />
          {top.length > 0 && (
            <div className="tt-cities">
              <span className="tt-label">Città principali</span>
              {top.map((city) => (
                <div key={city.name} className="tt-row">
                  <span>{city.name}</span>
                  <span>{formatNumber(city.population)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )
    }
    case 'region': {
      const r = target.region
      return (
        <>
          <div className="tt-title">{r.name}</div>
          {r.type && <div className="tt-sub">{r.type}</div>}
          {r.capName && <Row label="Capoluogo" value={r.capName} />}
          <Row label={`Popolazione${r.populationYear ? ` (${r.populationYear})` : ''}`} value={formatNumber(r.population)} />
          <Row label="Superficie" value={formatMetric(r.area, 'area')} />
          <Row label="Densità" value={formatMetric(metricValue(r, 'density'), 'density')} />
        </>
      )
    }
    case 'region-capital': {
      const r = target.region
      return (
        <>
          <div className="tt-title">{r.capName}</div>
          <div className="tt-sub">Capoluogo · {r.name}</div>
          <Row label="Abitanti" value={formatNumber(r.capPop)} />
        </>
      )
    }
    case 'capital': {
      const country = data.countries[target.countryId]
      return (
        <>
          <div className="tt-title">{target.capital.name}</div>
          <div className="tt-sub">Capitale · {country?.name}</div>
          <Row label="Abitanti" value={formatNumber(target.capital.population)} />
        </>
      )
    }
    case 'city': {
      const country = data.countries[target.city.countryId]
      return (
        <>
          <div className="tt-title">{target.city.name}</div>
          <div className="tt-sub">Città · {country?.name}</div>
          <Row label="Abitanti" value={formatNumber(target.city.population)} />
        </>
      )
    }
  }
}

export function Tooltip({ data, hover }: Props) {
  const flipX = hover.x > window.innerWidth - 300
  const flipY = hover.y > window.innerHeight - 280
  const style = {
    left: flipX ? undefined : hover.x + 14,
    right: flipX ? window.innerWidth - hover.x + 14 : undefined,
    top: flipY ? undefined : hover.y + 14,
    bottom: flipY ? window.innerHeight - hover.y + 14 : undefined,
  }
  return (
    <div className="tooltip" style={style} role="tooltip">
      <Body data={data} target={hover.target} />
    </div>
  )
}
