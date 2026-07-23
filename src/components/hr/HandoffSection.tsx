"use client";

// Standardised "Handoff Details" section used by every leave-style
// request form (Leave / WFH / On Duty / Half Day / Comp Off). Implements
// the company's leave-application format:
//
//   • POC in Absence — single employee picker; selected user gets
//     auto-emailed as the named point of contact. Always required.
//   • Work Status — multi-line summary of current tasks. Always required.
//   • Time of Unavailability — free-text time-window(s) when the
//     employee will be away from their workstation. WFH-only; required
//     when shown so every WFH request makes availability explicit.
//
// Pure presentational + state-up component: parent owns the state, the
// section just renders the controls and emits `onChange` callbacks.
// Keeps the form file small and the validation logic in one place
// (parent's submit handler).

import EmployeePicker, { type PickerUser } from "@/components/hr/EmployeePicker";

export default function HandoffSection({
  poc, onPocChange,
  workStatus, onWorkStatusChange,
  unavailability, onUnavailabilityChange,
  /**
   * When true, render the "Time of Unavailability" field. WFH-only —
   * leave / on-duty / comp-off omit it (the employee isn't around to
   * be unavailable; the whole day is the "unavailable" window).
   */
  showUnavailability = false,
  /**
   * When true, render a "Mark POC as N/A" toggle above the picker.
   * Used by the HR-on-behalf modal: HR filing a leave for someone
   * else often doesn't know (or care) who's covering, so they can
   * tick N/A and submit without picking. The parent decides what
   * "N/A" means downstream (typically: send `pocUserId: null`).
   */
  allowNa = false,
  naSelected = false,
  onNaChange,
}: {
  poc: PickerUser[];
  onPocChange: (next: PickerUser[]) => void;
  workStatus: string;
  onWorkStatusChange: (v: string) => void;
  unavailability?: string;
  onUnavailabilityChange?: (v: string) => void;
  showUnavailability?: boolean;
  allowNa?: boolean;
  naSelected?: boolean;
  onNaChange?: (next: boolean) => void;
}) {
  return (
    <section className="pt-4 mt-2 border-t border-slate-200 dark:border-white/[0.06]">
      {/* Header line — mirrors the Section helper used by the
          rest of the Request Leave panel so visual rhythm stays
          consistent. Top border + padding give a clean visual
          break from the Reason textarea above. */}
      <h3 className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400 mb-3">
        Handoff Details
      </h3>

      <div className="space-y-4">
        {/* POC in Absence — single employee. The EmployeePicker is
            multi-select by default; the parent enforces "single" by
            slicing to [0] before reading and refusing to pass more
            than one user back. We mirror that constraint here by
            only ever invoking onPocChange with at-most-one entry.

            When `allowNa` is on, render a small N/A toggle: HR filing
            on behalf may not have a real cover assigned. Ticking N/A
            hides the picker; the parent submits with pocUserId=null. */}
        <div>
          <FieldLabel required={!naSelected}>POC in Absence</FieldLabel>
          {allowNa && (
            <label className="mb-2 flex items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={naSelected}
                onChange={(e) => {
                  const next = e.target.checked;
                  onNaChange?.(next);
                  if (next) onPocChange([]); // clear picker when switching to N/A
                }}
                className="w-3.5 h-3.5 accent-[#008CFF]"
              />
              Mark as N/A (no specific cover assigned)
            </label>
          )}
          {!naSelected && (
            <>
              <EmployeePicker
                selected={poc.slice(0, 1)}
                onChange={(next) => onPocChange(next.slice(-1))}
                placeholder="Search employee covering for you"
              />
              <FieldHint>
                They'll get an email so they know they're covering for you.
              </FieldHint>
            </>
          )}
        </div>

        {/* Work Status — multi-line textarea. 4 rows matches the doc's
            spec; placeholder nudges the employee toward bullet-point
            style ("• Task A — 80% done; • Task B — handed to X"). */}
        <div>
          <FieldLabel required>Work Status</FieldLabel>
          <textarea
            value={workStatus}
            onChange={(e) => onWorkStatusChange(e.target.value)}
            rows={4}
            required
            placeholder="Current status of your tasks + any pending work…"
            className="w-full px-3 py-2.5 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#008CFF] focus:ring-2 focus:ring-[#008CFF]/15 resize-none transition-colors"
          />
        </div>

        {/* Time of Unavailability — WFH-only. Required when shown
            (per the locked design): even "Available all day" is an
            acceptable answer, but the field can't be left blank.
            The parent enforces this in its submit handler. */}
        {showUnavailability && (
          <div>
            <FieldLabel required>Time of Unavailability</FieldLabel>
            <input
              type="text"
              value={unavailability ?? ""}
              onChange={(e) => onUnavailabilityChange?.(e.target.value)}
              required
              placeholder='e.g. "2-4 PM for school pickup" or "Available all day"'
              className="w-full h-10 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#008CFF] focus:ring-2 focus:ring-[#008CFF]/15 transition-colors"
            />
            <FieldHint>
              Mention any windows you'll be away from your workstation.
            </FieldHint>
          </div>
        )}
      </div>
    </section>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
      {children}
      {required ? <span className="text-rose-500 ml-1">*</span> : null}
    </label>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 text-[10.5px] text-slate-500 dark:text-slate-400">{children}</p>
  );
}
