"use client";

import {
  BatteryChargingIcon,
  CheckIcon,
  CompassIcon,
  CpuIcon,
  CubeIcon,
  DetectiveIcon,
  DeviceMobileIcon,
  FilmStripIcon,
  FingerprintIcon,
  GlobeHemisphereWestIcon,
  GraphicsCardIcon,
  RobotIcon,
  ShieldCheckIcon,
  StackIcon,
  TextAaIcon,
  WarningIcon,
  type Icon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ScanStepId, StepStatus } from "@/lib/detection/collect";
import { cx } from "../ui";

export const PROBE_ICONS: Record<ScanStepId, Icon> = {
  identity: FingerprintIcon,
  display: DeviceMobileIcon,
  cpu: CpuIcon,
  gpu: GraphicsCardIcon,
  webgpu: CubeIcon,
  platform: StackIcon,
  fingerprint: TextAaIcon,
  media: FilmStripIcon,
  environment: BatteryChargingIcon,
  network: GlobeHemisphereWestIcon,
  automation: RobotIcon,
  privacy: DetectiveIcon,
  integrity: ShieldCheckIcon,
  sensors: CompassIcon,
};

/** Animated hero: a phone being swept by a scan line inside pulsing rings. */
export function ScanHero({ progress, done }: { progress: number; done: boolean }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative flex size-16 shrink-0 items-center justify-center">
      {!done &&
        !reduce &&
        [0, 1].map((i) => (
          <motion.span
            key={i}
            aria-hidden
            className="absolute inset-0 rounded-2xl border border-accent"
            initial={{ opacity: 0.5, scale: 0.85 }}
            animate={{ opacity: 0, scale: 1.45 }}
            transition={{ duration: 2, repeat: Infinity, delay: i, ease: "easeOut" }}
          />
        ))}
      <motion.div
        className="relative flex size-16 items-center justify-center overflow-hidden rounded-2xl bg-info-wash text-accent"
        animate={{ scale: done ? [1, 1.06, 1] : 1 }}
        transition={{ duration: 0.4 }}
      >
        <DeviceMobileIcon weight="duotone" className="size-9" aria-hidden />
        {!done && !reduce && (
          <motion.span
            aria-hidden
            className="absolute inset-x-2 h-0.5 rounded-full bg-accent shadow-[0_0_12px_2px_var(--accent)]"
            initial={{ top: "18%" }}
            animate={{ top: ["18%", "82%", "18%"] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <AnimatePresence>
          {done && (
            <motion.span
              key="ok"
              className="absolute bottom-1 right-1 flex size-5 items-center justify-center rounded-full bg-accent text-white"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 18 }}
            >
              <CheckIcon weight="bold" className="size-3" aria-hidden />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
      <span className="sr-only">{done ? "Scan complete" : `Scanning, ${Math.round(progress * 100)}%`}</span>
    </div>
  );
}

/** Thin animated progress bar (fill carries the value, track is a lighter step of the same hue). */
export function ScanProgress({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${Math.max(0.03, value) * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
    </div>
  );
}

/** One probe row: category icon tile whose state (pending / running / done / warning) animates. */
export function ProbeTile({ id, status }: { id: ScanStepId; status: StepStatus }) {
  const IconCmp = PROBE_ICONS[id];
  const reduce = useReducedMotion();
  const tone =
    status === "done"
      ? "bg-good-wash text-good-ink"
      : status === "error"
        ? "bg-warn-wash text-warn-ink"
        : status === "running"
          ? "bg-info-wash text-accent"
          : "bg-surface-2 text-muted";
  return (
    <div className="relative size-9 shrink-0">
      <motion.div
        className={cx("flex size-9 items-center justify-center rounded-xl transition-colors duration-300", tone)}
        animate={{ opacity: status === "pending" ? 0.55 : 1 }}
      >
        <IconCmp weight="duotone" className="size-5" aria-hidden />
      </motion.div>
      {status === "running" && (
        <svg aria-hidden viewBox="0 0 40 40" className="absolute -inset-0.5 size-10">
          <motion.rect
            x="1.5"
            y="1.5"
            width="37"
            height="37"
            rx="11"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="22 78"
            initial={{ strokeDashoffset: 0 }}
            animate={reduce ? undefined : { strokeDashoffset: -100 }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
          />
        </svg>
      )}
      <AnimatePresence>
        {(status === "done" || status === "error") && (
          <motion.span
            key={status}
            className={cx(
              "absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full ring-2 ring-surface",
              status === "done" ? "bg-good text-white" : "bg-warn text-black",
            )}
            initial={{ scale: 0, rotate: -45 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 520, damping: 20 }}
          >
            {status === "done" ? <CheckIcon weight="bold" className="size-2.5" aria-hidden /> : <WarningIcon weight="bold" className="size-2.5" aria-hidden />}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
