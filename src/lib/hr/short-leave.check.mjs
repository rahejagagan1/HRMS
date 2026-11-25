// Self-check for the half + short leave combo rules (HR, 2026-11-25).
// Run: node src/lib/hr/short-leave.check.mjs   (Node 23.6+ strips the TS types)
//
// Guards the two money-adjacent rules: which bookings may share a date, and
// what status a half + short day settles to (payroll prices the status).
import assert from "node:assert/strict";
import { sameDayLeaveConflict, resolveShortLeaveDayStatus, shortLeaveDayState, halfLeaveDayVerdict, lwpChargedFor } from "./short-leave.ts";

const D = "2026-12-10";
const lv = (reason, from = D, to = D) => ({ fromDate: new Date(`${from}T00:00:00Z`), toDate: new Date(`${to}T00:00:00Z`), reason });
const FH = "[First Half] x", SH = "[Second Half] x", AM = "[Short Leave - Morning] x", PM = "[Short Leave - Evening] x";
const ok = (next, live, half = 270) => assert.equal(sameDayLeaveConflict(lv(next), live.map((r) => lv(r)), half), null, `${next} beside ${live}`);
const bad = (next, live, half = 270) => assert.ok(sameDayLeaveConflict(lv(next), live.map((r) => lv(r)), half), `${next} beside ${live} must clash`);

// ── Booking compatibility ──
ok(PM, [FH]); ok(FH, [PM]);            // new combo, either order
ok(AM, [SH]); ok(SH, [AM]);
ok(SH, [FH]); ok(PM, [AM]);            // existing pairs unchanged
bad(AM, [FH]); bad(FH, [AM]);          // same half → overlap
bad(PM, [SH]); bad(SH, [PM]);
bad(PM, ["full day x"]); bad(PM, ["[Half Day] x"]);   // full / sideless half
bad(PM, [PM]); bad(FH, [FH]);          // duplicates
bad(AM, [FH, PM]); bad(SH, [FH, PM]);  // a third booking that overlaps anywhere
assert.ok(sameDayLeaveConflict(lv(PM), [lv("trip", "2026-12-09", "2026-12-11")], 270), "multi-day leave blocks");
assert.match(sameDayLeaveConflict(lv(PM), [lv(FH)], 180), /working half/, "3h Saturday half too short for the combo");
ok(PM, [FH], null);                    // no shift → bar check skipped
// Combo is November-onward only (HR): October keeps the old block.
const on = (day, next, prev) => sameDayLeaveConflict(lv(next, day, day), [lv(prev, day, day)], 270);
assert.ok(on("2026-10-31", PM, FH), "Oct 31 half + short still blocked");
assert.ok(on("2026-10-31", SH, AM), "either order, still blocked");
assert.equal(on("2026-11-01", PM, FH), null, "Nov 1 combo allowed");
assert.equal(on("2026-10-31", SH, FH), null, "old pairs unaffected by the gate");
assert.equal(on("2026-10-31", PM, AM), null);
ok(PM, [AM], 180);                     // bar check only applies to half + short

// ── Day state ──
assert.equal(shortLeaveDayState([{ reason: FH, status: "pending" }, { reason: PM, status: "approved" }]).halfLeaveActive, true);
assert.equal(shortLeaveDayState([{ reason: FH, status: "rejected" }, { reason: PM, status: "approved" }]).halfLeaveActive, false);
assert.equal(shortLeaveDayState([{ reason: FH, status: "approved" }]).appliedAny, false, "a half alone is not a short-leave day");

// ── Status on a 9h day (bar 540, half 270) ──
const st = (worked, activeMin, rejectedMin, halfLeave, prevStatus = "present") =>
  resolveShortLeaveDayStatus({ worked, fullBar: 540, halfBar: 270, activeMin, rejectedMin, prevStatus, halfLeave });
// half + live short: working half 4.5h − 2h = 2.5h
assert.equal(st(150, 120, 0, true), "half_day", "2.5h done → paid half day");
assert.equal(st(149, 120, 0, true), "present", "short → untouched, auto-LOP prices it");
assert.equal(st(420, 120, 0, true), "half_day");
assert.equal(st(540, 120, 0, true), "present");
// half + rejected short: half completed is fine, the 2h band is ¼
assert.equal(st(270, 0, 120, true), "half_day");
assert.equal(st(150, 0, 120, true), "short_lop");
assert.equal(st(149, 0, 120, true), "present");
// plain short-leave day — unchanged behaviour
assert.equal(st(420, 120, 0, false), "present");
assert.equal(st(420, 120, 0, false, "late"), "late");
assert.equal(st(419, 120, 0, false), "half_day");
assert.equal(st(420, 0, 120, false), "short_lop");
assert.equal(st(100, 120, 0, false), "present");

// ── Auto-LOP verdict on a half-leave day (half bar 270) ──
const v = (worked, live, rejected) =>
  halfLeaveDayVerdict({ worked, halfBar: 270, liveSlMin: live, rejectedSlMin: rejected });
// 25 Nov example: First Half SL + Evening short leave, never came in → ¼ day
assert.equal(v(0, 120, 0), "short_lop", "no-show between the leaves costs ¼, not ½");
assert.equal(v(60, 120, 0), "short_lop", "partly worked gap (or missed clock-out) → still ¼, the cap");
assert.equal(v(150, 120, 0), "met");
assert.equal(v(60, 0, 120), "half_day_lop", "rejected short leave + half leave, short / missed punch → ½");
assert.equal(v(0, 0, 0), "half_day_lop", "plain half-day leave unchanged");
assert.equal(v(269, 0, 0), "half_day_lop");
assert.equal(v(270, 0, 0), "met");
assert.equal(v(0, 0, 120), "half_day_lop", "rejected short leave grants nothing");
assert.equal(v(150, 0, 120), "met", "rejected band left to clock-out's short_lop");

// ── LWP counter: what auto-LOP already charged for a row (re-pricing moves the difference) ──
const charged = (status, notes = null) => lwpChargedFor({ status, notes });
assert.equal(charged("lop"), 1);
assert.equal(charged("half_day_lop"), 0.5);
assert.equal(charged("short_lop", "Auto-marked quarter-day LOP: half-day leave + short leave"), 0.25);
assert.equal(charged("short_lop", "Short-leave settle: present → short_lop"), 0, "clock-out ¼ never charged the counter");
assert.equal(charged("missed_clock_out"), 0);
assert.equal(lwpChargedFor(undefined), 0, "no row yet");
// Vanshika 20 Nov: full LOP → half (+1 then −0.5) → ¼ (−0.25) ends at 0.25, not 1.75
assert.equal(1 + (0.5 - charged("lop")) + (0.25 - charged("half_day_lop")), 0.25);

console.log("short-leave combo checks passed");
