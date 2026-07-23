// YT Labs-side canonical department roster. Kept physically separate
// from src/lib/departments.ts so the two brands don't share a single
// dropdown — picking YT Labs Series during onboarding (or editing a
// YT Labs employee) swaps the Department options to this set.
//
// Source: YT Labs org sheet provided 2026-05-27. The `YT_` prefix is
// intentional — it mirrors how the YT Labs team labels their teams in
// their own tooling. "HR Operations & TA" stays unprefixed because
// it's shared across both brands.
export const DEPARTMENTS_YT_LABS = [
  "HR Operations & TA",
  "YT_Content Strategy & Research",
  "YT_Creative Video Editing",
  "YT_Creative Writing",
  "YT_Executive Leadership Team",
  "YT_Operations",
  "YT_Production",
  "YT_Quality Assurance",
  "YT_Research",
];
