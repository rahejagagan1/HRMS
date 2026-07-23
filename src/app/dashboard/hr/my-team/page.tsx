"use client";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Clock, TreePine, Target, Calendar } from "lucide-react";
import { getUserRoleLabel } from "@/lib/user-role-options";

const C = {
  card:    "bg-white dark:bg-[#101c2e] border border-[#e2e8f0] dark:border-[rgba(255,255,255,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.07)] dark:shadow-none rounded-2xl",
  t1:      "text-[#1e293b] dark:text-[#e2e8f0]",
  t2:      "text-[#475569] dark:text-[#8892a4]",
  t3:      "text-[#94a3b8] dark:text-[#64748b]",
  divider: "border-[#e2e8f0] dark:border-[rgba(255,255,255,0.06)]",
};

const TOP_TABS = [
  { key: "myteam",  label: "MY TEAM", href: "/dashboard/hr/my-team"    },
];

type Period = "today" | "week" | "month";

function statusColor(s: string) {
  if (s === "present") return "bg-emerald-500";
  if (s === "late")    return "bg-amber-500";
  if (s === "on_leave")return "bg-violet-500";
  return "bg-slate-300 dark:bg-slate-600";
}
function statusLabel(s: string) {
  if (s === "present")  return "Present";
  if (s === "late")     return "Late";
  if (s === "on_leave") return "On Leave";
  if (s === "absent")   return "Absent";
  return "—";
}
function goalColor(s: string) {
  if (s === "on_track") return "text-emerald-500";
  if (s === "at_risk")  return "text-amber-500";
  if (s === "behind")   return "text-red-500";
  return "text-slate-400";
}

function fmtTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}
function fmtMins(min: number | null | undefined) {
  if (!min) return "—";
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}
function fmtDay(d: Date | string) {
  return new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
}
function dateKey(d: Date | string) {
  return new Date(d).toISOString().slice(0, 10);
}

/** Build the list of YYYY-MM-DD strings between from..to inclusive (UTC). */
function dayKeysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(from);
  const end = new Date(to);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export default function MyTeamPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const [period, setPeriod] = useState<Period>("today");

  const { data, isLoading } = useSWR(`/api/hr/my-team?period=${period}`, fetcher);
  const members      = data?.members      ?? [];
  const onLeaveToday = data?.onLeaveToday ?? [];
  const range        = data?.range        ?? null;
  const scope        = data?.scope        ?? "solo";

  const dayKeys = useMemo(
    () => (range ? dayKeysInRange(range.from, range.to) : []),
    [range],
  );

  return (
    <div className="min-h-screen bg-[#f1f5f9] dark:bg-[#0b1220]">
      {/* Top tabs */}
      <div className="flex items-center gap-0 bg-white dark:bg-[#0d1b2e] border-b border-[#e2e8f0] dark:border-[rgba(255,255,255,0.06)] px-6">
        {TOP_TABS.map(t => (
          <Link key={t.key} href={t.href}
            className={`px-5 py-3 text-[11px] font-bold tracking-wider transition-colors border-b-2 ${
              t.key === "myteam"
                ? "border-[#008CFF] text-[#008CFF]"
                : `border-transparent ${C.t2} hover:${C.t1}`
            }`}>
            {t.label}
          </Link>
        ))}
      </div>

      <div className="px-6 py-5">
        {/* Header + period tabs */}
        <div className="mb-5 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className={`text-[17px] font-semibold ${C.t1} tracking-tight`}>My Team</h1>
            <p className={`text-[12px] ${C.t3} mt-0.5`}>
              {members.length} {scope === "manager" ? "direct report" : "teammate"}{members.length !== 1 ? "s" : ""}
              {scope === "peer" && <span className="text-[11px]"> · including your reporting manager</span>}
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-[#e2e8f0] dark:border-[rgba(255,255,255,0.06)] bg-white dark:bg-[#101c2e] p-1">
            {(["today","week","month"] as Period[]).map((p) => (
              <button key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-[11.5px] font-semibold rounded-md transition-colors ${
                  period === p
                    ? "bg-[#008CFF] text-white"
                    : `${C.t2} hover:${C.t1}`
                }`}>
                {p === "today" ? "Today" : p === "week" ? "This Week" : "This Month"}
              </button>
            ))}
          </div>
        </div>

        {/* On Leave Today summary */}
        {onLeaveToday.length > 0 && (
          <div className={`${C.card} p-4 mb-5`}>
            <div className="flex items-center gap-2 mb-3">
              <Calendar className="w-4 h-4 text-violet-500"/>
              <p className={`text-[12.5px] font-semibold ${C.t1}`}>On leave today · {onLeaveToday.length}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {onLeaveToday.map((l: any) => (
                <div key={l.id} className="inline-flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 text-[11.5px]">
                  {l.profilePictureUrl ? (
                    <img src={l.profilePictureUrl} alt={l.name} referrerPolicy="no-referrer" className="w-5 h-5 rounded-full object-cover" />
                  ) : (
                    <span className="w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center text-[9px] font-bold">
                      {l.name?.split(" ").map((p: string) => p[0]).join("").slice(0,2).toUpperCase() || "?"}
                    </span>
                  )}
                  <span className="font-medium">{l.name}</span>
                  <span className="opacity-70">·</span>
                  <span>{l.leaveType ?? "Leave"}</span>
                  {l.status === "pending" && (
                    <span className="ml-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-400">Pending</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin"/>
          </div>
        ) : members.length === 0 ? (
          <div className={`${C.card} p-10 text-center`}>
            <p className={`text-[14px] ${C.t2}`}>No teammates found.</p>
            <p className={`text-[12px] ${C.t3} mt-1`}>You don&apos;t report to anyone (or you have no direct reports yet).</p>
          </div>
        ) : (
          <div className="space-y-4">
            {members.map((m: any) => (
              <MemberCard key={m.id} m={m} period={period} dayKeys={dayKeys} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MemberCard({ m, period, dayKeys }: { m: any; period: Period; dayKeys: string[] }) {
  const attByDate = useMemo(() => {
    const map = new Map<string, any>();
    for (const a of m.attendances || []) map.set(dateKey(a.date), a);
    return map;
  }, [m.attendances]);

  // Today's row drives the badge for "Today" view; for week/month we
  // aggregate stats so the header shows something meaningful at a glance.
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayAtt = attByDate.get(todayKey);
  const attStatus = todayAtt?.status || "absent";
  const pendingLeaves = m.leaveApplications?.length || 0;

  // Aggregate stats for week / month view header.
  const totalMins = (m.attendances || []).reduce((s: number, a: any) => s + (a.totalMinutes || 0), 0);
  const presentDays = (m.attendances || []).filter((a: any) => a.clockIn).length;

  return (
    <div className={`${C.card} p-5`}>
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="relative shrink-0">
          {m.profilePictureUrl ? (
            <img src={m.profilePictureUrl} alt={m.name} referrerPolicy="no-referrer"
              className="w-12 h-12 rounded-full object-cover ring-2 ring-white dark:ring-[#101c2e]"/>
          ) : (
            <div className="w-12 h-12 rounded-full bg-[#008CFF]/20 flex items-center justify-center text-[#008CFF] font-bold text-[15px] ring-2 ring-white dark:ring-[#101c2e]">
              {m.name.split(" ").map((p: string) => p[0]).join("").slice(0,2).toUpperCase()}
            </div>
          )}
          {period === "today" && (
            <span className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full ring-2 ring-white dark:ring-[#101c2e] ${statusColor(attStatus)}`}/>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className={`text-[14px] font-semibold ${C.t1}`}>{m.name}</p>
              <p className={`text-[12px] ${C.t3} mt-0.5`}>
                {m.employeeProfile?.designation || getUserRoleLabel(m.role) || "—"}
                {m.employeeProfile?.department ? ` · ${m.employeeProfile.department}` : ""}
              </p>
            </div>
            {period === "today" ? (
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                attStatus === "present"  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
                attStatus === "late"     ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"      :
                attStatus === "on_leave" ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"   :
                "bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400"
              }`}>
                {statusLabel(attStatus)}
              </span>
            ) : (
              <div className="text-right shrink-0">
                <p className={`text-[11px] font-medium ${C.t1}`}>{presentDays}d present · {fmtMins(totalMins)}</p>
                <p className={`text-[10px] ${C.t3}`}>{period === "week" ? "this week" : "this month"}</p>
              </div>
            )}
          </div>

          {period === "today" ? (
            <TodayBlock todayAtt={todayAtt} m={m} pendingLeaves={pendingLeaves} />
          ) : (
            <RangeBlock dayKeys={dayKeys} attByDate={attByDate} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Today view: existing 3-column block (attendance / pending leaves / goals). */
function TodayBlock({ todayAtt, m, pendingLeaves }: { todayAtt: any; m: any; pendingLeaves: number }) {
  return (
    <div className={`grid grid-cols-3 gap-4 mt-4 pt-4 border-t ${C.divider}`}>
      <div>
        <p className={`text-[10px] font-semibold uppercase tracking-wider ${C.t3} mb-2 flex items-center gap-1`}>
          <Clock className="w-3 h-3"/> Today
        </p>
        {todayAtt?.clockIn ? (
          <div className="space-y-0.5">
            <p className={`text-[12px] ${C.t2}`}>In: <span className={`font-medium ${C.t1}`}>{fmtTime(todayAtt.clockIn)}</span></p>
            {todayAtt.clockOut && (
              <p className={`text-[12px] ${C.t2}`}>Out: <span className={`font-medium ${C.t1}`}>{fmtTime(todayAtt.clockOut)}</span></p>
            )}
            <p className={`text-[11px] ${C.t3}`}>{fmtMins(todayAtt.totalMinutes)}</p>
          </div>
        ) : (
          <p className={`text-[12px] ${C.t3}`}>Not checked in</p>
        )}
      </div>

      <div>
        <p className={`text-[10px] font-semibold uppercase tracking-wider ${C.t3} mb-2 flex items-center gap-1`}>
          <TreePine className="w-3 h-3"/> Pending Leaves
        </p>
        {pendingLeaves > 0 ? (
          <div className="space-y-1">
            {m.leaveApplications.slice(0,2).map((l: any) => (
              <p key={l.id} className={`text-[11px] ${C.t2}`}>
                {l.leaveType?.name} · {parseFloat(l.totalDays).toFixed(1)} d
              </p>
            ))}
            {pendingLeaves > 2 && <p className={`text-[11px] ${C.t3}`}>+{pendingLeaves-2} more</p>}
          </div>
        ) : (
          <p className={`text-[12px] ${C.t3}`}>None pending</p>
        )}
      </div>

      <div>
        <p className={`text-[10px] font-semibold uppercase tracking-wider ${C.t3} mb-2 flex items-center gap-1`}>
          <Target className="w-3 h-3"/> Goals
        </p>
        {m.goals?.length > 0 ? (
          <div className="space-y-1">
            {m.goals.slice(0,2).map((g: any) => (
              <div key={g.id} className="flex items-center gap-1.5">
                <div className="flex-1 h-1.5 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-[#008CFF] rounded-full transition-all" style={{ width: `${g.progress}%` }}/>
                </div>
                <span className={`text-[10px] font-medium ${goalColor(g.status)} shrink-0`}>{g.progress}%</span>
              </div>
            ))}
          </div>
        ) : (
          <p className={`text-[12px] ${C.t3}`}>No active goals</p>
        )}
      </div>
    </div>
  );
}

/** Week / Month view: per-day clock-in / clock-out grid. */
function RangeBlock({ dayKeys, attByDate }: { dayKeys: string[]; attByDate: Map<string, any> }) {
  return (
    <div className={`mt-4 pt-4 border-t ${C.divider}`}>
      <div className="grid grid-cols-[110px_70px_70px_70px_1fr] gap-y-1 text-[11.5px]">
        <div className={`${C.t3} font-semibold uppercase tracking-wider`}>Day</div>
        <div className={`${C.t3} font-semibold uppercase tracking-wider`}>In</div>
        <div className={`${C.t3} font-semibold uppercase tracking-wider`}>Out</div>
        <div className={`${C.t3} font-semibold uppercase tracking-wider`}>Hours</div>
        <div className={`${C.t3} font-semibold uppercase tracking-wider`}>Status</div>

        {dayKeys.map((k) => {
          const a = attByDate.get(k);
          const isWeekend = (() => { const d = new Date(k).getUTCDay(); return d === 0 || d === 6; })();
          const status = a?.status || (isWeekend ? "off" : "absent");
          return (
            <div key={k} className="contents">
              <div className={`py-1 ${isWeekend ? C.t3 : C.t2}`}>{fmtDay(k)}</div>
              <div className={`py-1 ${C.t1} font-medium`}>{a?.clockIn ? fmtTime(a.clockIn) : "—"}</div>
              <div className={`py-1 ${C.t1} font-medium`}>{a?.clockOut ? fmtTime(a.clockOut) : "—"}</div>
              <div className={`py-1 ${C.t2}`}>{fmtMins(a?.totalMinutes)}</div>
              <div className="py-1">
                {status === "off" ? (
                  <span className={`text-[10.5px] ${C.t3}`}>Weekend</span>
                ) : (
                  <span className={`text-[10.5px] font-medium px-1.5 py-0.5 rounded ${
                    status === "present"  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
                    status === "late"     ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" :
                    status === "on_leave" ? "bg-violet-500/10 text-violet-600 dark:text-violet-400" :
                    "bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400"
                  }`}>
                    {statusLabel(status)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
