"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface Series {
  id: string;
  label: string;
  /** CSS colour (use a validated series token, e.g. var(--series-1)). */
  color: string;
  points: { x: number; y: number }[];
}

export interface Band {
  from: number;
  to: number;
  label?: string;
}

interface Props {
  title: string;
  subtitle?: string;
  series: Series[];
  bands?: Band[];
  height?: number;
  xFormat?: (x: number) => string;
  yFormat?: (y: number) => string;
  yDomain?: [number, number];
  refLine?: { y: number; label: string };
  swatch?: string;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Math.round(v / step) * step);
  return out;
}

const M = { top: 10, left: 44, bottom: 22 };

/**
 * Minimal line chart: 2px lines, hairline grid, end-dots with a surface ring,
 * crosshair + one tooltip listing every series, keyboard stepping, legend for
 * ≥2 series and a data-table fallback.
 */
export function LineChart({ title, subtitle, series, bands = [], height = 150, xFormat = (x) => `${Math.round(x)}`, yFormat = (y) => y.toFixed(2), yDomain, refLine, swatch }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(200, Math.floor(entries[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const withEndLabels = series.length >= 2 && series.length <= 4;
  const right = withEndLabels ? 64 : 14;
  const all = series.flatMap((s) => s.points);
  const xs = useMemo(() => Array.from(new Set(series[0]?.points.map((p) => p.x) ?? [])).sort((a, b) => a - b), [series]);

  if (!all.length) {
    return (
      <figure className="rounded-xl border border-line p-3">
        <figcaption className="text-sm font-medium">{title}</figcaption>
        <p className="mt-2 text-sm text-muted">No data captured.</p>
      </figure>
    );
  }

  const xMin = Math.min(...all.map((p) => p.x), ...bands.map((b) => b.from));
  const xMax = Math.max(...all.map((p) => p.x), ...bands.map((b) => b.to));
  let [yMin, yMax] = yDomain ?? [Math.min(...all.map((p) => p.y)), Math.max(...all.map((p) => p.y))];
  if (refLine && !yDomain) {
    yMin = Math.min(yMin, refLine.y);
    yMax = Math.max(yMax, refLine.y);
  }
  if (!yDomain) {
    const pad = (yMax - yMin || Math.abs(yMax) * 0.1 || 1) * 0.12;
    yMin -= pad;
    yMax += pad;
  }
  const iw = width - M.left - right;
  const ih = height - M.top - M.bottom;
  const sx = (x: number) => M.left + ((x - xMin) / (xMax - xMin || 1)) * iw;
  const sy = (y: number) => M.top + ih - ((y - yMin) / (yMax - yMin || 1)) * ih;
  const yTicks = niceTicks(yMin, yMax, 3).filter((t) => t >= yMin && t <= yMax);
  const xTicks = niceTicks(xMin, xMax, 4).filter((t) => t >= xMin && t <= xMax);

  const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
  const nearest = (pts: { x: number; y: number }[], x: number) => pts.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a), pts[0]);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
    const x = xMin + ((e.clientX - r.left - M.left) / iw) * (xMax - xMin);
    let best = 0;
    xs.forEach((v, i) => {
      if (Math.abs(v - x) < Math.abs(xs[best] - x)) best = i;
    });
    setHover(best);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!xs.length) return;
    if (e.key === "ArrowRight") setHover((h) => Math.min(xs.length - 1, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? xs.length) - 1));
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };

  const hx = hover !== null ? xs[hover] : null;
  const endLabels = withEndLabels
    ? series
        .map((s) => ({ s, y: sy(s.points[s.points.length - 1].y) }))
        .sort((a, b) => a.y - b.y)
    : [];
  const labelsCollide = endLabels.some((l, i) => i > 0 && l.y - endLabels[i - 1].y < 13);

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
            {swatch && <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: swatch }} />}
            {title}
          </span>
          {subtitle && <span className="block text-xs text-muted">{subtitle}</span>}
        </span>
      </figcaption>
      {series.length >= 2 && (
        <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
          {series.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <svg width="14" height="4" aria-hidden>
                <line x1="0" y1="2" x2="14" y2="2" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div ref={wrap} className="relative">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title}. Use arrow keys to inspect values.`}
          aria-describedby={tableId}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          className="block touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
        >
          {bands.map((b, i) => (
            <g key={i}>
              <rect x={sx(b.from)} y={M.top} width={Math.max(1, sx(b.to) - sx(b.from))} height={ih} fill="var(--band)" />
              {b.label && (
                <text x={sx(b.from) + 3} y={M.top + 10} fontSize="10" fill="var(--muted)">
                  {b.label}
                </text>
              )}
            </g>
          ))}
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + iw} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" strokeWidth="1" />
              <text x={M.left - 6} y={sy(t) + 3} fontSize="10" textAnchor="end" fill="var(--muted)" className="tabular">
                {yFormat(t)}
              </text>
            </g>
          ))}
          <line x1={M.left} x2={M.left + iw} y1={M.top + ih} y2={M.top + ih} stroke="var(--axis)" strokeWidth="1" />
          {xTicks.map((t) => (
            <text key={t} x={sx(t)} y={height - 6} fontSize="10" textAnchor="middle" fill="var(--muted)" className="tabular">
              {xFormat(t)}
            </text>
          ))}
          {refLine && (
            <g>
              <line x1={M.left} x2={M.left + iw} y1={sy(refLine.y)} y2={sy(refLine.y)} stroke="var(--axis)" strokeWidth="1" />
              <text x={M.left + iw - 2} y={sy(refLine.y) - 4} fontSize="10" textAnchor="end" fill="var(--muted)">
                {refLine.label}
              </text>
            </g>
          )}
          {series.map((s) => (
            <path key={s.id} d={path(s.points)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {series.map((s) => {
            const last = s.points[s.points.length - 1];
            return <circle key={s.id} cx={sx(last.x)} cy={sy(last.y)} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" />;
          })}
          {!labelsCollide &&
            endLabels.map(({ s, y }) => (
              <text key={s.id} x={M.left + iw + 8} y={y + 3} fontSize="11" fill="var(--ink-2)">
                {s.label}
              </text>
            ))}
          {hx !== null && (
            <g pointerEvents="none">
              <line x1={sx(hx)} x2={sx(hx)} y1={M.top} y2={M.top + ih} stroke="var(--axis)" strokeWidth="1" />
              {series.map((s) => {
                const p = nearest(s.points, hx);
                return <circle key={s.id} cx={sx(p.x)} cy={sy(p.y)} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" />;
              })}
            </g>
          )}
          <rect
            x={M.left}
            y={M.top}
            width={iw}
            height={ih}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hx !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-28 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: Math.min(Math.max(sx(hx) + 10, 0), width - 130) }}
          >
            <div className="text-muted tabular">{xFormat(hx)}</div>
            {series.map((s) => {
              const p = nearest(s.points, hx);
              return (
                <div key={s.id} className="flex items-center gap-1.5">
                  <svg width="10" height="4" aria-hidden>
                    <line x1="0" y1="2" x2="10" y2="2" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span className="font-semibold text-ink tabular">{yFormat(p.y)}</span>
                  <span className="text-ink-2">{s.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <details id={tableId} className="mt-1 text-xs text-muted">
        <summary className="cursor-pointer select-none">Data table</summary>
        <div className="mt-1 max-h-48 overflow-auto rounded-md border border-line">
          <table className="w-full text-left tabular">
            <thead className="sticky top-0 bg-surface-2 text-ink-2">
              <tr>
                <th className="px-2 py-1 font-medium">x</th>
                {series.map((s) => (
                  <th key={s.id} className="px-2 py-1 font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {xs.map((x) => (
                <tr key={x} className="border-t border-line">
                  <td className="px-2 py-0.5">{xFormat(x)}</td>
                  {series.map((s) => (
                    <td key={s.id} className="px-2 py-0.5 text-ink">
                      {yFormat(nearest(s.points, x).y)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
