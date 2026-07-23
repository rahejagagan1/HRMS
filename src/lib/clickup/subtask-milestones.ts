/**
 * ClickUp subtask title rules shared by weekly reports and YouTube dashboard contribution.
 * Normalizes unicode dashes to ASCII hyphen for comparisons.
 */
export function normalizeSubtaskTitle(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/\u2013/g, "-")
        .replace(/\u2014/g, "-")
        .replace(/\s+/g, " ");
}

/** Editor: main task custom field sync uses "Editing - First Draft" (hyphen / en-dash). */
export function isEditingFirstDraftMilestone(name: string): boolean {
    return normalizeSubtaskTitle(name) === "editing - first draft";
}

/** Writer: first scripting draft (aligned with writer-cases weekly API). */
export function isWriterFirstDraftMilestone(name: string): boolean {
    const n = normalizeSubtaskTitle(name);
    return (
        (n.includes("script") && n.includes("first draft")) ||
        (n.includes("scripting") && n.includes("draft")) ||
        n === "scripting - first draft" ||
        n === "script first draft"
    );
}
