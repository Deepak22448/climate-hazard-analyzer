import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import { useEffect, useState } from 'react'
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Rectangle,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet'

import type { Analysis, Bbox, Region } from '@/types'

// NASA POWER (MERRA-2) grid spacing: every square drawn on the map is one data cell.
const CELL_LAT = 0.5
const CELL_LON = 0.625

type Props = {
  mode: Region['kind']
  region: Region
  result?: Analysis
  selectedPoint: number
  onPick: (region: Region) => void
  onSelectPoint: (index: number) => void
}

export function RegionMap({ mode, region, result, selectedPoint, onPick, onSelectPoint }: Props) {
  const headline = result && Object.values(result.metrics)[0]
  return (
    <div className="space-y-2">
      <MapContainer center={[22, 78]} zoom={4} worldCopyJump className="z-0 h-80 w-full rounded-lg">
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <ClickToPick key={mode} mode={mode} onPick={onPick} />
        <SelectedRegion region={region} />
        {result?.region.points.map((point, index) => (
          <Rectangle
            key={`${point.lat},${point.lon}`}
            bounds={[
              [point.lat - CELL_LAT / 2, point.lon - CELL_LON / 2],
              [point.lat + CELL_LAT / 2, point.lon + CELL_LON / 2],
            ]}
            pathOptions={{
              color: trendColor(point.trend_per_decade),
              weight: index === selectedPoint ? 3 : 1,
              fillOpacity: 0.45,
              bubblingMouseEvents: false, // a click on a cell shouldn't also re-pick the region
            }}
            eventHandlers={{ click: () => onSelectPoint(index) }}
          >
            <Tooltip>
              {point.lat}, {point.lon}
              <br />
              {point.trend_per_decade === null
                ? 'No trend (too few years)'
                : `${headline?.label}: ${point.trend_per_decade > 0 ? '+' : ''}${point.trend_per_decade.toFixed(1)} ${headline?.unit} per decade`}
            </Tooltip>
          </Rectangle>
        ))}
        <FitTo region={region} />
      </MapContainer>
      <p className="text-xs text-muted-foreground">
        Squares are the ~50 km data cells analysed: <span className="font-medium text-red-600">red</span>{' '}
        means the headline metric is rising, <span className="font-medium text-blue-600">blue</span> falling.
        Click one to use it for the daily view.
      </p>
    </div>
  )
}

function trendColor(trend: number | null): string {
  if (trend === null || trend === 0) return '#6b7280'
  return trend > 0 ? '#dc2626' : '#2563eb'
}

function ClickToPick({ mode, onPick }: { mode: Region['kind']; onPick: (region: Region) => void }) {
  const [corner, setCorner] = useState<L.LatLng | null>(null)
  useMapEvents({
    click(event) {
      const clicked = event.latlng.wrap()
      if (mode === 'point') {
        onPick({ kind: 'point', name: '', lat: clicked.lat, lon: clicked.lng })
      } else if (mode === 'box' && !corner) {
        setCorner(clicked)
      } else if (mode === 'box' && corner) {
        const bbox: Bbox = [
          Math.min(corner.lat, clicked.lat),
          Math.min(corner.lng, clicked.lng),
          Math.max(corner.lat, clicked.lat),
          Math.max(corner.lng, clicked.lng),
        ]
        onPick({ kind: 'box', bbox })
        setCorner(null)
      }
    },
  })
  return corner ? <CircleMarker center={corner} radius={5} /> : null
}

function SelectedRegion({ region }: { region: Region }) {
  if (region.kind === 'point') return <CircleMarker center={[region.lat, region.lon]} radius={6} />
  if (region.kind === 'box') {
    const [south, west, north, east] = region.bbox
    return (
      <Rectangle
        bounds={[
          [south, west],
          [north, east],
        ]}
        pathOptions={{ dashArray: '6', fill: false }}
      />
    )
  }
  // GeoJSON layers don't redraw when their data prop changes, so the key forces a fresh layer.
  return region.polygon ? <GeoJSON key={region.id} data={region.polygon} style={{ fill: false }} /> : null
}

function regionBounds(region: Region): L.LatLngBounds | null {
  if (region.kind === 'point') return L.latLng(region.lat, region.lon).toBounds(300_000)
  if (region.kind === 'box') {
    const [south, west, north, east] = region.bbox
    return L.latLngBounds([south, west], [north, east])
  }
  return region.polygon ? L.geoJSON(region.polygon).getBounds() : null
}

function FitTo({ region }: { region: Region }) {
  const map = useMap()
  const bounds = regionBounds(region)
  const key = bounds?.toBBoxString()
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [20, 20], maxZoom: 8 })
    // Refit only when the region itself changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return null
}
