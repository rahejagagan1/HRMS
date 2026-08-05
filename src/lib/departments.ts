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
// 2026-08-05: extended with the departments already in live use on
// employee profiles / job postings (Production alone had 35 people but
// wasn't listed), plus Graphic Design for the design hires. The pickers
// that consume this list are comboboxes — HR can always type a custom
// department that isn't listed here.
export const DEPARTMENTS = [
  "AI",
  "Content Quality",
  "Content Strategy & Research",
  "Creative Design",
  "Creative Strategy",
  "Editing",
  "Graphic Design",
  "Human Resource",
  "IT",
  "Management",
  "Packaging Team",
  "Production",
  "Quality Assurance",
  "Research",
  "Social Media",
  "Writing",
];
