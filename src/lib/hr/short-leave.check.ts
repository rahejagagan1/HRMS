// Self-check for unpaidLeaveDayWeight — the LWP pricing every payroll path uses.
// Run: npx tsx src/lib/hr/short-leave.check.ts
import assert from "node:assert/strict";
import { unpaidLeaveDayWeight, isHalfDayLeave, isShortLeaveType } from "./short-leave";

const d = new Date("2026-10-16T00:00:00Z");
const lv = (reason: string, totalDays: number, toDate = d) => ({ fromDate: d, toDate, reason, totalDays });

assert.equal(unpaidLeaveDayWeight(lv("[Short Leave - Evening] errands", 0.25)), 0.25); // the Oct 2026 bug
assert.equal(unpaidLeaveDayWeight(lv("[Short Leave - Morning] x", 0.25)), 0.25);
assert.equal(unpaidLeaveDayWeight(lv("[First Half] sick", 0.5)), 0.5);
assert.equal(unpaidLeaveDayWeight(lv("[Second Half] sick", 0.5)), 0.5);
assert.equal(unpaidLeaveDayWeight(lv("[Half Day] sick", 0.5)), 0.5);
assert.equal(unpaidLeaveDayWeight(lv("fever", 1)), 1);
assert.equal(unpaidLeaveDayWeight(lv("[First Half] x", 3, new Date("2026-10-18T00:00:00Z"))), 1); // multi-day isn't a half
assert.equal(isHalfDayLeave(lv("[Short Leave - Evening] x", 0.25)), false); // short ≠ half (excuse sets)
// Short leave may only draw from CL / SL / LWP.
for (const c of ["CL", "SL", "LWP", "cl"]) assert.equal(isShortLeaveType(c), true, c);
for (const c of ["COMP", "CO", "FL", "SPL", "", null]) assert.equal(isShortLeaveType(c), false, String(c));
console.log("short-leave.check: ok");
