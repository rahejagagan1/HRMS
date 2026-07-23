// Catalog of the Case fields the Missing Fields tool can flag. Keys are the
// Prisma Case column names (same dbColumn values as src/lib/clickup/field-mapping.ts,
// which maps each ClickUp custom field UUID onto a Case column). Each capsule's
// plan stores a subset of these keys as "required"; a run flags in-scope cases
// where a required field is empty.
//
// `computed: true` marks ClickUp formula fields (ratings / TAT) — they aren't
// hand-entered, so they're usually NOT what you'd require, but they're listed
// so a plan can include them if wanted.

export type FieldPhase =
  | "research"
  | "scripting"
  | "script_qa"
  | "voiceover"
  | "video_editing"
  | "video_qa"
  | "final_video"
  | "helper"
  | "tat";

export interface CatalogField {
  key: string;        // Case column name
  code: string;       // ClickUp field letter (A, B, H1, S1, T4, ...) — for display + alignment
  label: string;      // human label for the UI
  phase: FieldPhase;
  computed?: boolean; // ClickUp formula field (auto-calculated)
}

export const PHASE_LABELS: Record<FieldPhase, string> = {
  research:      "Research",
  scripting:     "Scripting",
  script_qa:     "Script QA",
  voiceover:     "Voiceover",
  video_editing: "Video Editing",
  video_qa:      "Video QA",
  final_video:   "Final Video",
  helper:        "Helper",
  tat:           "TAT",
};

// Order here is the order phases render in the UI.
export const PHASE_ORDER: FieldPhase[] = [
  "research", "scripting", "script_qa", "voiceover",
  "video_editing", "video_qa", "final_video", "helper", "tat",
];

// Ordered + coded to mirror the ClickUp Fields panel (A, B, C, … H, H1, I, …).
export const FIELD_CATALOG: CatalogField[] = [
  // Research
  { key: "researcherUserId", code: "A", label: "Researcher",  phase: "research" },
  { key: "caseRating",       code: "B", label: "Case Rating", phase: "research" },
  { key: "caseType",         code: "C", label: "Case Type",   phase: "research" },
  // Scripting
  { key: "writerUserId",         code: "D",  label: "Writer",             phase: "scripting" },
  { key: "editorUserId",         code: "E",  label: "Editor",             phase: "scripting" },
  { key: "tthDocLink",           code: "F",  label: "TTH Doc Link",       phase: "scripting" },
  { key: "title",                code: "G",  label: "Title",              phase: "scripting" },
  { key: "scriptFirstDraftLink", code: "H",  label: "Script First Draft", phase: "scripting" },
  { key: "videoDuration",        code: "H1", label: "Video Duration",     phase: "scripting" },
  // Script QA
  { key: "scriptQaStartDate",     code: "I", label: "Script QA Start Date",    phase: "script_qa" },
  { key: "writerQualityScore",    code: "J", label: "Writer Quality Score",    phase: "script_qa" },
  { key: "writerDeliveryTime",    code: "K", label: "Writer Delivery Time",    phase: "script_qa" },
  { key: "writerEfficiencyScore", code: "L", label: "Writer Efficiency Score", phase: "script_qa" },
  { key: "finalWriterRating",     code: "M", label: "Final Writer Rating",     phase: "script_qa", computed: true },
  { key: "scriptQualityRating",   code: "N", label: "Script Quality Rating",   phase: "script_qa" },
  { key: "scriptRatingReason",    code: "O", label: "Script Rating Reason",    phase: "script_qa" },
  { key: "finalScriptLink",       code: "P", label: "Final Script Link",       phase: "script_qa" },
  // Voiceover
  { key: "voDocLink", code: "Q", label: "VO Doc Link", phase: "voiceover" },
  { key: "voLink",    code: "R", label: "VO Link",     phase: "voiceover" },
  // Video Editing
  { key: "videoFirstDraftLink", code: "S",  label: "Video First Draft",  phase: "video_editing" },
  { key: "videoGcStartDate",    code: "S1", label: "Video GC Start Date", phase: "video_editing" },
  { key: "videoChangesCount",   code: "S2", label: "Video Changes Count", phase: "video_editing" },
  // Video QA
  { key: "qaVideoMeetingDate",    code: "T",  label: "QA Video Meeting Date",   phase: "video_qa" },
  { key: "editorQualityScore",    code: "T1", label: "Editor Quality Score",    phase: "video_qa" },
  { key: "editorDeliveryTime",    code: "T2", label: "Editor Delivery Time",    phase: "video_qa" },
  { key: "editorEfficiencyScore", code: "T3", label: "Editor Efficiency Score", phase: "video_qa" },
  { key: "finalVideoRating",      code: "T4", label: "Final Video Rating",      phase: "video_qa", computed: true },
  // Final Video
  { key: "videoQualityRating", code: "U",  label: "Video Quality Rating", phase: "final_video" },
  { key: "videoRatingReason",  code: "U1", label: "Video Rating Reason",  phase: "final_video" },
  { key: "channel",            code: "U2", label: "Channel",              phase: "final_video" },
  { key: "finalVideoLink",     code: "V",  label: "Final Video Link",     phase: "final_video" },
  { key: "uploadDate",         code: "W",  label: "Upload Date",          phase: "final_video" },
  { key: "youtubeVideoUrl",    code: "X",  label: "YouTube Video Link",   phase: "final_video" },
  // Helper
  { key: "helperEditorE", code: "Z",  label: "Helper Editor E", phase: "helper" },
  { key: "helperEditorT", code: "Z",  label: "Helper Editor T", phase: "helper" },
  { key: "helperWriterE", code: "ZS", label: "Helper Writer E", phase: "helper" },
  { key: "helperWriterT", code: "ZS", label: "Helper Writer T", phase: "helper" },
  // TAT
  { key: "caseStartDate",      code: "Z", label: "Case Start Date",      phase: "tat" },
  { key: "caseCompletionDate", code: "Z", label: "Case Completion Date", phase: "tat" },
  { key: "overallTat",         code: "Z", label: "Overall TAT",          phase: "tat", computed: true },
  { key: "tat",                code: "Z", label: "TAT",                  phase: "tat", computed: true },
];

export const FIELD_KEYS = new Set(FIELD_CATALOG.map((f) => f.key));
export const FIELD_BY_KEY: Record<string, CatalogField> = Object.fromEntries(
  FIELD_CATALOG.map((f) => [f.key, f]),
);

// True when a Case column value counts as "missing" for flagging purposes:
// null / undefined, empty/whitespace string, or empty array. Numbers (incl. 0)
// and dates are considered present. Prisma Decimal serializes to a string, so a
// non-empty string is present.
export function isFieldEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

// Validate + normalize an arbitrary list of field keys against the catalog
// (drops anything unknown, dedupes). Used when saving a capsule plan.
export function sanitizeFieldKeys(keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  const seen = new Set<string>();
  for (const k of keys) {
    if (typeof k === "string" && FIELD_KEYS.has(k)) seen.add(k);
  }
  return [...seen];
}

// Statuses ClickUp marks done/closed are "terminal" and normally out of scope,
// EXCEPT these — the team wants them flagged (a ready/published case should
// still have everything filled). Everything else done/closed (rejected, for
// compilation, move to bodycam, complete, copyright) stays out.
export const TERMINAL_TYPES = new Set(["done", "closed"]);
export const KEEP_STATUSES = new Set(["ready to upload", "published on yt"]);
export function isStatusInScope(status: string, statusType: string | null | undefined): boolean {
  if (statusType && TERMINAL_TYPES.has(statusType) && !KEEP_STATUSES.has(String(status).toLowerCase())) return false;
  return true;
}

// A capsule plan is a map of case status -> required field keys for that status
// ("when a case is in <status>, these fields must be filled"). Normalize an
// arbitrary object: keep string statuses, sanitize each field list, drop empties.
export type StatusPlan = Record<string, string[]>;
export function sanitizeStatusPlan(input: unknown): StatusPlan {
  const out: StatusPlan = {};
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [statusKey, keys] of Object.entries(input as Record<string, unknown>)) {
      if (typeof statusKey !== "string" || !statusKey) continue;
      const fields = sanitizeFieldKeys(keys);
      if (fields.length) out[statusKey] = fields;
    }
  }
  return out;
}
