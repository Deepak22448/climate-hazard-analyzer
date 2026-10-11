import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  type ChartData,
  type ChartOptions,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'
import annotationPlugin from 'chartjs-plugin-annotation'
import { useState } from 'react'
import { Chart } from 'react-chartjs-2'

import { useDaily } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { Analysis, Trend } from '@/types'

ChartJS.register(
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  annotationPlugin,
)

const HAZARD_COLORS: Record<string, string> = {
  heatwave: '#ea580c',
  heavy_rain: '#2563eb',
  drought: '#a16207',
}
const hazardColor = (hazard: string) => HAZARD_COLORS[hazard] ?? '#7c3aed'

// Chart.js paints on a canvas, so it can't follow the CSS theme variables.
// Every chart calls this while rendering, and the whole page re-renders when
// the theme flips, so axes and lines always match the current theme.
function themeColors() {
  const dark = document.documentElement.classList.contains('dark')
  ChartJS.defaults.color = dark ? '#a1a1aa' : '#71717a'
  ChartJS.defaults.borderColor = dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  return { ink: dark ? '#f4f4f5' : '#111827', muted: dark ? '#a1a1aa' : '#6b7280' }
}

type Values = (number | null)[]

// Sen's slope comes back as two end points; the chart needs a value per year.
function trendLine(years: number[], trend: Trend): number[] {
  const [first, last] = trend.sen_line
  return years.map(
    (year) => first.value + ((last.value - first.value) * (year - first.year)) / (last.year - first.year),
  )
}

function trendSummary(trend: Trend | null, unit: string): string {
  if (!trend || trend.mk_p === null) return 'No trend test'
  const slope = `${trend.sen_per_decade > 0 ? '+' : ''}${trend.sen_per_decade.toFixed(2)} ${unit}/decade`
  const p = trend.mk_p < 0.001 ? 'p<0.001' : `p=${trend.mk_p.toFixed(3)}`
  return trend.significant ? `${slope} · ${p}` : `Not significant · p=${trend.mk_p.toFixed(2)}`
}

type HeadlineProps = { analysis: Analysis; selectedYear: number | null; onSelectYear: (year: number) => void }

export function HeadlineChart({ analysis, selectedYear, onSelectYear }: HeadlineProps) {
  const [key, metric] = Object.entries(analysis.metrics)[0]
  const trend = analysis.trends[key]
  const years = analysis.annual.map((row) => row.year)
  const color = hazardColor(analysis.hazard)
  const theme = themeColors()

  const data: ChartData<'bar' | 'line', Values, number> = {
    labels: years,
    datasets: [
      {
        type: 'bar',
        label: metric.label,
        data: analysis.annual.map((row) => row[key]),
        backgroundColor: years.map((year) => (year === selectedYear ? theme.ink : `${color}b3`)),
        order: 3,
      },
      {
        type: 'line',
        label: '5-year average',
        data: analysis.annual.map((row) => row.rolling),
        borderColor: theme.ink,
        pointRadius: 0,
        tension: 0.3,
        order: 1,
      },
      ...(trend
        ? [
            {
              type: 'line' as const,
              label: `Trend (Sen's slope${trend.significant ? '' : ', not significant'})`,
              data: trendLine(years, trend),
              borderColor: theme.muted,
              borderDash: [6, 4],
              pointRadius: 0,
              order: 2,
            },
          ]
        : []),
    ],
  }
  const options: ChartOptions<'bar' | 'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    onClick: (_event, elements) => elements[0] && onSelectYear(years[elements[0].index]),
    scales: { y: { beginAtZero: true, title: { display: true, text: metric.unit } } },
    plugins: { legend: { position: 'bottom' } },
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{metric.label} per year</CardTitle>
        <CardDescription>
          {trendSummary(trend, metric.unit)}
          {trend &&
            ` (linear regression: ${trend.ols_per_decade.toFixed(2)}, 95% CI ${trend.ols_ci95[0].toFixed(2)} to ${trend.ols_ci95[1].toFixed(2)})`}
          . Click a year to see its daily data below.
        </CardDescription>
      </CardHeader>
      <CardContent className="h-80">
        <Chart type="bar" data={data} options={options} />
      </CardContent>
    </Card>
  )
}

export function MetricChart({ analysis, metricKey }: { analysis: Analysis; metricKey: string }) {
  const metric = analysis.metrics[metricKey]
  const trend = analysis.trends[metricKey]
  const years = analysis.annual.map((row) => row.year)
  const color = hazardColor(analysis.hazard)
  const theme = themeColors()

  const data: ChartData<'line', Values, number> = {
    labels: years,
    datasets: [
      {
        label: metric.label,
        data: analysis.annual.map((row) => row[metricKey]),
        borderColor: color,
        backgroundColor: color,
        pointRadius: 2,
        spanGaps: false,
      },
      ...(trend?.significant
        ? [
            {
              label: 'Trend',
              data: trendLine(years, trend),
              borderColor: theme.muted,
              borderDash: [6, 4],
              pointRadius: 0,
            },
          ]
        : []),
    ],
  }
  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: { y: { title: { display: true, text: metric.unit } } },
    plugins: { legend: { display: false } },
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">{metric.label}</CardTitle>
        <div>
          <Badge variant={trend?.significant ? 'default' : 'outline'}>
            {trendSummary(trend, metric.unit)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="h-44">
        <Chart type="line" data={data} options={options} />
      </CardContent>
    </Card>
  )
}

type DailyProps = { analysis: Analysis; pointIndex: number; year: number | null }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WHOLE_YEAR = 'all'

// ISO date strings compare correctly as text, and no month has a day after "31".
function touchesMonth(event: { start: string; end: string }, year: number, month: string) {
  return event.start <= `${year}-${month}-31` && event.end >= `${year}-${month}-01`
}

export function DailyChart({ analysis, pointIndex, year }: DailyProps) {
  const daily = useDaily(analysis, pointIndex, year)
  // 'all' or "01"–"12". Kept when the year changes, so the same month can be compared across years.
  const [month, setMonth] = useState(WHOLE_YEAR)
  const point = analysis.region.points[pointIndex]
  const color = hazardColor(analysis.hazard)
  const theme = themeColors()

  const yearEvents = daily.data?.events ?? []
  const monthOptions = [
    { value: WHOLE_YEAR, label: 'Whole year' },
    ...MONTHS.map((name, i) => {
      const value = String(i + 1).padStart(2, '0')
      const count = year ? yearEvents.filter((event) => touchesMonth(event, year, value)).length : 0
      return { value, label: count ? `${name} · ${count} event${count > 1 ? 's' : ''}` : name }
    }),
  ]

  let body
  if (!year) {
    body = (
      <p className="text-sm text-muted-foreground">
        Click a year in the chart above to see its daily values.
      </p>
    )
  } else if (daily.isPending) {
    body = <Skeleton className="h-64 w-full" />
  } else if (daily.isError) {
    body = <p className="text-sm text-destructive">{daily.error.message}</p>
  } else {
    const { dates, values, threshold, events, variable } = daily.data
    // The days on screen are one contiguous slice [from, to] of the year.
    const shown = dates.flatMap((date, i) => (month === WHOLE_YEAR || date.slice(5, 7) === month ? [i] : []))
    const from = shown[0]
    const to = shown[shown.length - 1]
    const labels = dates.slice(from, to + 1)
    const index = (date: string, fallback: number) => (dates.includes(date) ? dates.indexOf(date) : fallback)

    const data: ChartData<'line' | 'bar', Values, string> = {
      labels,
      datasets: [
        {
          type: variable === 'precip' ? 'bar' : 'line',
          label: variable === 'precip' ? 'Daily rainfall' : 'Daily max temperature',
          data: values.slice(from, to + 1),
          borderColor: color,
          backgroundColor: color,
          pointRadius: month === WHOLE_YEAR ? 0 : 2.5,
          borderWidth: 1.5,
        },
        {
          type: 'line',
          label: 'Threshold',
          data: threshold.slice(from, to + 1),
          borderColor: theme.ink,
          borderDash: [5, 4],
          pointRadius: 0,
          borderWidth: 1,
        },
      ],
    }
    const options: ChartOptions<'line' | 'bar'> = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            // Whole year: label the first day of each month. One month: label every day.
            callback: (_value, i) => {
              if (month !== WHOLE_YEAR) return Number(labels[i].slice(8))
              return labels[i].endsWith('-01') ? MONTHS[Number(labels[i].slice(5, 7)) - 1] : ''
            },
          },
          grid: { display: false },
        },
        y: { title: { display: true, text: variable === 'precip' ? 'mm' : '°C' } },
      },
      plugins: {
        legend: { position: 'bottom' },
        annotation: {
          // Clip each event to the days on screen; ±0.5 makes a one-day event a full-width band.
          annotations: events.flatMap((event) => {
            const start = Math.max(index(event.start, 0), from)
            const end = Math.min(index(event.end, dates.length - 1), to)
            if (start > end) return []
            return [
              {
                type: 'box' as const,
                xMin: start - from - 0.5,
                xMax: end - from + 0.5,
                backgroundColor: `${color}26`,
                borderWidth: 0,
              },
            ]
          }),
        },
      },
    }
    body = (
      <div className="h-72">
        <Chart type={variable === 'precip' ? 'bar' : 'line'} data={data} options={options} />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily view{year ? ` · ${year}` : ''}</CardTitle>
        <CardDescription>
          Grid cell {point.lat}, {point.lon}
          {analysis.region.points.length > 1 && ' (click another square on the map to switch)'}. Shaded spans
          are detected events.
        </CardDescription>
        {year && (
          <CardAction>
            <Select value={month} onValueChange={(value) => value && setMonth(value)} items={monthOptions}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}
