// Default field config for the per-job Application Form. When a job
// opening doesn't have an explicit JobOpeningFieldConfig row for a
// (channel, fieldKey) pair, we fall back to whatever lives here.
// Keeping the seed in code (rather than rows) means new jobs don't
// need a row-insert step and the defaults can be tuned without a
// migration.

export type Channel =
  | "career_site"          // public /jobs page
  | "recruiter_sourcing"   // recruiter adds a candidate manually
  | "internal_job_posting" // intranet posting
  | "referral";            // employee referral form

export type Visibility = "required" | "optional" | "hidden";

export interface FieldDef {
  key: string;
  label: string;
  group: "Personal" | "Contact" | "Professional" | "Compensation" | "Documents" | "Other";
}

// All standard candidate fields, in display order. Order here is the
// default sortOrder when no override exists.
export const STANDARD_FIELDS: FieldDef[] = [
  { key: "first_name",         label: "First Name",         group: "Personal" },
  { key: "middle_name",        label: "Middle Name",        group: "Personal" },
  { key: "last_name",          label: "Last Name",          group: "Personal" },
  { key: "gender",             label: "Gender",             group: "Personal" },
  { key: "dob",                label: "Date of Birth",      group: "Personal" },

  { key: "email",              label: "Email",              group: "Contact" },
  { key: "phone",              label: "Phone",              group: "Contact" },
  { key: "address",            label: "Address",            group: "Contact" },
  { key: "linkedin_url",       label: "LinkedIn URL",       group: "Contact" },
  { key: "portfolio_url",      label: "Portfolio URL",      group: "Contact" },

  { key: "current_company",     label: "Current Company",     group: "Professional" },
  { key: "current_designation", label: "Current Designation", group: "Professional" },
  { key: "experience_years",    label: "Total Experience",    group: "Professional" },
  { key: "highest_education",   label: "Highest Education",   group: "Professional" },
  { key: "source",              label: "Source",              group: "Professional" },

  { key: "current_salary",  label: "Current Salary",  group: "Compensation" },
  { key: "expected_salary", label: "Expected Salary", group: "Compensation" },
  { key: "notice_period",   label: "Notice Period",   group: "Compensation" },

  { key: "resume",       label: "Resume",       group: "Documents" },
  { key: "cover_letter", label: "Cover Letter", group: "Documents" },
];

// Visibility default per (channel, fieldKey). Anything not listed
// defaults to "optional". Required ones are non-negotiable on every
// channel; recruiter sourcing relaxes some things since HR fills the
// form internally and may not have every detail yet.
const DEFAULT_VISIBILITY: Record<Channel, Record<string, Visibility>> = {
  career_site: {
    first_name: "required",
    last_name:  "required",
    email:      "required",
    phone:      "required",
    resume:     "required",
    middle_name: "optional",
    address: "optional",
    cover_letter: "optional",
  },
  recruiter_sourcing: {
    first_name: "required",
    last_name:  "required",
    email:      "required",
    phone:      "optional",
    resume:     "optional",
    middle_name: "hidden",
    address: "hidden",
    dob: "hidden",
    cover_letter: "hidden",
  },
  internal_job_posting: {
    first_name: "required",
    last_name:  "required",
    email:      "required",
    phone:      "required",
    resume:     "required",
    current_company: "hidden",
    current_designation: "optional",
  },
  referral: {
    first_name: "required",
    last_name:  "required",
    email:      "required",
    phone:      "required",
    resume:     "optional",
    cover_letter: "hidden",
  },
};

export function defaultVisibility(channel: Channel, fieldKey: string): Visibility {
  return DEFAULT_VISIBILITY[channel]?.[fieldKey] ?? "optional";
}

export const CHANNELS: { key: Channel; label: string }[] = [
  { key: "career_site",          label: "Career site" },
  { key: "recruiter_sourcing",   label: "Recruiter sourcing" },
  { key: "internal_job_posting", label: "Internal job posting" },
  { key: "referral",             label: "Referral" },
];

export const QUESTION_TYPES: { key: string; label: string }[] = [
  { key: "short_text",      label: "Short answer" },
  { key: "long_text",       label: "Long answer" },
  { key: "yes_no",          label: "Yes / No" },
  { key: "multiple_choice", label: "Multiple choice" },
  { key: "number",          label: "Number" },
  { key: "date",            label: "Date" },
  { key: "file",            label: "File upload" },
];
