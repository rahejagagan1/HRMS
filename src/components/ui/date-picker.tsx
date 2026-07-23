"use client";
import { DateField } from "@/components/ui/date-field";

/**
 * Date picker that displays dd/mm/yyyy and opens the OS-native calendar.
 *
 * Was originally a three-dropdown Day/Month/Year picker, but HR asked
 * for a real calendar UI app-wide. The 3-dropdown shape was a workaround
 * for clunky US-format mm/dd/yyyy display on `<input type="date">` —
 * DateField solves that with a custom display layer over an invisible
 * native picker, so we just delegate.
 *
 * The original API is preserved so the existing 7 callers don't change:
 *   value / onChange     — YYYY-MM-DD storage format.
 *   yearStart / yearEnd  — clamp the picker via min/max ISO dates.
 *   futureYears          — convenience: extends yearEnd to currentYear + N.
 *   className            — passed through to the wrapper.
 *
 * For new code, prefer importing `DateField` directly.
 */
export function DatePicker({
  value,
  onChange,
  yearStart = 1900,
  yearEnd,
  futureYears,
  className,
  /**
   * Hard floor on which date the picker will accept (YYYY-MM-DD).
   * Overrides the `yearStart`-derived January-1 default. Use this to
   * block past dates on leave/WFH forms (today onwards). When undefined
   * the picker keeps its century-wide range.
   */
  minDate,
}: {
  value: string;
  onChange: (v: string) => void;
  yearStart?: number;
  yearEnd?: number;
  futureYears?: number;
  className?: string;
  minDate?: string;
}) {
  const today = new Date();
  const thisYear = today.getFullYear();
  const effectiveEnd =
    yearEnd ?? (futureYears != null ? thisYear + futureYears : thisYear);
  const min = minDate ?? `${yearStart}-01-01`;
  const max = `${effectiveEnd}-12-31`;
  return <DateField value={value} onChange={onChange} min={min} max={max} className={className} />;
}
