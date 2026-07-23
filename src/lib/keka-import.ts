// Parses a Keka CSV/XLSX export into rows the onboarding form can
// consume. Pure logic — no React, no DOM access — so the same module
// powers both the import modal and any future bulk-create endpoint.
//
// Keka's export format isn't perfectly stable, so this module is
// permissive: dates come in four formats, phones sometimes have spaces
// inside the digit run, department names don't map 1:1, etc. Every
// quirk we've seen in the May-2026 sample is handled here.

export type KekaRow = {
  // Verbatim columns from the file (trimmed).
  employeeNumber:   string;   // "HRM157"
  firstName:        string;
  middleName:       string;
  lastName:         string;
  displayName:      string;
  workEmail:        string;
  dateOfBirth:      string;   // "16-Sep-2004"
  gender:           string;   // "Male" | "Female"
  mobilePhone:      string;   // "91-9005062961"
  joiningDate:      string;
  jobTitle:         string;
  department:       string;   // Keka's long form, ignored for mapping
  reportingTo:      string;   // manager's display name
  noticePeriod:     string;   // "30 Days Notice Period"
  leavePlan:        string;
  timeType:         string;   // "FullTime" | "None"
  workerType:       string;   // "Permanent"
  attendanceScheme: string;   // "On-Site Capture Scheme" | "Remote Capture Scheme"
  internshipEnd:    string;
  jobLocation:      string;   // "On-Site" | "Remote"
};

// Result of mapping a Keka row to our form. Every key here is also a
// key on the onboarding `Form` type — wire-up just spreads this onto
// the form state.
export type KekaFormPatch = {
  firstName:        string;
  middleName:       string;
  lastName:         string;
  displayName:      string;
  workEmail:        string;
  gender:           string;       // "male" | "female" | "other"
  dateOfBirth:      string;       // YYYY-MM-DD
  mobileCountry:    string;       // "+91"
  mobileNumber:     string;
  employeeNumber:   string;       // "HRM157"
  joiningDate:      string;       // YYYY-MM-DD
  jobTitle:         string;
  department:       string;       // mapped to our short list
  workerType:       string;       // "Regular Employee" | "Intern"
  timeType:         string;       // "Full Time" | "Part Time"
  location:         string;       // "Mohali" | "Remote" | …
  jobLocation:      string;
  noticePeriodDays: string;
  internshipEndDate:string;       // YYYY-MM-DD
  leavePlan:        string;
  reportingManagerId: string;     // matched id, or "" if no match
  // Diagnostics for the modal — not form fields, but useful to display.
  _managerMatchedName: string | null;   // null when no match
  _managerOriginalName: string;
};

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6,
  aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
};

// Handles every date layout we've seen in Keka exports + the M/D/YY
// shape that xlsx hands back when it auto-detects a CSV cell as a
// date:
//   16-Sep-2004     09 Mar 2025     09 March,2025     18-Sep-2024
//   3/23/26         9/16/2004
// Also tolerates plain ISO (YYYY-MM-DD) and empty markers ("-", "—").
// Returns ISO date (YYYY-MM-DD) or "" when unparseable.
export function parseKekaDate(raw: string): string {
  const v = (raw ?? "").trim();
  if (!v || v === "-" || v === "—") return "";
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);

  // Numeric M/D/YY or M/D/YYYY (xlsx's auto-converted format for CSV
  // date cells). US locale order — that's what xlsx emits.
  const numeric = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (numeric) {
    const month = parseInt(numeric[1], 10);
    const day   = parseInt(numeric[2], 10);
    let year    = parseInt(numeric[3], 10);
    if (numeric[3].length === 2) year = year < 50 ? 2000 + year : 1900 + year;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // DD-MMM-YYYY / "DD MonthName,YYYY" / DD MMM YYYY — Keka's native
  // export layout when xlsx doesn't auto-convert (e.g. day > 12 so
  // M/D/YY would be ambiguous).
  const norm = v.replace(/[-/,]/g, " ").replace(/\s+/g, " ").trim();
  const parts = norm.split(" ").filter(Boolean);
  if (parts.length < 3) return "";
  const [dStr, mStr, yStr] = parts;
  const day = parseInt(dStr, 10);
  const month = MONTH_INDEX[mStr.toLowerCase()];
  const year = parseInt(yStr, 10);
  if (!Number.isFinite(day) || month === undefined || !Number.isFinite(year)) return "";
  const yyyy = String(year);
  const mm   = String(month + 1).padStart(2, "0");
  const dd   = String(day).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Splits "91-9005062961" or "91-93897 79277" into +91 / 9005062961.
// Strips internal spaces in the number portion. Falls back to a single
// "+91" prefix if the input doesn't contain "-".
export function parsePhone(raw: string): { country: string; number: string } {
  const v = (raw ?? "").trim();
  if (!v) return { country: "+91", number: "" };
  const dash = v.indexOf("-");
  if (dash === -1) return { country: "+91", number: v.replace(/\s+/g, "") };
  const cc  = v.slice(0, dash).replace(/^\+?/, "+");
  const num = v.slice(dash + 1).replace(/\s+/g, "");
  return { country: cc || "+91", number: num };
}

// "30 Days Notice Period" → 30. Anything unparseable falls back to 30.
export function parseNoticePeriod(raw: string): number {
  const m = (raw ?? "").match(/\d+/);
  return m ? parseInt(m[0], 10) : 30;
}

// Job-title-driven derivation. Keka's department names (NB_Production
// etc.) don't 1:1 map to our canonical list, so the title is the
// more reliable signal. Falls back to a Keka-dept hint, then to ""
// if nothing matches. Returned values must match canonical labels in
// src/lib/departments.ts so the KPI listing buckets cleanly without
// needing the rename helper to fix things up after import.
//
// Order matters — more specific patterns must match before broader
// ones. e.g. "video editor" must hit `editor` first, "head of
// production" must hit before plain `production`.
export function deriveDepartment(jobTitle: string, kekaDept: string): string {
  const jt = (jobTitle ?? "").toLowerCase();

  // Editors (post-production video). Specific before generic.
  if (jt.includes("video editor"))                                          return "Editors";
  if (jt.includes("editor"))                                                return "Editors";

  // Designers — graphic / motion / UI.
  if (jt.includes("graphic design") || jt.includes(" designer"))            return "Design";

  // Social media — checked BEFORE Content Strategist so titles like
  // "Social Media Content Strategist" land in Social Media, not the
  // generic strategist bucket.
  if (jt.includes("social media"))                                          return "Social Media";

  // QA — split into Script vs Video where the title signals it.
  // "Script Quality" / "Content Review" / "Content Quality" all read as
  // script-side review work; everything else QA-flavoured defaults to
  // Video QA (the more common case in this org).
  if (jt.includes("script qa") || jt.includes("script quality")
   || jt.includes("quality assurance (script)"))                            return "Script QA";
  if (jt.includes("content review") || jt.includes("content quality"))      return "Script QA";
  if (jt.includes("video qa") || jt.includes("video quality")
   || jt.includes("quality assurance (video)"))                             return "Video QA";
  if (jt.includes("quality assurance") || jt.match(/\bqa\b/))               return "Video QA";

  // Writers — script writers, content writers, content team leads.
  if (jt.includes("script writer") || jt.includes("content writer")
   || jt.includes("content team lead") || jt.includes("creative head"))     return "Writers";

  // Researchers
  if (jt.includes("content researcher") || jt.includes("content research")
   || jt.includes("researcher"))                                            return "Researchers";

  // Content Strategist — strategist roles + the renamed "Content
  // Operations Executive" line.
  if (jt.includes("content operations executive"))                          return "Content Operations Executive";
  if (jt.includes("content strategist") || jt.includes("strategist"))       return "Content Strategist";

  // HR — recruiters / TA / EAs / generic HR titles all roll up here.
  if (jt.includes("talent acquisition") || jt.includes("recruiter"))        return "HR";
  if (jt.includes("executive assistant"))                                   return "HR";
  if (jt.includes("hr ") || jt.includes("human resource"))                  return "HR";

  // AI / ML engineers
  if (jt.includes("ai engineer") || jt.includes("ml engineer")
   || jt.includes("artificial intelligence"))                               return "AI Team";

  // IT — support, security/infosec interns, system admins.
  if (jt.includes("it support") || jt.includes("it security")
   || jt.includes("security intern") || jt.includes("infosec")
   || jt.includes("system admin"))                                          return "IT";

  // Note: "Production" was retired as a canonical department —
  // production-flavoured titles already get routed to Editors / Design /
  // Writers above. Anything else stays unmatched so HR sets it manually.

  // Keka department hint as a last fallback.
  const k = (kekaDept ?? "").toLowerCase();
  if (k.includes("human resources"))         return "HR";
  if (k.includes("research"))                return "Researchers";
  if (k.includes("artificial intelligence")) return "AI Team";
  if (k.includes("social media"))            return "Social Media";
  if (k.match(/\bit\b/))                     return "IT";
  return "";
}

// Time Type "None" with an internship end date filled in == intern.
// Anything else with workerType "Permanent" is a regular employee.
export function deriveWorkerType(timeType: string, internshipEnd: string): "Regular Employee" | "Intern" {
  const tt = (timeType ?? "").trim().toLowerCase();
  const ie = (internshipEnd ?? "").trim();
  const hasIntEnd = ie && ie !== "-" && ie !== "—";
  if (tt === "none" || hasIntEnd) return "Intern";
  return "Regular Employee";
}

// Maps Keka's "FullTime" / "None" / blank to our two-option list.
// Interns are Full Time by default (the form lets HR change it).
export function deriveTimeType(timeType: string): "Full Time" | "Part Time" {
  const tt = (timeType ?? "").trim().toLowerCase();
  if (tt === "parttime" || tt === "part time" || tt === "part-time") return "Part Time";
  return "Full Time";
}

// "On-Site Capture Scheme" → office in Mohali; "Remote Capture Scheme"
// → remote. Returns both the human-friendly location and the form's
// workLocation slug.
export function deriveLocation(captureScheme: string, jobLocation: string): {
  location: string;
  jobLocation: string;
} {
  const cs = (captureScheme ?? "").toLowerCase();
  const jl = (jobLocation ?? "").toLowerCase();
  const isRemote = cs.includes("remote") || jl.includes("remote");
  return {
    location:    isRemote ? "Remote" : "Mohali",
    jobLocation: isRemote ? "Remote" : "Mohali",
  };
}

// "Male" → "male", "Female" → "female". Empty stays empty.
export function deriveGender(raw: string): string {
  return (raw ?? "").trim().toLowerCase();
}

// Fuzzy lookup of a manager by display name. Strips trailing dots /
// star markers and is case-insensitive. Returns the matched id or null.
// (Names alone aren't unique in theory, but the Keka export doesn't
// distinguish managers any other way.)
export function findManagerIdByName(
  reportingTo: string,
  managers: Array<{ id: number; name: string }>,
): number | null {
  const target = normaliseName(reportingTo);
  if (!target) return null;
  // Exact (after normalisation) wins outright.
  const exact = managers.find((m) => normaliseName(m.name) === target);
  if (exact) return exact.id;
  // Fall back to "all the words appear" — handles Keka's stripped
  // middle names, trailing dots, etc.
  const words = target.split(" ").filter((w) => w.length >= 2);
  if (words.length === 0) return null;
  const partial = managers.find((m) => {
    const n = normaliseName(m.name);
    return words.every((w) => n.includes(w));
  });
  return partial ? partial.id : null;
}

function normaliseName(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\s*⭐\s*/g, " ")
    .replace(/\.+/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// One-shot row → form patch. Caller spreads this onto setForm.
export function mapRowToFormPatch(
  row: KekaRow,
  managers: Array<{ id: number; name: string }>,
): KekaFormPatch {
  const phone = parsePhone(row.mobilePhone);
  const loc   = deriveLocation(row.attendanceScheme, row.jobLocation);
  const matchedId = findManagerIdByName(row.reportingTo, managers);
  const matchedName = matchedId ? managers.find((m) => m.id === matchedId)?.name ?? null : null;

  return {
    firstName:        row.firstName,
    middleName:       row.middleName,
    lastName:         row.lastName,
    displayName:      row.displayName || [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" "),
    workEmail:        row.workEmail,
    gender:           deriveGender(row.gender) || "male",
    dateOfBirth:      parseKekaDate(row.dateOfBirth),
    mobileCountry:    phone.country,
    mobileNumber:     phone.number,
    employeeNumber:   row.employeeNumber,
    joiningDate:      parseKekaDate(row.joiningDate) || new Date().toISOString().slice(0, 10),
    jobTitle:         row.jobTitle,
    department:       deriveDepartment(row.jobTitle, row.department),
    workerType:       deriveWorkerType(row.timeType, row.internshipEnd),
    timeType:         deriveTimeType(row.timeType),
    location:         loc.location,
    jobLocation:      loc.jobLocation,
    noticePeriodDays: String(parseNoticePeriod(row.noticePeriod)),
    internshipEndDate:parseKekaDate(row.internshipEnd),
    leavePlan:        row.leavePlan || "Regular Leave Plan",
    reportingManagerId: matchedId ? String(matchedId) : "",
    _managerMatchedName: matchedName,
    _managerOriginalName: row.reportingTo,
  };
}

// Header → KekaRow key. Lowercased + trimmed for tolerance against
// trailing spaces / casing changes between Keka exports.
const HEADER_MAP: Record<string, keyof KekaRow> = {
  "employee/attendance number":  "employeeNumber",
  "employee number":             "employeeNumber",
  "first name":                  "firstName",
  "middle name":                 "middleName",
  "last name":                   "lastName",
  "display name":                "displayName",
  "work email":                  "workEmail",
  "date of birth":               "dateOfBirth",
  "gender":                      "gender",
  "mobile phone":                "mobilePhone",
  "joining date":                "joiningDate",
  "job title":                   "jobTitle",
  "department":                  "department",
  "reporting to":                "reportingTo",
  "notice period":               "noticePeriod",
  "leave plan":                  "leavePlan",
  "time type":                   "timeType",
  "worker type":                 "workerType",
  "attendance capture scheme":   "attendanceScheme",
  "internship end date (in)":    "internshipEnd",
  "internship end date":         "internshipEnd",
  "job location (in)":           "jobLocation",
  "job location":                "jobLocation",
};

// Entry point — accepts a File (from <input type="file">) and returns
// parsed rows. Uses a dynamic import so xlsx only loads when HR
// actually opens the importer (saves ~700 KB on the main bundle).
export async function parseKekaFile(file: File): Promise<KekaRow[]> {
  const XLSX = await import("xlsx");
  const buf  = await file.arrayBuffer();
  const wb   = XLSX.read(buf, { type: "array" });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  // dateNF forces date cells to render as ISO (yyyy-mm-dd) instead of
  // xlsx's locale-default M/D/YY — otherwise CSV imports silently lose
  // date precision because the parser only recognises Keka's native
  // DD-MMM-YYYY layout.
  const aoa = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1, defval: "", raw: false, dateNF: "yyyy-mm-dd",
  });
  if (aoa.length < 2) return [];

  // First non-empty row is the header. Strip BOM from the very first cell.
  const headerRow = aoa[0].map((h, i) => {
    let s = String(h ?? "").trim();
    if (i === 0) s = s.replace(/^﻿/, "").replace(/^ï»¿/, "");
    return s.toLowerCase();
  });
  const colByKey: Partial<Record<keyof KekaRow, number>> = {};
  headerRow.forEach((h, i) => {
    const key = HEADER_MAP[h];
    if (key && colByKey[key] === undefined) colByKey[key] = i;
  });

  const rows: KekaRow[] = [];
  for (let r = 1; r < aoa.length; r++) {
    const cells = aoa[r];
    if (!Array.isArray(cells) || cells.every((c) => String(c ?? "").trim() === "")) continue;
    const get = (k: keyof KekaRow) => {
      const i = colByKey[k];
      if (i === undefined) return "";
      return String(cells[i] ?? "").trim();
    };
    const row: KekaRow = {
      employeeNumber:   get("employeeNumber"),
      firstName:        get("firstName"),
      middleName:       get("middleName"),
      lastName:         get("lastName"),
      displayName:      get("displayName"),
      workEmail:        get("workEmail"),
      dateOfBirth:      get("dateOfBirth"),
      gender:           get("gender"),
      mobilePhone:      get("mobilePhone"),
      joiningDate:      get("joiningDate"),
      jobTitle:         get("jobTitle"),
      department:       get("department"),
      reportingTo:      get("reportingTo"),
      noticePeriod:     get("noticePeriod"),
      leavePlan:        get("leavePlan"),
      timeType:         get("timeType"),
      workerType:       get("workerType"),
      attendanceScheme: get("attendanceScheme"),
      internshipEnd:    get("internshipEnd"),
      jobLocation:      get("jobLocation"),
    };
    // Skip rows with no employee number AND no email — likely blank
    // separator rows in the export.
    if (!row.employeeNumber && !row.workEmail) continue;
    rows.push(row);
  }
  return rows;
}
