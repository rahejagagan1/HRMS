"use client";

// Application Form panel — the main per-job Hiring Setup screen.
// Layout mirrors Keka: left column = Screening questions (add /
// edit / reorder / delete), right column = Fields (per channel,
// per field: required / optional / hidden).

import { useState } from "react";
import useSWR from "swr";
import { showToast } from "@/components/ui/Toast";
import { fetcher } from "@/lib/swr";
import {
  Plus, Edit3, Trash2, GripVertical, ChevronDown, ExternalLink,
  ArrowUpDown, Check, X,
} from "lucide-react";
import {
  CHANNELS, STANDARD_FIELDS, QUESTION_TYPES,
  type Channel, type Visibility,
} from "@/lib/hr/job-form-defaults";

interface Question {
  id: number; text: string; type: string;
  options: any; required: boolean; sortOrder: number;
}
interface FieldRow {
  channel: Channel; fieldKey: string; label: string; group: string;
  visibility: Visibility; sortOrder: number; overridden: boolean;
}

export default function ApplicationFormPanel({ jobId }: { jobId: number }) {
  return (
    <div>
      {/* Preview link aligned right */}
      <div className="flex items-center justify-end mb-3">
        <a
          href={`/jobs/apply?jobId=${jobId}&preview=1`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#3b82f6] hover:text-[#2563eb]"
        >
          Preview Application Form <ExternalLink size={12} />
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <ScreeningQuestionsPanel jobId={jobId} />
        </div>
        <div className="lg:col-span-2">
          <FieldsPanel jobId={jobId} />
        </div>
      </div>
    </div>
  );
}

// ── Screening questions ───────────────────────────────────────────

function ScreeningQuestionsPanel({ jobId }: { jobId: number }) {
  const { data, mutate, isLoading } = useSWR<{ questions: Question[] }>(
    `/api/hr/hiring/jobs/${jobId}/questions`, fetcher,
  );
  const questions = data?.questions ?? [];
  const [editing, setEditing] = useState<Question | "new" | null>(null);
  const [reorderMode, setReorderMode] = useState(false);

  const refresh = () => mutate();

  const onDelete = async (q: Question) => {
    if (!confirm(`Delete question "${q.text}"?`)) return;
    const res = await fetch(`/api/hr/hiring/jobs/${jobId}/questions/${q.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(j?.error || "Failed to delete", "error");
      return;
    }
    refresh();
  };

  const move = async (index: number, dir: -1 | 1) => {
    const newOrder = [...questions];
    const target = index + dir;
    if (target < 0 || target >= newOrder.length) return;
    [newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];
    // Optimistic
    mutate({ questions: newOrder }, false);
    await fetch(`/api/hr/hiring/jobs/${jobId}/questions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: newOrder.map((q) => q.id) }),
    });
    refresh();
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <h3 className="text-[15px] font-semibold text-slate-900">Screening questions</h3>
          <span className="inline-flex items-center justify-center h-6 px-2.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold tabular-nums">
            {questions.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {questions.length > 1 && (
            <button
              onClick={() => setReorderMode((v) => !v)}
              className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[12px] font-semibold transition-colors ${
                reorderMode
                  ? "border-[#3b82f6] bg-[#3b82f6]/10 text-[#1d4ed8]"
                  : "border-slate-200 text-slate-700 hover:border-slate-300"
              }`}
            >
              <ArrowUpDown size={13} />
              {reorderMode ? "Done" : "Reorder"}
            </button>
          )}
          <button
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[12.5px] font-semibold shadow-sm"
          >
            <Plus size={14} /> Create Question
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {isLoading ? (
          <div className="py-10 text-center">
            <div className="inline-block h-6 w-6 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : questions.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-[12.5px] text-slate-500">No screening questions yet.</p>
            <button
              onClick={() => setEditing("new")}
              className="mt-2 text-[12px] font-semibold text-[#3b82f6] hover:underline"
            >
              + Add your first question
            </button>
          </div>
        ) : (
          questions.map((q, i) => (
            <QuestionCard
              key={q.id}
              q={q}
              reorderMode={reorderMode}
              canMoveUp={i > 0}
              canMoveDown={i < questions.length - 1}
              onEdit={() => setEditing(q)}
              onDelete={() => onDelete(q)}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, +1)}
            />
          ))
        )}
      </div>

      {editing && (
        <QuestionEditor
          jobId={jobId}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function QuestionCard({
  q, reorderMode, canMoveUp, canMoveDown,
  onEdit, onDelete, onMoveUp, onMoveDown,
}: {
  q: Question;
  reorderMode: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const typeLabel = QUESTION_TYPES.find((t) => t.key === q.type)?.label ?? q.type;
  return (
    <div className="rounded-lg border border-slate-200 bg-white hover:border-slate-300 transition-colors">
      <div className="px-4 py-3 flex items-start gap-3">
        {reorderMode ? (
          <div className="flex flex-col gap-0.5 mt-0.5">
            <button onClick={onMoveUp} disabled={!canMoveUp} className="h-5 w-5 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed">▲</button>
            <button onClick={onMoveDown} disabled={!canMoveDown} className="h-5 w-5 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed">▼</button>
          </div>
        ) : (
          <GripVertical size={15} className="text-slate-300 mt-1 cursor-not-allowed" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-slate-900">{q.text}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="inline-flex items-center h-5 px-1.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold uppercase tracking-wider">
              {typeLabel}
            </span>
            {q.required && (
              <span className="inline-flex items-center h-5 px-1.5 rounded bg-rose-50 text-rose-700 text-[10px] font-semibold">
                Required
              </span>
            )}
            {Array.isArray(q.options) && q.options.length > 0 && (
              <span className="text-[10.5px] text-slate-500">
                {q.options.length} options
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onEdit}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-[#3b82f6] hover:bg-blue-50"
            title="Edit"
          ><Edit3 size={13} /></button>
          <button
            onClick={onDelete}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-rose-600 hover:bg-rose-50"
            title="Delete"
          ><Trash2 size={13} /></button>
        </div>
      </div>
    </div>
  );
}

function QuestionEditor({
  jobId, initial, onClose, onSaved,
}: {
  jobId: number;
  initial: Question | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? "");
  const [type, setType] = useState(initial?.type ?? "short_text");
  const [required, setRequired] = useState(initial?.required ?? false);
  const [options, setOptions] = useState<string[]>(
    Array.isArray(initial?.options) ? initial!.options : [],
  );
  const [saving, setSaving] = useState(false);
  const isMulti = type === "multiple_choice";

  const save = async () => {
    const trimmed = text.trim();
    if (!trimmed) return showToast("Question text is required", "error");
    setSaving(true);
    const payload: any = { text: trimmed, type, required };
    if (isMulti) {
      const cleaned = options.map((o) => o.trim()).filter(Boolean);
      if (cleaned.length < 2) {
        setSaving(false);
        return showToast("Multiple choice needs at least 2 options", "error");
      }
      payload.options = cleaned;
    } else {
      payload.options = null;
    }
    const url = initial
      ? `/api/hr/hiring/jobs/${jobId}/questions/${initial.id}`
      : `/api/hr/hiring/jobs/${jobId}/questions`;
    const res = await fetch(url, {
      method: initial ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(j?.error || "Failed to save", "error");
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-slate-900">
            {initial ? "Edit question" : "Create question"}
          </h3>
          <button onClick={onClose} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100">
            <X size={15} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">Question</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="e.g. How many years of experience do you have in script writing?"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">Answer type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
              >
                {QUESTION_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">Required?</label>
              <button
                onClick={() => setRequired(!required)}
                className={`w-full h-10 rounded-lg border text-[12.5px] font-semibold transition-colors ${
                  required
                    ? "border-rose-300 bg-rose-50 text-rose-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                {required ? "Required" : "Optional"}
              </button>
            </div>
          </div>

          {isMulti && (
            <div>
              <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">Options</label>
              <div className="space-y-2">
                {options.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      value={o}
                      onChange={(e) => {
                        const next = [...options]; next[i] = e.target.value; setOptions(next);
                      }}
                      placeholder={`Option ${i + 1}`}
                      className="flex-1 h-9 px-3 rounded-lg border border-slate-200 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
                    />
                    <button
                      onClick={() => setOptions(options.filter((_, j) => j !== i))}
                      className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                    ><Trash2 size={13} /></button>
                  </div>
                ))}
                <button
                  onClick={() => setOptions([...options, ""])}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#3b82f6] hover:text-[#2563eb]"
                ><Plus size={12} /> Add option</button>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-slate-700 hover:bg-white"
          >Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-slate-300 text-white text-[12.5px] font-semibold shadow-sm"
          >
            <Check size={13} />
            {saving ? "Saving…" : initial ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Fields panel ──────────────────────────────────────────────────

function FieldsPanel({ jobId }: { jobId: number }) {
  const [channel, setChannel] = useState<Channel>("career_site");
  const { data, mutate, isLoading } = useSWR<{ fields: FieldRow[] }>(
    `/api/hr/hiring/jobs/${jobId}/fields?channel=${channel}`, fetcher,
  );
  const fields = data?.fields ?? [];

  // Group fields by category for visual breaks.
  const grouped = fields.reduce<Record<string, FieldRow[]>>((acc, f) => {
    (acc[f.group] ??= []).push(f); return acc;
  }, {});

  const update = async (f: FieldRow, next: Visibility) => {
    // Optimistic
    mutate(
      { fields: fields.map((x) => x.fieldKey === f.fieldKey && x.channel === f.channel ? { ...x, visibility: next, overridden: true } : x) },
      false,
    );
    await fetch(`/api/hr/hiring/jobs/${jobId}/fields`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: f.channel, fieldKey: f.fieldKey, visibility: next }),
    });
    mutate();
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="text-[15px] font-semibold text-slate-900">Fields</h3>
      </div>

      {/* Channel tabs */}
      <div className="px-5 pt-3 border-b border-slate-100">
        <div className="flex items-center gap-5 overflow-x-auto -mb-px">
          {CHANNELS.map((c) => {
            const active = channel === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setChannel(c.key)}
                className={`py-2.5 border-b-2 text-[12.5px] font-semibold whitespace-nowrap transition-colors ${
                  active
                    ? "border-[#3b82f6] text-[#3b82f6]"
                    : "border-transparent text-slate-500 hover:text-slate-900"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4">
        {isLoading ? (
          <div className="py-10 text-center">
            <div className="inline-block h-6 w-6 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([group, items]) => (
              <div key={group}>
                <p className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-slate-400 mb-1.5 px-2">
                  {group}
                </p>
                <div className="divide-y divide-slate-100">
                  {items.map((f) => (
                    <FieldRowItem
                      key={`${f.channel}:${f.fieldKey}`}
                      f={f}
                      onChange={(v) => update(f, v)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FieldRowItem({ f, onChange }: { f: FieldRow; onChange: (v: Visibility) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-2 py-2.5">
      <div className="min-w-0 flex items-center gap-2">
        <p className="text-[12.5px] font-medium text-slate-800 truncate">{f.label}</p>
        {f.overridden && (
          <span className="inline-flex items-center h-4 px-1 rounded bg-blue-50 text-[#1d4ed8] text-[9px] font-bold uppercase tracking-wider" title="Customised for this job">
            Set
          </span>
        )}
      </div>
      <VisibilityDropdown value={f.visibility} onChange={onChange} />
    </div>
  );
}

function VisibilityDropdown({
  value, onChange,
}: { value: Visibility; onChange: (v: Visibility) => void }) {
  const TONE: Record<Visibility, string> = {
    required: "text-rose-700",
    optional: "text-slate-600",
    hidden:   "text-slate-400 italic",
  };
  const LABEL: Record<Visibility, string> = {
    required: "Required",
    optional: "Optional",
    hidden:   "Hidden",
  };
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Visibility)}
        className={`appearance-none h-8 pl-3 pr-7 rounded-md border border-slate-200 bg-white text-[11.5px] font-semibold focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6] cursor-pointer ${TONE[value]}`}
      >
        {(["required", "optional", "hidden"] as Visibility[]).map((v) => (
          <option key={v} value={v}>{LABEL[v]}</option>
        ))}
      </select>
      <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}

// Keep top-level imports/used types referenced even when tree-shaken.
void STANDARD_FIELDS;
