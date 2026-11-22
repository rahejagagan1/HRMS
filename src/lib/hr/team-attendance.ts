// Who gets told about whom in the manager team-attendance email (2026-11-22).
// Pure, no imports, so team-attendance.check.mjs can run it with plain node.
//
//   • A manager only ever sees their DIRECT reports.
//   • One email per manager, and none when the team has nothing to report.
//   • Someone who applied WFH is never under "Not clocked in": they show under
//     WFH, with a note when they haven't clocked in yet.

type Person = { userId: number; managerId: number | null };

export type TeamDigest<A, L, O, W> = { notClockedIn: A[]; late: L[]; onLeave: O[]; wfh: W[] };

export function buildTeamDigests<
  A extends Person,
  L extends Person,
  O extends Person,
  W extends Person & { detail: string },
>(
  rows: { noClockIn: A[]; late: L[]; onLeave: O[]; wfh: W[] },
  canReceive: (managerId: number) => boolean,
): Map<number, TeamDigest<A, L, O, W>> {
  const out = new Map<number, TeamDigest<A, L, O, W>>();
  const teamOf = (p: Person): TeamDigest<A, L, O, W> | null => {
    const id = p.managerId;
    if (id === null || id === p.userId || !canReceive(id)) return null;
    if (!out.has(id)) out.set(id, { notClockedIn: [], late: [], onLeave: [], wfh: [] });
    return out.get(id)!;
  };

  const noClockInIds = new Set(rows.noClockIn.map((r) => r.userId));
  const wfhIds       = new Set(rows.wfh.map((r) => r.userId));

  for (const r of rows.noClockIn) if (!wfhIds.has(r.userId)) teamOf(r)?.notClockedIn.push(r);
  for (const r of rows.late)    teamOf(r)?.late.push(r);
  for (const r of rows.onLeave) teamOf(r)?.onLeave.push(r);
  for (const r of rows.wfh) {
    teamOf(r)?.wfh.push(noClockInIds.has(r.userId) ? { ...r, detail: `${r.detail}, not clocked in yet` } : r);
  }
  return out;
}
