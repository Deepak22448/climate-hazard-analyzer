import { Download, Printer, TrendingUp, TriangleAlert } from 'lucide-react'

import { csvUrl } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Analysis } from '@/types'

type Props = { analysis: Analysis; hazardLabel: string; regionName: string; query: string }

export function Summary({ analysis, hazardLabel, regionName, query }: Props) {
  const { qc } = analysis
  const [first, last] = analysis.years
  const cells = analysis.region.points.length

  // Data quality stays quiet when all is well and only speaks up when something
  // was actually fixed or left out. Excluded years are flagged red because they
  // change the trend; missing or removed values were already handled.
  const issues: { text: string; serious: boolean }[] = []
  if (qc.incomplete_years.length > 0) {
    issues.push({ text: `Years excluded from trends: ${qc.incomplete_years.join(', ')}`, serious: true })
  }
  if (qc.missing_days > 0) {
    issues.push({ text: `${qc.missing_days} missing days in the full record`, serious: false })
  }
  if (qc.flagged_values > 0) {
    issues.push({ text: `${qc.flagged_values} values removed by QC`, serious: false })
  }

  return (
    <Card>
      {/* print:block drops the empty export-button column so the title gets full width on paper */}
      <CardHeader className="print:block">
        <CardTitle className="text-base">
          {hazardLabel} · {regionName} · {first}–{last}
        </CardTitle>
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
      <CardContent className="flex flex-1 flex-col gap-4">
        <ul className="space-y-2">
          {analysis.insights.map((line) => (
            <li key={line} className="flex gap-2">
              <TrendingUp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              {line}
            </li>
          ))}
        </ul>

        {analysis.caveats.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {analysis.caveats.map((line) => (
              <li key={line} className="flex gap-2">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                {line}
              </li>
            ))}
          </ul>
        )}

        {/* mt-auto pins the data line to the card's bottom when the card is stretched */}
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span>
            Data: {cells} grid cell{cells > 1 && 's'}
            {issues.length === 0 && ' · complete record · no QC removals'}
          </span>
          {issues.map((issue) => (
            <Badge key={issue.text} variant={issue.serious ? 'destructive' : 'outline'}>
              {issue.text}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
