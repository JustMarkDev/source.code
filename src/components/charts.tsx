/**
 * Small, opinionated wrappers over Dither Kit so pages say what they chart
 * and not how. Each one needs a parent with a height (the chart fills it).
 */
import { cn } from 'cn'
import type { DitherColor } from '~/components/dither-kit'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Legend,
  Pie,
  PieChart,
  Radar,
  RadarChart,
  Tooltip,
  XAxis,
  YAxis,
} from '~/components/dither-kit'

export type Point = { label: string; value: number }

/** One series over time. */
export function TrendChart({
  data,
  color = 'green',
  unit = '',
  axes = true,
  className,
}: {
  data: Array<Point>
  color?: DitherColor
  unit?: string
  axes?: boolean
  className?: string
}) {
  return (
    <AreaChart
      data={data}
      config={{ value: { label: unit || 'Total', color } }}
      className={cn('h-full w-full', className)}
      margins={axes ? undefined : { top: 4, right: 0, bottom: 0, left: 0 }}
      bloom="low"
    >
      {axes && <XAxis dataKey="label" />}
      {axes && <YAxis />}
      <Tooltip labelKey="label" />
      <Area dataKey="value" variant="gradient" />
    </AreaChart>
  )
}

/** Several series side by side per label. */
export function GroupedBars({
  data,
  series,
  className,
}: {
  data: Array<Record<string, string | number>>
  series: Array<{ key: string; label: string; color: DitherColor }>
  className?: string
}) {
  return (
    <BarChart
      data={data}
      config={Object.fromEntries(
        series.map((s) => [s.key, { label: s.label, color: s.color }]),
      )}
      className={cn('h-full w-full', className)}
    >
      <XAxis dataKey="label" />
      <YAxis />
      <Tooltip labelKey="label" />
      {series.map((s) => (
        <Bar key={s.key} dataKey={s.key} variant="gradient" />
      ))}
    </BarChart>
  )
}

const palette: Array<DitherColor> = [
  'green',
  'blue',
  'purple',
  'orange',
  'pink',
]

/** Parts of a whole. */
export function ShareDonut({
  data,
  className,
}: {
  data: Array<{ name: string; value: number }>
  className?: string
}) {
  return (
    <PieChart
      data={data}
      dataKey="value"
      nameKey="name"
      innerRadius={0.6}
      config={Object.fromEntries(
        data.map((d, i) => [
          d.name,
          { label: d.name, color: palette[i % palette.length] },
        ]),
      )}
      className={cn('h-full w-full', className)}
    >
      <Pie variant="gradient" />
      <Legend />
    </PieChart>
  )
}

/** A profile across several axes. */
export function ShapeRadar({
  data,
  className,
}: {
  data: Array<{ axis: string; value: number }>
  className?: string
}) {
  return (
    <RadarChart
      data={data}
      nameKey="axis"
      config={{ value: { label: 'Share of work', color: 'green' } }}
      className={cn('h-full w-full', className)}
    >
      <Radar dataKey="value" variant="gradient" />
    </RadarChart>
  )
}
