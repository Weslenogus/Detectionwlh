import type { Add, Ctx } from "../context";
import { fmt } from "../context";

export function sensorRules(c: Ctx, add: Add) {
  const { claims } = c;
  const m = c.motion;
  const perm = c.bundle.motion?.permission ?? "pending";
  const statsTxt = `${m.samples} samples${m.rateHz ? ` @ ${m.rateHz} Hz` : ""}${m.gravityMagnitude ? ` · |g| ${fmt(m.gravityMagnitude)} m/s²` : ""}${m.noise !== null ? ` · noise ${fmt(m.noise, 4)}` : ""}${m.quantum !== null ? ` · step ${fmt(m.quantum, 4)}` : ""}`;

  switch (m.verdict) {
    case "physical":
      add({
        id: "sensors.motion",
        title: "Accelerometer / gyroscope",
        value: statsTxt,
        detail: "Live MEMS readings with gravity and a natural noise floor — a physical inertial sensor is attached to this screen.",
        status: "pass",
        evidence: { phone: 2.4, tablet: 1.8, emulator: -2.0, spoofed: -2.6, desktop: -2.6, automation: -2.2 },
      });
      break;
    case "resting":
      add({
        id: "sensors.motion",
        title: "Accelerometer / gyroscope",
        value: statsTxt,
        detail: "Sensors report but the readings are constant at the browser's rounding step. Either the device is resting on a table or the values are emulated; hold the phone to get a stronger signal.",
        status: "warn",
        evidence: { phone: 0.6, tablet: 0.6, emulator: 0.3, spoofed: -0.5, desktop: -1.2, automation: -0.8 },
      });
      break;
    case "synthetic":
      add({
        id: "sensors.motion",
        title: "Accelerometer / gyroscope",
        value: statsTxt,
        detail: m.orientationRoundPreset
          ? "Orientation is pinned to round preset angles with zero jitter — a DevTools/emulator sensor override."
          : "Readings are full-precision yet perfectly constant or perfectly smooth. Real MEMS sensors always jitter — these values are generated.",
        status: "fail",
        evidence: { emulator: 2.5, spoofed: 2.0, phone: -2.5, tablet: -2.2 },
      });
      break;
    case "null-sensors":
      add({
        id: "sensors.motion",
        title: "Accelerometer / gyroscope",
        value: "events fire with null values",
        detail: "The browser fires motion events but has no sensor to fill them — the behaviour of a desktop computer.",
        status: claims.mobile ? "fail" : "info",
        evidence: claims.mobile ? { spoofed: 2.0, desktop: 0.8, automation: 0.5, phone: -2.0, tablet: -1.5 } : { desktop: 0.8, phone: -1.0, tablet: -0.8 },
      });
      break;
    case "absent": {
      const iosPending = claims.ios && perm !== "granted";
      add({
        id: "sensors.motion",
        title: "Accelerometer / gyroscope",
        value: iosPending ? "awaiting iOS motion permission" : "no events",
        detail: iosPending
          ? "iOS only streams motion data after the user grants permission."
          : claims.mobile
            ? "No motion events at all. Real phones stream them continuously in secure contexts."
            : "No motion hardware reported.",
        status: iosPending ? "info" : claims.mobile ? "warn" : "info",
        evidence: iosPending ? {} : claims.android ? { spoofed: 1.0, emulator: 0.3, phone: -0.8, tablet: -0.6 } : claims.mobile ? { spoofed: 0.5, phone: -0.4 } : { desktop: 0.3 },
      });
      break;
    }
    case "denied":
      add({ id: "sensors.motion", title: "Accelerometer / gyroscope", value: "permission denied", detail: "The user declined motion access.", status: "info" });
      break;
    default:
      add({ id: "sensors.motion", title: "Accelerometer / gyroscope", value: statsTxt, detail: "Too few samples to judge.", status: "info" });
  }

  if (m.consistencyErrorDeg !== null) {
    const good = m.consistencyErrorDeg < 20;
    const bad = m.consistencyErrorDeg > 40;
    add({
      id: "sensors.consistency",
      title: "Gravity ↔ orientation agreement",
      value: `${fmt(m.consistencyErrorDeg, 1)}° median error over ${m.consistencyPairs} pairs`,
      detail: good
        ? "The tilt implied by the gravity vector matches the Euler angles from the orientation stream, as physics requires."
        : bad
          ? "The orientation angles contradict the gravity vector — the two streams are generated independently."
          : "Moderate disagreement (fast motion or calibration).",
      status: good ? "pass" : bad ? "fail" : "info",
      evidence: good ? { phone: 1.0, tablet: 0.8, emulator: -0.6, spoofed: -1.0 } : bad ? { spoofed: 1.5, emulator: 1.2, phone: -1.2, tablet: -1.0 } : {},
    });
  }

  if (m.compass) {
    add({
      id: "sensors.compass",
      title: "Magnetometer (compass heading)",
      value: "present",
      detail: "iOS delivered a calibrated compass heading from a physical magnetometer.",
      status: "pass",
      evidence: { phone: 0.8, tablet: 0.6, emulator: -0.6, spoofed: -1.0 },
    });
  }
  if ((c.bundle.motion?.absoluteOrientationEvents ?? 0) > 0) {
    add({
      id: "sensors.absolute",
      title: "Absolute orientation (sensor fusion)",
      value: `${c.bundle.motion?.absoluteOrientationEvents} events`,
      detail: "Earth-referenced orientation requires a magnetometer fused with accelerometer and gyroscope.",
      status: "pass",
      evidence: { phone: 0.5, tablet: 0.4, spoofed: -0.6 },
    });
  }
  if (m.handheld !== "unknown") {
    add({
      id: "sensors.handheld",
      title: "Handling",
      value: m.handheld === "handheld" ? `hand-held (tilt σ ${fmt(m.tiltVariationDeg, 2)}°)` : "resting / very still",
      detail: "Micro-tilt from physiological tremor indicates a device held in a hand.",
      status: "info",
      evidence: m.handheld === "handheld" && m.verdict === "physical" ? { phone: 0.4 } : {},
    });
  }

  const acc = m.generic.accelerometer;
  if (acc.state === "ok" && acc.samples >= 10) {
    add({
      id: "sensors.generic",
      title: "Generic Sensor API accelerometer",
      value: `${acc.samples} readings · |a| ${fmt(acc.magnitude)} m/s²${acc.static ? " · static" : ""}`,
      detail: acc.static ? "Hardware sensor reachable; readings constant at rounding precision." : "Hardware accelerometer reachable through the Generic Sensor API.",
      status: acc.static ? "info" : "pass",
      evidence: acc.static ? { phone: 0.3, tablet: 0.3, desktop: -0.5 } : { phone: 1.0, tablet: 0.8, spoofed: -1.2, desktop: -1.2 },
    });
  } else if (acc.state === "error" && claims.android && c.engine === "Blink") {
    const err = c.bundle.motion?.accelerometer.error ?? "";
    const noHw = /NotReadable|not.*available|could not connect/i.test(err);
    add({
      id: "sensors.generic",
      title: "Generic Sensor API accelerometer",
      value: err || "error",
      detail: noHw ? "Chromium could not connect to any accelerometer — the host has no sensor hardware." : "Sensor start failed.",
      status: noHw ? "fail" : "warn",
      evidence: noHw ? { spoofed: 1.8, phone: -1.5, tablet: -1.2 } : { spoofed: 0.3 },
    });
  } else if (acc.state !== "unsupported") {
    add({ id: "sensors.generic", title: "Generic Sensor API accelerometer", value: acc.state, detail: c.bundle.motion?.accelerometer.error ?? "Recorded.", status: "info" });
  }
}
