"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { CategorySummary, Finding } from "@/lib/detection/types";
import { Card, cx, Meter, pct, StatusIcon, StatusPill, STATUS_META } from "../ui";

function evidenceLine(f: Finding): string | null {
  const parts = Object.entries(f.evidence)
    .filter(([, v]) => v && Math.abs(v) >= 0.3)
    .sort((a, b) => Math.abs(b[1]!) - Math.abs(a[1]!))
    .slice(0, 3)
    .map(([k, v]) => `${k} ${v! > 0 ? "+" : "−"}${Math.abs(v!).toFixed(1)}`);
  const cam = Object.entries(f.cameraEvidence ?? {})
    .filter(([, v]) => v && Math.abs(v) >= 0.3)
    .sort((a, b) => Math.abs(b[1]!) - Math.abs(a[1]!))
    .slice(0, 2)
    .map(([k, v]) => `cam:${k} ${v! > 0 ? "+" : "−"}${Math.abs(v!).toFixed(1)}`);
  const all = [...parts, ...cam];
  return all.length ? all.join(" · ") : null;
}

export function FindingRow({ f }: { f: Finding }) {
  const [open, setOpen] = useState(false);
  const ev = evidenceLine(f);
  return (
    <li className="border-t border-line first:border-t-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-2.5 py-2.5 text-left">
        <StatusIcon status={f.status} className="mt-0.5 size-4" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">{f.title}</span>
          {f.value && <span className={cx("block font-mono text-xs text-ink-2", !open && "truncate")}>{f.value}</span>}
        </span>
        <ChevronDown className={cx("mt-0.5 size-4 shrink-0 text-muted transition", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="-mt-1 pb-3 pl-6.5 text-sm text-ink-2">
          <p>{f.detail}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className={cx("font-medium", STATUS_META[f.status].ink)}>{STATUS_META[f.status].label}</span>
            {ev && <span className="font-mono">log-odds: {ev}</span>}
          </p>
        </div>
      )}
    </li>
  );
}

export function CategoryCard({ c }: { c: CategorySummary }) {
  const [all, setAll] = useState(false);
  const important = c.findings.filter((f) => f.status !== "info" || f.weight >= 0.5);
  const shown = all ? c.findings : important.length ? important : c.findings.slice(0, 3);
  const hidden = c.findings.length - shown.length;
  return (
    <Card className="p-0 sm:p-0">
      <div className="p-4 pb-2 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold">{c.title}</h3>
            <p className="text-xs text-muted">{c.description}</p>
          </div>
          <StatusPill status={c.status}>{c.findings.length} checks</StatusPill>
        </div>
        {c.phoneLikelihood !== null && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-muted">Phone likelihood from this category alone</span>
              <span className="font-semibold tabular">{pct(c.phoneLikelihood)}</span>
            </div>
            <Meter value={c.phoneLikelihood} label={`${c.title} phone likelihood`} />
          </div>
        )}
      </div>
      <ul className="px-4 sm:px-5">
        {shown.map((f) => (
          <FindingRow key={f.id} f={f} />
        ))}
      </ul>
      {hidden > 0 && (
        <button type="button" onClick={() => setAll(true)} className="w-full border-t border-line px-4 py-2.5 text-left text-xs font-medium text-accent sm:px-5">
          Show {hidden} informational check{hidden > 1 ? "s" : ""}
        </button>
      )}
    </Card>
  );
}
