"use client";

// Bulk-Keka import modal for the onboarding wizard. HR uploads a
// Keka export (CSV or XLSX) once; this modal parses it, lets HR
// search / scan the rows, and either:
//   • click a single row → streams the row's mapped data into the
//     parent form for review, or
//   • click "Onboard all (N)" → POSTs every unonboarded row in a
//     two-pass run (create everyone, then reconcile manager links
//     against the freshly-created users).
// Already-onboarded rows (employeeId already in the DB) are dimmed
// with a "Onboarded" badge and excluded from the bulk count.

import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Search, X, CheckCircle2, AlertCircle, FileSpreadsheet, ArrowRight, Users, Loader2 } from "lucide-react";
import {
  KekaRow,
  KekaFormPatch,
  parseKekaFile,
  mapRowToFormPatch,
  findManagerIdByName,
} from "@/lib/keka-import";

type Manager = { id: number; name: string };

type BulkResult = {
  hrm:    string;
  name:   string;
  ok:     boolean;
  error?: string;
};

type BulkProgress = {
  done:    number;
  total:   number;
  current: string;          // HRM/name of the row in flight
  results: BulkResult[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (row: KekaRow, patch: KekaFormPatch) => void;
  managers: Manager[];
  /** Set of HRM IDs already onboarded — used to dim already-imported rows. */
  onboardedIds?: Set<string>;
  /**
   * Triggered after a bulk run finishes. Parent re-fetches lists and
   * (optionally) updates onboardedIds so re-opens are fresh.
   */
  onBulkComplete?: (createdHrmIds: string[]) => void;
  /** Full active-user list — drives the second-pass manager reconcile. */
  allUsers?: Array<{ id: number; name: string }>;
};

export default function KekaImportModal({
  open, onClose, onPick, managers, onboardedIds, onBulkComplete, allUsers,
}: Props) {
  const [rows, setRows]       = useState<KekaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [query, setQuery]     = useState("");
  const [fileName, setFileName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Bulk-import state — null when not running and no results yet, a
  // progress snapshot during the run, and a frozen "done" snapshot
  // when finished (results.length === total).
  const [bulk, setBulk] = useState<BulkProgress | null>(null);
  // Confirm-before-bulk gate so HR doesn't fire 30 POSTs by accident.
  const [confirmBulk, setConfirmBulk] = useState(false);
  // Re-entry guard — `bulk` is React state and updates async, so a
  // double-click on "Yes, onboard all" could fire two parallel runs
  // before the first setBulk lands. The ref shorts the second invocation.
  const runningRef = useRef(false);

  // Reset state on close so the next open is fresh.
  useEffect(() => {
    if (!open) {
      setRows([]); setError(""); setQuery(""); setFileName(""); setLoading(false);
      setBulk(null); setConfirmBulk(false);
    }
  }, [open]);

  // Esc to close — matches the rest of the modals in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleFile = async (file: File) => {
    setError(""); setLoading(true); setFileName(file.name);
    try {
      const parsed = await parseKekaFile(file);
      if (parsed.length === 0) {
        setError("No rows found in the file. Make sure the first sheet has the Keka export columns.");
        setRows([]);
      } else {
        setRows(parsed);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to parse the file.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  // Pre-compute the mapped patches once per row so the table can show
  // department / manager-match status without recomputing on every
  // keystroke of the search box.
  const enriched = useMemo(() => rows.map((row) => ({
    row,
    patch: mapRowToFormPatch(row, managers),
  })), [rows, managers]);

  // Rows eligible for the bulk run: not yet onboarded and have an
  // employee number to anchor on.
  const pendingRows = useMemo(() => enriched.filter(({ row }) => {
    if (!row.employeeNumber) return false;
    return !onboardedIds?.has(row.employeeNumber);
  }), [enriched, onboardedIds]);

  // POSTs one row to /api/users using the same payload shape the
  // onboarding wizard's submit produces, minus salary (compensation
  // stays per-employee). Returns { ok, error? }.
  const createOne = async (row: KekaRow, patch: KekaFormPatch): Promise<{ ok: boolean; error?: string; userId?: number }> => {
    try {
      const fullName = patch.displayName.trim() || [patch.firstName, patch.middleName, patch.lastName].filter(Boolean).join(" ").trim();
      // Intentionally NOT sending role / orgLevel — bulk-imported users
      // either already exist (in which case HR has set their role and
      // we must not overwrite it) or are brand-new (in which case the
      // API defaults them to "member"). Same reasoning for managerId:
      // we send it only when the name-match resolved, so a "no match"
      // doesn't accidentally clear an existing manager link.
      const payload: any = {
        name:  fullName,
        email: patch.workEmail,
        inviteToLogin:    true,
        // Flag every bulk-imported user for the first-login wizard.
        // Keka doesn't carry the personal info we need (PAN, Aadhaar,
        // address, emergency contact) — the wizard captures those
        // from the employee directly. /api/onboarding/complete clears
        // the flag once they finish, so it's a one-time step.
        enableOnboarding: true,
        profile: {
          employeeId:   patch.employeeNumber || undefined,
          firstName:    patch.firstName || undefined,
          middleName:   patch.middleName || undefined,
          lastName:     patch.lastName  || undefined,
          designation:  patch.jobTitle  || undefined,
          department:   patch.department || undefined,
          businessUnit: "NB Media",
          employmentType:
            patch.workerType === "Intern"     ? "intern"
            : patch.timeType  === "Part Time" ? "parttime"
            : "fulltime",
          workLocation: patch.location?.toLowerCase().includes("remote") ? "remote" : "office",
          joiningDate:  patch.joiningDate || undefined,
          phone:        patch.mobileNumber ? `${patch.mobileCountry} ${patch.mobileNumber}` : undefined,
          dateOfBirth:  patch.dateOfBirth || undefined,
          gender:       patch.gender || undefined,
          noticePeriodDays: Number(patch.noticePeriodDays) || 30,
        },
      };
      // Send managerId only when we matched a real user — undefined
      // (omitted) means "don't touch", whereas null would clear an
      // existing manager link.
      if (patch.reportingManagerId) {
        payload.managerId = Number(patch.reportingManagerId);
      }
      const res  = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
      return { ok: true, userId: data?.id };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Network error" };
    }
  };

  // Two-pass bulk run. Pass 1: sequentially create every unonboarded
  // row, capturing per-row success/failure. Pass 2: re-fetch the full
  // user list and PATCH any user whose Keka "Reporting To" name now
  // resolves to someone in the DB (catches the chicken-and-egg case
  // where a manager only existed after pass 1).
  const runBulk = async () => {
    if (pendingRows.length === 0) return;
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      setConfirmBulk(false);
      setBulk({ done: 0, total: pendingRows.length, current: "", results: [] });
      const created: Array<{ hrm: string; reportingTo: string; userId?: number }> = [];

      // ── Pass 1 — sequential creates ──
      for (let i = 0; i < pendingRows.length; i++) {
        const { row, patch } = pendingRows[i];
        setBulk((s) => s ? ({ ...s, current: `${row.employeeNumber} · ${row.displayName}` }) : s);
        const result = await createOne(row, patch);
        const r: BulkResult = {
          hrm:   row.employeeNumber,
          name:  row.displayName,
          ok:    result.ok,
          error: result.error,
        };
        if (result.ok) {
          created.push({ hrm: row.employeeNumber, reportingTo: row.reportingTo, userId: result.userId });
        }
        setBulk((s) => s ? ({ ...s, done: i + 1, results: [...s.results, r] }) : s);
      }

      // ── Pass 2 — manager reconciliation ──
      // Fetch the latest user list (now includes everyone we just
      // created) and re-resolve each created user's manager-by-name. If
      // it now matches, PATCH the user row.
      if (created.length > 0) {
        try {
          const optsRes = await fetch("/api/hr/onboard/options");
          const opts    = await optsRes.json();
          const fresh: Array<{ id: number; name: string }> = opts?.allUsers ?? allUsers ?? [];
          for (const c of created) {
            if (!c.reportingTo || !c.userId) continue;
            const id = findManagerIdByName(c.reportingTo, fresh);
            if (!id || id === c.userId) continue;
            await fetch(`/api/hr/people/${c.userId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ managerId: id }),
            }).catch(() => null);  // best-effort; reflected in the summary if it matters
          }
        } catch { /* swallow — pass 2 is best-effort */ }
      }

      onBulkComplete?.(created.map((c) => c.hrm));
    } finally {
      runningRef.current = false;
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return enriched;
    return enriched.filter(({ row }) =>
      row.employeeNumber.toLowerCase().includes(q) ||
      row.displayName.toLowerCase().includes(q) ||
      row.workEmail.toLowerCase().includes(q) ||
      row.jobTitle.toLowerCase().includes(q),
    );
  }, [enriched, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 backdrop-blur-sm">
      <div className="relative w-[min(1100px,95vw)] max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#008CFF]/10 text-[#008CFF]">
              <FileSpreadsheet size={18} />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-slate-800">Import from Keka</h3>
              <p className="text-[12px] text-slate-500">
                Upload the export once, then click any employee to pre-fill the onboarding form.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Toolbar — file picker + search */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-3">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";  // allow re-selecting the same file
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-[#008CFF]/30 bg-[#008CFF]/5 px-3.5 py-2 text-[12.5px] font-semibold text-[#008CFF] transition-colors hover:bg-[#008CFF]/10 hover:border-[#008CFF]/50"
          >
            <Upload size={13} />
            {fileName ? "Replace file" : "Upload .csv or .xlsx"}
          </button>
          {fileName && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-[11.5px] text-slate-600">
              <FileSpreadsheet size={12} className="opacity-70" />
              {fileName} · {rows.length} rows
            </span>
          )}
          {pendingRows.length > 0 && !bulk && (
            <button
              type="button"
              onClick={() => setConfirmBulk(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-[12.5px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 hover:border-emerald-400"
            >
              <Users size={13} />
              Onboard all ({pendingRows.length})
            </button>
          )}
          <div className="relative ml-auto flex items-center">
            <Search size={14} className="absolute left-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search HRM ID, name, email, title…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 w-[280px] rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#008CFF] focus:outline-none focus:ring-2 focus:ring-[#008CFF]/15"
              disabled={rows.length === 0}
            />
          </div>
        </div>

        {/* Confirm-bulk gate */}
        {confirmBulk && (
          <div className="border-b border-amber-200 bg-amber-50 px-6 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2 text-[12.5px] text-amber-900">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <div>
                  <strong>Onboard {pendingRows.length} employee{pendingRows.length === 1 ? "" : "s"}?</strong>
                  <span className="ml-1 text-amber-800">
                    Salary stays blank for each — fill it in per-user later. Already-onboarded rows are skipped automatically.
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmBulk(false)}
                  className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-medium text-amber-800 hover:bg-amber-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={runBulk}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700"
                >
                  Yes, onboard all
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk progress / summary banner */}
        {bulk && (
          <div className="border-b border-slate-100 bg-slate-50 px-6 py-3">
            {bulk.done < bulk.total ? (
              <div>
                <div className="mb-1.5 flex items-center justify-between text-[12.5px] text-slate-700">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <Loader2 size={13} className="animate-spin" />
                    Onboarding {bulk.done + 1} of {bulk.total}…
                  </span>
                  <span className="text-slate-500">{bulk.current}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-[#008CFF] transition-[width] duration-300"
                    style={{ width: `${(bulk.done / bulk.total) * 100}%` }}
                  />
                </div>
              </div>
            ) : (() => {
              const ok   = bulk.results.filter((r) => r.ok).length;
              const fail = bulk.results.filter((r) => !r.ok);
              return (
                <div className="flex flex-col gap-2">
                  <div className="text-[13px]">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                      <CheckCircle2 size={14} />
                      {ok} onboarded
                    </span>
                    {fail.length > 0 && (
                      <span className="ml-3 inline-flex items-center gap-1.5 font-semibold text-rose-700">
                        <AlertCircle size={14} />
                        {fail.length} failed
                      </span>
                    )}
                  </div>
                  {fail.length > 0 && (
                    <div className="rounded-md border border-rose-200 bg-rose-50/60 px-3 py-2 text-[11.5px] text-rose-800">
                      {fail.map((f) => (
                        <div key={f.hrm} className="font-mono">
                          <span className="opacity-70">{f.hrm}</span> · {f.name} — <span className="not-mono">{f.error}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Body */}
        <div className="max-h-[65vh] overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#008CFF]" />
              <p className="text-[13px]">Parsing file…</p>
            </div>
          )}

          {!loading && error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && rows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500">
              <FileSpreadsheet size={32} className="mb-3 opacity-40" />
              <p className="text-[13px] font-medium text-slate-700">No file uploaded yet</p>
              <p className="mt-1 max-w-md text-[12px]">
                Pick a Keka export (CSV or Excel). All rows will be listed below — click one to pre-fill
                steps 1, 2 and 3 of the onboarding form for that employee. Salary stays blank.
              </p>
            </div>
          )}

          {!loading && !error && rows.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full table-auto text-[12.5px]">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 text-left">HRM</th>
                    <th className="px-3 py-2.5 text-left">Name</th>
                    <th className="px-3 py-2.5 text-left">Job Title</th>
                    <th className="px-3 py-2.5 text-left">Dept (mapped)</th>
                    <th className="px-3 py-2.5 text-left">Manager</th>
                    <th className="px-3 py-2.5 text-right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(({ row, patch }) => {
                    const already = onboardedIds?.has(row.employeeNumber);
                    return (
                      <tr key={row.employeeNumber} className={already ? "bg-slate-50/60" : ""}>
                        <td className="px-3 py-2 font-mono text-[11.5px] text-slate-600">{row.employeeNumber}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800">{row.displayName}</div>
                          <div className="text-[11px] text-slate-500">{row.workEmail}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{row.jobTitle}</td>
                        <td className="px-3 py-2">
                          {patch.department ? (
                            <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                              {patch.department}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">— unmapped —</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {patch._managerMatchedName ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <CheckCircle2 size={11} />
                              <span className="text-[11.5px]">{patch._managerMatchedName}</span>
                            </span>
                          ) : row.reportingTo ? (
                            <span className="inline-flex items-center gap-1 text-amber-700">
                              <AlertCircle size={11} />
                              <span className="text-[11.5px]">{row.reportingTo} <em className="text-amber-600 not-italic">(not in app)</em></span>
                            </span>
                          ) : (
                            <span className="text-[11.5px] text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {already ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">
                              <CheckCircle2 size={11} />
                              Onboarded
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { onPick(row, patch); onClose(); }}
                              className="inline-flex items-center gap-1.5 rounded-md border border-[#008CFF]/30 bg-[#008CFF]/5 px-2.5 py-1.5 text-[11.5px] font-semibold text-[#008CFF] transition-colors hover:bg-[#008CFF]/10 hover:border-[#008CFF]/50"
                            >
                              Pre-fill form
                              <ArrowRight size={12} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-[12.5px] text-slate-500">
                        No rows match "{query}".
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
