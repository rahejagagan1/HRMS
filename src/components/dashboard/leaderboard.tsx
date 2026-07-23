"use client";

interface LeaderEntry {
    user: { name: string; profilePictureUrl?: string | null };
    overallRating: number | string | null;
    casesCompleted: number;
    rankInRole?: number | null;
}

export default function Leaderboard({
    title,
    entries,
}: {
    title: string;
    entries: LeaderEntry[];
}) {
    return (
        <div className="rounded-2xl bg-[#12122a] border border-white/5 p-5">
            <h3 className="text-sm font-medium text-white mb-4">{title}</h3>
            <div className="space-y-2">
                {entries.map((entry, i) => (
                    <div
                        key={i}
                        className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-white/[0.03] transition-colors"
                    >
                        {/* Rank */}
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${i === 0 ? "bg-amber-500/20 text-amber-400" :
                                i === 1 ? "bg-slate-400/20 text-slate-300" :
                                    i === 2 ? "bg-orange-600/20 text-orange-400" :
                                        "bg-white/5 text-slate-500"
                            }`}>
                            {i + 1}
                        </div>

                        {/* Avatar */}
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/40 to-fuchsia-500/40 flex items-center justify-center text-white text-xs font-medium">
                            {entry.user.name.charAt(0).toUpperCase()}
                        </div>

                        {/* Name */}
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate">{entry.user.name}</p>
                            <p className="text-[11px] text-slate-500">{entry.casesCompleted} cases</p>
                        </div>

                        {/* Rating */}
                        <div className="text-right">
                            <p className="text-sm font-semibold text-white">
                                {entry.overallRating ? Number(entry.overallRating).toFixed(2) : "—"}
                            </p>
                        </div>
                    </div>
                ))}
                {entries.length === 0 && (
                    <p className="text-sm text-slate-500 text-center py-6">No ratings yet</p>
                )}
            </div>
        </div>
    );
}
