"use client";

interface AuditBadgeProps {
    editorName: string;
    editedAt: string;
    oldValue?: string;
    newValue?: string;
}

export default function AuditBadge({ editorName, editedAt, oldValue, newValue }: AuditBadgeProps) {
    const date = new Date(editedAt);
    const formattedDate = date.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
    const formattedTime = date.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
    });

    return (
        <div className="flex items-center gap-1.5 mt-1">
            <svg className="w-3 h-3 text-amber-500/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span className="text-[10px] text-amber-500/80 italic">
                Edited by {editorName}
                {oldValue && newValue && (
                    <span className="text-slate-500"> ({oldValue} → {newValue})</span>
                )}
                <span className="text-slate-600"> • {formattedDate} {formattedTime}</span>
            </span>
        </div>
    );
}
