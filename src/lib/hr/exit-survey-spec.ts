// Exit-survey question spec + validation. Pure / client-safe (NO prisma)
// so the employee form page and the HR profile tab can import it. The
// server logic lives in ./exit-survey.ts and re-exports from here.

export const EXIT_WINDOW_DAYS = 2;

export type ExitQType = "rating5" | "rating10" | "single" | "yesno" | "yesnomaybe" | "text";
export type ExitQuestion = {
  id: string;
  label: string;
  type: ExitQType;
  options?: string[];
  required?: boolean;
  showIf?: { id: string; equals: string };
};
export type ExitSection = { title: string; description?: string; questions: ExitQuestion[] };

export const REASON_OPTIONS = [
  "Compensation & Benefits",
  "Career Growth Opportunities",
  "Manager/Supervisor Relationship",
  "Work-Life Balance",
  "Better Opportunity Elsewhere",
  "Relocation",
  "Personal Reasons",
  "Company Culture",
  "Role Expectations",
  "Other",
];

export const EXIT_SURVEY: ExitSection[] = [
  {
    title: "Overall Experience",
    description: "Rate each from 1 (very dissatisfied) to 5 (very satisfied).",
    questions: [
      { id: "overallExperience",       label: "Overall experience at NB Media",                           type: "rating5", required: true },
      { id: "compensation",            label: "Compensation and benefits",                                type: "rating5", required: true },
      { id: "learningGrowth",          label: "Opportunities for learning and professional growth",       type: "rating5", required: true },
      { id: "skillsUse",               label: "My role made effective use of my skills and strengths",    type: "rating5", required: true },
      { id: "workLifeBalance",         label: "Work-life balance",                                        type: "rating5", required: true },
      { id: "managerSupport",          label: "Support and guidance from my reporting manager",           type: "rating5", required: true },
      { id: "feedbackQuality",         label: "I received regular, constructive feedback that helped me",  type: "rating5", required: true },
      { id: "recognition",             label: "I felt recognized and appreciated for my contributions",   type: "rating5", required: true },
      { id: "leadershipCommunication", label: "Communication and transparency from leadership",           type: "rating5", required: true },
      { id: "workCulture",             label: "Overall work culture at NB Media",                         type: "rating5", required: true },
      { id: "recommend",               label: "How likely are you to recommend NB Media as a workplace?", type: "rating10", required: true },
    ],
  },
  {
    title: "Reason for Leaving",
    questions: [
      { id: "primaryReason",      label: "Primary reason for your decision to leave",                type: "single", options: REASON_OPTIONS, required: true },
      { id: "primaryReasonOther", label: "Please specify",                                          type: "text", required: true, showIf: { id: "primaryReason", equals: "Other" } },
      { id: "topThreeFactors",    label: "Top three factors that influenced your decision to leave", type: "text", required: true },
    ],
  },
  {
    title: "Manager Feedback",
    description: "Rate your reporting manager from 1 to 5.",
    questions: [
      { id: "mgrRespect",      label: "My manager treated me with respect",              type: "rating5", required: true },
      { id: "mgrExpectations", label: "My manager communicated expectations clearly",    type: "rating5", required: true },
      { id: "mgrFeedback",     label: "My manager provided timely feedback and support", type: "rating5", required: true },
      { id: "mgrRecognized",   label: "My manager recognized good performance",          type: "rating5", required: true },
      { id: "mgrGrowth",       label: "My manager encouraged my professional growth",    type: "rating5", required: true },
    ],
  },
  {
    title: "Open Feedback",
    questions: [
      { id: "raisedConcerns",     label: "Did you raise your concerns with the company before deciding to leave?", type: "yesno", required: true },
      { id: "concernsAddressed",  label: "If yes, do you feel those concerns were adequately addressed?",         type: "text", showIf: { id: "raisedConcerns", equals: "Yes" } },
      { id: "enjoyedMost",        label: "What did you enjoy most about working at NB Media?",                     type: "text" },
      { id: "frustratedMost",     label: "What frustrated you the most during your time here?",                   type: "text" },
      { id: "improveImmediately", label: "What is one thing management could improve immediately?",               type: "text" },
      { id: "couldHaveStayed",    label: "What could NB Media have done differently to encourage you to stay?",    type: "text" },
      { id: "leadershipFeedback", label: "Any feedback you'd like to share with the leadership team?",            type: "text" },
      { id: "wouldRejoin",        label: "Would you consider rejoining NB Media in the future?",                  type: "yesnomaybe", required: true },
      { id: "mayContact",         label: "May we contact you in the future to discuss your feedback further?",    type: "yesno", required: true },
    ],
  },
];

export const ALL_EXIT_QUESTIONS: ExitQuestion[] = EXIT_SURVEY.flatMap((s) => s.questions);

// Shared validation (used by the API on submit + the form to enable the
// submit button). Conditional questions only count when their controller
// matches.
export function validateExitResponses(answers: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  for (const q of ALL_EXIT_QUESTIONS) {
    if (q.showIf) {
      const ctrl = String(answers[q.showIf.id] ?? "");
      if (ctrl !== q.showIf.equals) continue;
    }
    const v = answers[q.id];
    const present = v !== undefined && v !== null && String(v).trim() !== "";
    if (!present) {
      if (q.required) return { ok: false, error: `Please answer: "${q.label}".` };
      continue;
    }
    if (q.type === "rating5") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) return { ok: false, error: `"${q.label}" must be 1-5.` };
    } else if (q.type === "rating10") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 10) return { ok: false, error: `"${q.label}" must be 1-10.` };
    } else if (q.type === "single") {
      if (!(q.options || []).includes(String(v))) return { ok: false, error: `Invalid option for "${q.label}".` };
    } else if (q.type === "yesno") {
      if (!["Yes", "No"].includes(String(v))) return { ok: false, error: `"${q.label}" must be Yes or No.` };
    } else if (q.type === "yesnomaybe") {
      if (!["Yes", "No", "Maybe"].includes(String(v))) return { ok: false, error: `"${q.label}" must be Yes, No, or Maybe.` };
    }
  }
  return { ok: true };
}
