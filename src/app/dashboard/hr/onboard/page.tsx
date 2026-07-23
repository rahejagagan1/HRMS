"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { useRouter, useSearchParams } from "next/navigation";
import { User as UserIcon, Briefcase, Settings as SettingsIcon, IndianRupee, Check, X, ClipboardCheck } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { JOB_TITLES } from "@/lib/job-titles";
import { DEPARTMENTS } from "@/lib/departments";
import {
  brandFromNumberSeries,
  jobTitleSource,
  departmentSource,
} from "@/lib/company-taxonomy";
import CustomSelect from "@/components/ui/CustomSelect";
import SelectField from "@/components/ui/SelectField";
import PopupPanel from "@/components/ui/PopupPanel";
import KekaImportModal from "@/components/hr/KekaImportModal";
import ImportResumeModal from "@/components/hr/ImportResumeModal";
import type { ResumePatch } from "@/lib/resume-parse";
import TeamWelcomeModal from "@/components/hr/TeamWelcomeModal";
import { teamWelcomeEmail } from "@/lib/email/hr-templates";
import type { KekaRow, KekaFormPatch } from "@/lib/keka-import";
import { Upload as UploadIcon } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// LocalStorage key for the draft. Bump the suffix if the Form shape changes
// incompatibly — otherwise a stale draft can crash the next load.
// ─────────────────────────────────────────────────────────────────────────────
const DRAFT_KEY = "nb.hr.onboard.draft.v1";

function fmtRel(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 5_000)      return "just now";
  if (diff < 60_000)     return `${Math.floor(diff / 1_000)}s ago`;
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme tokens — match the rest of the HR module.
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  shell:   "bg-[#f1f5f9] dark:bg-[#0b1220]",
  card:    "bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06]",
  input:   "w-full h-9 px-3 bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#008CFF]/60",
  label:   "text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider",
  section: "text-[14px] font-semibold text-slate-800 dark:text-white",
  t1:      "text-slate-800 dark:text-white",
  t2:      "text-slate-600 dark:text-slate-300",
  t3:      "text-slate-400 dark:text-slate-500",
};

// ─────────────────────────────────────────────────────────────────────────────
// Form state shape — one place, flat, easy to scan.
// ─────────────────────────────────────────────────────────────────────────────
type Form = {
  // Step 1 — Basic
  workCountry:     string;
  firstName:       string;
  middleName:      string;
  lastName:        string;
  displayName:     string;
  gender:          string;
  dateOfBirth:     string;
  nationality:     string;
  numberSeries:    string;
  employeeNumber:  string;
  workEmail:       string;
  mobileCountry:   string;
  mobileNumber:    string;
  // Step 1 — Extended contact + demographics + family + emergency
  // (Keka-parity additions; all optional, all map 1:1 to EmployeeProfile
  // columns. fatherName persists into the existing parentName column —
  // the schema comment notes that's the "father's / spouse's name as on
  // the PAN card", which is the same field Keka calls Father Name.)
  workPhone:               string;
  homePhone:               string;
  personalEmail:           string;
  maritalStatus:           string;
  bloodGroup:              string;
  physicallyHandicapped:   string;
  fatherName:              string;
  motherName:              string;
  spouseName:              string;
  childrenNames:           string;
  emergencyRelationship:   string;
  emergencyPhone:          string;

  // Step 2 — Job
  joiningDate:       string;
  jobTitle:          string;
  secondaryJobTitle: string;
  timeType:          string;
  legalEntity:       string;
  businessUnit:      string;
  department:        string;
  location:          string;
  workerType:        string;
  reportingManagerId: string;
  dottedLineManagerId: string;
  probationPolicy:   string;
  noticePeriodDays:  string;
  jobLocation:       string;
  internshipEndDate: string;

  // Step 3 — Work
  inviteToLogin:    boolean;
  enableOnboarding: boolean;
  leavePolicyId:    number | "";   // assigned LeavePolicy.id — drives entitlements
  leavePlan:        string;        // legacy free-text; kept for back-compat
  holidayList:      string;
  attendanceTracking: boolean;
  shiftId:          string;
  weeklyOff:        string;
  attendanceNumber: string;
  timeTrackingPolicy: string;
  penalizationPolicy: string;
  orgLevel:         string;
  role:             string;
  // Step 3 extras (Keka-parity)
  attendanceCaptureScheme: string; // "On-Site" | "Remote" | "Hybrid"
  costCenter:              string;

  // Step 4 — Compensation (fields visible, not persisted to DB)
  salaryType:    string;   // "Regular Employee" | "Intern" — gates which fields show
  payGroup:      string;
  annualSalary:  string;
  basicPay:      string;   // Intern-only stipend / monthly basic
  bonusIncluded: boolean;
  pfEligible:    boolean;
  salaryStructure: string;
  taxRegime:     string;

  // Step 5 — Address & Government IDs (Keka-parity)
  // Current address: addressLine1 persists into the legacy `address`
  // column; everything else is a new EmployeeProfile column.
  addressLine1:    string;
  addressLine2:    string;
  city:            string;
  state:           string;
  addressPincode:  string;
  addressCountry:  string;
  // Permanent address — distinct set of columns from current.
  permanentLine1:    string;
  permanentLine2:    string;
  permanentCity:     string;
  permanentState:    string;
  permanentPincode:  string;
  permanentCountry:  string;
  // Statutory IDs
  panNumber:       string;
  aadhaarNumber:   string;
  pfNumber:        string;
  uanNumber:       string;
  biometricId:     string;
};

const EMPTY: Form = {
  workCountry: "India", firstName: "", middleName: "", lastName: "",
  displayName: "", gender: "male", dateOfBirth: "", nationality: "India",
  numberSeries: "NB Media Series", employeeNumber: "", workEmail: "",
  mobileCountry: "+91", mobileNumber: "",
  workPhone: "", homePhone: "", personalEmail: "",
  maritalStatus: "", bloodGroup: "", physicallyHandicapped: "No",
  fatherName: "", motherName: "", spouseName: "", childrenNames: "",
  emergencyRelationship: "", emergencyPhone: "",
  joiningDate: new Date().toISOString().slice(0, 10),
  jobTitle: "", secondaryJobTitle: "", timeType: "Full Time",
  legalEntity: "NB Media Productions", businessUnit: "NB Media", department: "",
  location: "Mohali", workerType: "Regular Employee",
  reportingManagerId: "", dottedLineManagerId: "",
  probationPolicy: "Regular Employees", noticePeriodDays: "30",
  jobLocation: "Mohali", internshipEndDate: "",
  inviteToLogin: true, enableOnboarding: true,
  leavePolicyId: "" as number | "",
  leavePlan: "Regular Leave Plan", holidayList: "Default Holiday List",
  attendanceTracking: true, shiftId: "", weeklyOff: "Standard Weekly Off",
  attendanceNumber: "", timeTrackingPolicy: "On-Site Capture",
  penalizationPolicy: "Default",
  orgLevel: "member", role: "member",
  attendanceCaptureScheme: "On-Site", costCenter: "NB Media",
  salaryType: "Regular Employee",
  payGroup: "NB Media", annualSalary: "",
  basicPay: "",
  bonusIncluded: false, pfEligible: false,
  salaryStructure: "Range Based", taxRegime: "New Regime (Section 115BAC)",
  addressLine1: "", addressLine2: "", city: "", state: "",
  addressPincode: "", addressCountry: "India",
  permanentLine1: "", permanentLine2: "", permanentCity: "", permanentState: "",
  permanentPincode: "", permanentCountry: "India",
  panNumber: "", aadhaarNumber: "", pfNumber: "", uanNumber: "", biometricId: "",
};

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
export default function OnboardEmployeePage() {
  const router = useRouter();
  const search = useSearchParams();
  const [step, setStep]       = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  // Brand auto-fill — when HR opens onboarding from the YT Labs HR
  // Dashboard flyout the link carries `?brand=yt-labs`, so the form
  // should land pre-set to the YT Labs Number Series (which cascades
  // into legalEntity / businessUnit / costCenter via the useEffect
  // further down). NB Media / all / no-param falls through to the
  // existing default. We read the param ONCE here and seed the
  // useState initial value — that way a stored draft (restored a
  // moment later by the localStorage effect) still wins, as the user
  // would expect mid-flow.
  const [form, setForm] = useState<Form>(() => {
    const brand = (search?.get("brand") || "").toLowerCase();
    if (brand === "yt-labs" || brand === "yt") {
      return {
        ...EMPTY,
        numberSeries: "YT Labs Series",
        legalEntity:  "YT Labs",
        businessUnit: "YT Labs",
      };
    }
    return EMPTY;
  });
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");
  // After a successful onboard, this holds the new joiner's details so
  // we can open the Team Welcome composer (preview-then-send). Cleared
  // when HR closes / skips / completes the welcome dialog.
  const [welcomeFor, setWelcomeFor] = useState<{
    fullName: string; firstName: string; jobRole: string;
    workEmail: string; homeCity?: string; managerName?: string; officeLocation?: string;
    phone?: string; pronoun?: "he" | "she" | "they"; managerId?: number; priorRole?: string;
  } | null>(null);
  // Banner shown when the form was prefilled from a hiring candidate
  // via ?fromCandidate=<id>. Stays put until HR dismisses it. Carries
  // the candidate's resume info so HR can view it while filling out
  // the rest of the form — no need to re-upload, the file lives in
  // JobApplication.resumeBlob and is served via the hiring API.
  const [prefilledFrom, setPrefilledFrom] = useState<{
    candidateId:    number;
    name:           string;
    resumeUrl:      string | null;
    resumeFileName: string | null;
  } | null>(null);

  // Keka import state — modal visibility + a small banner telling HR
  // which row was just pulled in. The set of HRM IDs already onboarded
  // in this session keeps the modal from offering "Pre-fill" twice for
  // the same employee after a save.
  const [importOpen, setImportOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [importedFrom, setImportedFrom] = useState<{ hrm: string; name: string } | null>(null);
  const [importDoneIds, setImportDoneIds] = useState<Set<string>>(() => new Set());

  // Prefill from a hiring candidate when the page is opened with
  // ?fromCandidate=<id>. Fetches the candidate row, splits the full
  // name into first/middle/last, and seeds the email / phone / job
  // title fields. Runs once on mount.
  useEffect(() => {
    const candidateId = search?.get("fromCandidate");
    if (!candidateId || !/^\d+$/.test(candidateId)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/hr/hiring/candidates/${candidateId}`);
        if (!res.ok) return;
        const json = await res.json();
        const a = json?.application ?? json?.candidate ?? json; // route shape may vary
        if (cancelled || !a) return;
        const full = String(a.fullName ?? "").trim();
        const parts = full.split(/\s+/).filter(Boolean);
        const firstName  = parts.length >= 1 ? parts[0] : "";
        const middleName = parts.length >= 3 ? parts.slice(1, -1).join(" ") : "";
        const lastName   = parts.length >= 2 ? parts[parts.length - 1] : "";
        // Strip a country code prefix like "+91 " if present.
        const phoneRaw = String(a.phone ?? "").trim();
        const m = phoneRaw.match(/^\+(\d{1,3})\s*(.+)$/);
        const mobileCountry = m ? `+${m[1]}` : "+91";
        const mobileNumber  = (m ? m[2] : phoneRaw).replace(/\D/g, "");
        setForm((f) => ({
          ...f,
          firstName,
          middleName,
          lastName,
          displayName: full || f.displayName,
          workEmail:   a.email ?? f.workEmail,
          personalEmail: a.email ?? f.personalEmail,
          mobileCountry,
          mobileNumber,
          jobTitle: a.roleTitle ?? f.jobTitle,
        }));
        setPrefilledFrom({
          candidateId:    Number(candidateId),
          name:           full || `candidate #${candidateId}`,
          resumeUrl:      typeof a.resumeUrl === "string" ? a.resumeUrl : null,
          resumeFileName: typeof a.resumeFileName === "string" ? a.resumeFileName : null,
        });
      } catch { /* silent — prefill is best-effort */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Same as Current Address" — when checked, the permanent address fields
  // mirror the current ones live and the permanent inputs are disabled.
  const [sameAsCurrent, setSameAsCurrent] = useState(false);
  useEffect(() => {
    if (!sameAsCurrent) return;
    setForm((f) => {
      const inSync =
        f.permanentLine1   === f.addressLine1 &&
        f.permanentLine2   === f.addressLine2 &&
        f.permanentCity    === f.city &&
        f.permanentState   === f.state &&
        f.permanentPincode === f.addressPincode &&
        f.permanentCountry === f.addressCountry;
      if (inSync) return f;
      return {
        ...f,
        permanentLine1:   f.addressLine1,
        permanentLine2:   f.addressLine2,
        permanentCity:    f.city,
        permanentState:   f.state,
        permanentPincode: f.addressPincode,
        permanentCountry: f.addressCountry,
      };
    });
  }, [sameAsCurrent, form.addressLine1, form.addressLine2, form.city, form.state, form.addressPincode, form.addressCountry]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));

  const { data: opts, mutate: refreshOpts } = useSWR("/api/hr/onboard/options", fetcher);
  const shifts    = opts?.shifts    ?? [];
  const leaveTypes = opts?.leaveTypes ?? [];
  const managers  = opts?.managers  ?? [];
  const allUsers: Array<{ id: number; name: string }> = opts?.allUsers ?? [];

  // RBAC job designations — the SAME source Edit Profile uses. The Job
  // Designation field (Step 2) picks from these instead of the old hardcoded
  // title lists, so onboarding links the employee to a real Designation.
  const { data: desigData } = useSWR<{ designations: { id: number; label: string; businessUnit: string | null }[] }>(
    "/api/designations", fetcher,
  );
  const designationOptions = useMemo(() => {
    const brand = brandFromNumberSeries(form.numberSeries);
    const all = desigData?.designations ?? [];
    // Show this brand's designations (plus brand-agnostic ones); fall back to
    // the full list if the brand filter would leave it empty.
    const scoped = all.filter((d) => !d.businessUnit || d.businessUnit === brand);
    return scoped.length ? scoped : all;
  }, [desigData, form.numberSeries]);

  // Union of the server-side existing employee IDs and any IDs created
  // in this session — what the modal uses to grey out "already
  // onboarded" rows.
  const mergedOnboardedIds = useMemo(() => {
    const s = new Set<string>(importDoneIds);
    for (const id of (opts?.existingEmployeeIds ?? [])) s.add(id);
    return s;
  }, [importDoneIds, opts?.existingEmployeeIds]);

  // Auto-pick the regular 9 am – 6 pm shift once the shifts list loads.
  // HR can still change the selection manually; we only set it when the
  // form has no shift chosen yet, so we don't clobber an explicit pick.
  useEffect(() => {
    if (form.shiftId) return;
    if (!Array.isArray(shifts) || shifts.length === 0) return;
    const regular = shifts.find(
      (s: any) => s.startTime === "09:00" && s.endTime === "18:00",
    );
    if (regular) setForm((f) => ({ ...f, shiftId: String(regular.id) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shifts.length]);

  // Auto-keep display name in sync unless the user edits it themselves.
  const [displayTouched, setDisplayTouched] = useState(false);
  useEffect(() => {
    if (displayTouched) return;
    const dn = [form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ").trim();
    if (dn !== form.displayName) setForm(f => ({ ...f, displayName: dn }));
  }, [form.firstName, form.middleName, form.lastName, displayTouched]);

  // Auto-fill the Attendance Number with the employee-number prefix (e.g.
  // "HRM" for HRM47). HR can still override it manually — once they type,
  // we stop overwriting.
  const [attendanceTouched, setAttendanceTouched] = useState(false);

  // Handle a row pick from the Keka import modal. Spreads the mapped
  // patch onto the form, marks displayName as touched (so the
  // first/middle/last useEffect doesn't immediately overwrite it), and
  // remembers the HRM ID so the modal won't re-offer the same row.
  const handleImportPick = (row: KekaRow, patch: KekaFormPatch) => {
    setForm((f) => ({
      ...f,
      firstName:           patch.firstName,
      middleName:          patch.middleName,
      lastName:            patch.lastName,
      displayName:         patch.displayName,
      workEmail:           patch.workEmail,
      gender:              patch.gender,
      dateOfBirth:         patch.dateOfBirth,
      mobileCountry:       patch.mobileCountry,
      mobileNumber:        patch.mobileNumber,
      employeeNumber:      patch.employeeNumber,
      joiningDate:         patch.joiningDate,
      jobTitle:            patch.jobTitle,
      department:          patch.department,
      workerType:          patch.workerType,
      timeType:            patch.timeType,
      location:            patch.location,
      jobLocation:         patch.jobLocation,
      noticePeriodDays:    patch.noticePeriodDays,
      internshipEndDate:   patch.internshipEndDate,
      leavePlan:           patch.leavePlan,
      reportingManagerId:  patch.reportingManagerId,
      // Salary tab is left untouched on purpose — HR enters it.
    }));
    setDisplayTouched(true);
    setAttendanceTouched(false);  // attendance auto-derive will re-fire from the new HRM id
    setImportedFrom({ hrm: row.employeeNumber, name: row.displayName });
    setStep(1);                   // always start the review at the first step
  };

  // Merge resume-parsed fields onto the form. Unlike the Keka patch this
  // only sets keys the resume actually yielded (never blanks a field),
  // and leaves Salary / HRM / dates for HR to enter.
  const handleResumePick = (patch: ResumePatch, fileName: string) => {
    setForm((f) => ({ ...f, ...patch }));
    if (patch.displayName) setDisplayTouched(true);
    setImportedFrom({ hrm: fileName, name: patch.displayName || "" });
    setStep(1);
  };

  // ── Existing-user lookup by Work Email ────────────────────────────
  // Type a name or email — the dropdown suggests matching User rows so
  // HR can link to a Google-OAuth user instead of duplicating them.
  // Picking auto-fills first / last / display name.
  type LookupBanner =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "match-fresh"; name: string }
    | { kind: "match-onboarded"; name: string; employeeId: string }
    | { kind: "none" };
  const [lookup, setLookup] = useState<LookupBanner>({ kind: "idle" });
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const emailFieldRef = useRef<HTMLDivElement>(null);

  // Pull the active EmployeeNumberSeries so the form can show the
  // next-allocatable employee number as a hint ("Next: HRM47").
  const { data: numberSeries } = useSWR<any[]>("/api/hr/number-series", fetcher);
  const { data: leavePolicies = [] } = useSWR<Array<{ id: number; name: string; isActive: boolean }>>(
    "/api/hr/admin/leave-policies",
    fetcher,
  );
  // Auto-pick the first active leave policy for new users — onboarding
  // should never leave leavePolicyId blank if a policy is configured, so
  // accrual + Apply work out of the box. HR can still change the choice
  // before submitting, or pick "None" explicitly.
  useEffect(() => {
    if (form.leavePolicyId !== "") return;
    const def = leavePolicies.find((p) => p.isActive);
    if (def) setForm((f) => ({ ...f, leavePolicyId: def.id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leavePolicies]);
  const activeSeries = (Array.isArray(numberSeries) ? numberSeries : []).find((s: any) => s.isActive) ?? (Array.isArray(numberSeries) ? numberSeries[0] : null);
  // Resolve the prefix / next-number from the dropdown selection.
  // YT Labs is a sibling brand and uses a separate "YL" prefix; until
  // the EmployeeNumberSeries table is seeded with a YL row, we
  // optimistically start the preview at YL1 so HR sees the right
  // shape. The backend allocation needs the DB row to persist properly.
  const seriesByName = (Array.isArray(numberSeries) ? numberSeries : []).find(
    (s: any) => s?.name === form.numberSeries,
  );
  const selectedPrefix =
    seriesByName?.prefix
    ?? (form.numberSeries === "YT Labs Series" ? "YL" : activeSeries?.prefix ?? "HRM");
  const selectedNextNumber =
    seriesByName?.nextNumber
    ?? (form.numberSeries === "YT Labs Series" ? 1 : activeSeries?.nextNumber ?? 1);
  const nextEmployeeId = `${selectedPrefix}${selectedNextNumber}`;
  // HRM No. ↔ Attendance No. convention: they should be identical
  // (e.g. HRM47 / HRM47), matching how the Keka export ships every
  // row with both columns set to the same value. We mirror the FULL
  // employee number into the Attendance Number field, not just the
  // "HRM" prefix. A manually-typed employeeNumber still wins; if HR
  // hasn't typed one yet, fall back to the next-allocatable ID from
  // the active series so the form previews "HRM47" → "HRM47" before
  // submit. attendanceTouched stays so HR can override per-employee
  // if they ever need a different attendance ID.
  const fullEmployeeId = (form.employeeNumber || nextEmployeeId).trim();
  useEffect(() => {
    if (attendanceTouched) return;
    if (fullEmployeeId && fullEmployeeId !== form.attendanceNumber) {
      setForm(f => ({ ...f, attendanceNumber: fullEmployeeId }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullEmployeeId, attendanceTouched]);

  // Company cascade: when HR picks a Number Series, snap the linked
  // org-detail fields (Legal Entity / Business Unit / Cost Center) to
  // that company's preset. Fires only when the series itself changes,
  // so manual tweaks the user makes afterwards stick.
  useEffect(() => {
    // Case-insensitive match so the cascade works whether the dropdown
    // value comes from the DB ("NB Media Series" / "YT Labs Series") or
    // legacy hardcoded strings.
    const series = form.numberSeries.trim().toLowerCase();
    const preset =
      series === "yt labs series"
        ? { legalEntity: "YT Labs", businessUnit: "YT Labs", costCenter: "YT Labs" }
        : series === "nb media series"
        ? { legalEntity: "NB Media Productions", businessUnit: "NB Media", costCenter: "NB Media" }
        : null;
    if (!preset) return;
    setForm(f => ({ ...f, ...preset }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.numberSeries]);

  useEffect(() => {
    const q = form.workEmail.trim().toLowerCase();
    if (q.length < 2) {
      setSuggestions([]);
      setLookup({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setLookup({ kind: "loading" });
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/hr/employees?search=${encodeURIComponent(q)}`);
        if (!res.ok) {
          if (!cancelled) { setSuggestions([]); setLookup({ kind: "none" }); }
          return;
        }
        if (cancelled) return;
        const rows: any[] = await res.json();
        setSuggestions(rows.slice(0, 6));
        const exact = rows.find((u) => String(u.email ?? "").toLowerCase() === q);
        if (!exact) { setLookup({ kind: "none" }); return; }
        const fullName = String(exact.name ?? "").trim();
        if (exact.employeeProfile) {
          setLookup({
            kind: "match-onboarded",
            name: fullName,
            employeeId: exact.employeeProfile.employeeId ?? "—",
          });
          return;
        }
        const firstSpace = fullName.indexOf(" ");
        const fName = firstSpace === -1 ? fullName : fullName.slice(0, firstSpace);
        const lName = firstSpace === -1 ? ""       : fullName.slice(firstSpace + 1);
        setForm((f) => ({
          ...f,
          firstName:   f.firstName  || fName,
          lastName:    f.lastName   || lName,
          displayName: displayTouched ? f.displayName : (fullName || f.displayName),
        }));
        setLookup({ kind: "match-fresh", name: fullName });
      } catch {
        if (!cancelled) setLookup({ kind: "idle" });
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.workEmail, displayTouched]);

  const pickSuggestion = (u: any) => {
    const email = String(u.email ?? "").toLowerCase();
    const fullName = String(u.name ?? "").trim();
    const firstSpace = fullName.indexOf(" ");
    const fName = firstSpace === -1 ? fullName : fullName.slice(0, firstSpace);
    const lName = firstSpace === -1 ? ""       : fullName.slice(firstSpace + 1);
    setForm((f) => ({
      ...f,
      workEmail:   email,
      firstName:   fName || f.firstName,
      lastName:    lName || f.lastName,
      displayName: displayTouched ? f.displayName : (fullName || f.displayName),
    }));
    setSuggestions([]);
    setShowSuggestions(false);
  };

  // ── Draft autosave ──────────────────────────────────────────────────
  // Persists the entire wizard state to localStorage so users can reload
  // the page, close the tab, or come back days later and continue where
  // they left off. Debounced 500ms so we don't hammer storage on every
  // keystroke. Cleared on successful submit + on the Discard button.
  const [draftRestoredAt, setDraftRestoredAt] = useState<number | null>(null);
  const [draftSavedAt,    setDraftSavedAt]    = useState<number | null>(null);
  const [draftLoaded,     setDraftLoaded]     = useState(false);

  // Restore on mount (runs once — client-only to avoid hydration issues).
  //
  // URL-brand precedence: if the page was opened from the YT Labs (or
  // NB Media) HR Dashboard flyout, `?brand=` carries that intent. A
  // saved draft from a prior NB Media onboarding shouldn't override
  // the brand the user just chose — so after merging the draft, we
  // re-apply the URL brand's company-preset (NumberSeries / Legal
  // Entity / Business Unit). Personal fields the user already typed
  // are preserved; only the brand-related ones get reset.
  useEffect(() => {
    if (typeof window === "undefined") { setDraftLoaded(true); return; }
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.form) {
          const brand = (search?.get("brand") || "").toLowerCase();
          let restored: Form = { ...EMPTY, ...parsed.form };
          if (brand === "yt-labs" || brand === "yt") {
            restored = { ...restored, numberSeries: "YT Labs Series", legalEntity: "YT Labs", businessUnit: "YT Labs" };
          } else if (brand === "nb-media" || brand === "nb") {
            restored = { ...restored, numberSeries: "NB Media Series", legalEntity: "NB Media Productions", businessUnit: "NB Media" };
          }
          setForm(restored);
        }
        if (parsed?.step && parsed.step >= 1 && parsed.step <= 6) {
          setStep(parsed.step as 1 | 2 | 3 | 4 | 5 | 6);
        }
        if (parsed?.displayTouched) setDisplayTouched(true);
        if (parsed?.savedAt) {
          setDraftRestoredAt(parsed.savedAt);
          setDraftSavedAt(parsed.savedAt);
        }
      }
    } catch { /* malformed draft — ignore and start fresh */ }
    setDraftLoaded(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save on any meaningful change, debounced. Only starts AFTER the initial
  // restore completes so the first "write" isn't the empty default form
  // overwriting a real draft that's about to be loaded.
  useEffect(() => {
    if (!draftLoaded) return;
    if (typeof window === "undefined") return;
    const t = setTimeout(() => {
      try {
        const savedAt = Date.now();
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ form, step, displayTouched, savedAt })
        );
        setDraftSavedAt(savedAt);
      } catch { /* storage full / private mode — silent */ }
    }, 500);
    return () => clearTimeout(t);
  }, [form, step, displayTouched, draftLoaded]);

  const clearDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setForm(EMPTY);
    setStep(1);
    setDisplayTouched(false);
    setDraftRestoredAt(null);
    setDraftSavedAt(null);
  };

  // Tick every 20s so the relative "Draft saved Xm ago" label refreshes
  // while the user is still on the page.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 20_000);
    return () => clearInterval(id);
  }, []);

  // ── Validation per step ─────────────────────────────────────────────
  const stepValid = useMemo(() => {
    if (step === 1) return !!(form.firstName && form.lastName && form.workEmail);
    if (step === 2) return !!(form.joiningDate && form.jobTitle);
    return true;
  }, [step, form]);

  // ── Review step (6) helpers ─────────────────────────────────────────
  // Derived, display-only values for the summary + the welcome-email
  // preview. We build the email from the SAME mapping the submit handler
  // uses for setWelcomeFor, so what HR reviews here is exactly what the
  // post-create Team Welcome composer pre-loads (minus prior role, which
  // onboarding doesn't collect). Pronoun is derived from gender so the
  // copy reads naturally instead of always defaulting to "they".
  const reviewFullName = [form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ").trim();
  const reviewManagerName = managers.find((m: any) => String(m.id) === String(form.reportingManagerId))?.name || "";
  const reviewShift = shifts.find((s: any) => String(s.id) === String(form.shiftId));
  const reviewShiftName = reviewShift ? `${reviewShift.name} (${reviewShift.startTime}–${reviewShift.endTime})` : "";
  const reviewMobile = form.mobileNumber ? `${form.mobileCountry} ${form.mobileNumber}` : "";
  const fmtAddress = (l1: string, l2: string, city: string, state: string, pin: string, country: string) =>
    [l1, l2, [city, state].filter(Boolean).join(", "), [pin, country].filter(Boolean).join(", ")]
      .map((s) => s.trim()).filter(Boolean).join("\n");
  const reviewCurrentAddr = fmtAddress(form.addressLine1, form.addressLine2, form.city, form.state, form.addressPincode, form.addressCountry);
  const reviewPermanentAddr = fmtAddress(form.permanentLine1, form.permanentLine2, form.permanentCity, form.permanentState, form.permanentPincode, form.permanentCountry);

  const welcomePreview = useMemo(() => teamWelcomeEmail({
    newJoinerName:  reviewFullName || "New joiner",
    firstName:      form.firstName || reviewFullName.split(" ")[0] || "the new joiner",
    homeCity:       form.city || undefined,
    priorRole:      undefined, // not collected during onboarding — clause is dropped, not left as {{}}
    jobRole:        form.jobTitle || form.role || "Team member",
    managerName:    reviewManagerName || undefined,
    officeLocation: form.location || undefined,
    phone:          reviewMobile || undefined,
    workEmail:      form.workEmail || "",
    pronoun:        form.gender === "female" ? "she" : form.gender === "male" ? "he" : "they",
  }), [reviewFullName, form.firstName, form.city, form.jobTitle, form.role, reviewManagerName, form.location, reviewMobile, form.workEmail, form.gender]);

  // ── Submit ──────────────────────────────────────────────────────────
  const submit = async () => {
    setError(""); setSuccess(""); setSaving(true);
    try {
      const payload: any = {
        name:  [form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ").trim(),
        email: form.workEmail,
        role:  form.role,
        orgLevel: form.orgLevel,
        // RBAC designation link — resolved from the picked Job Designation
        // label so the new hire is tied to a real Designation (drives job
        // title, scorecard function, designation-based permissions).
        designationId: designationOptions.find((d) => d.label === form.jobTitle)?.id ?? null,
        // Send null (not undefined) when HR cleared the dropdown so
        // the API actually clears the existing link. The API now
        // distinguishes undefined ("don't touch") from null ("set to
        // none") for these fields.
        managerId: form.reportingManagerId ? Number(form.reportingManagerId) : null,
        inlineManagerId: form.dottedLineManagerId ? Number(form.dottedLineManagerId) : null,
        inviteToLogin:    form.inviteToLogin,
        enableOnboarding: form.enableOnboarding,
        leavePolicyId:    form.leavePolicyId === "" ? null : Number(form.leavePolicyId),
        profile: {
          employeeId: form.employeeNumber || undefined,
          designation: form.jobTitle || undefined,
          department:  form.department || undefined,
          businessUnit: form.businessUnit || "NB Media",
          legalEntity:  form.legalEntity || undefined,
          // Pass the resolved EmployeeNumberSeries FK so the backend
          // bumps the right counter (HRM vs YL). Falls back server-side
          // to the lowest active series when undefined.
          numberSeriesId: seriesByName?.id ?? undefined,
          employmentType:
            form.workerType === "Intern"     ? "intern"
            : form.timeType === "Part Time"  ? "parttime"
            : "fulltime",
          workLocation: form.location?.toLowerCase().includes("remote") ? "remote" : "office",
          joiningDate:  form.joiningDate || undefined,
          phone:        form.mobileNumber ? `${form.mobileCountry} ${form.mobileNumber}` : undefined,
          dateOfBirth:  form.dateOfBirth || undefined,
          gender:       form.gender || undefined,
          noticePeriodDays: Number(form.noticePeriodDays) || 30,
          // ── Keka-parity additions ──
          // Contact
          workPhone:     form.workPhone     || undefined,
          homePhone:     form.homePhone     || undefined,
          personalEmail: form.personalEmail || undefined,
          // Demographics + family
          maritalStatus:         form.maritalStatus         || undefined,
          bloodGroup:            form.bloodGroup            || undefined,
          physicallyHandicapped: form.physicallyHandicapped || undefined,
          parentName:            form.fatherName            || undefined, // Keka "Father Name" → existing parentName column
          motherName:            form.motherName            || undefined,
          spouseName:            form.spouseName            || undefined,
          childrenNames:         form.childrenNames         || undefined,
          // Emergency contact
          emergencyRelationship: form.emergencyRelationship || undefined,
          emergencyPhone:        form.emergencyPhone        || undefined,
          // Org / attendance extras
          attendanceCaptureScheme: form.attendanceCaptureScheme || undefined,
          costCenter:              form.costCenter              || undefined,
          // HRM No. ↔ Attendance No. convention: same value. Send the
          // form's attendanceNumber if HR overrode it, else fall back
          // to the employeeNumber so they stay in sync.
          attendanceNumber:        (form.attendanceNumber || form.employeeNumber) || undefined,
          // Current address — `address` is Line 1 (legacy column).
          address:        form.addressLine1   || undefined,
          addressLine2:   form.addressLine2   || undefined,
          city:           form.city           || undefined,
          state:          form.state          || undefined,
          addressPincode: form.addressPincode || undefined,
          addressCountry: form.addressCountry || undefined,
          // Permanent address
          permanentLine1:    form.permanentLine1    || undefined,
          permanentLine2:    form.permanentLine2    || undefined,
          permanentCity:     form.permanentCity     || undefined,
          permanentState:    form.permanentState    || undefined,
          permanentPincode:  form.permanentPincode  || undefined,
          permanentCountry:  form.permanentCountry  || undefined,
          // Statutory IDs
          panNumber:     form.panNumber     || undefined,
          aadhaarNumber: form.aadhaarNumber || undefined,
          pfNumber:      form.pfNumber      || undefined,
          uanNumber:     form.uanNumber     || undefined,
          biometricId:   form.biometricId   || undefined,
        },
        shiftId: form.shiftId ? Number(form.shiftId) : undefined,
        // New hires start at zero across the board. Sick Leave accrues
        // 1 day / month from then on (handled by the leave-accrual helper);
        // other types stay at 0 unless HR adjusts them in the matrix.
        leaveBalances: leaveTypes.map((lt: any) => ({ leaveTypeId: lt.id, totalDays: 0 })),
        // ── Compensation: persist to SalaryStructure ──
        // For interns we send only the monthly basic; the API derives ctc =
        // basic × 12 and zeroes out HRA / PF / etc. For regular employees
        // we send the annual CTC and the API runs the full breakup.
        compensation: form.salaryType === "Intern"
          ? {
              salaryType:      "intern",
              monthlyBasic:    Number(form.basicPay) || 0,
              effectiveFrom:   form.joiningDate || undefined,
            }
          : {
              salaryType:      "regular",
              payGroup:        form.payGroup,
              annualCtc:       Number(form.annualSalary) || 0,
              bonusIncluded:   form.bonusIncluded,
              pfEligible:      form.pfEligible,
              taxRegime:       form.taxRegime,
              structureType:   form.salaryStructure,
              effectiveFrom:   form.joiningDate || undefined,
            },
      };

      const res  = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to onboard");

      setSuccess(
        data.isUpdate
          ? `${data.name}'s existing account was linked and onboarding details saved.`
          : `${data.name} onboarded successfully.`
      );
      // Mark this HRM ID as done so the import modal dims it on the
      // next file-pick. State is intentionally session-only — a fresh
      // page load resets it, matching how the draft is wiped below.
      if (form.employeeNumber) {
        setImportDoneIds((s) => new Set(s).add(form.employeeNumber));
      }
      // Wipe the draft so the next visit starts clean.
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      // Open the Team Welcome composer so HR can preview + send the
      // "Introducing X" announcement to the whole team. HR can skip it
      // (the modal's X / Cancel) and we redirect on close either way.
      // Auto-fill home city + manager from the form so the email reads
      // complete out of the box; the template gracefully drops any clause
      // we still don't have (e.g. prior role isn't collected here) instead
      // of printing a {{placeholder}}.
      setWelcomeFor({
        fullName:  data.name,
        firstName: form.firstName || data.name.split(" ")[0] || data.name,
        jobRole:   form.jobTitle || form.role || "Team member",
        workEmail: form.workEmail,
        homeCity:  form.city || undefined,
        managerName: managers.find((m: any) => String(m.id) === String(form.reportingManagerId))?.name || undefined,
        managerId: form.reportingManagerId ? Number(form.reportingManagerId) : undefined,
        officeLocation: form.location || undefined,
        phone: form.mobileNumber ? `${form.mobileCountry} ${form.mobileNumber}` : undefined,
        pronoun: form.gender === "female" ? "she" : form.gender === "male" ? "he" : "they",
      });
    } catch (e: any) {
      setError(e?.message || "Failed to onboard");
    } finally {
      setSaving(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  const steps = [
    { n: 1, label: "Basic Details",   Icon: UserIcon },
    { n: 2, label: "Job Details",     Icon: Briefcase },
    { n: 3, label: "Work Details",    Icon: SettingsIcon },
    { n: 4, label: "Compensation",    Icon: IndianRupee },
    { n: 5, label: "Address & IDs",   Icon: UserIcon },
    { n: 6, label: "Review",          Icon: ClipboardCheck },
  ] as const;

  return (
    <div className={`min-h-screen ${C.shell}`}>
      {/* ── Header with stepper ── */}
      <div className={`${C.card} border-b px-6 py-4 rounded-none`}>
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-4">
            <div>
              <h1 className={`text-[17px] font-semibold ${C.t1}`}>Add Employee Wizard</h1>
              <p className={`text-[12px] ${C.t3} mt-0.5`}>
                Onboard a new employee and optionally invite them to ClickUp
              </p>
            </div>
            {/* Draft status — shows "restored" on first load, then flips to
                "saved" as the user makes edits. */}
            {draftSavedAt && (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {draftRestoredAt && draftRestoredAt === draftSavedAt
                    ? `Draft restored · ${fmtRel(draftRestoredAt)}`
                    : `Draft saved · ${fmtRel(draftSavedAt)}`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Discard the saved draft and start over?")) clearDraft();
                  }}
                  className="text-[11px] text-slate-500 hover:text-red-500 underline-offset-2 hover:underline"
                >
                  Discard
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/dashboard/hr/people")}
              className="h-9 px-4 text-[13px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/5"
            >Cancel</button>
            {step > 1 && (
              <button
                onClick={() => setStep(s => (s - 1) as any)}
                className="h-9 px-5 text-[13px] font-semibold text-[#008CFF] border border-[#008CFF]/40 rounded-lg hover:bg-[#008CFF]/5"
              >Back</button>
            )}
            {step < 6 ? (
              <button
                onClick={() => stepValid && setStep(s => (s + 1) as any)}
                disabled={!stepValid}
                className="h-9 px-6 bg-[#008CFF] hover:bg-[#0070cc] disabled:opacity-40 text-white rounded-lg text-[13px] font-semibold"
              >{step === 5 ? "Review" : "Continue"}</button>
            ) : (
              <button
                onClick={submit}
                disabled={saving}
                className="h-9 px-6 bg-[#008CFF] hover:bg-[#0070cc] disabled:opacity-40 text-white rounded-lg text-[13px] font-semibold"
              >{saving ? "Saving..." : "Finish"}</button>
            )}
          </div>
        </div>

        {/* Stepper row */}
        <div className="flex items-center gap-2 mt-5 justify-center">
          {steps.map((s, i) => {
            const done    = step > s.n;
            const current = step === s.n;
            return (
              <div key={s.n} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors ${
                  done    ? "bg-emerald-500 text-white"
                  : current ? "bg-[#008CFF] text-white"
                            : "bg-slate-200 dark:bg-white/10 text-slate-500"
                }`}>{done ? <Check size={13} /> : s.n}</div>
                <span className={`text-[11px] font-bold tracking-widest uppercase ${
                  current ? "text-[#008CFF]" : "text-slate-500 dark:text-slate-400"
                }`}>{s.label}</span>
                {i < steps.length - 1 && (
                  <div className={`w-10 h-px ${done ? "bg-emerald-400" : "bg-slate-300 dark:bg-white/10"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Banners ── */}
      {prefilledFrom && (
        <div className="px-6 pt-4 space-y-2">
          <div className="flex items-start gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 text-emerald-700 text-[12.5px] ring-1 ring-emerald-200">
            <Check className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">
              Prefilled from hiring candidate <strong>{prefilledFrom.name}</strong> — verify everything before saving.
            </span>
            <button
              onClick={() => setPrefilledFrom(null)}
              className="text-emerald-600 hover:text-emerald-900 text-[12px] font-semibold"
            >Dismiss</button>
          </div>

          {/* Resume carried over from the application — HR doesn't need
              to re-upload. View opens in a new tab (auth-gated via the
              hiring resume endpoint); the file lives on the
              JobApplication row, not on the employee record. */}
          {prefilledFrom.resumeUrl && (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-blue-50/60 ring-1 ring-blue-200/70 text-[12.5px] text-slate-700">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white ring-1 ring-blue-200 text-[#1d4ed8] shrink-0">
                  📄
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 truncate">
                    Resume on file: <span className="font-mono text-[11.5px] text-slate-600">{prefilledFrom.resumeFileName ?? "Resume"}</span>
                  </p>
                  <p className="text-[11px] text-slate-500">Already uploaded during the application — no need to attach again.</p>
                </div>
              </div>
              <a
                href={prefilledFrom.resumeUrl}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[11.5px] font-semibold shrink-0"
              >
                View resume
              </a>
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="px-6 pt-4">
          <div className="flex items-start gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 text-red-500 text-[12.5px]">
            <X className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>
        </div>
      )}
      {success && (
        <div className="px-6 pt-4">
          <div className="flex items-start gap-2 px-4 py-2.5 rounded-lg bg-emerald-500/10 text-emerald-500 text-[12.5px]">
            <Check className="w-4 h-4 shrink-0 mt-0.5" /> {success}
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div className="p-6 max-w-5xl mx-auto">
        {/* Import-from-Keka entry point. Sits above the form so HR sees
            it before they start typing. The "Imported …" pill below
            confirms which row was just pulled in. */}
        {step === 1 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/[0.02]">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#008CFF]/10 text-[#008CFF]">
                <UploadIcon size={16} />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-slate-800 dark:text-white">Import Resume</p>
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
                  Upload a resume (PDF / Word) — auto-fills name, email, phone &amp; role. Verify before saving.
                </p>
                {importedFrom && (
                  <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    Imported {importedFrom.hrm} · {importedFrom.name}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setResumeOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-[#008CFF]/30 bg-[#008CFF]/5 px-3.5 py-2 text-[12.5px] font-semibold text-[#008CFF] transition-colors hover:bg-[#008CFF]/10 hover:border-[#008CFF]/50"
              >
                <UploadIcon size={13} />
                {importedFrom ? "Import another" : "Upload resume"}
              </button>
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                className="rounded-lg px-2.5 py-2 text-[11.5px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10"
                title="Bulk import from a Keka CSV / Excel export"
              >
                Keka CSV
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <StepCard title="Employee Details">
            <Grid cols={1}>
              <Field label="Work Country">
                <CustomSelect listKey="workCountry" defaults={["India", "USA", "UK", "UAE", "Singapore"]}
                  value={form.workCountry} onChange={v => set("workCountry", v)} />
              </Field>
            </Grid>
            <Grid>
              <Field label="First Name" required>
                <Input v={form.firstName} set={v => set("firstName", v)} placeholder="Write first name" />
              </Field>
              <Field label="Middle Name">
                <Input v={form.middleName} set={v => set("middleName", v)} placeholder="Write middle name (optional)" />
              </Field>
              <Field label="Last Name" required>
                <Input v={form.lastName} set={v => set("lastName", v)} placeholder="Write last name" />
              </Field>
              <Field label="Display Name" required>
                <Input v={form.displayName} set={v => { set("displayName", v); setDisplayTouched(true); }} />
              </Field>
              <Field label="Gender" required>
                <CustomSelect listKey="gender" defaults={["male", "female", "other"]}
                  value={form.gender} onChange={v => set("gender", v)} required />
              </Field>
              <Field label="Date of Birth" required>
                <DatePicker value={form.dateOfBirth} onChange={(v) => set("dateOfBirth", v)} />
              </Field>
              <Field label="Nationality">
                <CustomSelect listKey="nationality" defaults={["India", "USA", "UK", "Other"]}
                  value={form.nationality} onChange={v => set("nationality", v)} />
              </Field>
              <Field label="Number Series">
                <Select
                  v={form.numberSeries}
                  set={v => set("numberSeries", v)}
                  opts={
                    (Array.isArray(numberSeries) && numberSeries.length > 0)
                      ? numberSeries.filter((s: any) => s?.isActive !== false).map((s: any) => s.name)
                      : ["NB Media Series", "YT Labs Series"]
                  }
                />
              </Field>
              <Field
                label="Employee Number"
                hint={
                  nextEmployeeId
                    ? `Auto-generates as ${nextEmployeeId} if left empty`
                    : "Auto-generated if empty (e.g. HRM47)"
                }
              >
                <Input
                  v={form.employeeNumber}
                  set={(v) => set("employeeNumber", v)}
                  placeholder={nextEmployeeId || "e.g. HRM47"}
                />
              </Field>
            </Grid>

            <SectionTitle>Contact Details</SectionTitle>
            <Grid>
              <Field label="Work Email" required>
                <div className="relative" ref={emailFieldRef}>
                  <Input
                    type="email"
                    v={form.workEmail}
                    set={(v) => { set("workEmail", v); setShowSuggestions(true); }}
                    placeholder={
                      form.numberSeries === "YT Labs Series"
                        ? "e.g. name@ytlpro.com"
                        : "e.g. name@nbmediaproductions.com"
                    }
                    onBlur={() => {
                      // Auto-append the company domain when HR types
                      // just a local-part (no @). Skip if the field is
                      // empty, already has an @, or contains characters
                      // that aren't valid local-part chars (e.g. spaces
                      // — they're probably searching by name, not
                      // typing an email). The autocomplete suggestions
                      // use onMouseDown+preventDefault, so picking a
                      // suggestion doesn't trigger this blur.
                      const trimmed = form.workEmail.trim();
                      if (!trimmed || trimmed.includes("@")) return;
                      if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) return;
                      const domain = form.numberSeries === "YT Labs Series"
                        ? "ytlpro.com"
                        : "nbmediaproductions.com";
                      set("workEmail", `${trimmed.toLowerCase()}@${domain}`);
                    }}
                  />
                  <PopupPanel
                    open={showSuggestions && suggestions.length > 0}
                    triggerRef={emailFieldRef}
                    maxHeight={264}
                    className="rounded-lg border border-slate-200 bg-white shadow-2xl overflow-y-auto dark:border-white/[0.08] dark:bg-[#0a1526]"
                  >
                    <ul>
                      {suggestions.map((u: any) => {
                        const initials = String(u.name ?? "?")
                          .split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase();
                        const onboarded = !!u.employeeProfile;
                        return (
                          <li key={u.id}>
                            <button
                              type="button"
                              onMouseDown={(e) => { e.preventDefault(); pickSuggestion(u); }}
                              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[#008CFF]/[0.06]"
                            >
                              {u.profilePictureUrl ? (
                                <img src={u.profilePictureUrl} alt="" className="h-7 w-7 rounded-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#008CFF] text-[10px] font-bold text-white">{initials}</span>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12.5px] font-semibold text-slate-800 dark:text-white">{u.name || u.email}</p>
                                <p className="truncate text-[11px] text-slate-500">{u.email}</p>
                              </div>
                              {onboarded && (
                                <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-100">Onboarded</span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </PopupPanel>
                </div>
                {lookup.kind === "loading" && suggestions.length === 0 && (
                  <p className="mt-1.5 text-[11px] text-slate-400">Searching…</p>
                )}
                {lookup.kind === "match-fresh" && (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Linking to existing user · <strong>{lookup.name}</strong>
                  </p>
                )}
                {lookup.kind === "match-onboarded" && (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    Already onboarded as <strong>{lookup.employeeId}</strong> ({lookup.name})
                  </p>
                )}
              </Field>
              <Field label="Mobile Number">
                <div className="flex gap-2">
                  <div className="w-20">
                    <Select v={form.mobileCountry} set={v => set("mobileCountry", v)} opts={["+91", "+1", "+44", "+971"]} />
                  </div>
                  <Input v={form.mobileNumber} set={v => set("mobileNumber", v)} placeholder="Write mobile number" />
                </div>
              </Field>
              <Field label="Work Phone">
                <Input v={form.workPhone} set={v => set("workPhone", v)} placeholder="Work landline / extension" />
              </Field>
              <Field label="Home Phone">
                <Input v={form.homePhone} set={v => set("homePhone", v)} placeholder="Home landline" />
              </Field>
              <Field label="Personal Email">
                <Input type="email" v={form.personalEmail} set={v => set("personalEmail", v)} placeholder="personal@example.com" />
              </Field>
            </Grid>
          </StepCard>
        )}

        {/* Personal Details & Family + Emergency Contact moved to the
            employee's own profile page (ABOUT tab) so the employee fills
            these in themselves rather than HR collecting them at
            onboarding. */}

        {step === 2 && (
          <StepCard title="Employment Details">
            <Grid>
              <Field label="Joining Date" required>
                <DatePicker value={form.joiningDate} onChange={v => set("joiningDate", v)} futureYears={2} />
              </Field>
              <Field label="Job Designation" required>
                {/* Wired to the RBAC Designation list (brand-scoped) — the same
                    source as Edit Profile, so onboarding links to a real
                    designation instead of a free-text/old title. */}
                <Select
                  v={form.jobTitle}
                  set={v => set("jobTitle", v)}
                  opts={[
                    { value: "", label: "— Select designation —" },
                    ...designationOptions.map((d) => ({ value: d.label, label: d.label })),
                  ]}
                />
              </Field>
              <Field label="Secondary Job Title">
                <Select
                  v={form.secondaryJobTitle}
                  set={v => set("secondaryJobTitle", v)}
                  opts={[
                    { value: "", label: "— None —" },
                    ...jobTitleSource(brandFromNumberSeries(form.numberSeries)).defaults,
                  ]}
                />
              </Field>
              <Field label="Time Type" required>
                <CustomSelect listKey="timeType" defaults={["Full Time", "Part Time"]}
                  value={form.timeType} onChange={v => set("timeType", v)} required />
              </Field>
            </Grid>

            <SectionTitle>Organisational Details</SectionTitle>
            <Grid>
              <Field label="Legal Entity" required>
                <CustomSelect listKey="legalEntity" defaults={["NB Media Productions", "YT Labs"]}
                  value={form.legalEntity} onChange={v => set("legalEntity", v)} required />
              </Field>
              <Field label="Business Unit">
                <CustomSelect listKey="businessUnit" defaults={["NB Media", "YT Labs"]}
                  value={form.businessUnit} onChange={v => set("businessUnit", v)} />
              </Field>
              <Field label="Department" required>
                {/* Company-scoped: YT Labs picks from DEPARTMENTS_YT_LABS,
                    NB Media from DEPARTMENTS. The listKey also swaps so
                    custom additions stay scoped per brand. */}
                <CustomSelect
                  listKey={departmentSource(brandFromNumberSeries(form.numberSeries)).listKey}
                  defaults={departmentSource(brandFromNumberSeries(form.numberSeries)).defaults}
                  value={form.department}
                  onChange={v => set("department", v)}
                  placeholder="Select a department"
                  required
                />
              </Field>
              <Field label="Location" required>
                <CustomSelect listKey="location" defaults={["Mohali", "Remote", "Hybrid"]}
                  value={form.location} onChange={v => set("location", v)} required />
              </Field>
              <Field label="Worker Type" required>
                <Select v={form.workerType} set={v => set("workerType", v)} opts={["Regular Employee", "Intern"]} />
              </Field>
              <Field label="Reporting Manager" required>
                <Select
                  v={form.reportingManagerId}
                  set={v => set("reportingManagerId", v)}
                  opts={[{ value: "", label: "— Select —" }, ...managers.map((m: any) => ({ value: String(m.id), label: `${m.name} · ${m.orgLevel}` }))]}
                />
              </Field>
              <Field label="Inline Manager">
                <Select
                  v={form.dottedLineManagerId}
                  set={v => set("dottedLineManagerId", v)}
                  opts={[{ value: "", label: "— None —" }, ...managers.map((m: any) => ({ value: String(m.id), label: m.name }))]}
                />
              </Field>
            </Grid>

            <SectionTitle>Employment Terms</SectionTitle>
            <Grid>
              <Field label="Probation Policy" required>
                <CustomSelect
                  listKey="probationPolicy"
                  defaults={["Interns (3 Months)", "Interns (6 Months)", "Interns (12 Months)", "Regular Employees"]}
                  value={form.probationPolicy} onChange={v => set("probationPolicy", v)}
                  required
                />
              </Field>
              <Field label="Notice Period (days)" required>
                <Input type="number" v={form.noticePeriodDays} set={v => set("noticePeriodDays", v)} placeholder="30" />
              </Field>
              <Field label="Job Location" required>
                <CustomSelect listKey="jobLocation" defaults={["Mohali", "Delhi", "Mumbai", "Remote"]}
                  value={form.jobLocation} onChange={v => set("jobLocation", v)} required />
              </Field>
              {form.workerType === "Intern" && (
                <Field label="Internship End Date">
                  <DatePicker value={form.internshipEndDate} onChange={v => set("internshipEndDate", v)} futureYears={2} />
                </Field>
              )}
            </Grid>
          </StepCard>
        )}

        {step === 3 && (
          <StepCard title="Onboarding Settings">
            <div className="space-y-3">
              <Toggle
                checked={form.inviteToLogin}
                onChange={v => set("inviteToLogin", v)}
                label="Invite employee to login"
                hint="Sends a welcome email with a link to sign in via Google using this work email — no password is set, the dashboard is Google-OAuth only."
              />
              <Toggle
                checked={form.enableOnboarding}
                onChange={v => set("enableOnboarding", v)}
                label="Enable onboarding flow"
                hint="On their first sign-in we'll redirect them to a short wizard to confirm contact details (mobile, address, emergency contact) before they see the dashboard."
              />
            </div>

            <SectionTitle>Leave Settings</SectionTitle>
            <Grid>
              <Field label="Leave Policy">
                <select
                  value={form.leavePolicyId === "" ? "" : String(form.leavePolicyId)}
                  onChange={(e) => set("leavePolicyId", e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/30"
                >
                  <option value="">— None (manual balances) —</option>
                  {leavePolicies
                    .filter((p) => p.isActive || p.id === form.leavePolicyId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{!p.isActive ? " (inactive)" : ""}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Holiday List">
                <CustomSelect listKey="holidayList" defaults={["Default Holiday List"]}
                  value={form.holidayList} onChange={v => set("holidayList", v)} />
              </Field>
            </Grid>
            {leaveTypes.length > 0 && (
              <p className={`text-[11px] ${C.t3} mt-1`}>
                {leaveTypes.length} leave types will be credited: {leaveTypes.map((l: any) => `${l.code} (${l.daysPerYear}d)`).join(", ")}
              </p>
            )}

            <SectionTitle>Attendance Settings</SectionTitle>
            <Toggle
              checked={form.attendanceTracking}
              onChange={v => set("attendanceTracking", v)}
              label="Attendance Tracking"
              hint="Track daily clock-in/clock-out for this employee."
            />
            <Grid>
              <Field label="Shift" required>
                <Select
                  v={form.shiftId}
                  set={v => set("shiftId", v)}
                  opts={[{ value: "", label: "— Select —" }, ...shifts.map((s: any) => ({ value: String(s.id), label: `${s.name} (${s.startTime}–${s.endTime})` }))]}
                />
              </Field>
              <Field label="Weekly Off">
                <CustomSelect listKey="weeklyOff" defaults={["Standard Weekly Off", "Saturday Off Alt"]}
                  value={form.weeklyOff} onChange={v => set("weeklyOff", v)} />
              </Field>
              <Field label="Attendance Number">
                <Input
                  v={form.attendanceNumber}
                  set={v => { setAttendanceTouched(true); set("attendanceNumber", v); }}
                  placeholder={fullEmployeeId || "Auto-fills from employee number"}
                />
              </Field>
              <Field label="Time Tracking Policy">
                <CustomSelect listKey="timeTrackingPolicy" defaults={["On-Site Capture", "Remote Capture", "Hybrid Capture", "None"]}
                  value={form.timeTrackingPolicy}
                  onChange={v => {
                    // Smart cascade — keep Time Tracking Policy in
                    // sync with Capture Scheme + auto-clear
                    // Penalisation when tracking is set to None.
                    setForm(f => {
                      const next = { ...f, timeTrackingPolicy: v };
                      if (v === "On-Site Capture") next.attendanceCaptureScheme = "On-Site";
                      else if (v === "Remote Capture") next.attendanceCaptureScheme = "Remote";
                      else if (v === "Hybrid Capture") next.attendanceCaptureScheme = "Hybrid";
                      else if (v === "None") {
                        next.attendanceCaptureScheme = "";
                        next.penalizationPolicy = "None";
                      }
                      return next;
                    });
                  }} />
              </Field>
              <Field label="Penalization Policy">
                <CustomSelect listKey="penalizationPolicy" defaults={["Default", "Strict", "Lenient", "None"]}
                  value={form.penalizationPolicy} onChange={v => set("penalizationPolicy", v)} />
              </Field>
              <Field label="Attendance Capture Scheme">
                <Select v={form.attendanceCaptureScheme}
                  set={v => {
                    // Reverse leg of the cascade — keep Time Tracking
                    // Policy aligned with the capture scheme.
                    setForm(f => {
                      const next = { ...f, attendanceCaptureScheme: v };
                      if (v === "On-Site") next.timeTrackingPolicy = "On-Site Capture";
                      else if (v === "Remote") next.timeTrackingPolicy = "Remote Capture";
                      else if (v === "Hybrid") next.timeTrackingPolicy = "Hybrid Capture";
                      return next;
                    });
                  }}
                  opts={["On-Site", "Remote", "Hybrid"]} />
              </Field>
              <Field label="Cost Center">
                <CustomSelect listKey="costCenter" defaults={["NB Media", "YT Labs"]}
                  value={form.costCenter} onChange={v => set("costCenter", v)} />
              </Field>
            </Grid>
          </StepCard>
        )}

        {step === 4 && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-6">
            <StepCard title="Compensation">
              <Grid>
                <Field label="Salary Type" required>
                  <Select v={form.salaryType} set={v => set("salaryType", v)} opts={["Regular Employee", "Intern"]} />
                </Field>
              </Grid>

              {form.salaryType === "Intern" ? (
                // Interns are paid a flat monthly stipend — no PF, bonus,
                // tax regime, structure, etc. Keep the surface area tiny
                // on purpose so HR doesn't accidentally fill in fields
                // that don't apply to a stipend.
                <Grid>
                  <Field label="Monthly Stipend (INR / month)" required>
                    <Input type="number" v={form.basicPay} set={v => set("basicPay", v)} placeholder="Enter monthly stipend" />
                  </Field>
                </Grid>
              ) : (
                <>
                  <Grid>
                    <Field label="Pay Group">
                      <CustomSelect listKey="payGroup" defaults={["NB Media", "Contractor"]}
                        value={form.payGroup} onChange={v => set("payGroup", v)} />
                    </Field>
                    <Field label="Annual Salary (INR)">
                      <Input type="number" v={form.annualSalary} set={v => set("annualSalary", v)} placeholder="Enter annual salary" />
                    </Field>
                  </Grid>

                  <SectionTitle>Bonus Details</SectionTitle>
                  <label className={`flex items-center gap-2 text-[12.5px] ${C.t2}`}>
                    <input type="checkbox" checked={form.bonusIncluded} onChange={e => set("bonusIncluded", e.target.checked)} />
                    Bonus included in annual salary of INR {Number(form.annualSalary || 0).toLocaleString("en-IN")}
                  </label>
                  <button className="h-8 px-3 text-[12px] font-semibold text-[#008CFF] border border-[#008CFF]/40 rounded-lg hover:bg-[#008CFF]/5 w-fit">+ Add Bonus</button>

                  <SectionTitle>Payroll Settings</SectionTitle>
                  <label className={`flex items-center gap-2 text-[12.5px] ${C.t2}`}>
                    <input type="checkbox" checked={form.pfEligible} onChange={e => set("pfEligible", e.target.checked)} />
                    Provident fund (PF) eligible
                  </label>
                  <div className="px-3 py-2 bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 rounded-lg text-[11.5px]">
                    ESI is not applicable for the selected Pay Group
                  </div>

                  <Grid>
                    <Field label="Salary Structure Type">
                      <CustomSelect listKey="salaryStructure" defaults={["Range Based", "Fixed"]}
                        value={form.salaryStructure} onChange={v => set("salaryStructure", v)} />
                    </Field>
                    <Field label="Tax Regime">
                      <CustomSelect listKey="taxRegime" defaults={["New Regime (Section 115BAC)", "Old Regime"]}
                        value={form.taxRegime} onChange={v => set("taxRegime", v)} />
                    </Field>
                  </Grid>
                </>
              )}
              <p className={`text-[10.5px] ${C.t3} italic`}>
                Saved to the employee's salary structure on submit.
              </p>
            </StepCard>

            {/* Salary Breakup preview */}
            <div className={`${C.card} rounded-2xl p-5 h-fit`}>
              <p className={`text-[14px] font-semibold ${C.t1}`}>
                {form.salaryType === "Intern" ? "Stipend Summary" : "Salary Breakup"}
              </p>
              <p className={`text-[10.5px] ${C.t3} uppercase tracking-widest mt-3`}>Effective From</p>
              <p className={`text-[13px] ${C.t1} mt-0.5`}>{new Date(form.joiningDate || Date.now()).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>

              {form.salaryType === "Intern" ? (
                <div className="mt-5 pt-3 border-t border-slate-200 dark:border-white/[0.06]">
                  <div className="flex items-center justify-between text-[12.5px] font-semibold">
                    <span className={C.t1}>Monthly Stipend</span>
                    <span className={`${C.t1} font-mono`}>
                      {Number(form.basicPay || 0).toLocaleString("en-IN")} / mo
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11.5px]">
                    <span className={C.t2}>Annualised</span>
                    <span className={`${C.t2} font-mono`}>
                      {(Number(form.basicPay || 0) * 12).toLocaleString("en-IN")} / yr
                    </span>
                  </div>
                  <p className={`text-[10.5px] ${C.t3} mt-3 leading-relaxed`}>
                    Interns are paid a flat monthly stipend — no PF, ESI,
                    bonuses, or tax-regime selection.
                  </p>
                </div>
              ) : (
                <>
                  {/* Column headers — monthly first, annual second (matches the
                      policy table in the Keka screenshots). */}
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest mt-5 pb-1 border-b border-slate-200 dark:border-white/[0.06]">
                    <span className={C.t3}>Component</span>
                    <span className={C.t3}>Monthly / Annually</span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {salaryBreakup(Number(form.annualSalary) || 0, form.pfEligible).map(([label, monthly, annual]) => (
                      <div key={label} className="flex items-center justify-between text-[12px]">
                        <span className={C.t2}>{label}</span>
                        <span className={`${C.t1} font-mono`}>
                          {monthly.toLocaleString("en-IN")} / {annual.toLocaleString("en-IN")}
                        </span>
                      </div>
                    ))}
                    <div className="pt-2 mt-2 border-t border-slate-200 dark:border-white/[0.08] flex items-center justify-between text-[12.5px] font-semibold">
                      <span className={C.t1}>CTC</span>
                      <span className={`${C.t1} font-mono`}>
                        {Math.round(Number(form.annualSalary || 0) / 12).toLocaleString("en-IN")} / {Number(form.annualSalary || 0).toLocaleString("en-IN")}
                      </span>
                    </div>
                  </div>
                  <p className={`text-[10.5px] ${C.t3} mt-3 leading-relaxed`}>
                    {form.pfEligible
                      ? "PF is 12% of Basic, capped at ₹1,800/month (₹15,000 basic ceiling)."
                      : "PF is disabled — enable the toggle above to include it."}
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {step === 5 && (
          <>
            <StepCard title="Current Address">
              <Grid>
                <Field label="Address Line 1">
                  <Input v={form.addressLine1} set={v => set("addressLine1", v)} placeholder="House / street" />
                </Field>
                <Field label="Address Line 2">
                  <Input v={form.addressLine2} set={v => set("addressLine2", v)} placeholder="Area / landmark (optional)" />
                </Field>
                <Field label="City">
                  <Input v={form.city} set={v => set("city", v)} placeholder="e.g. Mohali" />
                </Field>
                <Field label="State">
                  <Input v={form.state} set={v => set("state", v)} placeholder="e.g. Punjab" />
                </Field>
                <Field label="Pincode">
                  <Input v={form.addressPincode} set={v => set("addressPincode", v)} placeholder="6-digit pincode" />
                </Field>
                <Field label="Country">
                  <Input v={form.addressCountry} set={v => set("addressCountry", v)} placeholder="India" />
                </Field>
              </Grid>
            </StepCard>

            <StepCard title="Permanent Address">
              <label className="mb-3 inline-flex items-center gap-2 text-[12.5px] text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sameAsCurrent}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setSameAsCurrent(next);
                    // Clear permanent fields on uncheck so synced values
                    // don't linger and look like deliberate input.
                    if (!next) {
                      setForm((f) => ({
                        ...f,
                        permanentLine1:   "",
                        permanentLine2:   "",
                        permanentCity:    "",
                        permanentState:   "",
                        permanentPincode: "",
                        permanentCountry: "India",
                      }));
                    }
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-[#3b82f6] focus:ring-[#3b82f6]/30"
                />
                Same as Current Address
              </label>
              <Grid>
                <Field label="Address Line 1">
                  <Input v={form.permanentLine1} set={v => set("permanentLine1", v)} placeholder="House / street" disabled={sameAsCurrent} />
                </Field>
                <Field label="Address Line 2">
                  <Input v={form.permanentLine2} set={v => set("permanentLine2", v)} placeholder="Area / landmark (optional)" disabled={sameAsCurrent} />
                </Field>
                <Field label="City">
                  <Input v={form.permanentCity} set={v => set("permanentCity", v)} placeholder="City" disabled={sameAsCurrent} />
                </Field>
                <Field label="State">
                  <Input v={form.permanentState} set={v => set("permanentState", v)} placeholder="State" disabled={sameAsCurrent} />
                </Field>
                <Field label="Pincode">
                  <Input v={form.permanentPincode} set={v => set("permanentPincode", v)} placeholder="6-digit pincode" disabled={sameAsCurrent} />
                </Field>
                <Field label="Country">
                  <Input v={form.permanentCountry} set={v => set("permanentCountry", v)} placeholder="India" disabled={sameAsCurrent} />
                </Field>
              </Grid>
            </StepCard>

            <StepCard title="Government IDs & Biometric">
              <Grid>
                <Field label="PAN Number">
                  <Input v={form.panNumber} set={v => set("panNumber", v)} placeholder="ABCDE1234F" />
                </Field>
                <Field label="Aadhaar Number">
                  <Input v={form.aadhaarNumber} set={v => set("aadhaarNumber", v)} placeholder="12-digit Aadhaar" />
                </Field>
                <Field label="PF Number">
                  <Input v={form.pfNumber} set={v => set("pfNumber", v)} placeholder="Provident Fund number" />
                </Field>
                <Field label="UAN Number">
                  <Input v={form.uanNumber} set={v => set("uanNumber", v)} placeholder="Universal Account Number" />
                </Field>
                <Field label="Biometric ID" hint="As assigned by office biometric system">
                  <Input v={form.biometricId} set={v => set("biometricId", v)} placeholder="e.g. 87" />
                </Field>
              </Grid>
            </StepCard>
          </>
        )}

        {step === 6 && (
          <div className="space-y-5">
            {/* Intro banner */}
            <div className="rounded-2xl border border-[#008CFF]/20 bg-[#008CFF]/[0.04] px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#008CFF]/10 text-[#008CFF]">
                  <ClipboardCheck size={17} />
                </div>
                <div>
                  <p className="text-[13.5px] font-semibold text-slate-800 dark:text-white">Review &amp; confirm</p>
                  <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Check every detail below before you finish. Hit <strong>Back</strong> to fix anything. After you click
                    {" "}<strong>Finish</strong> the welcome email opens so you can edit it, attach a photo and send it to the team.
                  </p>
                </div>
              </div>
            </div>

            {/* Details summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <StepCard title="Basic Details">
                <div>
                  <ReviewRow label="Full name"        value={reviewFullName} />
                  <ReviewRow label="Display name"     value={form.displayName} />
                  <ReviewRow label="Gender"           value={form.gender} />
                  <ReviewRow label="Date of birth"    value={form.dateOfBirth} />
                  <ReviewRow label="Work email"       value={form.workEmail} />
                  <ReviewRow label="Personal email"   value={form.personalEmail} />
                  <ReviewRow label="Mobile"           value={reviewMobile} />
                  <ReviewRow label="Employee number"  value={form.employeeNumber} />
                  <ReviewRow label="Number series"    value={form.numberSeries} />
                </div>
              </StepCard>

              <StepCard title="Job Details">
                <div>
                  <ReviewRow label="Job Designation"   value={form.jobTitle} />
                  <ReviewRow label="Department"        value={form.department} />
                  <ReviewRow label="Joining date"     value={form.joiningDate} />
                  <ReviewRow label="Reporting manager" value={reviewManagerName} />
                  <ReviewRow label="Worker type"      value={form.workerType} />
                  <ReviewRow label="Time type"        value={form.timeType} />
                  <ReviewRow label="Location"         value={form.location} />
                  <ReviewRow label="Legal entity"     value={form.legalEntity} />
                  <ReviewRow label="Business unit"    value={form.businessUnit} />
                </div>
              </StepCard>

              <StepCard title="Work Details">
                <div>
                  <ReviewRow label="Invite to login"    value={form.inviteToLogin ? "Yes" : "No"} />
                  <ReviewRow label="Enable onboarding"  value={form.enableOnboarding ? "Yes" : "No"} />
                  <ReviewRow label="Shift"              value={reviewShiftName} />
                  <ReviewRow label="Weekly off"         value={form.weeklyOff} />
                  <ReviewRow label="Attendance scheme"  value={form.attendanceCaptureScheme} />
                  <ReviewRow label="Cost center"        value={form.costCenter} />
                  <ReviewRow label="Notice period"      value={form.noticePeriodDays ? `${form.noticePeriodDays} days` : ""} />
                </div>
              </StepCard>

              <StepCard title="Compensation">
                <div>
                  <ReviewRow label="Salary type" value={form.salaryType} />
                  {form.salaryType === "Intern" ? (
                    <ReviewRow label="Monthly basic" value={form.basicPay ? `₹${form.basicPay}` : ""} />
                  ) : (
                    <>
                      <ReviewRow label="Annual CTC"     value={form.annualSalary ? `₹${form.annualSalary}` : ""} />
                      <ReviewRow label="Pay group"      value={form.payGroup} />
                      <ReviewRow label="Bonus included" value={form.bonusIncluded ? "Yes" : "No"} />
                      <ReviewRow label="PF eligible"    value={form.pfEligible ? "Yes" : "No"} />
                      <ReviewRow label="Tax regime"     value={form.taxRegime} />
                    </>
                  )}
                </div>
              </StepCard>
            </div>

            <StepCard title="Address & Government IDs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                <div>
                  <ReviewRow label="Current address"   value={reviewCurrentAddr} />
                  <ReviewRow label="Permanent address" value={reviewPermanentAddr} />
                </div>
                <div>
                  <ReviewRow label="PAN"          value={form.panNumber} />
                  <ReviewRow label="Aadhaar"      value={form.aadhaarNumber} />
                  <ReviewRow label="PF / UAN"     value={[form.pfNumber, form.uanNumber].filter(Boolean).join(" / ")} />
                  <ReviewRow label="Biometric ID" value={form.biometricId} />
                </div>
              </div>
            </StepCard>

            {/* Welcome email preview */}
            <StepCard title="Welcome email preview">
              <p className="-mt-2 text-[11.5px] text-slate-500 dark:text-slate-400">
                Sent to the whole team as an announcement. This is a preview — you can edit the wording and attach
                {" "}{form.firstName || "the new joiner"}&apos;s photo in the next step, after you click Finish.
              </p>
              <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 dark:bg-white/[0.03] border-b border-slate-200 dark:border-white/10">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Subject</p>
                  <p className="text-[13px] font-semibold text-slate-800 dark:text-white mt-0.5">{welcomePreview.subject}</p>
                </div>
                <div className="px-4 py-4 max-h-[380px] overflow-y-auto bg-white dark:bg-[#0a1526]">
                  <pre
                    className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-slate-700 dark:text-slate-200 m-0"
                    style={{ fontFamily: '"Times New Roman", Times, serif' }}
                  >{welcomePreview.body}</pre>
                </div>
              </div>
            </StepCard>
          </div>
        )}
      </div>

      <ImportResumeModal
        open={resumeOpen}
        onClose={() => setResumeOpen(false)}
        onParsed={handleResumePick}
      />

      <KekaImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onPick={handleImportPick}
        managers={managers}
        allUsers={allUsers}
        onboardedIds={mergedOnboardedIds}
        onBulkComplete={(createdHrmIds) => {
          // Add bulk-created IDs to the session set so re-opening the
          // modal greys them immediately, then refresh the canonical
          // list from the server (picks up the freshly-created rows).
          setImportDoneIds((s) => {
            const next = new Set(s);
            createdHrmIds.forEach((id) => next.add(id));
            return next;
          });
          refreshOpts();
        }}
      />

      {welcomeFor && (
        <TeamWelcomeModal
          newJoiner={welcomeFor}
          onClose={() => {
            setWelcomeFor(null);
            router.push("/dashboard/hr/admin");
          }}
          onSent={() => {
            setSuccess((s) => s + " Team welcome email sent.");
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny presentational helpers — keep the page file self-contained.
// ─────────────────────────────────────────────────────────────────────────────
function StepCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${C.card} rounded-2xl p-6 space-y-5`}>
      <h2 className={C.section}>{title}</h2>
      {children}
    </div>
  );
}
// One label/value line in the Review step. Empty values render as a muted
// "Not set" so HR can spot gaps at a glance. `whitespace-pre-line` lets the
// multi-line address strings wrap on their own newlines.
function ReviewRow({ label, value }: { label: string; value?: React.ReactNode }) {
  const empty = value === undefined || value === null || value === "";
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-slate-100 dark:border-white/[0.05] last:border-0">
      <span className="text-[12px] font-medium text-slate-500 dark:text-slate-400 shrink-0">{label}</span>
      <span className={`text-[13px] text-right whitespace-pre-line ${empty ? "text-slate-300 dark:text-slate-600 italic" : "text-slate-800 dark:text-white font-medium"}`}>
        {empty ? "Not set" : value}
      </span>
    </div>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className={`${C.section} pt-3`}>{children}</h3>;
}
function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: 1 | 2 | 3 }) {
  const cls = cols === 1 ? "grid-cols-1" : cols === 3 ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2";
  return <div className={`grid ${cls} gap-4`}>{children}</div>;
}
function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={C.label}>{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div className="mt-1">{children}</div>
      {hint && <p className={`text-[10.5px] ${C.t3} mt-0.5`}>{hint}</p>}
    </div>
  );
}
function Input({ v, set, type = "text", placeholder, disabled, onBlur }: {
  v: string;
  set: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  onBlur?: () => void;
}) {
  return <input type={type} value={v} disabled={disabled} onChange={e => set(type === "email" ? e.target.value.toLowerCase() : e.target.value)} onBlur={onBlur} placeholder={placeholder} className={`${C.input} disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed`} />;
}

function Select({ v, set, opts }: { v: string; set: (v: string) => void; opts: (string | { value: string; label: string })[] }) {
  return <SelectField value={v} onChange={set} options={opts} className={C.input} />;
}
function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 mt-0.5 ${
          checked ? "bg-[#008CFF]" : "bg-slate-200 dark:bg-white/10"
        }`}
      >
        <span className={`block w-3.5 h-3.5 bg-white rounded-full absolute top-[3px] transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-[3px]"
        }`} />
      </button>
      <div>
        <p className={`text-[13px] font-medium ${C.t1}`}>{label}</p>
        {hint && <p className={`text-[11px] ${C.t3} mt-0.5`}>{hint}</p>}
      </div>
    </label>
  );
}

// Salary breakdown — matches the NB Media policy:
//   Basic              50% of monthly CTC
//   HRA                20%
//   PF (if enabled)    min(Basic × 12%, ₹1,800/mo)   — statutory cap on ₹15k basic
//   Dearness Allowance 10%
//   Conveyance         7.5%
//   Medical Allowance  Flat ₹1,250/mo (₹15,000/yr)
//   Special Allowance  Remaining balance
// Returns [label, monthly, annual] tuples in display order.
function salaryBreakup(annual: number, pfEligible: boolean): [string, number, number][] {
  const monthly = annual / 12;
  const basic      = Math.round(monthly * 0.50);
  const hra        = Math.round(monthly * 0.20);
  const da         = Math.round(monthly * 0.10);
  const conveyance = Math.round(monthly * 0.075);
  const medical    = 1250;
  const pf = pfEligible ? Math.min(Math.round(basic * 0.12), 1800) : 0;

  const consumed = basic + hra + da + conveyance + medical + pf;
  const special  = Math.max(0, Math.round(monthly) - consumed);

  const row = (l: string, m: number): [string, number, number] => [l, m, m * 12];

  const rows: [string, number, number][] = [row("Basic", basic), row("HRA", hra)];
  if (pfEligible) rows.push(row("PF", pf));
  rows.push(
    row("Dearness Allowance",  da),
    row("Conveyance Allowance", conveyance),
    row("Medical Allowance",    medical),
    row("Special Allowance",    special),
  );
  return rows;
}
