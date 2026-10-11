import { useQuery } from '@tanstack/react-query'

import type { Analysis, DailyDetail, Meta, Method, Place, Region, Settings } from '@/types'

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { signal })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(errorMessage(body, response.status))
  return body as T
}

// FastAPI puts a string or a list of validation errors in `detail`;
// the rate limiter puts its message in `error`.
function errorMessage(body: any, status: number): string {
  if (typeof body?.detail === 'string') return body.detail
  if (Array.isArray(body?.detail)) {
    return body.detail.map((e: { msg: string }) => e.msg.replace(/^Value error, /, '')).join('; ')
  }
  if (status === 429) return 'Too many requests. Wait a minute and try again.'
  return `Request failed (${status})`
}

// The page URL and the API query use the same parameters, so any analysis
// can be shared as a link and reloads to exactly the same request.
export function toQueryString(region: Region, settings: Settings): string {
  const params = new URLSearchParams({
    hazard: settings.hazard,
    start: String(settings.start),
    end: String(settings.end),
    percentile: String(settings.percentile),
    min_days: String(settings.minDays),
    method: settings.method,
  })
  if (region.kind === 'point') {
    params.set('lat', region.lat.toFixed(4))
    params.set('lon', region.lon.toFixed(4))
    params.set('name', region.name)
  } else if (region.kind === 'box') {
    params.set('bbox', region.bbox.map((v) => v.toFixed(3)).join(','))
  } else {
    params.set('state', region.id)
    params.set('name', region.name)
  }
  return params.toString()
}

export function fromQueryString(search: string, defaults: { region: Region; settings: Settings }) {
  const params = new URLSearchParams(search)
  const number = (key: string, fallback: number) => (params.has(key) ? Number(params.get(key)) : fallback)
  const name = params.get('name') ?? ''

  let region = defaults.region
  if (params.has('lat') && params.has('lon')) {
    region = { kind: 'point', name, lat: number('lat', 0), lon: number('lon', 0) }
  } else if (params.has('bbox')) {
    const corners = params.get('bbox')!.split(',').map(Number)
    // A hand-edited link could carry a broken box; fall back to the default instead of crashing.
    if (corners.length === 4 && corners.every(Number.isFinite)) {
      const [south, west, north, east] = corners
      region = { kind: 'box', bbox: [south, west, north, east] }
    }
  } else if (params.has('state')) {
    region = { kind: 'state', name, id: params.get('state')! }
  }

  const settings: Settings = {
    hazard: params.get('hazard') ?? defaults.settings.hazard,
    start: number('start', defaults.settings.start),
    end: number('end', defaults.settings.end),
    percentile: number('percentile', defaults.settings.percentile),
    minDays: number('min_days', defaults.settings.minDays),
    method: (params.get('method') as Method | null) ?? defaults.settings.method,
  }
  return { region, settings }
}

export function describeRegion(region: Region): string {
  if (region.kind === 'box') {
    const [south, west, north, east] = region.bbox
    return `Box ${south.toFixed(1)}…${north.toFixed(1)}°N, ${west.toFixed(1)}…${east.toFixed(1)}°E`
  }
  if (region.kind === 'point' && !region.name) return `${region.lat.toFixed(2)}, ${region.lon.toFixed(2)}`
  return region.name
}

export const csvUrl = (query: string) => `${API_URL}/api/analysis.csv?${query}`

export function useMeta() {
  return useQuery({
    queryKey: ['meta'],
    queryFn: ({ signal }) => getJson<Meta>('/api/meta', signal),
    staleTime: Infinity,
  })
}

export function usePlaces(text: string, kind: 'city' | 'state') {
  return useQuery({
    queryKey: ['places', kind, text],
    queryFn: ({ signal }) =>
      getJson<Place[]>(`/api/places?${new URLSearchParams({ q: text, kind })}`, signal),
    enabled: text.length >= 2,
    staleTime: Infinity,
  })
}

export function useAnalysis(query: string) {
  return useQuery({
    queryKey: ['analysis', query],
    queryFn: ({ signal }) => getJson<Analysis>(`/api/analysis?${query}`, signal),
    staleTime: 60 * 60 * 1000,
  })
}

export function useDaily(analysis: Analysis | undefined, pointIndex: number, year: number | null) {
  const point = analysis?.region.points[pointIndex]
  const params =
    analysis && point && year
      ? new URLSearchParams({
          hazard: analysis.hazard,
          lat: String(point.lat),
          lon: String(point.lon),
          year: String(year),
          percentile: String(analysis.params.percentile),
          min_days: String(analysis.params.min_days),
          method: analysis.params.method,
        })
      : null
  return useQuery({
    queryKey: ['daily', params?.toString()],
    queryFn: ({ signal }) => getJson<DailyDetail>(`/api/daily?${params}`, signal),
    enabled: params !== null,
    staleTime: Infinity,
  })
}
