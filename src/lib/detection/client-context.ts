import type { ClientContext } from "./types";

const KEY = "dv.device";

/**
 * A random identifier persisted in localStorage — the web equivalent of a
 * device link: the server counts how many identities one browser storage
 * presents. Storage may be unavailable (private mode, blocked): then null.
 */
export function loadClientContext(): Omit<ClientContext, "sentAt"> {
  try {
    const raw = localStorage.getItem(KEY);
    const prev = raw ? (JSON.parse(raw) as { id?: string; runs?: number; first?: number }) : {};
    const id = typeof prev.id === "string" && prev.id.length <= 64 ? prev.id : crypto.randomUUID();
    const next = { id, runs: (typeof prev.runs === "number" ? prev.runs : 0) + 1, first: typeof prev.first === "number" ? prev.first : Date.now() };
    localStorage.setItem(KEY, JSON.stringify(next));
    return { storageId: next.id, runs: next.runs, firstSeenAt: next.first };
  } catch {
    return { storageId: null, runs: 0, firstSeenAt: null };
  }
}
