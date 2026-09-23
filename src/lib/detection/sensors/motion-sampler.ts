import type { GenericSensorSignals, MotionSample, MotionSignals, OrientationSample, Vec3Sample } from "../types";
import { errorMessage } from "../util/safe";

const MAX_SAMPLES = 900;
const SNAPSHOT_SAMPLES = 360;

const r5 = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e5) / 1e5 : null;

type PermissionResult = MotionSignals["permission"];

/**
 * iOS 13+ gates motion/orientation behind a permission prompt that can only be
 * requested from a user gesture. Both calls must happen synchronously inside
 * the click handler, before any `await`.
 */
export function requestMotionPermission(): Promise<{ state: PermissionResult; error?: string }> {
  const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
  const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } })
    .DeviceOrientationEvent;
  if (!DME && !DOE) return Promise.resolve({ state: "unavailable" });
  if (typeof DME?.requestPermission !== "function") return Promise.resolve({ state: "not-required" });
  try {
    const p1 = DME.requestPermission();
    const p2 = typeof DOE?.requestPermission === "function" ? DOE.requestPermission() : Promise.resolve("granted");
    return Promise.all([p1, p2]).then(
      ([a]) => ({ state: a === "granted" ? "granted" : "denied" }) as { state: PermissionResult },
      (e) => ({ state: "error" as PermissionResult, error: errorMessage(e) }),
    );
  } catch (e) {
    return Promise.resolve({ state: "error", error: errorMessage(e) });
  }
}

export function motionPermissionRequired(): boolean {
  const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: unknown } }).DeviceMotionEvent;
  return typeof DME?.requestPermission === "function";
}

type SensorCtor = new (opts: { frequency: number }) => {
  x?: number;
  y?: number;
  z?: number;
  start(): void;
  stop(): void;
  addEventListener(t: string, cb: (e: Event) => void): void;
};

class GenericSensorRecorder {
  data: GenericSensorSignals = { state: "unsupported", readings: [] };
  private sensor: InstanceType<SensorCtor> | null = null;

  constructor(private name: "Accelerometer" | "Gyroscope") {}

  async start(t0: number) {
    const Ctor = (window as unknown as Record<string, SensorCtor | undefined>)[this.name];
    if (!Ctor) return;
    try {
      const perm = await navigator.permissions
        ?.query({ name: this.name.toLowerCase() as PermissionName })
        .catch(() => null);
      if (perm?.state === "denied") {
        this.data.state = "denied";
        return;
      }
      const s = new Ctor({ frequency: 60 });
      this.sensor = s;
      this.data.state = "timeout";
      s.addEventListener("reading", () => {
        this.data.state = "ok";
        if (this.data.readings.length >= MAX_SAMPLES) this.data.readings.shift();
        this.data.readings.push([Math.round(performance.now() - t0), r5(s.x) ?? 0, r5(s.y) ?? 0, r5(s.z) ?? 0] as Vec3Sample);
      });
      s.addEventListener("error", (e: Event) => {
        const err = (e as unknown as { error?: Error }).error;
        this.data.state = err?.name === "NotAllowedError" || err?.name === "SecurityError" ? "denied" : "error";
        this.data.error = err ? `${err.name}: ${err.message}` : "sensor error";
      });
      s.start();
    } catch (e) {
      this.data.state = "error";
      this.data.error = errorMessage(e);
    }
  }

  stop() {
    try {
      this.sensor?.stop();
    } catch {
      /* ignore */
    }
  }
}

/** Continuously records motion, orientation and Generic Sensor API readings. */
export class MotionSampler {
  private t0 = performance.now();
  private running = false;
  private motion: MotionSample[] = [];
  private orientation: OrientationSample[] = [];
  private motionEvents = 0;
  private motionNullEvents = 0;
  private orientationEvents = 0;
  private orientationNullEvents = 0;
  private absoluteEvents = 0;
  private orientationAbsolute: boolean | null = null;
  private motionInterval: number | null = null;
  private permission: PermissionResult = "pending";
  private permissionError?: string;
  private accel = new GenericSensorRecorder("Accelerometer");
  private gyro = new GenericSensorRecorder("Gyroscope");

  private onMotion = (e: DeviceMotionEvent) => {
    this.motionEvents++;
    const a = e.acceleration;
    const g = e.accelerationIncludingGravity;
    const r = e.rotationRate;
    if (typeof e.interval === "number") this.motionInterval = e.interval;
    const sample: MotionSample = [
      Math.round(performance.now() - this.t0),
      r5(a?.x),
      r5(a?.y),
      r5(a?.z),
      r5(g?.x),
      r5(g?.y),
      r5(g?.z),
      r5(r?.alpha),
      r5(r?.beta),
      r5(r?.gamma),
    ];
    if (sample.slice(1).every((v) => v === null)) {
      this.motionNullEvents++;
      return;
    }
    if (this.motion.length >= MAX_SAMPLES) this.motion.shift();
    this.motion.push(sample);
  };

  private onOrientation = (e: DeviceOrientationEvent) => {
    this.orientationEvents++;
    this.orientationAbsolute = e.absolute;
    const heading = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
    const sample: OrientationSample = [Math.round(performance.now() - this.t0), r5(e.alpha), r5(e.beta), r5(e.gamma), r5(heading)];
    if (sample[1] === null && sample[2] === null && sample[3] === null) {
      this.orientationNullEvents++;
      return;
    }
    if (this.orientation.length >= MAX_SAMPLES) this.orientation.shift();
    this.orientation.push(sample);
  };

  private onAbsolute = (e: DeviceOrientationEvent) => {
    // Desktop Chromium fires a single all-null event to signal "no sensor".
    if (e.alpha !== null || e.beta !== null || e.gamma !== null) this.absoluteEvents++;
  };

  setPermission(state: PermissionResult, error?: string) {
    this.permission = state;
    this.permissionError = error;
  }

  start() {
    if (this.running) return;
    this.running = true;
    if (this.permission === "pending") this.permission = motionPermissionRequired() ? "pending" : "not-required";
    window.addEventListener("devicemotion", this.onMotion);
    window.addEventListener("deviceorientation", this.onOrientation);
    window.addEventListener("deviceorientationabsolute", this.onAbsolute as EventListener);
    void this.accel.start(this.t0);
    void this.gyro.start(this.t0);
  }

  /** Re-attach listeners (needed on iOS after permission is granted mid-session). */
  restart() {
    this.stop();
    this.start();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    window.removeEventListener("devicemotion", this.onMotion);
    window.removeEventListener("deviceorientation", this.onOrientation);
    window.removeEventListener("deviceorientationabsolute", this.onAbsolute as EventListener);
    this.accel.stop();
    this.gyro.stop();
  }

  get sampleCount() {
    return this.motion.length + this.orientation.length + this.accel.data.readings.length;
  }

  snapshot(): MotionSignals {
    const lastN = <T>(xs: T[]) => xs.slice(-SNAPSHOT_SAMPLES);
    return {
      permission: this.permission,
      permissionError: this.permissionError,
      startedAt: Math.round(this.t0),
      durationMs: Math.round(performance.now() - this.t0),
      motionEvents: this.motionEvents,
      motionNullEvents: this.motionNullEvents,
      motionInterval: this.motionInterval,
      motion: lastN(this.motion),
      orientationEvents: this.orientationEvents,
      orientationNullEvents: this.orientationNullEvents,
      orientationAbsolute: this.orientationAbsolute,
      orientation: lastN(this.orientation),
      absoluteOrientationEvents: this.absoluteEvents,
      accelerometer: { ...this.accel.data, readings: lastN(this.accel.data.readings) },
      gyroscope: { ...this.gyro.data, readings: lastN(this.gyro.data.readings) },
    };
  }
}
