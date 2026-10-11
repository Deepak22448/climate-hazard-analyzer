import { BookOpen, Database, Moon, Sun, ThermometerSun } from 'lucide-react'
import { useState } from 'react'

import { API_URL, describeRegion, fromQueryString, toQueryString, useAnalysis, useMeta } from '@/api'
import { DailyChart, HeadlineChart, MetricChart } from '@/components/Charts'
import { Controls } from '@/components/Controls'
import { RegionMap } from '@/components/RegionMap'
import { Summary } from '@/components/Summary'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { Meta, Region, Settings } from '@/types'

const DEFAULT_REGION: Region = { kind: 'point', name: 'New Delhi', lat: 28.6139, lon: 77.209 }

export default function App() {
  const meta = useMeta()
  // index.html already applied the saved theme; React just mirrors it.
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  function toggleTheme() {
    const next = !dark
    // Flip the class before re-rendering so charts read the new colours.
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {
      // Private mode or blocked storage: the toggle still works for this visit.
    }
    setDark(next)
  }
  return (
    <div className="min-h-screen bg-muted/40">
      <Header meta={meta.data} dark={dark} onToggleTheme={toggleTheme} />
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

type HeaderProps = { meta?: Meta; dark: boolean; onToggleTheme: () => void }

function Header({ meta, dark, onToggleTheme }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur print:static">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-orange-500 to-red-600 text-white shadow-sm">
          <ThermometerSun className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-base leading-tight font-semibold tracking-tight">
            Climate Hazard Trend Analyzer
          </h1>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">
            Heatwaves, heavy rain and dry spells since 1981, tested for real trends
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 print:hidden">
          {meta && (
            <Badge variant="secondary" className="hidden md:inline-flex">
              <Database /> NASA POWER · MERRA-2 · {meta.first_year}–{meta.last_year}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            aria-label="API docs"
            render={<a href={`${API_URL}/docs`} target="_blank" rel="noreferrer" />}
          >
            <BookOpen /> <span className="hidden sm:inline">API docs</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleTheme}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
        </div>
      </div>
    </header>
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
      {/* Sticky below the header, only in the two-column layout; self-start stops the grid stretching it. */}
      <aside className="space-y-4 print:hidden lg:sticky lg:top-20 lg:self-start">
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
