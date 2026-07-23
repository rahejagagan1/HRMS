// Canonical roster of department names HR can pick from anywhere in
// the app (onboarding wizard, employee profile edits, KPI manager).
// Curated 2026-05-19 per the latest NB Media org chart. Extend by
// appending; alphabetised inside the dropdown is handled by the
// consumer if needed.
//
// NOTE: existing employee rows may still hold the older department
// names ("AI Team", "Content Strategy & Research", "Production", …).
// They keep working — the People-page filter is discovered-only, so
// stored values still appear there. HR can re-categorise each employee
// via Edit Profile → Department dropdown (which now lists this set).
export const DEPARTMENTS = [
  "AI",
  "Editing",
  "Human Resource",
  "Management",
  "Packaging Team",
  "Quality Assurance",
  "Research",
  "Social Media",
  "Writing",
];
