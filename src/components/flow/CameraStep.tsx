"use client";

import { ArrowRight, Camera, RotateCcw, ScanFace } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { runCameraTest, type CameraPhase, type CameraTestResult } from "@/lib/detection/camera/capture";
import type { FlashColor, Report } from "@/lib/detection/types";
import { Button, Card, KV, pct, StatusPill } from "../ui";

const PHASE_TEXT: Record<CameraPhase, string> = {
  requesting: "Allow camera access",
  warming: "Hold still and look at the screen",
  capturing: "Scanning — keep looking at the screen",
  rear: "Checking the rear camera",
  analyzing: "Analysing frames",
  done: "Done",
  error: "Camera error",
};

interface Props {
  sequence: FlashColor[];
  /** Resolves once the iOS motion permission prompt (if any) is settled. */
  beforeStart: Promise<unknown> | null;
  result: CameraTestResult | null;
  cameraReport: Report | null;
  onFinished: (r: CameraTestResult) => void;
  onContinue: () => void;
}

export function CameraStep({ sequence, beforeStart, result, cameraReport, onFinished, onContinue }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  // The user already tapped Continue to get here, so the first run starts on mount.
  const [phase, setPhase] = useState<CameraPhase | "idle">(result ? "idle" : "requesting");
  const [facing, setFacing] = useState<"front" | "rear">("front");
  const [progress, setProgress] = useState(0);
  const [runId, setRunId] = useState(result ? 0 : 1);
  const busy = useRef(false);
  const running = phase !== "idle" && phase !== "done" && phase !== "error";

  const start = useCallback(() => {
    setProgress(0);
    setFacing("front");
    setPhase("requesting");
    setRunId((n) => n + 1);
  }, []);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // One camera session at a time (StrictMode re-runs effects; the camera is exclusive).
    if (!runId || busy.current) return;
    busy.current = true;
    (async () => {
      await beforeStart?.catch(() => undefined);
      const video = videoRef.current;
      if (!video || !mounted.current) {
        busy.current = false;
        return;
      }
      const r = await runCameraTest({
        video,
        sequence,
        setFlash: (c) => {
          if (flashRef.current) flashRef.current.style.backgroundColor = c ?? "";
        },
        onPhase: (p, d) => {
          if (!mounted.current) return;
          setPhase(p);
          if (d?.facing) setFacing(d.facing);
          if (typeof d?.progress === "number") setProgress(d.progress);
        },
      });
      busy.current = false;
      if (mounted.current) onFinished(r);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- exactly one run per runId
  }, [runId]);

  const cam = result?.signals;
  const front = cam?.front;
  const failed = cam && !front;

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-info-wash text-accent">
          <ScanFace className="size-6" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Step 2 of 2</p>
          <h1 className="text-xl font-semibold">Camera test</h1>
        </div>
      </header>

      {running && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-page" role="dialog" aria-label="Camera test in progress">
          <div ref={flashRef} className="absolute inset-0 transition-none" aria-hidden />
          <div className="relative flex flex-col items-center gap-6 px-6">
            <div className="relative size-64">
              <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100" aria-hidden>
                <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" />
                <circle
                  cx="50"
                  cy="50"
                  r="48"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={`${Math.PI * 96}`}
                  strokeDashoffset={`${Math.PI * 96 * (1 - (phase === "capturing" ? progress : phase === "analyzing" || phase === "rear" ? 1 : 0))}`}
                />
              </svg>
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                className="absolute inset-2 size-[calc(100%-1rem)] rounded-full bg-black object-cover"
                style={{ transform: facing === "front" ? "scaleX(-1)" : undefined }}
              />
            </div>
            <p className="rounded-full bg-black/70 px-4 py-2 text-center text-sm font-medium text-white" aria-live="polite">
              {PHASE_TEXT[phase]}
            </p>
          </div>
        </div>
      )}

      {!running && !result && (
        <Card>
          <p className="text-sm text-ink-2">Preparing camera…</p>
        </Card>
      )}

      {failed && (
        <Card>
          <div className="flex items-start gap-3">
            <Camera className="mt-0.5 size-5 text-bad-ink" />
            <div className="min-w-0">
              <h2 className="font-semibold">
                {cam.permission === "denied" ? "Camera access was blocked" : cam.permission === "no-device" ? "No camera found" : "The camera could not start"}
              </h2>
              <p className="mt-1 break-words text-sm text-ink-2">{cam.error ?? "Camera API unavailable in this browser."}</p>
              {cam.permission === "denied" && (
                <p className="mt-2 text-sm text-ink-2">Enable camera access for this site in your browser settings, then retry.</p>
              )}
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            <Button onClick={start}>
              <RotateCcw className="size-5" /> Retry camera test
            </Button>
            <Button variant="ghost" data-track="continue-camera" onClick={onContinue}>
              Continue without camera
            </Button>
          </div>
        </Card>
      )}

      {front && cameraReport && (
        <>
          <Card>
            <div className="flex gap-4">
              {result?.snapshot && (
                // eslint-disable-next-line @next/next/no-img-element -- local data: URL snapshot
                <img src={result.snapshot} alt="Frame captured before the flash sequence" className="size-24 shrink-0 rounded-xl object-cover" style={{ transform: "scaleX(-1)" }} />
              )}
              <div className="min-w-0">
                <p className="text-xs text-muted">Camera result</p>
                <h2 className="text-lg font-semibold leading-tight">{cameraReport.camera.headline}</h2>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <StatusPill status={cameraReport.camera.cameraClass === "physical" ? "pass" : "fail"}>
                    {pct(cameraReport.camera.confidence)} {cameraReport.camera.cameraClass}
                  </StatusPill>
                  {front.flash && (
                    <StatusPill status={front.flash.verdict === "responsive" ? "pass" : front.flash.verdict === "none" ? "warn" : "info"}>
                      liveness: {front.flash.verdict}
                    </StatusPill>
                  )}
                </div>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
              <KV k="Camera" v={front.label || "(no label)"} />
              <KV k="Resolution" v={`${front.videoWidth}×${front.videoHeight}`} mono />
              <KV k="Frames in 1 s" v={`${front.timing.frames} @ ${front.timing.fps ?? "?"} fps`} mono />
              <KV k="Sensor noise σ" v={front.aggregate?.temporalNoise?.toFixed(3) ?? "—"} mono />
              <KV k="Face" v={front.face?.available ? `${front.face.framesWithFace}/${front.face.framesAnalyzed} frames` : "model n/a"} />
              <KV k="Rear camera" v={cam.rear ? cam.rear.label || "present" : cam.rearError ? "not opened" : "—"} />
            </dl>
          </Card>
          <Button data-track="continue-camera" onClick={onContinue}>
            Continue to full report <ArrowRight className="size-5" />
          </Button>
        </>
      )}
    </div>
  );
}
