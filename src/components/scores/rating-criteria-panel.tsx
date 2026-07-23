/**
 * Shared “Rating Criteria” display (intro + star levels + bullet pointers)
 * — same visual language as manager_direct_rating in the manager rating form.
 */

export interface RatingCriteriaLevel {
    stars: number;
    bullets: string[];
}

export interface RatingCriteria {
    intro?: string;
    levels: RatingCriteriaLevel[];
    important_rule?: string;
}

export interface RatingCriteriaPanelProps {
    rating_criteria?: RatingCriteria | null;
    /** Shown when there is no structured criteria */
    description?: string | null;
    headerBorder: string;
    headerText: string;
}

export function RatingCriteriaPanel({
    rating_criteria,
    description,
    headerBorder,
    headerText,
}: RatingCriteriaPanelProps) {
    if (rating_criteria) {
        return (
            <div className="mt-3 space-y-2">
                {rating_criteria.intro && (
                    <p className="text-sm text-amber-400/90 flex items-start gap-1.5">
                        <span className="shrink-0">👉</span>
                        <span className="leading-relaxed">{rating_criteria.intro}</span>
                    </p>
                )}
                <div className={`rounded-xl border ${headerBorder} p-4`}>
                    <p className={`text-xs font-bold uppercase tracking-wide ${headerText} flex items-center gap-1 mb-3`}>
                        ⭐ Rating Criteria
                    </p>
                    <div className="space-y-3">
                        {rating_criteria.levels
                            .filter((level) => level.bullets.some((b) => b.trim() !== ""))
                            .map((level) => (
                                <div key={level.stars}>
                                    <div className="flex items-center gap-1 mb-1">
                                        {Array.from({ length: level.stars }).map((_, i) => (
                                            <svg key={i} className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                            </svg>
                                        ))}
                                        <span className="text-xs text-slate-500 ml-1">
                                            ({level.stars} star{level.stars > 1 ? "s" : ""})
                                        </span>
                                    </div>
                                    <ul className="space-y-1 ml-1">
                                        {level.bullets.map((bullet, bi) => (
                                            <li key={bi} className="text-sm text-slate-400 dark:text-slate-300 flex items-start gap-2">
                                                <span className="text-slate-500 mt-0.5 shrink-0">•</span>
                                                <span className="leading-relaxed">{bullet}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                    </div>
                </div>
                {rating_criteria.important_rule && (
                    <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                        <span className="text-amber-400 text-sm shrink-0">⚠️</span>
                        <div>
                            <p className="text-xs font-bold text-amber-400">Important Rule</p>
                            <p className="text-sm text-amber-300/80 mt-0.5 leading-relaxed">{rating_criteria.important_rule}</p>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    if (description) {
        return <p className="text-sm text-slate-400 mt-2 leading-relaxed">{description}</p>;
    }

    return null;
}
