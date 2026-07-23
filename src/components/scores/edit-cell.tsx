"use client";

import { useState } from "react";

interface EditCellProps {
    value: string | number | null;
    fieldName: string;
    monthlyRatingId: number;
    onSave: (monthlyRatingId: number, fieldName: string, newValue: string) => Promise<void>;
    type?: "number" | "text";
}

export default function EditCell({ value, fieldName, monthlyRatingId, onSave, type = "number" }: EditCellProps) {
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState(String(value ?? ""));
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        if (editValue === String(value ?? "")) {
            setEditing(false);
            return;
        }
        setSaving(true);
        try {
            await onSave(monthlyRatingId, fieldName, editValue);
            setEditing(false);
        } catch (err) {
            console.error("Save failed:", err);
        } finally {
            setSaving(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") handleSave();
        if (e.key === "Escape") {
            setEditValue(String(value ?? ""));
            setEditing(false);
        }
    };

    if (editing) {
        return (
            <div className="flex items-center gap-1">
                <input
                    type={type}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleSave}
                    autoFocus
                    step="0.01"
                    className="w-20 px-2 py-1 text-xs bg-[#1a1a35] border border-violet-500/40 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                />
                {saving && (
                    <svg className="w-3 h-3 animate-spin text-violet-400" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                )}
            </div>
        );
    }

    return (
        <span
            onClick={() => setEditing(true)}
            className="cursor-pointer hover:bg-violet-500/10 px-2 py-1 rounded-lg transition-colors text-xs group inline-flex items-center gap-1"
            title="Click to edit"
        >
            {value !== null && value !== undefined ? value : "—"}
            <svg className="w-3 h-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
        </span>
    );
}
