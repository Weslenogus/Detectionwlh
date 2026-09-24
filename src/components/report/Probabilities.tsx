import type { CameraClass, DeviceClass } from "@/lib/detection/types";
import { cx, pct } from "../ui";

/**
 * Posterior distribution as a ranked bar list: one measure, one hue. The
 * winning hypothesis is full-strength; the rest use the lighter ramp step.
 */
export function ProbBars<K extends string>({ probs, labels, title }: { probs: Record<K, number>; labels: Record<K, string>; title: string }) {
  const rows = (Object.keys(probs) as K[]).map((k) => ({ k, v: probs[k] })).sort((a, b) => b.v - a.v);
  const top = rows[0]?.k;
  return (
    <figure>
      <figcaption className="mb-2 text-sm font-medium">{title}</figcaption>
      <ul className="space-y-2">
        {rows.map(({ k, v }) => (
          <li key={k} className="group grid grid-cols-[8.5rem_1fr_3.5rem] items-center gap-2 text-sm" title={`${labels[k]}: ${pct(v, 2)}`}>
            <span className={cx("truncate", k === top ? "font-semibold text-ink" : "text-ink-2")}>{labels[k]}</span>
            <span className="relative h-3 rounded-r bg-transparent">
              <span
                className={cx("absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-700 group-hover:brightness-110", k === top ? "bg-accent" : "bg-accent-track")}
                style={{ width: `max(2px, ${Math.max(0, Math.min(1, v)) * 100}%)` }}
              />
            </span>
            <span className={cx("text-right tabular", k === top ? "font-semibold text-ink" : "text-muted")}>{pct(v)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export const DEVICE_LABELS: Record<DeviceClass, string> = {
  phone: "Physical phone",
  tablet: "Physical tablet",
  desktop: "Desktop / laptop",
  spoofed: "Spoofed mobile",
  emulator: "Emulator / VM",
  automation: "Automation",
};

export const CAMERA_LABELS: Record<CameraClass, string> = {
  physical: "Physical sensor",
  virtual: "Virtual camera",
  injected: "Injected stream",
  synthetic: "Synthetic feed",
};
