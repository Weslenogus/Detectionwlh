/** Feature switches (NEXT_PUBLIC_* variables are inlined at build time). */
export const DETECTION_CONFIG = {
  /** Ask for a GNSS position on the first Continue tap (GPS-vs-IP distance, receiver type). */
  requestGeolocation: process.env.NEXT_PUBLIC_REQUEST_GEOLOCATION !== "false",
  /** Active 3D liveness: a server-randomised head-turn challenge after the 1-second capture. */
  activeLiveness: process.env.NEXT_PUBLIC_ACTIVE_LIVENESS !== "false",
  /** Time allowed to complete the head turns, in milliseconds. */
  poseTimeoutMs: 9000,
  /** Length of the measured camera window, in milliseconds. */
  cameraCaptureMs: 1000,
};
