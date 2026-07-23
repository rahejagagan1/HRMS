"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import SummaryCards from "@/components/dashboard/summary-cards";
import CasesTable from "@/components/dashboard/cases-table";

export default function TeamDashboardPage() {
    const params = useParams();
    const capsuleId = params.capsuleId as string;
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`/api/dashboard/team/${capsuleId}`)
            .then((res) => res.json())
            .then(setData)
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [capsuleId]);

    if (loading) {
        return (
            <div className="space-y-6">
                <div className="h-8 w-48 rounded bg-white/5 animate-pulse" />
                <div className="grid grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-28 rounded-2xl bg-[#12122a] border border-white/5 animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    const kpis = data?.kpis || {};

    const cards = [
        {
            title: "Total Cases",
            value: kpis.totalCases || 0,
            gradient: "from-violet-500 to-fuchsia-500",
            icon: <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
        },
        {
            title: "Active",
            value: kpis.activeCases || 0,
            gradient: "from-blue-500 to-cyan-500",
            icon: <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>,
        },
        {
            title: "Published",
            value: kpis.publishedThisMonth || 0,
            gradient: "from-emerald-500 to-green-500",
            icon: <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>,
        },
        {
            title: "Team Members",
            value: data?.members?.length || 0,
            gradient: "from-amber-500 to-orange-500",
            icon: <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
        },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white">
                    {data?.capsule?.shortName || data?.capsule?.name || "Team"} Dashboard
                </h1>
                <p className="text-sm text-slate-500 mt-1">Team performance & pipeline overview</p>
            </div>

            <SummaryCards cards={cards} />

            {/* Team Members */}
            <div className="rounded-2xl bg-[#12122a] border border-white/5 overflow-hidden">
                <div className="px-5 py-4 border-b border-white/5">
                    <h3 className="text-sm font-medium text-white">Team Members</h3>
                </div>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-white/5">
                            <th className="text-left px-5 py-3 text-[11px] uppercase tracking-wider text-slate-500 font-medium">Name</th>
                            <th className="text-left px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500 font-medium">Role</th>
                            <th className="text-right px-5 py-3 text-[11px] uppercase tracking-wider text-slate-500 font-medium">Rating</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(data?.members || []).map((member: any) => (
                            <tr key={member.id} className="border-b border-white/[0.02] hover:bg-white/[0.02]">
                                <td className="px-5 py-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/40 to-fuchsia-500/40 flex items-center justify-center text-xs text-white font-medium">
                                            {member.name.charAt(0)}
                                        </div>
                                        <span className="text-white">{member.name}</span>
                                    </div>
                                </td>
                                <td className="px-3 py-3 text-slate-400 text-xs capitalize">{member.role}</td>
                                <td className="px-5 py-3 text-right text-white font-mono text-xs">
                                    {member.monthlyRatings?.[0]?.overallRating
                                        ? Number(member.monthlyRatings[0].overallRating).toFixed(2)
                                        : "—"}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Cases */}
            <div>
                <h3 className="text-sm font-medium text-white mb-3">Team Cases</h3>
                <CasesTable cases={data?.cases || []} />
            </div>
        </div>
    );
}
