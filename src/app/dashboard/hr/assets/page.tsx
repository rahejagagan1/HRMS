"use client";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { can } from "@/lib/permissions/can";
import { fetcher } from "@/lib/swr";
import { Box, Calendar, Tag, Hash, ExternalLink } from "lucide-react";
import AssetsPanel from "@/components/hr/AssetsPanel";

export default function AssetsPage() {
  const { data: session, status } = useSession();
  const me = session?.user as any;
  // Session attaches the DB user id as `dbId` (see src/lib/auth.ts
  // session callback). NOT `id` — NextAuth's default `id` field
  // isn't populated for credentials sessions. Reading `me?.id`
  // here would silently be undefined, the SWR call never fires,
  // and the page falsely shows "No assets assigned" even when
  // the user has 5 assets. Use `dbId` to match the API path.
  const meId = me?.dbId != null ? Number(me.dbId) : (me?.id != null ? Number(me.id) : null);
  const isAssetAdmin = can(session?.user as never, "MANAGE_ASSETS");

  // Fetch the user's own profile so we can show their assigned
  // items in the read-only "My Assets" view. Skipped for admins
  // who don't need it — they get the full register below.
  const { data: meData, isLoading: meLoading } = useSWR<any>(
    !isAssetAdmin && meId ? `/api/hr/people/${meId}` : null,
    fetcher,
  );

  if (status === "loading") {
    return <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627] p-8 text-slate-500">Loading…</div>;
  }

  if (isAssetAdmin) {
    // MANAGE_ASSETS-tier users (IT Security / HR / CEO / devs) get
    // the full register with admin actions (assign / return / edit
    // / delete). Same panel as before — no change for them.
    return (
      <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">
        <AssetsPanel showHeader />
      </div>
    );
  }

  // ── Read-only "My Assets" view for every other employee. ──────
  // Replaces the old "You don't have access" dead-end. Lists the
  // items currently assigned to them so they know what hardware
  // they're holding (laptop, monitor, ID card, etc.) without
  // exposing the rest of the company's register.
  const assigned: Array<any> = meData?.assets ?? [];

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">
      <div className="max-w-4xl mx-auto px-5 py-6">
        <header className="mb-5">
          <h1 className="text-[20px] font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Box size={20} className="text-[#008CFF]" />
            My Assets
          </h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Items currently assigned to you. If something here is wrong, raise a ticket via Helpdesk.
          </p>
        </header>

        {meLoading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
            <div className="inline-block h-6 w-6 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : assigned.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
            <Box size={32} className="mx-auto text-slate-300 mb-2" strokeWidth={1.5} />
            <h3 className="text-[14px] font-semibold text-slate-700">No assets assigned to you</h3>
            <p className="mt-1 text-[12.5px] text-slate-500">
              When IT assigns you hardware (laptop / monitor / ID card / etc.) it'll appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {assigned.map((a) => {
              // CPU category gets the same spec-chip treatment as
              // the admin AssetsPanel — split notes on newlines /
              // commas / semicolons into individual chips like
              // "i7-12700K", "32GB RAM", "RTX 4060Ti".
              const isCpu = a.category === "CPU" || a.category === "Laptop" || a.category === "Desktop";
              const specLines: string[] = isCpu && a.notes
                ? String(a.notes).split(/[\n,;]+/).map((s: string) => s.trim()).filter(Boolean)
                : [];
              return (
              <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-[#008CFF]/40 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-slate-900 truncate">
                      {a.name || a.assetTag || "Untitled asset"}
                    </p>
                    {a.category && (
                      <p className="mt-0.5 text-[11.5px] text-slate-500 inline-flex items-center gap-1">
                        <Tag size={11} /> {a.category}
                      </p>
                    )}
                  </div>
                  {a.condition && (
                    <span className="shrink-0 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10.5px] font-semibold uppercase tracking-wider">
                      {a.condition}
                    </span>
                  )}
                </div>

                {/* Specs row — only shown for CPU / Laptop / Desktop
                    categories where HR fills `notes` with the
                    component breakdown. Empty notes → row collapses. */}
                {specLines.length > 0 && (
                  <div className="mt-3 -mb-1 flex flex-wrap gap-1.5">
                    {specLines.map((s, i) => (
                      <span
                        key={i}
                        className="text-[11px] px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200/70 text-blue-800 font-mono"
                      >{s}</span>
                    ))}
                  </div>
                )}

                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-[11.5px] text-slate-600">
                  {a.assetTag && (
                    <div className="inline-flex items-center gap-1 truncate">
                      <Hash size={11} className="text-slate-400" />
                      <span className="font-semibold">{a.assetTag}</span>
                    </div>
                  )}
                  {a.serialNumber && (
                    <div className="inline-flex items-center gap-1 truncate" title={`Serial: ${a.serialNumber}`}>
                      <ExternalLink size={11} className="text-slate-400" />
                      <span className="truncate">{a.serialNumber}</span>
                    </div>
                  )}
                  {a.assignedAt && (
                    <div className="inline-flex items-center gap-1 col-span-2">
                      <Calendar size={11} className="text-slate-400" />
                      Assigned {new Date(a.assignedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
