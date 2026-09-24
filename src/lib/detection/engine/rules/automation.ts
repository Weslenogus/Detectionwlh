import type { Add, Ctx } from "../context";
import { list } from "../context";

export function automationRules(c: Ctx, add: Add) {
  const a = c.d.automation;
  const nav = c.d.navigator;
  if (!a) return;
  let flagged = false;
  const flag = (f: Parameters<Add>[0]) => {
    flagged = true;
    add(f);
  };

  if (a.webdriver) {
    flag({
      id: "automation.webdriver",
      title: "navigator.webdriver",
      value: "true",
      detail: "The browser declares it is controlled by WebDriver / CDP automation (Selenium, Puppeteer, Playwright).",
      status: "fail",
      evidence: { automation: 5.0, phone: -2.0, tablet: -2.0, desktop: -1.0 },
    });
  }
  if (a.headlessUA || a.headlessBrand) {
    flag({
      id: "automation.headless",
      title: "Headless browser",
      value: a.headlessUA ? "HeadlessChrome UA" : "Headless brand",
      detail: "The browser identifies as headless.",
      status: "fail",
      evidence: { automation: 5.0, phone: -2.0, tablet: -2.0 },
    });
  }
  const markers = [...(a.knownGlobals ?? []), ...(a.documentMarkers ?? []), ...(a.stackMarkers ?? [])];
  if (markers.length) {
    flag({
      id: "automation.markers",
      title: "Automation framework artefacts",
      value: list(markers),
      detail: "Globals / DOM keys / stack frames left behind by automation drivers.",
      status: "fail",
      evidence: { automation: 4.0, phone: -1.5, tablet: -1.5 },
    });
  }
  if (a.notificationInconsistent) {
    flag({
      id: "automation.notifications",
      title: "Permission state inconsistency",
      value: "Notification=denied, query=prompt",
      detail: "Classic headless-Chrome contradiction between Notification.permission and the Permissions API.",
      status: "warn",
      evidence: { automation: 1.5 },
    });
  }
  if (a.outerDimensionsZero) {
    flag({
      id: "automation.outer",
      title: "Window without chrome",
      value: "outerWidth = outerHeight = 0",
      detail: "The page runs in a window with no outer frame (headless / off-screen).",
      status: "warn",
      evidence: { automation: 2.0, phone: -0.5 },
    });
  }
  if (a.languagesEmpty) {
    flag({
      id: "automation.languages",
      title: "Empty language list",
      value: "navigator.languages = []",
      detail: "Real browsers always expose at least one language.",
      status: "warn",
      evidence: { automation: 1.5 },
    });
  }
  if (a.permissionsQueryTampered) {
    flag({
      id: "automation.stealth",
      title: "Stealth-plugin signature",
      value: "Permissions.query patched",
      detail: "puppeteer-extra-plugin-stealth and similar kits replace navigator.permissions.query.",
      status: "fail",
      evidence: { automation: 1.5, spoofed: 0.8 },
    });
  }
  if (a.cdpSerialization) {
    flag({
      id: "automation.cdp",
      title: "DevTools protocol attached",
      value: "console arguments serialised",
      detail: c.claims.mobile
        ? "A Chrome DevTools / CDP client is listening to this page — which is how device emulation is driven."
        : "A DevTools window or CDP automation client is attached.",
      status: "warn",
      evidence: c.claims.mobile ? { automation: 0.8, spoofed: 1.5, phone: -1.0 } : { automation: 0.8 },
    });
  }

  if (c.engine === "Blink") {
    const plugins = nav.pluginsCount ?? 0;
    if (c.claims.android && (plugins > 0 || nav.pdfViewerEnabled === true)) {
      flag({
        id: "automation.plugins",
        title: "PDF plugins",
        value: `${plugins} plugins · pdfViewerEnabled=${nav.pdfViewerEnabled}`,
        detail: "Android Chrome has no plugins and no built-in PDF viewer; desktop Chrome always reports five PDF plugins.",
        status: "fail",
        evidence: { spoofed: 2.5, phone: -2.0, tablet: -2.0 },
      });
    } else if (c.claims.desktop && plugins === 0 && !/Android/.test(nav.userAgent)) {
      flag({
        id: "automation.plugins",
        title: "PDF plugins",
        value: "0 plugins",
        detail: "Desktop Chrome always lists its PDF viewer plugins; none here suggests a headless build.",
        status: "warn",
        evidence: { automation: 1.2 },
      });
    }
    if (c.claims.desktop && !a.chromeObject && /Chrome\//.test(nav.userAgent)) {
      flag({
        id: "automation.chrome-object",
        title: "window.chrome",
        value: "missing",
        detail: "Desktop Chrome always defines window.chrome.",
        status: "warn",
        evidence: { automation: 1.0 },
      });
    }
  }

  if (!flagged) {
    add({
      id: "automation.clean",
      title: "Automation checks",
      value: "clean",
      detail: "No WebDriver flag, headless markers, driver globals, CDP listeners or stealth patches.",
      status: "pass",
      evidence: { automation: -1.0 },
    });
  }
}
