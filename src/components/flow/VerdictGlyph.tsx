import { Bot, MonitorSmartphone, Monitor, ServerCog, Smartphone, Tablet } from "lucide-react";
import type { DeviceClass } from "@/lib/detection/types";
import { cx } from "../ui";

const META: Record<DeviceClass, { Icon: typeof Smartphone; tone: string }> = {
  phone: { Icon: Smartphone, tone: "bg-good-wash text-good-ink" },
  tablet: { Icon: Tablet, tone: "bg-info-wash text-accent" },
  desktop: { Icon: Monitor, tone: "bg-surface-2 text-ink-2" },
  spoofed: { Icon: MonitorSmartphone, tone: "bg-bad-wash text-bad-ink" },
  emulator: { Icon: ServerCog, tone: "bg-bad-wash text-bad-ink" },
  automation: { Icon: Bot, tone: "bg-bad-wash text-bad-ink" },
};

export function VerdictGlyph({ deviceClass, size = "md" }: { deviceClass: DeviceClass; size?: "md" | "lg" }) {
  const { Icon, tone } = META[deviceClass];
  return (
    <div className={cx("flex shrink-0 items-center justify-center rounded-2xl", tone, size === "lg" ? "size-14" : "size-10")}>
      <Icon className={size === "lg" ? "size-7" : "size-5"} aria-hidden />
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
