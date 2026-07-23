// Access gate for the Missing Fields tool. Used by the sidebar nav item, the
// page guard, AND every API route so all three stay in sync. Visible to:
//   • developers (session isDeveloper, or the DEVELOPER_EMAILS env fallback), and
//   • an allowlist of designations (currently "Executive Assistant" — Palak
//     Dhiman's designation). Reads user.designation, added to the session in auth.ts.
// Add a designation here to grant the whole designation access (not by name).
const MF_ALLOWED_DESIGNATIONS = new Set(["executive assistant"]);

export function canUseMissingFields(user: any): boolean {
  if (!user) return false;
  if (user.isDeveloper === true) return true;
  const designation = String(user.designation || "").trim().toLowerCase();
  if (designation && MF_ALLOWED_DESIGNATIONS.has(designation)) return true;
  // Dev-email fallback (resolves server-side; undefined on the client, where the
  // isDeveloper / designation session fields already cover access).
  const allow = (process.env.DEVELOPER_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!user.email && allow.includes(String(user.email).toLowerCase());
}
