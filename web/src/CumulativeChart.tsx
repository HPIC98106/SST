/**
 * Cumulative actual against cumulative budget and last year, month by month.
 *
 * Why cumulative: HPIC's money is seasonal and lumpy. Month by month, an
 * insurance payment or a First Friday swings the picture and the eye reads
 * noise. Accumulated, a lumpy month is a step, and what the reader takes away
 * is whether the actual line runs above or below the budget line.
 *
 * One axis, three series. Identity never rests on colour alone: a legend, a
 * dashed budget line, and a label at each line's end. Hover (or arrow keys)
 * reads every series at a month; the monthly table beneath is the same data
 * without hovering.
 */

import { useMemo, useRef, useState } from "react";
import { compactUsd, monthAbbrev, usd } from "./format";

export interface ChartSeries {
  key: string;
  label: string;
  /** Monthly, not cumulative. Null for months with no figure (not yet complete). */
  values: (number | null)[] | null;
  className: string;
  dashed?: boolean;
}

const W = 460;
const H = 230;
const M = { top: 12, right: 78, bottom: 26, left: 56 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

/** Running totals, stopping at the first month with no figure. */
function cumulative(values: (number | null)[]): (number | null)[] {
  let running = 0;
  let stopped = false;
  return values.map((v) => {
    if (stopped || v === null) {
      stopped = true;
      return null;
    }
    running += v;
    return Math.round(running * 100) / 100;
  });
}

/** Round tick steps (1, 2, 2.5, 5 × 10^n) giving about four gridlines. */
function ticks(max: number): number[] {
  if (max <= 0) return [0];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * power).find((s) => s >= rough) ?? rough;
  const out: number[] = [];
  for (let t = 0; t <= max + step * 0.001; t += step) out.push(t);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

export function CumulativeChart({
  title,
  months,
  series,
}: {
  title: string;
  months: string[];
  series: ChartSeries[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const shown = useMemo(
    () => series.filter((s) => s.values).map((s) => ({ ...s, running: cumulative(s.values!) })),
    [series],
  );

  const all = shown.flatMap((s) => s.running.filter((v): v is number => v !== null));
  const yTicks = ticks(Math.max(0, ...all));
  const yMax = yTicks[yTicks.length - 1] || 1;
  const yMin = Math.min(0, ...all);
  const x = (i: number) => M.left + (months.length <= 1 ? 0 : (i / (months.length - 1)) * PLOT_W);
  const y = (v: number) => M.top + PLOT_H - ((v - yMin) / (yMax - yMin || 1)) * PLOT_H;

  const path = (running: (number | null)[]) =>
    running
      .map((v, i) => (v === null ? null : `${i === 0 || running[i - 1] === null ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");

  // End labels, highest priority first. A label that would collide with one
  // already placed at the same month is dropped; the legend still names it.
  const placed: { x: number; y: number }[] = [];
  const endLabels = shown.flatMap((s) => {
    const last = s.running.reduce<number>((at, v, i) => (v === null ? at : i), -1);
    if (last < 0) return [];
    const point = { x: x(last), y: y(s.running[last]!) };
    if (placed.some((p) => Math.abs(p.x - point.x) < 1 && Math.abs(p.y - point.y) < 14)) {
      return [{ s, point, label: false }];
    }
    placed.push(point);
    return [{ s, point, label: true }];
  });

  const pick = (clientX: number) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const svgX = ((clientX - box.left) / box.width) * W;
    const i = Math.round(((svgX - M.left) / PLOT_W) * (months.length - 1));
    setHover(Math.min(months.length - 1, Math.max(0, i)));
  };

  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      <ul className="chart-legend">
        {shown.map((s) => (
          <li key={s.key}>
            <svg width="22" height="10" aria-hidden="true">
              <line x1="1" y1="5" x2="21" y2="5" className={s.className} strokeDasharray={s.dashed ? "4 3" : undefined} />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>

      <div className="chart-frame">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${title}: cumulative by month. Use the arrow keys to read each month.`}
          tabIndex={0}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover((h) => h ?? Math.max(0, (shown[0]?.running.filter((v) => v !== null).length ?? 1) - 1))}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setHover((h) => Math.min(months.length - 1, (h ?? -1) + 1));
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? 1) - 1));
          }}
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={M.left} x2={M.left + PLOT_W} y1={y(t)} y2={y(t)} />
              <text className="chart-axis" x={M.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {compactUsd(t)}
              </text>
            </g>
          ))}
          {months.map((m, i) => (
            <text key={m} className="chart-axis" x={x(i)} y={H - 8} textAnchor="middle">
              {monthAbbrev(m).charAt(0)}
            </text>
          ))}

          {shown.map((s) => (
            <path
              key={s.key}
              d={path(s.running)}
              className={`chart-line ${s.className}`}
              strokeDasharray={s.dashed ? "5 4" : undefined}
            />
          ))}

          {endLabels.map(({ s, point, label }) => (
            <g key={s.key}>
              <circle cx={point.x} cy={point.y} r={4} className={`chart-dot ${s.className}`} />
              {label ? (
                <text className="chart-end" x={point.x + 8} y={point.y} dominantBaseline="middle">
                  {s.label}
                </text>
              ) : null}
            </g>
          ))}

          {hover !== null ? (
            <g>
              <line className="chart-crosshair" x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + PLOT_H} />
              {shown.map((s) =>
                s.running[hover] === null ? null : (
                  <circle key={s.key} cx={x(hover)} cy={y(s.running[hover]!)} r={4} className={`chart-dot ${s.className}`} />
                ),
              )}
            </g>
          ) : null}

          {/* Hit target: the whole plot, so the reader aims at a month, not a 2px line. */}
          <rect x={M.left - 10} y={M.top} width={PLOT_W + 20} height={PLOT_H} fill="transparent" />
        </svg>

        {hover !== null ? (
          <div
            className="chart-tooltip"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > months.length / 2 ? "-105%" : "5%"})` }}
          >
            <strong>Through {monthAbbrev(months[hover])}</strong>
            {shown.map((s) => (
              <span key={s.key}>
                <svg width="14" height="8" aria-hidden="true">
                  <line x1="1" y1="4" x2="13" y2="4" className={s.className} strokeDasharray={s.dashed ? "3 2" : undefined} />
                </svg>
                {s.label}: {s.running[hover] === null ? "not yet" : usd.format(s.running[hover]!)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </figure>
  );
}
