// Single-stage approval policy.
//
// The org standard is the NB Media two-stage flow for attendance + leave
// requests:
//   L1 (direct manager)  → partially_approved
//   L2 (HR / CEO / dev)  → approved  (this stage does the real work:
//                          seeds the Attendance row, credits comp-off,
//                          debits leave balance, etc.)
//
// YT Labs briefly collapsed this into ONE stage (2026-07-01 → 2026-07-21):
// the first authorised approver finalised outright and L2 was skipped.
// Per policy 2026-07-21, YT Labs is BACK on the same two-stage flow and
// L2 permissions as NB Media, so this helper now answers `false` for
// everyone. The call sites in the five approval routes (leave, comp-off,
// WFH, regularization, on-duty) are kept intact — restoring single-stage
// for a brand is a one-line change here.
//
// Note: the CEO fast-path is separate (each route checks the caller's CEO
// tier directly) and still collapses a CEO's L1 approve to final.
//
// Applies to: WFH / On-Duty, Regularization, Comp-off, and Leave.

export async function isSingleStageApprovalEmployee(
  _userId: number | null | undefined,
): Promise<boolean> {
  return false;
}
