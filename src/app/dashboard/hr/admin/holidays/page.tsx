"use client";
import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import SelectField from "@/components/ui/SelectField";
import { CalendarDays, Pencil, Trash2, Plus, X, Check } from "lucide-react";
import { DateField } from "@/components/ui/date-field";

type Holiday = { id: number; name: string; date: string; type: string; year: number };

const TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  public:   { label: "Public",   color: "#008CFF", bg: "rgba(0,140,255,0.1)"  },
  company:  { label: "Company",  color: "#7c3aed", bg: "rgba(124,58,237,0.1)" },
  optional: { label: "Floater",  color: "#059669", bg: "rgba(5,150,105,0.1)"  },
};

export default function HolidaysAdminPage() {
  const { data: session } = useSession();
  const me = session?.user as any;
  // Holidays & Calendar is available to admin, CEO, HR manager, and developer.
  const canEdit =
    me?.isDeveloper === true ||
    me?.role === "admin" ||
    me?.orgLevel === "ceo" ||
    me?.orgLevel === "hr_manager";

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [editing, setEditing] = useState<Partial<Holiday> | null>(null);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState("");

  const { data = [], isLoading } = useSWR<Holiday[]>(`/api/hr/admin/holidays?year=${year}`, fetcher);

  const sorted = useMemo(
    () => [...data].sort((a, b) => a.date.localeCompare(b.date)),
    [data]
  );
  const byMonth = useMemo(() => {
    const map = new Map<string, Holiday[]>();
    for (const h of sorted) {
      const key = new Date(h.date).toLocaleString("default", { month: "long" });
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(h);
    }
    return Array.from(map.entries());
  }, [sorted]);

  const openCreate = () => { setErr(""); setEditing({ name: "", date: "", type: "public" }); };
  const openEdit   = (h: Holiday) => { setErr(""); setEditing({ ...h, date: String(h.date).slice(0, 10) }); };

  const save = async () => {
    if (!editing) return;
    setErr("");
    if (!editing.name || !editing.date) return setErr("Name and date are required.");
    setSaving(true);
    const res = await fetch("/api/hr/admin/holidays", {
      method: editing.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setErr((body as any).error || "Failed to save"); setSaving(false); return; }
    mutate((k: any) => typeof k === "string" && k.startsWith("/api/hr/admin/holidays"));
    setEditing(null); setSaving(false);
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this holiday?")) return;
    const res = await fetch(`/api/hr/admin/holidays?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      mutate((k: any) => typeof k === "string" && k.startsWith("/api/hr/admin/holidays"));
    }
  };

  const years = [currentYear - 1, currentYear, currentYear + 1];

  if (!canEdit) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[14px] text-slate-600 font-medium">You don't have permission to manage holidays.</p>
          <Link href="/dashboard/hr/home" className="text-[12px] text-[#008CFF] hover:underline mt-2 inline-block">
            Back to HR Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#008CFF]/10 flex items-center justify-center">
            <CalendarDays className="w-5 h-5 text-[#008CFF]" />
          </div>
          <div>
            <h1 className="text-[18px] font-bold text-slate-800">Holidays & Calendar</h1>
            <p className="text-[12px] text-slate-500">Configure company holiday calendar · visible to every employee</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SelectField
            value={String(year)}
            onChange={(v) => setYear(parseInt(v, 10))}
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
            className="h-9 w-[110px] px-3 rounded-lg border border-slate-200 bg-white text-[13px] text-slate-700"
          />
          <button
            onClick={openCreate}
            className="h-9 px-4 rounded-lg bg-[#008CFF] text-white text-[13px] font-semibold hover:bg-[#0070cc] flex items-center gap-1.5"
          >
            <Plus size={14} strokeWidth={2.5} /> Add Holiday
          </button>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <p className="text-[14px] font-semibold text-slate-700 mb-1">No holidays configured for {year}</p>
          <p className="text-[12px] text-slate-500 mb-4">Add company and public holidays so employees see them on the HR home.</p>
          <button onClick={openCreate} className="h-9 px-4 rounded-lg bg-[#008CFF] text-white text-[13px] font-semibold hover:bg-[#0070cc]">
            + Add your first holiday
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {byMonth.map(([month, items]) => (
            <div key={month} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200">
                <span className="text-[10.5px] uppercase tracking-widest font-bold text-slate-500">{month} {year}</span>
              </div>
              <div>
                {items.map((h) => {
                  const meta = TYPE_META[h.type] || TYPE_META.public;
                  const d = new Date(h.date);
                  return (
                    <div key={h.id} className="flex items-center justify-between px-5 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col items-center justify-center w-12 h-12 rounded-lg border border-slate-200 bg-slate-50">
                          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                            {d.toLocaleString("default", { month: "short" })}
                          </span>
                          <span className="text-[15px] font-bold text-slate-800 leading-none">
                            {String(d.getUTCDate()).padStart(2, "0")}
                          </span>
                        </div>
                        <div>
                          <p className="text-[13.5px] font-semibold text-slate-800">{h.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span
                              className="text-[10.5px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded"
                              style={{ color: meta.color, background: meta.bg }}
                            >
                              {meta.label}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {d.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(h)}
                          title="Edit"
                          className="w-8 h-8 rounded-lg text-slate-500 hover:text-[#008CFF] hover:bg-[#008CFF]/10 flex items-center justify-center"
                        >
                          <Pencil size={14} strokeWidth={2} />
                        </button>
                        <button
                          onClick={() => remove(h.id)}
                          title="Delete"
                          className="w-8 h-8 rounded-lg text-slate-500 hover:text-rose-500 hover:bg-rose-50 flex items-center justify-center"
                        >
                          <Trash2 size={14} strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal — add / edit */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <h3 className="text-[14px] font-semibold text-slate-800">{editing.id ? "Edit holiday" : "Add holiday"}</h3>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {err && <p className="text-[12px] text-rose-600 bg-rose-50 px-3 py-2 rounded-lg">{err}</p>}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Name</label>
                <input
                  value={editing.name ?? ""}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="e.g. Diwali"
                  className="mt-1.5 w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-[13px] text-slate-800 focus:outline-none focus:border-[#008CFF]"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Date</label>
                <DateField
                  value={editing.date ?? ""}
                  onChange={(v) => setEditing({ ...editing, date: v })}
                  className="mt-1.5 w-full"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Type</label>
                <SelectField
                  value={editing.type ?? "public"}
                  onChange={(v) => setEditing({ ...editing, type: v })}
                  options={[
                    { value: "public",   label: "Public — gazetted national holiday" },
                    { value: "company",  label: "Company — paid day off set by NB Media" },
                    { value: "optional", label: "Floater — regional / employee choice" },
                  ]}
                  className="mt-1.5 w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-[13px] text-slate-800"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200">
              <button onClick={() => setEditing(null)} className="h-9 px-4 text-[13px] font-medium text-slate-500 hover:text-slate-800">Cancel</button>
              <button
                onClick={save}
                disabled={saving}
                className="h-9 px-5 rounded-lg bg-[#008CFF] text-white text-[13px] font-semibold hover:bg-[#0070cc] disabled:opacity-60 flex items-center gap-1.5"
              >
                {saving ? "Saving…" : (<><Check size={14} strokeWidth={2.5} /> {editing.id ? "Save changes" : "Add holiday"}</>)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
