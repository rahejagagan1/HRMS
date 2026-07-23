import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { istTodayDateOnly } from "@/lib/ist-date";

export const dynamic = "force-dynamic";

// Tiny helpers
const mmdd   = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const pretty = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

// GET /api/hr/events — derives Birthdays / Anniversaries / New Joinees from
// EmployeeProfile (dateOfBirth, joiningDate). Scoped to active users.
export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const today    = istTodayDateOnly();              // UTC-midnight on IST "today"
    const todayKey = mmdd(today);
    const thisYear = today.getUTCFullYear();
    // Window for "upcoming": next 10 calendar days (inclusive of today).
    const WINDOW_DAYS = 10;

    // Current week (Mon → Sun) for anniversaries.
    const dayOfWeek = (today.getUTCDay() + 6) % 7;    // 0 = Mon
    const weekStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - dayOfWeek));
    const weekEnd   = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + 6));

    // Current calendar month (new joinees).
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const monthEnd   = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));

    const profiles = await prisma.employeeProfile.findMany({
      where: { user: { isActive: true } },
      select: {
        dateOfBirth: true,
        joiningDate: true,
        designation: true,
        department:  true,
        user: { select: { id: true, name: true, profilePictureUrl: true } },
      },
    });

    // ── Birthdays (today + upcoming WINDOW) ───────────────────────────────
    type Event = { userId: number; name: string; profilePictureUrl: string | null; designation: string | null; dateLabel: string; daysAway: number };
    const birthdaysToday:     Event[] = [];
    const birthdaysUpcoming:  Event[] = [];
    for (const p of profiles) {
      if (!p.dateOfBirth || !p.user) continue;
      const b = new Date(p.dateOfBirth);
      // Next occurrence in the rolling window
      let next = new Date(Date.UTC(thisYear, b.getUTCMonth(), b.getUTCDate()));
      if (next < today) next = new Date(Date.UTC(thisYear + 1, b.getUTCMonth(), b.getUTCDate()));
      const diffDays = Math.round((next.getTime() - today.getTime()) / 86_400_000);
      const row: Event = {
        userId: p.user.id,
        name: p.user.name,
        profilePictureUrl: p.user.profilePictureUrl,
        designation: p.designation,
        dateLabel: pretty(next),
        daysAway: diffDays,
      };
      if (mmdd(b) === todayKey)                          birthdaysToday.push(row);
      else if (diffDays > 0 && diffDays <= WINDOW_DAYS)  birthdaysUpcoming.push(row);
    }
    birthdaysUpcoming.sort((a, b) => a.daysAway - b.daysAway);

    // ── Work anniversaries (this week) ─────────────────────────────────────
    const anniversariesThisWeek: (Event & { years: number })[] = [];
    for (const p of profiles) {
      if (!p.joiningDate || !p.user) continue;
      const j = new Date(p.joiningDate);
      const anniv = new Date(Date.UTC(thisYear, j.getUTCMonth(), j.getUTCDate()));
      if (anniv >= weekStart && anniv <= weekEnd) {
        const years = thisYear - j.getUTCFullYear();
        if (years < 1) continue; // skip this-year joiners — they're "new joinees" not "anniversaries"
        anniversariesThisWeek.push({
          userId: p.user.id,
          name: p.user.name,
          profilePictureUrl: p.user.profilePictureUrl,
          designation: p.designation,
          dateLabel: pretty(anniv),
          daysAway: Math.round((anniv.getTime() - today.getTime()) / 86_400_000),
          years,
        });
      }
    }
    anniversariesThisWeek.sort((a, b) => a.daysAway - b.daysAway);

    // ── New joinees (joined this calendar month) ───────────────────────────
    const newJoineesThisMonth: (Event & { joinedOn: string })[] = [];
    for (const p of profiles) {
      if (!p.joiningDate || !p.user) continue;
      const j = new Date(p.joiningDate);
      if (j >= monthStart && j <= monthEnd) {
        newJoineesThisMonth.push({
          userId: p.user.id,
          name: p.user.name,
          profilePictureUrl: p.user.profilePictureUrl,
          designation: p.designation,
          dateLabel: pretty(j),
          daysAway: Math.round((today.getTime() - j.getTime()) / 86_400_000),
          joinedOn: j.toISOString().slice(0, 10),
        });
      }
    }
    newJoineesThisMonth.sort((a, b) => (a.joinedOn < b.joinedOn ? -1 : 1));

    return NextResponse.json({
      birthdays: {
        today:    birthdaysToday,
        upcoming: birthdaysUpcoming,
        count:    birthdaysToday.length + birthdaysUpcoming.length,
      },
      anniversaries: {
        thisWeek: anniversariesThisWeek,
        count:    anniversariesThisWeek.length,
      },
      newJoinees: {
        thisMonth: newJoineesThisMonth,
        count:     newJoineesThisMonth.length,
      },
    });
  } catch (e) { return serverError(e, "GET /api/hr/events"); }
}
