import { useState } from 'react'

import { describeRegion, fromQueryString, toQueryString, useAnalysis, useMeta } from '@/api'
import { DailyChart, HeadlineChart, MetricChart } from '@/components/Charts'
import { Controls } from '@/components/Controls'
import { RegionMap } from '@/components/RegionMap'
import { Summary } from '@/components/Summary'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import type { Meta, Region, Settings } from '@/types'

const DEFAULT_REGION: Region = { kind: 'point', name: 'New Delhi', lat: 28.6139, lon: 77.209 }

export default function App() {
  const meta = useMeta()
  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <h1 className="text-xl font-semibold">Climate Hazard Trend Analyzer</h1>
          <p className="text-sm text-muted-foreground">
            How heatwaves, heavy rain and dry spells have changed since 1981, from NASA POWER daily data.
          </p>
        </div>
      </header>
      {meta.isPending && <Skeleton className="mx-auto mt-4 h-96 max-w-7xl" />}
      {meta.isError && (
        <Alert variant="destructive" className="mx-auto mt-4 max-w-xl">
          <AlertTitle>Can't reach the API</AlertTitle>
          <AlertDescription>
            {meta.error.message}. The free server sleeps when idle; wait 30–60 seconds and refresh.
          </AlertDescription>
        </Alert>
      )}
      {meta.data && <Dashboard meta={meta.data} />}
    </div>
  )
}

function Dashboard({ meta }: { meta: Meta }) {
  const defaults = {
    region: DEFAULT_REGION,
    settings: {
      hazard: 'heatwave',
      start: meta.first_year,
      end: meta.last_year,
      percentile: 95,
      minDays: 3,
      method: 'annual',
    } satisfies Settings,
  }
  const [initial] = useState(() => fromQueryString(window.location.search, defaults))
  const [mode, setMode] = useState<Region['kind']>(initial.region.kind)
  const [region, setRegion] = useState<Region>(initial.region)
  const [settings, setSettings] = useState<Settings>(initial.settings)
  // The form can change freely; only "Analyse" turns it into a request.
  const [query, setQuery] = useState(() => toQueryString(initial.region, initial.settings))
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [selectedPoint, setSelectedPoint] = useState(0)

  const analysis = useAnalysis(query)
  const result = analysis.data
  const submitted = fromQueryString(query, defaults)
  const hazardLabel = meta.hazards.find((h) => h.id === submitted.settings.hazard)?.label ?? ''

  // A state opened from a shared link has no outline until the analysis returns one.
  const regionOnMap: Region =
    region.kind === 'state' && !region.polygon && result?.region.kind === 'state'
      ? { ...region, polygon: result.region.polygon }
      : region

  function analyse() {
    const next = toQueryString(region, settings)
    window.history.replaceState(null, '', `?${next}`)
    setQuery(next)
    setSelectedYear(null)
    setSelectedPoint(0)
  }

  return (
    <main className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[340px_1fr]">
      <aside className="space-y-4 print:hidden">
        <Controls
          meta={meta}
          mode={mode}
          onModeChange={setMode}
          region={region}
          onRegionChange={setRegion}
          settings={settings}
          onSettingsChange={setSettings}
          onAnalyze={analyse}
          busy={analysis.isFetching}
        />
      </aside>

      <section className="min-w-0 space-y-4">
        <div className="grid gap-4 xl:grid-cols-2">
          {result ? (
            <Summary
              analysis={result}
              hazardLabel={hazardLabel}
              regionName={describeRegion(submitted.region)}
              query={query}
            />
          ) : analysis.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Analysis failed</AlertTitle>
              <AlertDescription>{analysis.error.message}</AlertDescription>
            </Alert>
          ) : (
            <Skeleton className="h-64" />
          )}
          <RegionMap
            mode={mode}
            region={regionOnMap}
            result={result}
            selectedPoint={selectedPoint}
            onPick={setRegion}
            onSelectPoint={setSelectedPoint}
          />
        </div>

        {result && (
          <>
            <HeadlineChart analysis={result} selectedYear={selectedYear} onSelectYear={setSelectedYear} />
            <div className="grid gap-4 md:grid-cols-2">
              {Object.keys(result.metrics)
                .slice(1)
                .map((key) => (
                  <MetricChart key={key} analysis={result} metricKey={key} />
                ))}
            </div>
            <DailyChart analysis={result} pointIndex={selectedPoint} year={selectedYear} />
          </>
        )}
      </section>
    </main>
  )
}
