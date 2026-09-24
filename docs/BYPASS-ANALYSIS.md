# Bypass analysis — what still gets through, and what no browser check can ever stop

> Scope: this document is about **this repository's** checks: is it a real phone, is the camera a real sensor, and is a live, three-dimensional person in front of it. By design there is **no ID / passport step**. Everything below was either measured with the tests in this repo (marked **measured**) or follows from how browsers and operating systems work (marked **by design** or **reasoned**). Nothing here has been validated on a large set of real phones and real people yet — see [§11](#11-honest-calibration-status).

---

## Contents

1. [The one-paragraph answer](#1-the-one-paragraph-answer)
2. [Why "phone first → real camera → 3D" is the right order](#2-why-phone-first--real-camera--3d-is-the-right-order)
3. [The fundamental limit: the browser belongs to the attacker](#3-the-fundamental-limit-the-browser-belongs-to-the-attacker)
4. [What each layer actually proves](#4-what-each-layer-actually-proves)
5. [Attacker tiers](#5-attacker-tiers)
6. [Attack catalogue](#6-attack-catalogue)
   - [A. Faking the phone](#a-faking-the-phone)
   - [B. Faking the camera](#b-faking-the-camera)
   - [C. Faking the person (static images, video, masks, deepfakes)](#c-faking-the-person)
   - [D. Attacking the protocol and the data](#d-attacking-the-protocol-and-the-data)
   - [E. Real phone, real person, wrong intent](#e-real-phone-real-person-wrong-intent)
7. [MuMu Player — measured](#7-mumu-player--measured)
8. [Coverage matrix](#8-coverage-matrix)
9. [What is impossible to build in a browser](#9-what-is-impossible-to-build-in-a-browser)
10. [What would close the remaining gaps](#10-what-would-close-the-remaining-gaps)
11. [Honest calibration status](#11-honest-calibration-status)

---

## 1. The one-paragraph answer

The system makes **cheap and mid-level attacks fail** — DevTools device mode, UA spoofers, anti-detect browsers, every x86 Android emulator (BlueStacks, LDPlayer, Nox, MEmu, **MuMu Player 12**), default ARM emulators on Macs (**MuMu Player Pro**), OBS and other virtual cameras even when renamed to a phone lens, JavaScript stream injection, still photos, photos that are moved or tilted, pasted ID cards and second faces. What it **cannot** stop, and no in-browser system can: a **real phone** whose operating system has been modified to inject camera frames (root / jailbreak), a **real-time deepfake** delivered through such an injection, a **3D mask** worn by a real person, an **ARM virtual machine that fakes every property it reports**, a **custom-built browser** that lies below JavaScript, a client that **fabricates the measurements** instead of measuring, and — by definition — a **real person on their own real phone** acting for someone else. Those need hardware attestation from a native app, server-side analysis of the actual video, and risk/velocity controls; they are listed with the reasons in [§9](#9-what-is-impossible-to-build-in-a-browser).

---

## 2. Why "phone first → real camera → 3D" is the right order

You asked whether it is good that **the most important check is "is it a real phone"**, and that the phone is then used to decide whether the camera is real and to run the 3D test. Yes — the order matters, and here is why:

1. **Most attack tooling only runs on computers.** Virtual cameras (OBS, ManyCam, v4l2loopback), scene compositors, face-swap pipelines on a GPU, scripted browsers and anti-detect browsers are desktop software. Forcing a *real phone* removes that whole toolbox at once. The measured OBS scenarios (`obs-still-id`, `obs-relay-id`) are declined by the phone layer alone before the camera layer even matters.
2. **On an unmodified phone the camera path is hard to tamper with.** The browser gets frames from the OS camera service. To inject frames the attacker must root/jailbreak the phone or patch the browser — a large jump in skill and cost, and a small population of devices.
3. **A phone adds liveness signals a PC can't.** Its screen is a light source a few centimetres from the face (flash reflection), it has a gyroscope (was the *phone* rotated instead of the head?), several camera modules with real ISP controls, a torch, and a touchscreen with finger contact physics.
4. **The later layers are only meaningful after the earlier ones pass.** A virtual camera can feed a perfectly three-dimensional face (a relayed webcam, a rendered head). "It's 3D" proves nothing if the frames don't come from a sensor on the device the person holds. So: phone → camera → 3D, and each layer is an *approval blocker* for the next.

The weak point of this order is equally clear: **if the phone layer is fooled, everything after it can be fed**. That is why the remaining gaps (§6-A5, A6, A8, B4) all sit at the phone/OS level.

### Static images and "a little movement"

You also asked specifically about **static images, even when they move a little**. That is covered by three independent tests, each with measured numbers:

| Trick | Why it fails | Where |
|---|---|---|
| Still image through any virtual camera | Every frame bit-identical; the 6×4 **sensor-noise map** finds no per-pixel noise anywhere | `camera.noise-map` → frozen |
| Photo **held in front of the phone**, moved, shaken, slid, rotated in-plane | A flat surface can't produce **nose parallax**: every point moves together. The challenge needs the nose to swing **±0.15 face widths** each way | 3D verdict `incomplete` → review |
| Photo **tilted** left/right to fake a turn | The face **narrows** (width/height drops ≥ 10 %) while the nose stays centred — impossible for a real head | 3D verdict `flat` → decline |
| Photo bent/curved around the face | Curving a print adds no nose protrusion; parallax stays near the flat-card level | reasoned from the same geometry |

Measured on real MediaPipe output (`e2e/face-clips.mjs`, `mediapipe-head-turns.json`): a **3D face turned 35° moves the nose ±0.48**; a **portrait photo tilted ±35° only reaches ±0.07** — the landmark model's own face prior can't invent the missing depth. The threshold (±0.15) sits two times above what a tilted photo reached and three times below what a real turn produces.

One nuance worth knowing: the **screen-flash test does not reject printed photos**. Paper is a physical surface, so it reflects the flash colours just like skin. The flash test proves *"a physical object lit by this screen"*; the 3D test proves *"that object is a head"*. They are complementary, not redundant.

---

## 3. The fundamental limit: the browser belongs to the attacker

```
 ┌──────────────────────── attacker-controlled ─────────────────────────┐        ┌──── you ────┐
 │ hardware ─► OS / drivers ─► camera service ─► browser engine ─► JS   │ ──────►│  /api/...   │
 │  (real?)     (rooted?)      (injected?)        (patched?)     (ours) │ bundle │  re-score   │
 └──────────────────────────────────────────────────────────────────────┘        └─────────────┘
```

Every number the server receives was produced by **our JavaScript running inside software the attacker owns**. The checks in this repo are strong because they measure **behaviour** that is hard to fake consistently (how the FPU rounds a NaN, how a GPU rounds `mediump`, how sensor noise looks, how light reflects off a face, how a nose moves against the cheeks). But a browser page can never obtain a **cryptographic proof** that:

- the hardware is what it says,
- the OS and camera driver are unmodified,
- the browser engine is unmodified,
- the numbers were actually measured rather than typed in.

On native apps that proof exists (Google **Play Integrity** with hardware-backed key attestation, Apple **App Attest / DeviceCheck**). On the web it does not: Google's attempt to add it (*Web Environment Integrity*, 2023) was withdrawn, WebAuthn passkey attestation is normally empty for privacy, and Apple's **Private Access Tokens** only prove "a genuine Apple device in good standing" to Safari-supporting issuers — not which device, and nothing about Android. So **every browser-only liveness/device system — this one and commercial ones — is a cost-raising system, not a proof system.** The goal is to make the cheapest successful attack expensive, rare and noisy.

---

## 4. What each layer actually proves

| Layer | What it measures | What it proves when it passes | What it does **not** prove |
|---|---|---|---|
| CPU (default-NaN in JS + WASM) | FPU bit pattern of `∞−∞` | The code ran on ARM (phones) not x86 | Not a phone: Apple-silicon Macs, ARM servers, Windows-on-ARM are ARM too |
| Platform APIs | Interfaces compiled into Android/iOS/desktop builds | Which browser **build** runs | Not the hardware under it (an Android VM runs the real Android build) |
| GPU | Renderer family, measured `mediump` bits, ASTC/S3TC, WebGPU | A mobile-class GPU pipeline | The string can be spoofed; precision/ASTC are consistent on Apple silicon too |
| Sensors | Noise floor, rounding, gravity↔Euler consistency, tremor | A real MEMS stream (or a very good fake) | Data can be injected by a modified OS |
| Touch | Contact patch, `isTrusted`, press physics | A finger on glass (or a good fake) | A remote-controlled real phone uses real glass |
| Tamper / realms | Native-code checks, iframe/worker/sandbox/service-worker re-reads | JS-level spoofing absent | A patched engine lies consistently in every realm |
| Camera identity | Label vs driver `facingMode`, inventory, ISP controls, torch | The OS reports a phone camera module | The OS itself can be modified |
| Pixel forensics / noise map | Temporal noise per region, frozen frames, blocking, moiré | Frames look like fresh sensor output, nothing pasted | Injected frames with synthetic noise added |
| Screen flash | Chromaticity follows the server's random colours | Something physical lit by this screen, in real time | Not a head (paper reflects too); abstains in bright light |
| 3D head turn | Nose parallax, foreshortening, planarity, order, gyro | A 3D head-shaped object turned live | Not *alive* (masks), not *this* person (deepfake driven by a real head) |
| Server | Re-derives flash, noise map and 3D from raw stats; single-use signed tokens | The client can't just send "approve" | That the raw stats were really measured |

---

## 5. Attacker tiers

| Tier | Who / what | Typical tools (categories) | Outcome here |
|---|---|---|---|
| **T0** Casual | One try, no tooling | Photo of someone, screenshot, video on another phone | **Blocked** — flat / incomplete 3D, frozen noise map, flash, moiré |
| **T1** Script | Desktop browser tricks | DevTools device mode, UA switchers, headless browsers | **Blocked** — CPU, platform APIs, GPU, automation, realms (e2e) |
| **T2** Tooling | Off-the-shelf fraud kits | Anti-detect browsers, x86 Android emulators, OBS / virtual cameras (renamed), JS stream injection | **Blocked** — measured in e2e and fixtures |
| **T3** Skilled | Builds / configures environments | ARM VMs on Apple silicon with spoofed model/GPU/sensors, remote-controlled real phones, screen replay of a prepared video, 3D masks | **Partly** — defaults and most spoofs caught; a fully faked ARM VM, a 3D mask, or a good screen replay can pass (§6) |
| **T4** Professional | Custom engineering | Rooted/jailbroken phones with OS-level camera injection, real-time deepfakes, patched browser engines, fabricated payload clients | **Not stoppable in a browser** — needs native attestation + server-side video analysis |
| **T5** Human | No technical attack at all | Paid "mules", identity rental, coerced or tricked victims | **Not stoppable by any liveness check** — it *is* a real person on a real phone |

---

## 6. Attack catalogue

Status legend: ✅ **blocked** (measured or deterministic) · ◐ **raises cost / partial** · ❌ **not detectable in a browser**

### A. Faking the phone

#### A1. DevTools device mode, UA switchers — ✅
Desktop Chromium keeps its desktop build: x86 default-NaN, desktop-only APIs (`EyeDropper`, `hid`, `getScreenDetails`, …), desktop GPU, sandboxed-iframe/service-worker realms that still report the real UA. **Measured** (e2e `devtools-pixel7`, `stealth-iphone`).

#### A2. Anti-detect browsers (JS-level spoofing) — ✅ / ◐
They override getters and inject values from JavaScript or an extension. Caught by native-code verification through a clean iframe's `Function.prototype.toString`, Proxy leaks, and re-reading identity in realms the spoof usually misses (Worker, sandboxed opaque-origin iframe, service worker). The better ones patch at the C++ level → see **A7**.

#### A3. x86 Android emulators (BlueStacks, LDPlayer, Nox, MEmu, Android Studio x86, MuMu Player 12) — ✅
The x86 FPU can't be renamed: default-NaN is `0xFFC00000` in JS and in WASM. Plus `navigator.platform = Linux x86_64`, desktop GPU or texture formats under a mobile GPU claim, virtual sensors, emulator model names. **Measured** in `mumu.test.ts` and the emulator fixture (see [§7](#7-mumu-player--measured)).

#### A4. iOS Simulator — ✅ (reasoned)
Runs on a Mac; on Apple silicon it is ARM and Safari masks the GPU as "Apple GPU", so the CPU/GPU checks alone don't decide it. But the simulator has no motion sensors and no camera — the camera step can't complete, and the server requires the camera for approval.

#### A5. ARM virtual machines (MuMu Player Pro on Apple silicon, Android Studio arm64 emulator on M-series, ARM cloud servers) — ◐
**This is the weakest point of the phone layer.** The Android build is real, the CPU really is ARM, so the CPU and platform-API checks *agree with the lie*. What still gives it away:
- the host GPU (`Apple M2`, virtual GPU strings) → now a hard emulator signal;
- emulator model names (`MuMu`, `sdk_gphone…`) → hard signal;
- **soft hints**, of which two together block approval: point-contact (1×1 px) taps from mouse-to-touch mapping, software H.264 decoding, a single camera with no rear lens, synthetic or absent motion sensors.

**Measured**: default MuMu Pro → **decline** (99.4 % emulator) even with realistic sensor data; MuMu Pro with a spoofed model **and** GPU string → **review** (corroborating hints). **Limit, also measured**: if the VM additionally fakes a realistic sensor stream, finger-sized touches, hardware decoding and a phone-like camera inventory, it is **approved** — the test `documents the limit` pins this down. Closing it requires hardware attestation (§9).

#### A6. Cloud phones / Android in containers on ARM servers — ◐
Same as A5 (real ARM, real Android build), usually with a **datacenter IP** (IP-intel flags), no real sensors, and a virtual camera (caught by the camera layer). A cloud phone with a physical webcam attached and spoofed sensors behaves like A5.

#### A7. Custom-compiled browser engine — ❌ / ◐
A patched Chromium can return phone values from C++ for every API — in every realm, with native-looking functions. It can even canonicalise NaNs to the ARM pattern and report half-precision `mediump`. What remains are **behavioural** measurements that are expensive to fake consistently (timing, GPU precision under load, sensor physics). Expensive to build and maintain, but **not provably detectable** from inside the page.

#### A8. Real phone, rooted/jailbroken, with property spoofing — n/a for "is it a phone"
It *is* a phone, so the phone layer rightly passes. The danger is what a rooted phone can do to the **camera** (B4) and the **measurements** (D1).

#### A9. Real phone, remote-controlled (screen mirroring, device farms) — ◐
Real hardware passes the phone layer. Signals that can help: taps injected over a debug bridge often have point-contact geometry and no hand tremor in the gyroscope around the tap; the phone lies flat and still ("resting" sensors) during the whole flow; datacenter/proxy IPs; velocity (one device, many identities). But the **camera must still see a live 3D person** — a remote attacker needs a person in front of that phone or a camera injection (B4).

### B. Faking the camera

#### B1. Desktop virtual cameras (OBS, ManyCam, v4l2loopback…), including renamed to `camera2 1, facing front` — ✅
Blocked at the phone layer (it's a PC) **and** at the camera layer on its own merits: a phone-style name with no lens facing in the driver (Chrome derives both from the same Camera2 property), single camera, no ISP controls, and pixels: a still image has no noise anywhere; an ID card pasted over a relayed webcam is a frozen island in a noisy frame (**composite**). **Measured**: e2e `obs-still-id`, `obs-relay-id` (camera `virtual` 99.9 %), fixtures run on a genuine Pixel's device signals so the camera layer is tested alone.

#### B2. JavaScript stream injection (`getUserMedia` hooked, `canvas.captureStream()`) — ✅
Hooked functions fail native-code verification; the track class is `CanvasCaptureMediaStreamTrack`; the track isn't bound to an enumerated device; a generated feed carries no per-pixel noise (uniform colour changes are measured against each region's common shift, so they don't count as noise). **Measured**: e2e `injected-canvas-stream`.

#### B3. Engine-level injection (patched browser delivering frames as a normal camera track) — ◐
Provenance checks pass (it's a genuine-looking track). Pixel forensics catch naive replays (codec blocking, no noise, frozen regions), the flash challenge catches pre-recorded content, the random turn order catches a single pre-recorded clip. A real-time generator that adds sensor-like noise and reacts to the challenges can pass — see C4/C5.

#### B4. OS-level camera injection on a rooted/jailbroken **real phone** — ❌
**The most important residual risk.** Hooks in the camera service or HAL replace the sensor's frames before any app — including the browser — sees them. The browser reports a genuine front camera with the right label, `facingMode`, controls, torch and inventory, because the OS says so. What's left is pixel content:
- a **pre-recorded video** fails the flash test (random colours in time) *when the flash is conclusive* and fails a single-clip turn order; pixel forensics may catch compression artefacts;
- a **live relay of another real camera** (the attacker's own face) passes everything — but then it's the attacker's own face;
- a **real-time deepfake** of someone else, driven by the attacker's real head, passes geometry (see C5).

A web page can't detect root, can't see the camera HAL, and can't verify frame provenance. Only a native app with Play Integrity / App Attest and root detection can raise this bar.

#### B5. A second real phone/tablet showing a video, filmed by the verifying phone (screen replay) — ◐
The verifying phone is real and its camera is a real sensor, so the phone layer, the camera identity **and the noise map** all pass (the sensor adds real noise while filming a screen). What catches it:
- **moiré** from the pixel grid (can disappear with high-DPI OLED, distance, slight defocus);
- the **flash test**: a screen emits its own light and barely reflects ours → `none`;
- the **3D order**: a single prepared video turns in a fixed order.

**Honest gap, reasoned**: an attacker with two prepared videos (left-first and right-first) picks the right one after seeing the on-screen instruction; the replayed content is a real 3D head, so geometry passes. At present the flash result is **evidence, not an approval gate** (it abstains in bright light to avoid rejecting people outdoors), so a replay in bright ambient light with no visible moiré could reach approval. See [§10](#10-what-would-close-the-remaining-gaps) — making a "no flash response with a face in view" result block approval (asking the user to retry indoors) closes most of this at the cost of some retries.

#### B6. HDMI capture cards / USB "webcam" adapters feeding a phone (USB-C UVC) — ◐
On Android, an external USB camera appears to Chrome as `facing external` without a lens facing and usually without ISP controls; it can't be the front camera and a phone always has built-in ones in the inventory. The name-vs-driver rule deliberately ignores `external` labels (legitimate accessories exist), so this relies on the inventory, controls and pixel checks.

### C. Faking the person

#### C1. Printed photo or photo on a screen, static — ✅
Frozen/flat, fails 3D (`incomplete` → review, or `flat` if tilted → decline). **Measured** (photo-tilt fixtures and e2e).

#### C2. Photo moved, shaken, tilted, or with cut-out eyes (real blinking eyes behind it) — ✅
Blinks don't help: the test is geometric. The nose of a flat picture can't swing against its cheeks; tilting narrows it instead (`flat`). **Measured** on real MediaPipe output.

#### C3. Pre-recorded video of the victim turning their head — ◐
Fails the flash test in time (random colours) when the flash is conclusive; a single clip fails half of the random orders and restarts from mid-turn fail the "move into it from frontal" rule. With **two clips and real-time selection** the order is no obstacle — the order is shown on screen, so it can't be secret. Combined with injection (B3/B4) and synthetic relighting of the face to follow the flash colours, it can pass. Needs server-side video analysis (§10).

#### C4. 3D masks (silicone, resin, 3D-printed with a printed texture) worn by a real person — ❌
It **is** a three-dimensional head-shaped object, lit by the screen, turning live in the right order, with real eyes blinking behind it. Geometry-based liveness can't separate it from skin. Commercial systems use trained **presentation-attack-detection** models on texture/specular/subsurface-scattering cues, or depth/IR sensors (Face ID's TrueDepth) — and the web exposes **no depth or IR camera**. Out of reach here.

#### C5. Real-time deepfake / face swap driven by the attacker's real head — ❌
The *driver* is a real 3D head, so the swapped output inherits real 3D motion: MediaPipe sees a 3D face turning in the right order. Face-swap models also transfer much of the driver's lighting, so the flash reflection can survive. Delivery needs injection (B3/B4) or a screen replay (B5). Detection requires dedicated deepfake models (blending boundaries, frequency artefacts, temporal inconsistency) on the **actual frames** — which this system never uploads (privacy: only statistics leave the device). An arms race even for vendors who do.

#### C6. A second face in view (ID card held up, photo beside the face, a helper) — ✅
The person is the largest face; any other face — including card-sized ones found by the close-up scan of full-resolution snapshots — blocks approval, and a still one is flagged as a picture. **Measured** (`obs-relay-id`: second face frozen, `moved 0.0008`, `turned 0.004`).

### D. Attacking the protocol and the data

#### D1. Fabricating the payload instead of measuring it — ❌ / ◐
The server recomputes verdicts from raw statistics (flash from per-frame colours with **its** sequence, the noise map from tile stats, 3D from landmark samples with **its** order), so the client can't simply claim "live". But an attacker who writes their own client can **synthesise consistent raw statistics**: a genuine phone's device bundle recorded once can be replayed into every new session (device signals are not bound to the session), and camera statistics can be generated to satisfy the published analysis. This is detectable only statistically (identical bundles across sessions → velocity/link analysis) — the measurements themselves can't be proven.

#### D2. Reading the challenges — by design
The flash colours and the turn order **must** reach the browser to be displayed, so injection software can read them in real time. Challenges defeat *pre-recorded* content, never *reactive* content.

#### D3. The scoring engine is in the client bundle — ◐ (important)
For the preliminary on-device verdict, the whole engine — rules, weights, thresholds — ships to the browser, and the demo UI shows the **full report with every failing check**. That gives an attacker a perfect offline oracle: iterate until everything is green. In production: run the engine **server-side only**, show the user a neutral result, never the reasons, and rate-limit per identity/device.

#### D4. Token theft / replay / forwarding — ✅
Verdict tokens are HMAC-signed, single-use (`jti`), bound to an optional relying-party subject and expire in an hour; sessions are single-use and expire in 15 minutes. A token issued to one session can't be reused for another subject.

#### D5. Relay / "verify for me" social engineering — ❌
The attacker starts a verification bound to *their* account and sends the victim the link ("confirm your parcel"). The victim's real phone and real face pass — correctly. Only context helps: show clearly **what** is being verified and for **whom**, bind the session to a logged-in user on the same device, and watch for session hand-offs (IP/device change between session creation and analysis).

#### D6. Multi-instance servers — configuration
Replay protection, rate limits and velocity are in memory. With several replicas and no shared store (Redis/KV), a session could be replayed on another instance. Set `DETECTION_SECRET` everywhere and move the store to shared storage before scaling out.

### E. Real phone, real person, wrong intent

#### E1. Money mules, rented identities, coerced or tricked victims — ❌ (by definition)
Everything is genuine because it *is* genuine. Liveness answers "is a real person present on a real phone", not "is this person acting for themselves". Mitigations live elsewhere: velocity and link analysis (same device/fingerprint/IP across identities — partly implemented), behavioural context, transaction monitoring, manual review.

#### E2. The same person enrolling many accounts — ◐
Device fingerprint and velocity links catch the same phone; a different phone per account defeats it. De-duplicating **people** needs face embeddings stored and compared server-side — a legal/privacy decision (biometric data), deliberately not done here.

---

## 7. MuMu Player — measured

Source: `src/lib/detection/__tests__/mumu.test.ts`. Each setup is scored by the real engine with a PC/Mac webcam behind the emulator's camera, mouse clicks mapped to touches, and either MuMu's static virtual sensors or an injected realistic sensor stream.

| Setup | What the page sees | Result |
|---|---|---|
| **MuMu Player 12** (Windows), default | x86 NaN, `Linux x86_64`, model `MuMu`, PC GPU, S3TC textures | **decline** — emulator 100 % |
| MuMu Player 12, model renamed + GPU string spoofed to Adreno | same x86 NaN and platform; S3TC under an "Adreno" | **decline** — emulator 100 % |
| MuMu Player 12, + realistic sensor stream | as above | **decline** — emulator 97.1 % |
| **MuMu Player Pro** (Apple-silicon Mac), default | ARM NaN (passes), `Apple M2` GPU, model `MuMu` | **decline** — emulator 100 % |
| MuMu Player Pro, + realistic sensor stream | as above | **decline** — emulator 99.4 % |
| MuMu Player Pro, model → `Pixel 8 Pro`, GPU → `Adreno (TM) 740` | ARM, mobile-looking GPU, but 1×1 taps, software H.264, one camera, static sensors | **review** — corroborating emulator hints |
| … + realistic sensor stream | 1×1 taps, software H.264, one camera | **review** |
| … + finger-sized touches, hardware decoding reported, phone-like camera inventory | nothing left to see | **approve** ← the documented limit |

So: **yes, MuMu is detected** — the Windows version always (the x86 CPU can't be hidden), the Mac version in its default configuration and with a renamed model. What passes is a MuMu Pro instance whose operator has *also* faked the GPU string, the sensor stream, the touch geometry, the media capabilities and the camera inventory — at which point it is a real ARM Android build with every reported property forged, and only hardware attestation can tell.

---

## 8. Coverage matrix

✅ caught · ◐ partial / raises cost · ❌ blind · — not relevant

| Attack ↓ / Layer → | CPU | APIs | GPU | Sensors | Touch | Realms | Cam ID | Noise map | Flash | 3D | Faces | Server |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DevTools / UA spoof | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | — | ✅ |
| Anti-detect (JS) | ✅ | ✅ | ◐ | ✅ | ◐ | ✅ | ◐ | ✅ | ✅ | ◐ | — | ✅ |
| x86 emulators (MuMu 12…) | ✅ | ❌ | ✅ | ✅ | ◐ | — | ◐ | ◐ | ◐ | ❌ | — | ◐ |
| ARM VM, default (MuMu Pro) | ❌ | ❌ | ✅ | ◐ | ◐ | — | ◐ | ❌ | ❌ | ❌ | — | ◐ |
| ARM VM, fully faked | ❌ | ❌ | ❌ | ❌ | ❌ | — | ❌ | ❌ | ❌ | ❌ | — | ◐ |
| Patched browser engine | ◐ | ❌ | ◐ | ◐ | ◐ | ❌ | ❌ | ◐ | ◐ | ◐ | — | ◐ |
| OBS / virtual cam (renamed) | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ◐ | ◐ | ✅ | ✅ |
| JS stream injection | — | — | — | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| Rooted phone, OS camera injection | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ | ◐ | ◐ | ✅ | ◐ |
| Screen replay filmed by a real phone | — | — | — | — | — | — | ❌ | ❌ | ◐ | ◐ | — | — |
| Printed / moved / tilted photo | — | — | — | — | — | — | — | ◐ | ❌ | ✅ | ✅ | — |
| 3D mask | — | — | — | — | — | — | — | ❌ | ❌ | ❌ | — | — |
| Real-time deepfake via injection | — | — | — | — | — | — | ❌ | ◐ | ◐ | ❌ | — | — |
| Fabricated payload client | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ | ◐ | ❌ | ◐ |
| Mule / real person | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ |

Read it per row: an attack succeeds only if it gets past **every** gate that approves. Rows with a ✅ anywhere in an approval-blocking layer are stopped; rows made only of ◐/❌ are the residual risk.

---

## 9. What is impossible to build in a browser

These are not missing features; they are **limits of the web platform**. No amount of JavaScript fixes them.

1. **Prove the device is genuine.** There is no web API that returns a hardware-signed statement of the device model and OS integrity. (Play Integrity and App Attest are native-only; Web Environment Integrity was withdrawn; passkey attestation is normally empty; Private Access Tokens say "genuine Apple device", nothing more.)
2. **Detect root / jailbreak / hooking frameworks.** A page has no file system, no process list, no access to system properties.
3. **Prove camera frames came from the image sensor.** No browser exposes signed capture (camera-level content credentials) or any view of the camera pipeline below `getUserMedia`. OS-level injection is invisible.
4. **Use depth or infrared.** TrueDepth, ToF and IR cameras — what makes Face ID resistant to masks — are not exposed to the web; pages get RGB only.
5. **Keep a challenge secret.** Whatever the user must follow (colours, directions) is on the screen, so software on the device sees it too. Challenges beat recordings, never real-time generation.
6. **Guarantee code integrity.** The page's JavaScript can be read, modified, re-hosted or emulated. Obfuscation and rotation raise cost only.
7. **Prove a measurement happened.** The server can recompute conclusions from raw data, but it can't prove the raw data was measured rather than synthesised.
8. **Tell "alive" from "3D".** Geometry proves shape. Distinguishing skin from silicone needs trained texture/material models or depth/IR hardware.
9. **Beat a perfect real-time deepfake in general.** Detection is statistical and model-specific; each new generator shifts the target.
10. **Know intent.** A real person on their own phone acting for a fraudster is indistinguishable from an honest user.
11. **Reach 100 %.** Every threshold trades false accepts for false rejects. The honest target is: make the cheapest successful attack expensive and push the rest to manual review.

---

## 10. What would close the remaining gaps

Ordered by value for effort. ✔ = already done in this repo.

| # | Change | Closes / narrows | Cost / trade-off |
|---|---|---|---|
| ✔ | Apple-silicon GPU under Android = emulator; MuMu model names | Default MuMu Pro / arm64 AVDs (A5) | — |
| ✔ | Two soft emulator hints block approval | Spoofed-model ARM VMs (A5) | Rare real phones with two quirks go to review |
| 1 | **Flash as a gate**: "no response with a face in view" blocks approval and asks to retry in a darker spot | Screen replays (B5), pre-recorded clips (C3) | More retries outdoors |
| 2 | **More challenge entropy**: 3–4 steps from {left, right, up, down} at random times; reject turns that start before the prompt | Clip selection (C3, B5) | Slightly longer flow |
| 3 | **Server-only scoring**, neutral user-facing result, no reasons shown | The oracle problem (D3) | Less transparency for users |
| 4 | **Session-bound measurements**: seed WebGL scenes, noise-map tile positions and timing probes with the session nonce | Replayed device bundles (D1) | Engineering effort |
| 5 | **Upload a short encrypted clip** (or random frames) for server-side PAD and deepfake models | Screen replays, masks, deepfakes (B5, C4, C5) | Privacy/legal (biometric data), compute |
| 6 | **Native app / SDK** with Play Integrity (strong integrity), App Attest, root/jailbreak detection, native camera | ARM VMs, rooted injection, patched browsers (A5–A7, B4) | Users must install an app |
| 7 | **Risk layer**: shared velocity store, device reputation, consortium data, manual review queue | Mules, farms, fabricated payloads (A9, D1, E1) | Operations |

The biggest single jump is **#6**: moving the capture into a native app turns "measure and hope" into "verify a hardware-signed statement". Everything else keeps raising the price of the attacks in §6 without ever making them impossible.

---

## 11. Honest calibration status

- **Measured in this repo**: unit fixtures for real iPhone/Pixel, desktops, DevTools, emulators (incl. MuMu variants), OBS attacks; e2e runs through real Chromium with Chromium's fake camera fed by rendered clips (tilted photo, 3D face mesh, OBS still and relay scenes); landmark recordings of real MediaPipe output.
- **Not yet measured**: real phones across brands and price ranges, real people in varied light, real masks, real rooted-phone injection, real deepfakes, real MuMu Pro installs (the MuMu rows use fixtures modelled on documented behaviour: ARM on Apple silicon, x86 on Windows, default model `MuMu`).
- **Before production**: collect `/api/analyze` payloads from real traffic (with consent), measure false-reject rates per rule, and tune `engine/rules/*` and `camera/liveness3d.ts`. Expect to adjust thresholds; the ordering of defences in this document should not change.
