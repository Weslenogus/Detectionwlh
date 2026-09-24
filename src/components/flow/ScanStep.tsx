"use client";

import { ArrowRightIcon, ScanSmileyIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { SCAN_STEPS, type ScanStepId, type StepStatus } from "@/lib/detection/collect";
import { deviceName } from "@/lib/detection/engine/profile";
import type { Report } from "@/lib/detection/types";
import { Button, Card, cx, KV, pct, StatusIcon } from "../ui";
import { ProbeTile, ScanHero, ScanProgress } from "./ScanVisuals";
import { VerdictGlyph } from "./VerdictGlyph";

export type StepState = Record<ScanStepId, { status: StepStatus; detail?: string }>;

export function ScanChecklist({ steps }: { steps: StepState }) {
  return (
    <ol className="space-y-0.5">
      {SCAN_STEPS.map((s, i) => {
        const st = steps[s.id];
        return (
          <motion.li
            key={s.id}
            className={cx("flex items-center gap-3 rounded-xl px-2 py-2 transition-colors", st.status === "running" && "bg-info-wash")}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, duration: 0.25 }}
          >
            <ProbeTile id={s.id} status={st.status} />
            <span className="min-w-0 flex-1">
              <span className={cx("block text-sm font-medium", st.status === "pending" ? "text-muted" : "text-ink")}>{s.label}</span>
              <motion.span
                key={st.detail ?? s.hint}
                className="block truncate font-mono text-xs text-muted"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
              >
                {st.detail ?? s.hint}
              </motion.span>
            </span>
          </motion.li>
        );
      })}
    </ol>
  );
}

export function ScanStep({ steps, prelim, onContinue }: { steps: StepState; prelim: Report | null; onContinue: () => void }) {
  const done = SCAN_STEPS.filter((s) => steps[s.id].status === "done" || steps[s.id].status === "error").length;
  const progress = done / SCAN_STEPS.length;
  const topIssues = prelim
    ? prelim.categories
        .flatMap((c) => c.findings)
        .filter((f) => f.status === "fail" || f.status === "warn")
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 4)
    : [];
  const passed = prelim?.stats.pass ?? 0;

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-4">
        <ScanHero progress={progress} done={Boolean(prelim)} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Step 1 of 2</p>
          <h1 className="text-xl font-semibold">{prelim ? "Device analysed" : "Analysing your device…"}</h1>
          {!prelim && (
            <div className="mt-2 flex items-center gap-2">
              <ScanProgress value={progress} />
              <span className="shrink-0 text-xs text-muted tabular">{Math.round(progress * 100)}%</span>
            </div>
          )}
        </div>
      </header>

      {!prelim && (
        <Card>
          <div className="mb-2 flex items-center justify-between px-2 text-xs text-muted">
            <span>Hardware, integrity &amp; network probes</span>
            <span className="tabular">
              {done}/{SCAN_STEPS.length}
            </span>
          </div>
          <ScanChecklist steps={steps} />
        </Card>
      )}

      {prelim && (
        <>
          <Card>
            <div className="flex items-center gap-4">
              <VerdictGlyph deviceClass={prelim.deviceClass} size="lg" />
              <div className="min-w-0">
                <p className="text-xs text-muted">Preliminary result</p>
                <h2 className="text-lg font-semibold leading-tight">{prelim.headline}</h2>
                <p className="text-sm text-ink-2">
                  <span className="tabular font-semibold text-ink">{pct(prelim.deviceConfidence)}</span> posterior · {passed} checks support a real phone
                </p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
              <KV k={["phone", "tablet", "desktop"].includes(prelim.deviceClass) ? "Device" : "Claims to be"} v={deviceName(prelim.profile)} />
              <KV k="System" v={`${prelim.profile.os}${prelim.profile.osVersion ? ` ${prelim.profile.osVersion}` : ""}`} />
              <KV k="Browser" v={`${prelim.profile.browser}${prelim.profile.browserVersion ? ` ${prelim.profile.browserVersion.split(".")[0]}` : ""}`} />
              <KV k="CPU" v={prelim.profile.cpuArch} />
              <KV k="GPU" v={prelim.profile.gpu ?? "masked"} />
              <KV k="Screen" v={prelim.profile.screen} mono />
            </dl>
            {topIssues.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-line pt-3">
                {topIssues.map((f) => (
                  <li key={f.id} className="flex items-start gap-2 text-sm">
                    <StatusIcon status={f.status} className="mt-0.5 size-4" />
                    <span className="min-w-0">
                      <span className="font-medium">{f.title}</span>
                      {f.value && <span className="block truncate font-mono text-xs text-muted">{f.value}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <details className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
            <summary className="cursor-pointer select-none text-ink-2">Show all {SCAN_STEPS.length} probes</summary>
            <div className="mt-2">
              <ScanChecklist steps={steps} />
            </div>
          </details>

          <Card className="bg-surface-2">
            <div className="flex gap-3">
              <ScanSmileyIcon weight="duotone" className="mt-0.5 size-6 shrink-0 text-accent" aria-hidden />
              <p className="text-sm text-ink-2">
                Next, a <strong className="text-ink">1-second camera test</strong>. Hold your phone at face height and look at the screen — it will flash a few
                colours while the camera checks that it is a real sensor. {prelim && "Motion access may be requested on iPhone."}
              </p>
            </div>
          </Card>

          <Button data-track="continue-device" onClick={onContinue}>
            Continue <ArrowRightIcon weight="bold" className="size-5" aria-hidden />
          </Button>
        </>
      )}
    </div>
  );
}
