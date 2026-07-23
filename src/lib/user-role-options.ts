/**
 * Single source of truth for UserRole enum labels (Prisma schema).
 * Use these for every role <select> so new roles cannot be omitted from the UI.
 */
export const USER_ROLE_OPTIONS: { value: string; label: string }[] = [
    { value: "admin", label: "Admin" },
    { value: "manager", label: "Manager" },
    { value: "lead", label: "Lead" },
    { value: "sub_lead", label: "Sub Lead" },
    { value: "writer", label: "Writer" },
    { value: "editor", label: "Editor" },
    { value: "graphic_designer", label: "Graphic Designer" },
    { value: "qa", label: "QA" },
    { value: "researcher", label: "Researcher" },
    { value: "gc", label: "GC" },
    { value: "vo_artist", label: "VO Artist" },
    { value: "publisher", label: "Publisher" },
    { value: "production_manager", label: "Production Manager" },
    { value: "hr_manager", label: "HR Manager" },
    { value: "researcher_manager", label: "Research Manager" },
    { value: "member", label: "Member" },
];

const ROLE_LABEL_BY_VALUE = Object.fromEntries(USER_ROLE_OPTIONS.map((o) => [o.value, o.label]));

/** Human-readable label for a User.role value (falls back to raw value). */
export function getUserRoleLabel(role: string | null | undefined): string {
    if (!role) return "—";
    return ROLE_LABEL_BY_VALUE[role] ?? role;
}
