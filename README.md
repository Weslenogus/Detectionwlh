# Detectionwlh — real-phone & camera authenticity detection (Next.js)

A KYC-style, in-browser verification flow that decides whether the visitor is on a **real physical phone** (not a desktop in DevTools device mode, a UA spoofer, an anti-detect browser, an Android emulator / iOS simulator or a headless bot) and whether the **camera is a real sensor** (not OBS / ManyCam / a capture card / an injected `canvas.captureStream()` / Chromium's fake device).

```
page load ─► device scan (≈2 s, 11 probe groups) ─► [Continue]
          ─► camera test: 1 s front-camera capture + screen-flash challenge (+ quick rear-camera probe) ─► [Continue]
          ─► full report, re-scored and HMAC-signed by the server
```

## Quick start

```bash
npm install          # also copies the MediaPipe wasm runtime into public/mediapipe
cp .env.example .env.local   # set DETECTION_SECRET (≥32 chars)
npm run dev          # http://localhost:3000
```

Camera and motion sensors only work in a **secure context**, so to test on a phone either:

- deploy (e.g. Vercel — set `DETECTION_SECRET` in the project env), or
- run a tunnel to your dev server (`cloudflared tunnel --url http://localhost:3000`, ngrok, …), or
- `DEV_ORIGINS=192.168.1.20 npm run dev:https -- -H 0.0.0.0` and open `https://<your-LAN-IP>:3000` on the phone (accept the self-signed certificate).

## How detection works

Every probe emits **findings** carrying log-likelihood evidence for six competing hypotheses — `phone`, `tablet`, `desktop`, `spoofed` (desktop pretending to be mobile), `emulator`, `automation`. Evidence is summed per category and **capped** (signals inside a category are correlated), added to log-priors and normalised with softmax: a naive-Bayes posterior with correlation damping. A second classifier does the same for the camera (`physical`, `virtual`, `injected`, `synthetic`).

The emphasis is on signals that **emulation cannot fake** because they come from hardware or from how the browser was compiled:

| Category | Techniques |
|---|---|
| **CPU** | Hardware *default-NaN* probe: `∞−∞` yields `0xFFC00000` on x86 and `0x7FC00000` on ARM — run in JS **and** a hand-assembled WebAssembly module. Phones are ARM; DevTools on an Intel/AMD PC and x86 emulators are not. |
| **Platform APIs** | Interfaces compiled only into Android Chromium (`NDEFReader`, `ContactsManager`, `window.orientation`), only into desktop Chromium (`EyeDropper`, `showOpenFilePicker`, WebHID, `getScreenDetails`, Document PiP, Keyboard Map, `queryLocalFonts`…) or only into iOS WebKit (`DeviceMotionEvent.requestPermission`, `-webkit-touch-callout`). Device emulation can't add or remove them. Also detects phones in "Request desktop site" mode. |
| **GPU** | Unmasked renderer family (Adreno/Mali/Apple/PowerVR/Xclipse vs NVIDIA/AMD/Intel/Direct3D vs SwiftShader/llvmpipe/Android-Emulator translator/VMs), **measured** `mediump` mantissa bits (a shader that halves an epsilon until `1+ε==1`: mobile GPUs run half floats), ASTC-vs-S3TC texture formats, texture limits, WebGPU adapter vendor/architecture cross-check. |
| **Sensors** | DeviceMotion/Orientation + Generic Sensor API: gravity magnitude, noise floor, rounding step (Chromium rounds to 0.1 m/s² — handled), constant vs scripted-smooth traces, **gravity-vector ↔ Euler-angle geometric consistency**, compass heading, absolute orientation, hand-tremor. iOS motion permission is requested on the Continue tap. |
| **Display** | Screen class, DPR, Apple panel geometry table (iPhone SE → iPhone 17/Air, iPads), physical safe-area insets (notch / Dynamic Island), window-larger-than-screen (DevTools), refresh rate, P3/HDR. |
| **Touch** | `maxTouchPoints` (emulation reports 1), pointer media queries, **tap physics** on the Continue buttons (finger contact patch vs 1×1 px emulated touch vs mouse, `isTrusted`, pointerdown→click chain, press duration), hovering cursor. |
| **Identity** | UA vs Client Hints (platform, mobile, brand version, model, architecture, form factors), `navigator.platform`, `navigator.vendor` (DevTools' iPhone mode keeps "Google Inc."), **engine behaviour vs claimed engine** (all iOS browsers must be WebKit), emulator model names, WebView / in-app detection. |
| **Tamper** | Native-code verification of ~40 identity-bearing getters/methods using a **clean iframe realm's `Function.prototype.toString`** (defeats toString patches), Proxy name leaks, foreign-receiver "Illegal invocation" checks, constructibility, own-property overrides; **iframe and Web Worker re-reads** of UA/platform/cores/GPU/CPU-arch; canvas/audio randomisation (ignored for Safari AFP / Brave / Firefox RFP). |
| **Automation** | `navigator.webdriver`, headless UA/brands, Selenium/Puppeteer/Playwright/Cypress globals, `cdc_` keys, stealth-plugin `permissions.query` patch, Notification-permission contradiction, CDP console-serialisation probe, PDF-plugin inconsistencies. |
| **Environment** | Host-OS font markers (Windows / macOS-only / Android / desktop Linux), Windows SAPI voices, cellular vs Ethernet link, battery, cameras present, timezone. |
| **Network** (server) | HTTP `User-Agent` vs JavaScript, `Sec-CH-UA-*` headers vs JS, `Accept-Language`, IP geolocation timezone (Vercel/Cloudflare headers), JA4/JA3 when the edge provides them. |

### Camera test (1 second)

- **Provenance**: `getUserMedia`/`enumerateDevices` still native, track class is `MediaStreamTrack` (not `CanvasCaptureMediaStreamTrack`), track bound to an enumerated device.
- **Labels**: virtual cameras (OBS, ManyCam, Snap, XSplit, DroidCam, iVCam, Camo, NDI, v4l2loopback…), capture cards, Chromium fake device, macOS Continuity Camera, desktop webcams (`(vid:pid)` suffix) vs Android `camera2 N, facing …` / iOS lens names; multi-lens rear arrays.
- **Hardware controls**: focus/exposure/white-balance/zoom/torch capabilities, `ImageCapture` photo capabilities (LED flash, multi-megapixel stills), portrait-rotated frames on a portrait phone.
- **Pixel forensics** (on native-resolution crops): temporal sensor noise and bit-identical pixel ratio, frozen frames, noise-vs-brightness (shot noise), Immerkær spatial noise, 8×8 codec blocking, entropy, frame-timing jitter.
- **Screen-flash liveness**: the server issues a random colour sequence; the screen flashes it while recording and the frames' chromaticity must follow it (lag-searched correlation). Pre-recorded or injected feeds can't.
- **Face detection**: MediaPipe BlazeFace (self-hosted wasm + model) on four frames, with micro-movement.
- The camera snapshot **never leaves the device** — only numeric statistics are sent.

### Server authority

`POST /api/session` issues a signed, short-lived session containing the flash challenge. `POST /api/analyze` validates the payload (zod, size limits), rejects replays, **recomputes the liveness verdict with the sequence it issued**, re-runs the whole engine with network-layer evidence and returns the report with a signed verdict token. Any backend can check that token with `POST /api/verify`:

```bash
curl -X POST https://your-app/api/verify -H 'content-type: application/json' -d '{"token":"<report.signature.token>"}'
# {"valid":true,"verdict":{"decision":"approve","deviceClass":"phone","pPhone":0.9998,"cameraClass":"physical",...}}
```

## Project layout

```
src/lib/detection/
  collectors/     browser probes (navigator, screen, gpu, cpu, platform, integrity, automation, fingerprint, environment)
  sensors/        motion sampler + pure motion analysis
  interaction/    tap/pointer tracker + analysis
  camera/         capture (1 s + flash + rear probe), frame forensics, flash correlation, face detection
  knowledge/      UA parser, GPU/camera/font/device knowledge bases
  engine/         rules per category, Bayesian scoring, device profile
  server/         HMAC tokens, header extraction, zod schema, replay/rate-limit store
src/app/api/      session · analyze · verify
src/components/   flow screens, report, charts
e2e/run.mjs       attack scenarios driven through real Chromium
```

## Tests

```bash
npm test            # unit tests: forensics, flash, motion, parsers, engine fixtures (real iPhone/Pixel, desktop, DevTools, emulator, OBS…)
npm run test:e2e    # starts `next dev` and drives Chromium through the full flow in 4 attack scenarios
npm run lint && npm run typecheck && npm run build
```

The e2e scenarios (all must be declined): stock headless Chromium with the fake camera; DevTools-style Pixel 7 emulation; iPhone emulation with the webdriver flag hidden; Android emulation with `getUserMedia` hooked to a `canvas.captureStream()` injection.

## Limitations — read before relying on it

- **Client signals are attacker-controlled.** The server re-scores raw data and many probes measure hardware behaviour, but an adversary running a modified browser engine on real ARM hardware (or a rooted phone with a camera-injection hook) can still forge values. Treat this as one risk layer; pair it with server-side signals (IP reputation, carrier ASN, velocity) for high-stakes KYC.
- **Calibration.** Weights and thresholds are derived from documented platform behaviour and synthetic fixtures, and validated against Chromium attack scenarios — not yet against a large corpus of real devices. Log `/api/analyze` payloads from real traffic and tune the rule weights in `src/lib/detection/engine/rules/`.
- **Challenge visibility.** The flash sequence must reach the browser to be displayed, so a sophisticated injector could read it; production systems render it just-in-time and can add randomised timing.
- **State.** Replay protection and rate limiting are in-memory (single instance). Use Redis/KV when running multiple replicas, and always set `DETECTION_SECRET` so every instance signs with the same key.
