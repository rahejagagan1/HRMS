# Project Diff Report — F (current) vs Y (copy)

- **F (PRIMARY / reference)**: `F:\clickup\nb-dashboard` — branch `gagan` @ `59230fd` (2026‑04‑29)
- **Y (SECONDARY / copy)**: `Y:\nb_dashboard` (network share `\\192.168.0.105\AI_Team\nb_dashboard`) — branch `main` @ `0e84ada`
- Y's HEAD commit does not exist in F's history. They are **divergent forks**, not snapshots of the same line. Each side has features the other lacks.

## Methodology

1. Walked both trees, hashed every file, excluded `node_modules`, `.next`, `.git`, build artefacts.
2. Initial diff: **170 files only in F · 30 only in Y · 360 modified · 514 identical**.
3. Re-classified the 360 "modified" with `--ignore-cr-at-eol`. Result: **317 were CRLF-only (no functional difference; F = LF, Y = CRLF)**, **39 had real content changes**.
4. Read every real diff hunk. Summaries below describe **what F has / does that Y does not, and vice versa**.

> Files dropped as pure noise: `.code-review-graph/wiki/*`, `public/uploads/kpis/*` (binary KPI PDFs/Docx), `package-lock.json`, `tsconfig.tsbuildinfo`, `prisma/schema.prisma.bak`, `prisma/schema.prisma.pulled`, `.claude/scheduled_tasks.lock`, `.claude/settings*.json`, `.claude/skills/*`. These exist on one side only but are either auto-generated, binary uploads, lock files, or local Claude Code state — not project code.

---

## 1. Headline themes

| Theme | Side that has it | Where |
|---|---|---|
| **Multi-editor / multi-writer per case** (CaseEditorEntry / CaseWriterEntry join tables, sync of all editor/writer custom-field IDs) | **F only** | schema, migrations, `sync-engine.ts`, `cases-table.tsx`, `cases/[id]` route |
| **Multi-assignee per subtask** (SubtaskAssignee join table) | **F only** | schema, sync-engine, subtask-timeline |
| **Cron "Sync past quarters" toggle** for the YouTube dashboard cron | **F only** | `cron-jobs-config.ts`, `cron-jobs-runners.ts`, `cron-jobs-registry.ts`, admin page |
| **Live "currently running" cron status poll** (3s polling endpoint + UI feedback) | **F only** | `/api/admin/cron-jobs/running` route, admin page poll loop |
| **YouTube channel subscriber counts in quarterly endpoint + Studio metric tabs** (Views / Watch time / Subscribers selector + per-bucket subscribersGained) | **F only** | `youtube-analytics.ts`, `quarterly/route.ts`, `youtube/page.tsx`, `channel-quarter-modal.tsx`, `channel-quarter-analysis.ts` |
| **NotificationBell rich features** (sound on new notif, mute toggle, "delete read" overflow menu, Notes filter tab, splitNote helper, longer 20-item feed) | **F only** | `components/notificationbell.tsx` |
| **Subtask TAT widened to DECIMAL(7,2)** (overflow fix for cases > 42 days) | **F only** | migration `20260505120000_widen_subtask_tat` |
| **Sync-missing-tables-to-prod migration** (creates 18 prod-only tables for HR module) | **F only** | migration `20260429120000_sync_missing_tables_to_prod` |
| **`canSeeReports` / `isPickableAsManager` central helpers** used everywhere (single source of truth) | **F only** | `src/lib/access.ts` + reports page consumes them |
| **Per-session attendance geolocation** (`AttendanceSession.clockInLocation` / `clockOutLocation`) | **Y only** | migration `20260507100000`, clock-in/out routes, attendance page UI |
| **Two-step Clock-Out confirmation + green/red gradient buttons + "DayLocationPin" combined popover** (Keka pattern) | **Y only** | hr/home, hr/attendance, hr/analytics pages |
| **Violation file attachments** (BYTEA blob `actionTakenFileBlob` + Mime + Name; multipart POST/PATCH; download route; UI upload widget) | **Y only** | migrations `20260506140000` + `20260507150000_violation_file_blob`, `/api/violations/[id]/file/route.ts`, violations/route.ts, violations page |
| **EmployeeProfile Keka-parity columns** (homePhone, motherName, spouseName, childrenNames, addressLine2/Pincode/Country, permanent address × 6, attendanceCaptureScheme, costCenter, pfNumber, uanNumber, biometricId, physicallyHandicapped, emergencyRelationship) | **Y only** | migration `20260507150000_employee_profile_keka_parity`, onboard wizard step 5, edit-profile panel |
| **`SearchableSelect` component** (type-to-filter dropdown, portal-rendered) | **Y only** | `components/ui/searchable-select.tsx` |
| **`role=hr_manager` (not `orgLevel`) gates HR Manager access** in reports + manager picker | **Y only** | `lib/access.ts`, `/api/managers`, `/api/admin/reports` |
| **`prisma generate` baked into build / start / postinstall scripts** | **Y only** | `package.json` |
| **Reports view URLs include `&year=…`** (so 2025 report viewed in 2026 doesn't fall back to current year) | **Y only** | `/api/admin/reports` |
| **YouTube quarter buckets are 10-day** (vs F's 7-day weekly), no subscriber data persisted | **Y only** | `channel-quarter-analysis.ts`, `youtube-analytics.ts`, `yt-dashboard-sync.ts` |
| **Missed-clock-in reminder skips weekends + accepts `partially_approved` leave** | **Y only** | `lib/hr/missed-attendance-emails.ts` |
| **Attendance reminder schedule changes** — clock-in 10:00 (was 10:15 in Y, F has 09:58→10:15 evolution) and clock-out 19:00 (Y) vs 20:00 (F) | F vs Y differ | `yt-dashboard-scheduler.ts` |

---

## 2. Files only in F (relevant)

| Path | What it adds |
|---|---|
| [prisma/migrations/20260429120000_sync_missing_tables_to_prod/migration.sql](prisma/migrations/20260429120000_sync_missing_tables_to_prod/migration.sql) | Massive prod-alignment migration. Creates 18 tables that existed only in dev: `AttendanceRegularization`, `AuditLog`, `CompOffRequest`, `EngageComment`, `EngagePost`, `EngageReaction`, `Expense`, `GoalCycle`, `KeyResult`, `Notification`, `OnDutyRequest`, `Payslip`, `ResearcherPipelineSnapshot`, `TeamManagerRating`, `TravelRequest`, `UserTabPermission`, `Violation`, `WFHRequest`. Also creates `ViolationSeverity` and `ViolationStatus` enums. Does not alter shared tables. |
| [prisma/migrations/20260505120000_widen_subtask_tat/migration.sql](prisma/migrations/20260505120000_widen_subtask_tat/migration.sql) | `ALTER TABLE Subtask ALTER COLUMN tat TYPE DECIMAL(7,2)` — fixes overflow for subtasks > ~42 days that were tripping Postgres error 22003. |
| [prisma/migrations/20260507120000_case_editor_writer_entries/migration.sql](prisma/migrations/20260507120000_case_editor_writer_entries/migration.sql) | Creates `CaseEditorEntry` and `CaseWriterEntry` join tables (caseId / userId / clickupUserId, unique pair). Powers F's multi-editor / multi-writer-per-case feature. |
| [src/app/api/admin/cron-jobs/running/route.ts](src/app/api/admin/cron-jobs/running/route.ts) | New admin GET endpoint. Returns `{runningJobId}` of any cron job currently mid-run (SyncLog status="running" within last 10 min). Polled every 3s by the admin page so all tabs see running state. |
| `scripts/_check_migrations.mjs`, `_query-april-scores.mjs`, `compare-db-tables.mjs`, `_delete-ayush.ts`, `_transfer-user-profile.ts`, `manpreet-apr-monthly.ts`, `manpreet-apr-w5.ts` | One-off ops scripts (DB introspection, user data fixes for a specific employee, monthly rating scripts). Not production code. |
| `env/.env_all`, `env/.env_pro`, `env/env_new` | **Local secrets** — credentials, do not share. |

---

## 3. Files only in Y (relevant)

| Path | What it adds |
|---|---|
| `prisma/migrations/20260506140000_violation_action_taken_file/migration.sql` | Adds `actionTakenFileUrl` and `actionTakenFileName` to `Violation` (filesystem-URL approach — Y later supersedes this with the BYTEA blob below). |
| `prisma/migrations/20260507100000_attendance_session_location/migration.sql` | Adds `clockInLocation` and `clockOutLocation` (TEXT, JSON-stringified geo blob) to `AttendanceSession`. Per-punch geo for multi-session days. |
| `prisma/migrations/20260507150000_employee_profile_keka_parity/migration.sql` | Adds 21 new columns to `EmployeeProfile`: homePhone, physicallyHandicapped, addressLine2/Pincode/Country, permanentLine1/2/City/State/Pincode/Country, motherName, spouseName, childrenNames, emergencyRelationship, attendanceCaptureScheme, costCenter, pfNumber, uanNumber, biometricId. |
| `prisma/migrations/20260507150000_violation_file_blob/migration.sql` | Supersedes the URL approach: adds `actionTakenFileBlob` (BYTEA) and `actionTakenFileMime` (TEXT) so violation attachments survive redeploys (`/public/uploads/` got wiped on every Docker rebuild). |
| `src/app/api/violations/[id]/file/route.ts` | New HR-admin-gated GET route. Streams `actionTakenFileBlob` back with proper Content-Type / Content-Disposition: attachment / Content-Length and a sanitised filename. Cache-Control: private, no-store so revoked access can't replay a cached response. |
| `src/components/ui/searchable-select.tsx` | Reusable SearchableSelect component with portal-rendered panel, type-to-filter on label + sublabel, keyboard nav (highlight index). |
| `.env_pro` | Local secret file at repo root (F's equivalent lives under `env/`). |
| `scripts/__sample-keka.csv`, `_arpit-reset-to-single-8am.ts`, `_audit-attendance-emails.ts`, `_audit-profile-rows.ts`, `_check-arpit-attendance.ts`, `_check-vanshika-reports.ts`, `_copy-clockin-location.ts`, `_describe-table.ts`, `_find-user.ts`, `_inspect-attendance.ts`, `_rewrite-attendance-day.ts`, `_set-clockin-time.ts`, `_smtp-check.{ts,mjs}`, `_test-attendance-emails.ts`, `_test-keka-parser.ts` | Ops/debugging scripts: a Keka CSV importer test harness, attendance email auditing, SMTP smoke tests, per-employee attendance fixes. Not production code. |
| `.claude/skills/{debug-issue,explore-codebase,refactor-safely,review-changes}.md`, `.claude/settings*.json` | Local Claude Code IDE settings on the Y machine. Not project code. |

---

## 4. Files modified — real diffs (39 total)

> "F has X, Y has Y" = the line/feature in question. Minor formatting and CRLF were excluded — only actual semantic deltas listed.

### 4.1 Config & root

#### [.env](.env)
- F: single `DATABASE_URL` to `nb_dashboard`. Y: `DATABASE_URL` points at `nb_dashboard_dev` with `connection_limit=5&pool_timeout=20`, plus a commented-out prod URL and a `SHADOW_DATABASE_URL` to `nb_dashboard_shadow`.
- Y also adds `PII_ENCRYPTION_KEY` (column-level AES-256-GCM key for bank acct / PAN / Aadhaar), more SMTP comments, and additional commented-out OAuth/host blocks for `rating.nbmedia.co.in`.

#### [package.json](package.json)
- F scripts: `dev`, `build: next build`, `start: next start -p 3005`, `lint: eslint`.
- Y scripts: `dev`, **`build: prisma generate && next build`**, **`start: prisma migrate deploy && next start -p 3005`**, `lint`, **`postinstall: prisma generate`**. Y's flow guarantees a fresh Prisma client and migration-deploy on every release.

#### [prisma/schema.prisma](prisma/schema.prisma)
- **F has** four extra models Y doesn't: `CaseEditorEntry`, `CaseWriterEntry`, `SubtaskAssignee`, plus the back-relations on `User`, `Case`, `Subtask` (`caseEditorEntries`, `caseWriterEntries`, `subtaskAssignments`, `allEditors`, `allWriters`, `subtasks.assignees`).
- **Y has** column additions on `Violation` (`actionTakenFileUrl`, `actionTakenFileName`, `actionTakenFileBlob` BYTEA, `actionTakenFileMime`) and ~21 new columns on `EmployeeProfile` (homePhone, physicallyHandicapped, addressLine2/Pincode/Country, permanent×6, motherName, spouseName, childrenNames, emergencyRelationship, attendanceCaptureScheme, costCenter, pfNumber, uanNumber, biometricId).

### 4.2 API routes

#### [src/app/admin/page.tsx](src/app/admin/page.tsx)
F-only behaviour:
- Polls `/api/admin/cron-jobs/running` every 3s; reflects "running" state on every Sync ClickUp / Sync Users / etc. button across tabs.
- "Sync past quarters" toggle on the YouTube dashboard cron job (fires the past-5-years backfill on each run).
- Friendly error toast on user-delete failures (Y silently swallows the exception with `catch{}`).

#### [src/app/api/admin/cron-jobs/route.ts](src/app/api/admin/cron-jobs/route.ts)
- F's PATCH accepts `syncPastQuarters` in body and persists it to job state. Y's PATCH only accepts `enabled` and `intervalHours`.

#### [src/app/api/admin/reports/route.ts](src/app/api/admin/reports/route.ts)
- Access gate differs: F gates on `orgLevel === "hr_manager"` (broad — every HR person). **Y** gates on **`role === "hr_manager"`** (strict — only the actual HR Manager, e.g. Tanvi). Y's wording calls this out as the right form: "gating on orgLevel=hr_manager would let every HR employee see all reports".
- View URL: F builds `/dashboard/reports/<mid>/weekly/<wk>?month=<m>` and `/monthly/<m>`. **Y** appends `&year=<y>` (so a 2025 report viewed in 2026 doesn't blank).

#### [src/app/api/cases/route.ts](src/app/api/cases/route.ts)
- F's userId-filter `OR` clause includes `subtasks: { some: { assignees: { some: { userId: uid } } } }` — finds cases where the user is a subtask assignee. **Y removes this branch** because Y has no `SubtaskAssignee` join table.

#### [src/app/api/dashboard/youtube/quarterly/route.ts](src/app/api/dashboard/youtube/quarterly/route.ts)
- F also calls `getChannelSubscriberCounts(channelIds)` in batch and includes `subscriberCount` per channel in the response. Y omits that import and field entirely.

#### [src/app/api/hr/attendance/clock-in/route.ts](src/app/api/hr/attendance/clock-in/route.ts)
- Y's INSERT into `AttendanceSession` writes `clockInLocation = $3` (the JSON-stringified geo). F's INSERT only writes attendanceId + clockIn (no per-session geo column exists in F's schema).

#### [src/app/api/hr/attendance/clock-out/route.ts](src/app/api/hr/attendance/clock-out/route.ts)
- F's POST takes no body (`_req`) — clock-out has no geo capture.
- **Y rewrites the route** to optionally accept `{lat, lng, address}` JSON, validates with `zod`, calls `stringifyAttLoc(...)`, and `UPDATE "AttendanceSession" SET "clockOut"=$1, "clockOutLocation"=$2 WHERE id=$3`. Empty body still allowed → just NULL location.

#### [src/app/api/hr/attendance/route.ts](src/app/api/hr/attendance/route.ts)
- Y's GET reads `clockInLocation` and `clockOutLocation` from `AttendanceSession` rows and surfaces them on the response. F's GET doesn't.

#### [src/app/api/managers/route.ts](src/app/api/managers/route.ts)
- F's eligible-manager query: `orgLevel IN ("ceo","special_access","hod","manager","hr_manager")` OR `role IN ("admin","manager","production_manager"...)`.
- **Y**: `orgLevel IN ("hod","manager")` OR `role IN ("manager","production_manager"...)`. Excludes CEO / special_access / admin / orgLevel=hr_manager so they don't pollute the manager picker (they view reports but don't own any).

#### [src/app/api/users/route.ts](src/app/api/users/route.ts)
- POST: Y persists ~25 extra Keka-parity columns into `EmployeeProfile.upsert(...)` (homePhone, physicallyHandicapped, parentName/motherName/spouseName/childrenNames, emergencyRelationship, addressLine2/Pincode/Country, permanent×6, attendanceCaptureScheme, costCenter, panNumber, aadhaarNumber, pfNumber, uanNumber, biometricId, attendanceNumber default-to-employeeId). Casts `profileData: any` to bypass typed Prisma client lag.
- DELETE: **F manually `deleteMany` cascades 19 dependent tables** (notifications, leaves, attendance, ratings, reports, violations, etc.) before `prisma.user.delete`. **Y just calls `prisma.user.delete({where:{id}})`** and relies on Postgres FK CASCADE / SET NULL.

#### [src/app/api/violations/route.ts](src/app/api/violations/route.ts)
- F: pure JSON body, single relations include, single FK insert.
- **Y rewrites it heavily**:
  - Adds `extname` import and `runtime = "nodejs"`.
  - Defines `MAX_FILE_BYTES=10MB`, `ALLOWED_EXTS` (.pdf .doc .docx .rtf .odt .txt .md .png .jpg .jpeg .webp), `MIME_BY_EXT` fallback map.
  - GET uses an explicit `select` that excludes the BYTEA blob from list payloads (so listing doesn't haul MBs of file bytes).
  - POST branches on Content-Type: `multipart/form-data` (form upload) or `application/json` (legacy callers). On form-data: validates size + extension, reads bytes into Buffer, picks Content-Type with browser-mime-falls-back-to-MIME_BY_EXT.
  - POST also accepts a `reportedById` override so HR can file a violation on someone else's behalf, with FK existence guard.
  - PATCH similarly branches: form-data path supports re-upload (replaces blob, nulls legacy URL) or `clearActionTakenFile=1` (nulls all four columns).

#### [src/app/api/dashboard/reports/page.tsx](src/app/dashboard/reports/page.tsx)
- F imports central `isAdmin` / `canSeeReports` helpers from `@/lib/access`. Y inlines the access checks (`orgLevel==="ceo" || isDeveloper || ...`). F's centralisation is a refactor Y predates.

### 4.3 Dashboard pages

#### [src/app/dashboard/hr/analytics/page.tsx](src/app/dashboard/hr/analytics/page.tsx)
- **Y adds two-step Clock-Out** (`confirmingClockOut` + `clockingOut` state, 6s auto-cancel, Confirm/Cancel pair). F has a single-click clock-out button.

#### [src/app/dashboard/hr/attendance/page.tsx](src/app/dashboard/hr/attendance/page.tsx)
This is the largest UI change (~440/103 lines). **Y adds**:
- New `DayLocationPin` component — single pin opening a popover with both clock-in AND clock-out locations stacked. Replaces F's flanking green-in / red-out pin pair.
- `LocationPin` extended with `kind="in"|"out"` and `tintOverride` props.
- `TimelineBar` upgrade: takes `firstIn` / `lastOut` / `isOpen`, renders Keka-style "Logged In 8:13am – 5:18pm" hover tooltip with status dot and notch.
- Two-step Clock-Out confirmation (matches the home/analytics pattern).
- Geo capture on clock-out (`captureClockInGeo()`), POSTs `{lat,lng,address}` to clock-out route.
- Vertical-gradient buttons (green for any clock-in, red for clock-out) with insetSheen + halo.
- Table headers + cells centre-aligned for TIMELINE/EFFECTIVE/GROSS/LOG columns.
- Rich Keka-style status icon popover with ArrowDownLeft / ArrowUpRight per session for multi-session "Web Clock In" grid.
- Drops the "Resume Clock-In" wording — every new session shows "Web Clock-In" regardless of prior sessions.

#### [src/app/dashboard/hr/engage/page.tsx](src/app/dashboard/hr/engage/page.tsx)
- F caps post images at `max-h-[500px]` with `mx-auto w-auto` (centred letterbox). **Y** changes to `w-full h-auto max-h-[640px]` so posters / anniversary cards render full-width-prominent (Keka-style).

#### [src/app/dashboard/hr/home/page.tsx](src/app/dashboard/hr/home/page.tsx)
- Same image-rendering change (max 360 → 480, full-width).
- F gates clock-in/out on a mobile-User-Agent check (`isMobileDevice` blocks both buttons on phones, with a "Only accessible on Laptop & Desktop" sublabel). **Y removes the mobile gate entirely** and instead adds:
  - Two-step Clock-Out confirmation.
  - Geo capture on clock-out with body POST.
  - Re-introduces the Clock-In button after clock-out (multi-session) instead of showing a non-actionable "Done" pill.
  - Gradient/sheen buttons.

#### [src/app/dashboard/hr/onboard/page.tsx](src/app/dashboard/hr/onboard/page.tsx)
- F: 4-step wizard.
- **Y: 5-step wizard** with new "Address & IDs" step. Form type extended with workPhone / homePhone / personalEmail / maritalStatus / bloodGroup / physicallyHandicapped / fatherName / motherName / spouseName / childrenNames / emergencyRelationship / attendanceCaptureScheme / costCenter / addressLine1-2 / city / state / addressPincode / addressCountry / permanent×6 / panNumber / aadhaarNumber / pfNumber / uanNumber / biometricId. POST submits all of those into `EmployeeProfile`. Auto-syncs `attendanceNumber` to full employee number (HRM47 → HRM47, not just the prefix).

#### [src/app/dashboard/reports/page.tsx](src/app/dashboard/reports/page.tsx)
- F uses the central `isAdmin` / `canSeeReports` helpers. Y inlines.

#### [src/app/dashboard/tools/page.tsx](src/app/dashboard/tools/page.tsx)
- Y adds two new tool tiles: **"Old SRT Model"** (history-icon, links to streamlit fallback) and **"Analysis Tool"** (custom "VO" letter-mark icon, links to `analysis.nbmedia.co.in`). F's tools list lacks these.

#### [src/app/dashboard/violations/page.tsx](src/app/dashboard/violations/page.tsx)
**Y rewrites this heavily**:
- New imports: `useMemo`, `SearchableSelect`.
- New fields on Violation interface: `orgLevel`, `actionTakenFileUrl`, `actionTakenFileName`.
- New form state: `actionTakenFile` (File|null), `editFile`, `clearEditFile`, `reportedById` (defaults to `dbId`).
- Submit form switches POST/PATCH to `multipart/form-data` when a file is involved.
- Default severity: F = `"medium"`, Y = `"low"`.
- Description (was "Notes (Optional)") becomes mandatory; Action Document is mandatory. Submit is gated on both.
- "Reported By" field — defaults to logged-in user, overridable to anyone in the directory.
- Employee + Manager pickers replaced with `<SearchableSelect>` (type-to-filter).
- Edit mode: shows currently-attached file with Replace + Remove actions; "Will remove on save" UX with Undo.
- Card view: shows attached-file link as `📎 filename` linking to `/api/violations/<id>/file`.

#### [src/app/dashboard/youtube/channel-quarter-modal.tsx](src/app/dashboard/youtube/channel-quarter-modal.tsx)
- **F adds the YT-Studio 3-metric tab selector** (Views / Watch time / Subscribers) with a top blue accent bar on the selected tab, per-metric totals (`metricTotals`), per-metric chart switching (`activeDataKey`), formatted compact totals (1.2M / 12K), and an empty-state when subscriber data hasn't been synced. Y's older form just shows a single "Quarter views" tile and the chart.
- F also renders a footer legend (Channel views / Your contribution).
- F removes the `cn` import & helper-tab boilerplate from Y's older shape.

#### [src/app/dashboard/youtube/page.tsx](src/app/dashboard/youtube/page.tsx)
- F's `ChannelRow` includes `subscriberCount` and the page passes it through to the modal. Y omits.
- F's auto-open chart logic: opens the channel the user contributed to if any, else the first channel (`>= 1`). Y opens **only when exactly one** contributed channel.
- F adds a `STUDIO_TAB_ACCENT` blue bar style and a redesigned 4-slot tabbed channel strip with extras counter ("+N more channels — open Developer analytics for the full list").

### 4.4 Components

#### [src/components/cases/subtask-timeline.tsx](src/components/cases/subtask-timeline.tsx)
- F surfaces multi-assignee per subtask (renders all `subtask.assignees[].user`, falls back to single `assignee` if empty). Y only renders the single `subtask.assignee` (no `assignees` field on its type).

#### [src/components/hr/editprofilepanel.tsx](src/components/hr/editprofilepanel.tsx)
- **Y adds** every Keka-parity column to the section state + onSave bodies + form fields:
  - **Basic** section grows: physicallyHandicapped + Family sub-section (Father / Mother / Spouse / Children) + read-only HRM No. chip ("read-only · also used as Attendance No.").
  - **Contact** section: homePhone + emergencyRelationship.
  - **Address** section retitled "Address (Current + Permanent)" — splits into current (Line1/Line2/City/State/Pincode/Country) + permanent (×6).
  - **Work Settings** section: attendanceCaptureScheme dropdown (On-Site/Remote/Hybrid) + costCenter + new help text "Convention: Attendance Number = HRM No.".
  - **Identity** section: removes "Parent's Name" (now part of Family), adds PF Number / UAN Number / Biometric ID (these are pre-filled from DB and editable; PAN/Aadhaar remain write-only).

#### [src/components/layout/sidebar.tsx](src/components/layout/sidebar.tsx)
- **F adds a `useEffect` on `pathname`** that closes every flyout (Me, My Team, Finances, MyPay, Dept, Feedback, Report) on navigation — fixes hover menus left dangling open after click-through. Y lacks this.

#### [src/components/notificationbell.tsx](src/components/notificationbell.tsx)
**F has a much richer NotificationBell** (~248 lines Y removes):
- `playNotificationSound()` — Web Audio "two-note bing" played when unread count goes up; persisted on/off via `localStorage("nbm:notif:sound")`.
- `splitNote(body)` helper — splits notifications on `\nNote: ` into intro + approver-comment, surfaces the comment in a styled note block.
- `NotifMenu` overflow component — Mute/Unmute sound + "Delete read" action with count badge and confirmation.
- Filter tabs: **All / Unread / Notes** with counts; "Notes" surfaces approver comments on leave/regularization decisions.
- Bell button styled blue with white ring; loads 20 items.

**Y's bell** is the simpler, older shape: bell loads 10 items, no sound, no "delete read", no Notes filter, just header with "Mark all as read" + plain item list. Bell button has neutral gray styling.

### 4.5 Library code

#### [src/lib/access.ts](src/lib/access.ts)
- `canSeeReports`: F gates on `orgLevel === "hr_manager"`, Y on `role === "hr_manager"`.
- `isPickableAsManager`: F includes `orgLevel === "ceo"`, `special_access`, `hr_manager`, plus `role === "admin"`. **Y excludes those** with the rationale that they VIEW reports but don't OWN any.

#### [src/lib/clickup/api-client.ts](src/lib/clickup/api-client.ts)
- F's `TARGET_SPACE_IDS` includes the QUATERNARY space `90166303898 // New Production 3D Documentry`. Y omits it.

#### [src/lib/clickup/sync-engine.ts](src/lib/clickup/sync-engine.ts)
The biggest sync delta:
- F imports `CUSTOM_FIELD_MAP` for user-typed custom-field traversal; Y doesn't.
- `syncSpaces()`: F always includes `TARGET_SPACE_IDS` plus admin-configured ones (the baseline can never be removed). **Y replaces** TARGET_SPACE_IDS entirely with whatever the admin selected, falling back to TARGET_SPACE_IDS only if empty.
- `upsertSubtaskFromClickup`: F syncs ALL subtask assignees into `SubtaskAssignee` join table (delete-many → upsert each). Y just upserts the subtask, no per-assignee join.
- `syncTasks`: F finds the EDITOR / WRITER user-type custom fields by hardcoded ID, collects every user, syncs them into `CaseEditorEntry` / `CaseWriterEntry` (raw SQL DELETE + INSERT ON CONFLICT DO NOTHING). It also collects every user from every user-type custom field and the assignees array, dedupes them via `seenClickupIds`, and upserts the union into `CaseAssignee`. Y just iterates `task.assignees` once and creates `CaseAssignee` rows; no editor/writer join sync.

#### [src/lib/cron-jobs-config.ts](src/lib/cron-jobs-config.ts)
- F's `CronJobState` has the optional `syncPastQuarters` field (used only by `youtube_dashboard`). Y doesn't.

#### [src/lib/cron-jobs-registry.ts](src/lib/cron-jobs-registry.ts)
- Job description text difference: F says **"7-day view buckets"** and "Enable 'Sync past quarters' to also refresh historical quarters"; Y says **"10-day view buckets"** with no past-quarter mention.

#### [src/lib/cron-jobs-runners.ts](src/lib/cron-jobs-runners.ts)
- F: `youtube_dashboard` runner reads `syncPastQuarters` from the job's config and passes it to `runYoutubeDashboardSync({syncPastQuarters})`, then calls `syncYoutubeStats()`.
- **Y**: `youtube_dashboard` just calls `runYoutubeDashboardSync()` with no opts and no follow-on `syncYoutubeStats()`.

#### [src/lib/hr/missed-attendance-emails.ts](src/lib/hr/missed-attendance-emails.ts)
- **Y adds**: weekend gate (`if dow === 0 || dow === 6 return 0`) so the cron doesn't blast Sat/Sun reminders. Also widens the leave filter from `status: "approved"` to `status: { in: ["approved", "partially_approved"] }` so stage-1-approved leaves also suppress the reminder.
- **F lacks** the weekend gate and the `partially_approved` widening.

#### [src/lib/youtube/channel-quarter-analysis.ts](src/lib/youtube/channel-quarter-analysis.ts)
- F: `buildWeeklyBuckets` (7-day windows, `+6 days`, advance by 7), each bucket persists `subscribersGained` alongside `views`, daily series read from BOTH `viewsMap` and `subsMap`.
- **Y**: `buildTenDayBuckets` (10-day windows, `+9 days`, advance by 10), no subscriber data.

#### [src/lib/youtube/youtube-analytics.ts](src/lib/youtube/youtube-analytics.ts)
- F's `DailyViewPoint = {day, views, subscribersGained}`; API request includes `metrics=views,subscribersGained`.
- **Y** drops `subscribersGained`. **F also exports `getChannelSubscriberCounts(ids)`** — batch fetches current subscriber counts for up to 50 channels via Data API; **Y removes that whole function**.

#### [src/lib/youtube/yt-dashboard-scheduler.ts](src/lib/youtube/yt-dashboard-scheduler.ts)
- Reminder time constants differ:
  - F: `CLOCK_IN_HOUR=10, CLOCK_IN_MIN=15, CLOCK_OUT_HOUR=20`. Comments say "fire AFTER the half-day cut-off".
  - Y: `CLOCK_IN_HOUR=10, CLOCK_IN_MIN=0, CLOCK_OUT_HOUR=19`. Comments say "Clock-OUT reminder fires at 19:00 IST — one hour after standard 6 PM end of shift".

#### [src/lib/youtube/yt-dashboard-sync.ts](src/lib/youtube/yt-dashboard-sync.ts)
- F: `runYoutubeDashboardSync(opts?: {syncPastQuarters?: boolean})` — when false (default), only current quarter. When true, last 5 years of quarters.
- Y: `runYoutubeDashboardSync()` — no opts; always uses `getQuarterKeysToRefreshOnSync(now, 5)` (last 5 years, fixed).

---

## 5. Migrations — divergence

| Migration | Side | Effect |
|---|---|---|
| `20260429120000_sync_missing_tables_to_prod` | F | Creates 18 HR-module tables + 2 enums in prod |
| `20260505120000_widen_subtask_tat` | F | Subtask.tat → DECIMAL(7,2) |
| `20260507120000_case_editor_writer_entries` | F | New `CaseEditorEntry` + `CaseWriterEntry` join tables |
| `20260506140000_violation_action_taken_file` | Y | Violation.actionTakenFileUrl + actionTakenFileName |
| `20260507100000_attendance_session_location` | Y | AttendanceSession.clockInLocation + clockOutLocation |
| `20260507150000_employee_profile_keka_parity` | Y | EmployeeProfile +21 Keka columns |
| `20260507150000_violation_file_blob` | Y | Violation.actionTakenFileBlob (BYTEA) + actionTakenFileMime |

> **F has Subtask `SubtaskAssignee` model in schema but no migration listed in only-in-F**. That's because F's `SubtaskAssignee` table was created in an earlier migration (`20260417000000_baseline` or similar) that exists in both copies. The model in Y's schema simply wasn't kept in sync after F added the `SubtaskAssignee` model in the .prisma file.

---

## 6. Files modified — pure CRLF only (317)

These differ byte-for-byte but have **zero functional change**. Most of `src/app/api/**`, `src/lib/**`, `src/components/**`, `src/app/dashboard/**`, every migration that's in both copies, and config files like `tsconfig.json`, `tailwind.config.ts`, `vercel.json`, `next.config.mjs`, `caddyfile`, `ecosystem.config.js` show "X insertions, X deletions" (every line removed and re-added) purely because **F is committed with LF endings, Y has CRLF**.

To eliminate this entire class of phantom diffs, run from F:

```powershell
git add --renormalize .
git commit -m "Normalize line endings to LF"
```

…or set `* text=auto eol=lf` in `.gitattributes` and renormalize, after which Y's CRLF files would be visible only on real divergences.

A copy of the full CRLF-only file list is at `%TEMP%\nb_eol_only.txt` (317 paths).

---

## 7. Quick recommendations

1. **Don't just merge Y over F or F over Y.** Each side has features the other genuinely lacks. The work is to *port-forward* the deltas in each direction.
2. **Likely high-value Y → F ports:** per-session attendance geo (migration + clock-in/out routes + UI), violation file attachments (BYTEA route + UI), Keka-parity employee profile columns (migration + onboard wizard step 5 + edit-profile panel), `SearchableSelect` component, two-step Clock-Out confirmation, weekend gate + `partially_approved` in missed-attendance reminders, year-bearing report URLs.
3. **Likely high-value F → Y ports:** CaseEditorEntry / CaseWriterEntry / SubtaskAssignee join tables (and their sync code), the cron `running` polling endpoint and 3s admin poll, NotificationBell sound + Notes filter + delete-read overflow, `getChannelSubscriberCounts` and the YT Studio 3-metric tabs, central `access.ts` helpers + their consumers, sidebar pathname-flyout-close `useEffect`, Subtask TAT widening migration.
4. **Conflict zones to resolve as a single decision:**
   - Reports / managers picker access: `role==="hr_manager"` (Y, strict) vs `orgLevel==="hr_manager"` (F, broad). Y's reasoning is correct and should win.
   - YT chart bucket size: 7-day weekly + subscribers (F) vs 10-day no subs (Y). F is the more capable version.
   - Mobile clock-in gate: present in F, removed in Y. Decide whether mobile clock-in should be allowed.
   - User DELETE: explicit cascade in F vs FK CASCADE in Y. F is safer on schemas without cascade rules.
5. **Repository hygiene:** normalize line endings before doing any merge or you will fight 317 phantom file diffs every time.
