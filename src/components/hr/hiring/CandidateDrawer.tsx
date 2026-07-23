"use client";

// Candidate detail drawer — full-screen Keka-parity layout.
//
// Header:
//   • Breadcrumb (Role > Stage), prev/next nav across pipeline siblings
//   • Avatar, name, applied-from line, +Assign owner
//   • Contact: phone, email
//   • Social row: Skype / LinkedIn / Facebook / X / Google / Website
//   • Right rail:
//       - HIRING STAGE dropdown (changes stage immediately)
//       - Archive button (opens ArchiveCandidateModal)
//       - INTERACTIONS:
//           Schedule split-button → Online / Face-to-Face / Self
//           Email icon (opens email modal, reuses existing endpoint)
//           WhatsApp icon (opens wa.me link)
//           ⋯ More menu (placeholder rows for now)
//
// Body tabs: Profile / Messages / Feedback / Documents / Activity / Offer
//
// Tabs that are stubbed (Messages / Feedback / Documents) render a
// friendly placeholder telling HR what's coming. Profile / Activity /
// Offer are functional today.

import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useSession } from "next-auth/react";
import { isHRAdmin } from "@/lib/access";
import { fetcher } from "@/lib/swr";
import { showToast } from "@/components/ui/Toast";
import { useUrlTab } from "@/lib/hooks/useUrlTab";
import {
  X, Mail, Phone, ExternalLink, FileText, Calendar, ChevronDown,
  ChevronLeft, ChevronRight, Globe,
  MapPin, Briefcase, MessageSquare, Activity as ActivityIcon, FilePlus,
  Construction, Edit3, MoreHorizontal, MessageCircle, Send, Video,
  IndianRupee,
} from "lucide-react";
import ScheduleInterviewModal from "./ScheduleInterviewModal";
import ArchiveCandidateModal  from "./ArchiveCandidateModal";
import CandidateActionModal, { type CandidateAction } from "./CandidateActionModal";
import FeedbackTab            from "./FeedbackTab";
import OfferTab               from "./OfferTab";
import SelectField            from "@/components/ui/SelectField";

type Stage = { id: number; key: string; label: string; kind: string; color: string };
type Candidate = {
  id: number; fullName: string; email: string; phone: string | null;
  /** Gravatar URL resolved from the candidate's email (null when not set). */
  photoUrl?: string | null;
  experienceYears: number | null; experienceMonths?: number | null;
  currentCompany: string | null;
  noticePeriod: string | null; resumeUrl: string | null; resumeFileName: string | null;
  linkedinUrl?: string | null; portfolioUrl?: string | null; coverLetter?: string | null;
  source: string | null; overallRating: number | null; roleTitle: string | null;
  currentStage: Stage | null; enteredStageAt: string | null; createdAt: string;
  jobOpeningId: number;
  ownerName?: string | null; recruiterOwnerId?: number | null;
  expectedSalary?: number | null; currentSalary?: number | null;
  availableToJoinDays?: number | null;
  location?: string | null; city?: string | null;
  // Smart-form columns added by the public apply flow. Optional so
  // legacy rows that only have the original column set don't break
  // the type. JSON columns are stored as serialized strings.
  currentLocation?: string | null;
  preferredLocation?: string | null;
  skills?: string | null;
  educationDetails?: string | null;
  experienceDetails?: string | null;
};

type EducationEntry = {
  course?: string; branch?: string;
  startOfCourse?: string; endOfCourse?: string;
  university?: string; location?: string;
};
type ExperienceEntry = {
  companyName?: string; jobTitle?: string;
  currentlyWorking?: boolean;
  dateOfJoining?: string; dateOfRelieving?: string;
  location?: string;
};

const fmtMoneyINR = (n: number | null | undefined) =>
  n == null ? "—" : `INR ${Number(n).toLocaleString("en-IN")}`;
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const v = u.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("/"))       return v;
  return null;
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return ((p[0][0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}
const AVATAR_TONES = [
  "bg-[#3b82f6]", "bg-violet-500", "bg-rose-500", "bg-amber-500",
  "bg-emerald-500", "bg-cyan-500", "bg-fuchsia-500", "bg-indigo-500",
];
function avatarTone(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

// Avatar that tries the Gravatar photo first, falls back to the
// coloured-initials circle on 404 or any <img onError>. Shared shape
// with the CandidatesTab one so the same fallback story applies on
// the list and the drawer.
function CandidateAvatar({
  name, photoUrl, size = 64,
}: {
  name: string;
  photoUrl?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const dim = `${size}px`;
  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={name}
        onError={() => setFailed(true)}
        loading="lazy"
        className="shrink-0 rounded-full object-cover"
        style={{ width: dim, height: dim }}
      />
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-white font-bold ${avatarTone(name)}`}
      style={{ width: dim, height: dim, fontSize: Math.round(size * 0.32) }}
    >
      {initials(name)}
    </span>
  );
}

export default function CandidateDrawer({
  candidateId, onClose, onChange,
}: {
  candidateId: number;
  onClose: () => void;
  /** Optional — called by the parent to invalidate sibling caches
   * (e.g. the Kanban board's candidate list) after drawer-side mutations. */
  onChange?: () => void | Promise<void>;
}) {
  // Reference once so TS doesn't flag the prop as unused when no internal
  // call site has been wired yet. Safe no-op; parent retains the prop.
  void onChange;
  const { data: session } = useSession();
  const me = session?.user as any;
  const currentUserId: number | null = me?.id != null ? Number(me.id) : null;
  const hrAdmin = isHRAdmin(me);
  const url = `/api/hr/hiring/candidates/${candidateId}`;
  const { data, mutate } = useSWR<any>(url, fetcher);
  const { data: stagesData } = useSWR<{ stages: Stage[] }>("/api/hr/hiring/stages", fetcher);
  const { data: listData } = useSWR<{ candidates: Candidate[] }>("/api/hr/hiring/candidates", fetcher);

  const stages = stagesData?.stages ?? [];
  const candidates = listData?.candidates ?? [];

  // URL-synced so reload (or shared link) returns to the same drawer tab.
  // Key "pane" to avoid colliding with the outer hiring "tab" param.
  const [tab, setTab] = useUrlTab<"profile" | "feedback" | "documents" | "activity" | "offer">(
    "pane", "profile",
    ["profile", "feedback", "documents", "activity", "offer"] as const,
  );
  const [scheduleMode, setScheduleMode] = useState<"online" | "face_to_face" | "self_schedule" | null>(null);
  const [archiveOpen, setArchiveOpen]   = useState(false);
  const [scheduleMenuOpen, setScheduleMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [actionModal, setActionModal] = useState<CandidateAction | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Esc closes the drawer when no submodals are open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !scheduleMode && !archiveOpen && !actionModal) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [scheduleMode, archiveOpen, actionModal, onClose]);

  const c: Candidate | undefined = data?.candidate ?? data?.application;
  const activity = data?.activity ?? [];
  const interviews = data?.interviews ?? [];
  const offers     = data?.offers ?? [];

  // Pipeline siblings — same role + same stage — for prev/next nav.
  const siblings = useMemo(() => {
    if (!c) return [] as Candidate[];
    return candidates.filter((x) =>
      x.jobOpeningId === c.jobOpeningId &&
      (x.currentStage?.key ?? "") === (c.currentStage?.key ?? ""),
    );
  }, [candidates, c]);
  const idx = siblings.findIndex((x) => x.id === c?.id);
  const total = siblings.length;
  const goSibling = (delta: number) => {
    if (idx === -1) return;
    const next = siblings[idx + delta];
    if (!next) return;
    // Switch which candidate the drawer is showing by mutating the
    // SWR cache to the next one. The drawer's outer state lives in
    // its parent, so we navigate by closing + reopening via callback?
    // Simpler: just trigger a hash/url change. We don't have a router
    // hook here; emit a CustomEvent the parent can listen to.
    window.dispatchEvent(new CustomEvent("nb:candidateDrawer:navigate", { detail: next.id }));
  };

  const patchStage = async (stageId: number) => {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "moveStage", stageId }),
      });
      if (!res.ok) showToast("Couldn't update the stage — reverting.", "error");
      // Re-fetch truth either way: confirms on success, reverts the
      // dropdown to the real stage on failure (instead of showing stale).
      mutate();
      globalMutate("/api/hr/hiring/candidates");
    } catch {
      showToast("Couldn't update the stage — reverting.", "error");
      mutate();
    } finally {
      setBusy(false);
    }
  };

  if (!c) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex items-center justify-center">
        <div className="inline-block h-7 w-7 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* ── Top breadcrumb + close ─────────────────────────── */}
      <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-[12.5px] text-slate-500">
          <span className="font-medium text-slate-700">{c.roleTitle ?? "Candidate"}</span>
          <ChevronRight size={11} className="text-slate-300" />
          <span className="uppercase tracking-wider text-[10.5px] font-bold text-slate-500">
            {c.currentStage?.label ?? "Unstaged"}
          </span>
          {total > 1 && (
            <span className="inline-flex items-center gap-1 ml-2">
              <button onClick={() => goSibling(-1)} disabled={idx <= 0}
                className="h-6 w-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed">
                <ChevronLeft size={13} />
              </button>
              <span className="text-[11px] tabular-nums">{idx + 1} of {total}</span>
              <button onClick={() => goSibling(+1)} disabled={idx === total - 1 || idx < 0}
                className="h-6 w-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed">
                <ChevronRight size={13} />
              </button>
            </span>
          )}
        </div>
        <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100">
          <X size={16} />
        </button>
      </div>

      {/* ── Identity + actions row ─────────────────────────── */}
      <div className="px-6 py-5 border-b border-slate-100">
        <div className="flex items-start gap-5 flex-wrap">
          <CandidateAvatar name={c.fullName} photoUrl={c.photoUrl} size={64} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-bold text-slate-900 tracking-tight truncate">{c.fullName}</h1>
              <button
                onClick={() => setActionModal("editProfile")}
                className="h-7 w-7 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                title="Edit name / email / phone"
              >
                <Edit3 size={13} />
              </button>
            </div>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Applied from {c.source ?? "—"} on {fmtDate(c.createdAt)}
              {!c.ownerName && (
                <button
                  onClick={() => setActionModal("updateOwner")}
                  className="ml-2 text-[#3b82f6] hover:underline font-semibold"
                >+ Assign owner</button>
              )}
              {c.ownerName && (
                <button
                  onClick={() => setActionModal("updateOwner")}
                  className="ml-2 text-slate-700 hover:text-[#3b82f6] font-medium"
                  title="Change owner"
                >· Owner: {c.ownerName}</button>
              )}
            </p>

            {/* Contact row */}
            <div className="mt-3 flex items-center gap-6 flex-wrap text-[12.5px]">
              {c.phone && (
                <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 text-slate-700 hover:text-[#3b82f6]">
                  <Phone size={13} className="text-slate-400" /> <span className="tabular-nums">{c.phone}</span>
                </a>
              )}
              <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 text-slate-700 hover:text-[#3b82f6]">
                <Mail size={13} className="text-slate-400" /> <span className="truncate">{c.email}</span>
              </a>
            </div>

            {/* Social icon row — lucide-react removed brand glyphs,
                so these use inline brand SVGs (Skype / LinkedIn /
                Facebook / X / Globe) with tooltips. Disabled (grey)
                when the URL isn't on file. */}
            <div className="mt-3 flex items-center gap-1.5">
              <BrandIcon kind="skype"    href={null} />
              <BrandIcon kind="linkedin" href={safeUrl(c.linkedinUrl)} />
              <BrandIcon kind="facebook" href={null} />
              <BrandIcon kind="twitter"  href={null} />
              <BrandIcon kind="google"   href={null} />
              <BrandIcon kind="globe"    href={safeUrl(c.portfolioUrl)} />
              <button className="h-7 w-7 inline-flex items-center justify-center rounded-full text-slate-300 hover:text-slate-600" title="Edit social links">
                <Edit3 size={12} />
              </button>
            </div>
          </div>

          {/* Right rail — stage / archive / interactions */}
          <div className="flex items-stretch gap-6 flex-wrap">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Hiring stage</p>
              <div className="flex items-center gap-2">
                {/* Branded portal-rendered select — kills the OS-native
                    dark/khaki option highlight (Chromium on Linux). */}
                <SelectField
                  value={c.currentStage?.id != null ? String(c.currentStage.id) : ""}
                  onChange={(v) => {
                    // Picking the "Rejected" stage from the dropdown
                    // funnels HR into the Archive modal instead of an
                    // immediate stage change — the modal collects a
                    // reason + closing email and then moves the
                    // candidate to the rejected stage as part of its
                    // own backend call (action="archive"). Without this
                    // intercept, HR would be able to drop someone into
                    // the rejected bucket with no reason recorded.
                    const picked = stages.find((s) => String(s.id) === v);
                    if (picked?.kind === "rejected") {
                      setArchiveOpen(true);
                      return;
                    }
                    patchStage(Number(v));
                  }}
                  options={stages.map((s) => ({ value: String(s.id), label: s.label }))}
                  disabled={busy}
                  className="h-9 pl-3.5 pr-3 rounded-lg border border-slate-200 bg-white text-[12.5px] font-semibold text-slate-800 hover:border-slate-300 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 flex items-center justify-between gap-2 min-w-[160px]"
                  width={200}
                />
                <button
                  onClick={() => setArchiveOpen(true)}
                  className="h-9 px-3.5 rounded-lg border border-rose-300 text-rose-600 hover:bg-rose-50 text-[12.5px] font-semibold"
                >Archive</button>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Interactions</p>
              <div className="flex items-center gap-1.5">
                {/* Schedule split button */}
                <div className="relative">
                  <button
                    onClick={() => setScheduleMenuOpen((v) => !v)}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[12.5px] font-semibold shadow-sm"
                  >
                    <Calendar size={13} /> Schedule
                    <ChevronDown size={12} className={`transition-transform ${scheduleMenuOpen ? "rotate-180" : ""}`} />
                  </button>
                  {scheduleMenuOpen && (
                    <div className="absolute right-0 top-full mt-1.5 z-30 w-60 rounded-xl border border-slate-200 bg-white shadow-[0_10px_30px_-6px_rgba(15,23,42,0.18)] py-1.5"
                      onMouseLeave={() => setScheduleMenuOpen(false)}>
                      <ScheduleMenuItem Icon={Video}    label="Online Interview"        onClick={() => { setScheduleMode("online");        setScheduleMenuOpen(false); }} />
                      <ScheduleMenuItem Icon={MapPin}   label="Face To Face Interview" onClick={() => { setScheduleMode("face_to_face"); setScheduleMenuOpen(false); }} />
                      <ScheduleMenuItem Icon={Calendar} label="Self-schedule interview" hint onClick={() => { setScheduleMode("self_schedule"); setScheduleMenuOpen(false); }} />
                    </div>
                  )}
                </div>

                <IconButton title="Send Email" onClick={() => setActionModal("sendEmail")}>
                  <Mail size={14} />
                </IconButton>
                <IconButton title="Message on WhatsApp" onClick={() => {
                  const phone = (c.phone ?? "").replace(/\D/g, "");
                  if (!phone) { showToast("No phone number on file.", "error"); return; }
                  window.open(`https://wa.me/${phone}`, "_blank", "noopener,noreferrer");
                }}>
                  <MessageCircle size={14} />
                </IconButton>
                <div className="relative">
                  <IconButton title="More" onClick={() => setMoreMenuOpen((v) => !v)}>
                    <MoreHorizontal size={14} />
                  </IconButton>
                  {moreMenuOpen && (
                    <div className="absolute right-0 top-full mt-1.5 z-30 w-48 rounded-xl border border-slate-200 bg-white shadow-lg py-1.5"
                      onMouseLeave={() => setMoreMenuOpen(false)}>
                      <MoreMenuItem label="Add Feedback"   onClick={() => { setTab("feedback");  setMoreMenuOpen(false); }} />
                      <MoreMenuItem label="Add Note"       onClick={() => { setTab("activity");  setMoreMenuOpen(false); }} />
                      <MoreMenuItem label="View Resume" disabled={!safeUrl(c.resumeUrl)} onClick={() => {
                        const u = safeUrl(c.resumeUrl); if (u) window.open(u, "_blank", "noopener,noreferrer");
                        setMoreMenuOpen(false);
                      }} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tab bar ────────────────────────────────────────── */}
      <div className="px-6 border-b border-slate-200">
        <div className="flex items-center gap-6 -mb-px">
          {(["profile", "feedback", "documents", "activity", "offer"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-3 border-b-2 text-[13px] font-semibold capitalize transition-colors ${
                tab === t ? "border-[#3b82f6] text-[#3b82f6]" : "border-transparent text-slate-500 hover:text-slate-900"
              }`}
            >{t}</button>
          ))}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-slate-50">
        <div className="max-w-[1300px] mx-auto px-6 py-6">
          {tab === "profile"   && <ProfileTab c={c} />}
          {tab === "feedback"  && (
            <FeedbackTab
              interviews={interviews}
              currentUserId={currentUserId}
              isHRAdmin={hrAdmin}
              onMutated={() => mutate()}
            />
          )}
          {tab === "documents" && <DocumentsTab c={c} />}
          {tab === "activity"  && <ActivityTab activity={activity} interviews={interviews} />}
          {tab === "offer"     && (
            <OfferTab
              candidate={{
                id: c.id, fullName: c.fullName, email: c.email, roleTitle: c.roleTitle,
                // Salary auto-fill — the GET endpoint joins JobOpening
                // and returns jobSalaryRange / jobSalaryUnit on the
                // candidate row. Cast through `any` since these aren't
                // on the strict Candidate type yet (they're additive,
                // optional, server-side joined fields).
                jobSalaryRange: (c as any).jobSalaryRange ?? null,
                jobSalaryUnit:  (c as any).jobSalaryUnit  ?? null,
                // Application date — feeds the offer letter's
                // "application dated X" line so it isn't a literal "—".
                createdAt:      c.createdAt ?? null,
              }}
              offers={offers}
              onMutated={() => mutate()}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      {scheduleMode && (
        <ScheduleInterviewModal
          candidate={{
            id: c.id, fullName: c.fullName, email: c.email,
            roleTitle: c.roleTitle, jobOpeningId: c.jobOpeningId,
            currentStageKey: c.currentStage?.key ?? null,
          }}
          defaultKind={scheduleMode}
          onClose={() => setScheduleMode(null)}
          onDone={() => { mutate(); }}
        />
      )}
      {archiveOpen && (
        <ArchiveCandidateModal
          candidate={{ id: c.id, fullName: c.fullName, email: c.email, roleTitle: c.roleTitle }}
          onClose={() => setArchiveOpen(false)}
          onDone={() => { mutate(); onClose(); }}
        />
      )}
      {actionModal && (
        <CandidateActionModal
          action={actionModal}
          candidate={{
            id: c.id,
            fullName: c.fullName,
            email: c.email,
            phone: c.phone,
            roleTitle: c.roleTitle,
            ownerName: c.ownerName ?? null,
            recruiterOwnerId: c.recruiterOwnerId ?? null,
            currentStageKey: c.currentStage?.key ?? null,
          }}
          onClose={() => setActionModal(null)}
          onDone={() => { mutate(); }}
        />
      )}
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title}
      className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-[#3b82f6] hover:border-[#3b82f6]">
      {children}
    </button>
  );
}

function ScheduleMenuItem({ Icon, label, onClick, hint }: { Icon: any; label: string; onClick: () => void; hint?: boolean }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12.5px] font-medium text-slate-700 hover:bg-blue-50 hover:text-[#1d4ed8]">
      <Icon size={13} className="text-slate-400" />
      {label}
      {hint && <span className="ml-auto text-[10px] text-slate-400">Preview</span>}
    </button>
  );
}

function MoreMenuItem({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full text-left px-3 py-2 text-[12.5px] font-medium text-slate-700 hover:bg-blue-50 hover:text-[#1d4ed8] disabled:opacity-40 disabled:cursor-not-allowed">
      {label}
    </button>
  );
}

function ProfileTab({ c }: { c: Candidate }) {
  const resumeHref = safeUrl(c.resumeUrl);
  // Inline-preview eligibility:
  //   1. The new in-DB resume API (`/api/hr/hiring/resumes/<id>`)
  //      ALWAYS responds with a PDF — the endpoint auto-converts .doc
  //      / .docx via LibreOffice (or Word COM on Windows dev) before
  //      sending the bytes back. So if the URL points there, trust it
  //      and render the iframe regardless of the original filename
  //      extension.
  //   2. Legacy /uploads/resumes/<uuid>.pdf static URLs predate the
  //      conversion path — keep the extension-based heuristic there.
  const isPdf = !!(
    resumeHref && (
      /^\/api\/hr\/hiring\/resumes\//i.test(resumeHref) ||
      /\.pdf(\?|$)/i.test(resumeHref) ||
      /\.pdf$/i.test(c.resumeFileName ?? "")
    )
  );
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const saveNote = async () => {
    const v = note.trim();
    if (!v) return;
    setSavingNote(true);
    const res = await fetch(`/api/hr/hiring/candidates/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "addNote", note: v }),
    });
    setSavingNote(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(j?.error || "Couldn't save note", "error");
      return;
    }
    setNote("");
    globalMutate(`/api/hr/hiring/candidates/${c.id}`);
  };

  // ── Parse JSON sub-forms from the apply flow ─────────────────────
  // educationDetails / experienceDetails are stored as serialized JSON
  // strings (the apply route fd.set's them with JSON.stringify). Parse
  // here so the Profile tab can render entries instead of "—".
  const educationEntries = parseJsonList<EducationEntry>(c.educationDetails);
  const experienceEntries = parseJsonList<ExperienceEntry>(c.experienceDetails);
  // Skills came in as a comma-separated string from the chip input.
  const skillTags = (c.skills || "")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Current Company falls back to the most relevant experience entry —
  // the one marked currentlyWorking first, then the most recent by
  // dateOfJoining.
  const derivedCurrentCompany = c.currentCompany || (() => {
    const current = experienceEntries.find((e) => e.currentlyWorking && e.companyName?.trim());
    if (current) return [current.companyName, current.jobTitle].filter(Boolean).join(" · ");
    const sorted = [...experienceEntries]
      .filter((e) => e.companyName?.trim())
      .sort((a, b) => (b.dateOfJoining || "").localeCompare(a.dateOfJoining || ""));
    if (sorted.length === 0) return null;
    return [sorted[0].companyName, sorted[0].jobTitle].filter(Boolean).join(" · ");
  })();
  const locationLabel = c.currentLocation ?? c.location ?? c.city ?? c.preferredLocation ?? "—";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
      <div className="lg:col-span-3 space-y-5">
        {/* Info chips */}
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
            <InfoChip Icon={Calendar}    tone="amber"   label="Available To Join (in days)"
              value={c.availableToJoinDays != null ? `${c.availableToJoinDays} days` : "—"} />
            <InfoChip Icon={Briefcase}   tone="slate"   label="Experience"
              value={fmtExperience(c.experienceYears, c.experienceMonths)} />
            <InfoChip Icon={MapPin}      tone="orange"  label="Location"
              value={locationLabel} />
            <InfoChip Icon={IndianRupee} tone="emerald" label="Current Salary"
              value={c.currentSalary != null ? fmtMoneyINR(c.currentSalary) + " (Monthly)" : "—"} />
            <InfoChip Icon={IndianRupee} tone="emerald" label="Expected Salary"
              value={c.expectedSalary != null ? fmtMoneyINR(c.expectedSalary) + " (Monthly)" : "—"} />
            <InfoChip Icon={Briefcase}   tone="slate"   label="Current Company"
              value={derivedCurrentCompany ?? "—"} />
          </div>
        </Card>

        {/* Experience entries — only render when the candidate filled
            the repeatable Experience Details on the apply form. */}
        {experienceEntries.length > 0 && (
          <Card title="Work experience">
            <ul className="space-y-3">
              {experienceEntries.map((e, i) => (
                <li key={`exp-${i}`} className="rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-slate-800 truncate">
                        {e.jobTitle || "—"}
                        {e.companyName ? <span className="text-slate-500 font-medium"> · {e.companyName}</span> : null}
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-slate-500">
                        {fmtDateRange(e.dateOfJoining, e.currentlyWorking ? null : e.dateOfRelieving, e.currentlyWorking)}
                        {e.location ? <span className="text-slate-400"> · {e.location}</span> : null}
                      </p>
                    </div>
                    {e.currentlyWorking && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-emerald-100">
                        Current
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Education / Skills / Tags row */}
        <Card>
          <Section title="Education">
            <EducationEditor candidateId={c.id} entries={educationEntries} />
          </Section>

          <Section title="Skills">
            <SkillsEditor candidateId={c.id} initialSkills={skillTags} />
          </Section>

          <Section title="Tags" last>
            <p className="text-[12px] text-slate-500">
              Add tags from the candidates list (click the <span className="font-semibold">🏷 tag</span> button on a row).
              Stored tags appear automatically in the candidate card.
            </p>
          </Section>
        </Card>

        {c.coverLetter && (
          <Card title="Cover letter">
            <p className="text-[13px] text-slate-700 whitespace-pre-wrap leading-relaxed">{c.coverLetter}</p>
          </Card>
        )}

        {/* Add note */}
        <Card title="Add a note">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="Drop a quick note — visible to the hiring team."
            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
          />
          <div className="mt-2.5 flex items-center justify-end">
            <button
              onClick={saveNote}
              disabled={savingNote || !note.trim()}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-slate-200 disabled:text-slate-400 text-white text-[12.5px] font-semibold shadow-sm transition-colors"
            >
              <FilePlus size={13} /> {savingNote ? "Saving…" : "Add note"}
            </button>
          </div>
        </Card>
      </div>

      {/* Right: resume preview */}
      <div className="lg:col-span-2">
        <Card title={c.resumeFileName ?? "Resume"} action={
          resumeHref && (
            <a href={resumeHref} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#3b82f6] hover:underline">
              Open <ExternalLink size={11} />
            </a>
          )
        }>
          {!resumeHref ? (
            <ResumeEmptyState />
          ) : isPdf ? (
            // <iframe> is more reliable than <object> for PDF previews
            // — Chrome / Brave routinely fall through <object> to its
            // children even when the resource is fetchable. The
            // iframe pins toolbar=0 so the browser's PDF chrome
            // doesn't fight the card design.
            //
            // Sizing: container uses A4 portrait aspect (1 : 1.414)
            // capped at 80vh so the resume looks like a document
            // rather than a stretched textbox, on any screen. The
            // PDF URL hint `zoom=page-width` makes Chrome's viewer
            // fit the page width to the iframe — keeps the rendering
            // consistent across narrow and wide columns.
            <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50 shadow-sm">
              <div
                className="relative w-full mx-auto bg-white"
                style={{
                  aspectRatio: "1 / 1.414",
                  maxHeight: "80vh",
                  // When the height is clamped by maxHeight on tall
                  // viewports, calc the matching width so the page
                  // stays centred and proportional rather than left-
                  // anchored with empty bands.
                  maxWidth: "min(100%, calc(80vh / 1.414))",
                }}
              >
                <iframe
                  src={`${resumeHref}#toolbar=0&navpanes=0&scrollbar=1&view=FitH&zoom=page-width`}
                  title={c.resumeFileName || "Resume"}
                  className="absolute inset-0 w-full h-full bg-white block"
                  style={{ border: 0 }}
                />
              </div>
              <noscript>
                <ResumeFallbackCard href={resumeHref} name={c.resumeFileName} />
              </noscript>
            </div>
          ) : (
            <ResumeFallbackCard href={resumeHref} name={c.resumeFileName} />
          )}
        </Card>
      </div>
    </div>
  );
}

function fmtExperience(
  years: number | null | undefined,
  monthsArg?: number | null,
): string {
  // The apply form captures years + months as separate integer
  // columns. Older legacy rows might only have a fractional
  // experienceYears value — handle both shapes.
  // Uses full words ("Year"/"Years"/"Month"/"Months") instead of
  // shorthand y/m so the chip reads naturally: "10 Months",
  // "1 Year 6 Months", etc.
  const yLabel = (n: number) => `${n} ${n === 1 ? "Year"  : "Years"}`;
  const mLabel = (n: number) => `${n} ${n === 1 ? "Month" : "Months"}`;

  const y = Number.isFinite(years as number) ? Number(years) : null;
  const m = Number.isFinite(monthsArg as number) ? Number(monthsArg) : null;
  if (y == null && m == null) return "—";
  // Smart-form shape: integers in their own columns.
  if (y != null && Number.isInteger(y) && m != null) {
    if (y === 0 && m === 0) return "—";
    const parts: string[] = [];
    if (y > 0) parts.push(yLabel(y));
    if (m > 0) parts.push(mLabel(m));
    return parts.join(" ");
  }
  // Years-only path: integer years, fall back to "X Years" if no months info.
  if (y != null && (m == null || m === 0)) {
    if (y === 0) return "—";
    if (Number.isInteger(y)) return yLabel(y);
    const whole = Math.floor(y);
    const monthsFromFrac = Math.round((y - whole) * 12);
    return monthsFromFrac
      ? `${yLabel(whole)} ${mLabel(monthsFromFrac)}`
      : yLabel(whole);
  }
  // Months-only path (years is null/0, months > 0).
  if (m != null && m > 0) return mLabel(m);
  return "—";
}

// Best-effort parser for the JSON-string columns the apply form writes
// (experienceDetails, educationDetails). Returns [] on any failure so
// the Profile tab degrades gracefully when the value is missing or
// malformed (legacy rows, hand-edits in the DB, etc.).
// Inline editor for the Education section. Read-only by default;
// HR clicks "Edit" to enter add/edit/remove mode, then "Save" to
// commit to the DB. Used when the resume auto-parser produces
// garbage (a bullet from the wrong section gets tagged as a
// degree) or misses entries entirely — common with non-standard
// resume templates and OCR-recovered scans.
function EducationEditor({
  candidateId, entries,
}: { candidateId: number; entries: EducationEntry[] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState<EducationEntry[]>(entries);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  // Re-seed the draft whenever the parent's entries change (e.g.
  // after a SWR refetch). We deliberately DON'T blow away the
  // draft mid-edit even if the server data shifts underneath.
  useEffect(() => { if (!editing) setDraft(entries); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [JSON.stringify(entries)]);
  const cancel = () => { setDraft(entries); setEditing(false); setError(null); };
  const updateRow = (idx: number, patch: Partial<EducationEntry>) =>
    setDraft((d) => d.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  const removeRow = (idx: number) =>
    setDraft((d) => d.filter((_, i) => i !== idx));
  const addRow = () =>
    setDraft((d) => [...d, { course: "", branch: "", startOfCourse: "", endOfCourse: "", university: "", location: "" }]);
  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/hr/hiring/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateEducation", entries: draft }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Save failed (${res.status})`);
      }
      setEditing(false);
      globalMutate(`/api/hr/hiring/candidates/${candidateId}`);
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally { setSaving(false); }
  };

  if (!editing) {
    return (
      <>
        {entries.length === 0 ? (
          <p className="text-[12.5px] text-slate-400 italic">
            No education details on file. Click <span className="font-semibold">Edit</span> to add manually.
          </p>
        ) : (
          <ul className="space-y-3">
            {entries.map((e, i) => (
              <li key={`edu-${i}`} className="rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
                <p className="text-[13px] font-semibold text-slate-800">
                  {e.course || "—"}
                  {e.branch ? <span className="text-slate-500 font-medium"> · {e.branch}</span> : null}
                </p>
                <p className="mt-0.5 text-[11.5px] text-slate-500">
                  {e.university || ""}
                  {e.university && e.location ? <span className="text-slate-400"> · {e.location}</span> : null}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {fmtDateRange(e.startOfCourse, e.endOfCourse, false)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-3 inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-slate-200 hover:border-slate-300 text-[11.5px] font-semibold text-slate-700"
        >Edit education</button>
      </>
    );
  }

  return (
    <div className="space-y-3">
      {draft.length === 0 ? (
        <p className="text-[12.5px] text-slate-400 italic">No entries yet — click "Add education" to begin.</p>
      ) : (
        draft.map((e, i) => (
          <div key={`edu-edit-${i}`} className="rounded-lg border border-slate-200 bg-white px-3.5 py-3 space-y-2 relative">
            <button
              type="button"
              onClick={() => removeRow(i)}
              title="Remove this entry"
              className="absolute top-2 right-2 text-slate-400 hover:text-rose-500 h-5 w-5 inline-flex items-center justify-center"
            >×</button>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Degree / Course"   value={e.course || ""}        onChange={(v) => updateRow(i, { course: v })}        placeholder="e.g. Bachelor of Engineering" />
              <Field label="Branch / Major"    value={e.branch || ""}        onChange={(v) => updateRow(i, { branch: v })}        placeholder="e.g. Computer Science" />
              <Field label="University / Institution" value={e.university || ""}    onChange={(v) => updateRow(i, { university: v })}    placeholder="e.g. Punjab Engineering College" />
              <Field label="Location"          value={e.location || ""}      onChange={(v) => updateRow(i, { location: v })}      placeholder="e.g. Chandigarh, India" />
              <Field label="Start"             value={e.startOfCourse || ""} onChange={(v) => updateRow(i, { startOfCourse: v })} placeholder="e.g. 2020" />
              <Field label="End"               value={e.endOfCourse || ""}   onChange={(v) => updateRow(i, { endOfCourse: v })}   placeholder="e.g. 2024 or Present" />
            </div>
          </div>
        ))
      )}
      <button
        type="button"
        onClick={addRow}
        className="w-full h-8 rounded-md border border-dashed border-slate-300 hover:border-[#3b82f6] hover:bg-[#3b82f6]/[0.04] text-[12px] font-semibold text-slate-600"
      >+ Add education</button>
      {error && <p className="text-[11.5px] text-rose-600">{error}</p>}
      <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="h-7 px-3 rounded-md text-[11.5px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        >Cancel</button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="h-7 px-3 rounded-md bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[11.5px] font-semibold disabled:opacity-50"
        >{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

// Inline editor for the Skills section. Pill chips with × to
// remove, "Add skill" text input that splits on Enter / comma so
// HR can paste a comma-separated list and have it expand into
// individual chips. Save / Cancel on the bottom.
function SkillsEditor({
  candidateId, initialSkills,
}: { candidateId: number; initialSkills: string[] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState<string[]>(initialSkills);
  const [input, setInput]     = useState("");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  useEffect(() => { if (!editing) setDraft(initialSkills); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [JSON.stringify(initialSkills)]);

  const addFromInput = () => {
    // Split on commas / semicolons / newlines so HR can paste a
    // bullet list ("HR Policy, Recruitment, Engagement") and have
    // it expand into separate chips in one keystroke.
    const parts = input.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    setDraft((d) => {
      const seen = new Set(d.map((x) => x.toLowerCase()));
      const fresh: string[] = [];
      for (const p of parts) {
        if (!seen.has(p.toLowerCase())) { fresh.push(p); seen.add(p.toLowerCase()); }
      }
      return [...d, ...fresh];
    });
    setInput("");
  };
  const removeAt = (idx: number) => setDraft((d) => d.filter((_, i) => i !== idx));
  const cancel = () => { setDraft(initialSkills); setInput(""); setEditing(false); setError(null); };
  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/hr/hiring/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateSkills", skills: draft }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Save failed (${res.status})`);
      }
      setEditing(false);
      setInput("");
      globalMutate(`/api/hr/hiring/candidates/${candidateId}`);
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally { setSaving(false); }
  };

  if (!editing) {
    return (
      <>
        {initialSkills.length === 0 ? (
          <p className="text-[12.5px] text-slate-400 italic">
            No skills captured. Click <span className="font-semibold">Edit skills</span> to add manually.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {initialSkills.map((s, i) => (
              <span
                key={`${s}-${i}`}
                className="inline-flex items-center rounded-full bg-[#3b82f6]/10 text-[#1d4ed8] px-2.5 py-0.5 text-[12px] font-semibold"
              >{s}</span>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-3 inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-slate-200 hover:border-slate-300 text-[11.5px] font-semibold text-slate-700"
        >Edit skills</button>
      </>
    );
  }

  return (
    <div className="space-y-2.5">
      {draft.length === 0 ? (
        <p className="text-[12px] text-slate-400 italic">No skills yet — type a skill below and press Enter.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {draft.map((s, i) => (
            <span
              key={`draft-${i}`}
              className="inline-flex items-center gap-1 rounded-full bg-[#3b82f6]/10 text-[#1d4ed8] pl-2.5 pr-1 py-0.5 text-[12px] font-semibold"
            >
              {s}
              <button
                type="button"
                onClick={() => removeAt(i)}
                title="Remove"
                className="h-4 w-4 inline-flex items-center justify-center rounded-full hover:bg-[#3b82f6]/15"
              >×</button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addFromInput(); }
        }}
        onBlur={addFromInput}
        placeholder="Type a skill and press Enter (or paste comma-separated list)"
        className="w-full h-8 px-2.5 border border-slate-200 rounded-md text-[12.5px] bg-white text-slate-800 focus:outline-none focus:border-[#3b82f6]"
      />
      {error && <p className="text-[11.5px] text-rose-600">{error}</p>}
      <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="h-7 px-3 rounded-md text-[11.5px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        >Cancel</button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="h-7 px-3 rounded-md bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[11.5px] font-semibold disabled:opacity-50"
        >{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

// Compact labelled input — shared by every cell in EducationEditor.
function Field({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] uppercase tracking-wider font-semibold text-slate-500 mb-1">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-8 px-2.5 border border-slate-200 rounded-md text-[12.5px] bg-white text-slate-800 focus:outline-none focus:border-[#3b82f6]"
      />
    </label>
  );
}

function parseJsonList<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch { return []; }
}

const fmtShortDate = (iso?: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

// "Aug 2023 — May 2026" / "Sep 2025 — Present" / "May 2026" (single).
function fmtDateRange(
  start?: string | null,
  end?: string | null,
  current?: boolean,
): string {
  const s = fmtShortDate(start);
  const e = current ? "Present" : fmtShortDate(end);
  if (!s && !e) return "";
  if (!e) return s;
  if (!s) return e;
  return `${s} — ${e}`;
}

function Section({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={last ? "" : "pb-4 mb-4 border-b border-slate-100"}>
      <p className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-slate-500 mb-2">{title}</p>
      {children}
    </div>
  );
}

function ResumeEmptyState() {
  return (
    <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 py-12 px-6 text-center">
      <FileText size={28} className="mx-auto text-slate-300 mb-3" />
      <p className="text-[12.5px] font-semibold text-slate-700">No resume on file</p>
      <p className="text-[11px] text-slate-500 mt-1 max-w-xs mx-auto">
        Once the candidate uploads a resume on the apply form, it'll preview here.
      </p>
    </div>
  );
}

function ResumeFallbackCard({ href, name }: { href: string; name: string | null | undefined }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="block rounded-xl border border-slate-200 bg-slate-50 p-5 hover:border-[#3b82f6] hover:bg-blue-50/30 transition-colors text-center">
      <FileText size={28} className="mx-auto text-slate-400 mb-3" />
      <p className="text-[13px] font-semibold text-[#3b82f6] break-all">{name ?? "Open resume"}</p>
      <p className="text-[11px] text-slate-500 mt-1">Click to open in new tab</p>
    </a>
  );
}

function DocumentsTab({ c }: { c: Candidate }) {
  const items = [
    safeUrl(c.resumeUrl) && { label: c.resumeFileName ?? "Resume", url: safeUrl(c.resumeUrl)! },
  ].filter(Boolean) as { label: string; url: string }[];
  return (
    <Card title="Documents">
      {items.length === 0 ? (
        <p className="text-[12px] text-slate-400 italic">No documents on file.</p>
      ) : (
        <div className="space-y-2">
          {items.map((d) => (
            <a key={d.url} href={d.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:border-[#3b82f6] transition-colors">
              <span className="inline-flex items-center gap-2 min-w-0">
                <FileText size={14} className="text-slate-400 shrink-0" />
                <span className="text-[12.5px] font-medium text-slate-800 truncate">{d.label}</span>
              </span>
              <ExternalLink size={13} className="text-slate-400" />
            </a>
          ))}
        </div>
      )}
    </Card>
  );
}

function ActivityTab({ activity, interviews }: { activity: any[]; interviews: any[] }) {
  // Merge timeline: interviews + activity, newest first.
  const merged = [
    ...activity.map((a) => ({ kind: "activity", at: a.createdAt, label: a.summary, sub: a.kind })),
    ...interviews.map((i) => ({ kind: "interview", at: i.scheduledAt ?? i.createdAt, label: `${i.title} (${i.status})`, sub: i.location })),
  ].sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());

  return (
    <Card title="Activity">
      {merged.length === 0 ? (
        <p className="text-[12px] text-slate-400 italic">No activity yet.</p>
      ) : (
        <ol className="relative border-l-2 border-slate-100 ml-2 space-y-3">
          {merged.map((m, i) => (
            <li key={i} className="pl-4 -ml-1.5 relative">
              <span className="absolute left-0 top-1.5 -translate-x-1/2 h-2.5 w-2.5 rounded-full bg-[#3b82f6] ring-2 ring-white" />
              <p className="text-[12.5px] font-semibold text-slate-800">{m.label}</p>
              {m.sub && <p className="text-[11px] text-slate-500">{m.sub}</p>}
              <p className="text-[10.5px] text-slate-400 mt-0.5">
                {m.at ? new Date(m.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function StubTabPanel({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
      <Construction size={28} className="mx-auto text-slate-300 mb-3" />
      <h3 className="text-[14px] font-semibold text-slate-800">{title}</h3>
      <p className="text-[12px] text-slate-500 mt-1 max-w-md mx-auto">{desc}</p>
    </div>
  );
}

function Card({
  title, children, action,
}: { title?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 mb-3.5">
          {title && <h3 className="text-[13px] font-semibold text-slate-800">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// Keka-style info chip: small tinted circle holding an icon, then a
// two-line label/value stack. Tone drives the icon-circle background
// so amber/emerald/etc. cards stand out without shouting.
function InfoChip({
  Icon, tone, label, value,
}: {
  Icon: any;
  tone: "amber" | "slate" | "orange" | "emerald";
  label: string;
  value: string;
}) {
  const TONES: Record<string, string> = {
    amber:   "bg-amber-50 text-amber-600 ring-1 ring-amber-200/60",
    slate:   "bg-slate-100 text-slate-500 ring-1 ring-slate-200/70",
    orange:  "bg-orange-50 text-orange-600 ring-1 ring-orange-200/60",
    emerald: "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200/60",
  };
  return (
    <div className="flex items-start gap-3 min-w-0">
      <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full shrink-0 ${TONES[tone]}`}>
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-500 leading-tight">{label}</p>
        <p className="text-[13.5px] font-semibold text-slate-900 mt-1 truncate">{value}</p>
      </div>
    </div>
  );
}

// Brand SVG glyphs — lucide-react removed these. Each is a single
// path scaled to a 14×14 box. Renders inside a 28×28 grey circle so
// the row reads as a consistent strip.
function BrandIcon({
  kind, href,
}: {
  kind: "skype" | "linkedin" | "facebook" | "twitter" | "google" | "globe";
  href: string | null;
}) {
  const PATHS: Record<string, string> = {
    skype:    "M19.39 12c0-.39-.04-.78-.1-1.16a4.16 4.16 0 0 0 .55-2.07 4.18 4.18 0 0 0-4.18-4.18c-.74 0-1.45.2-2.06.55a7.36 7.36 0 0 0-8.83 8.84 4.17 4.17 0 0 0 3.62 6.24c.74 0 1.45-.2 2.06-.55a7.36 7.36 0 0 0 8.83-8.83c.06-.28.11-.56.11-.84zm-7.31 5.36c-2.45 0-3.55-1.2-3.55-2.1 0-.46.34-.78.8-.78 1.03 0 .76 1.48 2.75 1.48 1.02 0 1.58-.56 1.58-1.13 0-.34-.17-.72-.83-.88l-2.2-.55c-1.78-.45-2.1-1.4-2.1-2.3 0-1.86 1.76-2.56 3.4-2.56 1.52 0 3.3.83 3.3 1.94 0 .48-.41.76-.88.76-.88 0-.72-1.22-2.55-1.22-.92 0-1.43.42-1.43 1.02 0 .6.74.79 1.4.94l1.63.36c1.79.4 2.24 1.46 2.24 2.45 0 1.51-1.16 2.57-3.56 2.57z",
    linkedin: "M20.45 20.45h-3.55v-5.57c0-1.32-.03-3.03-1.85-3.03-1.85 0-2.13 1.45-2.13 2.94v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43A2.06 2.06 0 0 1 3.28 5.37a2.06 2.06 0 1 1 4.12 0 2.06 2.06 0 0 1-2.06 2.06zM7.12 20.45H3.55V9h3.57v11.45z",
    facebook: "M22.67 12.07C22.67 6.07 17.8 1.2 11.8 1.2S.93 6.07.93 12.07c0 5.42 3.97 9.92 9.16 10.74v-7.6H7.34v-3.14h2.75V9.6c0-2.72 1.62-4.22 4.1-4.22 1.18 0 2.43.21 2.43.21v2.67H15.3c-1.35 0-1.77.84-1.77 1.7v2.04h3.01l-.48 3.14h-2.53v7.6c5.19-.82 9.14-5.32 9.14-10.74z",
    twitter:  "M17.66 4.5h2.81l-6.13 7.01 7.22 9.55h-5.66l-4.43-5.79-5.06 5.79H3.6l6.56-7.5L3.27 4.5h5.8l4 5.3 4.59-5.3zm-.99 14.62h1.56L7.45 6.07H5.78z",
    google:   "M21.35 12.27c0-.81-.07-1.43-.22-2.07h-9.13v3.75h5.36c-.11.95-.71 2.4-2.03 3.36l-.02.13 2.94 2.27.2.02c1.87-1.73 2.9-4.27 2.9-7.46z M11.99 21.66c2.69 0 4.95-.88 6.6-2.4l-3.15-2.43c-.84.59-1.97 1-3.45 1a5.98 5.98 0 0 1-5.66-4.13l-.12.01-3.04 2.36-.04.12a9.92 9.92 0 0 0 8.86 5.47z M6.34 13.7a6.1 6.1 0 0 1 0-3.85V7.34l-.05-.03L3.2 4.85l-.1.05A9.93 9.93 0 0 0 2 12c0 1.6.39 3.1 1.1 4.43l3.24-2.74z M11.99 5.78c1.8 0 3.02.78 3.71 1.43l2.7-2.64A9.55 9.55 0 0 0 11.99 2 9.93 9.93 0 0 0 3.1 7.42l3.24 2.51a5.99 5.99 0 0 1 5.65-4.15z",
    globe:    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.91 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a7.84 7.84 0 0 1 0-4h3.38c-.16 1.32-.16 2.68 0 4H4.26zm.82 2h2.95a15.65 15.65 0 0 0 1.38 3.56A8.03 8.03 0 0 1 5.08 16zm2.95-8H5.08a8.03 8.03 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82a13.7 13.7 0 0 1-1.91 3.96zM14.34 14H9.66c-.18-1.32-.18-2.68 0-4h4.68c.18 1.32.18 2.68 0 4zm.25 5.56c.65-1.07 1.14-2.27 1.46-3.56h2.87a8.03 8.03 0 0 1-4.33 3.56zM16.36 14c.16-1.32.16-2.68 0-4h3.38a7.84 7.84 0 0 1 0 4h-3.38z",
  };
  const TITLES: Record<string, string> = {
    skype: "Skype", linkedin: "LinkedIn", facebook: "Facebook",
    twitter: "X / Twitter", google: "Google", globe: "Website",
  };
  const disabled = !href;
  const base = "h-7 w-7 inline-flex items-center justify-center rounded-full transition-colors";
  const inner = (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d={PATHS[kind]} />
    </svg>
  );
  if (disabled) {
    return (
      <span className={`${base} bg-slate-100 text-slate-300`} title={`${TITLES[kind]} (not on file)`}>
        {inner}
      </span>
    );
  }
  return (
    <a href={href!} target="_blank" rel="noopener noreferrer" title={TITLES[kind]}
      className={`${base} bg-slate-100 text-slate-600 hover:bg-[#3b82f6] hover:text-white`}>
      {inner}
    </a>
  );
}

// Lightweight quick-email modal — separate from the unified
// CandidateActionModal so we can mount it without changing the
// parent state shape.
