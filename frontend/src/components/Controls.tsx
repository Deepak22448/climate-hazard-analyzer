import { ChevronDown, Loader2 } from 'lucide-react'

import { describeRegion } from '@/api'
import { PlaceSearch } from '@/components/PlaceSearch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Meta, Method, Region, Settings } from '@/types'

const MIN_YEARS = 10 // the backend refuses shorter ranges: too few years for a trend

const METHODS = [
  { value: 'annual', label: 'Whole year (classic heatwave)' },
  { value: 'calendar_day', label: 'Same time of year (warm spells)' },
]

type Props = {
  meta: Meta
  mode: Region['kind']
  onModeChange: (mode: Region['kind']) => void
  region: Region
  onRegionChange: (region: Region) => void
  settings: Settings
  onSettingsChange: (settings: Settings) => void
  onAnalyze: () => void
  busy: boolean
}

export function Controls(props: Props) {
  const { meta, mode, region, settings, busy } = props
  const hazard = meta.hazards.find((h) => h.id === settings.hazard) ?? meta.hazards[0]
  const update = (changes: Partial<Settings>) => props.onSettingsChange({ ...settings, ...changes })
  const regionReady = region.kind === mode

  return (
    <Card className="overflow-visible">
      <CardHeader>
        <CardTitle>Analyse a region</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-2">
          <Label>Region</Label>
          <Tabs value={mode} onValueChange={(value) => props.onModeChange(value as Region['kind'])}>
            <TabsList className="w-full">
              <TabsTrigger value="point">City</TabsTrigger>
              <TabsTrigger value="state">State</TabsTrigger>
              <TabsTrigger value="box">Draw box</TabsTrigger>
            </TabsList>
          </Tabs>
          {mode === 'point' && (
            <PlaceSearch
              kind="city"
              onPick={(p) => props.onRegionChange({ kind: 'point', name: p.name, lat: p.lat, lon: p.lon })}
            />
          )}
          {mode === 'state' && (
            <PlaceSearch
              kind="state"
              onPick={(p) =>
                props.onRegionChange({ kind: 'state', name: p.name, id: p.id, polygon: p.polygon })
              }
            />
          )}
          <p className="text-xs text-muted-foreground">
            {mode === 'point' && 'Or click anywhere on the map.'}
            {mode === 'state' && 'Up to 9 grid points inside the state are analysed and averaged.'}
            {mode === 'box' && 'Click two opposite corners on the map (max 10° per side).'}
          </p>
          <p className="text-sm font-medium">
            {regionReady ? describeRegion(region) : 'Nothing selected yet'}
          </p>
        </section>

        <section className="space-y-2">
          <Label>Hazard</Label>
          <Select
            value={settings.hazard}
            onValueChange={(value) => value && update({ hazard: value })}
            items={meta.hazards.map((h) => ({ value: h.id, label: h.label }))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {meta.hazards.map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  {h.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>

        <section className="space-y-3">
          <div className="flex justify-between">
            <Label>Years</Label>
            <span className="text-sm tabular-nums">
              {settings.start} – {settings.end}
            </span>
          </div>
          <Slider
            min={meta.first_year}
            max={meta.last_year}
            minStepsBetweenValues={MIN_YEARS - 1}
            value={[settings.start, settings.end]}
            onValueChange={(value) => {
              const [start, end] = value as number[]
              update({ start, end })
            }}
          />
        </section>

        {hazard.params.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium">
              Advanced definition
              <ChevronDown className="size-4" />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-4">
              {hazard.params.includes('percentile') && (
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <Label>Percentile threshold</Label>
                    <span className="text-sm tabular-nums">{settings.percentile}th</span>
                  </div>
                  <Slider
                    min={80}
                    max={99}
                    value={[settings.percentile]}
                    onValueChange={(value) => update({ percentile: (value as number[])[0] })}
                  />
                </div>
              )}
              {hazard.params.includes('min_days') && (
                <div className="space-y-2">
                  <Label htmlFor="min-days">Minimum consecutive days</Label>
                  <Input
                    id="min-days"
                    type="number"
                    min={2}
                    max={10}
                    value={settings.minDays}
                    onChange={(e) =>
                      update({ minDays: Math.min(10, Math.max(2, Number(e.target.value) || 2)) })
                    }
                  />
                </div>
              )}
              {hazard.params.includes('method') && (
                <div className="space-y-2">
                  <Label>Threshold compared against</Label>
                  <Select
                    value={settings.method}
                    onValueChange={(value) => value && update({ method: value as Method })}
                    items={METHODS}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METHODS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}

        <Button className="w-full" disabled={!regionReady || busy} onClick={props.onAnalyze}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? 'Analysing…' : 'Analyse'}
        </Button>
        {busy && (
          <p className="text-xs text-muted-foreground">
            First request for a new place downloads 45 years of daily data (a few seconds).
          </p>
        )}
      </CardContent>
    </Card>
  )
}
