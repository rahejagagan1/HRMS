"use client";

import { getStatusColor, formatDate, calcBusinessDaysTat, formatTatDays } from "@/lib/utils";

interface SubtaskAssigneeEntry {
    user: { id: number; name: string; profilePictureUrl?: string | null };
}

interface SubtaskData {
    id: number;
    name: string;
    status: string;
    statusType?: string | null;
    startDate?: string | null;
    dueDate?: string | null;
    dateDone?: string | null;
    tat?: number | string | null;
    assignee?: { name: string; profilePictureUrl?: string | null } | null;
    assignees?: SubtaskAssigneeEntry[] | null;
}

function resolveTat(subtask: SubtaskData): string | null {
    // 1. Use stored DB value if available (populated by sync engine)
    if (subtask.tat !== null && subtask.tat !== undefined) {
        const n = Number(subtask.tat);
        if (!isNaN(n)) return formatTatDays(n);
    }
    // 2. Fallback: calculate on the fly from dates
    if (!subtask.startDate || !subtask.dateDone) return null;
    const s = new Date(subtask.startDate);
    const d = new Date(subtask.dateDone);
    if (isNaN(s.getTime()) || isNaN(d.getTime()) || d < s) return null;
    return formatTatDays(calcBusinessDaysTat(s, d));
}

export default function SubtaskTimeline({ subtasks }: { subtasks: SubtaskData[] }) {
    return (
        <div className="space-y-1">
            {subtasks.map((subtask, i) => {
                const isDone = subtask.statusType === "closed";
                const isLast = i === subtasks.length - 1;
                const tat = resolveTat(subtask);

                return (
                    <div key={subtask.id} className="flex gap-4">
                        {/* Timeline line */}
                        <div className="flex flex-col items-center">
                            <div className={`w-3 h-3 rounded-full border-2 mt-1.5 ${isDone
                                ? "bg-emerald-500 border-emerald-500"
                                : subtask.status === "in progress"
                                    ? "bg-blue-500 border-blue-500 animate-pulse"
                                    : "bg-transparent border-slate-600"
                                }`} />
                            {!isLast && (
                                <div className={`w-px flex-1 min-h-[2rem] ${isDone ? "bg-emerald-500/30" : "bg-slate-200 dark:bg-white/5"}`} />
                            )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 pb-4">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm text-slate-800 dark:text-white font-medium">{subtask.name}</span>
                                <span className={`inline-flex px-2 py-0.5 text-[10px] font-medium rounded-md border ${getStatusColor(subtask.status)}`}>
                                    {subtask.status}
                                </span>
                            </div>

                            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                {(() => {
                                    const people = subtask.assignees && subtask.assignees.length > 0
                                        ? subtask.assignees.map(a => a.user)
                                        : subtask.assignee ? [subtask.assignee] : [];
                                    return people.map((person, idx) => (
                                        <span key={idx} className="flex items-center gap-1 text-[11px] text-slate-500">
                                            {person.profilePictureUrl ? (
                                                <img src={person.profilePictureUrl} alt="" referrerPolicy="no-referrer" className="w-4 h-4 rounded-full object-cover" />
                                            ) : (
                                                <span className="w-4 h-4 rounded-full bg-violet-500/30 flex items-center justify-center text-[8px] text-violet-300">
                                                    {person.name.charAt(0)}
                                                </span>
                                            )}
                                            {person.name}
                                        </span>
                                    ));
                                })()}
                                {subtask.startDate && (
                                    <span className="text-[11px] text-slate-500">
                                        <span className="text-slate-600">Start:</span> {formatDate(subtask.startDate)}
                                    </span>
                                )}
                                {subtask.dateDone && (
                                    <span className="text-[11px] text-slate-500">
                                        <span className="text-slate-600">Done:</span> {formatDate(subtask.dateDone)}
                                    </span>
                                )}
                                {tat && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${isDone
                                        ? "bg-blue-500/10 text-blue-500 border border-blue-500/20"
                                        : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                                        }`}>
                                        TAT: {tat}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
            {subtasks.length === 0 && (
                <p className="text-sm text-slate-500 py-4">No subtasks found — run a ClickUp sync to populate subtasks</p>
            )}
        </div>
    );
}
