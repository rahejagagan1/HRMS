"use client";

// Comprehensive edit form for the user profile page. Mirrors the
// onboarding wizard's section list, but renders inline (no multi-step
// gating) since the user already exists. Each section saves
// independently via PATCH on /api/hr/people/[id] so HR can update one
// area without rewriting the whole row.
//
// Visibility / authorization is gated by the parent page: this panel
// only renders for the HR-admin tier (CEO / dev / admin / special_access
// / hr_manager). The Compensation section is gated by a narrower
// `canSeeSalary` prop — only HR Manager / CEO / developer see it.

import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import {
  AlertCircle, CheckCircle2, Save, User, Phone, MapPin, Briefcase,
  ShieldCheck, Wallet, Landmark,
} from "lucide-react";
import SalaryStructurePanel from "@/components/hr/SalaryStructurePanel";
import CustomSelect from "@/components/ui/CustomSelect";
import SelectField from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/date-field";
import ScheduleManagerChange from "@/components/hr/ScheduleManagerChange";
import { DEPARTMENTS } from "@/lib/departments";
import { legacyFromDesignationKey } from "@/lib/permissions/designation-seed";
import {
  brandFromBusinessUnit,
  jobTitleSource,
  departmentSource,
} from "@/lib/company-taxonomy";

type Manager = { id: number; name: string };

type Props = {
  userId: number;
  user: any;        // Result of GET /api/hr/people/[id]
  managers: Manager[];
  canSeeSalary?: boolean;
};

const cls = {
  field:    "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed",
  textarea: "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 resize-none disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed",
  label:    "block text-[11.5px] font-semibold text-slate-600 mb-1",
};

function dateISO(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v.slice(0, 10);
  try { return new Date(v).toISOString().slice(0, 10); } catch { return ""; }
}

// One reusable card per section — keeps spacing / save-button styling
// uniform across all five sections without duplicating the chrome.
function Section({
  title, icon: Icon, accent, saving, error, savedAt, onSave, children,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent: string;
  saving: boolean;
  error: string;
  savedAt: number | null;
  onSave: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <span aria-hidden className="block h-[3px] w-full" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}80 60%, transparent)` }} />
      <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1"
          style={{ background: `${accent}14`, color: accent, boxShadow: `inset 0 0 0 1px ${accent}33` }}
        >
          <Icon size={16} />
        </div>
        <h3 className="text-[14.5px] font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="space-y-4 px-6 py-5">
        {children}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {savedAt && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-700">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <span>Saved.</span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[#2563eb] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save size={13} />
            {saving ? "Saving…" : "Save section"}
          </button>
        </div>
      </div>
    </section>
  );
}

// Hook for a section's save lifecycle — keeps every section's UX
// identical (saving/error/savedAt) without copy-paste.
function useSaveSection(userId: number) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true); setError(""); setSavedAt(null);
    try {
      const res = await fetch(`/api/hr/people/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Save failed");
      setSavedAt(Date.now());
      mutate(`/api/hr/people/${userId}`);
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return { saving, error, savedAt, save };
}

export default function EditProfilePanel({ userId, user, managers, canSeeSalary = false }: Props) {
  const p = user.profile || {};

  // ── Section: Basic Details ─────────────────────────────────────────
  // Family (Father / Mother / Spouse / Children) lives in this section
  // too — it's "personal information about the employee", same surface.
  const [basic, setBasic] = useState({
    displayName:   user.name ?? "",
    employeeId:    p.employeeId ?? "",
    firstName:     p.firstName ?? "",
    middleName:    p.middleName ?? "",
    lastName:      p.lastName ?? "",
    dateOfBirth:   dateISO(p.dateOfBirth),
    gender:        p.gender ?? "",
    bloodGroup:    p.bloodGroup ?? "",
    maritalStatus: p.maritalStatus ?? "",
    physicallyHandicapped: p.physicallyHandicapped ?? "No",
    // Father Name persists into the existing `parentName` column (Keka
    // calls it Father Name; the column was originally for the PAN
    // father's-or-spouse's-name).
    fatherName:    p.parentName ?? "",
    motherName:    p.motherName ?? "",
    spouseName:    p.spouseName ?? "",
    childrenNames: p.childrenNames ?? "",
  });
  const basicHook = useSaveSection(userId);

  // ── Section: Contact ──────────────────────────────────────────────
  const [contact, setContact] = useState({
    personalEmail:         p.personalEmail ?? "",
    phone:                 p.phone ?? "",
    workPhone:             p.workPhone ?? "",
    homePhone:             p.homePhone ?? "",
    emergencyRelationship: p.emergencyRelationship ?? "",
  });
  const contactHook = useSaveSection(userId);

  // ── Section: Address ──────────────────────────────────────────────
  // Holds BOTH current and permanent address now. The legacy `address`
  // column is treated as Current → Address Line 1; everything else lives
  // in dedicated columns (addressLine2 / addressPincode / addressCountry
  // / permanent*).
  const [address, setAddress] = useState({
    address:          p.address ?? "",        // current Line 1
    addressLine2:     p.addressLine2 ?? "",
    city:             p.city ?? "",
    state:            p.state ?? "",
    addressPincode:   p.addressPincode ?? "",
    addressCountry:   p.addressCountry ?? "India",
    permanentLine1:   p.permanentLine1 ?? "",
    permanentLine2:   p.permanentLine2 ?? "",
    permanentCity:    p.permanentCity ?? "",
    permanentState:   p.permanentState ?? "",
    permanentPincode: p.permanentPincode ?? "",
    permanentCountry: p.permanentCountry ?? "India",
  });
  const addressHook = useSaveSection(userId);
  // "Same as Current Address" — when checked, the permanent address fields
  // mirror the current ones live (any edit to current also updates permanent),
  // and the permanent inputs are disabled so it's obvious why they can't be
  // typed into. Unchecking releases the inputs and keeps the last synced
  // values so HR doesn't lose what was just copied.
  const [sameAsCurrent, setSameAsCurrent] = useState(false);
  useEffect(() => {
    if (!sameAsCurrent) return;
    setAddress((a) => {
      const inSync =
        a.permanentLine1   === a.address &&
        a.permanentLine2   === a.addressLine2 &&
        a.permanentCity    === a.city &&
        a.permanentState   === a.state &&
        a.permanentPincode === a.addressPincode &&
        a.permanentCountry === a.addressCountry;
      if (inSync) return a;
      return {
        ...a,
        permanentLine1:   a.address,
        permanentLine2:   a.addressLine2,
        permanentCity:    a.city,
        permanentState:   a.state,
        permanentPincode: a.addressPincode,
        permanentCountry: a.addressCountry,
      };
    });
  }, [
    sameAsCurrent,
    address.address, address.addressLine2, address.city,
    address.state, address.addressPincode, address.addressCountry,
  ]);

  // ── Section: Job & Work ───────────────────────────────────────────
  const [job, setJob] = useState({
    designation:        p.designation ?? "",
    secondaryJobTitle:  p.secondaryJobTitle ?? "",
    department:         p.department ?? "",
    businessUnit:       p.businessUnit ?? "NB Media",
    legalEntity:        p.legalEntity ?? "NB Media Productions",
    employmentType:     p.employmentType ?? "fulltime",
    workLocation:       p.workLocation ?? "office",
    jobLocation:        p.jobLocation ?? "Mohali",
    workCountry:        p.workCountry ?? "India",
    nationality:        p.nationality ?? "India",
    joiningDate:        dateISO(p.joiningDate),
    internshipEndDate:  dateISO(p.internshipEndDate),
    noticePeriodDays:   String(p.noticePeriodDays ?? "30"),
    probationPolicy:    p.probationPolicy ?? "Regular Employees",
    probationStartDate: dateISO(p.probationStartDate),
    probationEndDate:   dateISO(p.probationEndDate),
    role:               user.role ?? "member",
    orgLevel:           user.orgLevel ?? "member",
    managerId:          user.manager?.id ? String(user.manager.id) : "",
    inlineManagerId:    user.inlineManager?.id ? String(user.inlineManager.id) : "",
    teamCapsule:        user.teamCapsule ?? "",
  });
  const jobHook = useSaveSection(userId);

  // RBAC designations for the single Designation picker (replaces Role + Org Level).
  const { data: desigData } = useSWR("/api/designations", fetcher);
  const designations = (desigData?.designations ?? []) as { id: number; key: string; label: string; businessUnit?: string | null }[];
  // Small brand chip shown next to each designation in the picker so HR can see
  // which brand (NB Media / YT Labs) a designation — and thus its users — belong to.
  const brandBadge = (bu?: string | null) =>
    (bu || "NB Media") === "YT Labs"
      ? { text: "YT Labs", className: "bg-pink-100 text-pink-700" }
      : { text: "NB Media", className: "bg-sky-100 text-sky-700" };
  // The designation the HR user explicitly picked this session (null until they
  // change it). Until then, the field is DERIVED each render from the employee's
  // stored designationId once the list loads — so it shows the correct value on
  // first load, deterministically, with NO init/reset/SWR race (the old bug:
  // Member → — → correct only after a couple of reloads). Once picked, their
  // choice sticks (a derived value can't be clobbered by background refreshes).
  const [designationPick, setDesignationPick] = useState<string | null>(null);
  const storedDesignationKey = (() => {
    const did = (user as { designationId?: number | null }).designationId;
    if (did != null) {
      const k = designations.find((d) => d.id === did)?.key;
      if (k) return k;
    }
    return "";
  })();
  const designationKey = designationPick ?? storedDesignationKey;

  // ── Section: Work Settings (step 3 of the onboarding wizard) ──────
  // `leavePolicyId` replaces the old free-text leavePlan. Saves to
  // User.leavePolicyId; old leavePlan column stays in DB for back-compat
  // but isn't surfaced/edited here anymore.
  const [work, setWork] = useState({
    leavePolicyId:           user.leavePolicyId ?? "",
    shiftId:                 user.shift?.id ? String(user.shift.id) : "",
    holidayList:             p.holidayList ?? "Default Holiday List",
    weeklyOff:               p.weeklyOff ?? "Standard Weekly Off",
    attendanceNumber:        p.attendanceNumber ?? "",
    timeTrackingPolicy:      p.timeTrackingPolicy ?? "On-Site Capture",
    penalizationPolicy:      p.penalizationPolicy ?? "Default",
    attendanceCaptureScheme: p.attendanceCaptureScheme ?? "On-Site",
    costCenter:              p.costCenter || "NB Media",
  });
  const workHook = useSaveSection(userId);
  const { data: leavePolicies = [] } = useSWR<Array<{ id: number; name: string; isActive: boolean }>>(
    "/api/hr/admin/leave-policies",
    fetcher,
  );
  // Shift templates — drive the "Week Days & Time Shift" dropdown below.
  const { data: shifts = [] } = useSWR<Array<{ id: number; name: string; startTime: string; endTime: string }>>(
    "/api/hr/admin/shifts",
    fetcher,
  );

  // ── Section: Identity Documents ─────────────────────────────────────
  // All fields stored as plaintext — pre-fill directly from the profile.
  const [identity, setIdentity] = useState({
    panNumber:         p.panNumber ?? "",
    aadhaarNumber:     p.aadhaarNumber ?? "",
    aadhaarEnrollment: p.aadhaarEnrollment ?? "",
    pfNumber:          p.pfNumber ?? "",
    uanNumber:         p.uanNumber ?? "",
    biometricId:       p.biometricId ?? "",
  });
  const identityHook = useSaveSection(userId);

  // ── Section: Bank Details ─────────────────────────────────────────
  // All fields stored as plaintext — pre-fill directly from the profile.
  const [bank, setBank] = useState({
    accountHolderName: p.accountHolderName ?? "",
    bankName:          p.bankName ?? "",
    bankBranch:        p.bankBranch ?? "",
    bankAccountNumber: p.bankAccountNumber ?? "",
    bankIfsc:          p.bankIfsc ?? "",
  });
  const bankHook = useSaveSection(userId);

  // Re-sync local state when the SWR record id changes (i.e. after a
  // refresh) so HR sees the canonical values, not stale local edits.
  useEffect(() => {
    setBasic({
      displayName:   user.name ?? "",
      employeeId:    p.employeeId ?? "",
      firstName:     p.firstName ?? "",
      middleName:    p.middleName ?? "",
      lastName:      p.lastName ?? "",
      dateOfBirth:   dateISO(p.dateOfBirth),
      gender:        p.gender ?? "",
      bloodGroup:    p.bloodGroup ?? "",
      maritalStatus: p.maritalStatus ?? "",
      physicallyHandicapped: p.physicallyHandicapped ?? "No",
      fatherName:    p.parentName ?? "",
      motherName:    p.motherName ?? "",
      spouseName:    p.spouseName ?? "",
      childrenNames: p.childrenNames ?? "",
    });
    setContact({
      personalEmail:         p.personalEmail ?? "",
      phone:                 p.phone ?? "",
      workPhone:             p.workPhone ?? "",
      homePhone:             p.homePhone ?? "",
      emergencyRelationship: p.emergencyRelationship ?? "",
    });
    setAddress({
      address:          p.address ?? "",
      addressLine2:     p.addressLine2 ?? "",
      city:             p.city ?? "",
      state:            p.state ?? "",
      addressPincode:   p.addressPincode ?? "",
      addressCountry:   p.addressCountry ?? "India",
      permanentLine1:   p.permanentLine1 ?? "",
      permanentLine2:   p.permanentLine2 ?? "",
      permanentCity:    p.permanentCity ?? "",
      permanentState:   p.permanentState ?? "",
      permanentPincode: p.permanentPincode ?? "",
      permanentCountry: p.permanentCountry ?? "India",
    });
    setJob({
      designation:        p.designation ?? "",
      secondaryJobTitle:  p.secondaryJobTitle ?? "",
      department:         p.department ?? "",
      businessUnit:       p.businessUnit ?? "NB Media",
      legalEntity:        p.legalEntity ?? "NB Media Productions",
      employmentType:     p.employmentType ?? "fulltime",
      workLocation:       p.workLocation ?? "office",
      jobLocation:        p.jobLocation ?? "Mohali",
      workCountry:        p.workCountry ?? "India",
      nationality:        p.nationality ?? "India",
      joiningDate:        dateISO(p.joiningDate),
      internshipEndDate:  dateISO(p.internshipEndDate),
      noticePeriodDays:   String(p.noticePeriodDays ?? "30"),
      probationPolicy:    p.probationPolicy ?? "Regular Employees",
      probationStartDate: dateISO(p.probationStartDate),
      probationEndDate:   dateISO(p.probationEndDate),
      role:               user.role ?? "member",
      orgLevel:           user.orgLevel ?? "member",
      managerId:          user.manager?.id ? String(user.manager.id) : "",
      inlineManagerId:    user.inlineManager?.id ? String(user.inlineManager.id) : "",
      teamCapsule:        user.teamCapsule ?? "",
    });
    setDesignationPick(null);
    setWork({
      leavePolicyId:           user.leavePolicyId ?? "",
      shiftId:                 user.shift?.id ? String(user.shift.id) : "",
      holidayList:             p.holidayList ?? "Default Holiday List",
      weeklyOff:               p.weeklyOff ?? "Standard Weekly Off",
      attendanceNumber:        p.attendanceNumber ?? "",
      timeTrackingPolicy:      p.timeTrackingPolicy ?? "On-Site Capture",
      penalizationPolicy:      p.penalizationPolicy ?? "Default",
      attendanceCaptureScheme: p.attendanceCaptureScheme ?? "On-Site",
      costCenter:              p.costCenter || "NB Media",
    });
    setIdentity({
      panNumber:         p.panNumber ?? "",
      aadhaarNumber:     p.aadhaarNumber ?? "",
      aadhaarEnrollment: p.aadhaarEnrollment ?? "",
      pfNumber:          p.pfNumber ?? "",
      uanNumber:         p.uanNumber ?? "",
      biometricId:       p.biometricId ?? "",
    });
    setBank({
      accountHolderName: p.accountHolderName ?? "",
      bankName:          p.bankName ?? "",
      bankBranch:        p.bankBranch ?? "",
      bankAccountNumber: p.bankAccountNumber ?? "",
      bankIfsc:          p.bankIfsc ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, p.id]);

  // Manager dropdown — exclude self, but always include whoever is
  // currently assigned as Reporting / Inline manager. /api/managers
  // filters out admin / ceo / special_access roles, so without this
  // union the select can't render the matching <option> for a manager
  // that's outside the pickable set, and the field looks empty even
  // though managerId is set in the DB.
  const managerOpts = useMemo(() => {
    const base = managers.filter((m) => m.id !== userId);
    const seen = new Set(base.map((m) => m.id));
    const extras: Array<{ id: number; name: string }> = [];
    for (const assigned of [user.manager, user.inlineManager] as const) {
      if (assigned && assigned.id !== userId && !seen.has(assigned.id)) {
        extras.push({ id: assigned.id, name: assigned.name });
        seen.add(assigned.id);
      }
    }
    return [...extras, ...base];
  }, [managers, userId, user.manager, user.inlineManager]);

  return (
    <div className="space-y-5">
      {/* ── Basic Details ── */}
      <Section
        title="Basic Details"
        icon={User}
        accent="#3b82f6"
        saving={basicHook.saving}
        error={basicHook.error}
        savedAt={basicHook.savedAt}
        onSave={() => {
          // Auto-derive displayName from first/middle/last when HR has typed
          // a name but left displayName untouched — keeps the org-wide name
          // in sync with the canonical first/middle/last fields.
          const fullName = [basic.firstName, basic.middleName, basic.lastName]
            .map((s) => s.trim()).filter(Boolean).join(" ");
          const displayName = basic.displayName.trim() || fullName;
          basicHook.save({
            displayName,
            employeeId:            basic.employeeId.trim() || null,
            firstName:             basic.firstName.trim() || null,
            middleName:            basic.middleName.trim() || null,
            lastName:              basic.lastName.trim() || null,
            dateOfBirth:           basic.dateOfBirth || null,
            gender:                basic.gender || null,
            bloodGroup:            basic.bloodGroup || null,
            maritalStatus:         basic.maritalStatus || null,
            physicallyHandicapped: basic.physicallyHandicapped || null,
            // Father Name persists into the existing parentName column.
            parentName:            basic.fatherName.trim() || null,
            motherName:            basic.motherName.trim() || null,
            spouseName:            basic.spouseName.trim() || null,
            childrenNames:         basic.childrenNames.trim() || null,
          });
        }}
      >
        {/* HRM (Employee) Number — editable. Auto-allocated at onboarding
            from the Number Series, but HR can override if needed. Saving
            this also writes the same value to Attendance No. (server-side)
            because the convention is they stay in sync. */}
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={cls.label}>HRM No.</label>
            <input
              className={`${cls.field} font-mono`}
              value={basic.employeeId}
              onChange={(e) => setBasic({ ...basic, employeeId: e.target.value })}
              placeholder="e.g. HRM104"
            />
            <p className="mt-1 text-[10.5px] text-slate-400">
              Also used as Attendance No. — kept in sync on save.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={cls.label}>First Name</label>
            <input className={cls.field} value={basic.firstName}
              onChange={(e) => setBasic({ ...basic, firstName: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Middle Name <span className="text-[10px] text-slate-400">(optional)</span></label>
            <input className={cls.field} value={basic.middleName}
              onChange={(e) => setBasic({ ...basic, middleName: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Last Name</label>
            <input className={cls.field} value={basic.lastName}
              onChange={(e) => setBasic({ ...basic, lastName: e.target.value })} />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={cls.label}>Display Name <span className="text-[10px] text-slate-400">(shown across the app — leave blank to auto-derive)</span></label>
            <input className={cls.field} value={basic.displayName}
              onChange={(e) => setBasic({ ...basic, displayName: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Date of Birth</label>
            <DateField value={basic.dateOfBirth}
              onChange={(v) => setBasic({ ...basic, dateOfBirth: v })}
              max={new Date().toISOString().slice(0,10)}
              className="w-full" />
          </div>
          <div>
            <label className={cls.label}>Gender</label>
            <CustomSelect
              listKey="gender"
              defaults={["Male", "Female", "Other", "Prefer not to say"]}
              value={basic.gender}
              onChange={(v) => setBasic({ ...basic, gender: v })}
              placeholder="—"
            />
          </div>
          <div>
            <label className={cls.label}>Blood Group</label>
            <CustomSelect
              listKey="bloodGroup"
              defaults={["A+","A-","B+","B-","O+","O-","AB+","AB-"]}
              value={basic.bloodGroup}
              onChange={(v) => setBasic({ ...basic, bloodGroup: v })}
              placeholder="—"
            />
          </div>
          <div>
            <label className={cls.label}>Marital Status</label>
            <CustomSelect
              listKey="maritalStatus"
              defaults={["Single", "Married", "Divorced", "Widowed"]}
              value={basic.maritalStatus}
              onChange={(v) => setBasic({ ...basic, maritalStatus: v })}
              placeholder="—"
            />
          </div>
          <div>
            <label className={cls.label}>Physically Handicapped</label>
            <CustomSelect
              listKey="physicallyHandicapped"
              defaults={["No", "Yes"]}
              value={basic.physicallyHandicapped}
              onChange={(v) => setBasic({ ...basic, physicallyHandicapped: v })}
              placeholder="—"
            />
          </div>
          {/* ── Family ── */}
          <div className="sm:col-span-2 mt-2 pt-3 border-t border-slate-200/70">
            <p className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Family</p>
          </div>
          <div>
            <label className={cls.label}>Father Name</label>
            <input className={cls.field} value={basic.fatherName}
              onChange={(e) => setBasic({ ...basic, fatherName: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Mother Name</label>
            <input className={cls.field} value={basic.motherName}
              onChange={(e) => setBasic({ ...basic, motherName: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Spouse Name</label>
            <input className={cls.field} value={basic.spouseName}
              onChange={(e) => setBasic({ ...basic, spouseName: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Children Names <span className="text-[10px] text-slate-400">(comma-separated)</span></label>
            <input className={cls.field} value={basic.childrenNames}
              onChange={(e) => setBasic({ ...basic, childrenNames: e.target.value })} />
          </div>
        </div>
      </Section>

      {/* ── Contact ── */}
      <Section
        title="Contact Details"
        icon={Phone}
        accent="#0d9488"
        saving={contactHook.saving}
        error={contactHook.error}
        savedAt={contactHook.savedAt}
        onSave={() => contactHook.save({
          personalEmail:         contact.personalEmail.trim() || null,
          phone:                 contact.phone.trim() || null,
          workPhone:             contact.workPhone.trim() || null,
          homePhone:             contact.homePhone.trim() || null,
          emergencyRelationship: contact.emergencyRelationship.trim() || null,
        })}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={cls.label}>Personal Email</label>
            <input type="email" className={cls.field} value={contact.personalEmail}
              onChange={(e) => setContact({ ...contact, personalEmail: e.target.value.toLowerCase() })} />
          </div>
          <div>
            <label className={cls.label}>Mobile Number</label>
            <input className={cls.field} value={contact.phone}
              onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Work Number</label>
            <input className={cls.field} value={contact.workPhone}
              onChange={(e) => setContact({ ...contact, workPhone: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Home Phone</label>
            <input className={cls.field} value={contact.homePhone}
              onChange={(e) => setContact({ ...contact, homePhone: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Relationship</label>
            <CustomSelect
              listKey="emergencyRelationship"
              defaults={["Father", "Mother", "Spouse", "Sibling", "Friend", "Guardian", "Other"]}
              value={contact.emergencyRelationship}
              onChange={(v) => setContact({ ...contact, emergencyRelationship: v })}
              placeholder="—"
            />
          </div>
        </div>
      </Section>

      {/* ── Address ── */}
      <Section
        title="Address (Current + Permanent)"
        icon={MapPin}
        accent="#7c3aed"
        saving={addressHook.saving}
        error={addressHook.error}
        savedAt={addressHook.savedAt}
        onSave={() => addressHook.save({
          // Current address
          address:          address.address.trim() || null,
          addressLine2:     address.addressLine2.trim() || null,
          city:             address.city.trim() || null,
          state:            address.state.trim() || null,
          addressPincode:   address.addressPincode.trim() || null,
          addressCountry:   address.addressCountry.trim() || null,
          // Permanent address
          permanentLine1:   address.permanentLine1.trim() || null,
          permanentLine2:   address.permanentLine2.trim() || null,
          permanentCity:    address.permanentCity.trim() || null,
          permanentState:   address.permanentState.trim() || null,
          permanentPincode: address.permanentPincode.trim() || null,
          permanentCountry: address.permanentCountry.trim() || null,
        })}
      >
        {/* ── Current address ── */}
        <p className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Current Address</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={cls.label}>Address Line 1</label>
            <textarea rows={2} className={cls.textarea} value={address.address}
              onChange={(e) => setAddress({ ...address, address: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className={cls.label}>Address Line 2 <span className="text-[10px] text-slate-400">(optional)</span></label>
            <input className={cls.field} value={address.addressLine2}
              onChange={(e) => setAddress({ ...address, addressLine2: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>City</label>
            <input className={cls.field} value={address.city}
              onChange={(e) => setAddress({ ...address, city: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>State</label>
            <input className={cls.field} value={address.state}
              onChange={(e) => setAddress({ ...address, state: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Pincode</label>
            <input className={cls.field} value={address.addressPincode}
              onChange={(e) => setAddress({ ...address, addressPincode: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Country</label>
            <input className={cls.field} value={address.addressCountry}
              onChange={(e) => setAddress({ ...address, addressCountry: e.target.value })} />
          </div>
        </div>

        {/* ── Permanent address ── */}
        <div className="mt-5 pt-3 border-t border-slate-200/70 flex items-center justify-between gap-4">
          <p className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Permanent Address</p>
          <label className="inline-flex items-center gap-2 text-[12px] text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={sameAsCurrent}
              onChange={(e) => {
                const next = e.target.checked;
                setSameAsCurrent(next);
                // When the box is UN-ticked, clear every permanent field
                // so HR starts from blank (synced values shouldn't linger
                // and pose as user-entered data). Country falls back to
                // the same default the form starts with.
                if (!next) {
                  setAddress((a) => ({
                    ...a,
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
        </div>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={cls.label}>Address Line 1</label>
            <textarea rows={2} disabled={sameAsCurrent} className={cls.textarea} value={address.permanentLine1}
              onChange={(e) => setAddress({ ...address, permanentLine1: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className={cls.label}>Address Line 2 <span className="text-[10px] text-slate-400">(optional)</span></label>
            <input disabled={sameAsCurrent} className={cls.field} value={address.permanentLine2}
              onChange={(e) => setAddress({ ...address, permanentLine2: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>City</label>
            <input disabled={sameAsCurrent} className={cls.field} value={address.permanentCity}
              onChange={(e) => setAddress({ ...address, permanentCity: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>State</label>
            <input disabled={sameAsCurrent} className={cls.field} value={address.permanentState}
              onChange={(e) => setAddress({ ...address, permanentState: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Pincode</label>
            <input disabled={sameAsCurrent} className={cls.field} value={address.permanentPincode}
              onChange={(e) => setAddress({ ...address, permanentPincode: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Country</label>
            <input disabled={sameAsCurrent} className={cls.field} value={address.permanentCountry}
              onChange={(e) => setAddress({ ...address, permanentCountry: e.target.value })} />
          </div>
        </div>
      </Section>

      {/* ── Job & Work ── */}
      <Section
        title="Job & Work Details"
        icon={Briefcase}
        accent="#d97706"
        saving={jobHook.saving}
        error={jobHook.error}
        savedAt={jobHook.savedAt}
        onSave={() => jobHook.save({
          designation:        job.designation.trim() || null,
          secondaryJobTitle:  job.secondaryJobTitle.trim() || null,
          department:         job.department.trim() || null,
          businessUnit:       job.businessUnit.trim() || "NB Media",
          legalEntity:        job.legalEntity.trim() || null,
          employmentType:     job.employmentType,
          workLocation:       job.workLocation,
          jobLocation:        job.jobLocation.trim() || null,
          workCountry:        job.workCountry.trim() || "India",
          nationality:        job.nationality.trim() || "India",
          joiningDate:        job.joiningDate || null,
          internshipEndDate:  job.internshipEndDate || null,
          noticePeriodDays:   job.noticePeriodDays === "" ? null : Number(job.noticePeriodDays),
          probationPolicy:    job.probationPolicy.trim() || null,
          probationStartDate: job.probationStartDate || null,
          probationEndDate:   job.probationEndDate || null,
          role:               job.role,
          orgLevel:           job.orgLevel,
          ...(designationPick != null
            ? { designationId: designations.find((d) => d.key === designationPick)?.id ?? null }
            : {}),
          managerId:          job.managerId === "" ? null : Number(job.managerId),
          inlineManagerId:    job.inlineManagerId === "" ? null : Number(job.inlineManagerId),
          teamCapsule:        job.teamCapsule.trim() || null,
        })}
      >
        {/* Brand context is derived live from the Business Unit value so
            switching it (e.g. moving an employee from NB Media to YT
            Labs) instantly re-scopes the Department / Job Title lists. */}
        {(() => null)()}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={cls.label}>Designation</label>
            <SelectField
              value={designationKey}
              onChange={(v) => {
                setDesignationPick(v);
                const { orgLevel, role } = legacyFromDesignationKey(v);
                setJob((j) => ({ ...j, orgLevel, role }));
              }}
              // Show only this employee's brand's designations (YT Labs → YT
              // Labs; NB Media → NB Media + shared/null). The currently-set
              // designation always stays visible so the value never breaks.
              options={designations
                .filter((d) =>
                  d.key === designationKey ||
                  (job.businessUnit === "YT Labs"
                    ? d.businessUnit === "YT Labs"
                    : d.businessUnit !== "YT Labs"))
                .map((d) => ({ value: d.key, label: d.label, badge: brandBadge(d.businessUnit) }))}
            />
            <p className="mt-1 text-[11px] text-slate-400">Sets access tier + scorecard. Replaces the old Role + Org Level.</p>
          </div>
          <div>
            <label className={cls.label}>Secondary Job Title</label>
            <CustomSelect
              listKey={jobTitleSource(brandFromBusinessUnit(job.businessUnit, job.legalEntity)).listKey}
              defaults={jobTitleSource(brandFromBusinessUnit(job.businessUnit, job.legalEntity)).defaults}
              value={job.secondaryJobTitle}
              onChange={(v) => setJob({ ...job, secondaryJobTitle: v })}
              placeholder="Optional"
            />
          </div>
          <div>
            <label className={cls.label}>Department</label>
            <CustomSelect
              listKey={departmentSource(brandFromBusinessUnit(job.businessUnit, job.legalEntity)).listKey}
              defaults={departmentSource(brandFromBusinessUnit(job.businessUnit, job.legalEntity)).defaults}
              value={job.department}
              onChange={(v) => setJob({ ...job, department: v })}
              placeholder="Select a department"
            />
          </div>
          <div>
            <label className={cls.label}>Business Unit</label>
            <CustomSelect
              listKey="businessUnit"
              defaults={["NB Media", "YT Labs"]}
              value={job.businessUnit}
              onChange={(v) => setJob({ ...job, businessUnit: v })}
              placeholder="Select business unit"
            />
          </div>
          <div>
            <label className={cls.label}>Legal Entity</label>
            <CustomSelect
              listKey="legalEntity"
              defaults={["NB Media Productions", "YT Labs"]}
              value={job.legalEntity}
              onChange={(v) => setJob({ ...job, legalEntity: v })}
              placeholder="Select legal entity"
            />
          </div>
          <div>
            <label className={cls.label}>Employment Type</label>
            <SelectField
              value={job.employmentType}
              onChange={(v) => setJob({ ...job, employmentType: v })}
              options={[
                { value: "fulltime", label: "Regular" },
                { value: "intern",   label: "Intern" },
              ]}
            />
          </div>
          <div>
            <label className={cls.label}>Work Location</label>
            <SelectField
              value={job.workLocation}
              onChange={(v) => setJob({ ...job, workLocation: v })}
              options={[
                { value: "office", label: "Office" },
                { value: "remote", label: "Remote" },
                { value: "hybrid", label: "Hybrid" },
              ]}
            />
          </div>
          <div>
            <label className={cls.label}>Job Location (City)</label>
            <CustomSelect
              listKey="jobLocation"
              defaults={["Mohali", "Delhi", "Mumbai", "Remote"]}
              value={job.jobLocation}
              onChange={(v) => setJob({ ...job, jobLocation: v })}
              placeholder="Select city"
            />
          </div>
          <div>
            <label className={cls.label}>Work Country</label>
            <CustomSelect
              listKey="workCountry"
              defaults={["India", "USA", "UK", "UAE", "Singapore"]}
              value={job.workCountry}
              onChange={(v) => setJob({ ...job, workCountry: v })}
            />
          </div>
          <div>
            <label className={cls.label}>Nationality</label>
            <CustomSelect
              listKey="nationality"
              defaults={["India", "USA", "UK", "Other"]}
              value={job.nationality}
              onChange={(v) => setJob({ ...job, nationality: v })}
            />
          </div>
          {/* Internship-history rule:
              • Currently an intern → show the date as "Internship Start Date"
                + the "Internship End Date" field underneath.
              • Was an intern earlier (internshipEndDate is filled) and is
                now Regular → STILL show both as "Internship Start/End Date"
                so HR keeps that history at a glance.
              • Direct Regular hire (no internshipEndDate, never an intern) →
                show the date as plain "Joining Date" only. */}
          {(() => {
            const hasInternshipHistory =
              job.employmentType === "intern" || !!job.internshipEndDate;
            return (
              <>
                <div>
                  <label className={cls.label}>
                    {hasInternshipHistory ? "Internship Start Date" : "Joining Date"}
                  </label>
                  <DateField value={job.joiningDate}
                    onChange={(v) => setJob({ ...job, joiningDate: v })}
                    className="w-full" />
                </div>
                {hasInternshipHistory && (
                  <div>
                    <label className={cls.label}>Internship End Date</label>
                    <DateField value={job.internshipEndDate}
                      onChange={(v) => setJob({ ...job, internshipEndDate: v })}
                      className="w-full" />
                  </div>
                )}
              </>
            );
          })()}
          <div>
            <label className={cls.label}>Notice Period (days)</label>
            <input type="number" min={0} className={cls.field} value={job.noticePeriodDays}
              onChange={(e) => setJob({ ...job, noticePeriodDays: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Probation Policy</label>
            <CustomSelect
              listKey="probationPolicy"
              defaults={["Interns (3 Months)", "Interns (6 Months)", "Interns (12 Months)", "Regular Employees"]}
              value={job.probationPolicy}
              onChange={(v) => setJob({ ...job, probationPolicy: v })}
            />
          </div>
          <div>
            <label className={cls.label}>Probation Start Date</label>
            <DateField value={job.probationStartDate}
              onChange={(v) => setJob({ ...job, probationStartDate: v })}
              className="w-full" />
          </div>
          <div>
            <label className={cls.label}>Probation End Date</label>
            <DateField value={job.probationEndDate}
              onChange={(v) => setJob({ ...job, probationEndDate: v })}
              className="w-full" />
          </div>
          <div>
            <label className={cls.label}>Reporting Manager</label>
            <SelectField
              value={job.managerId}
              onChange={(v) => setJob({ ...job, managerId: v })}
              placeholder="— No manager —"
              options={[{ value: "", label: "— No manager —" }, ...managerOpts.map((m) => ({ value: String(m.id), label: m.name }))]}
            />
          </div>
          <div>
            <label className={cls.label}>Inline Manager</label>
            <SelectField
              value={job.inlineManagerId}
              onChange={(v) => setJob({ ...job, inlineManagerId: v })}
              placeholder="— No inline manager —"
              options={[{ value: "", label: "— No inline manager —" }, ...managerOpts.map((m) => ({ value: String(m.id), label: m.name }))]}
            />
          </div>
          <div>
            <label className={cls.label}>Team Capsule</label>
            <input className={cls.field} value={job.teamCapsule}
              onChange={(e) => setJob({ ...job, teamCapsule: e.target.value })} />
          </div>
          {/* Effective-dated reporting-manager change — auto-applies on
              the chosen date via the reporting_manager_changes cron. */}
          <div className="sm:col-span-2">
            <ScheduleManagerChange
              userId={userId}
              currentManagerName={user.manager?.name ?? null}
              managerOpts={managerOpts}
            />
          </div>
        </div>
      </Section>

      {/* ── Work Settings (mirrors step 3 of the onboarding wizard) ── */}
      <Section
        title="Work Settings"
        icon={Wallet}
        accent="#0ea5e9"
        saving={workHook.saving}
        error={workHook.error}
        savedAt={workHook.savedAt}
        onSave={() => workHook.save({
          leavePolicyId:           work.leavePolicyId === "" ? null : Number(work.leavePolicyId),
          // Week Days & Time Shift → assigns the user's UserShift.
          shiftId:                 work.shiftId === "" ? null : Number(work.shiftId),
          holidayList:             work.holidayList.trim()        || null,
          weeklyOff:               work.weeklyOff.trim()          || null,
          attendanceNumber:        work.attendanceNumber.trim()   || null,
          timeTrackingPolicy:      work.timeTrackingPolicy.trim() || null,
          penalizationPolicy:      work.penalizationPolicy.trim() || null,
          attendanceCaptureScheme: work.attendanceCaptureScheme.trim() || null,
          // Cost Centre is per-employee since we run two brands
          // (NB Media + YT Labs). Save whatever HR selected, defaulting
          // to "NB Media" only when blank so we never write an empty
          // string back to the DB.
          costCenter:              work.costCenter.trim() || "NB Media",
        })}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={cls.label}>Leave Policy</label>
            <select
              value={work.leavePolicyId}
              onChange={(e) => setWork({ ...work, leavePolicyId: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/30"
            >
              <option value="">— None (manual balances) —</option>
              {leavePolicies.filter((pol) => pol.isActive || pol.id === Number(work.leavePolicyId)).map((pol) => (
                <option key={pol.id} value={pol.id}>
                  {pol.name}{!pol.isActive ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={cls.label}>Holiday List</label>
            <CustomSelect
              listKey="holidayList"
              defaults={["Default Holiday List", "India Public Holidays"]}
              value={work.holidayList}
              onChange={(v) => setWork({ ...work, holidayList: v })}
            />
          </div>
          <div>
            <label className={cls.label}>Week Days &amp; Time Shift</label>
            <select
              value={work.shiftId}
              onChange={(e) => setWork({ ...work, shiftId: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/30"
            >
              <option value="">— No shift assigned —</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.startTime ? ` (${s.startTime}–${s.endTime})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={cls.label}>Attendance Number</label>
            <input className={`${cls.field} font-mono`}
              value={work.attendanceNumber || basic.employeeId}
              onChange={(e) => setWork({ ...work, attendanceNumber: e.target.value })}
              placeholder={basic.employeeId || "e.g. HRM104"} />
          </div>
          <div>
            <label className={cls.label}>Time Tracking Policy</label>
            <CustomSelect
              listKey="timeTrackingPolicy"
              defaults={["On-Site Capture", "Remote Capture", "Hybrid Capture", "None"]}
              value={work.timeTrackingPolicy}
              onChange={(v) => setWork((w) => {
                // Smart cascade: Time Tracking ↔ Capture Scheme are
                // two stored fields describing the same mode — keep
                // them in sync. "None" tracking also disables
                // penalisation (you can't penalise tardiness on a
                // role you aren't tracking).
                const next: typeof w = { ...w, timeTrackingPolicy: v };
                if (v === "On-Site Capture") next.attendanceCaptureScheme = "On-Site";
                else if (v === "Remote Capture") next.attendanceCaptureScheme = "Remote";
                else if (v === "Hybrid Capture") next.attendanceCaptureScheme = "Hybrid";
                else if (v === "None") {
                  next.attendanceCaptureScheme = "";
                  next.penalizationPolicy = "None";
                }
                return next;
              })}
            />
          </div>
          <div>
            <label className={cls.label}>Penalization Policy</label>
            <CustomSelect
              listKey="penalizationPolicy"
              defaults={["Default", "Strict", "Lenient", "None"]}
              value={work.penalizationPolicy}
              onChange={(v) => setWork({ ...work, penalizationPolicy: v })}
            />
          </div>
          <div>
            <label className={cls.label}>Attendance Capture Scheme</label>
            <CustomSelect
              listKey="attendanceCaptureScheme"
              defaults={["On-Site", "Remote", "Hybrid"]}
              value={work.attendanceCaptureScheme}
              onChange={(v) => setWork((w) => {
                // Reverse leg of the cascade — keep Time Tracking
                // Policy aligned with whichever capture scheme HR
                // picks.
                const next: typeof w = { ...w, attendanceCaptureScheme: v };
                if (v === "On-Site") next.timeTrackingPolicy = "On-Site Capture";
                else if (v === "Remote") next.timeTrackingPolicy = "Remote Capture";
                else if (v === "Hybrid") next.timeTrackingPolicy = "Hybrid Capture";
                return next;
              })}
            />
          </div>
          <div>
            <label className={cls.label}>Cost Center</label>
            {/* Editable per-employee since we run two brands. Defaults
                offered are the canonical NB Media + YT Labs values; HR
                can extend via "+ Add custom" if a future cost centre
                shows up. */}
            <CustomSelect
              listKey="costCenter"
              defaults={["NB Media", "YT Labs"]}
              value={work.costCenter}
              onChange={(v) => setWork({ ...work, costCenter: v })}
              placeholder="Select cost center"
            />
          </div>
        </div>
      </Section>

      {/* ── Identity (sensitive) ── */}
      <Section
        title="Identity Documents"
        icon={ShieldCheck}
        accent="#dc2626"
        saving={identityHook.saving}
        error={identityHook.error}
        savedAt={identityHook.savedAt}
        onSave={() => {
          identityHook.save({
            panNumber:         identity.panNumber.trim().toUpperCase() || null,
            aadhaarNumber:     identity.aadhaarNumber.trim()           || null,
            aadhaarEnrollment: identity.aadhaarEnrollment.trim()       || null,
            pfNumber:          identity.pfNumber.trim()                || null,
            uanNumber:         identity.uanNumber.trim()               || null,
            biometricId:       identity.biometricId.trim()             || null,
          });
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={cls.label}>PAN Number</label>
            <input className={`${cls.field} uppercase`} value={identity.panNumber} placeholder="e.g. ABCDE1234F"
              onChange={(e) => setIdentity({ ...identity, panNumber: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Aadhaar Number</label>
            <input className={cls.field} value={identity.aadhaarNumber} placeholder="12-digit Aadhaar"
              onChange={(e) => setIdentity({ ...identity, aadhaarNumber: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Aadhaar Enrollment</label>
            <input className={cls.field} value={identity.aadhaarEnrollment} placeholder="EID from acknowledgement slip"
              onChange={(e) => setIdentity({ ...identity, aadhaarEnrollment: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>PF Number</label>
            <input className={cls.field} value={identity.pfNumber}
              onChange={(e) => setIdentity({ ...identity, pfNumber: e.target.value })}
              placeholder="Provident Fund number" />
          </div>
          <div>
            <label className={cls.label}>UAN Number</label>
            <input className={cls.field} value={identity.uanNumber}
              onChange={(e) => setIdentity({ ...identity, uanNumber: e.target.value })}
              placeholder="Universal Account Number" />
          </div>
          <div>
            <label className={cls.label}>Biometric ID</label>
            <input className={cls.field} value={identity.biometricId}
              onChange={(e) => setIdentity({ ...identity, biometricId: e.target.value })}
              placeholder="As assigned by office system" />
          </div>
        </div>
      </Section>

      {/* ── Bank Details ── */}
      <Section
        title="Bank Details"
        icon={Landmark}
        accent="#0891b2"
        saving={bankHook.saving}
        error={bankHook.error}
        savedAt={bankHook.savedAt}
        onSave={() => {
          bankHook.save({
            accountHolderName: bank.accountHolderName.trim() || null,
            bankName:          bank.bankName.trim()          || null,
            bankBranch:        bank.bankBranch.trim()        || null,
            bankAccountNumber: bank.bankAccountNumber.trim() || null,
            bankIfsc:          bank.bankIfsc.trim().toUpperCase() || null,
          });
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={cls.label}>Account Holder Name</label>
            <input className={cls.field} value={bank.accountHolderName}
              onChange={(e) => setBank({ ...bank, accountHolderName: e.target.value })}
              placeholder="As printed on the passbook / cheque" />
          </div>
          <div>
            <label className={cls.label}>Bank Name</label>
            <input className={cls.field} value={bank.bankName}
              onChange={(e) => setBank({ ...bank, bankName: e.target.value })}
              placeholder="e.g. HDFC Bank" />
          </div>
          <div>
            <label className={cls.label}>Branch</label>
            <input className={cls.field} value={bank.bankBranch}
              onChange={(e) => setBank({ ...bank, bankBranch: e.target.value })}
              placeholder="e.g. Mohali Phase 7" />
          </div>
          <div>
            <label className={cls.label}>Account Number</label>
            <input className={`${cls.field} font-mono`} value={bank.bankAccountNumber}
              onChange={(e) => setBank({ ...bank, bankAccountNumber: e.target.value })}
              placeholder="e.g. 12345678901234" />
          </div>
          <div>
            <label className={cls.label}>IFSC Code</label>
            <input className={`${cls.field} font-mono uppercase`} value={bank.bankIfsc}
              onChange={(e) => setBank({ ...bank, bankIfsc: e.target.value })}
              placeholder="e.g. HDFC0001234" />
          </div>
        </div>
      </Section>

      {/* ── Compensation (reuses the dedicated panel) ──
          Gated by canSeeSalary — HR Manager / CEO / developer only. */}
      {canSeeSalary && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-transparent">
          <SalaryStructurePanel userId={userId} canEdit />
        </div>
      )}
    </div>
  );
}
