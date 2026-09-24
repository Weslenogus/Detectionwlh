import type { TimezoneSignals } from "../types";
import { attempt } from "../util/safe";

/**
 * UTC offset (same sign convention as Date#getTimezoneOffset) that the IANA
 * zone *should* have at `date`, computed purely from Intl. Timezone-spoofing
 * extensions usually patch either Intl or Date, rarely both consistently.
 */
export function intlOffsetMinutes(zone: string, date = new Date()): number | null {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    const truncated = Math.floor(date.getTime() / 1000) * 1000;
    return Math.round((truncated - asUtc) / 60000);
  } catch {
    return null;
  }
}

export function collectTimezone(): TimezoneSignals {
  const zone = attempt(() => Intl.DateTimeFormat().resolvedOptions().timeZone, "");
  const now = new Date();
  const intl = zone ? intlOffsetMinutes(zone, now) : null;
  const dateOffset = now.getTimezoneOffset();
  return {
    zone,
    intlOffset: intl,
    dateOffset,
    consistent: intl === null ? null : Math.abs(intl - dateOffset) < 1,
    numberLocale: attempt(() => new Intl.NumberFormat().resolvedOptions().locale, ""),
    dateLocale: attempt(() => Intl.DateTimeFormat().resolvedOptions().locale, ""),
  };
}
