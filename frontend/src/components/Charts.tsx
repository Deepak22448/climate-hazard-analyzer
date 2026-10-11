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
import { Chart } from 'react-chartjs-2'

import { useDaily } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

  const data: ChartData<'bar' | 'line', Values, number> = {
    labels: years,
    datasets: [
      {
        type: 'bar',
        label: metric.label,
        data: analysis.annual.map((row) => row[key]),
        backgroundColor: years.map((year) => (year === selectedYear ? '#111827' : `${color}b3`)),
        order: 3,
      },
      {
        type: 'line',
        label: '5-year average',
        data: analysis.annual.map((row) => row.rolling),
        borderColor: '#111827',
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
              borderColor: '#6b7280',
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
              borderColor: '#6b7280',
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

export function DailyChart({ analysis, pointIndex, year }: DailyProps) {
  const daily = useDaily(analysis, pointIndex, year)
  const point = analysis.region.points[pointIndex]
  const color = hazardColor(analysis.hazard)

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
    const index = (date: string, fallback: number) => (dates.includes(date) ? dates.indexOf(date) : fallback)
    const data: ChartData<'line' | 'bar', Values, string> = {
      labels: dates,
      datasets: [
        {
          type: variable === 'precip' ? 'bar' : 'line',
          label: variable === 'precip' ? 'Daily rainfall' : 'Daily max temperature',
          data: values,
          borderColor: color,
          backgroundColor: color,
          pointRadius: 0,
          borderWidth: 1.5,
        },
        {
          type: 'line',
          label: 'Threshold',
          data: threshold,
          borderColor: '#111827',
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
            // Label only the first day of each month.
            callback: (_value, i) =>
              dates[i].endsWith('-01')
                ? new Date(dates[i]).toLocaleString('en', { month: 'short', timeZone: 'UTC' })
                : '',
          },
          grid: { display: false },
        },
        y: { title: { display: true, text: variable === 'precip' ? 'mm' : '°C' } },
      },
      plugins: {
        legend: { position: 'bottom' },
        annotation: {
          annotations: events.map((event) => ({
            type: 'box' as const,
            xMin: index(event.start, 0),
            xMax: index(event.end, dates.length - 1),
            backgroundColor: `${color}26`,
            borderWidth: 0,
          })),
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
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}
