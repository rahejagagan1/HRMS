// Self-check for the manager team email's routing: a wrong answer here shows
// one team's attendance and leave to another manager.
// Run: node src/lib/hr/team-attendance.check.mjs
import assert from "node:assert/strict";
import { buildTeamDigests } from "./team-attendance.ts";

const p = (userId, managerId, detail = "Full day") => ({ userId, managerId, detail });
const none = { noClockIn: [], late: [], onLeave: [], wfh: [] };
const ids = (rows) => rows.map((r) => r.userId);
const anyone = () => true;

// A → B. C, D, E → G. Each manager gets one email, about their own team only.
const A = 1, B = 2, C = 3, D = 4, E = 5, G = 7;
let out = buildTeamDigests({ ...none, noClockIn: [p(A, B), p(C, G)], late: [p(D, G)], onLeave: [p(E, G)] }, anyone);
assert.deepEqual([...out.keys()].sort(), [B, G]);
assert.deepEqual(ids(out.get(B).notClockedIn), [A]);
assert.deepEqual([out.get(B).late, out.get(B).onLeave, out.get(B).wfh], [[], [], []]);
assert.deepEqual(ids(out.get(G).notClockedIn), [C]);
assert.deepEqual(ids(out.get(G).late), [D]);
assert.deepEqual(ids(out.get(G).onLeave), [E]);

// Nothing to report → no email.
assert.equal(buildTeamDigests(none, anyone).size, 0);

// Leave or WFH alone is enough for an email.
assert.equal(buildTeamDigests({ ...none, onLeave: [p(A, B)] }, anyone).size, 1);
assert.equal(buildTeamDigests({ ...none, wfh: [p(A, B)] }, anyone).size, 1);

// Applied WFH → never "Not clocked in", only a note on the WFH row.
out = buildTeamDigests({ ...none, noClockIn: [p(A, B)], wfh: [p(A, B)] }, anyone);
assert.deepEqual(out.get(B).notClockedIn, []);
assert.equal(out.get(B).wfh[0].detail, "Full day, not clocked in yet");

// No manager, self-managed, or a manager who can't receive → no email.
assert.equal(buildTeamDigests({ ...none, late: [p(A, null), p(G, G)] }, anyone).size, 0);
assert.equal(buildTeamDigests({ ...none, late: [p(A, B)] }, (id) => id !== B).size, 0);

console.log("team-attendance.check: ok");
