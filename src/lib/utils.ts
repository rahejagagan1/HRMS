import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// BigInt serialization for JSON responses
export function serializeBigInt<T>(obj: T): T {
    return JSON.parse(
        JSON.stringify(obj, (_, value) =>
            typeof value === "bigint" ? value.toString() : value
        )
    );
}

// Delay helper for rate limiting
export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Average helper (ignores null/undefined/NaN values)
export function avg(values: (number | null | undefined)[]): number {
    const valid = values.filter(
        (v): v is number => v !== null && v !== undefined && !isNaN(v)
    );
    if (valid.length === 0) return 0;
    return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

// Format number for display
export function formatNumber(num: number | bigint | null | undefined): string {
    if (num === null || num === undefined) return "—";
    const n = typeof num === "bigint" ? Number(num) : num;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
}

// Date formatting
export function formatDate(date: Date | string | null | undefined): string {
    if (!date) return "—";
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

// Derive short name from ClickUp folder/list name
export function deriveShortName(name: string): string {
    // "01. CIA (NEW)" → "CIA"
    // "02. RAW6 (NEW)" → "RAW6"
    // "Production Dec 2025 To Jan 2026" → "Production Dec 2025 To Jan 2026"
    const match = name.match(/^\d+\.\s*(.+?)(?:\s*\(.*\))?$/);
    if (match) return match[1].trim();
    return name;
}

/**
 * Returns elapsed weekday hours between start and done, excluding
 * Saturdays and Sundays in IST (Asia/Kolkata).
 *
 * Implementation: walks the time range in IST-calendar-day chunks. For
 * each chunk, if the IST weekday is Mon–Fri (1–5), the chunk's hours
 * count; Sat/Sun chunks contribute 0. The IST anchor matters because
 * "is it the weekend?" is a wall-clock question — UTC Sunday 23:00 is
 * already Monday 04:30 IST and should count as a weekday.
 *
 * Public holidays are NOT skipped — only Sat/Sun. Add holiday lookup if
 * the business decides bank holidays shouldn't count either.
 *
 * Name kept for backwards-compat with all the existing callers; the
 * return value is hours (matches `formatTatDays`'s input).
 */
export function calcBusinessDaysTat(start: Date, done: Date): number {
    if (done <= start) return 0;

    const MS_PER_HOUR    = 1000 * 60 * 60;
    const IST_OFFSET_MS  = 330 * 60 * 1000; // UTC+5:30

    let total  = 0;
    let cursor = start.getTime();
    const end  = done.getTime();

    while (cursor < end) {
        // Project `cursor` into IST so getUTCDay() gives the IST weekday.
        const istWallClock = new Date(cursor + IST_OFFSET_MS);
        const istDow = istWallClock.getUTCDay(); // 0=Sun, 6=Sat

        // Start of next IST midnight, expressed as a UTC ms.
        const startOfNextIstDay =
            Date.UTC(
                istWallClock.getUTCFullYear(),
                istWallClock.getUTCMonth(),
                istWallClock.getUTCDate() + 1,
            ) - IST_OFFSET_MS;

        const chunkEnd = Math.min(end, startOfNextIstDay);
        if (istDow !== 0 && istDow !== 6) {
            total += (chunkEnd - cursor) / MS_PER_HOUR;
        }
        cursor = chunkEnd;
    }
    return total;
}

/**
 * Format a TAT value (in hours) for display.
 * e.g.  15   → "15h"
 *        26   → "1d 2h"
 *        24   → "1d"
 *         0.5 → "30m"
 */
export function formatTatDays(hours: number): string {
    if (hours <= 0) return "Same day";
    const totalMins = Math.round(hours * 60);
    if (totalMins < 60) return `${totalMins}m`;
    const totalHours = Math.floor(totalMins / 60);
    const mins       = totalMins % 60;
    if (totalHours < 24) return mins > 0 ? `${totalHours}h ${mins}m` : `${totalHours}h`;
    const days       = Math.floor(totalHours / 24);
    const remHours   = totalHours % 24;
    if (remHours === 0) return mins > 0 ? `${days}d ${mins}m` : `${days}d`;
    return mins > 0 ? `${days}d ${remHours}h ${mins}m` : `${days}d ${remHours}h`;
}

// Status color mapping
export function getStatusColor(status: string): string {
    const normalized = status.toLowerCase();
    if (normalized === "complete" || normalized === "published" || normalized === "done")
        return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    if (normalized.includes("progress") || normalized.includes("editing") || normalized.includes("scripting"))
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    if (normalized.includes("qa") || normalized.includes("review") || normalized.includes("check"))
        return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    if (normalized.includes("revision"))
        return "bg-purple-500/20 text-purple-400 border-purple-500/30";
    if (normalized === "to do" || normalized === "open")
        return "bg-slate-500/20 text-slate-400 border-slate-500/30";
    return "bg-slate-500/20 text-slate-400 border-slate-500/30";
}

// Channel color mapping
export function getChannelColor(channel: string | null): string {
    switch (channel) {
        case "M7":
            return "bg-red-500/20 text-red-400 border-red-500/30";
        case "M7CS":
            return "bg-orange-500/20 text-orange-400 border-orange-500/30";
        case "Bodycam":
            return "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
        case "3D Documentry":
            return "bg-violet-500/20 text-violet-400 border-violet-500/30";
        case "New Channel":
            return "bg-green-500/20 text-green-400 border-green-500/30";
        default:
            return "bg-slate-500/20 text-slate-400 border-slate-500/30";
    }
}
