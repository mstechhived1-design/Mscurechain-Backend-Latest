const MONTH_NAMES_SHORT = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";

/**
 * Checks whether a value is a date-only string with no explicit time component
 * (e.g., "25 Nov 2026", "2026-11-25", "25-11-2026", "25/11/2026").
 */
export const isDateOnlyString = (val: unknown): boolean => {
  if (typeof val !== "string") return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  if (/\d{1,2}:\d{2}/.test(trimmed)) return false;
  return (
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(trimmed) ||
    /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(trimmed) ||
    new RegExp(`^\\d{1,2}[\\s-]+(?:${MONTH_NAMES_SHORT})[a-z]*[\\s,-]+\\d{2,4}$`, "i").test(trimmed)
  );
};

/**
 * Checks whether a Date object sits at exact midnight (00:00:00) in UTC or Asia/Kolkata.
 * Midnight timestamps typically indicate a flattened date-only value rather than an actual transaction time.
 */
export const isMidnightTimestamp = (d: Date): boolean => {
  if (isNaN(d.getTime())) return false;
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) {
    return true;
  }
  const istParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = Number(istParts.find((p) => p.type === "hour")?.value ?? -1);
  const m = Number(istParts.find((p) => p.type === "minute")?.value ?? -1);
  const s = Number(istParts.find((p) => p.type === "second")?.value ?? -1);
  return (h === 0 || h === 24) && m === 0 && s === 0;
};

const getCalendarKey = (d: Date, timeZone?: string): string => {
  if (!timeZone) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
};

const isSameCalendarDay = (a: Date, b: Date): boolean => {
  const aIst = getCalendarKey(a, "Asia/Kolkata");
  const bIst = getCalendarKey(b, "Asia/Kolkata");
  if (aIst === bIst) return true;
  // Also match UTC date key because new Date("23 Nov 2026") on UTC servers stores 00:00 UTC of the 23rd
  return getCalendarKey(a) === bIst || aIst === getCalendarKey(b) || getCalendarKey(a) === getCalendarKey(b);
};

/**
 * Resolves the real transaction timestamp, recovering the true time from createdAt
 * whenever `dateVal` is a date-only string or was flattened to midnight (00:00:00).
 */
export const resolveActualTimestamp = (dateVal: unknown, createdAtVal?: unknown): Date | null => {
  const parsedCreated = createdAtVal ? new Date(createdAtVal as any) : null;
  const hasValidCreated = Boolean(parsedCreated && !isNaN(parsedCreated.getTime()));

  if (!dateVal) {
    return hasValidCreated ? parsedCreated : null;
  }

  const parsedDate = new Date(dateVal as any);
  if (isNaN(parsedDate.getTime())) {
    return hasValidCreated ? parsedCreated : null;
  }

  const dateLacksTime = isDateOnlyString(dateVal) || isMidnightTimestamp(parsedDate);
  if (dateLacksTime && hasValidCreated && parsedCreated && !isMidnightTimestamp(parsedCreated)) {
    if (isSameCalendarDay(parsedDate, parsedCreated)) {
      return parsedCreated;
    }
  }

  return parsedDate;
};

export const isDateOnlyOrMidnight = (val: unknown): boolean => {
  if (!val) return true;
  if (isDateOnlyString(val)) return true;
  const d = new Date(val as any);
  if (isNaN(d.getTime())) return true;
  return isMidnightTimestamp(d);
};
