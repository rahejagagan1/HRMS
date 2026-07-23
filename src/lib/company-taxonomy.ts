// Central helper for picking the right department / job-title list +
// the right OptionList listKey when rendering company-scoped dropdowns
// (Onboarding wizard, Edit Profile, /people/[id] edit modal).
//
// Reads from these primary signals (in priority order):
//   1. `form.numberSeries === "YT Labs Series"`     (onboarding)
//   2. `employee.employeeProfile.businessUnit`      (editing)
//   3. `employee.employeeProfile.legalEntity`        (fallback)
//
// The two brands keep physically-separate OptionList rows by using
// different listKey suffixes — so HR custom additions for YT Labs
// never bleed into the NB Media dropdown and vice-versa.

import { JOB_TITLES } from "./job-titles";
import { JOB_TITLES_YT_LABS } from "./job-titles-yt-labs";
import { DEPARTMENTS } from "./departments";
import { DEPARTMENTS_YT_LABS } from "./departments-yt-labs";

export type CompanyBrand = "nb_media" | "yt_labs";

/** Detect the brand from a Number-Series string (onboarding form). */
export function brandFromNumberSeries(numberSeries: string | null | undefined): CompanyBrand {
  return (numberSeries || "").trim().toLowerCase() === "yt labs series" ? "yt_labs" : "nb_media";
}

/** Detect the brand from a businessUnit / legalEntity string (editing). */
export function brandFromBusinessUnit(
  businessUnit: string | null | undefined,
  legalEntity?: string | null | undefined,
): CompanyBrand {
  const bu = (businessUnit || "").trim().toLowerCase();
  if (bu === "yt labs") return "yt_labs";
  const le = (legalEntity || "").trim().toLowerCase();
  if (le === "yt labs") return "yt_labs";
  return "nb_media";
}

/** Defaults + OptionList listKey for the Job Title dropdown. */
export function jobTitleSource(brand: CompanyBrand) {
  return brand === "yt_labs"
    ? { listKey: "jobTitle_yt_labs", defaults: JOB_TITLES_YT_LABS }
    : { listKey: "jobTitle",         defaults: JOB_TITLES };
}

/** Defaults + OptionList listKey for the Department dropdown. */
export function departmentSource(brand: CompanyBrand) {
  return brand === "yt_labs"
    ? { listKey: "department_yt_labs", defaults: DEPARTMENTS_YT_LABS }
    : { listKey: "department",         defaults: DEPARTMENTS };
}
