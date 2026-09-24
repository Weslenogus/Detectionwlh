"use client";

import { FLASH_COLORS } from "@/lib/detection/camera/flash";
import { baselineOf, DEPTH_SLOPE_LIVE, TURN_THRESHOLD } from "@/lib/detection/camera/liveness3d";
import { noiseVerdict, tileState } from "@/lib/detection/camera/frame-analysis";
import type { CameraSignals, FlashColor, FrameMetric, NoiseMap, NoiseTile, Report } from "@/lib/detection/types";
import { LineChart } from "../charts/LineChart";
import { Card, KV, pct, StatusPill } from "../ui";
import { CAMERA_LABELS, ProbBars } from "./Probabilities";

const share = (c: Exclude<FlashColor, "white">, m: FrameMetric) => {
  const sum = Math.max(1, m.r + m.g + m.b);
  return (c === "red" ? m.r : c === "green" ? m.g : m.b) / sum;
};

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function CameraPanel({ report, camera, snapshot }: { report: Report; camera: CameraSignals | null; snapshot: string | null }) {
  const f = camera?.front;
  if (!camera || !f) {
    return (
      <Card>
        <h2 className="font-semibold">Camera</h2>
        <p className="mt-1 text-sm text-ink-2">{report.camera.headline}. {camera?.error ?? ""}</p>
      </Card>
    );
  }
  const A = f.aggregate;
  const fl = f.flash;
  const t0 = f.metrics[0]?.t ?? 0;
  const lag = fl?.lagMs ?? 0;
  const colors = Array.from(new Set((fl?.sequence ?? []).filter((c): c is Exclude<FlashColor, "white"> => c !== "white")));

  return (
    <Card className="space-y-5">
      <div className="flex items-start gap-4">
        {snapshot && (
          // eslint-disable-next-line @next/next/no-img-element -- local data: URL, never uploaded
          <img src={snapshot} alt="Camera frame (kept on this device)" className="size-28 shrink-0 rounded-xl object-cover" style={{ transform: "scaleX(-1)" }} />
        )}
        <div className="min-w-0 space-y-1.5">
          <h2 className="font-semibold">Camera forensics</h2>
          <p className="text-sm text-ink-2">{report.camera.headline}</p>
          <div className="flex flex-wrap gap-1.5">
            <StatusPill status={report.camera.cameraClass === "physical" ? "pass" : "fail"}>
              {pct(report.camera.confidence)} {report.camera.cameraClass ?? "untested"}
            </StatusPill>
            {fl && (
              <StatusPill status={fl.verdict === "responsive" ? "pass" : fl.verdict === "none" ? "warn" : "info"}>liveness {fl.verdict}</StatusPill>
            )}
            {report.camera.depth && report.camera.depth.verdict !== "unavailable" && (
              <StatusPill status={report.camera.depth.verdict === "live-3d" ? "pass" : report.camera.depth.verdict === "flat" ? "fail" : "warn"}>
                3D {report.camera.depth.verdict}
              </StatusPill>
            )}
          </div>
          <p className="text-xs text-muted">The snapshot never leaves this device; only numeric frame statistics are sent for scoring.</p>
        </div>
      </div>

      {report.camera.probabilities && <ProbBars title="Camera hypotheses" probs={report.camera.probabilities} labels={CAMERA_LABELS} />}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Frames in 1 s" value={`${f.timing.frames}`} hint={`${f.timing.fps ?? "?"} fps · CV ${f.timing.intervalCv ?? "?"}`} />
        <Tile label="Temporal noise σ" value={A?.temporalNoise?.toFixed(3) ?? "—"} hint={A?.zeroDiffRatio != null ? `${(A.zeroDiffRatio * 100).toFixed(1)}% unchanged px` : undefined} />
        <Tile label="Frozen frames" value={A ? `${Math.round(A.duplicateRatio * 100)}%` : "—"} hint={`blockiness ×${A?.blockiness.toFixed(2) ?? "?"}`} />
        <Tile label="Flash correlation" value={fl?.correlation != null ? fl.correlation.toFixed(2) : "—"} hint={fl?.lagMs != null ? `lag ${fl.lagMs} ms` : undefined} />
      </div>

      {fl && colors.length > 0 && f.metrics.length > 3 && (
        <div>
          <h3 className="text-sm font-semibold">Screen-reflection challenge</h3>
          <p className="mb-3 text-xs text-muted">
            Server-issued sequence {fl.sequence.join(" → ")}. Each panel shows that colour&apos;s share of the light reaching the camera; shading marks when the
            screen showed it (shifted by the {lag} ms display+sensor lag). A live camera rises inside its shaded band.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {colors.map((c) => (
              <LineChart
                key={c}
                title={`${c[0].toUpperCase()}${c.slice(1)} share`}
                swatch={FLASH_COLORS[c]}
                subtitle={`shaded: ${c} flash`}
                height={120}
                series={[{ id: c, label: `${c} share`, color: "var(--series-1)", points: f.metrics.map((m) => ({ x: m.t - t0, y: share(c, m) * 100 })) }]}
                bands={fl.schedule.filter((s) => s.color === c).map((s) => ({ from: s.start + lag - t0, to: s.end + lag - t0 }))}
                xFormat={(x) => `${Math.round(x)} ms`}
                yFormat={(y) => `${y.toFixed(1)}%`}
              />
            ))}
          </div>
        </div>
      )}

      {f.noiseMap && <NoiseMapView map={f.noiseMap} snapshot={snapshot} />}

      <DepthSection report={report} camera={camera} />

      {f.metrics.some((m) => m.temporalSigma !== null) && (
        <LineChart
          title="Frame-to-frame sensor noise"
          subtitle="Temporal σ of static pixels (green channel). Zero means bit-identical frames."
          height={120}
          series={[
            {
              id: "noise",
              label: "σ",
              color: "var(--series-1)",
              points: f.metrics.filter((m) => m.temporalSigma !== null).map((m) => ({ x: m.t - t0, y: m.temporalSigma as number })),
            },
          ]}
          xFormat={(x) => `${Math.round(x)} ms`}
          yFormat={(y) => y.toFixed(2)}
        />
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <KV k="Active camera" v={f.label || "(no label)"} />
        <KV k="Track type" v={f.trackConstructor} mono />
        <KV k="Resolution" v={`${f.videoWidth}×${f.videoHeight}`} mono />
        <KV k="Facing" v={String(f.settings.facingMode ?? "n/a")} />
        <KV k="Pixel format" v={f.videoFrame?.format ?? "n/a"} mono />
        <KV k="Colour space" v={f.videoFrame?.colorSpace ? `${f.videoFrame.colorSpace.primaries ?? "?"} / ${f.videoFrame.colorSpace.fullRange ? "full" : "limited"}` : "n/a"} mono />
        <KV k="Spatial noise σ" v={A?.spatialNoise.toFixed(2) ?? "—"} mono />
        <KV k="Scene luma" v={A ? `${A.meanLuma.toFixed(0)} ± ${A.lumaStd.toFixed(0)}` : "—"} mono />
        <KV k="Face frames" v={f.face?.available ? `${f.face.framesWithFace}/${f.face.framesAnalyzed}` : (f.face?.error ?? "n/a")} />
        <KV k="Cameras enumerated" v={`${camera.devicesAfter.filter((d) => d.kind === "videoinput").length}`} />
        <KV k="Rear camera" v={camera.rear ? camera.rear.label || "opened" : (camera.rearError ?? "—")} />
        <KV k="Controls" v={f.capabilities ? Object.keys(f.capabilities).length + " capabilities" : "none"} />
      </dl>
    </Card>
  );
}

const DEPTH_TEXT: Record<"live-3d" | "flat" | "incomplete" | "unavailable", string> = {
  "live-3d": "Real 3D head, turned live in the issued order",
  flat: "Flat face — photo, screen or flat mask",
  incomplete: "Head-turn challenge not completed",
  unavailable: "Face tracking unavailable",
};

/** Active 3D liveness: nose-parallax track, planarity residual and phone rotation. */
function DepthSection({ report, camera }: { report: Report; camera: CameraSignals }) {
  const a = camera.active3d;
  const d = report.camera.depth;
  if (!a || !d || a.status === "skipped") return null;
  const t0 = a.track[0]?.t ?? 0;
  const base = baselineOf(a.track[0]?.nose);
  return (
    <div>
      <h3 className="text-sm font-semibold">3D head-turn liveness</h3>
      <p className="mb-3 text-xs text-muted">
        {DEPTH_TEXT[d.verdict]}. The nose tip sits in front of the face outline, so on a real head it swings against the cheeks as the head turns, and the
        landmarks stop fitting a single planar mapping (homography) in proportion to the turn. A tilted photo or screen only narrows — its nose stays centred.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Turn order" value={d.reached.join(" → ") || "—"} hint={`asked ${a.challenge.join(" → ")}${d.orderOk ? " ✓" : ""}`} />
        <Tile label="Nose parallax" value={d.parallax !== null ? d.parallax.toFixed(2) : "—"} hint={`face widths · ±${TURN_THRESHOLD} per turn`} />
        <Tile
          label="Depth slope"
          value={d.depthSlope !== null ? d.depthSlope.toFixed(2) : "—"}
          hint={`≥ ${DEPTH_SLOPE_LIVE} real head${d.planarityResidual !== null ? ` · residual ${d.planarityResidual.toFixed(3)}` : ""}`}
        />
        <Tile
          label={d.verdict === "flat" ? "Flat tilt" : "Phone rotation"}
          value={d.verdict === "flat" ? `${Math.round((d.tilt ?? 0) * 100)}%` : d.deviceRotationDeg !== null ? `${d.deviceRotationDeg.toFixed(0)}°` : "n/a"}
          hint={d.verdict === "flat" ? "face narrowed, nose centred" : d.durationMs !== null ? `during ${(d.durationMs / 1000).toFixed(1)} s` : undefined}
        />
      </div>
      {a.track.length > 3 && (
        <div className="mt-4">
          <LineChart
            title="Nose offset against the face outline"
            subtitle={`Relative to the frontal pose. Positive = turned to the user's left, negative = right. A turn counts past ±${TURN_THRESHOLD} face widths.`}
            height={130}
            series={[{ id: "nose", label: "nose offset", color: "var(--series-1)", points: a.track.map((p) => ({ x: p.t - t0, y: p.nose - base })) }]}
            xFormat={(x) => `${(x / 1000).toFixed(1)} s`}
            yFormat={(y) => y.toFixed(2)}
            refLine={{ y: 0, label: "frontal" }}
          />
        </div>
      )}
    </div>
  );
}

const TILE_STYLE: Record<NoiseTile["state"], { cell: string; label: string }> = {
  live: { cell: "bg-good/35 ring-good", label: "fresh sensor noise" },
  static: { cell: "bg-bad/55 ring-bad", label: "bit-identical (frozen)" },
  mixed: { cell: "bg-warn/40 ring-warn", label: "partly frozen" },
  clipped: { cell: "bg-black/30 ring-white/40", label: "too dark / bright" },
};

const NOISE_TEXT: Record<NoiseMap["verdict"], string> = {
  sensor: "Every region carries fresh sensor noise, as a physical camera produces.",
  composite: "Detailed regions stayed bit-identical while the rest was live: something was pasted into the feed.",
  static: "Nothing in the frame changed between frames: a still image.",
  inconclusive: "Too few usable regions to judge.",
  insufficient: "Too few frames to judge.",
};

/** The temporal-noise grid drawn over the camera snapshot, in raw (unmirrored) camera orientation. */
function NoiseMapView({ map, snapshot }: { map: NoiseMap; snapshot: string | null }) {
  const v = noiseVerdict(map.tiles, map.pairs, map.duplicatePairs);
  const states = map.tiles.map((t) => ({ ...t, state: tileState(t) }));
  const present = (Object.keys(TILE_STYLE) as NoiseTile["state"][]).filter((k) => states.some((t) => t.state === k));
  return (
    <div>
      <h3 className="text-sm font-semibold">Sensor-noise map</h3>
      <p className="mb-3 text-xs text-muted">
        {NOISE_TEXT[v.verdict]} {map.cols}×{map.rows} native-resolution regions compared frame to frame over the 1-second capture.
      </p>
      <div className="flex flex-wrap items-start gap-4">
        <div className="relative w-56 shrink-0 overflow-hidden rounded-xl bg-surface-2" style={{ aspectRatio: "4 / 3" }}>
          {snapshot && (
            // eslint-disable-next-line @next/next/no-img-element -- local data: URL, never uploaded
            <img src={snapshot} alt="" className="absolute inset-0 size-full object-cover" />
          )}
          <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${map.cols}, 1fr)`, gridTemplateRows: `repeat(${map.rows}, 1fr)` }}>
            {states.map((t) => (
              <div key={`${t.c}-${t.r}`} className="flex items-center justify-center" style={{ gridColumn: t.c + 1, gridRow: t.r + 1 }}>
                <span
                  className={`size-4 rounded-sm ring-1 ${TILE_STYLE[t.state].cell}`}
                  title={`${TILE_STYLE[t.state].label} · unchanged ${t.zero !== null ? Math.round(t.zero * 100) + "%" : "—"} · σ ${t.sigma ?? "—"}`}
                />
              </div>
            ))}
          </div>
        </div>
        <ul className="space-y-1.5 text-xs text-ink-2">
          {present.map((k) => (
            <li key={k} className="flex items-center gap-2">
              <span className={`size-3 rounded-sm ring-1 ${TILE_STYLE[k].cell}`} aria-hidden />
              {TILE_STYLE[k].label} · {states.filter((t) => t.state === k).length}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
