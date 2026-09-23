import type { AutomationSignals } from "../types";
import { attempt, withTimeout } from "../util/safe";

const AUTOMATION_GLOBALS = [
  "__webdriver_evaluate",
  "__selenium_evaluate",
  "__webdriver_script_function",
  "__webdriver_script_func",
  "__webdriver_script_fn",
  "__fxdriver_evaluate",
  "__driver_unwrapped",
  "__webdriver_unwrapped",
  "__driver_evaluate",
  "__selenium_unwrapped",
  "__fxdriver_unwrapped",
  "_Selenium_IDE_Recorder",
  "_selenium",
  "calledSelenium",
  "callSelenium",
  "_WEBDRIVER_ELEM_CACHE",
  "ChromeDriverw",
  "__webdriverFunc",
  "__lastWatirAlert",
  "__lastWatirConfirm",
  "__lastWatirPrompt",
  "$chrome_asyncScriptInfo",
  "domAutomation",
  "domAutomationController",
  "_phantom",
  "callPhantom",
  "phantom",
  "__nightmare",
  "nightmare",
  "__playwright__binding__",
  "__pwInitScripts",
  "__playwright_evaluation_script__",
  "__puppeteer_evaluation_script__",
  "Cypress",
  "__cypress",
];

/**
 * Chrome DevTools Protocol "Runtime.enable" (used by Puppeteer, Playwright and
 * an open DevTools window) serialises console arguments, which reads
 * `error.stack`. A getter on it therefore fires only when a CDP client listens.
 * Newer V8 releases may no longer trigger it, so it is weighted lightly.
 */
function cdpSerializationProbe(): boolean | null {
  try {
    let hit = false;
    const e = new Error("probe");
    Object.defineProperty(e, "stack", {
      configurable: true,
      get() {
        hit = true;
        return "";
      },
    });
    console.debug(e);
    return hit;
  } catch {
    return null;
  }
}

async function notificationInconsistency(): Promise<boolean | null> {
  try {
    if (!("Notification" in window) || !navigator.permissions?.query) return null;
    const status = await withTimeout(navigator.permissions.query({ name: "notifications" as PermissionName }), 1000);
    return Notification.permission === "denied" && status.state === "prompt";
  } catch {
    return null;
  }
}

export async function collectAutomation(): Promise<AutomationSignals> {
  const w = window as unknown as Record<string, unknown>;
  const ua = navigator.userAgent;
  const brands = attempt(
    () => ((navigator as unknown as { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands ?? []).map((b) => b.brand),
    [] as string[],
  );
  const knownGlobals = AUTOMATION_GLOBALS.filter((k) => attempt(() => k in w, false));
  const documentMarkers = attempt(() => {
    const keys = Object.getOwnPropertyNames(document).filter((k) => /\$?cdc_|\$wdc_|selenium|webdriver|driver/i.test(k));
    const attrs = ["webdriver", "selenium", "driver"].filter((a) => document.documentElement.hasAttribute(a));
    return [...keys, ...attrs.map((a) => `html[${a}]`)];
  }, [] as string[]);
  const stack = attempt(() => new Error().stack ?? "", "");
  const stackMarkers = ["puppeteer_evaluation_script", "__playwright", "pptr:", "UtilityScript", "selenium", "webdriver"].filter((m) =>
    stack.includes(m),
  );
  const permQuery = attempt(() => Object.getOwnPropertyDescriptor(Permissions.prototype, "query")?.value, undefined) as
    | ((...a: unknown[]) => unknown)
    | undefined;
  const permissionsQueryTampered = attempt(
    () => (permQuery ? !/\{\s*\[native code\]\s*\}$/.test(Function.prototype.toString.call(permQuery)) : false),
    false,
  );
  const chrome = w.chrome as Record<string, unknown> | undefined;
  return {
    webdriver: typeof navigator.webdriver === "boolean" ? navigator.webdriver : null,
    headlessUA: /HeadlessChrome|PhantomJS|SlimerJS/.test(ua),
    headlessBrand: brands.some((b) => /Headless/i.test(b)),
    knownGlobals,
    documentMarkers,
    notificationInconsistent: await notificationInconsistency(),
    outerDimensionsZero: window.outerWidth === 0 && window.outerHeight === 0,
    chromeObject: typeof chrome === "object" && chrome !== null,
    chromeRuntime: Boolean(chrome && "runtime" in chrome),
    languagesEmpty: attempt(() => !navigator.languages || navigator.languages.length === 0, false),
    cdpSerialization: cdpSerializationProbe(),
    stackMarkers,
    permissionsQueryTampered,
  };
}
