import type { BehaviorSignals, ClickRecord, InteractionSignals, PointerRecord, TouchRecord } from "../types";

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
  private behavior = {
    hiddenCount: 0,
    hiddenMs: 0,
    hiddenSince: null as number | null,
    blurCount: 0,
    pastes: 0,
    copies: 0,
    resizes: 0,
    orientationChanges: 0,
    hiddenDuringCamera: false,
  };
  private marks: Record<string, number> = {};
  private cameraActive = false;

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

  private onVisibility = () => {
    const b = this.behavior;
    if (document.visibilityState === "hidden") {
      b.hiddenCount++;
      b.hiddenSince = performance.now();
      if (this.cameraActive) b.hiddenDuringCamera = true;
    } else if (b.hiddenSince !== null) {
      b.hiddenMs += performance.now() - b.hiddenSince;
      b.hiddenSince = null;
    }
  };
  private onBlur = () => {
    this.behavior.blurCount++;
  };
  private onPaste = () => {
    this.behavior.pastes++;
  };
  private onCopy = () => {
    this.behavior.copies++;
  };
  private onResize = () => {
    this.behavior.resizes++;
  };
  private onOrientation = () => {
    this.behavior.orientationChanges++;
  };

  /** Timestamp a flow milestone (e.g. "continue-device-shown"), relative to tracker start. */
  mark(name: string) {
    this.marks[name] = this.now();
    if (name === "camera-start") this.cameraActive = true;
    if (name === "camera-end") this.cameraActive = false;
  }

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
    document.addEventListener("visibilitychange", this.onVisibility);
    document.addEventListener("paste", this.onPaste, opts);
    document.addEventListener("copy", this.onCopy, opts);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("resize", this.onResize, { passive: true });
    window.addEventListener("orientationchange", this.onOrientation);
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
    document.removeEventListener("visibilitychange", this.onVisibility);
    document.removeEventListener("paste", this.onPaste, opts);
    document.removeEventListener("copy", this.onCopy, opts);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("orientationchange", this.onOrientation);
  }

  snapshot(): InteractionSignals {
    const b = this.behavior;
    const nav = (performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined)?.type ?? null;
    const behavior: BehaviorSignals = {
      navigationType: nav,
      pageAgeMs: Math.round(performance.now()),
      hiddenCount: b.hiddenCount,
      hiddenMs: Math.round(b.hiddenMs + (b.hiddenSince !== null ? performance.now() - b.hiddenSince : 0)),
      blurCount: b.blurCount,
      pastes: b.pastes,
      copies: b.copies,
      resizes: b.resizes,
      orientationChanges: b.orientationChanges,
      marks: { ...this.marks },
      hiddenDuringCamera: b.hiddenDuringCamera,
    };
    return {
      pointers: [...this.pointers],
      touches: [...this.touches],
      clicks: [...this.clicks],
      counts: { ...this.counts },
      behavior,
    };
  }
}
