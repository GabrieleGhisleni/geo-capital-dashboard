import { flagUrl, type Dataset } from '../data'
import { formatMetric, formatNumber, formatShare, metricValue } from '../scale'
import type { Country, HoverTarget, Metric } from '../types'
import { localTime } from '../time'
import { METRIC_BY_ID } from '../views'

type Props = {
  data: Dataset
  hover: { target: HoverTarget; x: number; y: number }
  metric: Metric
  /** Timeline year and values: the country's value for that year gets its own row. */
  year?: number | null
  yearValues?: Record<string, number | null> | null
  now: Date
  /** Phones: a card opened by a tap, full width, above or below the tapped point, with a close button. */
  pinned?: boolean
  onClose?: () => void
}

/** "Abitanti" with the share of the country's population, e.g. "2.748.109 · 4,7%". */
function withShare(value: number | null | undefined, whole: number | null | undefined): string {
  const share = formatShare(value, whole)
  return share ? `${formatNumber(value)} · ${share}` : formatNumber(value)
}

const year = (y: number | null | undefined) => (y ? ` (${y})` : '')

/** Metrics with their own row only while they color the map (the core ones are always listed). */
const ON_DEMAND: Partial<Record<Metric, (c: Country) => number | null>> = {
  gdpPerCapitaPpp: (c) => c.gdpPerCapitaPppYear,
  elderlyShare: (c) => c.elderlyShareYear,
  fertility: (c) => c.fertilityYear,
  urbanShare: (c) => c.urbanShareYear,
  co2PerCapita: (c) => c.co2PerCapitaYear,
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="tt-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

type BodyProps = Pick<Props, 'data' | 'metric' | 'year' | 'yearValues' | 'now'> & { target: HoverTarget }

function Body({ data, target, metric, year: timelineYear, yearValues, now }: BodyProps) {
  switch (target.kind) {
    case 'country': {
      const c = data.countries[target.id]
      if (!c) return null
      const top = (data.citiesByCountry[c.id] ?? []).slice(0, 4)
      return (
        <>
          <div className="tt-title">
            {flagUrl(c) && <img className="flag tt-flag" src={flagUrl(c)!} alt="" />}
            {c.name}
          </div>
          {c.capitals.length > 0 && <div className="tt-sub">Capitale: {c.capitals.map((x) => x.name).join(' / ')}</div>}
          {timelineYear != null && yearValues && (
            <Row
              label={`${METRIC_BY_ID[metric].label} (${timelineYear})`}
              value={formatMetric(yearValues[c.id] ?? null, metric)}
            />
          )}
          <Row label={`Popolazione${c.populationYear ? ` (${c.populationYear})` : ''}`} value={formatNumber(c.population)} />
          <Row label="Superficie" value={formatMetric(c.area, 'area')} />
          <Row label="Densità" value={formatMetric(metricValue(c, 'density'), 'density')} />
          {c.capitals[0]?.timezone && localTime(c.capitals[0].timezone, now) && (
            <Row label="Ora locale (capitale)" value={localTime(c.capitals[0].timezone, now)!} />
          )}
          <Row label={`Aspettativa di vita${year(c.lifeExpectancyYear)}`} value={formatMetric(c.lifeExpectancy, 'lifeExpectancy')} />
          {(metric === 'gdp' || metric === 'gdpPerCapita') && (
            <>
              <Row label={`PIL${c.gdpYear ? ` (${c.gdpYear})` : ''}`} value={formatMetric(c.gdp, 'gdp')} />
              <Row label="PIL pro capite" value={formatMetric(c.gdpPerCapita, 'gdpPerCapita')} />
            </>
          )}
          {ON_DEMAND[metric] && (
            <Row
              label={`${METRIC_BY_ID[metric].label}${year(ON_DEMAND[metric](c))}`}
              value={formatMetric(metricValue(c, metric), metric)}
            />
          )}
          {top.length > 0 && (
            <div className="tt-cities">
              <span className="tt-label">Città principali · % Stato</span>
              {top.map((city) => (
                <div key={city.name} className="tt-row">
                  <span>{city.name}</span>
                  <span>{withShare(city.population, c.population)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )
    }
    case 'region': {
      const r = target.region
      const country = data.countries[r.countryId]
      return (
        <>
          <div className="tt-title">{r.name}</div>
          {r.type && <div className="tt-sub">{r.type}</div>}
          {r.capName && <Row label="Capoluogo" value={r.capName} />}
          <Row label={`Popolazione${year(r.populationYear)}`} value={formatNumber(r.population)} />
          {formatShare(r.population, country?.population) && (
            <Row label="Quota dello Stato" value={formatShare(r.population, country!.population)!} />
          )}
          <Row label="Superficie" value={formatMetric(r.area, 'area')} />
          <Row label="Densità" value={formatMetric(metricValue(r, 'density'), 'density')} />
          {r.gdpPerCapita != null && (
            <Row label={`PIL pro capite${year(r.gdpYear)}`} value={formatMetric(r.gdpPerCapita, 'gdpPerCapita')} />
          )}
          {r.gdp != null && metric === 'gdp' && <Row label="PIL" value={formatMetric(r.gdp, 'gdp')} />}
          {r.lifeExpectancy != null && (
            <Row label={`Aspettativa di vita${year(r.lifeExpectancyYear)}`} value={formatMetric(r.lifeExpectancy, 'lifeExpectancy')} />
          )}
        </>
      )
    }
    case 'region-capital': {
      const r = target.region
      const country = data.countries[r.countryId]
      return (
        <>
          <div className="tt-title">{r.capName}</div>
          <div className="tt-sub">Capoluogo · {r.name}</div>
          <Row label="Abitanti · % Stato" value={withShare(r.capPop, country?.population)} />
          {formatShare(r.capPop, r.population) && <Row label="Quota della regione" value={formatShare(r.capPop, r.population)!} />}
        </>
      )
    }
    case 'capital': {
      const country = data.countries[target.countryId]
      return (
        <>
          <div className="tt-title">{target.capital.name}</div>
          <div className="tt-sub">Capitale · {country?.name}</div>
          <Row label="Abitanti · % Stato" value={withShare(target.capital.population, country?.population)} />
          {target.capital.timezone && localTime(target.capital.timezone, now) && (
            <Row label="Ora locale" value={localTime(target.capital.timezone, now)!} />
          )}
        </>
      )
    }
    case 'city': {
      const country = data.countries[target.city.countryId]
      return (
        <>
          <div className="tt-title">{target.city.name}</div>
          <div className="tt-sub">Città · {country?.name}</div>
          <Row label="Abitanti · % Stato" value={withShare(target.city.population, country?.population)} />
        </>
      )
    }
  }
}

export function Tooltip({ data, hover, metric, pinned, onClose, year, yearValues, now }: Props) {
  const body = <Body data={data} target={hover.target} metric={metric} year={year} yearValues={yearValues} now={now} />
  if (pinned) {
    const below = hover.y < window.innerHeight / 2
    const style = below ? { top: hover.y + 16 } : { bottom: window.innerHeight - hover.y + 16 }
    return (
      <div className="tooltip tooltip-pinned" style={style} role="dialog" aria-label="Dettagli">
        <button type="button" className="tt-close" onClick={onClose} aria-label="Chiudi">
          ×
        </button>
        {body}
      </div>
    )
  }
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
      {body}
    </div>
  )
}
