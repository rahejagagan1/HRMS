"use client";
import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { Loader2, Pencil, X, ChevronDown, FileText, ShieldCheck, GraduationCap, BriefcaseBusiness, History, FolderClosed, Sparkles, CheckCircle2 } from "lucide-react";
import { DatePicker as SharedDatePicker } from "@/components/ui/date-picker";
import SelectField from "@/components/ui/SelectField";

// Doc folder taxonomy + categories that land in each. Mirrors the
// HR-side DocumentsPanel so the two views stay consistent. See
// the matching DOC_FOLDERS / CAT_LABEL_OVERRIDES in
// /dashboard/hr/people/[id]/page.tsx for the rationale.
// Folder taxonomy for the SELF view. "employee_letter" — the
// category the HR Letter Templates page auto-saves to when HR
// clicks "Generate PDF" — lands in the "Other" folder so the
// employee can find every letter HR has issued them in one place
// (FnF, Probation Confirmation, Relieving, Revised Offer, etc.).
// Owner-readable subtitle + icon are paired with each entry to
// make the sidebar self-documenting.
type SelfDocFolder = {
  key:       string;
  label:     string;
  subtitle:  string;
  Icon:      typeof FileText;
  cats:      string[];
};
const SELF_DOC_FOLDERS: SelfDocFolder[] = [
  { key: "identity",  label: "Identity Documents", subtitle: "PAN, Aadhaar, Passport, Driving License",   Icon: ShieldCheck, cats: ["pan_card", "aadhar", "passport", "driving_license"] },
  { key: "education", label: "Education",          subtitle: "Degrees, marksheets, transcripts",          Icon: GraduationCap, cats: ["education_certificate"] },
  { key: "letters",   label: "Employment Letters", subtitle: "Offer letter, contract",                    Icon: BriefcaseBusiness, cats: ["offer_letter"] },
  { key: "previous",  label: "Previous Experience",subtitle: "Relieving / offer from prior employers",    Icon: History, cats: ["previous_relieving_letter", "previous_offer_letter"] },
  { key: "other",     label: "Other Documents",    subtitle: "Generated HR letters & misc uploads",       Icon: FolderClosed, cats: ["other", "employee_letter"] },
];

const CAT_LABEL_OVERRIDES: Record<string, string> = {
  pan_card:                  "PAN Card",
  aadhar:                    "Aadhaar",
  passport:                  "Passport",
  driving_license:           "Driving License",
  education_certificate:     "Degree/marksheet",
  offer_letter:              "Offer Letter",
  previous_relieving_letter: "Previous Relieving Letter",
  previous_offer_letter:     "Previous Offer Letter",
  // legacy keys kept so old uploads still render readably
  id_proof:                  "ID Proof",
  voter_id:                  "Voter ID",
  tenth:                     "10th",
  twelfth:                   "12th",
  degree:                    "Degree",
  experience_letter:         "Experience Letter",
  contract:                  "Contract",
  payslip:                   "Payslip",
};
const REQUIRED_CATS = new Set<string>([
  "pan_card", "aadhar", "education_certificate", "offer_letter",
]);
const OPTIONAL_HINT: Record<string, string> = {
  passport:                  "optional",
  driving_license:           "optional",
  previous_relieving_letter: "if available",
  previous_offer_letter:     "if available",
};
const prettyCategory = (c: string): string =>
  CAT_LABEL_OVERRIDES[c]
    ?? c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
const dropdownCategoryLabel = (c: string): string => {
  const base = prettyCategory(c);
  if (REQUIRED_CATS.has(c)) return `${base} *`;
  if (OPTIONAL_HINT[c])      return `${base} (${OPTIONAL_HINT[c]})`;
  return base;
};

const F = "w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]";

const PROFILE_TABS = ["ABOUT", "PROFILE", "JOB", "DOCUMENTS", "ASSETS"] as const;
type ProfileTab = typeof PROFILE_TABS[number];

// Reusable doc row — emerald accent for HR-issued letters,
// blue accent for the employee's own uploads.
function DocCard({ doc, accent, onDelete }: {
  doc: any;
  accent: "emerald" | "blue";
  onDelete: (doc: any) => void;
}) {
  const isEmerald = accent === "emerald";
  return (
    <div
      className={`group flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
        isEmerald
          ? "border-emerald-200 bg-emerald-50/30 hover:border-emerald-300"
          : "border-slate-200 bg-white hover:border-[#008CFF]/40"
      }`}
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
        isEmerald ? "bg-emerald-500/10 text-emerald-700" : "bg-[#008CFF]/10 text-[#008CFF]"
      }`}>
        <FileText size={16} />
      </div>
      <a
        href={doc.fileUrl?.startsWith("http") ? doc.fileUrl : `/api/hr/documents/${doc.id}/file`}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 cursor-pointer"
      >
        <p className="truncate text-[13px] font-semibold text-slate-800">{doc.fileName || "Untitled"}</p>
        <p className="truncate text-[11px] text-slate-500">
          {isEmerald ? "Generated" : (doc.category ? doc.category.replace(/_/g, " ") : "Document")}
          {doc.createdAt ? ` · ${new Date(doc.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : ""}
        </p>
      </a>
      <button
        type="button"
        onClick={() => onDelete(doc)}
        title="Delete"
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-slate-400 hover:text-rose-500"
      >
        <X size={16} />
      </button>
    </div>
  );
}

function EditModal({ title, fields, values, onSave, onClose }: {
  title: string;
  fields: { key: string; label: string; type?: string; options?: string[]; min?: string; max?: string; fullWidth?: boolean; readOnly?: boolean; maxLength?: number; inputMode?: "numeric" | "text"; placeholder?: string; transform?: (v: string) => string }[];
  values: Record<string, string>;
  onSave: (v: Record<string, string>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>(values);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.08] rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
          <h3 className="text-[15px] font-semibold text-slate-800 dark:text-white">{title}</h3>
          <button onClick={onClose}><X size={18} className="text-slate-400 hover:text-slate-700 dark:hover:text-white" /></button>
        </div>
        <div className="px-6 py-5 grid grid-cols-2 gap-4">
          {fields.map(f => (
            <div key={f.key} className={f.fullWidth || f.type === "dob" ? "col-span-2" : ""}>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">{f.label}</label>
              {f.type === "dob" ? (
                <SharedDatePicker value={form[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
              ) : f.options ? (
                <SelectField
                  value={form[f.key] ?? ""}
                  onChange={(v) => set(f.key, v)}
                  options={f.options}
                  placeholder="Select…"
                  className={F}
                />
              ) : (
                <input
                  type={f.type ?? "text"}
                  value={form[f.key] ?? ""}
                  onChange={e => set(f.key, f.transform ? f.transform(e.target.value) : (f.type === "email" ? e.target.value.toLowerCase() : e.target.value))}
                  min={f.min}
                  max={f.max}
                  maxLength={f.maxLength}
                  inputMode={f.inputMode}
                  placeholder={f.placeholder}
                  readOnly={f.readOnly}
                  onClick={(e) => { if (f.type === "date" && !f.readOnly) (e.currentTarget as HTMLInputElement).showPicker?.(); }}
                  onFocus={(e) => { if (f.type === "date" && !f.readOnly) (e.currentTarget as HTMLInputElement).showPicker?.(); }}
                  className={`${F} ${f.readOnly ? "bg-slate-50 dark:bg-white/[0.02] text-slate-500 cursor-not-allowed" : ""}`}
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-white/[0.06]">
          <button onClick={onClose} className="h-9 px-4 text-[13px] text-slate-500 hover:text-slate-800 dark:text-white">Cancel</button>
          <button onClick={async () => {
              setSaving(true);
              // Strip read-only / underscore-prefixed display-only fields
              // (e.g. `_workEmail`) so they aren't sent to the API.
              const ro = new Set(fields.filter((f) => f.readOnly).map((f) => f.key));
              const cleaned: Record<string, string> = {};
              for (const k of Object.keys(form)) {
                if (k.startsWith("_") || ro.has(k)) continue;
                cleaned[k] = form[k];
              }
              await onSave(cleaned);
              setSaving(false);
              onClose();
            }}
            disabled={saving} className="h-9 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold disabled:opacity-50">
            {saving ? "Saving…" : "Update"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { data: session } = useSession();
  const { data: profile, isLoading } = useSWR("/api/hr/profile", fetcher);
  // Today's attendance — drives the live status pill in the header so
  // the badge actually reflects whether the user is clocked in / out /
  // missed clock-out / on leave instead of always showing "NOT IN YET".
  const { data: attendance } = useSWR<{ todayRecord?: any }>(
    "/api/hr/attendance",
    fetcher,
    { refreshInterval: 60_000 },
  );
  const today = attendance?.todayRecord;
  const hasOpenSession = Array.isArray(today?.sessions)
    ? today.sessions.some((s: any) => !s.clockOut)
    : !!(today?.clockIn && !today?.clockOut);
  const totalMins = Number(today?.totalMinutes ?? 0);
  const headerStatus: { label: string; cls: string } = (() => {
    if (today?.status === "on_leave")          return { label: "ON LEAVE",       cls: "bg-violet-500/10 text-violet-600 border-violet-200 dark:border-violet-500/20" };
    if (today?.status === "holiday")           return { label: "HOLIDAY",        cls: "bg-amber-500/10 text-amber-600 border-amber-200 dark:border-amber-500/20" };
    if (today?.status === "weekend")           return { label: "WEEKLY OFF",     cls: "bg-slate-400/15 text-slate-600 border-slate-200 dark:border-slate-500/20" };
    if (today?.status === "missed_clock_out")  return { label: "MISSED CLOCK-OUT", cls: "bg-amber-500/10 text-amber-600 border-amber-200 dark:border-amber-500/20" };
    if (hasOpenSession)                        return { label: "CLOCKED IN",     cls: "bg-emerald-500/10 text-emerald-600 border-emerald-200 dark:border-emerald-500/20" };
    if (today?.clockIn && totalMins >= 540)    return { label: "DAY COMPLETE",   cls: "bg-emerald-500/10 text-emerald-600 border-emerald-200 dark:border-emerald-500/20" };
    if (today?.clockIn && today?.clockOut)     return { label: "ON BREAK",       cls: "bg-slate-400/15 text-slate-700 border-slate-200 dark:border-slate-500/20" };
    return { label: "NOT IN YET", cls: "bg-red-500/10 text-red-500 border-red-200 dark:border-red-500/20" };
  })();
  const [tab, setTab] = useState<ProfileTab>("ABOUT");

  // Deep-link support: "Me → My Space → Documents" links here with
  // ?tab=DOCUMENTS so it opens straight on the folder-based documents
  // view. Reactive to query changes so it works even when already on
  // this page (client-side nav doesn't remount).
  const searchParams = useSearchParams();
  useEffect(() => {
    const t = searchParams.get("tab")?.toUpperCase();
    if (t && (PROFILE_TABS as readonly string[]).includes(t)) {
      setTab(t as ProfileTab);
    }
  }, [searchParams]);

  // Persist whether the user has ever opened the PROFILE tab so the red
  // "incomplete profile" dot can be cleared once acknowledged. Lives in
  // localStorage (per-browser; not synced across devices) — that's the
  // right scope for a "you've seen this" indicator.
  const PROFILE_SEEN_KEY = "nbm:profile-tab-seen";
  const [profileSeen, setProfileSeen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(PROFILE_SEEN_KEY) === "1") setProfileSeen(true);
  }, []);
  // Mark as seen the moment the user actually opens the PROFILE tab.
  useEffect(() => {
    if (tab !== "PROFILE" || profileSeen) return;
    setProfileSeen(true);
    try { window.localStorage.setItem(PROFILE_SEEN_KEY, "1"); } catch {}
  }, [tab, profileSeen]);
  const [editModal, setEditModal] = useState<null | "primary" | "contact" | "address" | "emergency" | "family" | "photo" | "statutory">(null);
  const [bioAbout, setBioAbout] = useState("");
  const [bioLove, setBioLove]   = useState("");
  const [bioHobbies, setBioHobbies] = useState("");
  // Which bio card is currently open in the editor (null = closed).
  // Keys match the EmployeeProfile column names so the save payload
  // is just `{ [bioEditing]: text }`.
  const [bioEditing, setBioEditing] = useState<null | "about" | "jobLove" | "hobbies">(null);
  const [bioDraft, setBioDraft] = useState("");
  const [bioSaving, setBioSaving] = useState(false);
  const [bioErr, setBioErr] = useState("");

  const user = session?.user as any;
  const ep   = profile?.employeeProfile;

  const [form, setForm] = useState({
    phone: "", dateOfBirth: "", gender: "", bloodGroup: "", maritalStatus: "",
    emergencyPhone: "",
    address: "", city: "", state: "",
    profilePictureUrl: "",
    personalEmail: "", workPhone: "",
    // Family + emergency-contact — self-edited from the ABOUT tab
    // (used to be HR-onboarded).
    physicallyHandicapped: "",
    parentName: "", motherName: "", spouseName: "", childrenNames: "",
    emergencyRelationship: "",
    // Statutory IDs — self-editable by the employee. Bank details are
    // NOT held here: they're display-only (HR-set), read straight off
    // `ep` so they can never be sent back in this page's PUT.
    panNumber: "", aadhaarNumber: "",
    // Onboarding-set fields — read-only on the profile but surfaced
    // here so the UI can show them right away without a separate fetch.
    employeeId: "", firstName: "", middleName: "", lastName: "",
    designation: "", department: "", workLocation: "", employmentType: "",
    joiningDate: "", workCountry: "", nationality: "",
  });

  useEffect(() => {
    if (profile) {
      const p = profile.employeeProfile ?? {};
      // Dates come back as ISO strings or Date — coerce to YYYY-MM-DD.
      const dateISO = (v: any): string => {
        if (!v) return "";
        const s = typeof v === "string" ? v : new Date(v).toISOString();
        return s.slice(0, 10);
      };
      setForm({
        phone: p.phone ?? "", workPhone: p.workPhone ?? "", personalEmail: p.personalEmail ?? "",
        dateOfBirth: dateISO(p.dateOfBirth),
        gender: p.gender ?? "", bloodGroup: p.bloodGroup ?? "", maritalStatus: p.maritalStatus ?? "",
        emergencyPhone: p.emergencyPhone ?? "",
        address: p.address ?? "", city: p.city ?? "", state: p.state ?? "",
        profilePictureUrl: profile.profilePictureUrl ?? "",
        // Family + emergency (self-edited from the ABOUT tab). The
        // legacy column for "Father Name" is `parentName`.
        physicallyHandicapped: p.physicallyHandicapped ?? "",
        parentName: p.parentName ?? "",
        motherName: p.motherName ?? "",
        spouseName: p.spouseName ?? "",
        childrenNames: p.childrenNames ?? "",
        emergencyRelationship: p.emergencyRelationship ?? "",
        panNumber: p.panNumber ?? "", aadhaarNumber: p.aadhaarNumber ?? "",
        // Onboarding-set fields straight from the EmployeeProfile row.
        employeeId: p.employeeId ?? "",
        firstName: p.firstName ?? "", middleName: p.middleName ?? "", lastName: p.lastName ?? "",
        designation: p.designation ?? "", department: p.department ?? "",
        workLocation: p.workLocation ?? "", employmentType: p.employmentType ?? "",
        joiningDate: dateISO(p.joiningDate),
        workCountry: p.workCountry ?? "", nationality: p.nationality ?? "",
      });
      // Hydrate the ABOUT-tab bios from the EmployeeProfile row. Stored
      // as NULL when blank, so coerce to "" for the UI's empty state.
      setBioAbout(p.about ?? "");
      setBioLove(p.jobLove ?? "");
      setBioHobbies(p.hobbies ?? "");
    }
  }, [profile]);

  const bioConfig: Record<"about" | "jobLove" | "hobbies", { title: string; placeholder: string; current: string }> = {
    about:   { title: "About",                       placeholder: "Tell your team a bit about yourself…",       current: bioAbout },
    jobLove: { title: "What I love about my job?",   placeholder: "Share what excites you about your role…",   current: bioLove },
    hobbies: { title: "My interests and hobbies",    placeholder: "Movies, music, sports, side projects…",     current: bioHobbies },
  };

  const openBioEditor = (key: "about" | "jobLove" | "hobbies") => {
    setBioErr("");
    setBioDraft(bioConfig[key].current);
    setBioEditing(key);
  };

  const saveBio = async () => {
    if (!bioEditing) return;
    setBioErr("");
    setBioSaving(true);
    const key = bioEditing;
    const value = bioDraft;
    try {
      const res = await fetch("/api/hr/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let err: any = {};
        try { err = JSON.parse(text); } catch {}
        throw new Error(err.error || text.slice(0, 200) || res.statusText);
      }
      // Optimistic local state — also re-fetch so the new value
      // comes from the DB on the next render.
      if (key === "about")   setBioAbout(value);
      if (key === "jobLove") setBioLove(value);
      if (key === "hobbies") setBioHobbies(value);
      await mutate("/api/hr/profile", undefined, { revalidate: true });
      setBioEditing(null);
    } catch (e: any) {
      setBioErr(e?.message || "Failed to save");
    } finally {
      setBioSaving(false);
    }
  };

  const save = async (patch: Record<string, string>) => {
    const merged = { ...form, ...patch };
    setForm(merged);
    // Combine firstName + lastName into displayName for the backend.
    // User.name (the org-wide display name) is the only thing the API
    // stores — first/last are just the editing surface.
    const payload: Record<string, unknown> = { ...merged };
    if (patch.firstName !== undefined || patch.lastName !== undefined) {
      const first = (patch.firstName ?? "").trim();
      const last  = (patch.lastName ?? "").trim();
      const combined = [first, last].filter(Boolean).join(" ");
      if (combined) payload.displayName = combined;
    }
    const res = await fetch("/api/hr/profile", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // Read the body twice — first as text (always works), then try JSON.
      // Empty objects in the dev console mean the body wasn't JSON.
      const text = await res.text().catch(() => "");
      let err: any = {};
      try { err = JSON.parse(text); } catch { /* leave err empty */ }
      // eslint-disable-next-line no-console
      console.error("[profile] save failed", res.status, res.statusText, "body:", text);
      alert(`Couldn't save profile (HTTP ${res.status}): ${err.error || text.slice(0, 200) || res.statusText}`);
      return;
    }
    // Force-refetch the profile so the FIRST/LAST NAME view picks up the
    // new User.name immediately. Pass `undefined` data + revalidate so SWR
    // hits the network instead of just clearing the cache.
    await mutate("/api/hr/profile", undefined, { revalidate: true });
  };

  const completeness = (() => {
    const fields = [form.phone, form.dateOfBirth, form.gender, form.bloodGroup, form.address, form.city];
    return Math.round((fields.filter(Boolean).length / fields.length) * 100);
  })();

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 text-[#008CFF] animate-spin" />
    </div>
  );

  const nameInitials = (profile?.name ?? "?").split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">

      {/* ── Hero Banner ── */}
      <div className="bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06]">
        <div className="px-6 py-5">
          <div className="flex items-start gap-5">

            {/* Avatar — falls back to Google OAuth profile picture
                (session.user.image) when the DB profilePictureUrl is empty,
                so users always see their photo without manually setting it. */}
            <div className="relative shrink-0">
              <div className="w-[72px] h-[72px] rounded-full bg-gradient-to-br from-[#008CFF] to-[#0055bb] flex items-center justify-center text-white text-[22px] font-bold overflow-hidden border-2 border-white dark:border-white/10 shadow-md">
                {(form.profilePictureUrl || user?.image)
                  ? <img src={form.profilePictureUrl || user?.image} alt={profile?.name || "Profile"} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  : nameInitials}
              </div>
            </div>

            {/* Name + info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-[20px] font-bold text-slate-800 dark:text-white tracking-tight">{profile?.name}</h1>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${headerStatus.cls}`}>
                  {headerStatus.label}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                {ep?.officeLocation && <span className="flex items-center gap-1 text-[12px] text-slate-500 dark:text-slate-400"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>{ep.officeLocation}</span>}
                <span className="flex items-center gap-1 text-[12px] text-slate-500 dark:text-slate-400"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>{profile?.email}</span>
                {form.phone && <span className="flex items-center gap-1 text-[12px] text-slate-500 dark:text-slate-400"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.948V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>{form.phone}</span>}
              </div>
            </div>

            {/* Right: job bar */}
            <div className="flex items-center gap-6 text-[12px] shrink-0">
              {ep?.designation && <div className="text-center"><p className="text-slate-400 text-[10px] uppercase tracking-wider mb-0.5">JOB TITLE</p><p className="font-semibold text-slate-800 dark:text-white">{ep.designation}</p></div>}
              {ep?.department  && <div className="text-center"><p className="text-slate-400 text-[10px] uppercase tracking-wider mb-0.5">DEPARTMENT</p><p className="font-semibold text-slate-800 dark:text-white">{ep.department}</p></div>}
              {ep?.employeeId  && <div className="text-center"><p className="text-slate-400 text-[10px] uppercase tracking-wider mb-0.5">EMP NO</p><p className="font-semibold text-slate-800 dark:text-white">{ep.employeeId}</p></div>}
              <button className="h-8 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 flex items-center gap-1">
                Actions <ChevronDown size={12} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 mt-5 border-b border-slate-200 dark:border-white/[0.06]">
            {PROFILE_TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-5 py-2.5 text-[12px] font-semibold tracking-wider border-b-2 transition-colors flex items-center gap-1.5 ${
                  tab === t ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white"
                }`}>
                {t}
                {t === "PROFILE" && completeness < 100 && !profileSeen && (
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab Content ── */}
      <div className="px-6 py-6">

        {/* ═══ ABOUT ═══ */}
        {tab === "ABOUT" && (
          <div className="grid grid-cols-[1fr_300px] gap-6">
            {/* Left */}
            <div className="space-y-5">
              {/* Summary / About */}
              <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white">About</h3>
                  <button onClick={() => openBioEditor("about")} className="text-slate-400 hover:text-[#008CFF]"><Pencil size={14} /></button>
                </div>
                {bioAbout ? (
                  <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{bioAbout}</p>
                ) : (
                  <button onClick={() => openBioEditor("about")} className="text-[13px] text-[#008CFF] hover:underline">Add your response</button>
                )}
              </div>

              <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white">What I love about my job?</h3>
                  <button onClick={() => openBioEditor("jobLove")} className="text-slate-400 hover:text-[#008CFF]"><Pencil size={14} /></button>
                </div>
                {bioLove ? (
                  <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{bioLove}</p>
                ) : (
                  <button onClick={() => openBioEditor("jobLove")} className="text-[13px] text-[#008CFF] hover:underline">Add your response</button>
                )}
              </div>

              <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white">My interests and hobbies</h3>
                  <button onClick={() => openBioEditor("hobbies")} className="text-slate-400 hover:text-[#008CFF]"><Pencil size={14} /></button>
                </div>
                {bioHobbies ? (
                  <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{bioHobbies}</p>
                ) : (
                  <button onClick={() => openBioEditor("hobbies")} className="text-[13px] text-[#008CFF] hover:underline">Add your response</button>
                )}
              </div>

              {/* Primary Details (view only on About) */}
              <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white mb-4">Primary Details</h3>
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  {[
                    { label: "FIRST NAME",    value: profile?.name?.split(" ")[0] },
                    { label: "LAST NAME",     value: profile?.name?.split(" ").slice(1).join(" ") },
                    { label: "GENDER",        value: form.gender },
                    { label: "DOB",           value: form.dateOfBirth },
                    { label: "BLOOD GROUP",   value: form.bloodGroup },
                    { label: "MARITAL STATUS",value: form.maritalStatus },
                  ].map(f => (
                    <div key={f.label}>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">{f.label}</p>
                      <p className="text-[13px] text-slate-700 dark:text-slate-200 font-medium mt-0.5">{f.value || "—"}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Family — self-edited (moved here from the HR onboarding wizard) */}
              <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white">Personal Details &amp; Family</h3>
                  <button onClick={() => setEditModal("family")} className="text-[12px] font-medium text-[#008CFF] hover:underline flex items-center gap-1">
                    <Pencil size={12} /> Edit
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  {[
                    { label: "PHYSICALLY HANDICAPPED", value: form.physicallyHandicapped },
                    { label: "FATHER NAME",            value: form.parentName },
                    { label: "MOTHER NAME",            value: form.motherName },
                    { label: "SPOUSE NAME",            value: form.spouseName },
                    { label: "CHILDREN NAMES",         value: form.childrenNames },
                  ].map(f => (
                    <div key={f.label}>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">{f.label}</p>
                      <p className="text-[13px] text-slate-700 dark:text-slate-200 font-medium mt-0.5">{f.value || "—"}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Emergency Contact — self-edited */}
              <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white">Emergency Contact</h3>
                  <button onClick={() => setEditModal("emergency")} className="text-[12px] font-medium text-[#008CFF] hover:underline flex items-center gap-1">
                    <Pencil size={12} /> Edit
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  {[
                    { label: "RELATIONSHIP",  value: form.emergencyRelationship },
                    { label: "CONTACT PHONE", value: form.emergencyPhone },
                  ].map(f => (
                    <div key={f.label}>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">{f.label}</p>
                      <p className="text-[13px] text-slate-700 dark:text-slate-200 font-medium mt-0.5">{f.value || "—"}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right */}
            <div className="space-y-4">
              {/* Reporting Team */}
              <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white mb-3">Reporting Team</h3>
                <p className="text-[12px] text-slate-400">No direct reports</p>
              </div>

              {/* Praise */}
              <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white mb-3">Praise</h3>
                <p className="text-[12px] text-slate-400">No praise received yet</p>
              </div>
            </div>
          </div>
        )}

        {/* ═══ PROFILE ═══ */}
        {tab === "PROFILE" && (
          <div className="space-y-5 max-w-4xl">
            {/* Completeness bar */}
            {completeness < 100 && (
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-[12px] font-semibold text-amber-700 dark:text-amber-400">Incomplete profile</p>
                  <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-0.5">* All fields marked in red color below are mandatory</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-24 h-2 bg-amber-200 dark:bg-amber-900 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full" style={{ width: `${completeness}%` }} />
                  </div>
                  <span className="text-[12px] font-bold text-amber-600 dark:text-amber-400">{completeness}%</span>
                </div>
              </div>
            )}

            {/* Primary Details */}
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-white/[0.05]">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                  Primary Details
                  <span className="text-[10px] text-slate-400">(i)</span>
                </h3>
                {/* Read-only for the employee — HR-admin edits these via
                    /dashboard/hr/people/[id] → PROFILE tab. */}
              </div>
              <div className="px-5 py-4 grid grid-cols-3 gap-x-8 gap-y-4">
                {[
                  { label: "FIRST NAME",     value: profile?.name?.split(" ")[0] || "—" },
                  { label: "LAST NAME",      value: profile?.name?.split(" ").slice(1).join(" ") || "—" },
                  { label: "GENDER",         value: form.gender || "—" },
                  { label: "DOB",            value: form.dateOfBirth || "—" },
                  { label: "MARITAL STATUS", value: form.maritalStatus || "—" },
                  { label: "BLOOD GROUP",    value: form.bloodGroup || "—" },
                ].map(f => (
                  <div key={f.label}>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">{f.label}</p>
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 mt-0.5">{f.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Contact Details */}
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-white/[0.05]">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white flex items-center gap-2">Contact Details <span className="text-[10px] text-slate-400">(i)</span></h3>
                {/* Read-only — HR-admin edits these. */}
              </div>
              <div className="px-5 py-4 grid grid-cols-3 gap-x-8 gap-y-4">
                {[
                  { label: "WORK EMAIL",      value: profile?.email },
                  { label: "PERSONAL EMAIL",  value: form.personalEmail || "—" },
                  { label: "MOBILE PHONE",    value: form.phone || "—" },
                  { label: "WORK PHONE",      value: form.workPhone || "—" },
                ].map(f => (
                  <div key={f.label}>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">{f.label}</p>
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 mt-0.5">{f.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Addresses */}
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-white/[0.05]">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white">Addresses</h3>
                {/* Read-only — HR-admin edits these. */}
              </div>
              <div className="px-5 py-4 grid grid-cols-3 gap-x-8 gap-y-4">
                {[
                  { label: "STREET",  value: form.address || "—" },
                  { label: "CITY",    value: form.city    || "—" },
                  { label: "STATE",   value: form.state   || "—" },
                ].map(f => (
                  <div key={f.label}>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">{f.label}</p>
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 mt-0.5">{f.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Statutory & Bank Details — Aadhaar/PAN are self-editable;
                bank details are read-only (entered by HR). This whole card
                is private: the API only returns these fields to the owner,
                HR and developers. */}
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-white/[0.05]">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                  Statutory &amp; Bank Details
                  <span className="text-[10px] text-slate-400">(i)</span>
                </h3>
                <button onClick={() => setEditModal("statutory")} className="text-[12px] font-medium text-[#008CFF] hover:underline flex items-center gap-1">
                  <Pencil size={12} /> Edit
                </button>
              </div>
              <div className="px-5 py-4 grid grid-cols-3 gap-x-8 gap-y-4">
                {[
                  { label: "AADHAAR NUMBER", value: form.aadhaarNumber || "—" },
                  { label: "PAN NUMBER",     value: form.panNumber     || "—" },
                ].map(f => (
                  <div key={f.label}>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">{f.label}</p>
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 mt-0.5">{f.value}</p>
                  </div>
                ))}
              </div>
              <div className="px-5 pb-4 pt-1 border-t border-slate-100 dark:border-white/[0.05]">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-3 mb-2 flex items-center gap-2">
                  Bank Details
                  <span className="normal-case font-normal text-slate-400">· read-only, managed by HR</span>
                </p>
                <div className="grid grid-cols-3 gap-x-8 gap-y-4">
                  {[
                    { label: "BANK NAME",      value: ep?.bankName          || "—" },
                    { label: "ACCOUNT NUMBER", value: ep?.bankAccountNumber || "—" },
                    { label: "IFSC CODE",      value: ep?.bankIfsc          || "—" },
                  ].map(f => (
                    <div key={f.label}>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">{f.label}</p>
                      <p className="text-[13px] text-slate-700 dark:text-slate-200 mt-0.5">{f.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Profile Picture */}
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-white/[0.05]">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white">Profile Picture</h3>
                {/* Read-only — sourced from Google sign-in or set by HR. */}
              </div>
              <div className="px-5 py-4 flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#008CFF] to-[#0055bb] flex items-center justify-center text-white text-lg font-bold overflow-hidden">
                  {(form.profilePictureUrl || user?.image)
                    ? <img src={form.profilePictureUrl || user?.image} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    : nameInitials}
                </div>
                <div>
                  <p className="text-[13px] text-slate-700 dark:text-slate-200">
                    {form.profilePictureUrl ? "Profile picture set" : user?.image ? "Using Google account picture" : "No profile picture"}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Paste a direct image URL to override</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ JOB ═══ */}
        {tab === "JOB" && (
          <div className="grid grid-cols-2 gap-6 max-w-4xl">
            {/* Job Details */}
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 dark:border-white/[0.05]">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white">Job Details</h3>
              </div>
              <div className="px-5 py-4 space-y-4">
                {[
                  { label: "EMPLOYEE NUMBER",    value: ep?.employeeId },
                  { label: "DATE OF JOINING",    value: ep?.joiningDate ? new Date(ep.joiningDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : null },
                  { label: "JOB TITLE",          value: ep?.designation },
                  { label: "EMPLOYMENT TYPE",    value: ep?.employmentType },
                  { label: "WORK LOCATION",      value: ep?.workLocation },
                  { label: "NOTICE PERIOD",      value: ep?.noticePeriodDays ? `${ep.noticePeriodDays} Days` : null },
                ].map(f => f.value ? (
                  <div key={f.label}>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">{f.label}</p>
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 font-medium mt-0.5">{f.value}</p>
                  </div>
                ) : null)}
              </div>
            </div>

            {/* Organisation */}
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 dark:border-white/[0.05]">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white">Organisation</h3>
              </div>
              <div className="px-5 py-4 space-y-4">
                {[
                  { label: "DEPARTMENT",  value: ep?.department },
                  { label: "LOCATION",    value: ep?.officeLocation },
                ].map(f => f.value ? (
                  <div key={f.label}>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">{f.label}</p>
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 font-medium mt-0.5">{f.value}</p>
                  </div>
                ) : null)}
              </div>
            </div>
          </div>
        )}

        {/* ═══ DOCUMENTS ═══ */}
        {tab === "DOCUMENTS" && <SelfDocumentsPanel />}

        {/* ═══ ASSETS ═══ */}
        {tab === "ASSETS" && (
          <div className="max-w-4xl">
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.05]">
                <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white">Assigned Assets</h3>
              </div>
              <p className="text-[13px] text-slate-400 text-center py-12">No assets assigned</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Edit Modals ── */}
      {editModal === "primary" && (() => {
        // Split the user's display name (User.name) into first + last for
        // editing. The save handler recombines them into User.name.
        const fullName = (user?.name ?? "").trim();
        const firstSpace = fullName.indexOf(" ");
        const initialFirst = firstSpace === -1 ? fullName : fullName.slice(0, firstSpace);
        const initialLast  = firstSpace === -1 ? ""       : fullName.slice(firstSpace + 1);
        return (
        <EditModal title="Primary Details" onClose={() => setEditModal(null)}
          fields={[
            { key: "firstName", label: "First Name" },
            { key: "lastName",  label: "Last Name"  },
            { key: "gender", label: "Gender", options: ["Male","Female","Other","Prefer not to say"] },
            { key: "dateOfBirth", label: "Date of Birth", type: "dob" },
            { key: "bloodGroup", label: "Blood Group", options: ["A+","A-","B+","B-","O+","O-","AB+","AB-"] },
            { key: "maritalStatus", label: "Marital Status", options: ["Single","Married","Divorced","Widowed"] },
          ]}
          values={{
            firstName: initialFirst,
            lastName:  initialLast,
            gender: form.gender,
            dateOfBirth: form.dateOfBirth,
            bloodGroup: form.bloodGroup,
            maritalStatus: form.maritalStatus,
          }}
          onSave={save}
        />
        );
      })()}
      {editModal === "contact" && (
        <EditModal title="Contact Details" onClose={() => setEditModal(null)}
          fields={[
            { key: "_workEmail",    label: "Work Email", readOnly: true, fullWidth: true },
            { key: "phone",         label: "Mobile Phone", type: "tel" },
            { key: "workPhone",     label: "Work Phone",   type: "tel" },
            { key: "personalEmail", label: "Personal Email", type: "email", fullWidth: true },
          ]}
          values={{
            _workEmail:    profile?.email ?? "",
            phone:         form.phone,
            workPhone:     form.workPhone,
            personalEmail: form.personalEmail,
          }}
          onSave={save}
        />
      )}
      {editModal === "address" && (
        <EditModal title="Address" onClose={() => setEditModal(null)}
          fields={[
            { key: "address", label: "Street Address" },
            { key: "city",    label: "City" },
            { key: "state",   label: "State" },
          ]}
          values={{ address: form.address, city: form.city, state: form.state }}
          onSave={save}
        />
      )}
      {editModal === "photo" && (
        <EditModal title="Profile Picture URL" onClose={() => setEditModal(null)}
          fields={[{ key: "profilePictureUrl", label: "Image URL" }]}
          values={{ profilePictureUrl: form.profilePictureUrl }}
          onSave={save}
        />
      )}
      {editModal === "family" && (
        <EditModal title="Personal Details & Family" onClose={() => setEditModal(null)}
          fields={[
            { key: "physicallyHandicapped", label: "Physically Handicapped", options: ["No", "Yes"] },
            { key: "parentName",            label: "Father Name" },
            { key: "motherName",            label: "Mother Name" },
            { key: "spouseName",            label: "Spouse Name" },
            { key: "childrenNames",         label: "Children Names", fullWidth: true },
          ]}
          values={{
            physicallyHandicapped: form.physicallyHandicapped || "No",
            parentName:            form.parentName,
            motherName:            form.motherName,
            spouseName:            form.spouseName,
            childrenNames:         form.childrenNames,
          }}
          onSave={save}
        />
      )}
      {editModal === "emergency" && (
        <EditModal title="Emergency Contact" onClose={() => setEditModal(null)}
          fields={[
            { key: "emergencyRelationship", label: "Relationship", options: ["Father", "Mother", "Spouse", "Sibling", "Friend", "Guardian", "Other"] },
            { key: "emergencyPhone",        label: "Contact Phone", type: "tel" },
          ]}
          values={{
            emergencyRelationship: form.emergencyRelationship,
            emergencyPhone:        form.emergencyPhone,
          }}
          onSave={save}
        />
      )}
      {editModal === "statutory" && (
        // Only Aadhaar + PAN are editable here. Bank details are shown on
        // the card but never enter this modal — they're HR-managed.
        <EditModal title="Statutory Details" onClose={() => setEditModal(null)}
          fields={[
            // Aadhaar = exactly 12 digits; PAN = 10 chars (ABCDE1234F).
            { key: "aadhaarNumber", label: "Aadhaar Number", maxLength: 12, inputMode: "numeric", placeholder: "12-digit number", transform: (v) => v.replace(/\D/g, "").slice(0, 12) },
            { key: "panNumber",     label: "PAN Number",     maxLength: 10, placeholder: "ABCDE1234F",       transform: (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) },
          ]}
          values={{
            aadhaarNumber: form.aadhaarNumber,
            panNumber:     form.panNumber,
          }}
          onSave={save}
        />
      )}

      {/* ── Bio editor (About / What I love / Hobbies) ─────────────── */}
      {bioEditing && (() => {
        const cfg = bioConfig[bioEditing];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.08] rounded-2xl w-full max-w-lg shadow-2xl">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
                <h3 className="text-[15px] font-semibold text-slate-800 dark:text-white">Edit {cfg.title}</h3>
                <button onClick={() => setBioEditing(null)}><X size={18} className="text-slate-400 hover:text-slate-700 dark:hover:text-white" /></button>
              </div>
              <div className="px-6 py-5 space-y-3">
                {bioErr && (
                  <p className="text-[12px] text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{bioErr}</p>
                )}
                <textarea
                  value={bioDraft}
                  onChange={(e) => setBioDraft(e.target.value)}
                  placeholder={cfg.placeholder}
                  rows={6}
                  maxLength={1000}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#008CFF] resize-none"
                />
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Leave blank to clear.</span>
                  <span>{bioDraft.length} / 1000</span>
                </div>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-white/[0.06]">
                <button onClick={() => setBioEditing(null)} className="h-9 px-4 text-[13px] text-slate-500 hover:text-slate-800 dark:text-white">Cancel</button>
                <button
                  onClick={saveBio}
                  disabled={bioSaving}
                  className="h-9 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold disabled:opacity-50"
                >
                  {bioSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-view Documents panel — fetches the logged-in user's OWN
// documents via /api/hr/documents?self=true. The `self=true` flag is
// REQUIRED: without it an HR-admin (orgLevel=hr_manager / ceo) falls
// through to the org-wide list and sees every employee's (incl.
// other-brand) documents in their own profile. self=true forces the
// server to scope to the caller regardless of admin status.
// ─────────────────────────────────────────────────────────────────────
const SELF_DOCS_KEY = "/api/hr/documents?self=true";
function SelfDocumentsPanel() {
  const { data: documents = [], isLoading } = useSWR<any[]>(SELF_DOCS_KEY, fetcher);
  const [folder, setFolder] = useState<string>("identity");
  const active = SELF_DOC_FOLDERS.find((f) => f.key === folder)!;
  const filesInFolder = documents.filter((d: any) => active.cats.includes((d.category || "").toLowerCase()));

  const [uploadOpen, setUploadOpen]   = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadName, setUploadName]   = useState<string>("");
  const [uploadCategory, setUploadCategory] = useState<string>("pan_card");
  const [uploading, setUploading]     = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver]       = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const defaultCategoryFor = (key: string): string =>
    key === "identity"  ? "pan_card"
  : key === "education" ? "education_certificate"
  : key === "letters"   ? "offer_letter"
  : key === "previous"  ? "previous_relieving_letter"
  : "other";

  const openUpload = () => {
    setUploadFiles([]);
    setUploadName("");
    setUploadCategory(defaultCategoryFor(folder));
    setUploadError(null);
    setUploadOpen(true);
  };
  const closeUpload = () => { if (!uploading) setUploadOpen(false); };

  // Add one or more files (drop / picker). Skips anything over 10 MB and
  // reports how many were skipped. Default display name only auto-fills
  // when exactly one file is queued.
  const addFiles = (list: FileList | File[]) => {
    setUploadError(null);
    const picked = Array.from(list);
    const ok = picked.filter((f) => f.size <= 10 * 1024 * 1024);
    const skipped = picked.length - ok.length;
    if (skipped > 0) setUploadError(`${skipped} file${skipped === 1 ? "" : "s"} over the 10 MB limit ${skipped === 1 ? "was" : "were"} skipped.`);
    if (ok.length) {
      setUploadFiles((prev) => {
        const next = [...prev, ...ok];
        if (next.length === 1 && !uploadName.trim()) setUploadName(next[0].name);
        return next;
      });
    }
  };
  const removeFile = (idx: number) => setUploadFiles((prev) => prev.filter((_, i) => i !== idx));

  const submitUpload = async () => {
    if (uploadFiles.length === 0) { setUploadError("Pick at least one file."); return; }
    setUploading(true);
    setUploadError(null);
    try {
      const single = uploadFiles.length === 1;
      const failures: string[] = [];
      for (const file of uploadFiles) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("category", uploadCategory);
        // Manual display name applies only to a single-file upload; multi
        // uploads keep each file's own name.
        fd.append("fileName", single && uploadName.trim() ? uploadName.trim() : file.name);
        const res = await fetch("/api/hr/documents", { method: "POST", body: fd });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          failures.push(`${file.name} (${j?.error || res.status})`);
        }
      }
      await mutate(SELF_DOCS_KEY);
      if (failures.length) {
        setUploadFiles([]);
        setUploadError(`Some uploads failed: ${failures.join("; ")}`);
      } else {
        setUploadOpen(false);
      }
    } catch (e: any) {
      setUploadError(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: any) => {
    if (!confirm(`Delete "${doc.fileName}"?`)) return;
    const res = await fetch(`/api/hr/documents/${doc.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return alert(j?.error || `Delete failed (${res.status})`);
    }
    await mutate("/api/hr/documents");
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const categoryOptions = active.cats.map((c: string) => ({
    value: c,
    label: dropdownCategoryLabel(c),
  }));

  const folderCounts: Record<string, number> = {};
  for (const f of SELF_DOC_FOLDERS) {
    folderCounts[f.key] = documents.filter((d: any) => f.cats.includes((d.category || "").toLowerCase())).length;
  }

  // Split the "Other" folder's contents into two visually distinct
  // groups: HR-issued letters (generated via the Templates page,
  // category='employee_letter') and everything else.
  const isGeneratedLetter = (d: any) => (d.category || "").toLowerCase() === "employee_letter";
  const generatedLetters = folder === "other" ? filesInFolder.filter(isGeneratedLetter) : [];
  const otherUploads     = folder === "other" ? filesInFolder.filter((d) => !isGeneratedLetter(d)) : filesInFolder;

  const totalDocs = documents.length;
  const requiredCount = SELF_DOC_FOLDERS[0].cats.length + 1; // PAN, Aadhaar, plus the Education cat
  const hasPan      = documents.some((d) => (d.category || "").toLowerCase() === "pan_card");
  const hasAadhaar  = documents.some((d) => (d.category || "").toLowerCase() === "aadhar");
  const hasEdu      = documents.some((d) => (d.category || "").toLowerCase() === "education_certificate");
  const requiredDone = [hasPan, hasAadhaar, hasEdu].filter(Boolean).length;

  return (
    <div className="max-w-5xl">
      {/* Summary header — total docs + required progress + upload CTA */}
      <div className="mb-4 rounded-xl border border-slate-200 dark:border-white/[0.06] bg-gradient-to-br from-white to-slate-50/40 dark:from-[#001529] dark:to-[#001529] px-5 py-4 flex items-center gap-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#008CFF]/10 text-[#008CFF]">
          <FileText size={22} strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white">My documents</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            {totalDocs} total · {requiredDone}/3 essential documents uploaded
            {requiredDone < 3 && <span className="text-amber-600 font-medium"> · {3 - requiredDone} pending</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={openUpload}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[12.5px] font-semibold transition-colors shadow-sm"
        >+ Upload</button>
      </div>

      <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr]">
          {/* Folder sidebar — icon + label + count chip */}
          <div className="border-b md:border-b-0 md:border-r border-slate-100 dark:border-white/[0.05] py-3 bg-slate-50/40 dark:bg-transparent">
            <p className="px-5 py-1.5 text-[10px] text-slate-400 uppercase tracking-[0.12em] font-semibold">Folders</p>
            <div className="px-2">
              {SELF_DOC_FOLDERS.map((f) => {
                const count = folderCounts[f.key] ?? 0;
                const Icon = f.Icon;
                const isActive = folder === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFolder(f.key)}
                    className={`w-full text-left px-3 py-2.5 my-0.5 text-[13px] rounded-lg flex items-center gap-3 transition-colors ${
                      isActive
                        ? "bg-[#008CFF]/10 text-[#008CFF]"
                        : "text-slate-700 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-white/5"
                    }`}
                  >
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                      isActive ? "bg-[#008CFF]/15 text-[#008CFF]" : "bg-slate-200/60 text-slate-500"
                    }`}>
                      <Icon size={14} strokeWidth={1.75} />
                    </span>
                    <span className={`flex-1 ${isActive ? "font-semibold" : ""}`}>{f.label}</span>
                    {count > 0 && (
                      <span className={`text-[11px] font-semibold rounded-full px-1.5 ${
                        isActive ? "bg-[#008CFF]/15 text-[#008CFF]" : "bg-slate-200/70 text-slate-500"
                      }`}>{count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Folder body */}
          <div className="p-6 space-y-5">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-white/[0.04]">
              <div className="min-w-0">
                <h4 className="text-[15px] font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <active.Icon size={16} strokeWidth={1.75} className="text-[#008CFF]" />
                  {active.label}
                </h4>
                <p className="text-[11.5px] text-slate-500 mt-1">{active.subtitle}</p>
              </div>
              {!isLoading && filesInFolder.length > 0 && (
                <button
                  type="button"
                  onClick={openUpload}
                  className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 text-[11.5px] font-semibold text-[#008CFF] hover:bg-[#008CFF]/[0.06] rounded-md transition-colors"
                >+ Add to folder</button>
              )}
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            ) : filesInFolder.length === 0 ? (
              <button
                type="button"
                onClick={openUpload}
                className="w-full rounded-xl border-2 border-dashed border-slate-200 hover:border-[#008CFF]/40 hover:bg-[#008CFF]/[0.02] transition-colors py-12 text-center"
              >
                <active.Icon size={32} className="mx-auto text-slate-300 mb-2" strokeWidth={1.5} />
                <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Upload to {active.label}</p>
                <p className="mt-1 text-[11.5px] text-slate-500">Click here or drop a file. PDF / image / DOCX, up to 10 MB.</p>
              </button>
            ) : (
              <div className="space-y-5">
                {/* HR-issued letters block — emerald-toned to mark them as generated, not employee-uploaded. */}
                {generatedLetters.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2.5">
                      <Sparkles size={13} className="text-emerald-600" strokeWidth={2} />
                      <p className="text-[11px] uppercase tracking-[0.12em] font-semibold text-emerald-700">Issued by HR ({generatedLetters.length})</p>
                    </div>
                    <div className="space-y-2">
                      {generatedLetters.map((doc: any) => (
                        <DocCard key={doc.id} doc={doc} accent="emerald" onDelete={handleDelete} />
                      ))}
                    </div>
                  </div>
                )}
                {otherUploads.length > 0 && (
                  <div>
                    {generatedLetters.length > 0 && (
                      <div className="flex items-center gap-2 mb-2.5">
                        <FileText size={13} className="text-slate-500" strokeWidth={2} />
                        <p className="text-[11px] uppercase tracking-[0.12em] font-semibold text-slate-500">Your uploads ({otherUploads.length})</p>
                      </div>
                    )}
                    <div className="space-y-2">
                      {otherUploads.map((doc: any) => (
                        <DocCard key={doc.id} doc={doc} accent="blue" onDelete={handleDelete} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Upload drawer */}
      {uploadOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closeUpload} />
          <div className="fixed top-0 right-0 bottom-0 w-[420px] bg-[#f4f7f8] dark:bg-[#001529] border-l border-slate-200 dark:border-white/[0.08] shadow-2xl z-50 flex flex-col">
            <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
              <div>
                <h2 className="text-[16px] font-semibold text-slate-800 dark:text-white">Upload document</h2>
                <p className="mt-0.5 text-[11.5px] text-slate-500">Adds to <strong className="text-slate-700 dark:text-slate-200">{active.label}</strong>.</p>
              </div>
              <button onClick={closeUpload} aria-label="Close" disabled={uploading} className="text-slate-400 hover:text-slate-700 dark:hover:text-white -mt-1 disabled:opacity-50">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`rounded-xl border-2 border-dashed py-8 px-4 text-center cursor-pointer transition-colors ${
                  dragOver
                    ? "border-[#008CFF] bg-[#008CFF]/[0.04]"
                    : "border-slate-200 hover:border-slate-300 bg-white dark:border-white/10 dark:hover:border-white/20 dark:bg-white/5"
                }`}
              >
                <FileText size={28} className="mx-auto text-slate-300 mb-2" strokeWidth={1.5} />
                {uploadFiles.length > 0 ? (
                  <>
                    <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{uploadFiles.length} file{uploadFiles.length === 1 ? "" : "s"} selected</p>
                    <p className="mt-0.5 text-[11.5px] text-slate-500">click to add more</p>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Drop files here or click to pick</p>
                    <p className="mt-0.5 text-[11.5px] text-slate-500">PDF, image, or DOCX up to 10 MB each</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
                />
              </div>
              {uploadFiles.length > 0 && (
                <ul className="space-y-1.5">
                  {uploadFiles.map((f, i) => (
                    <li key={`${f.name}-${f.size}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-2.5 py-1.5">
                      <span className="flex min-w-0 items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
                        <FileText size={13} className="shrink-0 text-slate-400" />
                        <span className="truncate">{f.name}</span>
                        <span className="shrink-0 text-[11px] text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
                      </span>
                      <button type="button" onClick={(ev) => { ev.stopPropagation(); removeFile(i); }} aria-label={`Remove ${f.name}`} className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-rose-600">
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Category</label>
                <SelectField
                  value={uploadCategory}
                  onChange={setUploadCategory}
                  options={categoryOptions}
                  className={F}
                />
              </div>
              {uploadFiles.length > 1 ? (
                <p className="text-[11.5px] text-slate-500">Each file is saved under its own name in <strong className="text-slate-700 dark:text-slate-200">{active.label}</strong>.</p>
              ) : (
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Display name <span className="text-slate-400 font-normal normal-case tracking-normal">(optional)</span></label>
                  <input
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    placeholder={uploadFiles[0]?.name || "Defaults to the file name"}
                    className={F}
                  />
                </div>
              )}
              {uploadError && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[12.5px] text-rose-700">{uploadError}</div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-200 dark:border-white/[0.06] flex justify-end gap-3">
              <button onClick={closeUpload} disabled={uploading} className="h-9 px-5 text-[13px] text-slate-500 hover:text-slate-800 rounded-lg disabled:opacity-50">Cancel</button>
              <button
                onClick={submitUpload}
                disabled={uploading || uploadFiles.length === 0}
                className="h-9 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold disabled:opacity-60 disabled:cursor-wait"
              >{uploading ? "Uploading…" : uploadFiles.length > 1 ? `Upload ${uploadFiles.length} files` : "Upload"}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
