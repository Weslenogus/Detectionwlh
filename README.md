# Detectionwlh — real-phone & camera authenticity detection (Next.js)

A KYC-style, in-browser verification flow that decides whether the visitor is on a **real physical phone** (not a desktop in DevTools device mode, a UA spoofer, an anti-detect browser, an Android emulator / iOS simulator or a headless bot), whether the **camera is a real sensor** (not OBS / ManyCam / a renamed virtual camera / a capture card / an injected `canvas.captureStream()` / Chromium's fake device), and whether a **live, three-dimensional person** is in front of it (not a photo, a screen, an ID card or a pre-recorded clip).

```
page load ─► device scan (≈2 s, 14 probe groups) ─► [Continue]
          ─► camera test: 1 s capture + screen-flash challenge ─► head-turn challenge (left/right, server-random)
             ─► quick rear-camera probe ─► [Continue]
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

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DETECTION_SECRET` | — (required in production) | HMAC key (≥ 32 chars) for sessions and verdict tokens. Production refuses to start signing without it. |
| `DETECTION_ALLOW_EPHEMERAL_KEY` | unset | `1` allows a per-process random key in production (single instance, tokens die on restart). |
| `NEXT_PUBLIC_ACTIVE_LIVENESS` | on | `false` skips the head-turn challenge (the server then stops issuing and requiring it). |
| `NEXT_PUBLIC_REQUEST_GEOLOCATION` | on | `false` skips the GNSS position request on the first Continue tap. |
| `IPAPI_IS_KEY` | unset | ipapi.is key for VPN / proxy / datacenter / abuser flags (without it: ASN + geo heuristics). |
| `IP_INTEL` | on | `off` disables all outbound IP lookups (ipapi.is, Tor exit list). |
| `TRUST_PROXY_HEADERS` | on | `false` when clients reach the app directly, so they can't forge `X-Forwarded-For`. |

## How detection works

Every probe emits **findings** carrying log-likelihood evidence for six competing hypotheses — `phone`, `tablet`, `desktop`, `spoofed` (desktop pretending to be mobile), `emulator`, `automation`. Evidence is summed per category and **capped** (signals inside a category are correlated), added to log-priors and normalised with softmax: a naive-Bayes posterior with correlation damping. A second classifier does the same for the camera (`physical`, `virtual`, `injected`, `synthetic`). A few findings are **approval blockers**: each alone rules out "approve" however strong the rest is (a renamed camera, a composited feed, a second still face, a hooked camera API, a flat face).

The emphasis is on signals that **emulation cannot fake** because they come from hardware or from how the browser was compiled:

| Category | Techniques |
|---|---|
| **CPU** | Hardware *default-NaN* probe: `∞−∞` yields `0xFFC00000` on x86 and `0x7FC00000` on ARM — run in JS **and** a hand-assembled WebAssembly module. Phones are ARM; DevTools on an Intel/AMD PC and x86 emulators are not. |
| **Platform APIs** | Interfaces compiled only into Android Chromium (`NDEFReader`, `ContactsManager`, `window.orientation`), only into desktop Chromium (`EyeDropper`, `showOpenFilePicker`, WebHID, `getScreenDetails`, Document PiP, Keyboard Map, `queryLocalFonts`, Window Controls Overlay…) or only into iOS WebKit (`DeviceMotionEvent.requestPermission`, `-webkit-touch-callout`). Device emulation can't add or remove them. |
| **GPU / media** | Unmasked renderer family (Adreno/Mali/Apple/PowerVR/Xclipse vs NVIDIA/AMD/Intel vs SwiftShader/llvmpipe/emulator translators), **measured** `mediump` precision, ASTC-vs-S3TC texture formats, WebGPU adapter; hardware video decoders (`MediaCapabilities.powerEfficient`) and WebRTC codecs. |
| **Sensors** | DeviceMotion/Orientation + Generic Sensor API: gravity magnitude, noise floor, rounding step (Chromium rounds to 0.1 m/s²), constant vs scripted-smooth traces, gravity-vector ↔ Euler-angle consistency, hand tremor. |
| **Display / touch** | Screen class, DPR, Apple panel geometry table, safe-area insets, window-larger-than-screen; `maxTouchPoints`, pointer media queries, **tap physics** (contact patch, `isTrusted`, pointerdown→click chain). |
| **Identity** | UA vs Client Hints (and `Sec-CH-UA-*` headers server-side), UA-reduction rules, GREASE brand, `navigator.platform`/`vendor`, engine behaviour vs claimed engine, WebView detection. |
| **Host OS** | `system-ui` font stack, flag emoji rendered as letters (Windows), subpixel antialiasing, OS font markers, Windows SAPI voices, `Intl` vs `Date` timezone. |
| **Tamper** | Native-code verification of ~40 getters via a **clean iframe realm's `Function.prototype.toString`**, Proxy leaks, foreign-receiver checks; identity **re-read in an iframe, a Worker, a sandboxed opaque-origin iframe and a service worker** (emulation overrides often miss some realms). |
| **Automation** | `navigator.webdriver`, headless markers, Selenium/Puppeteer/Playwright/Cypress globals, CDP serialisation probe, stealth-plugin artefacts, FingerprintJS **BotD**. |
| **Network** (server) | IP reputation (ipapi.is, Tor exits, ASN heuristics: carrier vs datacenter), WebRTC STUN reflexive IP vs HTTP IP, GNSS fix vs IP location, clock skew, velocity and identity links (same fingerprint behind many IPs, …). |
| **Behaviour** | Reaction times to each Continue button, tab switches during the camera test, incognito, FingerprintJS visitor ID stability. |

### Camera test

- **Provenance**: `getUserMedia`/`enumerateDevices` still native, track class is `MediaStreamTrack` (not `CanvasCaptureMediaStreamTrack`), track bound to an enumerated device.
- **Labels**: virtual cameras (OBS, ManyCam, Snap, XSplit, DroidCam, iVCam, Camo, NDI, v4l2loopback…), capture cards, Chromium's fake device, Continuity Camera, desktop webcams (`(vid:pid)` suffix) vs Android `camera2 N, facing …` / iOS lens names.
- **Name vs driver**: Chrome on Android derives the `camera2 N, facing front` label from the same Camera2 `LENS_FACING` value that fills `facingMode`; Safari on iOS always reports `facingMode`. A phone-style name on a track whose driver knows no lens facing is a **renamed** device (OBS `Rename`, v4l2loopback `card_label`, a registry-renamed webcam).
- **Hardware controls**: focus/exposure/white-balance/zoom/torch capabilities, `ImageCapture` photo capabilities (LED flash, multi-megapixel stills), rear-lens array.
- **Pixel forensics** (native-resolution crops): temporal sensor noise and bit-identical pixel ratio, frozen frames, noise-vs-brightness, Immerkær spatial noise, 8×8 codec blocking, FFT **moiré** (re-filmed screen), frame-timing jitter.
- **Sensor-noise map**: a 6×4 grid of native-resolution tiles over the whole frame. A sensor adds fresh noise to every pixel of every frame, so a region with detail that stays **bit-identical** while the rest is noisy was **pasted in** — an ID card or photo composited over a relayed webcam in OBS. Changes are measured per pixel against the tile's common shift, so a feed that only changes colour as a whole doesn't pass as noise.
- **Screen-flash liveness**: the server issues a random colour sequence; the screen flashes it while recording and the frames' chromaticity must follow it, beating every other colour assignment (permutation test).
- **Face**: MediaPipe FaceLandmarker (478 points, blendshapes, head pose) — frozen landmarks, blink, non-rigid micro-motion, framing, multiple faces.
- The camera snapshot **never leaves the device** — only numeric statistics are sent.

### Active 3D liveness (head turn)

After the 1-second capture, on the same stream, the user turns their head in a **server-randomised order** (left→right or right→left) while every frame is tracked:

- **Nose parallax**: the nose tip sits in front of the face outline, so on a real head it swings against the cheeks (±0.15 face widths ≈ 12° of turn). Calibrated on MediaPipe itself: a rendered 3D face mesh turned 35° moves it ±0.48; a **photo tilted ±35°** only reaches ±0.07 — the landmark model's face prior can't invent parallax.
- **Foreshortening without parallax**: a tilted photo narrows (width/height −10 %+) while the nose stays centred → verdict `flat` → **decline**.
- **Order**: the turns must happen in the issued order, starting from a frontal pose; a pre-recorded clip can't follow it.
- **Planarity consistency** (DLT homography residual vs nose shift) and **gyroscope** rotation (a phone orbiting a static head model).
- **Second face**: the person is the largest face; any other face is tracked, including a **close-up scan** of full-resolution snapshots (four overlapping crops) for card-sized faces. A face that never moves or turns while the person does is a picture — an **ID card held up or pasted in**. Any second face blocks approval.
- Everything is recomputed server-side from landmark samples with the order the server issued; a result that omits an issued challenge counts as not passed.

### Server authority

`POST /api/session` issues a signed, short-lived session containing the flash sequence and the head-turn order (optionally bound to your `{ "subject": "<user or transaction id>" }`). `POST /api/analyze` validates the payload (zod, size limits), rejects replays, **recomputes the flash liveness, the noise-map verdict and the 3D analysis** from raw statistics with the challenges it issued, re-runs the whole engine with network-layer evidence and returns the report with a single-use signed verdict token. Any backend can check that token with `POST /api/verify`:

```bash
curl -X POST https://your-app/api/verify -H 'content-type: application/json' -d '{"token":"<report.signature.token>","subject":"<optional>"}'
# {"valid":true,"verdict":{"decision":"approve","deviceClass":"phone","pPhone":0.9998,"cameraClass":"physical","depth":"live-3d",...}}
```

## The "renamed OBS camera + fake phone + doctored ID" attack

An attacker on a PC runs OBS Virtual Camera renamed to `camera2 1, facing front`, emulates a phone (UA, viewport, touch, webdriver hidden) and feeds either a still image of their face next to an ID card with an altered photo, or their **real webcam relayed through OBS** with the doctored ID pasted into the scene — so the face is live, three-dimensional and even reflects the screen flashes. What still gives it away:

| Layer | Signal |
|---|---|
| Device | x86 default-NaN, desktop GPU, desktop-only APIs, realm mismatches, no motion sensors: OBS only runs on a computer. |
| Camera identity | The phone-style name has no lens facing behind it (renamed device); a single camera where phones have 2–4; no ISP controls, torch or multi-megapixel stills. |
| Pixels | Still image: every frame bit-identical, no sensor noise anywhere. Relay: the pasted ID card is a frozen island in a noisy frame (**composite**). |
| Faces | The ID-card face is found by the close-up scan and never moves or turns while the person does (**second still face**). |
| Liveness | A still image can't turn its head (timeout / `flat`); a looped clip can't follow the random order. |

Beyond this project: production KYC also runs **document** checks on the ID itself — MRZ/barcode checksums against the printed fields, template and font consistency, photo-substitution and edit forensics, hologram / optically-variable elements that must shift colour as the card is tilted live, and **face matching** between the ID photo and the selfie. Those need document models and are outside this repo.

## Project layout

```
src/lib/detection/
  collectors/     browser probes (navigator, screen, gpu, cpu, platform, integrity, automation, host-os, timezone, media, webrtc, geolocation…)
  sensors/        motion sampler + pure motion analysis
  interaction/    tap/pointer/behaviour tracker + analysis
  camera/         capture (1 s + flash + noise tiles + rear probe), frame forensics, flash correlation,
                  FaceLandmarker, head-turn challenge (pose-challenge) and its 3D analysis (liveness3d)
  knowledge/      UA parser, GPU/camera/font/device knowledge bases
  engine/         rules per category, Bayesian scoring, approval blockers, device profile
  server/         HMAC tokens, header extraction, IP intelligence, zod schema, replay/rate-limit/velocity store
src/app/api/      session · analyze · verify
src/components/   flow screens (scan, camera, head-turn guide), report (noise map, 3D section, charts)
e2e/run.mjs       attack scenarios driven through real Chromium
e2e/face-clips.mjs  renders fake-camera clips (tilted photo, 3D face mesh, OBS still/relay with a SPECIMEN ID card) from a portrait
```

## Tests

```bash
npm test            # unit tests: forensics, noise map, flash, motion, 3D geometry (incl. recorded MediaPipe output), engine fixtures, OBS attack
npm run test:e2e    # starts `next dev` and drives Chromium through the full flow in 4 attack scenarios
npm run lint && npm run typecheck && npm run build
```

The base e2e scenarios (all declined): stock headless Chromium with the fake camera; DevTools-style Pixel 7 emulation; iPhone emulation with the webdriver flag hidden; Android emulation with `getUserMedia` hooked to a `canvas.captureStream()` injection.

With a portrait photo (any front-facing picture you're allowed to use), four more camera attacks run through Chromium's fake camera:

```bash
node e2e/face-clips.mjs path/to/portrait.jpg test-results/face-clips
FACE_CLIPS=test-results/face-clips npm run test:e2e
# single scenarios: npm run test:e2e -- obs-relay-id,photo-tilt
```

| Scenario | Expected |
|---|---|
| `photo-tilt` — portrait tilted ±35° | 3D verdict `flat`, declined |
| `obs-still-id` — renamed OBS camera, phone emulation, still face + doctored ID | name-vs-driver fail, frozen noise map, declined |
| `obs-relay-id` — renamed OBS relaying a live 3D face + pasted ID | name-vs-driver fail, **composited** noise map, **second still face**, camera `virtual`, declined |
| `face-mesh-3d` — textured 3D face mesh turning | geometry reads as 3D (never `flat`); still declined as a desktop |

Emulators, including **MuMu Player 12** (Windows, x86) and **MuMu Player Pro** (Apple silicon, ARM), are covered by `src/lib/detection/__tests__/mumu.test.ts`.

The renamed label is applied to the submitted signals before the server scores them — exactly what an OS-level rename delivers, since a device name is just a string the driver reports.

## Limitations — read before relying on it

**[docs/BYPASS-ANALYSIS.md](docs/BYPASS-ANALYSIS.md)** is the full threat model: every known way around these checks, which ones are measured, MuMu Player results, what is impossible to detect from a browser and what would close each gap. In short:

- **Client signals are attacker-controlled.** The server re-scores raw data and many probes measure hardware behaviour, but an adversary running a modified browser engine on real ARM hardware (or a rooted phone with a camera-injection hook) can still forge values. Treat this as one risk layer alongside document verification, face matching and your own fraud signals.
- **Calibration.** Weights and thresholds come from documented platform behaviour, synthetic fixtures and MediaPipe recordings of rendered attacks — not yet from a large corpus of real devices and people. Log `/api/analyze` payloads from real traffic and tune `src/lib/detection/engine/rules/` and `camera/liveness3d.ts`.
- **3D masks.** The head-turn geometry proves a three-dimensional face, not a living one: a realistic 3D mask or a high-quality deepfake relay is a material/texture problem that needs dedicated presentation-attack models.
- **Challenge visibility.** The flash sequence and turn order must reach the browser to be shown, so a real-time injector could read them; production systems add randomised timing and server-side frame analysis.
- **State.** Replay protection, rate limiting and velocity are in-memory (single instance). Use Redis/KV when running multiple replicas, and always set `DETECTION_SECRET` so every instance signs with the same key.
