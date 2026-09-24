import type { PlatformApiSignals } from "../types";
import { attempt } from "../util/safe";

/**
 * Browser builds are compiled per platform, so some Web APIs only exist on
 * Android (Web NFC, Contact Picker, window.orientation), some only on iOS
 * (motion permission prompt, -webkit-touch-callout) and some only on desktop
 * (EyeDropper, WebHID, Window Management, Document PiP, Local Font Access...).
 * Device emulation changes the UA, screen and touch — it cannot add or remove
 * compiled-in interfaces. The engine compares this map to what the UA claims.
 */
export const ANDROID_ONLY_APIS = ["NDEFReader", "ContactsManager", "windowOrientation"] as const;
export const IOS_ONLY_APIS = ["motionRequestPermission", "webkitTouchCallout", "ontouchstart", "TouchEvent"] as const;
// Note: navigator.keyboard and showOpenFilePicker (Chrome ≥ 132) also exist on
// Android, so they are recorded but deliberately *not* treated as desktop-only.
export const DESKTOP_ONLY_BLINK_APIS = [
  "EyeDropper",
  "hid",
  "getScreenDetails",
  "documentPictureInPicture",
  "queryLocalFonts",
  "windowControlsOverlay",
] as const;

export function collectPlatformApis(): PlatformApiSignals {
  const w = window as unknown as Record<string, unknown>;
  const n = navigator as unknown as Record<string, unknown>;
  const has = (o: Record<string, unknown>, k: string) => attempt(() => k in o, false);
  const DME = w.DeviceMotionEvent as { requestPermission?: unknown } | undefined;
  const DOE = w.DeviceOrientationEvent as { requestPermission?: unknown } | undefined;
  return {
    // Android-only (Chromium Android / Firefox Android / WebKit iOS for orientation)
    NDEFReader: has(w, "NDEFReader"),
    ContactsManager: has(w, "ContactsManager") || has(n, "contacts"),
    windowOrientation: has(w, "orientation"),
    onorientationchange: has(w, "onorientationchange"),
    ondeviceorientationabsolute: has(w, "ondeviceorientationabsolute"),
    // iOS-only
    motionRequestPermission: typeof DME?.requestPermission === "function",
    orientationRequestPermission: typeof DOE?.requestPermission === "function",
    webkitTouchCallout: attempt(() => CSS.supports("-webkit-touch-callout", "none"), false),
    ontouchstart: has(w, "ontouchstart"),
    TouchEvent: typeof w.TouchEvent === "function",
    GestureEvent: has(w, "GestureEvent"),
    standalone: has(n, "standalone"),
    ApplePaySession: has(w, "ApplePaySession"),
    Notification: has(w, "Notification"),
    // Desktop-only Chromium
    EyeDropper: has(w, "EyeDropper"),
    showOpenFilePicker: has(w, "showOpenFilePicker"),
    showDirectoryPicker: has(w, "showDirectoryPicker"),
    hid: has(n, "hid"),
    getScreenDetails: has(w, "getScreenDetails"),
    documentPictureInPicture: has(w, "documentPictureInPicture"),
    keyboardMap: has(n, "keyboard"),
    queryLocalFonts: has(w, "queryLocalFonts"),
    windowControlsOverlay: has(n, "windowControlsOverlay"),
    // Mixed / informational
    serial: has(n, "serial"),
    usb: has(n, "usb"),
    bluetooth: has(n, "bluetooth"),
    share: has(n, "share"),
    virtualKeyboard: has(n, "virtualKeyboard"),
    wakeLock: has(n, "wakeLock"),
    vibrate: has(n, "vibrate"),
    getInstalledRelatedApps: has(n, "getInstalledRelatedApps"),
    BarcodeDetector: has(w, "BarcodeDetector"),
    FaceDetector: has(w, "FaceDetector"),
    Accelerometer: has(w, "Accelerometer"),
    Gyroscope: has(w, "Gyroscope"),
    Magnetometer: has(w, "Magnetometer"),
    AbsoluteOrientationSensor: has(w, "AbsoluteOrientationSensor"),
    AmbientLightSensor: has(w, "AmbientLightSensor"),
    IdleDetector: has(w, "IdleDetector"),
    SharedWorker: has(w, "SharedWorker"),
    ImageCapture: has(w, "ImageCapture"),
    MediaStreamTrackProcessor: has(w, "MediaStreamTrackProcessor"),
    VideoFrame: has(w, "VideoFrame"),
    requestVideoFrameCallback: attempt(() => "requestVideoFrameCallback" in HTMLVideoElement.prototype, false),
    PaymentRequest: has(w, "PaymentRequest"),
    webkitSpeechRecognition: has(w, "webkitSpeechRecognition"),
  };
}
