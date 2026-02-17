/**
 * WEEK UTILITIES (Convex)
 * =======================
 * Compute week start (Monday) in ISO YYYY-MM-DD format.
 * Uses Asia/Jerusalem timezone to match the frontend (app/lib/weekUtils.ts).
 */

const TIMEZONE = "Asia/Jerusalem";

function getDayOfWeekInTimezone(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  });
  const dayStr = formatter.format(date);
  const weekDays: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return weekDays[dayStr] ?? 0;
}

function getDatePartsInTimezone(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const str = formatter.format(date);
  const [y, m, d] = str.split("-").map(Number);
  return { year: y, month: m, day: d };
}

export function getCurrentWeekStartISO(timeZone: string = TIMEZONE): string {
  const date = new Date();
  const parts = getDatePartsInTimezone(date, timeZone);
  const dayOfWeek = getDayOfWeekInTimezone(date, timeZone);
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  d.setUTCDate(d.getUTCDate() - dayOfWeek);
  const mondayParts = getDatePartsInTimezone(d, timeZone);
  return `${mondayParts.year}-${String(mondayParts.month).padStart(2, "0")}-${String(mondayParts.day).padStart(2, "0")}`;
}

export function getNextWeekStartISO(timeZone: string = TIMEZONE): string {
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const parts = getDatePartsInTimezone(nextWeek, timeZone);
  const dayOfWeek = getDayOfWeekInTimezone(nextWeek, timeZone);
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  d.setUTCDate(d.getUTCDate() - dayOfWeek);
  const mondayParts = getDatePartsInTimezone(d, timeZone);
  return `${mondayParts.year}-${String(mondayParts.month).padStart(2, "0")}-${String(mondayParts.day).padStart(2, "0")}`;
}

export function getCurrentDayOfWeek(timeZone: string = TIMEZONE): number {
  return getDayOfWeekInTimezone(new Date(), timeZone);
}
