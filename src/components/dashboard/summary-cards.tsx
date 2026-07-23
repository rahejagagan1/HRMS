"use client";

import { cn, formatNumber } from "@/lib/utils";

interface SummaryCard {
    title: string;
    value: string | number;
    subtitle?: string;
    change?: string;
    trend?: "up" | "down" | "neutral";
    icon: React.ReactNode;
    gradient: string;
}

export default function SummaryCards({ cards }: { cards: SummaryCard[] }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {cards.map((card, i) => (
                <div
                    key={i}
                    className="relative overflow-hidden rounded-2xl bg-[#12122a] border border-white/5 p-5 group hover:border-white/10 transition-all duration-300"
                >
                    {/* Gradient glow */}
                    <div className={cn("absolute -top-12 -right-12 w-32 h-32 rounded-full blur-3xl opacity-20 group-hover:opacity-30 transition-opacity", card.gradient)} />

                    <div className="relative flex items-start justify-between">
                        <div>
                            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">
                                {card.title}
                            </p>
                            <p className="text-2xl font-bold text-white mt-1">
                                {typeof card.value === "number" ? formatNumber(card.value) : card.value}
                            </p>
                            {card.subtitle && (
                                <p className="text-xs text-slate-500 mt-1">{card.subtitle}</p>
                            )}
                            {card.change && (
                                <div className={cn(
                                    "flex items-center gap-1 mt-2 text-xs font-medium",
                                    card.trend === "up" ? "text-emerald-400" : card.trend === "down" ? "text-red-400" : "text-slate-400"
                                )}>
                                    {card.trend === "up" && "↑"}
                                    {card.trend === "down" && "↓"}
                                    {card.change}
                                </div>
                            )}
                        </div>
                        <div className={cn("p-2.5 rounded-xl bg-gradient-to-br opacity-80", card.gradient)}>
                            {card.icon}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
