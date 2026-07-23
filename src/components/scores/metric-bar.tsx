"use client";

interface MetricBarProps {
    label: string;
    value: number | null;
    maxValue?: number;
    weight?: number;
    color?: string;
}

export default function MetricBar({
    label,
    value,
    maxValue = 5,
    weight,
    color = "violet",
}: MetricBarProps) {
    const percentage = value !== null ? (value / maxValue) * 100 : 0;
    const hasValue = value !== null && value !== undefined;

    const colorMap: Record<string, { bg: string; bar: string; text: string }> = {
        violet: { bg: "bg-violet-500/10", bar: "bg-gradient-to-r from-violet-500 to-fuchsia-500", text: "text-violet-400" },
        blue: { bg: "bg-blue-500/10", bar: "bg-gradient-to-r from-blue-500 to-cyan-500", text: "text-blue-400" },
        emerald: { bg: "bg-emerald-500/10", bar: "bg-gradient-to-r from-emerald-500 to-green-500", text: "text-emerald-400" },
        amber: { bg: "bg-amber-500/10", bar: "bg-gradient-to-r from-amber-500 to-orange-500", text: "text-amber-400" },
        rose: { bg: "bg-rose-500/10", bar: "bg-gradient-to-r from-rose-500 to-pink-500", text: "text-rose-400" },
        cyan: { bg: "bg-cyan-500/10", bar: "bg-gradient-to-r from-cyan-500 to-teal-500", text: "text-cyan-400" },
    };

    const colors = colorMap[color] || colorMap.violet;

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{label}</span>
                    {weight !== undefined && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-500">
                            {Math.round(weight * 100)}%
                        </span>
                    )}
                </div>
                <span className={`text-xs font-bold ${hasValue ? colors.text : "text-slate-600"}`}>
                    {hasValue ? value!.toFixed(2) : "—"}
                    <span className="text-slate-600 font-normal">/{maxValue}</span>
                </span>
            </div>
            <div className={`h-2 rounded-full ${colors.bg} overflow-hidden`}>
                {hasValue ? (
                    <div
                        className={`h-full rounded-full ${colors.bar} transition-all duration-700 ease-out`}
                        style={{ width: `${Math.min(percentage, 100)}%` }}
                    />
                ) : (
                    <div className="h-full rounded-full bg-slate-700/30 w-full" />
                )}
            </div>
        </div>
    );
}
