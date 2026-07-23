/**
 * Research Manager — Pipeline strength (RTC + FOIA task counts) and Case Rating averages from Researcher Space lists.
 *
 * Lists (per English month name, e.g. "March RTC Cases"):
 *   Folder "Ready To Cover 2026" → "{Month} RTC Cases"
 *   Folder "FOIA Worksheet 2026"   → "{Month} FOIA Cases"
 *   Same FOIA pitched folder (see env) → "{Month} FOIA Pitched Cases" (parent tasks; all statuses)
 *
 * Configure via env (defaults match your workspace):
 *   CLICKUP_RESEARCHER_SPACE_ID (default: 90165659312)
 *   RESEARCHER_RTC_FOLDER_NAME   (default: Ready To Cover 2026)
 *   RESEARCHER_FOIA_FOLDER_NAME  (default: FOIA Worksheet 2026)
 *   RESEARCHER_FOIA_PITCHED_FOLDER_NAME (optional; defaults to FOIA folder)
 */

import { clickupApi } from "./api-client";
import { parseCustomFields } from "./field-parser";

const MONTH_NAMES_EN = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

/**
 * Punctuation/spacing-insensitive match for ClickUp status labels.
 * Strips everything except a-z0-9 and compares (same rule for RTC and FOIA).
 * Examples: "Pre - approved", "Pre-approved", "PRE  APPROVED" → same key.
 */
function normKey(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function buildAllowedKeys(aliases: string[]): Set<string> {
    return new Set(aliases.map((a) => normKey(a)));
}

/** RTC list — Ready To Cover 2026 / "{Month} RTC Cases" */
const RTC_STATUS_ALIASES = [
    "Pre - approved",
    "Pre-approved",
    "Exclusive Received",
    "complete",
];

/**
 * FOIA list — FOIA Worksheet 2026 / "{Month} FOIA Cases"
 * Same normKey matching as RTC; includes spelling variants ClickUp may use.
 */
const FOIA_STATUS_ALIASES = [
    "Pre-approved",
    "Pre - approved",
    "Ready To Sent For Exl",
    "Ready To Sent For Excl",
    "In Progress",
    "Sent For Exclusive",
    "Danielle",
    "Partial Recieved",
    "Partial Received",
    "Fully Recieved",
    "Fully Received",
    "complete",
];

const RTC_STATUS_KEYS = buildAllowedKeys(RTC_STATUS_ALIASES);
const FOIA_STATUS_KEYS = buildAllowedKeys(FOIA_STATUS_ALIASES);

function statusMatchesPipeline(raw: string | undefined, keys: Set<string>): boolean {
    if (!raw) return false;
    return keys.has(normKey(raw));
}

function defaultSpaceId(): string {
    return process.env.CLICKUP_RESEARCHER_SPACE_ID?.trim() || "90165659312";
}

function rtcFolderName(): string {
    return process.env.RESEARCHER_RTC_FOLDER_NAME?.trim() || "Ready To Cover 2026";
}

function foiaFolderName(): string {
    return process.env.RESEARCHER_FOIA_FOLDER_NAME?.trim() || "FOIA Worksheet 2026";
}

function foiaPitchedFolderName(): string {
    return process.env.RESEARCHER_FOIA_PITCHED_FOLDER_NAME?.trim() || foiaFolderName();
}

function listNameForMonth(monthIndex0: number, kind: "RTC" | "FOIA" | "FOIA_PITCHED"): string {
    const monthName = MONTH_NAMES_EN[monthIndex0];
    if (kind === "RTC") return `${monthName} RTC Cases`;
    if (kind === "FOIA") return `${monthName} FOIA Cases`;
    return `${monthName} FOIA Pitched Cases`;
}

async function findFolderId(spaceId: string, folderName: string): Promise<string | null> {
    const res = await clickupApi<{ folders: { id: string; name: string }[] }>(
        `/space/${spaceId}/folder?archived=false`
    );
    const target = folderName.trim().toLowerCase();
    const hit = (res.folders || []).find((f) => (f.name || "").trim().toLowerCase() === target);
    return hit?.id ?? null;
}

async function findListIdByName(folderId: string, listName: string): Promise<string | null> {
    const res = await clickupApi<{ lists: { id: string; name: string }[] }>(
        `/folder/${folderId}/list?archived=false`
    );
    const target = listName.trim().toLowerCase();
    const hit = (res.lists || []).find((l) => (l.name || "").trim().toLowerCase() === target);
    return hit?.id ?? null;
}

async function fetchAllTasksInList(listId: string): Promise<any[]> {
    const all: any[] = [];
    let page = 0;
    const maxPages = 200;
    while (page < maxPages) {
        const res = await clickupApi<{ tasks: any[] }>(
            `/list/${listId}/task?subtasks=true&include_closed=true&page=${page}`
        );
        const tasks = res.tasks || [];
        if (tasks.length === 0) break;
        all.push(...tasks);
        if (tasks.length < 100) break;
        page++;
    }
    return all;
}

function pipelineParentTasks(tasks: any[], keys: Set<string>): any[] {
    return tasks.filter((t) => {
        if (t.parent) return false;
        const st = t.status?.status || "";
        return statusMatchesPipeline(st, keys);
    });
}

function countTasksWithStatuses(tasks: any[], keys: Set<string>): number {
    return pipelineParentTasks(tasks, keys).length;
}

/** Case Rating custom field (same mapping as sync / field-parser) — only pipeline-qualified parent tasks. */
function collectCaseRatingsForPipelineTasks(tasks: any[], keys: Set<string>): number[] {
    const ratings: number[] = [];
    for (const t of pipelineParentTasks(tasks, keys)) {
        const parsed = parseCustomFields(t.custom_fields || []);
        const r = parsed.caseRating;
        if (typeof r === "number" && !Number.isNaN(r)) ratings.push(r);
    }
    return ratings;
}

/** Top-level tasks only (dedicated month list = membership). */
function parentTasksOnly(tasks: any[]): any[] {
    return tasks.filter((t) => !t.parent);
}

/** Case Rating on all parent tasks in a list (FOIA Pitched month lists). */
function collectCaseRatingsAllParents(tasks: any[]): number[] {
    const ratings: number[] = [];
    for (const t of parentTasksOnly(tasks)) {
        const parsed = parseCustomFields(t.custom_fields || []);
        const r = parsed.caseRating;
        if (typeof r === "number" && !Number.isNaN(r)) ratings.push(r);
    }
    return ratings;
}

function averageOrNull(values: number[]): number | null {
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface ResearcherPipelineResult {
    rtc: number;
    foia: number;
    total: number;
    /** Parent tasks in "{Month} FOIA Pitched Cases" (ClickUp). */
    foiaPitched: number;
    /** Mean Case Rating among pipeline tasks in RTC list that have a numeric rating (null if none). */
    rtcCaseRatingAvg: number | null;
    /** Mean Case Rating among pipeline tasks in FOIA list that have a numeric rating (null if none). */
    foiaCaseRatingAvg: number | null;
    /** Mean Case Rating on parent tasks in pitched list (null if none). */
    foiaPitchedCaseRatingAvg: number | null;
    /** Mean Case Rating across RTC + FOIA pipeline-rated tasks and pitched-list rated parents (null if none). */
    caseRatingAvgCombined: number | null;
    monthLabel: string;
    rtcListName: string;
    foiaListName: string;
    foiaPitchedListName: string;
    error?: string;
}

const pipelineByMonth = new Map<string, Promise<ResearcherPipelineResult>>();

/**
 * Total RTC + FOIA pipeline tasks for the rating month (YYYY-MM) from ClickUp lists.
 * Cached per month for the lifetime of the process (batch rating runs).
 */
export function getResearcherPipelineCounts(monthPeriod: string): Promise<ResearcherPipelineResult> {
    let p = pipelineByMonth.get(monthPeriod);
    if (!p) {
        p = fetchResearcherPipelineCounts(monthPeriod);
        pipelineByMonth.set(monthPeriod, p);
    }
    return p;
}

async function fetchResearcherPipelineCounts(monthPeriod: string): Promise<ResearcherPipelineResult> {
    const parts = monthPeriod.split("-");
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    if (!year || !month || month < 1 || month > 12) {
        return {
            rtc: 0,
            foia: 0,
            total: 0,
            foiaPitched: 0,
            rtcCaseRatingAvg: null,
            foiaCaseRatingAvg: null,
            foiaPitchedCaseRatingAvg: null,
            caseRatingAvgCombined: null,
            monthLabel: monthPeriod,
            rtcListName: "",
            foiaListName: "",
            foiaPitchedListName: "",
            error: "Invalid month period",
        };
    }
    const monthIndex0 = month - 1;
    const rtcListName = listNameForMonth(monthIndex0, "RTC");
    const foiaListName = listNameForMonth(monthIndex0, "FOIA");
    const foiaPitchedListName = listNameForMonth(monthIndex0, "FOIA_PITCHED");

    const spaceId = defaultSpaceId();
    try {
        const rtcFolderId = await findFolderId(spaceId, rtcFolderName());
        const foiaFolderId = await findFolderId(spaceId, foiaFolderName());
        const pitchedFName = foiaPitchedFolderName();
        const foiaPitchedFolderId =
            foiaFolderId && pitchedFName.trim().toLowerCase() === foiaFolderName().trim().toLowerCase()
                ? foiaFolderId
                : await findFolderId(spaceId, pitchedFName);

        if (!rtcFolderId) {
            return {
                rtc: 0,
                foia: 0,
                total: 0,
                foiaPitched: 0,
                rtcCaseRatingAvg: null,
                foiaCaseRatingAvg: null,
                foiaPitchedCaseRatingAvg: null,
                caseRatingAvgCombined: null,
                monthLabel: MONTH_NAMES_EN[monthIndex0],
                rtcListName,
                foiaListName,
                foiaPitchedListName,
                error: `Folder not found: "${rtcFolderName()}" in space ${spaceId}`,
            };
        }
        if (!foiaFolderId) {
            return {
                rtc: 0,
                foia: 0,
                total: 0,
                foiaPitched: 0,
                rtcCaseRatingAvg: null,
                foiaCaseRatingAvg: null,
                foiaPitchedCaseRatingAvg: null,
                caseRatingAvgCombined: null,
                monthLabel: MONTH_NAMES_EN[monthIndex0],
                rtcListName,
                foiaListName,
                foiaPitchedListName,
                error: `Folder not found: "${foiaFolderName()}" in space ${spaceId}`,
            };
        }

        const rtcListId = await findListIdByName(rtcFolderId, rtcListName);
        const foiaListId = await findListIdByName(foiaFolderId, foiaListName);

        let rtc = 0;
        let foia = 0;
        let foiaPitched = 0;
        let rtcCaseRatingAvg: number | null = null;
        let foiaCaseRatingAvg: number | null = null;
        let foiaPitchedCaseRatingAvg: number | null = null;
        let caseRatingAvgCombined: number | null = null;

        let rtcRatings: number[] = [];
        let foiaRatings: number[] = [];
        let foiaPitchedRatings: number[] = [];

        if (rtcListId) {
            const tasks = await fetchAllTasksInList(rtcListId);
            rtc = countTasksWithStatuses(tasks, RTC_STATUS_KEYS);
            rtcRatings = collectCaseRatingsForPipelineTasks(tasks, RTC_STATUS_KEYS);
            rtcCaseRatingAvg = averageOrNull(rtcRatings);
        }
        if (foiaListId) {
            const tasks = await fetchAllTasksInList(foiaListId);
            foia = countTasksWithStatuses(tasks, FOIA_STATUS_KEYS);
            foiaRatings = collectCaseRatingsForPipelineTasks(tasks, FOIA_STATUS_KEYS);
            foiaCaseRatingAvg = averageOrNull(foiaRatings);
        }
        if (foiaPitchedFolderId) {
            const pitchedListId = await findListIdByName(foiaPitchedFolderId, foiaPitchedListName);
            if (pitchedListId) {
                const pTasks = await fetchAllTasksInList(pitchedListId);
                foiaPitched = parentTasksOnly(pTasks).length;
                foiaPitchedRatings = collectCaseRatingsAllParents(pTasks);
                foiaPitchedCaseRatingAvg = averageOrNull(foiaPitchedRatings);
            }
        }

        caseRatingAvgCombined = averageOrNull([...rtcRatings, ...foiaRatings, ...foiaPitchedRatings]);

        return {
            rtc,
            foia,
            total: rtc + foia,
            foiaPitched,
            rtcCaseRatingAvg,
            foiaCaseRatingAvg,
            foiaPitchedCaseRatingAvg,
            caseRatingAvgCombined,
            monthLabel: MONTH_NAMES_EN[monthIndex0],
            rtcListName,
            foiaListName,
            foiaPitchedListName,
            error:
                !rtcListId || !foiaListId
                    ? `Missing list(s): ${!rtcListId ? rtcListName : ""} ${!foiaListId ? foiaListName : ""}`.trim()
                    : undefined,
        };
    } catch (e: any) {
        console.error("[researcher-pipeline] ClickUp fetch failed:", e);
        return {
            rtc: 0,
            foia: 0,
            total: 0,
            foiaPitched: 0,
            rtcCaseRatingAvg: null,
            foiaCaseRatingAvg: null,
            foiaPitchedCaseRatingAvg: null,
            caseRatingAvgCombined: null,
            monthLabel: MONTH_NAMES_EN[monthIndex0],
            rtcListName,
            foiaListName,
            foiaPitchedListName,
            error: e?.message || String(e),
        };
    }
}
