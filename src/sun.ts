import type { Feature, Polygon } from 'geojson'

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/**
 * Where the sun is overhead at a given moment: [longitude, latitude] in degrees. NOAA's low-precision formulas
 * (declination and equation of time), good to a fraction of a degree, far below what the map can show.
 */
export function subsolarPoint(date: Date): [number, number] {
  const day = (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000
  const g = (2 * Math.PI * day) / 365 // fractional year, radians
  const eqTime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g)
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60
  const lon = -((minutes + eqTime) / 4 - 180)
  return [((((lon + 180) % 360) + 360) % 360) - 180, decl * DEG]
}

/**
 * The night side as one polygon: the terminator (where the sun is on the horizon) sampled every `step` degrees
 * of longitude, closed over the pole that is in darkness.
 */
export function nightPolygon(date: Date, step = 2): Feature<Polygon> {
  const [sunLon, sunLat] = subsolarPoint(date)
  // At the equinoxes the terminator runs through the poles; keep the tangent finite.
  const decl = (Math.abs(sunLat) < 0.01 ? (sunLat < 0 ? -0.01 : 0.01) : sunLat) * RAD
  const ring: [number, number][] = []
  for (let lon = -180; lon <= 180; lon += step) {
    const lat = Math.atan(-Math.cos((lon - sunLon) * RAD) / Math.tan(decl)) * DEG
    ring.push([lon, lat])
  }
  // Southern summer (sun below the equator): the north pole is dark, and vice versa.
  const pole = decl > 0 ? -90 : 90
  ring.push([180, pole], [-180, pole], ring[0])
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
}

/** True when the sun is below the horizon at a point (used by the tests and the local-time labels). */
export function isNight(date: Date, lon: number, lat: number): boolean {
  const [sunLon, sunLat] = subsolarPoint(date)
  const cosZenith =
    Math.sin(lat * RAD) * Math.sin(sunLat * RAD) +
    Math.cos(lat * RAD) * Math.cos(sunLat * RAD) * Math.cos((lon - sunLon) * RAD)
  return cosZenith < 0
}
