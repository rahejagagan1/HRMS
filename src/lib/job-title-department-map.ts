// Smart Title → Department resolver for the hiring "+ New Job" modal.
// Given a job title (and which brand it belongs to), returns the most
// likely department so the form can auto-fill that field. HR can
// still override the department afterwards if the guess is wrong.
//
// Two-stage match:
//   1. Explicit map — every canonical title in src/lib/job-titles*.ts
//      is mapped to its department here. Wins when the title matches
//      exactly (case-insensitive).
//   2. Keyword fallback — if a title isn't in the explicit map (e.g.
//      a custom one HR added via "+ Add custom value"), we look for
//      keywords in the title ("editor", "writer", "designer", "QA",
//      "research") and route based on that. Returns null if nothing
//      matches — HR picks manually.

import { DEPARTMENTS } from "./departments";
import { DEPARTMENTS_YT_LABS } from "./departments-yt-labs";

// ── NB Media: title → department ───────────────────────────────────
// Department names match src/lib/departments.ts exactly. If you add a
// new canonical title to job-titles.ts, add its mapping here too.
const NB_MEDIA_MAP: Record<string, string> = {
  "AI":                                       "AI",
  "Artificial Intelligence Intern":           "AI",

  "Associate Graphic Designer":               "Social Media",
  "Graphic Designer":                         "Social Media",
  "Sr. Graphic Designer & Content Strategist":"Social Media",
  "Social Media Content Strategist":          "Social Media",
  "Social Media Strategist":                  "Social Media",
  "Social Media Manager":                     "Social Media",
  "Social Media Executive":                   "Social Media",
  "Community Manager":                        "Social Media",

  "Associate Script Writer":                  "Writing",
  "Script Writer":                            "Writing",
  "Sr. Script Writer":                        "Writing",

  "Associate Video Editor":                   "Editing",
  "Video Editor":                             "Editing",
  "Sr. Video Editor":                         "Editing",
  "Video Editor and Spotify Content Strategist": "Editing",

  "Content Researcher":                       "Research",
  "Sr. Content Researcher":                   "Research",

  "Brand Face and Strategist":                "Management",
  "Content Strategist":                       "Management",
  "Content Team Lead":                        "Management",
  "Executive Assistant":                      "Management",

  "HR Manager":                               "Human Resource",
  "Talent Acquisition Specialist":            "Human Resource",

  "Head - Quality Assurance":                 "Quality Assurance",
  "Content Quality Assurance Specialist":     "Quality Assurance",
  "Content Review & Quality Associate":       "Quality Assurance",
  "Script Quality Assurance Associate":       "Quality Assurance",
  "Script Quality Assurance Specialist":      "Quality Assurance",

  "IT Security Intern":                       "Management",
};

// ── YT Labs: title → department ────────────────────────────────────
// Department names match src/lib/departments-yt-labs.ts exactly.
const YT_LABS_MAP: Record<string, string> = {
  "Co-Founder":                  "YT_Executive Leadership Team",

  "Head of Content Strategy":    "YT_Content Strategy & Research",
  "Associate Content Strategy":  "YT_Content Strategy & Research",

  "Head of Research":            "YT_Research",
  "Content Researcher":          "YT_Research",
  "Associate Content Researcher":"YT_Research",

  "Head Of Video Editing":       "YT_Creative Video Editing",
  "Sr. Video Editor":            "YT_Creative Video Editing",
  "Video Editor":                "YT_Creative Video Editing",
  "Associate Video Editor":      "YT_Creative Video Editing",

  "Head Of Operations":          "YT_Operations",
  "Graphic Designer":            "YT_Operations",
  "Sr. Graphic Designer":        "YT_Operations",

  "Sr. Quality Assurance Manager":"YT_Quality Assurance",
  "Quality Assurance":           "YT_Quality Assurance",
  "Proof Reader":                "YT_Quality Assurance",

  "Sr. Script Writer":           "YT_Creative Writing",
  "Script Writer":               "YT_Creative Writing",
  "Creative Writer":             "YT_Creative Writing",

  "Human Resource":              "HR Operations & TA",
};

// ── Keyword fallback ───────────────────────────────────────────────
// Order matters — first matching keyword wins. Each rule maps a
// case-insensitive substring to a department key per brand.
type KeywordRule = {
  match: RegExp;
  nbMedia: string;
  ytLabs:  string;
};
const KEYWORD_RULES: KeywordRule[] = [
  // Order matters — most specific compound terms first. "Social
  // media …" wins over the generic "content strategist" rule so a
  // title like "Social Media Content Strategist" routes to the
  // Social Media team, not Management.
  { match: /social\s*media|community\s*manager/i,
                                              nbMedia: "Social Media",     ytLabs: "YT_Operations" },
  { match: /video\s*editor|editor/i,         nbMedia: "Editing",          ytLabs: "YT_Creative Video Editing" },
  { match: /script\s*writer|copy\s*writer|content\s*writer|writer/i,
                                              nbMedia: "Writing",          ytLabs: "YT_Creative Writing" },
  { match: /graphic\s*designer|designer/i,    nbMedia: "Social Media",     ytLabs: "YT_Operations" },
  { match: /\bqa\b|quality\s*assurance|proof\s*reader/i,
                                              nbMedia: "Quality Assurance",ytLabs: "YT_Quality Assurance" },
  { match: /research/i,                       nbMedia: "Research",         ytLabs: "YT_Research" },
  { match: /content\s*strategist|strategy/i,  nbMedia: "Management",       ytLabs: "YT_Content Strategy & Research" },
  { match: /\bhr\b|human\s*resource|talent\s*acquisition|recruit/i,
                                              nbMedia: "Human Resource",   ytLabs: "HR Operations & TA" },
  { match: /\bai\b|machine\s*learning|\bml\b/i,
                                              nbMedia: "AI",               ytLabs: "YT_Operations" },
  { match: /operations?|ops/i,                nbMedia: "Management",       ytLabs: "YT_Operations" },
  { match: /production/i,                     nbMedia: "Management",       ytLabs: "YT_Production" },
  { match: /ceo|founder|chief|head/i,         nbMedia: "Management",       ytLabs: "YT_Executive Leadership Team" },
];

/**
 * Resolve the best-guess department for a given job title + brand.
 * Returns null when nothing matches — caller should leave department
 * blank for HR to pick.
 */
export function departmentForTitle(
  title: string,
  brand: "nb_media" | "yt_labs",
): string | null {
  if (!title) return null;
  const trimmed = title.trim();
  if (!trimmed) return null;

  const map = brand === "yt_labs" ? YT_LABS_MAP : NB_MEDIA_MAP;
  const validDepts = new Set<string>(
    brand === "yt_labs" ? DEPARTMENTS_YT_LABS : DEPARTMENTS,
  );

  // 1. Exact map (case-insensitive)
  const exactKey = Object.keys(map).find(
    (k) => k.toLowerCase() === trimmed.toLowerCase(),
  );
  if (exactKey) {
    const d = map[exactKey];
    return validDepts.has(d) ? d : null;
  }

  // 2. Keyword fallback
  for (const rule of KEYWORD_RULES) {
    if (rule.match.test(trimmed)) {
      const d = brand === "yt_labs" ? rule.ytLabs : rule.nbMedia;
      return validDepts.has(d) ? d : null;
    }
  }

  return null;
}
