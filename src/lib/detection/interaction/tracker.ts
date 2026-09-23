import type { ClickRecord, InteractionSignals, PointerRecord, TouchRecord } from "../types";

const MAX = 160;

const trackId = (t: EventTarget | null): string | null => {
  const el = t instanceof Element ? t.closest("[data-track]") : null;
  return el?.getAttribute("data-track") ?? null;
};

/**
 * Passive, privacy-light interaction recorder: no coordinates are uploaded at
 * finer than 1px and no keystroke content is ever read — only event physics
 * (contact size, pressure, trust flag, timing).
 */
export class InteractionTracker {
  private t0 = performance.now();
  private pointers: PointerRecord[] = [];
  private touches: TouchRecord[] = [];
  private clicks: ClickRecord[] = [];
  private counts = { hoverMouseMoves: 0, pointerMoves: 0, touchStarts: 0, wheel: 0, keys: 0 };
  private lastDown: { t: number; type: string } | null = null;
  private lastHold: number | null = null;
  private attached = false;

  private now = () => Math.round(performance.now() - this.t0);

  private onPointer = (e: PointerEvent) => {
    if (e.type === "pointermove") {
      this.counts.pointerMoves++;
      if (e.pointerType === "mouse" && e.buttons === 0) this.counts.hoverMouseMoves++;
      return;
    }
    if (e.type === "pointerdown") this.lastDown = { t: performance.now(), type: e.pointerType };
    if (e.type === "pointerup" && this.lastDown) this.lastHold = Math.round(performance.now() - this.lastDown.t);
    if (this.pointers.length >= MAX) return;
    this.pointers.push({
      type: e.type,
      pointerType: e.pointerType,
      isTrusted: e.isTrusted,
      width: Math.round((e.width ?? 0) * 100) / 100,
      height: Math.round((e.height ?? 0) * 100) / 100,
      pressure: Math.round((e.pressure ?? 0) * 1000) / 1000,
      tiltX: e.tiltX ?? 0,
      tiltY: e.tiltY ?? 0,
      t: this.now(),
      x: Math.round(e.clientX),
      y: Math.round(e.clientY),
      buttons: e.buttons,
      target: trackId(e.target),
    });
  };

  private onTouch = (e: TouchEvent) => {
    if (e.type === "touchstart") this.counts.touchStarts++;
    if (this.touches.length >= MAX) return;
    const t = e.changedTouches[0] as (Touch & { touchType?: string }) | undefined;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
    this.touches.push({
      type: e.type,
      isTrusted: e.isTrusted,
      radiusX: num(t?.radiusX),
      radiusY: num(t?.radiusY),
      force: num(t?.force),
      rotationAngle: num(t?.rotationAngle),
      touchType: t?.touchType ?? null,
      t: this.now(),
      touches: e.touches.length,
    });
  };

  private onClick = (e: MouseEvent) => {
    if (this.clicks.length >= MAX) return;
    const recent = this.lastDown && performance.now() - this.lastDown.t < 2000;
    this.clicks.push({
      t: this.now(),
      isTrusted: e.isTrusted,
      detail: e.detail,
      pointerType: (e as PointerEvent).pointerType || (recent ? this.lastDown!.type : null),
      target: trackId(e.target),
      precededByPointerDown: Boolean(recent),
      holdMs: recent ? this.lastHold : null,
    });
  };

  private onWheel = () => {
    this.counts.wheel++;
  };
  private onKey = () => {
    this.counts.keys++;
  };

  attach() {
    if (this.attached || typeof window === "undefined") return;
    this.attached = true;
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    for (const t of ["pointerdown", "pointerup", "pointermove"]) document.addEventListener(t, this.onPointer as EventListener, opts);
    for (const t of ["touchstart", "touchend"]) document.addEventListener(t, this.onTouch as EventListener, opts);
    document.addEventListener("click", this.onClick, opts);
    document.addEventListener("wheel", this.onWheel, opts);
    document.addEventListener("keydown", this.onKey, opts);
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    const opts: EventListenerOptions = { capture: true };
    for (const t of ["pointerdown", "pointerup", "pointermove"]) document.removeEventListener(t, this.onPointer as EventListener, opts);
    for (const t of ["touchstart", "touchend"]) document.removeEventListener(t, this.onTouch as EventListener, opts);
    document.removeEventListener("click", this.onClick, opts);
    document.removeEventListener("wheel", this.onWheel, opts);
    document.removeEventListener("keydown", this.onKey, opts);
  }

  snapshot(): InteractionSignals {
    return {
      pointers: [...this.pointers],
      touches: [...this.touches],
      clicks: [...this.clicks],
      counts: { ...this.counts },
    };
  }
}
