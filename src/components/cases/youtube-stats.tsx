"use client";

import { formatNumber } from "@/lib/utils";
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";

interface YoutubeStatsProps {
    videoId: string;
    viewCount: string | number | null;
    likeCount: string | number | null;
    commentCount: string | number | null;
    last30DaysViews: string | number | null;
    publishedAt: string | null;
    history: Array<{ snapshotDate: string; viewCount: string | number }>;
}

export default function YoutubeStats({ videoId, viewCount, likeCount, commentCount, last30DaysViews: dbLast30, publishedAt, history }: YoutubeStatsProps) {
    const totalViews = Number(viewCount || 0);

    // Check if the video is still within the first 30 days since publish
    const publishedDate = publishedAt ? new Date(publishedAt) : null;
    const thirtyDaysAfterPublish = publishedDate ? new Date(publishedDate.getTime() + 30 * 24 * 60 * 60 * 1000) : null;
    const isWithinFirst30Days = thirtyDaysAfterPublish && new Date() <= thirtyDaysAfterPublish;

    // Calculate first 30 days views since publish
    const first30DaysViews = (() => {
        // If still within the first 30 days, all current views are first-30-day views
        if (isWithinFirst30Days) {
            return totalViews;
        }

        // For older videos, use the Analytics API value from the database
        if (dbLast30 !== null && dbLast30 !== undefined) {
            return Number(dbLast30);
        }

        return null;
    })();

    const publishDate = publishedAt
        ? new Date(publishedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
        : null;

    const chartData = history.map((h) => ({
        date: new Date(h.snapshotDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        views: Number(h.viewCount),
    }));

    return (
        <div className="space-y-4">
            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-slate-100 dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/5 p-4 text-center">
                    <p className="text-lg font-bold text-slate-800 dark:text-white">{publishDate || "—"}</p>
                    <p className="text-[11px] text-slate-500 mt-1">Published</p>
                </div>
                <div className="rounded-xl bg-slate-100 dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/5 p-4 text-center">
                    <p className="text-2xl font-bold text-slate-800 dark:text-white">
                        {first30DaysViews !== null
                            ? formatNumber(first30DaysViews)
                            : "—"}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">First 30 Days</p>
                </div>
                <div className="rounded-xl bg-slate-100 dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/5 p-4 text-center">
                    <p className="text-2xl font-bold text-slate-800 dark:text-white">{formatNumber(totalViews)}</p>
                    <p className="text-[11px] text-slate-500 mt-1">Total Views</p>
                </div>
            </div>

            {/* YouTube Embed */}
            <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-white/5">
                <iframe
                    src={`https://www.youtube.com/embed/${videoId}`}
                    className="w-full aspect-video"
                    allowFullScreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                />
            </div>

            {/* Views Chart */}
            {chartData.length > 1 && (
                <div className="rounded-xl bg-slate-100 dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/5 p-4">
                    <h4 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3">Daily Views</h4>
                    <ResponsiveContainer width="100%" height={160}>
                        <AreaChart data={chartData}>
                            <defs>
                                <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.3} />
                                    <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                            <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} />
                            <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: "#1a1a2e",
                                    border: "1px solid rgba(255,255,255,0.1)",
                                    borderRadius: "8px",
                                    color: "#fff",
                                    fontSize: "11px",
                                }}
                            />
                            <Area type="monotone" dataKey="views" stroke="#f43f5e" strokeWidth={2} fill="url(#viewsGrad)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}
