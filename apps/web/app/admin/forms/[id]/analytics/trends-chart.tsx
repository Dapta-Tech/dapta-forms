'use client';

import { useMemo, useState } from 'react';
import type { TrendPoint } from '@quill/types';

/**
 * The Trends chart: one switchable metric plotted per day over the selected
 * range. Hand-rolled SVG on purpose — a charting library would be the single
 * heaviest dependency in the web app for one area chart, and the tokens
 * (`--primary`, `--border`, `--muted-foreground`) already give it the themed
 * look every other surface has.
 *
 * The API sends every metric for every day, so switching the metric is instant
 * and never re-fetches. Days are gap-filled server-side, so a flat stretch here
 * genuinely means "no activity", not "no data point".
 */

type MetricKey = 'views' | 'starts' | 'submissions' | 'completionRate' | 'timeToComplete';

export interface TrendsLabels {
  title: string;
  subtitle: string;
  metricLabel: string;
  empty: string;
  seconds: string;
  metrics: Record<MetricKey, string>;
}

/** Chart geometry (viewBox units; the SVG scales to its container). */
const W = 720;
const H = 220;
const PAD = { left: 46, right: 12, top: 12, bottom: 26 };

/** Format seconds as `Ns` or `Nm Ss` — mirrors the stat card's formatting. */
function formatDuration(seconds: number, unit: string): string {
  if (seconds < 60) return `${seconds}${unit}`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}${unit}`;
}

function formatValue(metric: MetricKey, v: number, secondsUnit: string): string {
  if (metric === 'completionRate') return `${v}%`;
  if (metric === 'timeToComplete') return formatDuration(v, secondsUnit);
  return String(v);
}

export function TrendsChart({
  points,
  labels,
  locale,
}: {
  points: TrendPoint[];
  labels: TrendsLabels;
  locale: string;
}) {
  const [metric, setMetric] = useState<MetricKey>('submissions');

  // Buckets are whole UTC days, so render their labels in UTC too — otherwise a
  // point would be titled with the day before/after the data it holds.
  const fmtDate = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    [locale],
  );

  const values = points.map((p) => p[metric]);
  const max = values.length ? Math.max(...values) : 0;
  // A flat all-zero series still needs a scale, or every point lands on NaN.
  const yMax = max > 0 ? max : 1;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const baseline = PAD.top + innerH;

  const xAt = (i: number) =>
    points.length <= 1 ? PAD.left + innerW / 2 : PAD.left + (i / (points.length - 1)) * innerW;
  const yAt = (v: number) => PAD.top + (1 - v / yMax) * innerH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p[metric])}`).join(' ');
  const area =
    points.length > 0
      ? `${line} L ${xAt(points.length - 1)} ${baseline} L ${xAt(0)} ${baseline} Z`
      : '';

  // First / middle / last ticks only — a label per day would collide.
  const tickIdx = points.length <= 1 ? [0] : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const uniqueTicks = [...new Set(tickIdx)].filter((i) => i >= 0 && i < points.length);

  const metricOptions: MetricKey[] = [
    'views',
    'starts',
    'submissions',
    'completionRate',
    'timeToComplete',
  ];

  return (
    <section data-testid="analytics-trends" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{labels.title}</h2>
          <p className="text-sm text-muted-foreground">{labels.subtitle}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {labels.metricLabel}
          <select
            data-testid="trends-metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricKey)}
            aria-label={labels.metricLabel}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {metricOptions.map((k) => (
              <option key={k} value={k}>
                {labels.metrics[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        {points.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{labels.empty}</p>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-[220px] w-full"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${labels.metrics[metric]} — ${labels.title}`}
            data-testid="trends-svg"
          >
            {/* Horizontal guides + y labels: 0 and the peak. */}
            {[0, yMax].map((v) => (
              <g key={v}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={yAt(v)}
                  y2={yAt(v)}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={yAt(v) + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--muted-foreground)"
                >
                  {formatValue(metric, v, labels.seconds)}
                </text>
              </g>
            ))}

            <path d={area} fill="var(--primary)" fillOpacity={0.14} />
            <path
              d={line}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {/* A single bucket has no line to draw — mark it so it is not blank. */}
            {points.length === 1 ? (
              <circle cx={xAt(0)} cy={yAt(values[0] ?? 0)} r={3.5} fill="var(--primary)" />
            ) : null}

            {uniqueTicks.map((i) => (
              <text
                key={i}
                x={xAt(i)}
                y={H - 8}
                textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
                fontSize={11}
                fill="var(--muted-foreground)"
              >
                {fmtDate.format(new Date(points[i]!.t))}
              </text>
            ))}
          </svg>
        )}
      </div>
    </section>
  );
}
