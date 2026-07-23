"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import SelectField from "@/components/ui/SelectField";
import { isAdmin as isAdminUser } from "@/lib/access";

export default function AnnouncementsPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  // Was: ceo | isDeveloper. Missing special_access + role=admin —
  // those users couldn't see the create button even though the API
  // allowed them. Now matches src/lib/access.ts:isAdmin exactly.
  const isAdmin = isAdminUser(user);
  const [showCreate, setShowCreate] = useState(false);

  const { data: announcements = [], isLoading } = useSWR("/api/hr/announcements", fetcher);

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">
      {/* ── Header ── */}
      <div className="bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6 py-5">
        <div className="flex items-center text-xs text-slate-500 mb-3 gap-1.5">
          <Link href="/dashboard" className="hover:text-slate-800 dark:text-white transition-colors">Home</Link><span>/</span>
          <span className="text-slate-800 dark:text-white">Announcements</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-semibold text-slate-800 dark:text-white tracking-tight">Announcements</h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">{announcements.length} announcements posted</p>
          </div>
          {isAdmin && <button onClick={() => setShowCreate(true)} className="h-9 px-4 bg-[#008CFF] hover:bg-[#0077dd] text-slate-800 dark:text-white rounded-lg text-[13px] font-semibold">+ New Announcement</button>}
        </div>
      </div>

      <div className="px-6 pt-5 max-w-3xl mx-auto space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" /></div>
        ) : announcements.length === 0 ? (
          <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl px-5 py-3 flex items-center justify-between">
            <span className="text-[13px] text-slate-500 dark:text-slate-400">No announcements</span>
            {isAdmin && <button onClick={() => setShowCreate(true)} className="w-7 h-7 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white hover:bg-slate-200 dark:bg-white/10 transition-colors text-lg">+</button>}
          </div>
        ) : (
          announcements.map((a: any) => (
            <div key={a.id} className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden animate-fade-in">
              {/* Author header */}
              <div className="flex items-center gap-3 px-5 py-3 border-b border-white/[0.04]">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-slate-800 dark:text-white text-sm font-medium overflow-hidden">
                  {a.author?.profilePictureUrl ? <img src={a.author.profilePictureUrl} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" /> : a.author?.name?.charAt(0)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-slate-800 dark:text-white">{a.author?.name}</span>
                    <span className="text-[11px] text-slate-600">posted</span>
                  </div>
                  <span className="text-[11px] text-slate-500">{new Date(a.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} · {new Date(a.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                {a.isPinned && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">📌 Pinned</span>}
                <button className="text-slate-600 hover:text-slate-800 dark:text-white">⋯</button>
              </div>

              {/* Content */}
              <div className="px-5 py-4">
                <h3 className="text-[15px] font-semibold text-slate-800 dark:text-white mb-2">{a.title}</h3>
                <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed whitespace-pre-wrap">{a.content}</p>
              </div>

              {/* Footer */}
              <div className="px-5 py-2.5 border-t border-white/[0.04] flex items-center gap-4">
                <span className="text-[11px] text-slate-500">👁️ {a.readCount || 0} views</span>
                {a.targetAudience && <span className="text-[11px] text-slate-600">Audience: {a.targetAudience}</span>}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Create Announcement Slide Panel ── */}
      {showCreate && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowCreate(false)} />
          <CreateAnnouncementPanel onClose={() => setShowCreate(false)} />
        </>
      )}
    </div>
  );
}

function CreateAnnouncementPanel({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ title: "", content: "", isPinned: false, targetAudience: "all" });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.title || !form.content) return;
    setSaving(true);
    await fetch("/api/hr/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    mutate("/api/hr/announcements");
    onClose();
  };

  return (
    <div className="fixed top-0 right-0 bottom-0 w-[400px] bg-[#f4f7f8] dark:bg-[#001529] border-l border-slate-200 dark:border-white/[0.08] shadow-2xl z-50 flex flex-col animate-slide-in">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
        <h2 className="text-[16px] font-semibold text-slate-800 dark:text-white">New Announcement</h2>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-800 dark:text-white text-xl">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        <div>
          <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Title</label>
          <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} className="w-full h-10 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]/40" />
        </div>
        <div>
          <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Content</label>
          <textarea value={form.content} onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))} rows={6} className="w-full px-3 py-2.5 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white placeholder-slate-600 focus:outline-none resize-none" />
        </div>
        <div>
          <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Target Audience</label>
          <SelectField
            value={form.targetAudience}
            onChange={(v) => setForm((p) => ({ ...p, targetAudience: v }))}
            options={[
              { value: "all",        label: "Everyone" },
              { value: "department", label: "Department" },
              { value: "team",       label: "Team Only" },
            ]}
            className="w-full h-10 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white"
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.isPinned} onChange={(e) => setForm((p) => ({ ...p, isPinned: e.target.checked }))} className="w-4 h-4 rounded bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08]" />
          <span className="text-[13px] text-slate-500 dark:text-slate-400">Pin this announcement</span>
        </label>
      </div>
      <div className="px-6 py-4 border-t border-slate-200 dark:border-white/[0.06] flex justify-end gap-3">
        <button onClick={onClose} className="h-9 px-5 text-[13px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white rounded-lg">Cancel</button>
        <button onClick={submit} disabled={saving} className="h-9 px-5 bg-[#008CFF] hover:bg-[#0077dd] disabled:opacity-40 text-slate-800 dark:text-white rounded-lg text-[13px] font-semibold">{saving ? "Posting..." : "Post"}</button>
      </div>
    </div>
  );
}
