"use client";

interface LoadingSpinnerProps {
    size?: "sm" | "md" | "lg";
    text?: string;
    fullPage?: boolean;
}

const sizeMap = {
    sm: "w-5 h-5",
    md: "w-8 h-8",
    lg: "w-12 h-12",
};

export default function LoadingSpinner({
    size = "md",
    text,
    fullPage = false,
}: LoadingSpinnerProps) {
    const spinner = (
        <div className="flex flex-col items-center justify-center gap-3">
            <div className="relative">
                {/* Outer glow ring */}
                <div
                    className={`${sizeMap[size]} rounded-full border-2 border-violet-500/20 animate-ping absolute inset-0`}
                    style={{ animationDuration: "1.5s" }}
                />
                {/* Main spinner */}
                <svg
                    className={`${sizeMap[size]} animate-spin`}
                    viewBox="0 0 24 24"
                    fill="none"
                >
                    <circle
                        className="opacity-20"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="3"
                    />
                    <path
                        className="text-violet-500"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        fill="currentColor"
                    />
                </svg>
            </div>
            {text && (
                <p className="text-sm text-slate-400 animate-pulse">{text}</p>
            )}
        </div>
    );

    if (fullPage) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                {spinner}
            </div>
        );
    }

    return spinner;
}

/**
 * Skeleton block for content loading states
 */
export function Skeleton({
    className = "",
    children,
}: {
    className?: string;
    children?: React.ReactNode;
}) {
    return (
        <div
            className={`rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse ${className}`}
        >
            {children}
        </div>
    );
}

/**
 * Dashboard skeleton with summary cards + content area
 */
export function DashboardSkeleton({ cards = 4 }: { cards?: number }) {
    return (
        <div className="space-y-6">
            <div className={`grid grid-cols-${cards} gap-4`}>
                {Array.from({ length: cards }).map((_, i) => (
                    <Skeleton key={i} className="h-28" />
                ))}
            </div>
            <Skeleton className="h-64" />
            <Skeleton className="h-48" />
        </div>
    );
}
