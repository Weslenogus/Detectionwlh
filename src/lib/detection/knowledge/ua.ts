/**
 * User-agent parsing. We parse only what the UA *claims*; every claim is later
 * cross-examined against hardware/runtime evidence by the engine.
 */

export type OS =
  | "iOS"
  | "iPadOS"
  | "Android"
  | "HarmonyOS"
  | "Windows"
  | "macOS"
  | "ChromeOS"
  | "Linux"
  | "Unknown";

export type Engine = "Blink" | "WebKit" | "Gecko" | "Unknown";

export interface ParsedUA {
  os: OS;
  osVersion: string | null;
  browser: string;
  browserVersion: string | null;
  engine: Engine;
  mobileToken: boolean;
  claimedForm: "phone" | "tablet" | "desktop" | "unknown";
  model: string | null;
  reducedModel: boolean;
  headless: boolean;
  webview: "android-webview" | "ios-wkwebview" | null;
  inApp: string | null;
  cpuHint: "x86" | "arm" | null;
}

const IN_APP: [RegExp, string][] = [
  [/FBAN|FBAV|FB_IAB|FBIOS/i, "Facebook"],
  [/Instagram/i, "Instagram"],
  [/musical_ly|BytedanceWebview|TikTok|trill_/i, "TikTok"],
  [/Snapchat/i, "Snapchat"],
  [/\bLine\//i, "LINE"],
  [/Twitter|TwitterAndroid/i, "X / Twitter"],
  [/LinkedInApp/i, "LinkedIn"],
  [/Pinterest/i, "Pinterest"],
  [/WhatsApp/i, "WhatsApp"],
  [/MicroMessenger/i, "WeChat"],
  [/Telegram/i, "Telegram"],
  [/GSA\//, "Google App"],
];

function version(ua: string, re: RegExp): string | null {
  const m = ua.match(re);
  return m ? m[1].replace(/_/g, ".") : null;
}

export function parseUA(ua: string): ParsedUA {
  const out: ParsedUA = {
    os: "Unknown",
    osVersion: null,
    browser: "Unknown",
    browserVersion: null,
    engine: "Unknown",
    mobileToken: /\bMobile\b|Mobi\//.test(ua),
    claimedForm: "unknown",
    model: null,
    reducedModel: false,
    headless: /HeadlessChrome|PhantomJS|SlimerJS|Electron\//.test(ua),
    webview: null,
    inApp: null,
    cpuHint: null,
  };

  /* ---------------------------- Operating system ---------------------------- */
  if (/iPhone|iPod/.test(ua)) {
    out.os = "iOS";
    out.osVersion = version(ua, /OS (\d+[_.]\d+(?:[_.]\d+)?)/);
    out.claimedForm = "phone";
  } else if (/iPad/.test(ua)) {
    out.os = "iPadOS";
    out.osVersion = version(ua, /OS (\d+[_.]\d+(?:[_.]\d+)?)/);
    out.claimedForm = "tablet";
  } else if (/OpenHarmony|HarmonyOS/.test(ua)) {
    out.os = "HarmonyOS";
    out.osVersion = version(ua, /(?:OpenHarmony|HarmonyOS)[ /]?(\d+(?:\.\d+)*)/);
    out.claimedForm = /Tablet|Pad/i.test(ua) ? "tablet" : "phone";
  } else if (/Android/.test(ua)) {
    out.os = "Android";
    out.osVersion = version(ua, /Android[ /]?(\d+(?:\.\d+)*)/);
    const m = ua.match(/Android[^;)]*;\s*(?:[a-z]{2}[-_][a-z]{2};\s*)?([^;)]+?)(?:\s+Build\/[^;)]*)?\s*[;)]/i);
    if (m) {
      const model = m[1].trim();
      if (!/^(wv|U|Linux|Mobile|K)$/i.test(model)) out.model = model;
      if (model === "K") out.reducedModel = true;
    }
    out.claimedForm = out.mobileToken ? "phone" : "tablet";
  } else if (/Windows NT|Windows Phone|Win64|Win32/.test(ua)) {
    out.os = "Windows";
    out.osVersion = version(ua, /Windows NT (\d+\.\d+)/);
    out.claimedForm = /Windows Phone/.test(ua) ? "phone" : "desktop";
  } else if (/CrOS/.test(ua)) {
    out.os = "ChromeOS";
    out.osVersion = version(ua, /CrOS \S+ (\d+(?:\.\d+)*)/);
    out.claimedForm = "desktop";
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    out.os = "macOS";
    out.osVersion = version(ua, /Mac OS X (\d+[_.]\d+(?:[_.]\d+)?)/);
    out.claimedForm = "desktop";
  } else if (/Linux|X11/.test(ua)) {
    out.os = "Linux";
    out.claimedForm = "desktop";
  }

  /* ------------------------------ CPU hint --------------------------------- */
  if (/x86_64|x64|Win64|WOW64|amd64|i686|i386|Intel Mac OS X/.test(ua) && !/Macintosh/.test(ua)) out.cpuHint = "x86";
  if (/aarch64|arm64|armv\d|ARM/.test(ua)) out.cpuHint = "arm";

  /* ------------------------------- Browser --------------------------------- */
  for (const [re, name] of IN_APP) {
    if (re.test(ua)) {
      out.inApp = name;
      break;
    }
  }

  const b: [RegExp, string, RegExp][] = [
    [/EdgiOS\//, "Edge (iOS)", /EdgiOS\/(\d+(?:\.\d+)*)/],
    [/EdgA\//, "Edge (Android)", /EdgA\/(\d+(?:\.\d+)*)/],
    [/Edg\//, "Edge", /Edg\/(\d+(?:\.\d+)*)/],
    [/OPiOS\//, "Opera (iOS)", /OPiOS\/(\d+(?:\.\d+)*)/],
    [/OPR\/|OPT\/|Opera/, "Opera", /(?:OPR|OPT|Version)\/(\d+(?:\.\d+)*)/],
    [/SamsungBrowser\//, "Samsung Internet", /SamsungBrowser\/(\d+(?:\.\d+)*)/],
    [/YaBrowser\//, "Yandex", /YaBrowser\/(\d+(?:\.\d+)*)/],
    [/UCBrowser\//, "UC Browser", /UCBrowser\/(\d+(?:\.\d+)*)/],
    [/MiuiBrowser\//, "MIUI Browser", /MiuiBrowser\/(\d+(?:\.\d+)*)/],
    [/HuaweiBrowser\//, "Huawei Browser", /HuaweiBrowser\/(\d+(?:\.\d+)*)/],
    [/DuckDuckGo\/|Ddg\//, "DuckDuckGo", /(?:DuckDuckGo|Ddg)\/(\d+(?:\.\d+)*)/],
    [/Brave/, "Brave", /Chrome\/(\d+(?:\.\d+)*)/],
    [/FxiOS\//, "Firefox (iOS)", /FxiOS\/(\d+(?:\.\d+)*)/],
    [/Firefox\//, "Firefox", /Firefox\/(\d+(?:\.\d+)*)/],
    [/CriOS\//, "Chrome (iOS)", /CriOS\/(\d+(?:\.\d+)*)/],
    [/HeadlessChrome\//, "Headless Chrome", /HeadlessChrome\/(\d+(?:\.\d+)*)/],
    [/Chrome\/|Chromium\//, "Chrome", /(?:Chrome|Chromium)\/(\d+(?:\.\d+)*)/],
    [/Version\/.*Safari\//, "Safari", /Version\/(\d+(?:\.\d+)*)/],
    [/AppleWebKit/, "WebKit", /AppleWebKit\/(\d+(?:\.\d+)*)/],
  ];
  for (const [re, name, vre] of b) {
    if (re.test(ua)) {
      out.browser = name;
      out.browserVersion = version(ua, vre);
      break;
    }
  }

  /* -------------------------------- Engine --------------------------------- */
  if (out.os === "iOS" || out.os === "iPadOS") out.engine = "WebKit";
  else if (/Gecko\/\d+.*Firefox\//.test(ua)) out.engine = "Gecko";
  else if (/Chrome\/|Chromium\/|HeadlessChrome\//.test(ua)) out.engine = "Blink";
  else if (/AppleWebKit/.test(ua)) out.engine = "WebKit";

  /* -------------------------------- WebViews ------------------------------- */
  if (out.os === "Android" && (/; wv\)/.test(ua) || /Version\/\d+\.\d+ Chrome\//.test(ua))) out.webview = "android-webview";
  if ((out.os === "iOS" || out.os === "iPadOS") && /AppleWebKit/.test(ua) && !/Safari\//.test(ua)) out.webview = "ios-wkwebview";

  return out;
}

/** Map Windows UA-CH platformVersion to a marketing name (13+ ⇒ Windows 11). */
export function windowsName(platformVersion: string | undefined | null): string | null {
  if (!platformVersion) return null;
  const major = parseInt(platformVersion.split(".")[0], 10);
  if (Number.isNaN(major)) return null;
  if (major >= 13) return "11";
  if (major > 0) return "10";
  return "7/8/8.1";
}

export const isMobileOS = (os: OS) => os === "iOS" || os === "iPadOS" || os === "Android" || os === "HarmonyOS";
export const isDesktopOS = (os: OS) => os === "Windows" || os === "macOS" || os === "Linux" || os === "ChromeOS";
