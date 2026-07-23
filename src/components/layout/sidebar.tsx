"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState, useEffect, useRef, useCallback, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { canViewFeedbackInbox } from "@/lib/feedback-inbox-access";
import { canUseFeedback, isAdmin as isAdminFn, isHRAdmin as isHRAdminFn, canSeeReports as canSeeReportsFn, canViewAllBrands } from "@/lib/access";
import { can } from "@/lib/permissions/can";
import { canUseMissingFields } from "@/lib/missing-fields/access";

import { userCanAccessYoutubeDashboard } from "@/lib/youtube-dashboard-access";
import { Users, BarChart2, BarChart3, User, MessageCircle, Settings, Home, Building2, LayoutDashboard, FileText, Star, PlayCircle, CircleDollarSign, Wrench, Target, Package, Box, ClipboardList } from "lucide-react";

// Consistent Keka-style icon: thin outline, fixed size / stroke.
const icon = (Cmp: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>) => (
    <Cmp size={18} strokeWidth={1.5} />
);
import useSWR from "swr";
import { fetcher } from "@/lib/swr";

interface Manager {
    id: number;
    name: string;
    orgLevel: string;
}

const NAV_ITEMS = [
    { label: "Dashboard", href: "/dashboard",         icon: icon(LayoutDashboard),                             developerOnly: true          },
    { label: "Cases",     href: "/cases",              icon: icon(FileText),       adminOnly: true                                           },
    { label: "Company",   href: "/dashboard/company",  icon: icon(Building2),      adminOnly: true                                           },
    { label: "Scores",    href: "/dashboard/scores",   icon: icon(Star),                                        managersOnly: true           },
    { label: "YouTube",   href: "/dashboard/youtube",  icon: icon(PlayCircle),     youtubeDashboardAccess: true                              },
    { label: "Feedback",  href: "/dashboard/feedback", icon: icon(MessageCircle)                                                             },
    { label: "Tools",     href: "/dashboard/tools",    icon: icon(Wrench)                                                                    },
    { label: "Missing Fields", href: "/dashboard/missing-fields", icon: icon(ClipboardList),                              missingFieldsAccess: true },
    { label: "Admin",     href: "/admin",              icon: icon(Settings),       adminOnly: true                                           },
];

export default function Sidebar() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const currentTab = searchParams?.get("tab") || null;
    const router   = useRouter();
    const { data: session } = useSession();
    const user = session?.user as any;

    // `special_access` and `role === "admin"` both qualify as admin —
    // per the auth.ts session callback comment "Full visibility but NOT
    // CEO". Include both so they see Cases / Company / Admin / HR
    // Dashboard / Reports / Scores like ceo + developers do.
    // Permission-aware (designation-driven) via the shared helpers — they
    // dual-read can() when the session carries permissions, else legacy.
    const isAdmin = isAdminFn(user);
    const isHRAdmin = isHRAdminFn(user);
    // CEO-only items stay restricted to the actual CEO + developers — `Dashboard`
    // is the org-wide CEO console, not appropriate for special_access.
    const isCeo = user?.orgLevel === "ceo" || user?.isDeveloper === true;
    // YT Labs CEO (Kunal) is brand-scoped — they see ONLY the 9
    // sections HR carved out for the YT Labs sub-dashboard:
    //   Home · Me · My Finances · Tools · KPIs · Violation Log ·
    //   HR Dashboard · My Team · People
    // Everything else (Dashboard / Cases / Company / Scores / YouTube /
    // Admin / Reports / Feedback) is hidden even though they pass the
    // broader CEO checks above. NB Media CEO + developers keep full
    // visibility. (Feedback is now brand-gated separately via
    // canUseFeedback — hidden for ALL YT Labs users, not just the CEO.)
    const isYtLabsCeo = user?.orgLevel === "ceo" && user?.businessUnit === "YT Labs";
    // Permission-aware (designation-driven) via the shared helpers — they
    // dual-read can() when the session carries permissions, else fall back
    // to the legacy role logic (admin / manager / hod / hr_manager etc.).
    const canSeeReports = canSeeReportsFn(user);
    const canSeeViolationLog = can(user, "VIEW_VIOLATIONS");
    // Assets tile — visible to EVERYONE. The page now actually
    // implements the scoping the original comment promised:
    //   • MANAGE_ASSETS (IT Security / HR / CEO / devs)
    //     → full register with admin actions.
    //   • Everyone else → read-only "My Assets" view of just the
    //     items currently assigned to them (sourced from
    //     /api/hr/people/<self>'s `assets` field).
    // No more "You don't have access" dead-end for employees.
    const showAssetsTab = true;
    const showFeedbackSubmenu = canViewFeedbackInbox(user);

    // Tab-permission overrides — the caller's personal map from
    // UserTabPermission, with protected roles getting `true` everywhere.
    // Missing keys default to `true` so a brand-new install (before any
    // permissions are written) doesn't break the sidebar.
    const { data: perms } = useSWR<{ permissions: Record<string, boolean> }>(
        "/api/hr/me/tab-permissions",
        fetcher,
        { revalidateOnFocus: false, dedupingInterval: 30_000 }
    );
    const tabAllowed = (key: string) => (perms?.permissions?.[key] ?? true);

    // YT Labs CEO allowlist for the global NAV_ITEMS strip — only
    // Tools survives. Everything else (Dashboard, Cases, Company,
    // Scores, YouTube, Admin) is hidden regardless of role. Feedback
    // is brand-gated via canUseFeedback below (hidden for ALL YT Labs
    // users, including this CEO).
    const YT_CEO_NAV_ALLOWED = new Set(["Tools"]);

    const visibleItems = NAV_ITEMS.filter((item) => {
        const label = (item as any).label as string;
        // YT Labs CEO is locked to a HR-carved allowlist. Apply the
        // brand restriction before any other rule so a role bypass
        // (isCeo / isAdmin) can't accidentally re-grant access.
        if (isYtLabsCeo && !YT_CEO_NAV_ALLOWED.has(label)) return false;
        // Brand-wide: Feedback is hidden for ALL YT Labs users (not just the
        // CEO). NB Media users + role bypasses unaffected. This brand gate is
        // orthogonal to the permission migration below and always applies.
        if (label === "Feedback" && !canUseFeedback(user)) return false;
        // Menu items are otherwise gated purely by designation permissions
        // now — the old per-user tabAllowed/keyMap catalog layer is replaced
        // by the can()-backed helper flags below (ceoOnly / managersOnly /
        // adminOnly / developerOnly). YouTube keeps its extra brand +
        // VIEW_YOUTUBE_DASHBOARD gate. Items with NO flag (Tools) stay visible.
        if ((item as any).youtubeDashboardAccess && !userCanAccessYoutubeDashboard(user)) return false;
        if ((item as any).ceoOnly && !isCeo) return false;
        if ((item as any).managersOnly && !canSeeReports) return false;
        if ((item as any).adminOnly && !isAdmin) return false;
        if ((item as any).developerOnly && user?.isDeveloper !== true) return false;
        // Missing Fields: developers + allowlisted designations (Executive Assistant).
        if ((item as any).missingFieldsAccess && !canUseMissingFields(user)) return false;
        return true;
    });

    // Report submenu state
    const [reportHovered, setReportHovered] = useState(false);
    const [managers, setManagers] = useState<Manager[]>([]);
    const [managersLoaded, setManagersLoaded] = useState(false);
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // HR sideways flyout state — portalled to body so overflow-y:auto can't clip them
    const isHRPath = pathname.startsWith("/dashboard/hr");
    const [hrMeOpen,    setHrMeOpen]    = useState(false);
    const [hrTeamOpen,  setHrTeamOpen]  = useState(false);
    const [hrAdminOpen, setHrAdminOpen] = useState(false);
    const [hrMeY,    setHrMeY]    = useState(0);
    const [hrTeamY,  setHrTeamY]  = useState(0);
    const [hrAdminY, setHrAdminY] = useState(0);
    const hrMeTrigger    = useRef<HTMLDivElement>(null);
    const hrTeamTrigger  = useRef<HTMLDivElement>(null);
    const hrAdminTrigger = useRef<HTMLDivElement>(null);
    const hrMeTimer    = useRef<NodeJS.Timeout | null>(null);
    const hrTeamTimer  = useRef<NodeJS.Timeout | null>(null);
    const hrAdminTimer = useRef<NodeJS.Timeout | null>(null);

    const makeHrHandlers = (
        setOpen: (v: boolean) => void,
        setY: (y: number) => void,
        triggerRef: MutableRefObject<HTMLDivElement | null>,
        timerRef: MutableRefObject<NodeJS.Timeout | null>
    ) => ({
        onMouseEnter: () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            if (triggerRef.current) setY(triggerRef.current.getBoundingClientRect().top);
            setOpen(true);
        },
        onMouseLeave: () => { timerRef.current = setTimeout(() => setOpen(false), 200); },
    });

    // Inbox badge count
    const { data: inboxData } = useSWR("/api/hr/inbox", fetcher, { refreshInterval: 60000, revalidateOnFocus: false });

    // Probation-review badge — the caller's reports whose probation is ending
    // and still need their feedback/recommendation.
    const { data: probationData } = useSWR<{ count: number }>("/api/hr/probation-reviews/count", fetcher, { refreshInterval: 60000 });
    const probationCount = (probationData?.count || 0) as number;
    const { data: pipData } = useSWR<{ count: number }>("/api/hr/pip-reviews/count", fetcher, { refreshInterval: 60000 });
    const pipCount = (pipData?.count || 0) as number;

    // Approvals badge count — total pending across all types (leave / regularize /
    // wfh / on-duty / comp-off). Only fetched for users who can actually approve.
    const { data: approvalsSummary } = useSWR<{ byTab: Record<string, number>; total: number }>(
        isHRAdmin ? "/api/hr/approvals/summary" : null,
        fetcher,
        { refreshInterval: 60000, revalidateOnFocus: false }
    );
    const approvalsCount = approvalsSummary?.total ?? 0;

    // My Finances — top-level pinned tile with its own flyout (Summary / My Pay / Manage Tax)
    const [financesOpen, setFinancesOpen] = useState(false);
    const [financesY, setFinancesY] = useState(0);
    const financesTrigger = useRef<HTMLDivElement>(null);
    const financesTimer   = useRef<NodeJS.Timeout | null>(null);

    // Nested sub-flyout for "My Pay" — reveals My Salary / Pay Slips / Income Tax
    // to the right of the main My Finances flyout.
    const [myPaySubOpen, setMyPaySubOpen] = useState(false);
    const [myPaySubY, setMyPaySubY] = useState(0);
    const myPayRowRef = useRef<HTMLDivElement>(null);
    const myPaySubTimer = useRef<NodeJS.Timeout | null>(null);

    // Dept submenu state (portalled, like the HR flyouts)
    const [deptHovered, setDeptHovered] = useState(false);
    const [deptY, setDeptY] = useState(0);
    const deptTriggerRef = useRef<HTMLDivElement | null>(null);
    const deptHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Feedback submenu (CEO / Developer / HR) — also portalled
    const [feedbackHovered, setFeedbackHovered] = useState(false);
    const [feedbackY, setFeedbackY] = useState(0);
    const feedbackTriggerRef = useRef<HTMLDivElement | null>(null);
    const feedbackHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Report submenu Y-pos for portal
    const [reportY, setReportY] = useState(0);
    const reportTriggerRef = useRef<HTMLDivElement | null>(null);

    // Close every sidebar flyout / hover menu whenever the route
    // changes. Without this, clicking a link inside a flyout (e.g.
    // "Attendance" inside the Me / My Space menu) would navigate but
    // leave the menu hanging open over the new page. One useEffect
    // covers ALL flyouts uniformly — Me, My Team, Finances, MyPay
    // sub-flyout, Dept hover, Feedback hover, Report hover — so we
    // don't have to add an onClick handler to every Link.
    useEffect(() => {
      setHrMeOpen(false);
      setHrTeamOpen(false);
      setHrAdminOpen(false);
      setFinancesOpen(false);
      setMyPaySubOpen(false);
      setDeptHovered(false);
      setFeedbackHovered(false);
      setReportHovered(false);
    }, [pathname]);

    // Helper: pick a flyout Y based on where the trigger sits in the viewport.
    //   Trigger in top third    → anchor top-of-flyout to top-of-trigger (drops down)
    //   Trigger in middle third → vertically centre flyout with trigger
    //   Trigger in bottom third → anchor bottom-of-flyout to bottom-of-trigger (grows up)
    // Then clamp into the viewport with a 16px safety margin.
    // We pick the position ONCE on hover-open and never again, so the cursor
    // never gets pulled away from the option the user is aiming at.
    const computeFlyoutY = useCallback((trigger: HTMLDivElement | null, estimatedHeight: number) => {
        if (!trigger || typeof window === "undefined") return 16;
        const rect = trigger.getBoundingClientRect();
        const vh = window.innerHeight;
        const margin = 16;
        const h = Math.min(estimatedHeight, vh - margin * 2);
        const triggerCenter = (rect.top + rect.bottom) / 2;
        let y: number;
        if (triggerCenter < vh / 3) {
            y = rect.top;                      // top — drop down from trigger
        } else if (triggerCenter > (vh * 2) / 3) {
            y = rect.bottom - h;               // bottom — grow up from trigger
        } else {
            y = triggerCenter - h / 2;         // middle — centre on trigger
        }
        return Math.max(margin, Math.min(y, vh - h - margin));
    }, []);

    // Mirrors the canonical list in src/lib/departments.ts. The flyout
    // that rendered these entries was retired when KPIs got simplified
    // to a single page — kept here for `estHeight` math + so any future
    // reactivation picks up the latest taxonomy without drift.
    const DEPARTMENTS = [
        { label: "HR Dept.",                         slug: "hr" },
        { label: "Managers Dept.",                   slug: "managers" },
        { label: "Researchers Dept.",                slug: "researchers" },
        { label: "Research Manager Dept.",           slug: "research-manager" },
        { label: "Writers Dept.",                    slug: "writers" },
        { label: "Editors Dept.",                    slug: "editors" },
        { label: "Content Strategist Dept.",            slug: "content-strategist" },
        { label: "Content Operations Executive Dept.",  slug: "content-operations-executive" },
        { label: "Video QA Dept.",                   slug: "video-qa" },
        { label: "Script QA Dept.",                  slug: "script-qa" },
        { label: "QA Manager Dept.",                 slug: "qa-manager" },
        { label: "Design Dept.",                     slug: "design" },
        { label: "AI Team Dept.",                    slug: "ai-team" },
        { label: "Social Media Dept.",               slug: "social-media" },
        { label: "Social Media Manager Dept.",       slug: "social-media-manager" },
        { label: "IT Dept.",                         slug: "it" },
    ];

    const handleDeptMouseEnter = () => {
        if (deptHoverTimeoutRef.current) clearTimeout(deptHoverTimeoutRef.current);
        // Skip Y recomputation when the menu is already open — otherwise the
        // panel jumps under the cursor as the user moves from trigger to flyout.
        if (!deptHovered) {
            const estHeight = 30 + DEPARTMENTS.length * 36 + 16;
            setDeptY(computeFlyoutY(deptTriggerRef.current, estHeight));
        }
        setDeptHovered(true);
    };

    const handleDeptMouseLeave = () => {
        deptHoverTimeoutRef.current = setTimeout(() => {
            setDeptHovered(false);
        }, 200);
    };

    useEffect(() => {
        if (reportHovered && !managersLoaded) {
            fetch("/api/managers")
                .then((res) => res.json())
                .then((data) => {
                    if (Array.isArray(data)) {
                        // Non-admin users only see their own report link
                        if (!isAdmin) {
                            setManagers(data.filter((m: Manager) => String(m.id) === String(user?.dbId)));
                        } else {
                            setManagers(data);
                        }
                    }
                    setManagersLoaded(true);
                })
                .catch(() => setManagersLoaded(true));
        }
    }, [reportHovered, managersLoaded]);

    const handleReportMouseEnter = () => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        // Only compute Y the first time the menu opens. While the menu is
        // already open and the user moves their cursor onto the flyout
        // panel, this same handler fires from the panel's onMouseEnter — we
        // must NOT recompute Y there or the menu jumps under the cursor.
        if (!reportHovered) {
            const rowCount = managersLoaded ? Math.max(managers.length, 1) : 8;
            const estHeight = 30 + rowCount * 36 + 16;
            setReportY(computeFlyoutY(reportTriggerRef.current, estHeight));
        }
        setReportHovered(true);
    };

    const handleReportMouseLeave = () => {
        hoverTimeoutRef.current = setTimeout(() => {
            setReportHovered(false);
        }, 200);
    };

    const handleFeedbackMouseEnter = () => {
        if (feedbackHoverTimeoutRef.current) clearTimeout(feedbackHoverTimeoutRef.current);
        if (feedbackTriggerRef.current) setFeedbackY(feedbackTriggerRef.current.getBoundingClientRect().top);
        setFeedbackHovered(true);
    };

    const handleFeedbackMouseLeave = () => {
        feedbackHoverTimeoutRef.current = setTimeout(() => {
            setFeedbackHovered(false);
        }, 200);
    };

    const isReportActive = pathname.startsWith("/dashboard/reports");
    const isFeedbackFormActive = pathname === "/dashboard/feedback";
    const isFeedbackInboxActive =
        pathname === "/dashboard/feedback_inbox" || pathname.startsWith("/dashboard/feedback_inbox/");
    const isFeedbackNavActive = isFeedbackFormActive || isFeedbackInboxActive;

    // Find the index where Report should be inserted (before Admin)
    const adminIndex = visibleItems.findIndex((item) => item.label === "Admin");
    const beforeAdmin = adminIndex >= 0 ? visibleItems.slice(0, adminIndex) : visibleItems;
    const afterAdmin = adminIndex >= 0 ? visibleItems.slice(adminIndex) : [];

    return (
        <>
        <aside className="fixed left-0 top-0 z-40 flex h-screen w-[92px] flex-col border-r border-[#dbe4ee] bg-[#f7f9fc] shadow-[6px_0_24px_rgba(15,23,42,0.05)]">
            {/* Logo */}
            <div className="border-b border-[#e4ebf2] px-2 py-3">
                <div className="flex flex-col items-center gap-2 text-center">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-md">
                        <Image
                            src="/logo.png"
                            alt="NB"
                            width={36}
                            height={36}
                            priority
                            className="object-contain"
                            sizes="36px"
                        />
                    </div>
                    <div>
                        <h1 className="text-[11px] font-bold leading-none text-[#243445]">NB Media</h1>
                        <p className="mt-1 text-[9px] leading-none text-[#7f91a4]">Dashboard</p>
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 space-y-1 overflow-y-auto p-2.5 scrollbar-thin">
                <p className="hidden text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-2 px-1 text-center">
                    Main Menu
                </p>

                {/* HR Home + Me — pinned to the top of the sidebar so they're always one click away. */}
                {(() => {
                    const meHandlers = makeHrHandlers(setHrMeOpen, setHrMeY, hrMeTrigger, hrMeTimer);
                    const isMeActive = isHRPath
                        && !pathname.startsWith("/dashboard/hr/my-team")
                        && !pathname.startsWith("/dashboard/hr/inbox")
                        && !pathname.startsWith("/dashboard/hr/people")
                        && !pathname.startsWith("/dashboard/hr/org")
                        && !pathname.startsWith("/dashboard/hr/engage")
                        && !pathname.startsWith("/dashboard/hr/home")
                        && !pathname.startsWith("/dashboard/hr/admin")
                        && !pathname.startsWith("/dashboard/hr/assets")
                        // Hiring / Onboard / Offboard live under the
                        // Dashboard rail's admin grouping — exclude
                        // here so the pinned "Me" tile at the top of
                        // the rail doesn't light up when HR is in any
                        // of those admin flows. (The sibling
                        // `isMeActive` at the bottom of this file
                        // already excludes this; both need to stay
                        // in sync.)
                        && !pathname.startsWith("/dashboard/hr/hiring")
                        && !pathname.startsWith("/dashboard/hr/onboard")
                        && !pathname.startsWith("/dashboard/hr/offboard")
                        && pathname !== "/admin";
                    const homeActive = pathname === "/dashboard/hr/home" || pathname.startsWith("/dashboard/hr/home/");
                    const E = "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]";
                    const A = "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]";
                    return (
                        <>
                            {tabAllowed("hr_home") && (
                                <Link href="/dashboard/hr/home"
                                    className={cn("flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]", homeActive ? A : E)}>
                                    <Home size={15} strokeWidth={1.75} className={homeActive ? "text-[#0f6ecd]" : ""} />
                                    Home
                                </Link>
                            )}
                            {tabAllowed("hr_me") && (
                                <div ref={hrMeTrigger} {...meHandlers}
                                    onDoubleClick={() => { setHrMeOpen(false); router.push("/dashboard/hr/attendance"); }}
                                    className={cn("flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer select-none", isMeActive || hrMeOpen ? A : E)}>
                                    <User size={15} strokeWidth={1.75} className={isMeActive || hrMeOpen ? "text-[#0f6ecd]" : ""} />
                                    Me
                                </div>
                            )}
                            {/* My Finances — pinned tile with a Summary / My Pay / Manage Tax flyout */}
                            {(() => {
                                const financesHandlers = makeHrHandlers(setFinancesOpen, setFinancesY, financesTrigger, financesTimer);
                                const financesActive = pathname.startsWith("/dashboard/hr/payroll");
                                return (
                                    <div ref={financesTrigger} {...financesHandlers}
                                        onClick={() => { setFinancesOpen(false); router.push("/dashboard/hr/payroll/summary"); }}
                                        className={cn("flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer select-none", financesActive || financesOpen ? A : E)}>
                                        <CircleDollarSign size={15} strokeWidth={1.75} className={financesActive || financesOpen ? "text-[#0f6ecd]" : ""} />
                                        My Finances
                                    </div>
                                );
                            })()}
                        </>
                    );
                })()}

                {/* Items before Admin */}
                {beforeAdmin.map((item) => {
                    if (item.label === "Feedback" && showFeedbackSubmenu) {
                        return (
                            <div
                                key={item.href}
                                ref={feedbackTriggerRef}
                                className="relative"
                                onMouseEnter={handleFeedbackMouseEnter}
                                onMouseLeave={handleFeedbackMouseLeave}
                            >
                                <div
                                    className={cn(
                                        "flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer",
                                        isFeedbackNavActive
                                            ? "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]"
                                            : "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]"
                                    )}
                                >
                                    <span className="flex flex-col items-center gap-1">
                                        <span className={cn(isFeedbackNavActive ? "text-[#0f6ecd]" : "")}>
                                            {item.icon}
                                        </span>
                                        Feedback
                                    </span>
                                    <svg
                                        className={cn(
                                            "hidden",
                                            feedbackHovered ? "rotate-90" : ""
                                        )}
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </div>

                                {feedbackHovered && typeof document !== "undefined" && createPortal(
                                    <div
                                        style={{ position: "fixed", left: 108, top: feedbackY, zIndex: 9999 }}
                                        className="w-56 rounded-xl border border-[#cfd8e3] bg-[#eef2f6] py-2 shadow-xl shadow-slate-300/30 animate-in fade-in slide-in-from-left-2 duration-200"
                                        onMouseEnter={handleFeedbackMouseEnter}
                                        onMouseLeave={handleFeedbackMouseLeave}
                                    >
                                        <Link
                                            href="/dashboard/feedback"
                                            className={cn(
                                                "flex items-center justify-between px-4 py-2 text-sm transition-all duration-150",
                                                isFeedbackFormActive
                                                    ? "bg-[#eef4fb] font-medium text-[#1f3b57]"
                                                    : "text-[#34495e] hover:bg-[#dde4ec] hover:text-[#1f3b57]"
                                            )}
                                        >
                                            <span className="truncate">NB Unplugged</span>
                                            <svg className="w-3.5 h-3.5 opacity-40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </Link>
                                        <Link
                                            href="/dashboard/feedback_inbox"
                                            className={cn(
                                                "flex items-center justify-between px-4 py-2 text-sm transition-all duration-150",
                                                isFeedbackInboxActive
                                                    ? "bg-[#eef4fb] font-medium text-[#1f3b57]"
                                                    : "text-[#34495e] hover:bg-[#dde4ec] hover:text-[#1f3b57]"
                                            )}
                                        >
                                            <span className="truncate">NB Unplugged inbox</span>
                                            <svg className="w-3.5 h-3.5 opacity-40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </Link>
                                    </div>,
                                    document.body
                                )}
                            </div>
                        );
                    }

                    const isActive =
                        pathname === item.href ||
                        (item.href !== "/dashboard" && pathname.startsWith(item.href));

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]",
                                isActive
                                    ? "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]"
                                    : "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]"
                            )}
                        >
                            <span className={cn(isActive ? "text-[#0f6ecd]" : "")}>{item.icon}</span>
                            {item.label}
                        </Link>
                    );
                })}

                {/* Report — visible to CEO, developers, managers, HODs only.
                    YT Labs CEO is locked out per the brand-scoped sidebar
                    allowlist (no Report tile in their 10 allowed sections). */}
                {canSeeReports && !isYtLabsCeo && (!isAdmin ? (
                    <Link
                        href={`/dashboard/reports/${user?.dbId}`}
                        className={cn(
                            "flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]",
                            isReportActive
                                ? "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]"
                                : "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]"
                        )}
                    >
                        <span className={cn(isReportActive ? "text-[#0f6ecd]" : "")}>
                            <BarChart3 size={18} strokeWidth={1.5} />
                        </span>
                        Report
                    </Link>
                ) : (
                    <div
                        ref={reportTriggerRef}
                        className="relative"
                        onMouseEnter={handleReportMouseEnter}
                        onMouseLeave={handleReportMouseLeave}
                    >
                        <div
                            className={cn(
                                "flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer",
                                isReportActive
                                    ? "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]"
                                    : "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]"
                            )}
                        >
                            <span className="flex flex-col items-center gap-1">
                                <span className={cn(isReportActive ? "text-[#0f6ecd]" : "")}>
                                    <BarChart3 size={18} strokeWidth={1.5} />
                                </span>
                                Report
                            </span>
                            <svg
                                className={cn(
                                    "hidden",
                                    reportHovered ? "rotate-90" : ""
                                )}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </div>

                        {/* Flyout submenu — admins only, portalled to escape overflow clip */}
                        {reportHovered && typeof document !== "undefined" && createPortal(
                            <div
                                style={{ position: "fixed", left: 108, top: reportY, zIndex: 9999, maxHeight: `calc(100vh - ${reportY}px - 16px)` }}
                                className="w-52 overflow-y-auto rounded-xl border border-[#cfd8e3] bg-[#eef2f6] py-2 shadow-xl shadow-slate-300/30 scrollbar-thin animate-in fade-in slide-in-from-left-2 duration-200"
                                onMouseEnter={handleReportMouseEnter}
                                onMouseLeave={handleReportMouseLeave}
                            >
                                <p className="text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-medium mb-1 px-4 py-1">
                                    Manager Reports
                                </p>
                                {!managersLoaded ? (
                                    <div className="px-4 py-3">
                                        <div className="flex items-center gap-2 text-xs text-slate-500">
                                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                            </svg>
                                            Loading...
                                        </div>
                                    </div>
                                ) : managers.length === 0 ? (
                                    <p className="text-xs text-slate-500 px-4 py-2">No managers found</p>
                                ) : (
                                    managers.map((manager) => (
                                        <Link
                                            key={manager.id}
                                            href={`/dashboard/reports/${manager.id}`}
                                            className={cn(
                                                "flex items-center justify-between px-4 py-2 text-sm transition-all duration-150",
                                                pathname === `/dashboard/reports/${manager.id}`
                                                    ? "bg-[#eef4fb] font-medium text-[#1f3b57]"
                                                    : "text-[#34495e] hover:bg-[#dde4ec] hover:text-[#1f3b57]"
                                            )}
                                        >
                                            <span className="truncate">{manager.name}</span>
                                            <svg className="w-3.5 h-3.5 opacity-40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </Link>
                                    ))
                                )}
                            </div>,
                            document.body
                        )}
                    </div>
                ))}

                {/* KPIs — NB Media only (hidden for YT Labs, same brand rule as
                    Feedback). The page itself further scopes the visible
                    employees by role (self / team / all-departments).
                    Tab-permission still gates show/hide. */}
                {tabAllowed("departments") && user?.businessUnit !== "YT Labs" && (() => {
                    const isKpiActive = pathname.startsWith("/dashboard/kpis");
                    return (
                        <Link
                            href="/dashboard/kpis"
                            className={cn(
                                "flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]",
                                isKpiActive
                                    ? "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]"
                                    : "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]"
                            )}
                        >
                            <span className={cn(isKpiActive ? "text-[#0f6ecd]" : "")}>
                                <Target size={18} strokeWidth={1.5} />
                            </span>
                            KPIs
                        </Link>
                    );
                })()}

                {/* System Violation Log — HR, Special Access, CEO, Developer
                    AND tab-permission allows it. */}
                {canSeeViolationLog && (() => {
                    const isActive = pathname.startsWith("/dashboard/strikes");
                    return (
                        <Link
                            href="/dashboard/strikes"
                            className={cn(
                                "flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]",
                                isActive
                                    ? "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]"
                                    : "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]"
                            )}
                        >
                            <span className={cn(isActive ? "text-[#0f6ecd]" : "")}>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </span>
                            Strike Log
                        </Link>
                    );
                })()}

                {/* Assets — surfaced to IT Security / IT Security Intern
                    designations only (everyone with MANAGE_ASSETS but
                    NOT MANAGE_HR). HR tiers reach this page through the
                    HR Dashboard. Links to the standalone
                    /dashboard/hr/assets route (same AssetsPanel that
                    HR Dashboard mounts). */}
                {showAssetsTab && (() => {
                    const isActive = pathname.startsWith("/dashboard/hr/assets");
                    return (
                        <Link
                            href="/dashboard/hr/assets"
                            className={cn(
                                "flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]",
                                isActive
                                    ? "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]"
                                    : "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]"
                            )}
                        >
                            <Box size={18} strokeWidth={1.5} className={isActive ? "text-[#0f6ecd]" : ""} />
                            Assets
                        </Link>
                    );
                })()}

                {/* REFER — the standalone always-visible "Refer" icon was
                    removed from the primary rail per HR. Refer & Earn now
                    lives ONLY in the "My Space" flyout (under the Me tab),
                    still open to every authenticated employee via
                    /dashboard/hr/referrals. */}

                {/* ── HR & People Section ── */}
                {(() => {
                    const inboxCount = (inboxData?.total || 0) as number;
                    const E = "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]";
                    const A = "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]";

                    const meHandlers    = makeHrHandlers(setHrMeOpen,    setHrMeY,    hrMeTrigger,    hrMeTimer);
                    const teamHandlers  = makeHrHandlers(setHrTeamOpen,  setHrTeamY,  hrTeamTrigger,  hrTeamTimer);
                    const adminHandlers = makeHrHandlers(setHrAdminOpen, setHrAdminY, hrAdminTrigger, hrAdminTimer);

                    const isMeActive    = isHRPath
                        && !pathname.startsWith("/dashboard/hr/my-team")
                        && !pathname.startsWith("/dashboard/hr/inbox")
                        && !pathname.startsWith("/dashboard/hr/people")
                        && !pathname.startsWith("/dashboard/hr/org")
                        && !pathname.startsWith("/dashboard/hr/engage")
                        && !pathname.startsWith("/dashboard/hr/home")
                        && !pathname.startsWith("/dashboard/hr/admin")
                        && !pathname.startsWith("/dashboard/hr/assets")
                        // Hiring / Onboard / Offboard are HR-admin
                        // functions (Jobs / Dashboard / Preboarding /
                        // Settings / Reports / new-joiner flows), not
                        // part of the personal "Me" space. Excluded
                        // here so the Me rail doesn't light up when
                        // HR navigates into them; HR Dashboard rail
                        // picks them up via isAdminActive below.
                        && !pathname.startsWith("/dashboard/hr/hiring")
                        && !pathname.startsWith("/dashboard/hr/onboard")
                        && !pathname.startsWith("/dashboard/hr/offboard")
                        && pathname !== "/admin";
                    const isTeamActive  = pathname.startsWith("/dashboard/hr/my-team") || pathname.startsWith("/dashboard/hr/inbox");
                    const isAdminActive = pathname.startsWith("/dashboard/hr/admin")
                        || pathname.startsWith("/dashboard/hr/assets")
                        || pathname.startsWith("/dashboard/hr/hiring")
                        || pathname.startsWith("/dashboard/hr/onboard")
                        || pathname.startsWith("/dashboard/hr/offboard");

                    // Flyout link
                    const fl = (href: string, label: string, badge?: ReactNode) => {
                        const active = pathname === href || pathname.startsWith(href + "/");
                        return (
                            <Link key={href} href={href}
                                className={cn(
                                    "flex items-center justify-between px-4 py-2 text-[13px] transition-all duration-150",
                                    active
                                        ? "bg-[#eef4fb] font-semibold text-[#1f3b57]"
                                        : "text-[#34495e] hover:bg-[#dde4ec] hover:text-[#1f2f3f]"
                                )}>
                                <span className="truncate">{label}</span>
                                {badge ?? (
                                    <svg className="w-3 h-3 opacity-30 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                )}
                            </Link>
                        );
                    };

                    // Shared flyout panel class
                    const panelCls = "w-56 rounded-xl border border-[#cfd8e3] bg-[#eef2f6] py-2 shadow-xl shadow-slate-300/30 animate-in fade-in slide-in-from-left-2 duration-150";

                    return (
                        <>
                            <p className="hidden text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mt-5 mb-2 px-1 text-center">HR & People</p>

                            {/* MY TEAM trigger — gated by the VIEW_MY_TEAM permission (designation-driven) */}
                            {can(user, "VIEW_MY_TEAM") && (
                                <div ref={hrTeamTrigger} {...teamHandlers}
                                    className={cn("flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer", isTeamActive || hrTeamOpen ? A : E)}>
                                    <span className="relative inline-flex">
                                        <Users size={15} strokeWidth={1.75} className={isTeamActive || hrTeamOpen ? "text-[#0f6ecd]" : ""} />
                                        {inboxCount > 0 && (
                                            <span className="absolute -top-1.5 -right-2.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#008CFF] px-[3px] text-[9px] font-bold leading-none text-white tabular-nums ring-2 ring-[#f7f9fc]">
                                                {inboxCount > 99 ? "99+" : inboxCount}
                                            </span>
                                        )}
                                    </span>
                                    My Team
                                </div>
                            )}

                            {/* ORGANISATION */}
                            <div className="mx-3 mt-4 mb-1.5 border-t border-[#e4ebf2]" />
                            <p className="hidden text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-1.5 px-1 text-center">Organisation</p>
                            {isHRAdmin && [
                                { href: "/dashboard/hr/people", label: "People", Icon: Users },
                            ].map(({ href, label, Icon }) => {
                                const active = pathname === href || pathname.startsWith(href + "/");
                                return (
                                    <Link key={href} href={href}
                                        className={cn("flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]", active ? A : E)}>
                                        <Icon size={15} strokeWidth={1.75} className={active ? "text-[#0f6ecd]" : ""} />
                                        {label}
                                    </Link>
                                );
                            })}

                            {/* HR DASHBOARD — hover-flyout trigger. Splits
                                into per-brand sub-dashboards (NB Media /
                                YT Labs, plus "All brands" for founders).
                                Each entry routes to /dashboard/hr/admin
                                with a ?brand= param the page reads and
                                seeds each panel's brand filter from. */}
                            {isHRAdmin && (
                                <>
                                    <div className="mx-3 mt-4 mb-1.5 border-t border-[#e4ebf2]" />
                                    <div ref={hrAdminTrigger} {...adminHandlers}
                                        className={cn("flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer", isAdminActive || hrAdminOpen ? A : E)}>
                                        <span className="relative inline-flex">
                                            <BarChart2 size={15} strokeWidth={1.75} className={isAdminActive || hrAdminOpen ? "text-[#0f6ecd]" : ""} />
                                            {approvalsCount > 0 && (
                                                <span className="absolute -top-1.5 -right-2.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#008CFF] px-[3px] text-[9px] font-bold leading-none text-white tabular-nums ring-2 ring-[#f7f9fc]">
                                                    {approvalsCount > 99 ? "99+" : approvalsCount}
                                                </span>
                                            )}
                                        </span>
                                        HR Dashboard
                                    </div>
                                </>
                            )}

                            {/* Assets link is rendered in the always-visible
                                top section above (showAssetsTab = true). HR-
                                admins who can MANAGE_ASSETS were getting a
                                SECOND copy of the same icon here, leading
                                to "why are there 2 Assets?" — duplicate
                                removed. The shared /dashboard/hr/assets
                                page already gates admin actions internally
                                via canManageAssets, so removing the gated
                                sidebar copy doesn't lose any functionality. */}

                            {/* Refer & Earn lives in the always-visible top
                                section above — intentionally NOT duplicated
                                here. HR-admins see the primary copy. */}

                            {/* ── Portal flyouts — escape overflow-y:auto, open sideways ── */}
                            {hrMeOpen && typeof document !== "undefined" && createPortal(
                                <div style={{ position: "fixed", left: 108, top: hrMeY, zIndex: 9999 }}
                                    className={panelCls} {...meHandlers}>
                                    <p className="text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-1 px-4 pt-1">My Space</p>
                                    {fl("/dashboard/hr/attendance", "Attendance"       )}
                                    {fl("/dashboard/hr/leaves",     "Leave"            )}
                                    <div className="my-1 mx-3 border-t border-[#d1dae5]" />
                                    {fl("/dashboard/hr/profile?tab=DOCUMENTS", "Documents")}
                                    {/* Refer & Earn — visible to every employee.
                                        Lists open jobs HR has tagged for referrals
                                        and lets the employee refer someone from
                                        their network with a resume upload. */}
                                    {fl("/dashboard/hr/referrals",  "Refer & Earn"     )}
                                </div>,
                                document.body
                            )}

                            {financesOpen && typeof document !== "undefined" && createPortal(
                                <div style={{ position: "fixed", left: 108, top: financesY, zIndex: 9999 }}
                                    className={panelCls}
                                    onMouseEnter={() => { if (financesTimer.current) clearTimeout(financesTimer.current); setFinancesOpen(true); }}
                                    onMouseLeave={() => { financesTimer.current = setTimeout(() => setFinancesOpen(false), 200); }}>
                                    <p className="text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-1 px-4 pt-1">My Finances</p>
                                    {fl("/dashboard/hr/payroll/summary", "Summary"   )}
                                    {/* My Pay — parent row with nested sub-flyout */}
                                    {(() => {
                                        const href = "/dashboard/hr/payroll";
                                        const active = pathname === href || pathname.startsWith(href + "/") || pathname.startsWith(href + "?");
                                        return (
                                            <div ref={myPayRowRef}
                                                onMouseEnter={() => {
                                                    if (myPaySubTimer.current) clearTimeout(myPaySubTimer.current);
                                                    if (myPayRowRef.current) setMyPaySubY(myPayRowRef.current.getBoundingClientRect().top);
                                                    setMyPaySubOpen(true);
                                                }}
                                                onMouseLeave={() => {
                                                    myPaySubTimer.current = setTimeout(() => setMyPaySubOpen(false), 200);
                                                }}
                                            >
                                                <Link href={href}
                                                    className={cn(
                                                        "flex items-center justify-between px-4 py-2 text-[13px] transition-all duration-150",
                                                        active
                                                            ? "bg-[#eef4fb] font-semibold text-[#1f3b57]"
                                                            : "text-[#34495e] hover:bg-[#dde4ec] hover:text-[#1f2f3f]"
                                                    )}>
                                                    <span className="truncate">My Pay</span>
                                                    <svg className="w-3 h-3 opacity-50 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                    </svg>
                                                </Link>
                                            </div>
                                        );
                                    })()}
                                    {fl("/dashboard/hr/payroll/tax",     "Manage Tax")}
                                </div>,
                                document.body
                            )}

                            {/* Nested sub-flyout for My Pay — positioned to the right of the finances panel */}
                            {myPaySubOpen && typeof document !== "undefined" && createPortal(
                                <div
                                    style={{ position: "fixed", left: 108 + 224 + 4, top: myPaySubY, zIndex: 10000 }}
                                    className={panelCls}
                                    onMouseEnter={() => {
                                        if (myPaySubTimer.current) clearTimeout(myPaySubTimer.current);
                                        setMyPaySubOpen(true);
                                        // Keep the parent flyout open while the sub is open.
                                        if (financesTimer.current) clearTimeout(financesTimer.current);
                                        setFinancesOpen(true);
                                    }}
                                    onMouseLeave={() => {
                                        myPaySubTimer.current = setTimeout(() => setMyPaySubOpen(false), 200);
                                    }}
                                >
                                    <p className="text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-1 px-4 pt-1">My Pay</p>
                                    {(() => {
                                        const onPayroll = pathname === "/dashboard/hr/payroll";
                                        const tabActive = (t: string) => onPayroll && (currentTab === t || (!currentTab && t === "my-salary"));
                                        const subItem = (tab: string, label: string) => {
                                            const active = tabActive(tab);
                                            return (
                                                <Link key={tab} href={`/dashboard/hr/payroll?tab=${tab}`}
                                                    className={cn(
                                                        "flex items-center justify-between px-4 py-2 text-[13px] transition-all duration-150 border-l-2",
                                                        active
                                                            ? "bg-[#e8f1fc] font-semibold text-[#0f4e93] border-[#0f4e93]"
                                                            : "text-[#34495e] border-transparent hover:bg-[#dde4ec] hover:text-[#1f2f3f]"
                                                    )}>
                                                    <span className="truncate">{label}</span>
                                                    {active ? (
                                                        <span className="h-1.5 w-1.5 rounded-full bg-[#0f4e93]" />
                                                    ) : (
                                                        <svg className="w-3 h-3 opacity-30 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                        </svg>
                                                    )}
                                                </Link>
                                            );
                                        };
                                        return (
                                            <>
                                                {subItem("my-salary",  "My Salary" )}
                                                {subItem("pay-slips",  "Pay Slips" )}
                                                {subItem("income-tax", "Income Tax")}
                                            </>
                                        );
                                    })()}
                                </div>,
                                document.body
                            )}

                            {hrTeamOpen && typeof document !== "undefined" && createPortal(
                                <div style={{ position: "fixed", left: 108, top: hrTeamY, zIndex: 9999 }}
                                    className={panelCls} {...teamHandlers}>
                                    <p className="text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-1 px-4 pt-1">My Team</p>
                                    {fl("/dashboard/hr/my-team", "Team Overview")}
                                    {fl("/dashboard/hr/inbox",   "Approval Request",
                                        inboxCount > 0 ? (
                                            <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#008CFF] text-white text-[10px] font-bold flex items-center justify-center leading-none tabular-nums">
                                                {inboxCount > 99 ? "99+" : inboxCount}
                                            </span>
                                        ) : undefined
                                    )}
                                    {fl("/dashboard/hr/my-team/probation", "Probation Reviews",
                                        probationCount > 0 ? (
                                            <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#008CFF] text-white text-[10px] font-bold flex items-center justify-center leading-none tabular-nums">
                                                {probationCount > 99 ? "99+" : probationCount}
                                            </span>
                                        ) : undefined
                                    )}
                                    {fl("/dashboard/hr/my-team/pip", "PIP Reviews",
                                        pipCount > 0 ? (
                                            <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#008CFF] text-white text-[10px] font-bold flex items-center justify-center leading-none tabular-nums">
                                                {pipCount > 99 ? "99+" : pipCount}
                                            </span>
                                        ) : undefined
                                    )}
                                </div>,
                                document.body
                            )}

                            {/* HR Dashboard flyout — per-brand sub-dashboards.
                                Both brand entries route to the same page with
                                a ?brand= param; the page reads it and seeds
                                each panel's brand filter. "All brands" is
                                gated to DEVELOPERS ONLY now — CEOs (and every
                                other tier) only see their own brand entries.
                                Per HR's ask: CEOs should stay brand-scoped
                                everywhere, including this dashboard switcher.
                                Active state is brand-aware: we can't reuse
                                `fl()` here because pathname doesn't include
                                the query string. */}
                            {hrAdminOpen && typeof document !== "undefined" && createPortal(
                                <div style={{ position: "fixed", left: 108, top: hrAdminY, zIndex: 9999 }}
                                    className={panelCls} {...adminHandlers}>
                                    <p className="text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-1 px-4 pt-1">HR Dashboard</p>
                                    {(() => {
                                        const currentBrand = pathname.startsWith("/dashboard/hr/admin")
                                            ? searchParams.get("brand")
                                            : null;
                                        const brandEntry = (slug: string, label: string) => {
                                            const active = currentBrand === slug;
                                            return (
                                                <Link key={slug} href={`/dashboard/hr/admin?brand=${slug}`}
                                                    // Auto-close the flyout the moment the user
                                                    // commits to a brand — otherwise the menu
                                                    // hangs around as the page navigates,
                                                    // covering content. Same hover-trigger logic
                                                    // re-opens it on the next hover.
                                                    onClick={() => setHrAdminOpen(false)}
                                                    className={cn(
                                                        "flex items-center justify-between px-4 py-2 text-[13px] transition-all duration-150",
                                                        active
                                                            ? "bg-[#eef4fb] font-semibold text-[#1f3b57]"
                                                            : "text-[#34495e] hover:bg-[#dde4ec] hover:text-[#1f2f3f]"
                                                    )}>
                                                    <span className="truncate">{label}</span>
                                                    <svg className="w-3 h-3 opacity-30 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                    </svg>
                                                </Link>
                                            );
                                        };
                                        // Org-wide brand isolation (2026-07-15): only
                                        // all-brands viewers (developers + VIEW_ALL_BRANDS
                                        // designation holders) get the brand switcher.
                                        // Everyone else — including the other brand's HR
                                        // Manager and the CEOs — sees a single entry for
                                        // their OWN brand. The server clamps the data
                                        // anyway; this keeps the UI honest about it.
                                        const seesAll = canViewAllBrands(user as any);
                                        const ownSlug = user?.businessUnit === "YT Labs" ? "yt-labs" : "nb-media";
                                        const ownLabel = user?.businessUnit === "YT Labs" ? "YT Labs" : "NB Media";
                                        return seesAll ? (
                                            <>
                                                {brandEntry("nb-media", "NB Media")}
                                                {brandEntry("yt-labs",  "YT Labs")}
                                                <div className="my-1 mx-3 border-t border-[#d1dae5]" />
                                                {brandEntry("all", "All brands")}
                                            </>
                                        ) : (
                                            <>{brandEntry(ownSlug, ownLabel)}</>
                                        );
                                    })()}
                                </div>,
                                document.body
                            )}

                        </>
                    );
                })()}

                {/* Items from Admin onward */}
                {afterAdmin.map((item) => {
                    const isActive =
                        pathname === item.href ||
                        (item.href !== "/dashboard" && pathname.startsWith(item.href));

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]",
                                isActive
                                    ? "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]"
                                    : "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]"
                            )}
                        >
                            <span className={cn(isActive ? "text-[#0f6ecd]" : "")}>{item.icon}</span>
                            {item.label}
                        </Link>
                    );
                })}
            </nav>

            {/* Footer */}
            <div className="border-t border-[#e4ebf2] p-2.5">
                <div className="overflow-hidden rounded-md border border-[#dee6ee] bg-white px-1 py-2 text-center">
                    <p className="text-[7px] font-semibold uppercase leading-none tracking-[0.14em] text-[#94a3b3]">Workspace</p>
                    <p className="mt-1 truncate whitespace-nowrap text-[9px] font-extrabold leading-none text-[#243445]">NB Media</p>
                    <p className="mt-0.5 truncate whitespace-nowrap text-[6.5px] leading-none text-[#9aa9b8]">Productions</p>
                </div>
            </div>
        </aside>

        </>
    );
}
