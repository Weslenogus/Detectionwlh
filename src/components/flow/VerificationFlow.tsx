"use client";

import { LoaderCircle, Lock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CameraTestResult } from "@/lib/detection/camera/capture";
import { preloadFaceDetector } from "@/lib/detection/camera/face";
import { randomSequence } from "@/lib/detection/camera/flash";
import { runDeviceScan, SCAN_STEPS } from "@/lib/detection/collect";
import { evaluate } from "@/lib/detection/engine";
import { InteractionTracker } from "@/lib/detection/interaction/tracker";
import { analyzeMotion } from "@/lib/detection/sensors/analysis";
import { motionPermissionRequired, MotionSampler, requestMotionPermission } from "@/lib/detection/sensors/motion-sampler";
import type { DeviceSignals, FlashColor, Report, SignalBundle } from "@/lib/detection/types";
import { errorMessage, sleep } from "@/lib/detection/util/safe";
import { ReportView } from "../report/ReportView";
import { Card, cx } from "../ui";
import { CameraStep } from "./CameraStep";
import { ScanStep, type StepState } from "./ScanStep";

type Stage = "scan" | "camera" | "submitting" | "report";

interface Session {
  token: string | null;
  challenge: FlashColor[];
  id: string | null;
  error?: string;
}

const initialSteps = () => Object.fromEntries(SCAN_STEPS.map((s) => [s.id, { status: "pending" as const }])) as StepState;

async function createSession(): Promise<Session> {
  try {
    const r = await fetch("/api/session", { method: "POST", cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { sessionToken: string; challenge: FlashColor[]; sessionId: string };
    return { token: j.sessionToken, challenge: j.challenge, id: j.sessionId };
  } catch (e) {
    // Offline / static hosting: fall back to a local challenge and client-side scoring.
    return { token: null, challenge: randomSequence(), id: null, error: errorMessage(e) };
  }
}

export function VerificationFlow() {
  const [stage, setStage] = useState<Stage>("scan");
  const [steps, setSteps] = useState<StepState>(initialSteps);
  const [device, setDevice] = useState<DeviceSignals | null>(null);
  const [prelim, setPrelim] = useState<Report | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [beforeCamera, setBeforeCamera] = useState<Promise<unknown> | null>(null);
  const [camera, setCamera] = useState<CameraTestResult | null>(null);
  const [cameraReport, setCameraReport] = useState<Report | null>(null);
  const [final, setFinal] = useState<{ report: Report; bundle: SignalBundle; serverError: string | null } | null>(null);
  const motion = useRef<MotionSampler | null>(null);
  const tracker = useRef<InteractionTracker | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const m = new MotionSampler();
    motion.current = m;
    m.start();
    const t = new InteractionTracker();
    tracker.current = t;
    t.attach();
    void createSession().then(setSession);

    const t0 = performance.now();
    void runDeviceScan({
      onProgress: (id, status, detail) => setSteps((s) => ({ ...s, [id]: { status, detail } })),
      waitForSensors: async () => {
        // Give the sensors ~2.2 s from page load to stream (they keep recording afterwards).
        while (performance.now() - t0 < 2200 && m.sampleCount < 120) await sleep(100);
        const a = analyzeMotion(m.snapshot());
        if (a.verdict === "absent" && motionPermissionRequired()) return "iOS: permission requested on Continue";
        return `${a.verdict} · ${a.samples + a.orientationSamples} samples${a.rateHz ? ` @ ${a.rateHz} Hz` : ""}`;
      },
    }).then((d) => {
      setDevice(d);
      setPrelim(evaluate({ device: d, motion: m.snapshot(), interaction: t.snapshot(), camera: null }, { source: "client" }));
      // Warm up the face model in the background while the user reads the result.
      void preloadFaceDetector().catch(() => undefined);
    });
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [stage]);

  const onContinueDevice = () => {
    const m = motion.current;
    let permission: Promise<unknown> = Promise.resolve();
    // iOS: must be requested synchronously inside this tap.
    if (m && motionPermissionRequired()) {
      permission = requestMotionPermission().then((r) => {
        m.setPermission(r.state, r.error);
        if (r.state === "granted") m.restart();
      });
    }
    setBeforeCamera(permission);
    setStage("camera");
  };

  const onCameraFinished = useCallback(
    (r: CameraTestResult) => {
      setCamera(r);
      if (device && motion.current && tracker.current) {
        setCameraReport(
          evaluate({ device, motion: motion.current.snapshot(), interaction: tracker.current.snapshot(), camera: r.signals }, { source: "client" }),
        );
      }
    },
    [device],
  );

  const onContinueCamera = async () => {
    if (!device || !motion.current || !tracker.current) return;
    setStage("submitting");
    const bundle: SignalBundle = {
      device,
      motion: motion.current.snapshot(),
      interaction: tracker.current.snapshot(),
      camera: camera?.signals ?? null,
    };
    let serverError: string | null = session?.error ?? null;
    if (session?.token) {
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionToken: session.token, bundle }),
        });
        const j = (await res.json()) as { report?: Report; error?: string; issues?: string[] };
        if (res.ok && j.report) {
          setFinal({ report: j.report, bundle, serverError: null });
          setStage("report");
          return;
        }
        serverError = [j.error, ...(j.issues ?? [])].filter(Boolean).join("; ") || `HTTP ${res.status}`;
      } catch (e) {
        serverError = errorMessage(e);
      }
    }
    setFinal({ report: evaluate(bundle, { source: "client" }), bundle, serverError });
    setStage("report");
  };

  return (
    <main
      className={cx(
        "mx-auto w-full flex-1 px-4",
        "pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]",
        stage === "report" ? "max-w-3xl" : "max-w-lg",
      )}
    >
      <div className="mb-5 flex items-center gap-2 text-xs text-muted">
        <Lock className="size-3.5" aria-hidden />
        <span>Secure device verification</span>
        {session?.id && <span className="ml-auto font-mono">{session.id.slice(0, 14)}</span>}
      </div>

      {stage === "scan" && <ScanStep steps={steps} prelim={prelim} onContinue={onContinueDevice} />}

      {stage === "camera" &&
        (session ? (
          <CameraStep
            sequence={session.challenge}
            beforeStart={beforeCamera}
            result={camera}
            cameraReport={cameraReport}
            onFinished={onCameraFinished}
            onContinue={onContinueCamera}
          />
        ) : (
          <Card>
            <p className="flex items-center gap-2 text-sm text-ink-2">
              <LoaderCircle className="size-4 animate-spin" /> Preparing a secure session…
            </p>
          </Card>
        ))}

      {stage === "submitting" && (
        <Card>
          <div className="flex items-center gap-3">
            <LoaderCircle className="size-6 animate-spin text-accent" />
            <div>
              <h1 className="font-semibold">Building your report</h1>
              <p className="text-sm text-ink-2">Re-scoring every signal on the server and signing the verdict…</p>
            </div>
          </div>
        </Card>
      )}

      {stage === "report" && final && (
        <ReportView report={final.report} bundle={final.bundle} snapshot={camera?.snapshot ?? null} serverError={final.serverError} onRestart={() => window.location.reload()} />
      )}
    </main>
  );
}
