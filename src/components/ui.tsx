import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { FindingStatus } from "@/lib/detection/types";

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

export const STATUS_META: Record<FindingStatus, { label: string; ink: string; wash: string; Icon: typeof CircleCheck }> = {
  pass: { label: "Supports phone", ink: "text-good-ink", wash: "bg-good-wash", Icon: CircleCheck },
  warn: { label: "Suspicious", ink: "text-warn-ink", wash: "bg-warn-wash", Icon: TriangleAlert },
  fail: { label: "Contradicts phone", ink: "text-bad-ink", wash: "bg-bad-wash", Icon: CircleX },
  info: { label: "Informational", ink: "text-muted", wash: "bg-surface-2", Icon: Info },
};

export function StatusIcon({ status, className }: { status: FindingStatus; className?: string }) {
  const { Icon, ink, label } = STATUS_META[status];
  return <Icon aria-label={label} role="img" className={cx("shrink-0", ink, className ?? "size-4")} strokeWidth={2.2} />;
}

export function StatusPill({ status, children }: { status: FindingStatus; children?: ReactNode }) {
  const m = STATUS_META[status];
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", m.wash, m.ink)}>
      <m.Icon className="size-3.5" strokeWidth={2.4} aria-hidden />
      {children ?? m.label}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-2xl border border-line bg-surface p-4 sm:p-5", className)}>{children}</section>;
}

export function Button({
  children,
  variant = "primary",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" ? "bg-accent text-accent-ink hover:brightness-110" : "border border-line bg-surface text-ink hover:bg-surface-2",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Meter: the fill carries the value, the track is a lighter step of the same ramp. */
export function Meter({ value, label, className }: { value: number; label: string; className?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className={cx("h-2 w-full overflow-hidden rounded-full bg-accent-track", className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function KV({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className={cx("truncate text-sm font-medium text-ink", mono && "font-mono text-[13px]")} title={typeof v === "string" ? v : undefined}>
        {v ?? "—"}
      </dd>
    </div>
  );
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const p = v * 100;
  if (p > 0 && p < 0.1) return "<0.1%";
  if (p > 99.9 && p < 100) return ">99.9%";
  return `${Math.round(p * 10 ** digits) / 10 ** digits}%`;
}
