/** Camera label knowledge: virtual cameras, capture cards, synthetic feeds and platform naming schemes. */

export type CameraLabelKind =
  | "virtual"
  | "capture-card"
  | "synthetic"
  | "android"
  | "ios"
  | "continuity"
  | "desktop-webcam"
  | "unknown";

export interface CameraLabelMatch {
  kind: CameraLabelKind;
  product: string | null;
}

const VIRTUAL: [RegExp, string][] = [
  [/OBS/i, "OBS Virtual Camera"],
  [/ManyCam/i, "ManyCam"],
  [/Snap Camera/i, "Snap Camera"],
  [/XSplit/i, "XSplit VCam"],
  [/SplitCam/i, "SplitCam"],
  [/e2eSoft|\bVCam\b/i, "e2eSoft VCam"],
  [/CamTwist/i, "CamTwist"],
  [/YouCam/i, "CyberLink YouCam"],
  [/DroidCam/i, "DroidCam"],
  [/iVCam/i, "iVCam"],
  [/EpocCam/i, "EpocCam"],
  [/Iriun/i, "Iriun Webcam"],
  [/\bNDI\b/i, "NDI Virtual Input"],
  [/vMix/i, "vMix"],
  [/Streamlabs/i, "Streamlabs"],
  [/mmhmm/i, "mmhmm"],
  [/\bCamo\b/i, "Reincubate Camo"],
  [/NVIDIA Broadcast/i, "NVIDIA Broadcast"],
  [/Logi Capture/i, "Logi Capture"],
  [/ChromaCam/i, "ChromaCam"],
  [/FaceRig|Animaze/i, "FaceRig / Animaze"],
  [/AlterCam/i, "AlterCam"],
  [/Webcamoid/i, "Webcamoid"],
  [/v4l2loopback|Dummy video device|loopback/i, "v4l2loopback"],
  [/Unity Video Capture/i, "Unity Video Capture"],
  [/Wirecast/i, "Wirecast"],
  [/Elgato Virtual|Camera Hub/i, "Elgato Virtual Camera"],
  [/Virtual/i, "Generic virtual camera"],
];

const CAPTURE: [RegExp, string][] = [
  [/Cam Link|Game Capture|HD60/i, "Elgato capture device"],
  [/AVerMedia|Live Gamer/i, "AVerMedia capture device"],
  [/UltraStudio|Blackmagic|DeckLink/i, "Blackmagic capture device"],
  [/Magewell/i, "Magewell capture device"],
  [/HDMI|Capture Card|Video Capture/i, "HDMI capture device"],
];

const SYNTHETIC: [RegExp, string][] = [
  [/fake_device|Fake Video|fake video|file_capture|\.y4m|\.mjpeg/i, "Chromium fake capture device"],
];

const ANDROID = /^camera\d?\s*\d+,\s*facing\s+(front|back|external)/i;
const IOS =
  /^(Front|Back)( (Dual|Dual Wide|Triple|Ultra Wide|Telephoto|TrueDepth))? Camera$|^(Caméra|Cámara|Câmera|Fotocamera|Frontkamera|Rückkamera|Kamera)/i;
const CONTINUITY = /iPhone.*Camera|Desk View|Continuity/i;
const DESKTOP =
  /FaceTime|Integrated|Webcam|HD Camera|USB|Logitech|\bLogi\b|Razer|LifeCam|Lenovo|\bHP\b|TrueVision|Dell|Surface Camera|Chicony|Realtek|Sonix|Azurewave|IR Camera|Windows Hello|Brio|\bC9\d{2}\b|Kiyo|Insta360|OBSBOT|Anker|\([0-9a-f]{4}:[0-9a-f]{4}\)/i;

export function classifyCameraLabel(label: string): CameraLabelMatch {
  const l = label.trim();
  if (!l) return { kind: "unknown", product: null };
  for (const [re, p] of SYNTHETIC) if (re.test(l)) return { kind: "synthetic", product: p };
  // Continuity (a real iPhone used as a Mac webcam) must be tested before the "Virtual" catch-all.
  if (CONTINUITY.test(l)) return { kind: "continuity", product: "macOS Continuity Camera" };
  for (const [re, p] of VIRTUAL) if (re.test(l)) return { kind: "virtual", product: p };
  for (const [re, p] of CAPTURE) if (re.test(l)) return { kind: "capture-card", product: p };
  if (ANDROID.test(l)) return { kind: "android", product: "Android Camera2" };
  if (IOS.test(l)) return { kind: "ios", product: "iOS AVFoundation" };
  if (DESKTOP.test(l)) return { kind: "desktop-webcam", product: null };
  return { kind: "unknown", product: null };
}

/** USB webcams on desktop Chromium get a "(vid:pid)" suffix — a hard desktop tell. */
export const hasUsbIds = (label: string) => /\([0-9a-f]{4}:[0-9a-f]{4}\)/i.test(label);

/** Facing inferred from label when capabilities are unavailable. */
export function facingFromLabel(label: string): "front" | "back" | null {
  if (/facing front|^front|avant|frontal|anteriore|Frontkamera/i.test(label)) return "front";
  if (/facing back|^back|arrière|trasera|traseira|posteriore|Rückkamera|rear/i.test(label)) return "back";
  return null;
}

/** Capabilities a real sensor typically exposes but virtual/injected tracks almost never do. */
export const HARDWARE_CAPABILITY_KEYS = [
  "focusMode",
  "focusDistance",
  "exposureMode",
  "exposureTime",
  "exposureCompensation",
  "whiteBalanceMode",
  "colorTemperature",
  "iso",
  "zoom",
  "torch",
  "pointsOfInterest",
  "brightness",
  "contrast",
  "saturation",
  "sharpness",
  "backgroundBlur",
];
