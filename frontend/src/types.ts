// Mirrors the JSON returned by the FastAPI backend (backend/app/analysis.py).

export type Method = 'annual' | 'calendar_day'

export type Settings = {
  hazard: string
  start: number
  end: number
  percentile: number
  minDays: number
  method: Method
}

export type Bbox = [south: number, west: number, north: number, east: number]

export type Region =
  | { kind: 'point'; name: string; lat: number; lon: number }
  | { kind: 'box'; bbox: Bbox }
  // Search gives the bbox; the outline arrives with the analysis.
  | { kind: 'state'; name: string; id: string; bbox?: Bbox; polygon?: GeoJSON.Geometry }

export type HazardInfo = { id: string; label: string; params: string[] }

export type Meta = { first_year: number; last_year: number; hazards: HazardInfo[] }

export type Place = {
  id: string
  name: string
  detail: string
  lat: number
  lon: number
  bbox?: Bbox
}

export type Trend = {
  sen_per_decade: number
  mk_p: number | null
  significant: boolean
  ols_per_decade: number
  ols_ci95: [number, number]
  ols_p: number | null
  sen_line: { year: number; value: number }[]
}

export type SamplePoint = {
  lat: number
  lon: number
  threshold: [number, number]
  trend_per_decade: number | null
}

// One row per year: the hazard's metric columns plus the two extras below.
export type AnnualRow = { year: number; rolling: number | null; points_affected_pct: number | null } & Record<
  string,
  number | null
>

export type HazardEvent = { start: string; end: string; days: number; peak: number; point: number }

export type Analysis = {
  hazard: string
  params: { percentile: number; min_days: number; method: Method }
  years: [number, number]
  baseline: [number, number]
  definition: string
  variable: 'tmax' | 'precip'
  region: {
    kind: Region['kind']
    name: string
    bbox?: Bbox
    polygon?: GeoJSON.Geometry
    points: SamplePoint[]
  }
  metrics: Record<string, { label: string; unit: string }>
  annual: AnnualRow[]
  trends: Record<string, Trend | null>
  insights: string[]
  caveats: string[]
  events: HazardEvent[]
  qc: { missing_days: number; flagged_values: number; incomplete_years: number[] }
}

export type DailyDetail = {
  lat: number
  lon: number
  year: number
  variable: 'tmax' | 'precip'
  dates: string[]
  values: (number | null)[]
  threshold: (number | null)[]
  events: { start: string; end: string; days: number }[]
}
