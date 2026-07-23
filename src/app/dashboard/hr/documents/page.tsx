"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import SelectField from "@/components/ui/SelectField";
import { isHRAdmin } from "@/lib/access";
import { FileText } from "lucide-react";

// Folder taxonomy — mirrors the personal "My documents" view
// (profile page SELF_DOC_FOLDERS) so the two stay consistent on names
// AND grouping. Each tab filters by the raw category values it holds;
// `cats: null` is the All tab (no filter). The old tabs (Identity /
// Finance / Legal / …) never matched the stored category values
// (employee_letter, offer_letter, …) so every tab but "All" was empty.
const DOC_FOLDERS: { key: string; label: string; cats: string[] | null }[] = [
  { key: "all",       label: "All",                 cats: null },
  { key: "identity",  label: "Identity Documents",  cats: ["pan_card", "aadhar", "passport", "driving_license"] },
  { key: "education", label: "Education",           cats: ["education_certificate"] },
  { key: "letters",   label: "Employment Letters",  cats: ["offer_letter"] },
  { key: "previous",  label: "Previous Experience", cats: ["previous_relieving_letter", "previous_offer_letter"] },
  { key: "other",     label: "Other Documents",     cats: ["other", "employee_letter"] },
];

export default function DocumentsPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  // Mirrors the API gate. Was: ceo | isDeveloper (missing special_access
  // + role=admin + hr_manager). HR admins now correctly see the upload
  // button — matches what /api/hr/documents accepts.
  const isAdmin = isHRAdmin(user);
  const [folderKey, setFolderKey] = useState("all");
  const [showUpload, setShowUpload] = useState(false);

  // This page shows ONLY the logged-in user's own documents — never
  // the org-wide list. `self=true` scopes server-side to the caller
  // for admins AND non-admins alike (an HR-admin would otherwise fall
  // through to everyone's docs). Admins browse other employees' docs
  // from the People directory → employee profile.
  const { data: documents = [], isLoading } = useSWR("/api/hr/documents?self=true", fetcher);
  const activeFolder = DOC_FOLDERS.find((f) => f.key === folderKey);
  const filtered = !activeFolder?.cats
    ? documents
    : documents.filter((d: any) => activeFolder.cats!.includes(d.category));

  // EmployeeDocument stores a boolean `isVerified` (no separate
  // pending/rejected states), so verified = isVerified, pending =
  // everything not yet verified. Rejected isn't modelled → always 0.
  const counts = {
    total: documents.length,
    verified: documents.filter((d: any) => d.isVerified).length,
    pending: documents.filter((d: any) => !d.isVerified).length,
    rejected: 0,
  };

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">
      {/* ── Org-style Top Tabs ── */}
      <div className="flex items-center gap-0 bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6">
        {[
          { key: "employees", label: "EMPLOYEES", href: "/dashboard/hr/people" },
          { key: "documents", label: "DOCUMENTS", href: "/dashboard/hr/documents" },
          { key: "engage", label: "ENGAGE", href: "/dashboard/hr/announcements" },
        ].map((t) => (
          <Link key={t.key} href={t.href}
            className={`px-5 py-3 text-[12px] font-semibold tracking-wider transition-colors border-b-2 ${
              t.key === "documents" ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white"
            }`}>
            {t.label}
          </Link>
        ))}
      </div>

      {/* ── Header ── */}
      <div className="px-6 py-5 border-b border-slate-200 dark:border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[17px] font-semibold text-slate-800 dark:text-white tracking-tight">Documents</h1>
            <p className="text-[12px] text-slate-500 mt-0.5">{documents.length} documents uploaded</p>
          </div>
          <button onClick={() => setShowUpload(true)} className="h-9 px-4 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[12px] font-semibold">+ Upload Document</button>
        </div>
      </div>

      <div className="px-6 pt-5 space-y-5">
        {/* ── Status Cards ── */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Documents", value: counts.total, color: "text-cyan-400", bg: "bg-cyan-500/8" },
            { label: "Verified", value: counts.verified, color: "text-emerald-400", bg: "bg-emerald-500/8" },
            { label: "Pending Review", value: counts.pending, color: "text-amber-400", bg: "bg-amber-500/8" },
            { label: "Rejected", value: counts.rejected, color: "text-red-400", bg: "bg-red-500/8" },
          ].map((s) => (
            <div key={s.label} className={`${s.bg} rounded-xl px-5 py-4`}>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── Category Tabs ── */}
        <div className="flex gap-0 border-b border-slate-200 dark:border-white/[0.06]">
          {DOC_FOLDERS.map((f) => (
            <button key={f.key} onClick={() => setFolderKey(f.key)} className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap ${folderKey === f.key ? "border-[#008CFF] text-slate-800 dark:text-white" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-white"}`}>{f.label}</button>
          ))}
        </div>

        {/* ── Documents Table ── */}
        {isLoading ? (
          <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-slate-200 dark:border-white/[0.06]">{["Document", "Category", "Employee", "Uploaded", "Status"].map((h) => <th key={h} className="px-5 py-3 text-left text-[11px] uppercase tracking-wider text-slate-500 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {filtered.map((doc: any, i: number) => (
                  <tr key={doc.id} className={`border-b border-slate-100 dark:border-white/[0.03] ${i % 2 === 0 ? "" : "bg-slate-50 dark:bg-white/[0.01]"}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0"><FileText size={16} className="text-[#008CFF]" /></div>
                        <div className="min-w-0">
                          <p className="text-[13px] text-slate-800 dark:text-white font-medium truncate">{doc.fileName || "Untitled document"}</p>
                          {doc.fileUrl && <a href={doc.fileUrl} target="_blank" className="text-[11px] text-[#008CFF] hover:underline">View file</a>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3"><span className="text-[12px] px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300">{doc.category}</span></td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">{(doc.user?.name ?? "?").charAt(0).toUpperCase()}</div>
                        <span className="text-[13px] text-slate-800 dark:text-white">{doc.user?.name ?? "—"}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-[13px] text-slate-500 dark:text-slate-400">{new Date(doc.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td className="px-5 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full ${doc.isVerified ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>{doc.isVerified ? "Verified" : "Pending"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <p className="text-[13px] text-slate-500 text-center py-12">No documents found</p>}
          </div>
        )}
      </div>

      {/* ── Upload Document Slide Panel ── */}
      {showUpload && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowUpload(false)} />
          <div className="fixed top-0 right-0 bottom-0 w-[380px] bg-[#f4f7f8] dark:bg-[#001529] border-l border-slate-200 dark:border-white/[0.08] shadow-2xl z-50 flex flex-col animate-slide-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
              <h2 className="text-[16px] font-semibold text-slate-800 dark:text-white">Upload Document</h2>
              <button onClick={() => setShowUpload(false)} className="text-slate-500 hover:text-slate-800 dark:text-white text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Document Name</label>
                <input className="w-full h-10 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]/40" />
              </div>
              <div>
                <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Category</label>
                <SelectField
                  value=""
                  onChange={() => { /* unwired in this stub modal */ }}
                  options={DOC_FOLDERS.filter((f) => f.key !== "all").map((f) => f.label)}
                  className="w-full h-10 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Select File</label>
                <div className="border-2 border-dashed border-slate-200 dark:border-white/[0.08] rounded-xl p-8 text-center hover:border-[#008CFF]/20 transition-colors cursor-pointer">
                  <span className="material-icons-outlined text-slate-500" style={{fontSize:'36px'}}>cloud_upload</span>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-2">Click or drag to upload</p>
                  <p className="text-[11px] text-slate-600 mt-1">PDF, DOC, JPG up to 10MB</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 dark:border-white/[0.06] flex justify-end gap-3">
              <button onClick={() => setShowUpload(false)} className="h-9 px-5 text-[13px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white rounded-lg">Cancel</button>
              <button className="h-9 px-5 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[13px] font-semibold">Upload</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
