import { Download, Printer, TrendingUp, TriangleAlert } from 'lucide-react'

import { csvUrl } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { Analysis } from '@/types'

type Props = { analysis: Analysis; hazardLabel: string; regionName: string; query: string }

export function Summary({ analysis, hazardLabel, regionName, query }: Props) {
  const { qc } = analysis
  const [first, last] = analysis.years

  return (
    <Card>
      {/* print:block drops the empty export-button column so the title gets full width on paper */}
      <CardHeader className="print:block">
        <CardTitle className="text-base">
          {hazardLabel} · {regionName} · {first}–{last}
        </CardTitle>
        <CardDescription>
          <span className="font-medium text-foreground">Definition: </span>
          {analysis.definition}
        </CardDescription>
        <CardAction className="flex gap-2 print:hidden">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href={csvUrl(query)} download />}
          >
            <Download /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer /> PDF
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {analysis.insights.map((line) => (
            <li key={line} className="flex gap-2">
              <TrendingUp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              {line}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {analysis.region.points.length} grid cell{analysis.region.points.length > 1 && 's'}
          </Badge>
          <Badge variant="outline">{qc.missing_days} missing days</Badge>
          <Badge variant="outline">{qc.flagged_values} values removed by QC</Badge>
          <Badge variant={qc.incomplete_years.length ? 'destructive' : 'outline'}>
            {qc.incomplete_years.length
              ? `Years excluded: ${qc.incomplete_years.join(', ')}`
              : 'No years excluded'}
          </Badge>
        </div>

        <ul className="space-y-1 text-xs text-muted-foreground">
          {analysis.caveats.map((line) => (
            <li key={line} className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" />
              {line}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
