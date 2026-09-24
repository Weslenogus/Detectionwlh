import { DesktopIcon, DeviceMobileIcon, DeviceTabletIcon, DevicesIcon, RobotIcon, VirtualRealityIcon, type Icon } from "@phosphor-icons/react";
import type { DeviceClass } from "@/lib/detection/types";
import { cx } from "../ui";

const META: Record<DeviceClass, { Icon: Icon; tone: string }> = {
  phone: { Icon: DeviceMobileIcon, tone: "bg-good-wash text-good-ink" },
  tablet: { Icon: DeviceTabletIcon, tone: "bg-info-wash text-accent" },
  desktop: { Icon: DesktopIcon, tone: "bg-surface-2 text-ink-2" },
  spoofed: { Icon: DevicesIcon, tone: "bg-bad-wash text-bad-ink" },
  emulator: { Icon: VirtualRealityIcon, tone: "bg-bad-wash text-bad-ink" },
  automation: { Icon: RobotIcon, tone: "bg-bad-wash text-bad-ink" },
};

export function VerdictGlyph({ deviceClass, size = "md" }: { deviceClass: DeviceClass; size?: "md" | "lg" }) {
  const { Icon: I, tone } = META[deviceClass];
  return (
    <div className={cx("flex shrink-0 items-center justify-center rounded-2xl", tone, size === "lg" ? "size-14" : "size-10")}>
      <I weight="duotone" className={size === "lg" ? "size-8" : "size-6"} aria-hidden />
    </div>
  );
}

export const CLASS_LABEL: Record<DeviceClass, string> = {
  phone: "Physical phone",
  tablet: "Physical tablet",
  desktop: "Desktop / laptop",
  spoofed: "Desktop spoofing mobile",
  emulator: "Emulator / VM",
  automation: "Automation / headless",
};
