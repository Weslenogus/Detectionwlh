"use client";

import { ArrowFatLeftIcon, ArrowFatRightIcon, CheckIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import type { PoseDir } from "@/lib/detection/camera/liveness3d";
import type { PoseProgress } from "@/lib/detection/camera/pose-challenge";
import { cx } from "../ui";

/** Instruction line for the head-turn challenge. */
export function poseText(p: PoseProgress | null): string {
  if (!p) return "Get ready to turn your head";
  if (!p.face) return "Centre your face in the circle";
  if (!p.target) return "Great — hold on";
  if (!p.armed) return "Look straight at the screen first";
  const first = p.achieved.length === 0;
  return `${first ? "Slowly turn your head" : "Now turn"} to the ${p.target}`;
}

/** Overall challenge completion 0‥1 (drives the ring around the preview). */
export function poseCompletion(challenge: PoseDir[], p: PoseProgress | null): number {
  if (!p || !challenge.length) return 0;
  return Math.min(1, (p.achieved.length + (p.target ? p.progress : 0)) / challenge.length);
}

/**
 * Direction chips on either side of the camera circle. The preview is mirrored,
 * so the user's left is the screen's left.
 */
export function PoseArrows({ challenge, progress }: { challenge: PoseDir[]; progress: PoseProgress | null }) {
  const reduce = useReducedMotion();
  const chip = (dir: PoseDir) => {
    const done = progress?.achieved.includes(dir) ?? false;
    const active = !done && progress?.target === dir;
    const Arrow = dir === "left" ? ArrowFatLeftIcon : ArrowFatRightIcon;
    const nudge = dir === "left" ? -8 : 8;
    return (
      <motion.div
        key={dir}
        className={cx(
          "absolute top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-full shadow-lg transition-colors duration-300",
          dir === "left" ? "-left-5" : "-right-5",
          done ? "bg-good text-white" : active ? "bg-accent text-accent-ink" : "bg-black/50 text-white/60",
        )}
        animate={active && !reduce ? { x: [0, nudge, 0] } : { x: 0 }}
        transition={active ? { duration: 0.9, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
        aria-hidden
      >
        {done ? <CheckIcon weight="bold" className="size-6" /> : <Arrow weight="duotone" className="size-7" />}
      </motion.div>
    );
  };
  return (
    <>
      {chip("left")}
      {chip("right")}
      <span className="sr-only">
        {challenge.map((d) => `${d}${progress?.achieved.includes(d) ? " done" : ""}`).join(", ")}
      </span>
    </>
  );
}
