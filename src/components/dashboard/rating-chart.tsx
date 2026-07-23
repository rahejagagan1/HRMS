"use client";

import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Area,
    AreaChart,
} from "recharts";

interface RatingDataPoint {
    month: string;
    rating: number;
}

export default function RatingChart({ data }: { data: RatingDataPoint[] }) {
    if (data.length === 0) {
        return (
            <div className="rounded-2xl bg-[#12122a] border border-white/5 p-6">
                <h3 className="text-sm font-medium text-white mb-4">Rating Trend</h3>
                <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
                    No rating data available
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-2xl bg-[#12122a] border border-white/5 p-6">
            <h3 className="text-sm font-medium text-white mb-4">Rating Trend</h3>
            <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data}>
                    <defs>
                        <linearGradient id="ratingGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis
                        dataKey="month"
                        tick={{ fill: "#64748b", fontSize: 11 }}
                        axisLine={{ stroke: "rgba(255,255,255,0.05)" }}
                        tickLine={false}
                    />
                    <YAxis
                        domain={[0, 5]}
                        tick={{ fill: "#64748b", fontSize: 11 }}
                        axisLine={{ stroke: "rgba(255,255,255,0.05)" }}
                        tickLine={false}
                    />
                    <Tooltip
                        contentStyle={{
                            backgroundColor: "#1a1a2e",
                            border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: "12px",
                            color: "#fff",
                            fontSize: "12px",
                        }}
                    />
                    <Area
                        type="monotone"
                        dataKey="rating"
                        stroke="#8b5cf6"
                        strokeWidth={2}
                        fill="url(#ratingGradient)"
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
