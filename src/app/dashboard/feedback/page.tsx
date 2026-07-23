"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { canUseFeedback } from "@/lib/access";
import PopupPanel from "@/components/ui/PopupPanel";

const CATEGORIES = [
    {
        value: "people_team_dynamics",
        label: "People & Team Dynamics",
        definition: "Share anything about colleagues, managers, collaboration, or team experiences.",
    },
    {
        value: "work_culture_environment",
        label: "Work Culture & Environment",
        definition: "How you feel at work — culture, pressure, motivation, or overall vibe.",
    },
    {
        value: "ideas_improvements",
        label: "Ideas & Improvements",
        definition: "Suggestions, creative ideas, or ways we can do things better.",
    },
    {
        value: "processes_policies",
        label: "Processes & Policies",
        definition: "Thoughts on workflows, rules, attendance, or how things function.",
    },
    {
        value: "compensation_support",
        label: "Compensation & Support",
        definition: "Salary, reimbursements, or any financial/work support concerns.",
    },
    {
        value: "unfiltered_unsaid",
        label: "Unfiltered / Something Unsaid",
        definition: "For anything personal, sensitive, or something you haven’t been able to say openly.",
    },
    {
        value: "anything_else",
        label: "Anything Else",
        definition: "If it doesn’t fit anywhere else.",
    },
] as const;

export default function FeedbackPage() {
    const router = useRouter();
    const { data: session, status: sessionStatus } = useSession();
    // YT Labs users (CEO + all employees) can't use the Feedback form
    // — it's NB Media only. Mirror the sidebar gate so the page can't
    // be reached via direct URL or stale tab. Bounce to /dashboard.
    useEffect(() => {
        if (sessionStatus === "loading") return;
        if (!canUseFeedback(session?.user as any)) {
            router.replace("/dashboard");
        }
    }, [sessionStatus, session, router]);

    const [category, setCategory] = useState<string>("");
    const [message, setMessage] = useState("");
    const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
    const [error, setError] = useState<string | null>(null);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const selectedCategory = CATEGORIES.find((c) => c.value === category);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!category) {
            setError("Please choose a category");
            return;
        }
        setStatus("sending");
        try {
            const res = await fetch("/api/feedback", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category, message }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || "Could not send feedback");
                setStatus("error");
                return;
            }
            setStatus("done");
            setMessage("");
        } catch {
            setError("Network error — try again");
            setStatus("error");
        }
    };

    return (
        <div className="w-full flex flex-col items-center py-5 md:py-9 px-2 sm:px-6 bg-violet-50/50 dark:bg-transparent min-h-full">
            {status === "done" ? (
                <div className="w-full max-w-3xl rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm md:text-base text-emerald-800 dark:text-emerald-200 text-center">
                    Thank you — your anonymous feedback was submitted.
                </div>
            ) : (
                <form onSubmit={submit} className="w-full max-w-3xl space-y-4 md:space-y-5">
                    {/* Header card */}
                    <div className="rounded-xl border-2 border-violet-500/60 dark:border-violet-400/40 bg-white dark:bg-[#12122a] shadow-sm overflow-hidden">
                        <div className="h-2 bg-gradient-to-r from-violet-600 to-fuchsia-600" />
                        <div className="px-6 md:px-8 pt-6 md:pt-7 pb-5 md:pb-6">
                            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white mb-3">
                            NB Unplugged
                            </h1>
                            <p className="text-sm md:text-[0.95rem] text-slate-600 dark:text-slate-400 leading-relaxed">
                                Welcome to <span className="text-slate-900 dark:text-slate-200 font-semibold">NB Unplugged</span>—your{" "}
                                <span className="text-slate-900 dark:text-slate-200 font-semibold">100% anonymous</span> space. Your identity is not
                                attached to anything you share. Speak freely about anything on your mind—ideas, concerns, feedback,
                                appreciation, or thoughts about people, processes, or policies. Every submission is read with complete
                                confidentiality. Pick what feels closest—there&rsquo;s no right or wrong here.
                            </p>
                        </div>
                    </div>

                    {/* Category card */}
                    <div className="rounded-xl border-2 border-violet-500/60 dark:border-violet-400/40 bg-white dark:bg-[#12122a] shadow-sm px-6 md:px-8 py-5 md:py-6">
                        <label id="fb-category-label" className="block text-sm md:text-base font-semibold text-slate-900 dark:text-white mb-3">
                            Category <span className="text-rose-500">*</span>
                        </label>
                        <div ref={dropdownRef} className="relative">
                            <button
                                type="button"
                                aria-haspopup="listbox"
                                aria-expanded={dropdownOpen}
                                aria-labelledby="fb-category-label"
                                onClick={() => setDropdownOpen((o) => !o)}
                                className="w-full flex items-center justify-between gap-3 px-3.5 py-3 md:py-3.5 rounded-lg bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 text-left text-sm md:text-base focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 transition-colors"
                            >
                                <span className={selectedCategory ? "text-slate-900 dark:text-white" : "text-slate-400 dark:text-slate-500"}>
                                    {selectedCategory?.label ?? "Choose any category"}
                                </span>
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className={`h-4 w-4 text-slate-400 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                    aria-hidden="true"
                                >
                                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.24 4.38a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                                </svg>
                            </button>

                            <PopupPanel
                                open={dropdownOpen}
                                triggerRef={dropdownRef}
                                onClose={() => setDropdownOpen(false)}
                                maxHeight={352}
                                className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1a1a38] shadow-2xl overflow-y-auto"
                            >
                                <div role="listbox" aria-labelledby="fb-category-label">
                                    {CATEGORIES.map((c) => {
                                        const isSelected = c.value === category;
                                        return (
                                            <button
                                                key={c.value}
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                onClick={() => {
                                                    setCategory(c.value);
                                                    setDropdownOpen(false);
                                                    setError(null);
                                                }}
                                                className={`group w-full text-left px-4 py-3 border-b border-slate-100 dark:border-white/5 last:border-b-0 border-l-4 transition-colors ${
                                                    isSelected
                                                        ? "bg-violet-100 dark:bg-violet-500/15 border-l-violet-600"
                                                        : "border-l-transparent hover:bg-violet-50 dark:hover:bg-violet-500/10 hover:border-l-violet-400"
                                                }`}
                                            >
                                                <div className={`text-sm font-semibold transition-colors ${
                                                    isSelected
                                                        ? "text-violet-700 dark:text-violet-300"
                                                        : "text-slate-900 dark:text-white group-hover:text-violet-700 dark:group-hover:text-violet-300"
                                                }`}>
                                                    {c.label}
                                                </div>
                                                <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                                                    {c.definition}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </PopupPanel>
                        </div>
                        {selectedCategory && (
                            <p className="mt-3 text-xs md:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                                <span className="text-slate-700 dark:text-slate-300 font-medium">{selectedCategory.label}:</span>{" "}
                                {selectedCategory.definition}
                            </p>
                        )}
                    </div>

                    {/* Message card */}
                    <div className="rounded-xl border-2 border-violet-500/60 dark:border-violet-400/40 bg-white dark:bg-[#12122a] shadow-sm px-6 md:px-8 py-5 md:py-6">
                        <label htmlFor="fb-message" className="block text-sm md:text-base font-semibold text-slate-900 dark:text-white mb-3">
                            Your message <span className="text-rose-500">*</span>
                        </label>
                        <textarea
                            id="fb-message"
                            required
                            rows={8}
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="Your answer"
                            maxLength={8000}
                            className="w-full px-3.5 py-3 md:px-4 md:py-4 rounded-lg bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm md:text-base leading-relaxed placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 resize-y min-h-[200px] md:min-h-[240px]"
                        />
                        <p className="text-xs text-slate-400 mt-2 text-right">{message.length} / 8000</p>
                    </div>

                    {error && (
                        <div className="rounded-xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 px-5 py-3">
                            <p className="text-sm text-rose-700 dark:text-rose-400" role="alert">
                                {error}
                            </p>
                        </div>
                    )}

                    <div className="flex justify-center pt-1">
                        <button
                            type="submit"
                            disabled={status === "sending" || !message.trim() || !category}
                            className="w-full sm:w-auto min-w-[200px] px-8 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-sm md:text-base font-medium transition-all disabled:opacity-50 disabled:pointer-events-none shadow-sm"
                        >
                            {status === "sending" ? "Sending…" : "Submit feedback"}
                        </button>
                    </div>
                </form>
            )}

        </div>
    );
}
