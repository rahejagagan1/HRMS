"use client";

// Settings tab — three sub-sections:
//   • Pipeline Stages  — view the active stages (read-only for v1)
//   • Email Templates  — full CRUD + auto-send toggle
//   • Application Form — link to the legacy Form Settings (re-used)

import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { showToast } from "@/components/ui/Toast";
import { fetcher } from "@/lib/swr";
import { useUrlTab } from "@/lib/hooks/useUrlTab";
import { Mail, ChevronDown, ChevronRight, Edit3, Trash2, Plus, Save, X, ToggleLeft, ToggleRight, Upload, FileText, GripVertical } from "lucide-react";

type Stage = { id: number; key: string; label: string; sortOrder: number; kind: string; color: string; isActive: boolean };
type Template = {
  id: number; key: string; name: string; trigger: string; stageId: number | null;
  subject: string; bodyHtml: string; isActive: boolean; autoSend: boolean;
  stageKey: string | null; stageLabel: string | null;
};

const TRIGGER_LABELS: Record<string, string> = {
  manual:               "Manual",
  stage_change:         "On stage change",
  interview_scheduled:  "On interview scheduled",
  offer:                "On offer extended",
  rejection:            "On rejection",
};

// (Security note) The template preview renders HR-authored HTML inside
// a sandboxed iframe (`<iframe sandbox srcdoc=…>`) so any markup runs
// in a null-origin frame with no JS / no parent access. This is more
// robust than a regex sanitizer — known XSS bypasses like mangled
// tags can't escape the iframe sandbox.

export default function SettingsTab() {
  // URL-synced so refresh on Stages / Templates / Form returns to
  // the same section. Distinct from outer "tab" param.
  const [section, setSection] = useUrlTab<"stages" | "templates" | "form">(
    "section", "templates",
    ["stages", "templates", "form"] as const,
  );

  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b border-slate-200">
        {[
          { k: "templates", l: "Email Templates" },
          { k: "stages",    l: "Pipeline Stages" },
          { k: "form",      l: "Application Form" },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setSection(t.k as any)}
            className={`px-4 py-2.5 text-[12px] font-semibold border-b-2 -mb-px transition-colors ${
              section === t.k ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >{t.l}</button>
        ))}
      </div>

      {section === "templates" && <EmailTemplatesPanel />}
      {section === "stages"    && <StagesPanel />}
      {section === "form"      && <FormSettingsPanel />}
    </div>
  );
}

function EmailTemplatesPanel() {
  const { data, isLoading } = useSWR<{ templates: Template[] }>("/api/hr/hiring/email-templates", fetcher);
  const templates = data?.templates ?? [];
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-semibold text-slate-800">Email Templates</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Auto-send candidate emails when they hit a stage. Merge tags: <code className="text-[10.5px] bg-slate-100 px-1 rounded">{"{{candidate_name}}"}</code>, <code className="text-[10.5px] bg-slate-100 px-1 rounded">{"{{job_title}}"}</code>, <code className="text-[10.5px] bg-slate-100 px-1 rounded">{"{{company}}"}</code>.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="h-9 px-4 rounded-lg bg-[#008CFF] text-white text-[12px] font-semibold inline-flex items-center gap-1.5 hover:bg-[#0070cc]"
        ><Plus size={13} /> New template</button>
      </div>

      <div className="space-y-2">
        {isLoading && <p className="text-[12px] text-slate-400 text-center py-8">Loading…</p>}
        {!isLoading && templates.length === 0 && <p className="text-[12px] text-slate-400 text-center py-8">No templates yet — create one to start auto-sending candidate emails.</p>}
        {templates.map((t) => (
          <TemplateCard key={t.id} t={t} onEdit={() => setEditing(t)} />
        ))}
      </div>

      {(editing || creating) && (
        <TemplateEditor
          template={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); globalMutate("/api/hr/hiring/email-templates"); }}
        />
      )}
    </div>
  );
}

function TemplateCard({ t, onEdit }: { t: Template; onEdit: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const toggleActive = async () => {
    await fetch(`/api/hr/hiring/email-templates/${t.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !t.isActive }),
    });
    globalMutate("/api/hr/hiring/email-templates");
  };
  const toggleAutoSend = async () => {
    await fetch(`/api/hr/hiring/email-templates/${t.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoSend: !t.autoSend }),
    });
    globalMutate("/api/hr/hiring/email-templates");
  };
  const del = async () => {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    await fetch(`/api/hr/hiring/email-templates/${t.id}`, { method: "DELETE" });
    globalMutate("/api/hr/hiring/email-templates");
  };

  return (
    <div className={`rounded-xl border bg-white ${t.isActive ? "border-slate-200" : "border-dashed border-slate-200 opacity-70"}`}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Mail size={15} className="text-slate-400 shrink-0" />
          <div className="text-left min-w-0">
            <p className="text-[13px] font-semibold text-slate-800 truncate">{t.name}</p>
            <p className="text-[11px] text-slate-500 truncate">{TRIGGER_LABELS[t.trigger] || t.trigger}{t.stageLabel ? ` → ${t.stageLabel}` : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {t.autoSend && t.isActive && (<span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">AUTO</span>)}
          {!t.isActive && (<span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-600">OFF</span>)}
          {expanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
        </div>
      </button>
      {expanded && (
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/40 space-y-3">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">Subject</p>
            <p className="text-[12.5px] text-slate-800">{t.subject}</p>
          </div>
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">Body</p>
            <iframe
              title="Email template preview"
              sandbox=""
              srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;font-size:12px;color:#334155;margin:12px;line-height:1.5}</style>${t.bodyHtml}`}
              className="w-full h-48 rounded-lg border border-slate-200 bg-white"
            />
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button onClick={onEdit} className="h-8 px-3 rounded-md border border-slate-200 text-[11.5px] font-semibold text-slate-700 inline-flex items-center gap-1.5"><Edit3 size={11} /> Edit</button>
            <button onClick={toggleAutoSend} className="h-8 px-3 rounded-md border border-slate-200 text-[11.5px] font-semibold text-slate-700 inline-flex items-center gap-1.5">
              {t.autoSend ? <ToggleRight size={13} className="text-emerald-600" /> : <ToggleLeft size={13} className="text-slate-400" />}
              {t.autoSend ? "Auto-send ON" : "Auto-send OFF"}
            </button>
            <button onClick={toggleActive} className="h-8 px-3 rounded-md border border-slate-200 text-[11.5px] font-semibold text-slate-700">
              {t.isActive ? "Deactivate" : "Activate"}
            </button>
            <button onClick={del} className="h-8 px-3 rounded-md border border-rose-200 text-[11.5px] font-semibold text-rose-600 inline-flex items-center gap-1.5 ml-auto"><Trash2 size={11} /> Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateEditor({ template, onClose, onSaved }: { template: Template | null; onClose: () => void; onSaved: () => void }) {
  const { data: stagesData } = useSWR<{ stages: Stage[] }>("/api/hr/hiring/stages", fetcher);
  const stages = stagesData?.stages ?? [];
  const [form, setForm] = useState({
    key:      template?.key ?? `tpl_${Date.now()}`,
    name:     template?.name ?? "",
    trigger:  template?.trigger ?? "manual",
    stageId:  template?.stageId ?? null as number | null,
    subject:  template?.subject ?? "",
    bodyHtml: template?.bodyHtml ?? "<p>Hi {{candidate_name}},</p><p>…</p>",
    isActive: template?.isActive ?? true,
    autoSend: template?.autoSend ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  /** Upload a .docx / .html / .txt and pre-fill the body. */
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so re-picking the same file fires onChange
    if (!file) return;
    setUploading(true); setUploadStatus(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/hr/hiring/parse-template", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadStatus({ kind: "err", msg: j?.error || `Upload failed (${res.status})` });
        return;
      }
      setForm((f) => ({
        ...f,
        bodyHtml: j.html || f.bodyHtml,
        subject:  !f.subject && j.subjectGuess ? j.subjectGuess : f.subject,
        name:     !f.name && j.subjectGuess ? j.subjectGuess : f.name,
      }));
      setUploadStatus({ kind: "ok", msg: `Loaded ${file.name}${j.subjectGuess ? " (subject auto-filled)" : ""}` });
    } catch (err: any) {
      setUploadStatus({ kind: "err", msg: err?.message || "Upload failed" });
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.subject.trim() || !form.bodyHtml.trim()) return;
    setBusy(true);
    try {
      if (template) {
        await fetch(`/api/hr/hiring/email-templates/${template.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      } else {
        await fetch("/api/hr/hiring/email-templates", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      }
      onSaved();
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-3xl rounded-xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-[15px] font-semibold text-slate-800">{template ? "Edit template" : "New template"}</h3>
          <button type="button" onClick={onClose}><X size={16} className="text-slate-400" /></button>
        </div>
        <div className="overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Name" required>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-9 w-full rounded-lg border border-slate-200 px-3 text-[13px]" />
            </FieldRow>
            <FieldRow label="Trigger">
              <select value={form.trigger} onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value }))} className="h-9 w-full rounded-lg border border-slate-200 px-3 text-[13px]">
                {Object.entries(TRIGGER_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
              </select>
            </FieldRow>
            {form.trigger === "stage_change" && (
              <FieldRow label="Stage">
                <select value={form.stageId ?? ""} onChange={(e) => setForm((f) => ({ ...f, stageId: e.target.value ? Number(e.target.value) : null }))} className="h-9 w-full rounded-lg border border-slate-200 px-3 text-[13px]">
                  <option value="">— select —</option>
                  {stages.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
                </select>
              </FieldRow>
            )}
            <FieldRow label="Auto-send">
              <label className="inline-flex items-center gap-2 h-9">
                <input type="checkbox" checked={form.autoSend} onChange={(e) => setForm((f) => ({ ...f, autoSend: e.target.checked }))} className="rounded text-[#008CFF]" />
                <span className="text-[12.5px] text-slate-700">Send automatically when triggered</span>
              </label>
            </FieldRow>
          </div>
          <FieldRow label="Subject" required>
            <input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} className="h-9 w-full rounded-lg border border-slate-200 px-3 text-[13px]" placeholder="Use merge tags like {{candidate_name}}" />
          </FieldRow>
          <FieldRow label="HTML body" required>
            <div className="flex items-center justify-between mb-1.5">
              <label className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-slate-200 bg-white text-[11.5px] font-semibold text-slate-700 cursor-pointer hover:bg-slate-50">
                <Upload size={11} />
                {uploading ? "Uploading…" : "Upload .docx / .html / .txt"}
                <input
                  type="file"
                  accept=".docx,.html,.htm,.txt,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={onUpload}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
              {uploadStatus && (
                <span className={`inline-flex items-center gap-1 text-[11px] ${
                  uploadStatus.kind === "ok" ? "text-emerald-600" : "text-rose-600"
                }`}>
                  <FileText size={11} /> {uploadStatus.msg}
                </span>
              )}
            </div>
            <textarea
              value={form.bodyHtml}
              onChange={(e) => setForm((f) => ({ ...f, bodyHtml: e.target.value }))}
              rows={10}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-mono"
            />
            <p className="text-[10.5px] text-slate-500 mt-1">
              Merge tags: <code className="bg-slate-100 px-1 rounded">{"{{candidate_name}}"}</code> · <code className="bg-slate-100 px-1 rounded">{"{{job_title}}"}</code> · <code className="bg-slate-100 px-1 rounded">{"{{company}}"}</code> · <code className="bg-slate-100 px-1 rounded">{"{{interview_date}}"}</code> · <code className="bg-slate-100 px-1 rounded">{"{{ctc}}"}</code>
            </p>
          </FieldRow>
        </div>
        <div className="border-t border-slate-100 px-6 py-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-slate-200 text-[12.5px] font-semibold">Cancel</button>
          <button type="submit" disabled={busy} className="h-9 px-5 rounded-lg bg-[#008CFF] text-white text-[12.5px] font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
            <Save size={13} /> {busy ? "Saving…" : "Save template"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FieldRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-600 mb-1">{label} {required && <span className="text-rose-500">*</span>}</label>
      {children}
    </div>
  );
}

// Color palette for the stage column accent. Keys match what the
// API accepts; values are the actual CSS hex codes used in the dot
// preview + kanban header.
const STAGE_PALETTE: { key: string; hex: string }[] = [
  { key: "slate",   hex: "#94a3b8" },
  { key: "blue",    hex: "#3b82f6" },
  { key: "cyan",    hex: "#06b6d4" },
  { key: "violet",  hex: "#8b5cf6" },
  { key: "amber",   hex: "#f59e0b" },
  { key: "pink",    hex: "#ec4899" },
  { key: "emerald", hex: "#10b981" },
  { key: "rose",    hex: "#f43f5e" },
  { key: "indigo",  hex: "#6366f1" },
  { key: "teal",    hex: "#14b8a6" },
  { key: "orange",  hex: "#f97316" },
];

function StagesPanel() {
  const URL = "/api/hr/hiring/stages?includeInactive=1";
  const { data, isLoading } = useSWR<{ stages: Stage[] }>(URL, fetcher);
  const stages = data?.stages ?? [];
  const active = stages.filter((s) => s.kind === "active");
  const terminal = stages.filter((s) => s.kind === "hired" || s.kind === "rejected");

  const [adding, setAdding] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addColor, setAddColor] = useState("slate");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");

  // ── Drag-and-drop reorder state ────────────────────────────────
  // Native HTML5 DnD — no library. `draggingId` is the stage being
  // dragged; `overId` is the row currently being hovered over (used
  // for the highlight ring). On drop we compute the new order array
  // and POST it via the bulk PATCH endpoint.
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  const refresh = () => globalMutate(URL);

  const persistOrder = async (newOrder: number[]) => {
    await fetch("/api/hr/hiring/stages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: newOrder }),
    });
    refresh();
  };

  const onDragStart = (id: number) => (e: React.DragEvent) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/stage-id", String(id));
  };

  const onDragOver = (id: number) => (e: React.DragEvent) => {
    e.preventDefault(); // critical — without this, onDrop won't fire
    e.dataTransfer.dropEffect = "move";
    if (overId !== id) setOverId(id);
  };

  const onDragLeave = (id: number) => () => {
    if (overId === id) setOverId(null);
  };

  const onDragEnd = () => {
    setDraggingId(null);
    setOverId(null);
  };

  const onDrop = (targetId: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const sourceId = Number(e.dataTransfer.getData("text/stage-id"));
    setDraggingId(null);
    setOverId(null);
    if (!Number.isFinite(sourceId) || sourceId === targetId) return;

    const sourceIdx = active.findIndex((s) => s.id === sourceId);
    const targetIdx = active.findIndex((s) => s.id === targetId);
    if (sourceIdx < 0 || targetIdx < 0) return;

    // Remove from old position, insert at target position.
    const reordered = [...active.map((s) => s.id)];
    const [moved] = reordered.splice(sourceIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    persistOrder(reordered);
  };

  const addStage = async () => {
    const label = addLabel.trim();
    if (!label) return;
    setBusy(true);
    try {
      const res = await fetch("/api/hr/hiring/stages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, color: addColor }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(j?.error || "Failed to add stage", "error"); return; }
      setAdding(false); setAddLabel(""); setAddColor("slate");
      refresh();
    } finally { setBusy(false); }
  };

  const saveLabel = async (id: number) => {
    const label = editLabel.trim();
    if (!label) { setEditingId(null); return; }
    await fetch(`/api/hr/hiring/stages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    setEditingId(null);
    refresh();
  };

  const changeColor = async (id: number, color: string) => {
    await fetch(`/api/hr/hiring/stages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color }),
    });
    refresh();
  };

  const toggleActive = async (s: Stage) => {
    await fetch(`/api/hr/hiring/stages/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !s.isActive }),
    });
    refresh();
  };

  const remove = async (s: Stage) => {
    if (!confirm(`Delete stage "${s.label}"? This can't be undone.`)) return;
    const res = await fetch(`/api/hr/hiring/stages/${s.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(j?.error || "Failed to delete", "error");
      return;
    }
    refresh();
  };

  if (isLoading) return <p className="text-[12px] text-slate-400">Loading…</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-[14px] font-semibold text-slate-800">Pipeline Stages</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Columns in the kanban board. Rename inline, change colour via the dot, deactivate to hide, or reorder with the arrows. Terminal stages (Hired / Rejected) are locked in place.
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="h-9 px-4 rounded-lg bg-[#008CFF] text-white text-[12px] font-semibold inline-flex items-center gap-1.5 hover:bg-[#0070cc]"
        ><Plus size={13} /> Add stage</button>
      </div>

      {/* Add row */}
      {adding && (
        <div className="mb-3 rounded-xl border border-[#008CFF]/40 bg-[#008CFF]/[0.04] px-4 py-3 flex items-center gap-3">
          <ColorDot color={addColor} onPick={setAddColor} />
          <input
            autoFocus
            value={addLabel}
            onChange={(e) => setAddLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addStage();
              if (e.key === "Escape") { setAdding(false); setAddLabel(""); }
            }}
            placeholder="e.g. Initial Screening"
            className="h-9 flex-1 rounded-md border border-slate-200 bg-white px-3 text-[13px]"
          />
          <button onClick={addStage} disabled={busy || !addLabel.trim()}
            className="h-9 px-4 rounded-md bg-[#008CFF] text-white text-[12px] font-semibold disabled:opacity-50"
          >{busy ? "Adding…" : "Add"}</button>
          <button onClick={() => { setAdding(false); setAddLabel(""); }}
            className="h-9 px-3 rounded-md border border-slate-200 text-[12px] font-semibold text-slate-700"
          >Cancel</button>
        </div>
      )}

      {/* Active stages — drag to reorder. Each row IS its own drop
          zone; the drop reorders the source row to where the target
          sits. */}
      <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
        {active.map((s) => (
          <StageRow
            key={s.id}
            stage={s}
            isDragging={draggingId === s.id}
            isOver={overId === s.id && draggingId !== s.id}
            draggable
            onDragStart={onDragStart(s.id)}
            onDragOver={onDragOver(s.id)}
            onDragLeave={onDragLeave(s.id)}
            onDragEnd={onDragEnd}
            onDrop={onDrop(s.id)}
            isEditing={editingId === s.id}
            editLabel={editLabel}
            onEditStart={() => { setEditingId(s.id); setEditLabel(s.label); }}
            onEditChange={setEditLabel}
            onEditSave={() => saveLabel(s.id)}
            onEditCancel={() => setEditingId(null)}
            onColorChange={(c) => changeColor(s.id, c)}
            onToggleActive={() => toggleActive(s)}
            onDelete={() => remove(s)}
            canDelete={true}
          />
        ))}
      </div>

      {/* Terminal stages — locked in place */}
      {terminal.length > 0 && (
        <>
          <h4 className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mt-5 mb-2">System stages (locked)</h4>
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 divide-y divide-slate-100">
            {terminal.map((s) => (
              <StageRow
                key={s.id}
                stage={s}
                draggable={false}
                isEditing={editingId === s.id}
                editLabel={editLabel}
                onEditStart={() => { setEditingId(s.id); setEditLabel(s.label); }}
                onEditChange={setEditLabel}
                onEditSave={() => saveLabel(s.id)}
                onEditCancel={() => setEditingId(null)}
                onColorChange={(c) => changeColor(s.id, c)}
                onToggleActive={() => toggleActive(s)}
                onDelete={() => remove(s)}
                canDelete={false}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StageRow({
  stage, isEditing, editLabel,
  draggable, isDragging, isOver,
  onDragStart, onDragOver, onDragLeave, onDragEnd, onDrop,
  onEditStart, onEditChange, onEditSave, onEditCancel,
  onColorChange, onToggleActive, onDelete, canDelete,
}: {
  stage: Stage;
  isEditing: boolean;
  editLabel: string;
  draggable?: boolean;
  isDragging?: boolean;
  isOver?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDragEnd?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  onEditStart: () => void;
  onEditChange: (v: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onColorChange: (c: string) => void;
  onToggleActive: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      className={`px-4 py-3 flex items-center gap-3 transition-all ${
        stage.isActive ? "" : "opacity-50"
      } ${isDragging ? "opacity-40" : ""} ${
        isOver ? "bg-[#008CFF]/[0.06] border-l-2 border-l-[#008CFF]" : ""
      }`}
    >
      {/* Drag handle — only renders for draggable rows. The cursor
          turns into a grabber on hover so HR knows the row is
          reorderable. Terminal stages have no handle (draggable=false). */}
      {draggable && (
        <span
          className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing"
          title="Drag to reorder"
        >
          <GripVertical size={14} />
        </span>
      )}

      <ColorDot color={stage.color} onPick={onColorChange} />
      {isEditing ? (
        <input
          autoFocus
          value={editLabel}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onEditSave}
          onKeyDown={(e) => {
            if (e.key === "Enter") onEditSave();
            if (e.key === "Escape") onEditCancel();
          }}
          className="h-7 flex-1 max-w-[260px] rounded-md border border-slate-200 bg-white px-2 text-[13px] font-semibold"
        />
      ) : (
        <button
          onClick={onEditStart}
          className="text-[13px] font-semibold text-slate-800 text-left hover:text-[#008CFF]"
          title="Click to rename"
        >
          {stage.label}
        </button>
      )}

      <span className="text-[10.5px] text-slate-400">{stage.kind}</span>

      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={onToggleActive}
          title={stage.isActive ? "Deactivate (hides from kanban)" : "Activate"}
          className="h-7 px-2 rounded-md text-[10.5px] font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50"
        >{stage.isActive ? "Active" : "Inactive"}</button>
        {canDelete && (
          <button
            onClick={onDelete}
            title="Delete this stage"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"
          ><Trash2 size={13} /></button>
        )}
      </div>
    </div>
  );
}

function ColorDot({ color, onPick }: { color: string; onPick: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = STAGE_PALETTE.find((p) => p.key === color)?.hex || "#94a3b8";
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Change colour"
        className="h-4 w-4 rounded-full ring-2 ring-white shadow-sm hover:scale-110 transition-transform"
        style={{ background: current }}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 top-6 left-0 rounded-lg border border-slate-200 bg-white shadow-lg p-2 grid grid-cols-6 gap-1.5">
            {STAGE_PALETTE.map((p) => (
              <button
                key={p.key}
                onClick={() => { onPick(p.key); setOpen(false); }}
                title={p.key}
                className={`h-5 w-5 rounded-full hover:scale-110 transition-transform ${
                  p.key === color ? "ring-2 ring-offset-1 ring-slate-700" : ""
                }`}
                style={{ background: p.hex }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FormSettingsPanel() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
      <p className="text-[13px] font-semibold text-slate-800 mb-1">
        Application form is configured per job opening.
      </p>
      <p className="text-[12px] text-slate-500 max-w-md mx-auto">
        Open a job from the <span className="font-semibold text-slate-700">Jobs</span> tab and click
        <span className="font-semibold text-[#3b82f6]"> Hiring Setup → Application Form</span> to
        manage screening questions and field visibility (Required / Optional / Hidden) per channel.
      </p>
    </div>
  );
}

// ── Internal templates compose UI ─────────────────────────────────
// Surfaces the 3 "internal" templates (New Hire Intro, Probation,
// Referral Bonus). HR picks a template + recipient, edits the
// auto-resolved subject/body, and hits Send.
export function InternalTemplatesPanel() {
  return null; // Reserved for follow-up — keeps Settings tabs clean for now.
}
