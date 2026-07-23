"use client";

import { formatNumber, getStatusColor, getChannelColor } from "@/lib/utils";
import Link from "next/link";

interface CaseRow {
    id: number;
    name: string;
    status: string;
    channel: string | null;
    hasDeepSubtasks?: boolean;
    writer?: { name: string } | null;
    editor?: { name: string } | null;
    youtubeStats?: { viewCount: string | number | null } | null;
    productionList?: { name: string; capsule?: { shortName: string | null } | null } | null;
}

export default function CasesTable({ cases }: { cases: CaseRow[] }) {
    return (
        <div className="rounded-2xl bg-[#12122a] border border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-sm table-fixed">
                    <thead>
                        <tr className="border-b border-white/[0.06]">
                            <th className="text-left pl-6 pr-4 py-4 text-[11px] uppercase tracking-wider text-slate-500 font-semibold w-[28%]">Case</th>
                            <th className="text-left px-4 py-4 text-[11px] uppercase tracking-wider text-slate-500 font-semibold w-[11%]">Status</th>
                            <th className="text-left px-4 py-4 text-[11px] uppercase tracking-wider text-slate-500 font-semibold w-[11%]">Channel</th>
                            <th className="text-left px-4 py-4 text-[11px] uppercase tracking-wider text-slate-500 font-semibold w-[16%]">Capsule</th>
                            <th className="text-left px-4 py-4 text-[11px] uppercase tracking-wider text-slate-500 font-semibold w-[13%]">Writer</th>
                            <th className="text-left px-4 py-4 text-[11px] uppercase tracking-wider text-slate-500 font-semibold w-[13%]">Editor</th>
                            <th className="text-right pr-6 pl-4 py-4 text-[11px] uppercase tracking-wider text-slate-500 font-semibold w-[8%]">Views</th>
                        </tr>
                    </thead>
                    <tbody>
                        {cases.map((c) => (
                            <tr
                                key={c.id}
                                className={
                                    c.hasDeepSubtasks
                                        ? "border-b border-amber-500/30 bg-amber-500/[0.08] hover:bg-amber-500/[0.14] transition-colors group"
                                        : "border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors group"
                                }
                            >
                                <td className="pl-6 pr-4 py-4">
                                    <Link
                                        href={`/cases/${c.id}`}
                                        className={
                                            c.hasDeepSubtasks
                                                ? "text-amber-200 text-[13px] font-medium hover:text-amber-100 transition-colors line-clamp-1 block"
                                                : "text-white text-[13px] font-medium hover:text-violet-400 transition-colors line-clamp-1 block"
                                        }
                                        title={c.hasDeepSubtasks ? "This case has a sub-subtask in ClickUp (level 3+). Schema stores only 2 levels — clean up in ClickUp to remove the flag." : undefined}
                                    >
                                        {c.hasDeepSubtasks && (
                                            <span className="inline-flex items-center mr-2 px-1.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-200 text-[10px] font-semibold uppercase tracking-wider">
                                                Deep
                                            </span>
                                        )}
                                        {c.name}
                                    </Link>
                                </td>
                                <td className="px-4 py-4">
                                    <span className={`inline-flex items-center px-2.5 py-1 text-[11px] font-medium rounded-lg border ${getStatusColor(c.status)}`}>
                                        {c.status}
                                    </span>
                                </td>
                                <td className="px-4 py-4">
                                    {c.channel ? (
                                        <span className={`inline-flex items-center px-2.5 py-1 text-[11px] font-medium rounded-lg border ${getChannelColor(c.channel)}`}>
                                            {c.channel}
                                        </span>
                                    ) : <span className="text-slate-600 text-xs">—</span>}
                                </td>
                                <td className="px-4 py-4 text-slate-400 text-xs">
                                    <span className="line-clamp-1" title={c.productionList?.name || ""}>
                                        {c.productionList?.name || "—"}
                                    </span>
                                </td>
                                <td className="px-4 py-4 text-xs">
                                    {c.writer?.name
                                        ? <span className="text-slate-300">{c.writer.name}</span>
                                        : <span className="text-slate-600">—</span>
                                    }
                                </td>
                                <td className="px-4 py-4 text-xs">
                                    {c.editor?.name
                                        ? <span className="text-slate-300">{c.editor.name}</span>
                                        : <span className="text-slate-600">—</span>
                                    }
                                </td>
                                <td className="pr-6 pl-4 py-4 text-right text-white font-mono text-xs">
                                    {c.youtubeStats?.viewCount
                                        ? formatNumber(Number(c.youtubeStats.viewCount))
                                        : <span className="text-slate-600">—</span>}
                                </td>
                            </tr>
                        ))}
                        {cases.length === 0 && (
                            <tr>
                                <td colSpan={7} className="px-6 py-16 text-center text-slate-500 text-sm">
                                    No cases found
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
