"use client";

// Inner content of the "My Finances → Summary" page. Lives in its own
// component so HR can render the exact same UI when viewing another
// employee's profile via /dashboard/hr/people/[id] → Finances tab.
//
// Pass `userId` to scope the API call to that employee; admins only
// (the API enforces). Omit the prop to view the logged-in user's data.

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/swr";
import { Paperclip, Eye, EyeOff, Pencil, X } from "lucide-react";
import { DateField } from "@/components/ui/date-field";

type Props = { userId?: number };

// Company-level PT registration for NB Media — mirrors the constants used
// by the PT-statement export. State / Registered Location reflect where the
// entity is PT-registered, not where the employee lives.
const PT_DETAILS = { state: "Punjab", registeredLocation: "Mohali" } as const;

// Employer establishment IDs (EPF / PT registrations). Hardcoded for now —
// a per-entity config table is a follow-up. Mirrors the NB_MEDIA constants
// used by the payroll exports.
const PF_ESTABLISHMENTS = ["PBBTI2558703000"] as const;
const PT_ESTABLISHMENTS = ["1234567"] as const;

// ISO datetime → yyyy-mm-dd for a native date input (UTC, no TZ drift).
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function maskMiddle(v: string | null | undefined, showLast = 4): string {
  if (!v) return "Not provided";
  const s = String(v);
  if (s.length <= showLast) return s;
  return "X".repeat(s.length - showLast) + s.slice(-showLast);
}

function formatDob(iso: string | null | undefined): string {
  if (!iso) return "Not provided";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not provided";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function monthRange(month: number, year: number): string {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay  = new Date(Date.UTC(year, month + 1, 0));
  const label    = firstDay.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  const from     = firstDay.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
  const to       = lastDay.toLocaleDateString("en-IN",  { day: "2-digit", month: "short", timeZone: "UTC" });
  return `${label} (${from} - ${to})`;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">
      {children}
    </p>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[13.5px] font-medium text-slate-800">{children}</p>;
}

// Masked value (X's + last 4) with an eye toggle to reveal — same format as
// the bank account number. Shows "Not provided" (no toggle) when empty.
function RevealValue({
  value, show, onToggle, label,
}: { value: string | null | undefined; show: boolean; onToggle: () => void; label: string }) {
  if (!value) return <>Not provided</>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono tracking-wider">{show ? String(value) : maskMiddle(value, 4)}</span>
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? `Hide ${label}` : `Show ${label}`}
        title={show ? "Hide" : "Show"}
        className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}

function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-inset ring-emerald-200">
      Verified
    </span>
  );
}

function FileCountChip({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-sky-600">
      <Paperclip className="h-3.5 w-3.5" />
      {count} file{count === 1 ? "" : "s"}
    </span>
  );
}

export default function MyFinancesSummaryPanel({ userId }: Props) {
  const url = userId ? `/api/hr/payroll/summary?userId=${userId}` : "/api/hr/payroll/summary";
  const payslipsHref = userId ? `/dashboard/hr/people/${userId}?tab=Finances&sub=my-pay` : "/dashboard/hr/payroll";

  const { data, isLoading, mutate } = useSWR<{
    profile: any;
    docCount: Record<string, number>;
    latestPayslip: { month: number; year: number; workingDays: number; lopDays: number } | null;
  }>(url, fetcher);

  // Statutory edit modal — HR-only, available when viewing another
  // employee (userId set). Employees can't edit their own statutory info.
  const [editStatutory, setEditStatutory] = useState(false);
  const [editPayment, setEditPayment] = useState(false);
  const canEditStatutory = Boolean(userId);

  const profile       = data?.profile ?? null;
  const docCount      = data?.docCount ?? {};
  const latestPayslip = data?.latestPayslip ?? null;

  // Account Number + IFSC are masked by default — eye toggle reveals them.
  // Lives in client state so the toggle is per-session and never persists.
  const [showAccount, setShowAccount] = useState(false);
  const [showIfsc, setShowIfsc] = useState(false);
  const [showPan, setShowPan] = useState(false);
  const [showAadhaar, setShowAadhaar] = useState(false);

  const fullName =
    profile?.firstName || profile?.lastName
      ? [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")
      : profile?.name || "—";

  const addressLabel = [profile?.address, profile?.city, profile?.state].filter(Boolean).join(", ") || "Not provided";
  const panFiles     = docCount.pan_card ?? 0;
  const aadhaarFiles = docCount.aadhar ?? docCount.aadhaar ?? 0;

  return (
    <div className="space-y-5">
      {/* ── Payroll summary banner ── */}
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-5">
          <div className="md:col-span-1">
            <h2 className="text-[15px] font-semibold text-slate-800">Payroll summary</h2>
          </div>
          <div>
            <Label>Last processed cycle</Label>
            <Value>{latestPayslip ? monthRange(latestPayslip.month, latestPayslip.year) : "Not run yet"}</Value>
          </div>
          <div>
            <Label>Working days</Label>
            <Value>{latestPayslip?.workingDays ?? "—"}</Value>
          </div>
          <div>
            <Label>Loss of pay</Label>
            <Value>{String(latestPayslip?.lopDays ?? "—")}</Value>
          </div>
          <div>
            <Label>Payslip</Label>
            {latestPayslip ? (
              <Link href={payslipsHref} className="mt-1 block text-[13.5px] font-semibold text-sky-600 hover:underline">
                View payslip
              </Link>
            ) : (
              <Value>—</Value>
            )}
          </div>
        </div>
      </div>

      {/* ── Two-column cards ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
        {/* Left column: Payment Information + Statutory Information stacked */}
        <div className="space-y-5">
        {/* Payment Information */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-slate-800">Payment Information</h3>
            {canEditStatutory ? (
              <button
                type="button"
                onClick={() => setEditPayment(true)}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-sky-600 hover:underline"
              >
                <Pencil className="h-3 w-3" /> Edit
              </button>
            ) : null}
          </div>

          <div className="mb-5">
            <Label>Salary payment mode</Label>
            <Value>Bank Transfer</Value>
          </div>

          <h4 className="mb-3 text-[13px] font-semibold text-slate-800">Bank Information</h4>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <Label>Bank name</Label>
              <Value>{profile?.bankName || "Not provided"}</Value>
            </div>
            <div>
              <Label>Account number</Label>
              <Value>
                <span className="inline-flex items-center gap-2">
                  <span className="font-mono tracking-wider">
                    {profile?.bankAccountNumber
                      ? (showAccount ? profile.bankAccountNumber : maskMiddle(profile.bankAccountNumber))
                      : "Not provided"}
                  </span>
                  {profile?.bankAccountNumber ? (
                    <button
                      type="button"
                      onClick={() => setShowAccount((v) => !v)}
                      aria-label={showAccount ? "Hide account number" : "Show account number"}
                      title={showAccount ? "Hide" : "Show"}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      {showAccount ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  ) : null}
                </span>
              </Value>
            </div>
            <div>
              <Label>IFSC code</Label>
              <Value>
                <span className="inline-flex items-center gap-2">
                  <span className="font-mono tracking-wider">
                    {profile?.bankIfsc
                      ? (showIfsc ? profile.bankIfsc : maskMiddle(profile.bankIfsc, 4))
                      : "Not provided"}
                  </span>
                  {profile?.bankIfsc ? (
                    <button
                      type="button"
                      onClick={() => setShowIfsc((v) => !v)}
                      aria-label={showIfsc ? "Hide IFSC code" : "Show IFSC code"}
                      title={showIfsc ? "Hide" : "Show"}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      {showIfsc ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  ) : null}
                </span>
              </Value>
            </div>
            <div>
              <Label>Name on the account</Label>
              <Value>{profile?.accountHolderName || fullName}</Value>
            </div>
            <div className="col-span-2">
              <Label>Branch</Label>
              <Value>{profile?.bankBranch || "N/A"}</Value>
            </div>
          </div>
        </section>

        {/* Statutory Information — shown when PF is enabled, or always for HR
            (so HR can capture PF/PT details for an employee who has none). */}
        {(profile?.pfNumber || canEditStatutory) ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-slate-800">Statutory Information</h3>
              {canEditStatutory ? (
                <button
                  type="button"
                  onClick={() => setEditStatutory(true)}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-sky-600 hover:underline"
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              ) : null}
            </div>

            {/* PF Account Information */}
            <h4 className="mb-3 text-[13px] font-semibold text-slate-800">PF Account Information</h4>
            {/* PF status sits on its own line */}
            <div className="mb-4">
              <Label>PF status</Label>
              <Value>
                {profile?.pfNumber && !profile?.pfNotEligible ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Enabled
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-slate-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                    Not enrolled
                  </span>
                )}
              </Value>
            </div>
            {/* PF identifiers on the next line */}
            <div className="mb-6 grid grid-cols-2 gap-x-8 gap-y-4">
              <div>
                <Label>PF number</Label>
                <Value>
                  <span className="font-mono tracking-wider">{profile?.pfNumber || "Not provided"}</span>
                </Value>
              </div>
              <div>
                <Label>Universal account number</Label>
                <Value>
                  <span className="font-mono tracking-wider">{profile?.uanNumber || "Not provided"}</span>
                </Value>
              </div>
              <div>
                <Label>PF join date</Label>
                <Value>{formatDob(profile?.pfJoinDate)}</Value>
              </div>
              <div>
                <Label>Name of the account</Label>
                <Value>{profile?.pfAccountName || profile?.accountHolderName || fullName}</Value>
              </div>
            </div>

            {/* PT Details — company-level registration */}
            <h4 className="mb-3 text-[13px] font-semibold text-slate-800">PT Details</h4>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <div>
                <Label>State</Label>
                <Value>{PT_DETAILS.state}</Value>
              </div>
              <div>
                <Label>Registered location</Label>
                <Value>{PT_DETAILS.registeredLocation}</Value>
              </div>
            </div>
          </section>
        ) : null}
        </div>

        {/* Identity Information */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <h3 className="mb-5 text-[15px] font-semibold text-slate-800">Identity Information</h3>

          {/* PAN Card */}
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-5 w-7 items-center justify-center overflow-hidden rounded-[3px] ring-1 ring-slate-200">
                <span className="block h-full w-full bg-gradient-to-b from-[#ff9933] via-white to-[#138808]" />
              </span>
              <span className="text-[14px] font-semibold text-slate-800">Pan Card</span>
              {profile?.panNumber ? <VerifiedBadge /> : null}
            </div>
            <FileCountChip count={panFiles} />
          </div>
          <div className="mb-6 grid grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <Label>Permanent account number</Label>
              <Value>
                <RevealValue value={profile?.panNumber} show={showPan} onToggle={() => setShowPan((v) => !v)} label="PAN number" />
              </Value>
            </div>
            <div>
              <Label>Name</Label>
              <Value>{fullName}</Value>
            </div>
            <div>
              <Label>Date of birth</Label>
              <Value>{formatDob(profile?.dateOfBirth)}</Value>
            </div>
            <div>
              <Label>Parent&apos;s name</Label>
              <Value>{profile?.parentName || "Not provided"}</Value>
            </div>
          </div>

          {/* Photo ID — Aadhaar */}
          <h4 className="mb-3 text-[13px] font-semibold text-slate-800">Photo ID</h4>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-5 w-7 items-center justify-center overflow-hidden rounded-[3px] ring-1 ring-slate-200">
                <span className="block h-full w-full bg-gradient-to-b from-[#ff9933] via-white to-[#138808]" />
              </span>
              <span className="text-[14px] font-semibold text-slate-800">Aadhaar Card</span>
              {profile?.aadhaarNumber ? <VerifiedBadge /> : null}
            </div>
            <FileCountChip count={aadhaarFiles} />
          </div>
          <div className="mb-6 grid grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <Label>Aadhaar number</Label>
              <Value>
                <RevealValue value={profile?.aadhaarNumber} show={showAadhaar} onToggle={() => setShowAadhaar((v) => !v)} label="Aadhaar number" />
              </Value>
            </div>
            <div>
              <Label>Enrollment number</Label>
              <Value>{profile?.aadhaarEnrollment || "Not Available"}</Value>
            </div>
            <div>
              <Label>Date of birth</Label>
              <Value>{formatDob(profile?.dateOfBirth)}</Value>
            </div>
            <div>
              <Label>Name</Label>
              <Value>{fullName}</Value>
            </div>
            <div>
              <Label>Address</Label>
              <Value>{addressLabel}</Value>
            </div>
            <div>
              <Label>Gender</Label>
              <Value>{profile?.gender ? (profile.gender[0].toUpperCase() + profile.gender.slice(1)) : "Not provided"}</Value>
            </div>
          </div>

          {/* Address Proof — Aadhaar */}
          <h4 className="mb-3 text-[13px] font-semibold text-slate-800">Address Proof</h4>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-5 w-7 items-center justify-center overflow-hidden rounded-[3px] ring-1 ring-slate-200">
                <span className="block h-full w-full bg-gradient-to-b from-[#ff9933] via-white to-[#138808]" />
              </span>
              <span className="text-[14px] font-semibold text-slate-800">Aadhaar Card</span>
              {profile?.aadhaarNumber ? <VerifiedBadge /> : null}
            </div>
            <FileCountChip count={aadhaarFiles} />
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <Label>Aadhaar number</Label>
              <Value>
                <RevealValue value={profile?.aadhaarNumber} show={showAadhaar} onToggle={() => setShowAadhaar((v) => !v)} label="Aadhaar number" />
              </Value>
            </div>
            <div>
              <Label>Enrollment number</Label>
              <Value>{profile?.aadhaarEnrollment || "Not Available"}</Value>
            </div>
            <div>
              <Label>Date of birth</Label>
              <Value>{formatDob(profile?.dateOfBirth)}</Value>
            </div>
            <div>
              <Label>Name</Label>
              <Value>{fullName}</Value>
            </div>
            <div>
              <Label>Address</Label>
              <Value>{addressLabel}</Value>
            </div>
            <div>
              <Label>Gender</Label>
              <Value>{profile?.gender ? (profile.gender[0].toUpperCase() + profile.gender.slice(1)) : "Not provided"}</Value>
            </div>
          </div>
        </section>
      </div>

      {isLoading && !data ? (
        <p className="text-center text-[12.5px] text-slate-400">Loading payroll summary…</p>
      ) : null}

      {editStatutory && userId ? (
        <EditStatutoryModal
          userId={userId}
          employeeName={fullName}
          profile={profile}
          onClose={() => setEditStatutory(false)}
          onSaved={() => { setEditStatutory(false); mutate(); }}
        />
      ) : null}

      {editPayment && userId ? (
        <EditPaymentModal
          userId={userId}
          employeeName={fullName}
          profile={profile}
          onClose={() => setEditPayment(false)}
          onSaved={() => { setEditPayment(false); mutate(); }}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Edit Payment Information — bank details. HR-only; saves via PUT
//  /api/hr/people/[id]. Bank fields are stored plaintext (no encryption).
// ─────────────────────────────────────────────────────────────────────────────
function EditPaymentModal({
  userId, employeeName, profile, onClose, onSaved,
}: {
  userId: number;
  employeeName: string;
  profile: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({
    bankName:          profile?.bankName || "",
    bankAccountNumber: profile?.bankAccountNumber || "",
    bankIfsc:          profile?.bankIfsc || "",
    accountHolderName: profile?.accountHolderName || "",
    bankBranch:        profile?.bankBranch || "",
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const res = await fetch(`/api/hr/people/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankName:          form.bankName.trim() || null,
          bankAccountNumber: form.bankAccountNumber.trim() || null,
          bankIfsc:          form.bankIfsc.trim() || null,
          accountHolderName: form.accountHolderName.trim() || null,
          bankBranch:        form.bankBranch.trim() || null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d?.error || `Save failed (HTTP ${res.status})`); return; }
      onSaved();
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const fieldCls = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/15";
  const labelCls = "block text-[12.5px] font-medium text-slate-600 mb-1.5";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-2xl max-h-[92vh] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-[15px] font-semibold text-slate-800">Edit Payment Information: {employeeName}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <h4 className="mb-4 text-[14px] font-semibold text-slate-800">Bank Information</h4>
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Bank Name</label>
              <input className={fieldCls} value={form.bankName} onChange={(e) => set("bankName", e.target.value)} placeholder="e.g. HDFC Bank" />
            </div>
            <div>
              <label className={labelCls}>Account Number</label>
              <input className={fieldCls} value={form.bankAccountNumber} onChange={(e) => set("bankAccountNumber", e.target.value)} placeholder="Bank account number" />
            </div>
            <div>
              <label className={labelCls}>IFSC Code</label>
              <input className={fieldCls} value={form.bankIfsc} onChange={(e) => set("bankIfsc", e.target.value)} placeholder="e.g. HDFC0001234" />
            </div>
            <div>
              <label className={labelCls}>Name on the Account</label>
              <input className={fieldCls} value={form.accountHolderName} onChange={(e) => set("accountHolderName", e.target.value)} placeholder="Account holder name" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Branch</label>
              <input className={fieldCls} value={form.bankBranch} onChange={(e) => set("bankBranch", e.target.value)} placeholder="Branch name" />
            </div>
          </div>
          <p className="mt-4 text-[11.5px] text-slate-400">Salary payment mode is Bank Transfer for all employees.</p>
        </div>

        {err && <p className="mx-6 mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{err}</p>}

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-3">
          <button onClick={onClose} className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="h-9 rounded-lg bg-violet-600 px-5 text-[12.5px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
          >
            {saving ? "Updating…" : "Update"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Edit Statutory Information — Keka-style two-pane modal (PF + PT).
//  HR-only; saves via PUT /api/hr/people/[id]. State / Registered Location
//  are company-level constants (read-only) derived from the PT establishment.
// ─────────────────────────────────────────────────────────────────────────────
function EditStatutoryModal({
  userId, employeeName, profile, onClose, onSaved,
}: {
  userId: number;
  employeeName: string;
  profile: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pane, setPane] = useState<"pf" | "pt">("pf");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [form, setForm] = useState({
    pfEstablishmentId: profile?.pfEstablishmentId || PF_ESTABLISHMENTS[0],
    pfEpsMember:       profile?.pfEpsMember ?? true,
    pfNotEligible:     profile?.pfNotEligible ?? false,
    uanNumber:         profile?.uanNumber || "",
    pfJoinDate:        toDateInput(profile?.pfJoinDate),
    pfNumber:          profile?.pfNumber || "",
    pfAccountName:     profile?.pfAccountName || profile?.accountHolderName || employeeName || "",
    ptEstablishmentId: profile?.ptEstablishmentId || PT_ESTABLISHMENTS[0],
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const res = await fetch(`/api/hr/people/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pfEstablishmentId: form.pfEstablishmentId || null,
          pfEpsMember:       form.pfEpsMember,
          pfNotEligible:     form.pfNotEligible,
          uanNumber:         form.uanNumber.trim() || null,
          pfJoinDate:        form.pfJoinDate || null,
          pfNumber:          form.pfNumber.trim() || null,
          pfAccountName:     form.pfAccountName.trim() || null,
          ptEstablishmentId: form.ptEstablishmentId || null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d?.error || `Save failed (HTTP ${res.status})`); return; }
      onSaved();
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // "Details Captured" only shows once that pane's required fields are
  // filled. PF counts as captured when it's flagged not-eligible, or when
  // all four PF inputs are present. PT needs an establishment selected.
  const pfCaptured =
    form.pfNotEligible ||
    Boolean(form.uanNumber.trim() && form.pfJoinDate && form.pfNumber.trim() && form.pfAccountName.trim());
  const ptCaptured = Boolean(form.ptEstablishmentId);

  const navItem = (key: "pf" | "pt", title: string, captured: boolean) => (
    <button
      type="button"
      onClick={() => setPane(key)}
      className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
        pane === key ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"
      }`}
    >
      <p className="text-[13.5px] font-semibold text-slate-800">{title}</p>
      {captured ? (
        <p className="mt-0.5 text-[11.5px] font-medium text-emerald-600">Details Captured</p>
      ) : null}
    </button>
  );

  const fieldCls = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/15";
  const labelCls = "block text-[12.5px] font-medium text-slate-600 mb-1.5";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-4xl max-h-[92vh] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-[15px] font-semibold text-slate-800">Edit Statutory Information: {employeeName}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        {/* Intro banner */}
        <div className="px-6 pt-4">
          <div className="rounded-lg border border-sky-100 bg-sky-50/70 px-4 py-3 text-[12.5px] text-slate-600">
            Please fill {employeeName}&apos;s PF, ESI, PT &amp; LWF information — these are necessary for post payroll processing.
          </div>
        </div>

        {/* Body: left nav + right form */}
        <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto p-6 md:grid-cols-[260px_1fr]">
          <div className="space-y-3">
            {navItem("pf", "Provident Fund (PF)", pfCaptured)}
            {navItem("pt", "Professional Tax (PT)", ptCaptured)}
          </div>

          <div>
            {pane === "pf" ? (
              <div>
                <h4 className="mb-5 text-[16px] font-semibold text-slate-800">Please Provide Provident Fund Details</h4>

                <div className="mb-5">
                  <label className={labelCls}>Choose Establishment Id of employer</label>
                  <select
                    value={form.pfEstablishmentId}
                    onChange={(e) => set("pfEstablishmentId", e.target.value)}
                    className={fieldCls}
                  >
                    {PF_ESTABLISHMENTS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>

                {/* EPS membership toggle */}
                <div className="mb-4 flex items-start gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.pfEpsMember}
                    onClick={() => set("pfEpsMember", !form.pfEpsMember)}
                    className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${form.pfEpsMember ? "bg-violet-500" : "bg-slate-300"}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.pfEpsMember ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                  <p className="text-[13px] text-slate-700">Employee is a member of EPS. Contribution will be allocated to both EPF &amp; EPS.</p>
                </div>

                {/* Not-eligible checkbox */}
                <label className="mb-6 flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={form.pfNotEligible}
                    onChange={(e) => set("pfNotEligible", e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-400"
                  />
                  <span className="text-[13px] text-slate-700">
                    Check this box if PF details are not available yet, or the employee is not eligible for PF contribution.
                  </span>
                </label>

                <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Universal Account Number (UAN)</label>
                    <input className={fieldCls} value={form.uanNumber} onChange={(e) => set("uanNumber", e.target.value)} placeholder="e.g. 101707690679" />
                  </div>
                  <div>
                    <label className={labelCls}>PF Registration Date</label>
                    <DateField value={form.pfJoinDate} onChange={(v) => set("pfJoinDate", v)} className="w-full" />
                  </div>
                  <div>
                    <label className={labelCls}>PF Number</label>
                    <input className={fieldCls} value={form.pfNumber} onChange={(e) => set("pfNumber", e.target.value)} placeholder="e.g. PBBTI25587030000010060" />
                  </div>
                  <div>
                    <label className={labelCls}>Name on the Account</label>
                    <input className={fieldCls} value={form.pfAccountName} onChange={(e) => set("pfAccountName", e.target.value)} placeholder="Account holder name" />
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <h4 className="mb-5 text-[16px] font-semibold text-slate-800">Professional Tax (PT) Details</h4>

                <div className="mb-5 max-w-sm">
                  <label className={labelCls}>Establishment ID of Employer</label>
                  <select
                    value={form.ptEstablishmentId}
                    onChange={(e) => set("ptEstablishmentId", e.target.value)}
                    className={fieldCls}
                  >
                    {PT_ESTABLISHMENTS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>State</label>
                    <input className={`${fieldCls} bg-slate-50 text-slate-500`} value={PT_DETAILS.state} readOnly />
                  </div>
                  <div>
                    <label className={labelCls}>Registered Location</label>
                    <input className={`${fieldCls} bg-slate-50 text-slate-500`} value={PT_DETAILS.registeredLocation} readOnly />
                  </div>
                </div>
                <p className="mt-3 text-[11.5px] text-slate-400">State &amp; Registered Location are company-level PT registration values.</p>
              </div>
            )}
          </div>
        </div>

        {err && <p className="mx-6 mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{err}</p>}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-3">
          <button onClick={onClose} className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="h-9 rounded-lg bg-violet-600 px-5 text-[12.5px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
          >
            {saving ? "Updating…" : "Update"}
          </button>
        </div>
      </div>
    </div>
  );
}
