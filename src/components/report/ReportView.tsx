"use client";

import { Copy, Download, KeyRound, RotateCcw, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";
import type { Decision, Report, SignalBundle } from "@/lib/detection/types";
import { Button, Card, cx, KV, pct } from "../ui";
import { CameraPanel } from "./CameraPanel";
import { CategoryCard } from "./Findings";
import { MotionPanel } from "./MotionPanel";
import { DEVICE_LABELS, ProbBars } from "./Probabilities";

const DECISION: Record<Decision, { label: string; Icon: typeof ShieldCheck; tone: string; blurb: string }> = {
  approve: { label: "Approved", Icon: ShieldCheck, tone: "bg-good-wash text-good-ink", blurb: "Real phone with a physical camera." },
  review: { label: "Needs review", Icon: ShieldAlert, tone: "bg-warn-wash text-warn-ink", blurb: "Evidence is mixed or incomplete." },
  decline: { label: "Declined", Icon: ShieldX, tone: "bg-bad-wash text-bad-ink", blurb: "Not a genuine phone, or the camera is not real." },
};

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Props {
  report: Report;
  bundle: SignalBundle;
  snapshot: string | null;
  serverError: string | null;
  onRestart: () => void;
}

export function ReportView({ report, bundle, snapshot, serverError, onRestart }: Props) {
  const [copied, setCopied] = useState(false);
  const d = DECISION[report.decision];
  const p = report.profile;
  const date = new Date(report.createdAt);

  const copyToken = async () => {
    if (!report.signature) return;
    try {
      await navigator.clipboard.writeText(report.signature.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="space-y-4">
      {/* ------------------------------ Verdict ------------------------------ */}
      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span className={cx("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold", d.tone)}>
            <d.Icon className="size-4" aria-hidden /> {d.label}
          </span>
          <span className="text-xs text-muted tabular">{date.toLocaleString()}</span>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Probability this is a real phone</p>
          <p className="text-5xl font-semibold leading-tight">{pct(report.probabilities.phone)}</p>
          <h1 className="mt-1 text-xl font-semibold">{report.headline}</h1>
          <p className="mt-1 text-sm text-ink-2">{report.summary}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="text-xs text-muted">Risk score</div>
            <div className="text-lg font-semibold">{report.riskScore}/100</div>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="text-xs text-muted">Checks</div>
            <div className="text-lg font-semibold">{report.stats.findings}</div>
            <div className="text-xs text-muted">
              {report.stats.pass}✓ {report.stats.warn}! {report.stats.fail}✗
            </div>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="text-xs text-muted">Signals</div>
            <div className="text-lg font-semibold">{report.stats.signals.toLocaleString()}</div>
          </div>
        </div>
        <div className={cx("flex items-start gap-2 rounded-xl p-3 text-xs", report.signature ? "bg-good-wash" : "bg-warn-wash")}>
          <KeyRound className={cx("mt-0.5 size-4 shrink-0", report.signature ? "text-good-ink" : "text-warn-ink")} aria-hidden />
          {report.signature ? (
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">Server-scored and signed ({report.signature.alg}, key {report.signature.keyId})</p>
              <p className="truncate font-mono text-muted">{report.signature.token}</p>
              <button type="button" onClick={copyToken} className="mt-1 inline-flex items-center gap-1 font-medium text-accent">
                <Copy className="size-3.5" /> {copied ? "Copied" : "Copy verdict token"} — verify with POST /api/verify
              </button>
            </div>
          ) : (
            <p className="text-ink">
              <span className="font-medium">Unsigned, scored in the browser.</span> {serverError ? `Server scoring failed: ${serverError}` : ""}
            </p>
          )}
        </div>
      </Card>

      {report.flags.length > 0 && (
        <Card>
          <h2 className="font-semibold">Key red flags</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {report.flags.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-bad" aria-hidden />
                <span className="min-w-0 break-words text-ink-2">{f}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---------------------------- Distribution ---------------------------- */}
      <Card className="space-y-4">
        <ProbBars title="Device hypotheses (posterior)" probs={report.probabilities} labels={DEVICE_LABELS} />
        <p className="text-xs text-muted">
          Naive-Bayes posterior over six hypotheses: every check adds log-likelihood evidence; each category&apos;s contribution is capped so correlated signals
          cannot dominate.
        </p>
      </Card>

      {/* ------------------------------ Profile ------------------------------ */}
      <Card>
        <h2 className="mb-3 font-semibold">Identified device</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <KV k="Model" v={p.model ?? "unknown"} />
          <KV k="Vendor" v={p.vendor ?? "—"} />
          <KV k="Model source" v={p.modelSource ?? "—"} />
          <KV k="OS" v={`${p.os}${p.osVersion ? ` ${p.osVersion}` : ""}`} />
          <KV k="Browser" v={`${p.browser}${p.browserVersion ? ` ${p.browserVersion}` : ""}`} />
          <KV k="Engine" v={p.engine} />
          <KV k="CPU" v={`${p.cpuArch}${p.cores ? ` · ${p.cores} cores` : ""}`} />
          <KV k="Memory" v={p.memoryGb ? `≥${p.memoryGb} GB` : "—"} />
          <KV k="GPU" v={`${p.gpu ?? "masked"} (${p.gpuClass})`} />
          <KV k="Screen" v={p.screen} mono />
          <KV k="Claimed form" v={p.claimedFormFactor} />
          <KV k="Embedded in" v={p.webview ?? "—"} />
        </dl>
      </Card>

      <CameraPanel report={report} camera={bundle.camera} snapshot={snapshot} />
      <MotionPanel motion={bundle.motion} />

      {/* ----------------------------- Categories ----------------------------- */}
      <div className="space-y-3">
        <h2 className="px-1 text-lg font-semibold">All checks by category</h2>
        {report.categories.map((c) => (
          <CategoryCard key={c.id} c={c} />
        ))}
      </div>

      {/* ------------------------------ Raw data ------------------------------ */}
      <Card className="space-y-3">
        <h2 className="font-semibold">Raw data</h2>
        <p className="text-sm text-ink-2">Everything that was collected and scored. The camera snapshot is not included.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="ghost" onClick={() => download(`report-${report.id}.json`, report)}>
            <Download className="size-5" /> Report JSON
          </Button>
          <Button variant="ghost" onClick={() => download(`signals-${report.id}.json`, bundle)}>
            <Download className="size-5" /> Raw signals JSON
          </Button>
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer select-none text-ink-2">Inspect raw signals</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-ink-2">
            {JSON.stringify({ ...bundle, motion: bundle.motion ? { ...bundle.motion, motion: `[${bundle.motion.motion.length} samples]`, orientation: `[${bundle.motion.orientation.length} samples]` } : null }, null, 2)}
          </pre>
        </details>
      </Card>

      <Button variant="ghost" onClick={onRestart}>
        <RotateCcw className="size-5" /> Run again
      </Button>
      <p className="pb-6 text-center text-xs text-muted">
        Report {report.id} · engine v{report.version} · scored on the {report.source}
      </p>
    </div>
  );
}
