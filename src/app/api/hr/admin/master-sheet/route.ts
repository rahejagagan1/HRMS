// HR Master Sheet generator. Produces a single XLSX with one tab per
// requested category. HR-admin tier only — uses ExcelJS (already in
// the project) and pulls live data via Prisma so the file always
// reflects the current DB state.
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";
import { requireAuth, isHRAdmin, canViewSalary, isLeadershipOrHR, serverError } from "@/lib/api-auth";
import { getBrandScope } from "@/lib/hr/brand-scope";
import { istTodayDateOnly } from "@/lib/ist-date";

export const dynamic = "force-dynamic";

// IST month boundaries — we apply attendance windows in IST so dates
// don't shift around the UTC midnight cutoff.
function istMonthRange(year: number, month0: number): { start: Date; end: Date; label: string } {
  // Month start in IST = (month start in UTC) − 5:30. Easier: build
  // 00:00 UTC of (month-start in IST) by subtracting 5h30 from a UTC date.
  const utcStart = new Date(Date.UTC(year, month0, 1, 0, 0, 0));
  const utcEnd   = new Date(Date.UTC(year, month0 + 1, 1, 0, 0, 0));
  // Shift forward by -5:30 to get the IST-start represented as UTC.
  const start = new Date(utcStart.getTime() - (5 * 60 + 30) * 60_000);
  const end   = new Date(utcEnd.getTime()   - (5 * 60 + 30) * 60_000);
  const label = utcStart.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start, end, label };
}

// IST year boundaries — same trick as the month helper, just spanning
// Jan 1 → Jan 1 of (year+1). The label is just the bare year so the
// resulting sheet name reads "Attendance — 2025".
function istYearRange(year: number): { start: Date; end: Date; label: string } {
  const utcStart = new Date(Date.UTC(year,     0, 1, 0, 0, 0));
  const utcEnd   = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0));
  const start = new Date(utcStart.getTime() - (5 * 60 + 30) * 60_000);
  const end   = new Date(utcEnd.getTime()   - (5 * 60 + 30) * 60_000);
  return { start, end, label: String(year) };
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A2E" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const ALT_FILL:    ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F9FA" } };

function styleSheet(ws: ExcelJS.Worksheet) {
  const header = ws.getRow(1);
  header.eachCell((c) => {
    c.fill = HEADER_FILL; c.font = HEADER_FONT;
    c.alignment = { vertical: "middle", horizontal: "center" };
    c.border = { bottom: { style: "thin", color: { argb: "FF333333" } } };
  });
  header.height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  // Alternate row shading for readability.
  ws.eachRow((row, i) => {
    if (i === 1) return;
    if (i % 2 === 0) row.eachCell((c) => { c.fill = ALT_FILL; });
  });
  // Auto-size columns based on header + sample of values (cap at 40).
  ws.columns.forEach((col) => {
    if (!col) return;
    let max = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 40);
  });
}

const fmtDate = (d: Date | string | null | undefined): string => {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};
const fmtIstTime = (d: Date | string | null | undefined): string => {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(typeof d === "string" ? new Date(d) : d);
};
const fmtMins = (m: number | null | undefined) => {
  if (m == null) return "";
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

// ─────────────────────────────────────────────────────────────────────
//  Brand scope helpers — every sheet generator accepts a `brand`
//  ("NB Media" | "YT Labs" | null for All). Two Prisma where-clause
//  shapes are derived from it: one for filtering User rows directly
//  (Employees sheet), the other for filtering nested-via-user rows
//  (Attendance / leave / WFH / OD / Regularizations / Comp-Off).
//
//  Brand membership comes from `EmployeeProfile.businessUnit`. We
//  treat NULL businessUnit as "NB Media" (parent-brand default) so
//  legacy rows show up on the NB sheet, matching the rest of the UI.
// ─────────────────────────────────────────────────────────────────────

type BrandFilter = "NB Media" | "YT Labs" | null;

// Developers / platform accounts are never included in the export — they're not
// real employees. Sources: DEVELOPER_EMAILS (same list the session uses for
// isDeveloper) plus a few built-in non-employee accounts that aren't in that env
// (e.g. the "Dev Admin" account). Matched by EXACT lowercase email, so a real
// employee whose email merely starts with "dev" (e.g. devender@…, HRM156) is
// NOT affected. Emails are normalised to lowercase in the DB.
const BUILTIN_EXCLUDED_EMAILS = ["dev@nbmediaproductions.com"];
const DEV_EMAILS = Array.from(new Set([
  ...(process.env.DEVELOPER_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()),
  ...BUILTIN_EXCLUDED_EMAILS.map((e) => e.toLowerCase()),
].filter(Boolean)));
const devExclusionWhere = (): Record<string, any> =>
  DEV_EMAILS.length ? { email: { notIn: DEV_EMAILS } } : {};

// Where-clause segment for `prisma.user.findMany`.
function userWhereForBrand(brand: BrandFilter) {
  if (!brand) return {};
  if (brand === "YT Labs") {
    return { employeeProfile: { businessUnit: "YT Labs" } };
  }
  // NB Media: include legacy rows where businessUnit is null OR matches.
  return {
    OR: [
      { employeeProfile: { businessUnit: "NB Media" } },
      { employeeProfile: { businessUnit: null } },
      { employeeProfile: null }, // very-legacy users without a profile row
    ],
  };
}

// Employee-status filter. "exited" = flagged inactive OR has a past
// last-working-day exit (covers exits stuck in a non-final status whose
// isActive was never flipped). "active" (default) is the complement — the
// regular, on-the-books workforce. "all" applies no status filter.
type StatusFilter = "active" | "exited" | "all";

function userWhereForStatus(status: StatusFilter, exitedIds: number[]): Record<string, any> {
  if (status === "all") return {};
  if (status === "exited") {
    return exitedIds.length
      ? { OR: [{ isActive: false }, { id: { in: exitedIds } }] }
      : { isActive: false };
  }
  // active / regular: on the books AND not among the past-LWD exits.
  return { isActive: true, ...(exitedIds.length ? { id: { notIn: exitedIds } } : {}) };
}

// Combine the brand + status where-clauses for a User query. AND them so two
// narrowing clauses (each possibly an `OR`) don't collide on the same key.
function userWhere(brand: BrandFilter, statusWhere: Record<string, any>): Record<string, any> {
  const parts = [userWhereForBrand(brand), statusWhere, devExclusionWhere()]
    .filter((w) => w && Object.keys(w).length);
  return parts.length === 0 ? {} : parts.length === 1 ? parts[0] : { AND: parts };
}

// Same combination, but flowing through the `user` relation on a child entity
// (Attendance.user, LeaveApplication.user, etc.).
function viaUserWhere(brand: BrandFilter, statusWhere: Record<string, any>): Record<string, any> {
  const u = userWhere(brand, statusWhere);
  return Object.keys(u).length ? { user: u } : {};
}

// ─────────────────────────────────────────────────────────────────────
//  Sheet generators
// ─────────────────────────────────────────────────────────────────────

// True when a row's businessUnit falls inside the salary viewer's allowed
// brand. `salaryBrand === null` means all-brands (developer / cross-brand
// HR) so every row qualifies; NB Media absorbs legacy null-BU rows (same
// rule as userWhereForBrand) so those employees still get their pay shown.
function rowInSalaryBrand(businessUnit: string | null | undefined, salaryBrand: BrandFilter): boolean {
  if (salaryBrand === null) return true;
  if (salaryBrand === "YT Labs") return businessUnit === "YT Labs";
  return businessUnit === "NB Media" || businessUnit == null;
}

// Employees directory. When `includeSalary` is true the CTC / Monthly Salary
// columns are APPENDED here (rather than emitted as a separate Salaries tab),
// so a combined Employees+Salaries export is one sheet with no duplicated
// identity headers. `salaryBrand` clamps which rows get pay populated: a
// single-brand salary viewer sees pay only for their own brand's rows even if
// the directory itself spans all brands.
async function addEmployeesSheet(
  wb: ExcelJS.Workbook,
  brand: BrandFilter,
  statusWhere: Record<string, any>,
  includeSalary: boolean,
  salaryBrand: BrandFilter,
) {
  const users = await prisma.user.findMany({
    where: userWhere(brand, statusWhere),
    orderBy: { name: "asc" },
    include: {
      employeeProfile: true,
      manager: { select: { name: true } },
      // RBAC designation (source of truth) — its label drives the Designation
      // column, falling back to the profile's free-text title only when a user
      // has no designationId assigned.
      designation: { select: { label: true } },
      ...(includeSalary ? { salaryStructure: true } : {}),
    },
  });
  const ws = wb.addWorksheet("Employees");
  ws.columns = [
    { header: "HRM No.",        key: "hrm",        width: 12 },
    { header: "Name",           key: "name",       width: 24 },
    { header: "Work Email",     key: "email",      width: 30 },
    { header: "Personal Email", key: "pmail",      width: 28 },
    { header: "Mobile",         key: "phone",      width: 16 },
    { header: "Department",     key: "dept",       width: 22 },
    { header: "Designation",    key: "desig",      width: 28 },
    { header: "Employment Type", key: "etype",     width: 14 },
    { header: "Joining Date",   key: "jd",         width: 14 },
    { header: "Manager",        key: "mgr",        width: 22 },
    { header: "Business Unit",  key: "bu",         width: 14 },
    { header: "Cost Center",    key: "cc",         width: 14 },
    { header: "Legal Entity",   key: "le",         width: 22 },
    { header: "Job Location",   key: "jl",         width: 14 },
    { header: "Work Location",  key: "wl",         width: 12 },
    { header: "Date of Birth",  key: "dob",        width: 14 },
    { header: "Gender",         key: "gender",     width: 10 },
    { header: "Blood Group",    key: "blood",      width: 10 },
    { header: "Marital Status", key: "ms",         width: 12 },
    // Salary columns — only present when the export bundles compensation.
    ...(includeSalary ? [
      { header: "Annual CTC (₹)",     key: "ctc",     width: 16, style: { numFmt: "#,##0" } },
      { header: "Monthly Salary (₹)", key: "monthly", width: 18, style: { numFmt: "#,##0" } },
      { header: "Salary Effective",   key: "salEff",  width: 16 },
    ] : []),
  ];
  for (const u of users) {
    const p = u.employeeProfile;
    const row: Record<string, any> = {
      hrm: p?.employeeId, name: u.name, email: u.email,
      pmail: p?.personalEmail ?? "", phone: p?.phone ?? "",
      dept: p?.department ?? "", desig: u.designation?.label ?? p?.designation ?? "",
      etype: p?.employmentType === "intern" ? "Intern" : "Regular Employee",
      jd: fmtDate(p?.joiningDate as any), mgr: u.manager?.name ?? "",
      bu: p?.businessUnit ?? "", cc: p?.costCenter ?? "",
      le: p?.legalEntity ?? "", jl: p?.jobLocation ?? "",
      wl: p?.workLocation ?? "", dob: fmtDate(p?.dateOfBirth as any),
      gender: p?.gender ?? "", blood: p?.bloodGroup ?? "",
      ms: p?.maritalStatus ?? "",
    };
    if (includeSalary) {
      // Only populate pay for rows inside the viewer's salary brand scope.
      const s = rowInSalaryBrand(p?.businessUnit, salaryBrand) ? (u as any).salaryStructure : null;
      const ctc = s ? Number(s.ctc ?? 0) : null;
      row.ctc     = ctc ?? "";
      row.monthly = ctc != null ? Math.round(ctc / 12) : "";
      row.salEff  = s ? fmtDate(s.effectiveFrom as any) : "";
    }
    ws.addRow(row);
  }
  styleSheet(ws);
}

// Salaries — CTC + monthly pay per employee. Gated separately behind
// canViewSalary (HR Manager / CEO / salary-dev), NOT the general HR-admin
// tier that opens the rest of the workbook. Every regular employee's
// components sum to CTC, so monthly = CTC / 12 (same figure the profile's
// "Monthly Salary" falls back to). Employees without a salary structure
// still get a row, with the pay columns blank, so gaps are visible.
async function addSalariesSheet(wb: ExcelJS.Workbook, brand: BrandFilter, statusWhere: Record<string, any>) {
  const users = await prisma.user.findMany({
    where: userWhere(brand, statusWhere),
    orderBy: { name: "asc" },
    include: {
      employeeProfile: { select: { employeeId: true, department: true, businessUnit: true } },
      salaryStructure: true,
    },
  });
  const ws = wb.addWorksheet("Salaries");
  ws.columns = [
    { header: "HRM No.",            key: "hrm",     width: 12 },
    { header: "Name",               key: "name",    width: 24 },
    { header: "Department",         key: "dept",    width: 22 },
    { header: "Business Unit",      key: "bu",      width: 14 },
    { header: "Salary Type",        key: "stype",   width: 14 },
    { header: "Annual CTC (₹)",     key: "ctc",     width: 16, style: { numFmt: "#,##0" } },
    { header: "Monthly Salary (₹)", key: "monthly", width: 18, style: { numFmt: "#,##0" } },
    { header: "Effective From",     key: "eff",     width: 14 },
  ];
  for (const u of users) {
    const s = u.salaryStructure;
    const ctc = s ? Number(s.ctc ?? 0) : null;
    ws.addRow({
      hrm:   u.employeeProfile?.employeeId ?? "",
      name:  u.name,
      dept:  u.employeeProfile?.department ?? "",
      bu:    u.employeeProfile?.businessUnit ?? "",
      stype: s ? (s.salaryType === "intern" ? "Intern" : "Regular") : "",
      ctc:     ctc ?? "",
      monthly: ctc != null ? Math.round(ctc / 12) : "",
      eff:   s ? fmtDate(s.effectiveFrom as any) : "",
    });
  }
  styleSheet(ws);
}

// Identity — PAN + Aadhaar per employee. PII: gated behind the
// HR-confidential tier (isLeadershipOrHR — HR team via designation, CEO,
// developers), NOT the general HR-admin tier. Employees without documents
// still get a row with blanks so HR can see who's missing what, and a
// "PAN Check" column flags stored values that don't match the real PAN
// format (5 letters + 4 digits + 1 letter) — catches truncated/typo'd
// entries before they break payroll or TDS filings.
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
async function addIdentitySheet(wb: ExcelJS.Workbook, brand: BrandFilter, statusWhere: Record<string, any>) {
  const users = await prisma.user.findMany({
    where: userWhere(brand, statusWhere),
    orderBy: { name: "asc" },
    include: {
      employeeProfile: {
        select: { employeeId: true, department: true, businessUnit: true, designation: true, panNumber: true, aadhaarNumber: true, aadhaarEnrollment: true },
      },
    },
  });
  const ws = wb.addWorksheet("Identity (PAN & Aadhaar)");
  ws.columns = [
    { header: "HRM No.",            key: "hrm",     width: 12 },
    { header: "Name",               key: "name",    width: 24 },
    { header: "Department",         key: "dept",    width: 22 },
    { header: "Business Unit",      key: "bu",      width: 14 },
    { header: "Designation",        key: "desig",   width: 22 },
    { header: "PAN Number",         key: "pan",     width: 16 },
    { header: "PAN Check",          key: "panok",   width: 12 },
    { header: "Aadhaar Number",     key: "aadhaar", width: 18 },
    { header: "Aadhaar Enrollment", key: "enroll",  width: 20 },
  ];
  for (const u of users) {
    const p = u.employeeProfile;
    const pan = (p?.panNumber ?? "").trim().toUpperCase();
    ws.addRow({
      hrm:     p?.employeeId ?? "",
      name:    u.name,
      dept:    p?.department ?? "",
      bu:      p?.businessUnit ?? "",
      desig:   p?.designation ?? "",
      pan,
      panok:   pan ? (PAN_RE.test(pan) ? "OK" : "INVALID") : "MISSING",
      aadhaar: p?.aadhaarNumber ?? "",
      enroll:  p?.aadhaarEnrollment ?? "",
    });
  }
  styleSheet(ws);
}

async function addAttendanceSheet(wb: ExcelJS.Workbook, label: string, start: Date | null, end: Date | null, brand: BrandFilter, statusWhere: Record<string, any>) {
  // When start/end are null we export every attendance row regardless
  // of date — the "All time" option in the picker. Sheet names are
  // capped at 31 chars by Excel, so use a short label.
  const records = await prisma.attendance.findMany({
    where: {
      ...(start && end ? { date: { gte: start, lt: end } } : {}),
      ...viaUserWhere(brand, statusWhere),
    },
    include: { user: { select: { name: true, email: true, employeeProfile: { select: { employeeId: true, department: true } } } } },
    orderBy: [{ date: "asc" }, { user: { name: "asc" } }],
  });
  const ws = wb.addWorksheet(`Attendance — ${label}`.slice(0, 31));
  ws.columns = [
    { header: "Date",          key: "date",  width: 14 },
    { header: "HRM No.",       key: "hrm",   width: 10 },
    { header: "Employee",      key: "name",  width: 22 },
    { header: "Department",    key: "dept",  width: 22 },
    { header: "Status",        key: "status", width: 14 },
    { header: "Clock-In (IST)", key: "cin",  width: 14 },
    { header: "Clock-Out (IST)", key: "cout", width: 14 },
    { header: "Effective Hrs", key: "eff",   width: 12 },
    { header: "Regularized?",  key: "reg",   width: 12 },
  ];
  for (const r of records) {
    ws.addRow({
      date: fmtDate(r.date),
      hrm:  r.user?.employeeProfile?.employeeId ?? "",
      name: r.user?.name ?? "",
      dept: r.user?.employeeProfile?.department ?? "",
      status: r.status,
      cin: fmtIstTime(r.clockIn),
      cout: fmtIstTime(r.clockOut),
      eff: fmtMins(r.totalMinutes),
      reg: r.isRegularized ? "Yes" : "",
    });
  }
  styleSheet(ws);
}

async function addLeaveBalancesSheet(wb: ExcelJS.Workbook, brand: BrandFilter, statusWhere: Record<string, any>) {
  const balances = await prisma.leaveBalance.findMany({
    where: viaUserWhere(brand, statusWhere),
    include: {
      user:      { select: { name: true, email: true, employeeProfile: { select: { employeeId: true, department: true } }, isActive: true } },
      leaveType: { select: { name: true, code: true } },
    },
    orderBy: [{ user: { name: "asc" } }, { leaveType: { name: "asc" } }],
  });
  const ws = wb.addWorksheet("Leave Balances");
  ws.columns = [
    { header: "HRM No.",     key: "hrm",      width: 10 },
    { header: "Employee",    key: "name",     width: 22 },
    { header: "Department",  key: "dept",     width: 22 },
    { header: "Leave Type",  key: "type",     width: 22 },
    { header: "Total",       key: "total",    width: 10 },
    { header: "Used",        key: "used",     width: 10 },
    { header: "Pending",     key: "pending",  width: 10 },
    { header: "Available",   key: "avail",    width: 10 },
  ];
  for (const b of balances) {
    if (!b.user?.isActive) continue;
    const total   = Number(b.totalDays   ?? 0);
    const used    = Number(b.usedDays    ?? 0);
    const pending = Number(b.pendingDays ?? 0);
    ws.addRow({
      hrm:    b.user?.employeeProfile?.employeeId ?? "",
      name:   b.user?.name ?? "",
      dept:   b.user?.employeeProfile?.department ?? "",
      type:   b.leaveType?.name ?? "",
      total, used, pending,
      avail: total - used - pending,
    });
  }
  styleSheet(ws);
}

async function addRequestsSheets(wb: ExcelJS.Workbook, brand: BrandFilter, statusWhere: Record<string, any>) {
  const whereBrand = viaUserWhere(brand, statusWhere);
  // Leave
  const leaves = await prisma.leaveApplication.findMany({
    where: whereBrand,
    include: { user: { select: { name: true, employeeProfile: { select: { employeeId: true, department: true } } } }, leaveType: { select: { name: true } }, approver: { select: { name: true } } },
    orderBy: { appliedAt: "desc" },
  });
  const lws = wb.addWorksheet("Leaves");
  lws.columns = [
    { header: "Applied",   key: "applied",   width: 14 },
    { header: "HRM No.",   key: "hrm",       width: 10 },
    { header: "Employee",  key: "name",      width: 22 },
    { header: "Department", key: "dept",     width: 22 },
    { header: "Type",      key: "type",      width: 18 },
    { header: "From",      key: "from",      width: 14 },
    { header: "To",        key: "to",        width: 14 },
    { header: "Days",      key: "days",      width: 8 },
    { header: "Status",    key: "status",    width: 14 },
    { header: "Approver",  key: "approver",  width: 18 },
    { header: "Reason",    key: "reason",    width: 40 },
  ];
  for (const l of leaves) {
    lws.addRow({
      applied: fmtDate(l.appliedAt), hrm: l.user?.employeeProfile?.employeeId ?? "",
      name: l.user?.name ?? "", dept: l.user?.employeeProfile?.department ?? "",
      type: l.leaveType?.name ?? "", from: fmtDate(l.fromDate), to: fmtDate(l.toDate),
      days: Number(l.totalDays ?? 0), status: l.status,
      approver: l.approver?.name ?? "", reason: l.reason ?? "",
    });
  }
  styleSheet(lws);

  // WFH
  const wfh = await prisma.wFHRequest.findMany({
    where: whereBrand,
    include: { user: { select: { name: true, employeeProfile: { select: { employeeId: true, department: true } } } }, approver: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const wws = wb.addWorksheet("WFH");
  wws.columns = [
    { header: "Submitted", key: "sub",     width: 14 },
    { header: "HRM No.",   key: "hrm",     width: 10 },
    { header: "Employee",  key: "name",    width: 22 },
    { header: "Department", key: "dept",   width: 22 },
    { header: "Date",      key: "date",    width: 14 },
    { header: "Status",    key: "status",  width: 14 },
    { header: "Approver",  key: "approver", width: 18 },
    { header: "Reason",    key: "reason",  width: 40 },
  ];
  for (const w of wfh) {
    wws.addRow({
      sub: fmtDate(w.createdAt), hrm: w.user?.employeeProfile?.employeeId ?? "",
      name: w.user?.name ?? "", dept: w.user?.employeeProfile?.department ?? "",
      date: fmtDate(w.date), status: w.status,
      approver: w.approver?.name ?? "", reason: w.reason ?? "",
    });
  }
  styleSheet(wws);

  // On-Duty
  const od = await prisma.onDutyRequest.findMany({
    where: whereBrand,
    include: { user: { select: { name: true, employeeProfile: { select: { employeeId: true, department: true } } } }, approver: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const ows = wb.addWorksheet("On-Duty");
  ows.columns = [
    { header: "Submitted", key: "sub",     width: 14 },
    { header: "HRM No.",   key: "hrm",     width: 10 },
    { header: "Employee",  key: "name",    width: 22 },
    { header: "Department", key: "dept",   width: 22 },
    { header: "Date",      key: "date",    width: 14 },
    { header: "Location",  key: "loc",     width: 22 },
    { header: "Status",    key: "status",  width: 14 },
    { header: "Approver",  key: "approver", width: 18 },
    { header: "Purpose",   key: "purpose", width: 40 },
  ];
  for (const r of od) {
    ows.addRow({
      sub: fmtDate(r.createdAt), hrm: r.user?.employeeProfile?.employeeId ?? "",
      name: r.user?.name ?? "", dept: r.user?.employeeProfile?.department ?? "",
      date: fmtDate(r.date), loc: r.location ?? "", status: r.status,
      approver: r.approver?.name ?? "", purpose: r.purpose ?? "",
    });
  }
  styleSheet(ows);

  // Regularizations
  const regs = await prisma.attendanceRegularization.findMany({
    where: whereBrand,
    include: { user: { select: { name: true, employeeProfile: { select: { employeeId: true, department: true } } } }, approver: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const rws = wb.addWorksheet("Regularizations");
  rws.columns = [
    { header: "Submitted", key: "sub",     width: 14 },
    { header: "HRM No.",   key: "hrm",     width: 10 },
    { header: "Employee",  key: "name",    width: 22 },
    { header: "Department", key: "dept",   width: 22 },
    { header: "Date",      key: "date",    width: 14 },
    { header: "Status",    key: "status",  width: 14 },
    { header: "Approver",  key: "approver", width: 18 },
    { header: "Reason",    key: "reason",  width: 40 },
  ];
  for (const r of regs) {
    rws.addRow({
      sub: fmtDate(r.createdAt), hrm: r.user?.employeeProfile?.employeeId ?? "",
      name: r.user?.name ?? "", dept: r.user?.employeeProfile?.department ?? "",
      date: fmtDate(r.date), status: r.status,
      approver: r.approver?.name ?? "", reason: r.reason ?? "",
    });
  }
  styleSheet(rws);

  // Comp-Off
  const comp = await prisma.compOffRequest.findMany({
    where: whereBrand,
    include: { user: { select: { name: true, employeeProfile: { select: { employeeId: true, department: true } } } }, approver: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const cws = wb.addWorksheet("Comp-Off");
  cws.columns = [
    { header: "Submitted",   key: "sub",     width: 14 },
    { header: "HRM No.",     key: "hrm",     width: 10 },
    { header: "Employee",    key: "name",    width: 22 },
    { header: "Department",  key: "dept",    width: 22 },
    { header: "Worked Date", key: "wd",      width: 14 },
    { header: "Credit",      key: "credit",  width: 10 },
    { header: "Status",      key: "status",  width: 14 },
    { header: "Approver",    key: "approver", width: 18 },
    { header: "Reason",      key: "reason",  width: 40 },
  ];
  for (const c of comp) {
    cws.addRow({
      sub: fmtDate(c.createdAt), hrm: c.user?.employeeProfile?.employeeId ?? "",
      name: c.user?.name ?? "", dept: c.user?.employeeProfile?.department ?? "",
      wd: fmtDate(c.workedDate), credit: Number(c.creditDays ?? 0),
      status: c.status, approver: c.approver?.name ?? "", reason: c.reason ?? "",
    });
  }
  styleSheet(cws);
}

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  if (!isHRAdmin(user)) {
    return NextResponse.json({ error: "HR-admin only" }, { status: 403 });
  }
  try {
    const sheets = (req.nextUrl.searchParams.get("sheets") || "employees,attendance,leaves,requests")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const period = req.nextUrl.searchParams.get("period") || "both"; // both | current | last | this-year | last-year | all
    // Brand scope — "nb-media" / "yt-labs" narrows every sheet to that
    // brand's employees + their related rows; "all" (or unset) exports
    // the full org. Slug form matches what the HR-admin sidebar
    // generates so the URL stays consistent end-to-end.
    const brandRaw = (req.nextUrl.searchParams.get("brand") || "").toLowerCase();
    const brandRequested: BrandFilter =
      brandRaw === "yt-labs" || brandRaw === "yt"      ? "YT Labs" :
      brandRaw === "nb-media" || brandRaw === "nb"     ? "NB Media" :
      null;
    // Org-wide brand isolation (2026-07-15): EVERY sheet is clamped to the
    // viewer's brand scope. All-brands viewers (developer / VIEW_ALL_BRANDS)
    // export whatever brand they asked for; a single-brand HR Manager only
    // ever exports their own brand, whatever the URL says.
    const viewerScope = getBrandScope(user);
    const brand: BrandFilter = viewerScope.allBrands
      ? brandRequested
      : ((viewerScope.brand as BrandFilter) ?? "NB Media");

    // Employee status — "active" (default) exports the regular on-the-books
    // workforce (no exited employees); "exited" exports only those who've left;
    // "all" ignores the status filter. Exited = inactive OR a past last-working
    // day (so exits stuck in a non-final status still count as exited).
    const statusRaw = (req.nextUrl.searchParams.get("status") || "").toLowerCase();
    const status: StatusFilter =
      statusRaw === "exited" ? "exited" :
      statusRaw === "all"    ? "all" :
      "active";
    const exitedRows = status === "all"
      ? []
      : await prisma.employeeExit.findMany({
          where: { lastWorkingDay: { lt: istTodayDateOnly() } },
          select: { userId: true },
        });
    const statusWhere = userWhereForStatus(status, exitedRows.map((e) => e.userId));

    // Salary gate + brand-clamp resolved once, up front. Salaries is gated
    // behind canViewSalary (HR Manager / CEO / salary-dev) — NOT the broader
    // HR-admin tier — and clamped to the viewer's brand: an all-brands viewer
    // (developer / cross-brand HR) sees pay for everyone in scope; a
    // single-brand HR Manager only their own brand. `salaryBrand === null`
    // means all-brands. A no-brand (fail-closed) viewer gets no pay at all.
    const wantsSalary = sheets.includes("salaries") && canViewSalary(user);
    let salaryOk = false;
    let salaryBrand: BrandFilter = null;
    if (wantsSalary) {
      const scope = getBrandScope(user);
      if (scope.allBrands)      { salaryOk = true; salaryBrand = null; }
      else if (scope.brand)     { salaryOk = true; salaryBrand = scope.brand as BrandFilter; }
    }

    // Identity (PAN/Aadhaar) gate — HR-confidential tier only, and clamped to
    // the intersection of the requested brand and the viewer's brand scope
    // (an all-brands viewer exports the brand they asked for; a single-brand
    // HR Manager only ever their own brand, whatever the URL says).
    let identityOk = false;
    let identityBrand: BrandFilter = null;
    if (sheets.includes("identity") && isLeadershipOrHR(user)) {
      const scope = getBrandScope(user);
      if (scope.allBrands)  { identityOk = true; identityBrand = brand; }
      else if (scope.brand) { identityOk = true; identityBrand = scope.brand as BrandFilter; }
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = brand
      ? `${brand} HR Dashboard`
      : "NB Media HR Dashboard";
    wb.created = new Date();

    // When BOTH Employees and Salaries are picked, CTC / Monthly Salary are
    // merged as extra columns on the Employees sheet (no second tab, no
    // duplicated identity headers). A standalone Salaries tab is emitted only
    // when Salaries is picked without Employees (see after the request logs).
    const mergeSalaryIntoEmployees = salaryOk && sheets.includes("employees");
    if (sheets.includes("employees"))
      await addEmployeesSheet(wb, brand, statusWhere, mergeSalaryIntoEmployees, salaryBrand);
    if (sheets.includes("attendance")) {
      const now = new Date();
      const yNow = now.getUTCFullYear();
      const mNow = now.getUTCMonth();
      if (period === "both" || period === "last") {
        const prev = istMonthRange(yNow, mNow - 1);
        await addAttendanceSheet(wb, prev.label, prev.start, prev.end, brand, statusWhere);
      }
      if (period === "both" || period === "current") {
        const curr = istMonthRange(yNow, mNow);
        await addAttendanceSheet(wb, curr.label, curr.start, curr.end, brand, statusWhere);
      }
      if (period === "this-year") {
        const r = istYearRange(yNow);
        await addAttendanceSheet(wb, r.label, r.start, r.end, brand, statusWhere);
      }
      if (period === "last-year") {
        const r = istYearRange(yNow - 1);
        await addAttendanceSheet(wb, r.label, r.start, r.end, brand, statusWhere);
      }
      if (period === "all") {
        // One sheet per year for readability. Years derived from the
        // actual data so we don't emit empty sheets for years with
        // zero rows. Falls back to a single all-time sheet if nothing
        // exists yet.
        const yearsRaw = await prisma.$queryRawUnsafe<Array<{ y: number }>>(
          `SELECT DISTINCT EXTRACT(YEAR FROM ("date" AT TIME ZONE 'Asia/Kolkata'))::int AS y
             FROM "Attendance" ORDER BY y ASC`
        );
        if (yearsRaw.length === 0) {
          await addAttendanceSheet(wb, "All time", null, null, brand, statusWhere);
        } else {
          for (const { y } of yearsRaw) {
            const r = istYearRange(Number(y));
            await addAttendanceSheet(wb, r.label, r.start, r.end, brand, statusWhere);
          }
        }
      }
    }
    if (sheets.includes("leaves"))   await addLeaveBalancesSheet(wb, brand, statusWhere);
    if (sheets.includes("requests")) await addRequestsSheets(wb, brand, statusWhere);
    // Standalone Salaries tab ONLY when Salaries was picked without the
    // Employees directory. When Employees is also picked, pay was already
    // merged into that sheet above — so we don't emit a second tab here (that
    // was the duplicated-header behaviour we're removing).
    if (salaryOk && !sheets.includes("employees")) {
      await addSalariesSheet(wb, salaryBrand, statusWhere);
    }
    if (identityOk) await addIdentitySheet(wb, identityBrand, statusWhere);

    const buffer = await wb.xlsx.writeBuffer();
    const brandFileSlug = brand === "YT Labs" ? "yt-labs" : brand === "NB Media" ? "nb-media" : "all-brands";
    const filename = `master-sheet-${brandFileSlug}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) { return serverError(e, "GET /api/hr/admin/master-sheet"); }
}
