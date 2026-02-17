/**
 * WEEK UTILITIES
 * ==============
 * Compute week start (Monday) in ISO YYYY-MM-DD format.
 * Uses Asia/Jerusalem timezone for consistency.
 */

const TIMEZONE = "Asia/Jerusalem";

function getDayOfWeekInTimezone(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  });
  const dayStr = formatter.format(date);
  // 0=Monday, 1=Tuesday, ..., 6=Sunday (per spec)
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

/**
 * Compute the Monday (week start) YYYY-MM-DD for the week containing the given date,
 * in the specified timezone.
 */
export function computeWeekStartISO(date: Date, timeZone: string = TIMEZONE): string {
  const parts = getDatePartsInTimezone(date, timeZone);
  const dayOfWeek = getDayOfWeekInTimezone(date, timeZone);
  // 0=Mon..6=Sun. Days to subtract to reach Monday = dayOfWeek.
  const daysToMonday = dayOfWeek;

  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  d.setUTCDate(d.getUTCDate() - daysToMonday);
  const mondayParts = getDatePartsInTimezone(d, timeZone);
  return `${mondayParts.year}-${String(mondayParts.month).padStart(2, "0")}-${String(mondayParts.day).padStart(2, "0")}`;
}

/**
 * Get the week start for "today" in the timezone.
 */
export function getCurrentWeekStartISO(timeZone: string = TIMEZONE): string {
  return computeWeekStartISO(new Date(), timeZone);
}

/**
 * Get the week start for next week (today + 7 days).
 */
export function getNextWeekStartISO(timeZone: string = TIMEZONE): string {
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  return computeWeekStartISO(nextWeek, timeZone);
}
