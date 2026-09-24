"use client";

import { analyzeMotion } from "@/lib/detection/sensors/analysis";
import type { MotionSignals } from "@/lib/detection/types";
import { LineChart } from "../charts/LineChart";
import { Card, KV } from "../ui";

export function MotionPanel({ motion }: { motion: MotionSignals | null }) {
  const m = analyzeMotion(motion);
  const t0 = m.series[0]?.t ?? m.orientationSeries[0]?.t ?? 0;
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-semibold">Motion sensors</h2>
        <p className="text-sm text-ink-2">
          Verdict <span className="font-medium text-ink">{m.verdict}</span> · {m.samples} motion samples · {m.orientationSamples} orientation samples
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <KV k="Rate" v={m.rateHz ? `${m.rateHz} Hz` : "—"} mono />
        <KV k="|gravity|" v={m.gravityMagnitude ? `${m.gravityMagnitude.toFixed(3)} m/s²` : "—"} mono />
        <KV k="Noise floor" v={m.noise !== null ? m.noise.toFixed(4) : "—"} mono />
        <KV k="Rounding step" v={m.quantum !== null ? m.quantum.toFixed(4) : "—"} mono />
        <KV k="Gravity↔Euler error" v={m.consistencyErrorDeg !== null ? `${m.consistencyErrorDeg.toFixed(1)}°` : "—"} mono />
        <KV k="Compass" v={m.compass ? "yes" : "no"} />
        <KV k="Handling" v={m.handheld} />
        <KV k="Generic Sensor API" v={`${m.generic.accelerometer.state} (${m.generic.accelerometer.samples})`} />
      </dl>
      {m.series.length > 3 && (
        <LineChart
          title="Acceleration magnitude incl. gravity"
          subtitle="A physical accelerometer hovers around 9.81 m/s² with visible jitter."
          series={[{ id: "g", label: "|a|", color: "var(--series-1)", points: m.series.map((p) => ({ x: (p.t - t0) / 1000, y: p.magnitude })) }]}
          refLine={{ y: 9.81, label: "g = 9.81" }}
          xFormat={(x) => `${x.toFixed(1)} s`}
          yFormat={(y) => y.toFixed(2)}
        />
      )}
      {m.orientationSeries.length > 3 && (
        <LineChart
          title="Device tilt"
          subtitle="Orientation Euler angles (degrees)."
          series={[
            { id: "beta", label: "β front-back", color: "var(--series-1)", points: m.orientationSeries.map((p) => ({ x: (p.t - t0) / 1000, y: p.beta })) },
            { id: "gamma", label: "γ left-right", color: "var(--series-2)", points: m.orientationSeries.map((p) => ({ x: (p.t - t0) / 1000, y: p.gamma })) },
          ]}
          xFormat={(x) => `${x.toFixed(1)} s`}
          yFormat={(y) => `${y.toFixed(1)}°`}
        />
      )}
      {m.series.length <= 3 && m.orientationSeries.length <= 3 && <p className="text-sm text-muted">No usable motion trace was recorded.</p>}
    </Card>
  );
}
