"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { fetcher } from "@/lib/swr";
import { X } from "lucide-react";
import { canViewExitBadge } from "@/lib/access";

// Next.js 16 + Turbopack require any consumer of useSearchParams() to
// sit under a <Suspense> boundary, otherwise pages that try to
// statically prerender (including the auto-generated /_not-found and
// payroll/summary) abort with the missing-suspense-with-csr-bailout
// error. We isolate the searchParams read into a tiny inner component
// and wrap it in Suspense so the rest of the tree prerenders cleanly.
//
// The fallback returns null — the search-continuity behavior is a UX
// nice-to-have, not a hard requirement; rendering without it for the
// SSR pass is fine.

// Static jump list — common dashboard pages that should be reachable
// from search-as-you-type. Filtered by substring match on `label` so
// typing "att" surfaces Attendance, "leav" surfaces Leaves, etc.
const PAGE_LINKS: { label: string; href: string; hint?: string }[] = [
  { label: "Home",               href: "/dashboard/hr/home",            hint: "Dashboard"  },
  { label: "Attendance",         href: "/dashboard/hr/attendance",      hint: "Logs / clock-in" },
  { label: "Leaves",             href: "/dashboard/hr/leaves",          hint: "Apply / balances" },
  { label: "Approvals",          href: "/dashboard/hr/approvals",       hint: "Manager / HR" },
  { label: "People",             href: "/dashboard/hr/people",          hint: "Directory" },
  { label: "HR Dashboard",       href: "/dashboard/hr/admin",           hint: "Admin"      },
  { label: "Holidays",           href: "/dashboard/hr/admin/holidays",  hint: "Calendar"   },
  { label: "Inbox",              href: "/dashboard/hr/inbox",           hint: "Pending requests" },
  { label: "My Team",            href: "/dashboard/hr/my-team",                            },
  { label: "Goals",              href: "/dashboard/hr/goals",                              },
  { label: "Documents",          href: "/dashboard/hr/documents",                          },
  { label: "Tickets",            href: "/dashboard/hr/tickets",                            },
  { label: "Tools",              href: "/dashboard/tools",                                 },
];

// Global header search — multi-source, debounced, keyboard-friendly.
// Hits People (/api/hr/employees) and Cases (/api/cases) in parallel
// once the user has typed ≥ 2 chars, plus a static Pages jump list.
// Dropdown portals to body so overflow:hidden on the header can't clip it.
//
// Default export wraps the impl in <Suspense> — required because the
// inner component uses useSearchParams(), and Next.js 16 + Turbopack
// abort any static prerender that touches it without a suspense
// boundary upstream. The fallback is null (no header search shown
// during the brief SSR pass).
export default function HeaderSearch() {
  return (
    <Suspense fallback={null}>
      <HeaderSearchInner />
    </Suspense>
  );
}

function HeaderSearchInner() {
  const [query, setQuery]         = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen]           = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef  = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  // Bump tick on resize/scroll so the portalled panel re-reads anchor rect.
  const [, tick]  = useState(0);

  // Search continuity: when the viewer is already on a person profile
  // and switches to another person via search, carry their current
  // ?tab= over so the new profile opens to the same sub-page (Edit
  // Profile → Edit Profile, Assets → Assets, etc.). Outside the
  // people-profile route this stays empty so other searches behave
  // normally.
  const pathname    = usePathname() ?? "";
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const sessionUser = session?.user as any;
  const sessionUserId = sessionUser?.dbId;
  const tabQuery = useMemo(() => {
    if (!pathname.startsWith("/dashboard/hr/people/")) return "";
    const tab = searchParams?.get("tab");
    return tab ? `?tab=${encodeURIComponent(tab)}` : "";
  }, [pathname, searchParams]);

  // Debounce to 220ms so we don't hammer the APIs on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(t);
  }, [query]);

  // Cmd/Ctrl+K focuses the search bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const shouldFetch = open && debounced.length >= 2;

  // People search is open to everyone, but the employees API only returns
  // ACTIVE employees to non-HR — exited / offboarded people are never
  // surfaced to a normal user. HR additionally sees inactive employees,
  // flagged with an exit badge. See feedback_access_gate_drift.
  const { data: peopleData, error: peopleErr } = useSWR(
    shouldFetch ? `/api/hr/employees?search=${encodeURIComponent(debounced)}` : null,
    fetcher,
    { dedupingInterval: 500, keepPreviousData: true },
  );
  const { data: casesData, error: casesErr } = useSWR(
    shouldFetch ? `/api/cases?search=${encodeURIComponent(debounced)}&limit=6` : null,
    fetcher,
    { dedupingInterval: 500, keepPreviousData: true },
  );

  const people: any[] = Array.isArray(peopleData) ? peopleData.slice(0, 6) : [];
  const cases:  any[] = Array.isArray(casesData?.cases) ? casesData.cases
                       : Array.isArray(casesData) ? casesData : [];
  const pageMatches = useMemo(() => {
    if (debounced.length < 2) return [];
    const q = debounced.toLowerCase();
    return PAGE_LINKS.filter((p) =>
      p.label.toLowerCase().includes(q) || (p.hint && p.hint.toLowerCase().includes(q)),
    ).slice(0, 5);
  }, [debounced]);

  const totalResults = people.length + cases.length + pageMatches.length;
  const isLoading    = shouldFetch && !peopleData && !casesData;
  const hasError     = peopleErr || casesErr;

  useEffect(() => {
    if (!open) return;
    const bump = () => tick((n) => n + 1);
    window.addEventListener("resize", bump);
    window.addEventListener("scroll", bump, true);
    return () => {
      window.removeEventListener("resize", bump);
      window.removeEventListener("scroll", bump, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t))  return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const anchorRect = anchorRef.current?.getBoundingClientRect() ?? null;
  const showPanel  = open && debounced.length >= 1;

  const close = () => setOpen(false);
  const clear = () => { setQuery(""); setDebounced(""); };

  return (
    <div ref={anchorRef} className="relative">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search people, pages, cases…"
        className="w-52 md:w-64 lg:w-80 pl-9 pr-12 py-1.5 bg-[#e9eef4] border border-[#c8d2de] rounded-full text-[12px] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563eb]/15 focus:border-[#93c5fd] transition-all text-[#1f2f3f]"
      />
      {query ? (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-slate-400 hover:text-slate-700 flex items-center justify-center"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      ) : (
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden md:inline-flex items-center gap-0.5 rounded border border-slate-300/70 bg-white/60 px-1.5 py-0.5 text-[9.5px] font-medium text-slate-500 pointer-events-none">
          ⌘K
        </kbd>
      )}

      {showPanel && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top:   (anchorRect?.bottom ?? 0) + 6,
            left:  anchorRect?.left  ?? 0,
            width: Math.max(anchorRect?.width ?? 320, 360),
            zIndex: 9999,
          }}
          className="max-h-[480px] overflow-y-auto bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-xl shadow-2xl"
        >
          {debounced.length < 2 ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">Type at least 2 characters…</p>
          ) : isLoading ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">Searching…</p>
          ) : hasError && totalResults === 0 ? (
            <p className="px-3 py-3 text-[12px] text-rose-500">Search failed — try again.</p>
          ) : totalResults === 0 ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">No results for "{debounced}"</p>
          ) : (
            <>
              {/* People */}
              {people.length > 0 && (
                <Section label={`People · ${people.length}`}>
                  {people.map((u: any) => {
                    const initials = (u.name || "?").split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase();
                    const dept = u.employeeProfile?.department;
                    const desg = u.employeeProfile?.designation;
                    // Exit-lifecycle badge — "On Notice" (amber)
                    // while serving notice; "Exited" (slate) once
                    // HR finalises or the LWD has passed. Gated to
                    // HR team + developer + self only — see
                    // canViewExitBadge in src/lib/access.ts.
                    const exit = u.employeeExit;
                    const isSelfRow = sessionUserId != null && Number(sessionUserId) === u.id;
                    const canSeeBadge = canViewExitBadge(sessionUser, isSelfRow);
                    const exFinalised = exit && (exit.status === "exited" || exit.status === "offboarded");
                    const exLwdMs = exit?.lastWorkingDay ? new Date(exit.lastWorkingDay).getTime() : 0;
                    const exLwdPassed = exLwdMs > 0 && Date.now() > exLwdMs + 86400000;
                    const exitState: "on_notice" | "exited" | null =
                      !exit || !canSeeBadge
                        ? null
                        : (exFinalised || exLwdPassed) ? "exited" : "on_notice";
                    // Exited / deactivated people render with a muted
                    // avatar (grayscale photo / slate initials) so
                    // they're visually distinct from active employees
                    // at a glance, not just via the chip. Follows the
                    // same canViewExitBadge gating as the chip.
                    const isGone = exitState === "exited" || u.isActive === false;
                    return (
                      <Link
                        key={`p-${u.id}`}
                        href={`/dashboard/hr/people/${u.id}${tabQuery}`}
                        onClick={close}
                        className="flex items-center gap-2.5 px-3 py-2 border-b border-slate-100 dark:border-white/[0.04] last:border-b-0 hover:bg-[#008CFF]/[0.06] dark:hover:bg-[#008CFF]/[0.1] transition-colors"
                      >
                        <span className="relative shrink-0">
                          {u.profilePictureUrl ? (
                            <img src={u.profilePictureUrl} alt="" referrerPolicy="no-referrer" className={`h-7 w-7 rounded-full object-cover${isGone ? " grayscale opacity-55" : ""}`} />
                          ) : (
                            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white ${isGone ? "bg-slate-400 opacity-70" : "bg-[#008CFF]"}`}>{initials}</span>
                          )}
                          {/* Crossed-out overlay — marks the person as no
                              longer with the company, matching the muted
                              avatar treatment. */}
                          {isGone && (
                            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-900/25">
                              <X size={11} strokeWidth={3.5} className="text-white drop-shadow" />
                            </span>
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[12.5px] font-medium text-slate-800 dark:text-white truncate leading-snug">{u.name}</p>
                            {exitState === "on_notice" && (
                              <span
                                className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200 shrink-0"
                                title={exit?.lastWorkingDay ? `Last working day: ${String(exit.lastWorkingDay).slice(0, 10)}` : "On notice"}
                              >
                                <span className="inline-block h-1 w-1 rounded-full bg-amber-500" />
                                On Notice
                              </span>
                            )}
                            {exitState === "exited" && (
                              <span
                                className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-wider text-slate-700 ring-1 ring-inset ring-slate-300 shrink-0"
                                title={exit?.lastWorkingDay ? `Exited on ${String(exit.lastWorkingDay).slice(0, 10)}` : "Exited"}
                              >
                                <span className="inline-block h-1 w-1 rounded-full bg-slate-500" />
                                Exited
                              </span>
                            )}
                            {/* On Probation (blue) — within the probation window,
                                not yet confirmed, active, and not on notice/exited. */}
                            {exitState === null && u.isActive !== false && (() => {
                              const ep = u.employeeProfile;
                              if (!ep?.probationEndDate || ep.probationConfirmedAt) return null;
                              const endMs = new Date(`${String(ep.probationEndDate).slice(0, 10)}T00:00:00Z`).getTime();
                              if (!(endMs >= Date.now() - 86_400_000)) return null;
                              return (
                                <span
                                  className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-wider text-blue-700 ring-1 ring-inset ring-blue-200 shrink-0"
                                  title="On probation"
                                >
                                  <span className="inline-block h-1 w-1 rounded-full bg-blue-500" />
                                  On Probation
                                </span>
                              );
                            })()}
                            {/* On PIP (rose) — on a performance plan: started,
                                not ended (or open-ended), active, not exiting. */}
                            {exitState === null && u.isActive !== false && (() => {
                              const ep = u.employeeProfile as any;
                              if (!ep?.pipStartedAt) return null;
                              if (ep.pipEndDate) {
                                const endMs = new Date(`${String(ep.pipEndDate).slice(0, 10)}T00:00:00Z`).getTime();
                                if (!(endMs >= Date.now() - 86_400_000)) return null;
                              }
                              return (
                                <span
                                  className="inline-flex items-center gap-0.5 rounded-full bg-rose-50 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-wider text-rose-700 ring-1 ring-inset ring-rose-200 shrink-0"
                                  title="On Performance Improvement Plan"
                                >
                                  <span className="inline-block h-1 w-1 rounded-full bg-rose-500" />
                                  On PIP
                                </span>
                              );
                            })()}
                            {/* Fallback for anyone deactivated without an exit
                                record (or when the exit badge is hidden) so
                                inactive employees are clearly marked. */}
                            {exitState === null && u.isActive === false && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-wider text-slate-500 ring-1 ring-inset ring-slate-300 shrink-0">
                                <span className="inline-block h-1 w-1 rounded-full bg-slate-400" />
                                Inactive
                              </span>
                            )}
                          </div>
                          <p className="text-[10.5px] text-slate-500 truncate">
                            {desg ? `${desg}${dept ? ` · ${dept}` : ""}` : u.email}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </Section>
              )}

              {/* Pages */}
              {pageMatches.length > 0 && (
                <Section label={`Pages · ${pageMatches.length}`}>
                  {pageMatches.map((p) => (
                    <Link
                      key={`g-${p.href}`}
                      href={p.href}
                      onClick={close}
                      className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-100 dark:border-white/[0.04] last:border-b-0 hover:bg-[#008CFF]/[0.06] dark:hover:bg-[#008CFF]/[0.1] transition-colors"
                    >
                      <span className="text-[12.5px] font-medium text-slate-800 dark:text-white">{p.label}</span>
                      {p.hint && <span className="text-[10.5px] text-slate-400 truncate">{p.hint}</span>}
                    </Link>
                  ))}
                </Section>
              )}

              {/* Cases */}
              {cases.length > 0 && (
                <Section label={`Cases · ${cases.length}`}>
                  {cases.map((c: any) => {
                    const title  = c.title || c.name || "Untitled";
                    const status = c.status || c.statusType || "";
                    return (
                      <Link
                        key={`c-${c.id}`}
                        href={`/cases/${c.id}`}
                        onClick={close}
                        className="block px-3 py-2 border-b border-slate-100 dark:border-white/[0.04] last:border-b-0 hover:bg-[#008CFF]/[0.06] dark:hover:bg-[#008CFF]/[0.1] transition-colors"
                      >
                        <p className="text-[12.5px] font-medium text-slate-800 dark:text-white truncate leading-snug">{title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {c.clickupTaskId && (
                            <span className="text-[10px] font-mono text-slate-400">#{String(c.clickupTaskId).slice(0, 10)}</span>
                          )}
                          {status && (
                            <span className="text-[10px] uppercase tracking-wide font-semibold text-[#008CFF]">{status}</span>
                          )}
                          {c.channel && (
                            <span className="text-[10px] text-slate-500 truncate">{c.channel}</span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </Section>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-3 py-1.5 text-[10px] uppercase tracking-widest font-semibold text-slate-400 border-b border-slate-100 dark:border-white/[0.05] bg-slate-50/60 dark:bg-white/[0.02]">
        {label}
      </p>
      {children}
    </div>
  );
}
