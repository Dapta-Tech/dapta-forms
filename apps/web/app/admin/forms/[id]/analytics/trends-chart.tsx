'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { TrendPoint } from '@quill/types';
import { Select } from '@/components/ui/select';

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
 *
 * A null value (only `timeToComplete` can be null — no completed session that
 * day had a derivable open time) is a HOLE, not a zero: the line breaks rather
 * than diving to the baseline, because a dip to zero would claim people finished
 * instantly.
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

/**
 * Chart geometry. The viewBox width TRACKS THE MEASURED CONTAINER WIDTH, so one
 * viewBox unit is exactly one pixel and the drawing is never scaled.
 *
 * This used to be a fixed 720-unit viewBox drawn with `preserveAspectRatio="none"`
 * into a container that is ~1400px on a laptop — which stretched everything ~2x
 * horizontally and nothing vertically. The tell was the isolated-day marker: a
 * `<circle>` rendered as an ellipse, and horizontal strokes came out twice as
 * thick as vertical ones.
 */
const W_FALLBACK = 720;
const H = 220;
const PAD = { left: 46, right: 12, top: 12, bottom: 26 };

/**
 * Observe the container's width so the geometry can be computed in real pixels.
 * Falls back to a fixed width on the server and before the first measurement —
 * uniform scaling then, never distortion.
 */
function useMeasuredWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(W_FALLBACK);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A width of 0 is "not laid out yet", not a real measurement — taking it
    // would collapse the geometry. But SKIPPING it and waiting for the observer
    // to fire again strands the chart on the fallback until something resizes
    // the window, which is exactly what happened on first paint. So: ignore the
    // zero, and re-measure on the next frame instead of waiting.
    const apply = (next: number) => {
      if (next > 0) setWidth(Math.round(next));
    };
    apply(el.getBoundingClientRect().width);
    const raf = requestAnimationFrame(() => apply(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(raf);
    const ro = new ResizeObserver((entries) => {
      apply(entries[0]?.contentRect.width ?? el.getBoundingClientRect().width);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  return [ref, width];
}

/** Format seconds as `Ns`, `Nm Ss` or `Nh Nm` (mirrors the stat card). */
function formatDuration(seconds: number, unit: string): string {
  if (seconds < 60) return `${seconds}${unit}`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s === 0 ? `${m}m` : `${m}m ${s}${unit}`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  // Rounding the remainder can land on a full hour — "1h 60m" is not a duration.
  if (m === 60) return `${h + 1}h`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
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
  const [plotRef, W] = useMeasuredWidth<HTMLDivElement>();

  // Buckets are whole UTC days, so render their labels in UTC too — otherwise a
  // point would be titled with the day before/after the data it holds.
  const fmtDate = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    [locale],
  );

  const values: (number | null)[] = points.map((p) => p[metric]);
  const present = values.filter((v): v is number => v != null);
  const max = present.length ? Math.max(...present) : 0;
  const hasData = max > 0;
  // Scale only. When everything is zero the axis must NOT advertise a maximum no
  // data reaches, so the peak label is suppressed below rather than printed as 1.
  const yMax = hasData ? max : 1;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const baseline = PAD.top + innerH;

  const xAt = (i: number) =>
    points.length <= 1 ? PAD.left + innerW / 2 : PAD.left + (i / (points.length - 1)) * innerW;
  const yAt = (v: number) => PAD.top + (1 - v / yMax) * innerH;

  // Split into contiguous runs of non-null values so holes break the line.
  const runs: number[][] = [];
  let run: number[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push(i);
  });
  if (run.length) runs.push(run);

  const linePath = runs
    .map((r) => r.map((i, k) => `${k === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(values[i]!)}`).join(' '))
    .join(' ');
  const areaPath = runs
    .filter((r) => r.length > 1)
    .map((r) => {
      const seg = r.map((i, k) => `${k === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(values[i]!)}`).join(' ');
      return `${seg} L ${xAt(r[r.length - 1]!)} ${baseline} L ${xAt(r[0]!)} ${baseline} Z`;
    })
    .join(' ');
  // A run of one has no line to draw — mark it so the day is not invisible.
  const isolated = runs.filter((r) => r.length === 1).map((r) => r[0]!);

  // As many date ticks as the measured width can hold without labels colliding
  // (~150px each), always including the first and last day. A fixed three-tick
  // rule left a 1400px chart with two labels and a huge gap between them.
  const tickTarget = Math.max(2, Math.min(8, Math.floor(innerW / 150)));
  const tickIdx =
    points.length <= 1
      ? [0]
      : Array.from({ length: tickTarget }, (_, k) =>
          Math.round((k / (tickTarget - 1)) * (points.length - 1)),
        );
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
        {/* The shared Select, not a native one: this was the last `<select>` in
            the admin, and the OS-drawn chevron sat on the border. */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="trends-metric">
          <span id="trends-metric-label">{labels.metricLabel}</span>
          <Select
            value={metric}
            onChange={(v) => setMetric(v as MetricKey)}
            options={metricOptions.map((k) => ({ value: k, label: labels.metrics[k] }))}
            ariaLabel={labels.metricLabel}
            locale={locale}
            className="h-9 min-w-[160px]"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        {points.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{labels.empty}</p>
        ) : (
          <div ref={plotRef}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height={H}
            className="block"
            role="img"
            aria-label={`${labels.metrics[metric]} — ${labels.title}`}
            data-testid="trends-svg"
            data-metric={metric}
            data-plot-width={W}
          >
            {/* Baseline always; the peak guide only when data actually reaches it. */}
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yAt(0)}
              y2={yAt(0)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={yAt(0) + 4}
              textAnchor="end"
              fontSize={10}
              fill="var(--faint)"
            >
              {formatValue(metric, 0, labels.seconds)}
            </text>
            {hasData ? (
              <g>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={yAt(max)}
                  y2={yAt(max)}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={yAt(max) + 4}
                  textAnchor="end"
                  fontSize={10}
                  fill="var(--faint)"
                >
                  {formatValue(metric, max, labels.seconds)}
                </text>
              </g>
            ) : null}

            {areaPath ? <path d={areaPath} fill="var(--primary)" fillOpacity={0.14} /> : null}
            {linePath ? (
              <path
                d={linePath}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {isolated.map((i) => (
              <circle key={i} cx={xAt(i)} cy={yAt(values[i]!)} r={3.5} fill="var(--primary)" />
            ))}
            {/* A single day has no line to read a value off, so print it next to
                the dot — otherwise the chart is a lone mark on an empty grid. */}
            {points.length === 1 && values[0] != null ? (
              <text
                x={xAt(0) + 10}
                y={yAt(values[0]!) + 4}
                fontSize={12}
                fill="var(--foreground)"
                data-testid="trends-single-value"
              >
                {formatValue(metric, values[0]!, labels.seconds)}
              </text>
            ) : null}

            {uniqueTicks.map((i) => (
              <text
                key={i}
                x={xAt(i)}
                y={H - 8}
                textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
                fontSize={10}
                fill="var(--faint)"
              >
                {fmtDate.format(new Date(points[i]!.t))}
              </text>
            ))}
          </svg>
          </div>
        )}
      </div>
    </section>
  );
}
