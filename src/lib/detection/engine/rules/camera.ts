import { FLAT_TILT } from "../../camera/liveness3d";
import { classifyCameraLabel, facingFromLabel, HARDWARE_CAPABILITY_KEYS, hasUsbIds } from "../../knowledge/cameras";
import type { CameraCapture, MediaDeviceRecord } from "../../types";
import type { Add, Ctx } from "../context";
import { fmt, list } from "../context";

const facingOf = (d: MediaDeviceRecord): "front" | "back" | null => {
  if (d.facingMode?.includes("environment")) return "back";
  if (d.facingMode?.includes("user")) return "front";
  return facingFromLabel(d.label);
};

function hwCaps(cap: CameraCapture | null): string[] {
  const caps = cap?.capabilities;
  if (!caps) return [];
  return HARDWARE_CAPABILITY_KEYS.filter((k) => k in caps);
}

export function cameraRules(c: Ctx, add: Add) {
  const cam = c.bundle.camera;
  const { claims } = c;
  if (!cam) {
    add({ id: "camera.skipped", title: "Camera test", value: "not run", detail: "The camera step has not been completed yet.", status: "info" });
    return;
  }
  if (!cam.supported) {
    add({
      id: "camera.unsupported",
      title: "Camera API",
      value: "getUserMedia unavailable",
      detail: "No camera API in this context (insecure origin, WebView restriction or hardened browser).",
      status: "warn",
      evidence: { phone: -0.3 },
    });
    return;
  }

  /* ----------------------------- Provenance -------------------------------- */
  if (!cam.getUserMediaNative || !cam.enumerateDevicesNative) {
    add({
      id: "camera.hooked",
      title: "Camera API integrity",
      value: [!cam.getUserMediaNative && "getUserMedia", !cam.enumerateDevicesNative && "enumerateDevices"].filter(Boolean).join(" + ") + " hooked",
      detail: "The camera APIs were replaced by JavaScript — the hallmark of stream-injection kits that feed a pre-recorded video instead of the sensor.",
      status: "fail",
      evidence: { spoofed: 1.0, automation: 0.5, phone: -0.8 },
      cameraEvidence: { injected: 4.0, physical: -2.5 },
    });
  }

  if (cam.permission === "denied") {
    add({ id: "camera.permission", title: "Camera permission", value: "denied", detail: "The user (or a policy) blocked camera access; camera authenticity cannot be established.", status: "warn" });
  } else if (cam.permission === "no-device") {
    add({
      id: "camera.permission",
      title: "Camera permission",
      value: "no camera found",
      detail: claims.mobile ? "Every phone has cameras; none could be opened." : "No camera attached.",
      status: claims.mobile ? "fail" : "warn",
      evidence: claims.mobile ? { emulator: 1.0, spoofed: 0.5, phone: -1.5, tablet: -1.0 } : { desktop: 0.3 },
    });
  } else if (cam.permission === "error") {
    add({ id: "camera.permission", title: "Camera permission", value: cam.errorName ?? "error", detail: cam.error ?? "Camera failed to start.", status: "warn" });
  }

  /* ------------------------------ Inventory -------------------------------- */
  const devices = (cam.devicesAfter.some((d) => d.label) ? cam.devicesAfter : cam.devicesBefore).filter((d) => d.kind === "videoinput");
  // Some engines (Firefox with a one-time grant) return blank labels/ids: that is "unknown", not evidence.
  const labelsVisible = devices.some((d) => d.label);
  if (devices.length && !labelsVisible && !devices.some((d) => d.facingMode?.length)) {
    add({ id: "camera.inventory", title: "Camera inventory", value: `${devices.length} camera(s), labels hidden`, detail: "The browser hides camera names, so the inventory cannot be assessed.", status: "info" });
  } else if (devices.length) {
    const kinds = devices.map((d) => ({ d, k: classifyCameraLabel(d.label) }));
    const virtualInstalled = kinds.filter((x) => x.k.kind === "virtual" || x.k.kind === "capture-card");
    const rear = devices.filter((d) => facingOf(d) === "back");
    const front = devices.filter((d) => facingOf(d) === "front");
    add({
      id: "camera.inventory",
      title: "Camera inventory",
      value: `${devices.length} camera(s) · ${front.length} front · ${rear.length} rear`,
      detail: devices.map((d) => d.label || "(label hidden)").join(" · "),
      status: rear.length >= 2 ? "pass" : rear.length === 1 && front.length ? "pass" : claims.mobile && devices.length === 1 ? "warn" : "info",
      evidence:
        rear.length >= 2
          ? { phone: 1.4, tablet: 0.4, desktop: -1.0, spoofed: -1.5 }
          : rear.length === 1 && front.length
            ? { phone: 0.8, tablet: 0.8, desktop: -0.8, spoofed: -1.0 }
            : claims.mobile && devices.length === 1 && !rear.length
              ? { spoofed: 1.0, desktop: 0.5, phone: -0.8 }
              : {},
    });
    if (virtualInstalled.length) {
      add({
        id: "camera.virtual-installed",
        title: "Virtual camera software installed",
        value: list(virtualInstalled.map((x) => x.k.product ?? x.d.label)),
        detail: "Virtual camera drivers / capture devices are present on this machine — desktop tooling used to inject video.",
        status: "fail",
        evidence: { spoofed: 1.0, desktop: 0.5, phone: -1.0, tablet: -0.8 },
        cameraEvidence: { virtual: 0.5 },
      });
    }
  } else if (cam.permission === "granted") {
    add({ id: "camera.inventory", title: "Camera inventory", value: "empty", detail: "enumerateDevices() returned no cameras despite an open stream.", status: "warn", cameraEvidence: { injected: 1.5 } });
  }

  const f = cam.front;
  if (!f) return;

  /* --------------------------- Selected camera ----------------------------- */
  const kind = classifyCameraLabel(f.label);
  const usb = hasUsbIds(f.label);
  const labelFinding: Record<string, () => void> = {
    virtual: () =>
      add({
        id: "camera.label",
        title: "Active camera",
        value: f.label,
        detail: `This is ${kind.product}, a software camera — frames can be any video or image.`,
        status: "fail",
        evidence: { spoofed: 1.0, desktop: 0.5, phone: -1.0 },
        cameraEvidence: { virtual: 5.0, physical: -3.0 },
      }),
    "capture-card": () =>
      add({
        id: "camera.label",
        title: "Active camera",
        value: f.label,
        detail: `${kind.product}: an HDMI/video capture device, commonly used to inject a second computer's output.`,
        status: "fail",
        evidence: { spoofed: 1.0, desktop: 0.5, phone: -1.0 },
        cameraEvidence: { virtual: 4.0, physical: -2.0 },
      }),
    synthetic: () =>
      add({
        id: "camera.label",
        title: "Active camera",
        value: f.label,
        detail: "Chromium's built-in fake capture device (launched with --use-fake-device-for-media-stream): an automation/test setup.",
        status: "fail",
        evidence: { automation: 1.5, phone: -1.5, tablet: -1.5 },
        cameraEvidence: { synthetic: 5.0, physical: -3.0 },
      }),
    android: () =>
      add({
        id: "camera.label",
        title: "Active camera",
        value: f.label,
        detail: "Android Camera2 HAL naming (“camera2 N, facing …”).",
        status: "pass",
        evidence: { phone: 1.0, tablet: 0.8, emulator: 0.6, spoofed: -2.0, desktop: -2.0 },
        cameraEvidence: { physical: 0.8 },
      }),
    ios: () =>
      add({
        id: "camera.label",
        title: "Active camera",
        value: f.label,
        detail: "iOS AVFoundation camera naming.",
        status: "pass",
        evidence: { phone: 1.0, tablet: 0.8, emulator: 0.3, spoofed: -2.0, desktop: -1.5 },
        cameraEvidence: { physical: 0.8 },
      }),
    continuity: () =>
      add({
        id: "camera.label",
        title: "Active camera",
        value: f.label,
        detail: "macOS Continuity Camera — a real iPhone, but used as a webcam by a Mac.",
        status: "warn",
        evidence: { desktop: 1.2, spoofed: 1.0, phone: -1.5, tablet: -1.0 },
        cameraEvidence: { physical: 0.5 },
      }),
    "desktop-webcam": () =>
      add({
        id: "camera.label",
        title: "Active camera",
        value: f.label,
        detail: claims.mobile
          ? `Desktop webcam naming${usb ? " with a USB vendor:product id" : ""} behind a mobile user agent.`
          : `Desktop webcam${usb ? " (USB)" : ""}.`,
        status: claims.mobile ? "fail" : "info",
        evidence: claims.mobile ? { spoofed: usb ? 2.8 : 2.2, desktop: 0.8, phone: -2.2, tablet: -1.5 } : { desktop: 0.8, phone: -1.0 },
        cameraEvidence: { physical: 0.5 },
      }),
    unknown: () =>
      add({
        id: "camera.label",
        title: "Active camera",
        value: f.label || "(empty label)",
        detail: f.label ? "Unrecognised camera naming." : "A granted camera with an empty label is unusual (possible injected track).",
        status: f.label ? "info" : "warn",
        cameraEvidence: f.label ? {} : { injected: 1.5 },
      }),
  };
  (labelFinding[kind.kind] ?? labelFinding.unknown)();

  const ctor = f.trackConstructor;
  const knownIds = new Set(cam.devicesAfter.map((d) => d.deviceId).filter(Boolean));
  const idKnown = !f.deviceId || knownIds.size === 0 || knownIds.has(f.deviceId);
  const badCtor = ctor && ctor !== "MediaStreamTrack" && ctor !== "unknown";
  if (badCtor || !f.deviceId || !idKnown) {
    add({
      id: "camera.provenance",
      title: "Stream provenance",
      value: `${ctor}${f.deviceId ? "" : " · no deviceId"}${idKnown ? "" : " · unknown deviceId"}`,
      detail: badCtor
        ? "The track is not a device capture track (e.g. CanvasCaptureMediaStreamTrack) — the video is synthesised in the page."
        : "The track is not bound to any enumerated capture device.",
      status: "fail",
      cameraEvidence: badCtor ? { injected: 5.0, physical: -3.0 } : { injected: 2.0, physical: -0.8 },
    });
  } else {
    add({
      id: "camera.provenance",
      title: "Stream provenance",
      value: `${ctor} · device ${f.deviceId.slice(0, 8)}`,
      detail: "A genuine capture track bound to an enumerated device.",
      status: "pass",
      cameraEvidence: { injected: -1.0 },
    });
  }

  /* --------------------------- Hardware controls --------------------------- */
  const rear = cam.rear;
  const hwFront = hwCaps(f);
  const hwRear = hwCaps(rear);
  const allHw = Array.from(new Set([...hwFront, ...hwRear]));
  if (allHw.length >= 3) {
    add({
      id: "camera.controls",
      title: "Sensor controls",
      value: list(allHw, 6),
      detail: "The capture pipeline exposes real ISP controls (focus, exposure, white balance, zoom...). Virtual and injected cameras rarely do.",
      status: "pass",
      cameraEvidence: { physical: 1.5, virtual: -1.0, injected: -1.0, synthetic: -0.8 },
    });
  } else if (f.capabilities) {
    add({
      id: "camera.controls",
      title: "Sensor controls",
      value: allHw.length ? list(allHw) : "resolution/frame-rate only",
      detail: "Only basic capabilities are exposed (typical of desktop webcams on some platforms, virtual cameras and injected tracks).",
      status: "info",
      cameraEvidence: allHw.length ? {} : { virtual: 0.6, injected: 0.4, synthetic: 0.4 },
    });
  }
  const torch = Boolean(rear?.capabilities && (rear.capabilities as Record<string, unknown>).torch === true) || Boolean(f.capabilities && (f.capabilities as Record<string, unknown>).torch === true);
  const flashModes = [f.photoCapabilities, rear?.photoCapabilities]
    .map((p) => (p?.fillLightMode as string[] | undefined) ?? [])
    .flat();
  if (torch || flashModes.includes("flash")) {
    add({
      id: "camera.flash-led",
      title: "Camera flash LED",
      value: [torch && "torch", flashModes.includes("flash") && "fillLightMode: flash"].filter(Boolean).join(" · "),
      detail: "A controllable LED flash is attached to the camera module — phone hardware.",
      status: "pass",
      evidence: { phone: 1.5, tablet: 0.6, desktop: -1.5, spoofed: -2.0, emulator: -0.8 },
      cameraEvidence: { physical: 1.0 },
    });
  }
  const zoom = (rear?.capabilities?.zoom ?? f.capabilities?.zoom) as { max?: number } | undefined;
  if (zoom?.max && zoom.max >= 2) {
    add({
      id: "camera.zoom",
      title: "Optical/digital zoom range",
      value: `up to ${fmt(zoom.max, 1)}×`,
      detail: "Zoom control exposed by the camera HAL.",
      status: "pass",
      evidence: { phone: 0.6, tablet: 0.4 },
    });
  }
  const photoW = [f.photoCapabilities, rear?.photoCapabilities].map((p) => (p?.imageWidth as { max?: number } | undefined)?.max ?? 0);
  const maxPhoto = Math.max(...photoW);
  if (maxPhoto >= 3000) {
    add({
      id: "camera.photo-res",
      title: "Still-photo resolution",
      value: `${maxPhoto}px wide`,
      detail: "High-resolution still capture (multi-megapixel sensor).",
      status: "pass",
      evidence: { phone: 0.6, tablet: 0.4, desktop: -0.4 },
      cameraEvidence: { physical: 0.8 },
    });
  }

  const rearListKnown = cam.devicesAfter.some((d) => d.label || d.facingMode?.length);
  if (!rear && cam.rearError && claims.mobile && rearListKnown && /Overconstrained|NotFound|No second camera/i.test(cam.rearError)) {
    add({
      id: "camera.rear",
      title: "Rear camera",
      value: "not available",
      detail: "Phones have a rear camera; none could be opened.",
      status: "warn",
      evidence: { spoofed: 1.0, desktop: 0.5, emulator: 0.3, phone: -1.0, tablet: -0.3 },
    });
  }

  /* -------------------------- Orientation physics -------------------------- */
  const portraitDevice = c.d.screen.media.portrait || /portrait/.test(c.d.screen.orientationType ?? "");
  if (claims.phone && portraitDevice && f.videoWidth && f.videoHeight) {
    const portraitVideo = f.videoHeight > f.videoWidth;
    add({
      id: "camera.orientation",
      title: "Frame orientation",
      value: `${f.videoWidth}×${f.videoHeight} on a portrait screen`,
      detail: portraitVideo
        ? "The sensor image is rotated to match the handset's portrait orientation, as mobile browsers do."
        : "Landscape frames on a portrait-held “phone”: a desktop webcam or virtual camera feed.",
      status: portraitVideo ? "pass" : "warn",
      evidence: portraitVideo ? { phone: 0.8, tablet: 0.5, spoofed: -1.2, desktop: -0.8 } : { spoofed: 1.0, phone: -0.6 },
      cameraEvidence: portraitVideo ? { physical: 0.4 } : { virtual: 0.6, injected: 0.4 },
    });
  }

  /* ---------------------------- Pixel forensics ---------------------------- */
  const A = f.aggregate;
  const t = f.timing;
  add({
    id: "camera.capture",
    title: "Capture window",
    value: `${t.frames} frames in ${t.captureMs} ms · ${fmt(t.fps, 1)} fps · jitter CV ${fmt(t.intervalCv, 3)}${t.dropped ? ` · ${t.dropped} dropped` : ""}`,
    detail: `${f.videoWidth}×${f.videoHeight}${f.settings.frameRate ? ` @ ${fmt(Number(f.settings.frameRate), 1)} fps` : ""}; opened in ${t.openMs} ms, first frame after ${t.firstFrameMs ?? "?"} ms.`,
    status: t.frames >= 8 ? "info" : "warn",
    cameraEvidence: t.rvfc && t.frames >= 15 && t.intervalCv !== null && t.intervalCv < 0.01 ? { synthetic: 0.4, virtual: 0.4 } : {},
  });
  if (!A || A.frames < 5) return;

  if (A.dark) {
    add({
      id: "camera.dark",
      title: "Scene brightness",
      value: `mean luma ${fmt(A.meanLuma, 1)}`,
      detail: "The frames are nearly black (lens covered, privacy shutter or very dark room) — pixel forensics are inconclusive.",
      status: "warn",
    });
  } else {
    if (t.rvfc && A.frames >= 8 && A.duplicateRatio >= 0.5) {
      add({
        id: "camera.frozen",
        title: "Frozen frames",
        value: `${Math.round(A.duplicateRatio * 100)}% of consecutive frames identical`,
        detail: "New frames were delivered but their pixels never changed — a still image is being streamed.",
        status: "fail",
        cameraEvidence: { virtual: 2.2, injected: 2.0, synthetic: 1.5, physical: -3.0 },
      });
    }
    const tn = A.temporalNoise;
    const zr = A.zeroDiffRatio;
    if (tn !== null && zr !== null) {
      if (zr >= 0.985 && tn < 0.1) {
        add({
          id: "camera.noise",
          title: "Sensor noise",
          value: `σ ${fmt(tn, 3)} · ${Math.round(zr * 1000) / 10}% bit-identical pixels`,
          detail: "Static regions are bit-for-bit identical between frames. A CMOS sensor always produces photon (shot) noise — this feed is computer-generated.",
          status: "fail",
          cameraEvidence: { synthetic: 2.5, virtual: 1.5, injected: 1.5, physical: -3.0 },
        });
      } else if (tn >= 0.25 && zr < 0.9) {
        add({
          id: "camera.noise",
          title: "Sensor noise",
          value: `temporal σ ${fmt(tn, 2)} · spatial σ ${fmt(A.spatialNoise, 2)}`,
          detail: "Random frame-to-frame noise consistent with a physical image sensor.",
          status: "pass",
          cameraEvidence: { physical: 2.0, synthetic: -1.5, virtual: -0.5 },
        });
      } else {
        add({
          id: "camera.noise",
          title: "Sensor noise",
          value: `temporal σ ${fmt(tn, 3)} · ${Math.round(zr * 1000) / 10}% unchanged`,
          detail: "Very low noise — strong ISP denoising in bright light, or a processed feed.",
          status: "info",
          cameraEvidence: { physical: 0.2 },
        });
      }
    }
    if (A.noiseIntensityCorr !== null && A.noiseIntensityCorr >= 0.5 && A.noiseByIntensity.length >= 3) {
      add({
        id: "camera.shot-noise",
        title: "Noise vs brightness",
        value: `r = ${fmt(A.noiseIntensityCorr, 2)} over ${A.noiseByIntensity.length} bands`,
        detail: "Noise grows with brightness — the Poisson shot-noise signature of real photon capture.",
        status: "pass",
        cameraEvidence: { physical: 0.6 },
      });
    }
    if (A.blockiness >= 1.35) {
      add({
        id: "camera.blocking",
        title: "Codec block artifacts",
        value: `8-px grid energy ×${fmt(A.blockiness, 2)}`,
        detail: "Gradient energy concentrates on an 8-pixel grid: the frames were decoded from a compressed video file, not read from a sensor.",
        status: "warn",
        cameraEvidence: { virtual: 1.0, injected: 1.0, physical: -0.8 },
      });
    }
    if (A.uniform || A.entropy < 3) {
      add({
        id: "camera.flat",
        title: "Image content",
        value: `entropy ${fmt(A.entropy, 2)} bits · σ ${fmt(A.lumaStd, 1)}`,
        detail: "Almost no texture: a flat synthetic pattern or a covered lens.",
        status: "warn",
        cameraEvidence: { synthetic: 1.0 },
      });
    }
  }

  /* -------------------------- Flash challenge ------------------------------ */
  const fl = f.flash;
  if (fl) {
    const v = `${fl.sequence.join("→")} · r=${fmt(fl.correlation, 2)}${fl.lagMs !== null ? ` · lag ${fl.lagMs} ms` : ""}${fl.amplitude !== null ? ` · Δchroma ${fmt(fl.amplitude, 4)}` : ""}`;
    const faceOk = (f.face?.framesWithFace ?? 0) >= 2;
    if (fl.verdict === "responsive") {
      add({
        id: "camera.flash",
        title: "Screen-light reflection challenge",
        value: v,
        detail: "The frames changed colour in lock-step with the server-chosen screen flashes. Only a live camera looking at a real scene lit by this screen can do that.",
        status: "pass",
        evidence: { phone: 0.3, tablet: 0.3 },
        cameraEvidence: { physical: 2.8, virtual: -2.0, injected: -2.0, synthetic: -2.0 },
      });
    } else if (fl.verdict === "weak") {
      add({ id: "camera.flash", title: "Screen-light reflection challenge", value: v, detail: "A faint response to the flashes (bright ambient light or distance).", status: "info", cameraEvidence: { physical: 0.6 } });
    } else if (fl.verdict === "none") {
      add({
        id: "camera.flash",
        title: "Screen-light reflection challenge",
        value: v,
        detail: faceOk
          ? "A face was visible but the image did not react to the screen flashes — expected for a pre-recorded or injected feed."
          : "No reaction to the screen flashes (no face close to the screen, or strong ambient light).",
        status: "warn",
        cameraEvidence: faceOk ? { virtual: 0.8, injected: 0.8, synthetic: 0.4 } : { virtual: 0.3, injected: 0.3 },
      });
    } else {
      add({ id: "camera.flash", title: "Screen-light reflection challenge", value: "inconclusive", detail: "Not enough usable frames.", status: "info" });
    }
  }

  /* --------------------------------- Face ---------------------------------- */
  const face = f.face;
  if (face?.available) {
    const frozen = face.framesWithFace >= 3 && face.landmarkMotion === 0;
    const pose = face.pose;
    add({
      id: "camera.face",
      title: "Face (MediaPipe FaceLandmarker, 478 points)",
      value: `${face.framesWithFace}/${face.framesAnalyzed} frames${face.maxFaces > 1 ? ` · ${face.maxFaces} faces` : ""}${pose ? ` · yaw ${fmt(pose.yaw, 0)}° pitch ${fmt(pose.pitch, 0)}° roll ${fmt(pose.roll, 0)}°` : ""}`,
      detail: frozen
        ? "All 478 landmarks stayed pixel-identical across the capture — a still image, not a live face."
        : face.framesWithFace
          ? "A face was tracked with natural landmark micro-motion."
          : "No face in view during the capture.",
      status: frozen ? "warn" : face.framesWithFace ? "pass" : "info",
      cameraEvidence: frozen ? { virtual: 0.8, injected: 0.6, physical: -0.5 } : face.framesWithFace >= 2 ? { physical: 0.3 } : {},
    });
    if (face.maxFaces > 1) {
      add({
        id: "camera.multi-face",
        title: "Multiple faces",
        value: `${face.maxFaces} faces in frame`,
        detail: "More than one person is in view (someone assisting, or a photo held beside the face).",
        status: "warn",
      });
    }
    if (face.framesWithFace >= 2 && face.landmarkMotion !== null) {
      add({
        id: "camera.face-motion",
        title: "Facial micro-motion",
        value: `landmarks ${fmt(face.landmarkMotion, 4)} · non-rigid ${fmt(face.nonRigidMotion, 4)} (face-width units)`,
        detail: "Global motion comes from the hand holding the phone; non-rigid motion (expression, blinking, breathing) remains after removing translation and scale. A printed or on-screen face only moves rigidly.",
        status: "info",
      });
    }
    if (face.eyeBlink) {
      const closed = face.eyeBlink.median > 0.6;
      add({
        id: "camera.eyes",
        title: "Eyes",
        value: `blink score median ${fmt(face.eyeBlink.median, 2)} · max ${fmt(face.eyeBlink.max, 2)}`,
        detail: closed ? "Eyes appear closed for most of the capture." : face.eyeBlink.max > 0.6 ? "A blink was captured." : "Eyes open.",
        status: closed ? "warn" : "info",
      });
    }
    if (face.faceArea !== null && face.faceArea !== undefined && face.framesWithFace) {
      add({
        id: "camera.face-framing",
        title: "Face framing",
        value: `${Math.round(face.faceArea * 100)}% of frame${face.centered === false ? " · off-centre" : ""}`,
        detail: face.faceArea < 0.03 ? "The face is far from the camera." : "Face size and position recorded.",
        status: "info",
      });
    }
  } else if (face) {
    add({ id: "camera.face", title: "Face (MediaPipe FaceLandmarker)", value: "model unavailable", detail: face.error ?? "Face model not loaded in time.", status: "info" });
  }

  /* ------------------------- Active 3D liveness ---------------------------- */
  depthRules(c, add);

  const mo = A?.moire;
  if (mo && !A?.dark) {
    add({
      id: "camera.moire",
      title: "Screen recapture (moiré)",
      value: `spectral peak ×${fmt(mo.peakRatio, 1)} at ${fmt(mo.frequency, 3)} cyc/px`,
      detail: mo.suspicious
        ? "A sharp periodic peak dominates the image spectrum — the aliasing pattern produced when a camera films another screen (replay attack)."
        : "No periodic screen-pixel pattern in the frames.",
      status: mo.suspicious ? "warn" : "pass",
      cameraEvidence: mo.suspicious ? { virtual: 0.6, injected: 0.4, physical: -0.6 } : { physical: 0.2 },
    });
  }

  /* ------------------------------ Rear sensor ------------------------------ */
  const RA = rear?.aggregate;
  if (rear && RA && !RA.dark && RA.temporalNoise !== null && RA.zeroDiffRatio !== null) {
    const synthetic = RA.zeroDiffRatio >= 0.985 && RA.temporalNoise < 0.1;
    const physical = RA.temporalNoise >= 0.25 && RA.zeroDiffRatio < 0.9;
    add({
      id: "camera.rear-noise",
      title: "Rear sensor noise",
      value: `${rear.label || "rear"} · σ ${fmt(RA.temporalNoise, 3)}`,
      detail: synthetic ? "The rear camera shows a noise-free rendered scene (emulator virtual scene camera)." : physical ? "Rear camera shows physical sensor noise." : "Low-noise rear frames.",
      status: synthetic ? "fail" : physical ? "pass" : "info",
      evidence: synthetic ? { emulator: 1.5, phone: -1.0 } : physical ? { phone: 0.5, tablet: 0.5 } : {},
      cameraEvidence: synthetic ? { synthetic: 1.0 } : physical ? { physical: 0.5 } : {},
    });
  }
}

export function cameraTested(c: Ctx): boolean {
  return Boolean(c.bundle.camera?.front);
}

export { facingOf };

/** Phone rotation (°) during the head turn above which the "turn" may be the camera orbiting a static prop. */
export const ORBIT_DEG = 25;

function depthRules(c: Ctx, add: Add) {
  const a = c.bundle.camera?.active3d;
  const d = c.depth;
  if (!a || !d) return;
  const order = a.challenge.join(" → ") || "—";
  if (a.status === "skipped") {
    add({ id: "camera.depth", title: "3D head-turn liveness", value: "not run", detail: "The head-turn challenge was not performed.", status: "info" });
    return;
  }
  if (d.verdict === "unavailable") {
    add({
      id: "camera.depth",
      title: "3D head-turn liveness",
      value: a.status,
      detail: a.error ? `Face tracking unavailable: ${a.error}` : "Face tracking was unavailable on this device.",
      status: "info",
    });
    return;
  }
  const geometry = `parallax ${fmt(d.parallax, 2)} · depth slope ${fmt(d.depthSlope, 2)} · tilt ${fmt(d.tilt, 2)}`;
  if (d.verdict === "flat") {
    add({
      id: "camera.depth",
      title: "3D head-turn liveness",
      value: `flat · ${geometry}`,
      detail:
        (d.tilt ?? 0) >= FLAT_TILT
          ? "The face narrowed as if turned, but the nose stayed centred between the cheeks — the foreshortening of a flat picture being tilted. A real head's nose always leads the turn. This is a photo, a screen or a flat mask held in front of the camera."
          : "Across the head turn every facial landmark moved as one plane (a single homography explains the frontal and turned views). A real head has depth — the nose moves differently from the cheeks and ears. This is a photo, a screen or a flat mask held in front of the camera.",
      status: "fail",
      evidence: { phone: -0.4 },
      cameraEvidence: { physical: -1.2, virtual: 1.0, injected: 1.0 },
    });
  } else if (d.verdict === "live-3d") {
    add({
      id: "camera.depth",
      title: "3D head-turn liveness",
      value: `3D face · ${geometry}`,
      detail:
        "As the head turned, the nose tip shifted against the face outline and the landmarks departed from any planar mapping in proportion to the turn — the geometry of a real three-dimensional head, followed live.",
      status: "pass",
      evidence: { phone: 0.2, tablet: 0.2 },
      cameraEvidence: { physical: 1.4, virtual: -0.6, injected: -0.8, synthetic: -1.2 },
    });
  } else {
    add({
      id: "camera.depth",
      title: "3D head-turn liveness",
      value: `${a.status === "completed" ? "inconclusive" : a.status} · ${geometry}`,
      detail:
        a.status === "no-face"
          ? "No face was found in view during the head-turn challenge."
          : a.status === "timeout"
            ? "The requested head turns were not completed in time."
            : "The head did not turn far enough to measure depth.",
      status: "warn",
      cameraEvidence: a.status === "no-face" ? { synthetic: 0.4 } : {},
    });
  }

  add({
    id: "camera.depth-order",
    title: "Head-turn challenge order",
    value: `asked ${order} · did ${d.reached.join(" → ") || "—"}`,
    detail: d.orderOk
      ? "The head turned in the order this server issued. A pre-recorded clip cannot know the order in advance."
      : "The turns did not follow the order this server issued.",
    status: d.orderOk ? "pass" : "warn",
    cameraEvidence: d.orderOk ? { injected: -0.3, virtual: -0.3 } : d.reached.length ? { injected: 0.5, virtual: 0.5 } : {},
  });

  if (d.deviceRotationDeg !== null && (d.parallax ?? 0) >= 0.1) {
    const orbit = d.deviceRotationDeg >= ORBIT_DEG;
    add({
      id: "camera.depth-device",
      title: "Phone rotation during head turn",
      value: `${fmt(d.deviceRotationDeg, 1)}°`,
      detail: orbit
        ? "The phone itself rotated about as much as the face appeared to — the camera may have been swung around a static head model instead of a person turning."
        : "The gyroscope shows the phone stayed steady while the head turned: the motion came from the person, not the camera.",
      status: orbit ? "warn" : "pass",
      cameraEvidence: orbit ? { physical: -0.3 } : { physical: 0.3 },
    });
  }
}
