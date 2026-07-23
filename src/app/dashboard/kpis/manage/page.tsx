"use client";

// Admin-only KPI document management. HR / admin tier uploads ONE file
// per department — every employee whose EmployeeProfile.department
// matches will see the doc on the public KPI listing automatically.

import { useEffect, useRef, useState, useMemo } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, BarChart3, FileText, Upload, Trash2, AlertCircle, CheckCircle2,
} from "lucide-react";
import { isFullHRAdmin } from "@/lib/access";
import { DEPARTMENTS } from "@/lib/departments";
import { DEPARTMENTS_YT_LABS } from "@/lib/departments-yt-labs";

type Doc = {
  id: number;
  department: string;
  fileName: string;
  fileUrl: string;
  uploadedAt: string;
  uploadedBy: number | null;
};

export default function ManageKpisPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const user = session?.user as any;

  // Page-level guard — bounce non-admins to the read-only listing.
  useEffect(() => {
    if (status === "loading") return;
    if (!isFullHRAdmin(user)) router.replace("/dashboard/kpis");
  }, [status, user, router]);

  // Brand scope from `?brand=` — narrows the Department picker to the
  // brand's canonical list and the existing-docs table to docs whose
  // department belongs to that list. "all" = both brand catalogs.
  const searchParams = useSearchParams();
  const brandSlug = (searchParams?.get("brand") || "").toLowerCase();
  const brand =
    brandSlug === "yt-labs" || brandSlug === "yt"      ? "YT Labs" :
    brandSlug === "nb-media" || brandSlug === "nb"     ? "NB Media" :
    "all";
  const deptOptions = useMemo(() => {
    if (brand === "YT Labs") return DEPARTMENTS_YT_LABS;
    if (brand === "NB Media") return DEPARTMENTS;
    return [...DEPARTMENTS, ...DEPARTMENTS_YT_LABS];
  }, [brand]);

  const { data } = useSWR<{ docs: Doc[] }>("/api/kpis/documents", fetcher);
  const allDocs = data?.docs ?? [];
  // Narrow the existing-docs table to only departments in scope. Docs
  // for departments outside the chosen brand are filtered out so the
  // YT Labs HR doesn't see NB Media KPI rows and vice versa.
  // Each doc row now carries its own `brand` (after the schema
  // migration). Filter on that directly instead of inferring brand
  // from department-catalogue membership — handles the shared
  // "HR Operations & TA" case correctly.
  const docs = useMemo(() => {
    if (brand === "all") return allDocs;
    const wanted = brand === "yt-labs" ? "YT Labs" : "NB Media";
    return allDocs.filter((d: any) => (d.brand ?? "NB Media") === wanted);
  }, [allDocs, brand]);

  const [department, setDepartment] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const onUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!department) { setError("Pick a department."); return; }
    if (!file) { setError("Attach the KPI document."); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("department", department);
      fd.append("file", file);
      // Brand goes into the FormData so the row is keyed by
      // (brand, department). When "all" is selected (super-admin
      // view), fall back to NB Media — same parent-brand default the
      // server applies if the field is omitted.
      const uploadBrand = brand === "all" ? "nb-media" : brand;
      fd.append("brand", uploadBrand);
      const res  = await fetch("/api/kpis/documents", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      setSuccess(`Uploaded ${brand === "yt-labs" ? "YT Labs" : "NB Media"} KPI for ${department}.`);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      mutate("/api/kpis/documents");
      mutate("/api/kpis");
    } catch (e: any) {
      setError(e?.message || "Upload failed");
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (id: number, dept: string) => {
    if (!confirm(`Remove the KPI document for ${dept}? Employees in this department will lose access.`)) return;
    const res = await fetch(`/api/kpis/documents?id=${id}`, { method: "DELETE" });
    if (!res.ok) { alert("Could not delete the document"); return; }
    mutate("/api/kpis/documents");
    mutate("/api/kpis");
  };

  if (status === "loading" || !isFullHRAdmin(user)) return null;

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/dashboard/hr/admin" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#3b82f6] hover:underline">
          <ArrowLeft size={13} /> Back to HR Dashboard
        </Link>
        <div className="mt-2 mb-6 flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3b82f6]/10 text-[#3b82f6]">
            <BarChart3 size={20} />
          </div>
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-slate-800 inline-flex items-center gap-2">
              Manage KPI documents
              {brand !== "all" && (
                <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#3b82f6]/10 text-[#3b82f6]">
                  {brand}
                </span>
              )}
            </h1>
            <p className="mt-0.5 text-[13px] text-slate-500">
              One document per department. Every employee in that department sees the doc automatically.
            </p>
          </div>
        </div>

        {/* Upload card */}
        <form onSubmit={onUpload} className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-[14px] font-bold text-slate-800 mb-4">Upload / replace</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Department</label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[14px] text-slate-800 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15"
              >
                <option value="">Select a department</option>
                {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <p className="mt-1 text-[11.5px] text-slate-400">
                Match the value used on employees' profiles (case-sensitive).
              </p>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">KPI document</label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block h-11 w-full text-[13px] text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-[#3b82f6]/10 file:px-3 file:py-2 file:text-[12px] file:font-semibold file:text-[#3b82f6] hover:file:bg-[#3b82f6]/15"
              />
              <p className="mt-1 text-[11.5px] text-slate-400">PDF, Word, or Excel. 10 MB max.</p>
            </div>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-700">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#2563eb] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload size={14} />
              {submitting ? "Uploading…" : "Upload"}
            </button>
          </div>
        </form>

        {/* Existing docs */}
        <h2 className="mb-3 text-[12px] font-bold uppercase tracking-[0.12em] text-slate-500">Existing KPI documents</h2>
        {docs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-[13px] text-slate-500">
            No KPI documents uploaded yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Department</th>
                  <th className="px-4 py-3 font-semibold">File</th>
                  <th className="px-4 py-3 font-semibold">Uploaded</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {docs.map((d) => (
                  <tr key={d.id} className="text-slate-700 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{d.department}</td>
                    <td className="px-4 py-3">
                      <a href={d.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[#3b82f6] hover:underline">
                        <FileText size={13} /> {d.fileName}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-[12px]">
                      {new Date(d.uploadedAt).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onDelete(d.id, d.department)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
