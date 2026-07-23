// ═══════════════════════════════════════════════════════
// Default Formula Templates
//
// These are the canonical starting templates for each role.
// They are seeded into FormulaTemplate on first calculation
// run (ensureDefaultTemplate in unified-calculator.ts).
//
// To change the formula for a role:
//   1. Create a new template via the admin UI (POST /api/ratings/formula-template)
//   2. Activate it (PUT /api/ratings/formula-template/:id/activate)
//   3. Run a new calculation — old MonthlyRating rows are untouched
//
// DO NOT edit these constants to change live behaviour.
// They only apply when no active template exists.
// ═══════════════════════════════════════════════════════

import type { FormulaSection, GuardrailRule } from "./types";

interface DefaultTemplate {
    roleType: string;
    version: number;
    label: string;
    description: string;
    sections: FormulaSection[];
    guardrails: GuardrailRule[];
    roundOff: boolean;
}

// ── YT bracket shared between writer and editor (same logic) ──
const YT_BRACKETS = [
    { min: 0,   max: 50,          stars: 1 },
    { min: 51,  max: 95,          stars: 2 },
    { min: 95,  max: 105,         stars: 3 },
    { min: 105, max: 200,         stars: 4 },
    { min: 201, max: 999_999_999, stars: 5 },
];

const QUALITY_BRACKETS = [
    { min: 0,  max: 29, stars: 1 },
    { min: 30, max: 34, stars: 2 },
    { min: 35, max: 39, stars: 3 },
    { min: 40, max: 44, stars: 4 },
    { min: 45, max: 50, stars: 5 },
];

const MONTHLY_TARGETS_MATRIX = {
    "2": { "5": 4, "4": 3, "3": 2, "2": 1, "1": 1 },
    "3": { "5": 5, "4": 4, "3": 3, "2": 2, "1": 1 },
    "4": { "5": 5, "4": 5, "3": 3, "2": 2, "1": 1 },
};

export const DEFAULT_WRITER_TEMPLATE: DefaultTemplate = {
    roleType: "writer",
    version: 1,
    label: "Writer Monthly Rating v1",
    description:
        "Standard writer rating: Quality 20% · Script Rating 25% · Ownership 15% · Monthly Targets 15% · YouTube 25%",
    sections: [
        {
            key: "writerQuality",
            label: "Writer Quality Score",
            weight: 0.20,
            type: "bracket_lookup",
            source: "clickup",
            variable: "writer_quality_score_avg",
            blocks_final_score: false,
            brackets: QUALITY_BRACKETS,
        },
        {
            key: "scriptQuality",
            label: "Script Rating",
            weight: 0.25,
            type: "manager_questions_avg",
            source: "manager",
            question_keys: ["script_q1", "script_q2", "script_q3", "script_q4", "script_q5"],
            blocks_final_score: true,
        },
        {
            key: "ownership",
            label: "Ownership & Discipline",
            weight: 0.15,
            type: "manager_questions_avg",
            source: "manager",
            question_keys: ["ownership_q1", "ownership_q2", "ownership_q3", "ownership_q4", "ownership_q5"],
            blocks_final_score: true,
        },
        {
            key: "monthlyTargets",
            label: "Monthly Targets",
            weight: 0.15,
            type: "matrix_lookup",
            source: "formula",
            variable_x: "cases_completed",
            variable_y_section: "writerQuality",
            matrix: MONTHLY_TARGETS_MATRIX,
            blocks_final_score: false,
        },
        {
            key: "youtubeViews",
            label: "YouTube Views Performance",
            weight: 0.25,
            type: "yt_baseline_ratio",
            source: "youtube",
            yt_fallback_stars: 3,
            blocks_final_score: false,
            brackets: YT_BRACKETS,
        },
    ],
    guardrails: [],
    roundOff: false,
};

export const DEFAULT_EDITOR_TEMPLATE: DefaultTemplate = {
    roleType: "editor",
    version: 1,
    label: "Editor Monthly Rating v1",
    description:
        "Standard editor rating: Quality 20% · Video Rating 25% · Ownership 15% · Monthly Targets 15% · YouTube 25%",
    sections: [
        {
            key: "editorQuality",
            label: "Editor Quality Score",
            weight: 0.20,
            type: "bracket_lookup",
            source: "clickup",
            variable: "editor_quality_score_avg",
            blocks_final_score: false,
            brackets: QUALITY_BRACKETS,
        },
        {
            key: "videoQuality",
            label: "Video Rating",
            weight: 0.25,
            type: "manager_questions_avg",
            source: "manager",
            question_keys: ["video_q1", "video_q2", "video_q3", "video_q4", "video_q5"],
            blocks_final_score: true,
        },
        {
            key: "ownership",
            label: "Ownership & Discipline",
            weight: 0.15,
            type: "manager_questions_avg",
            source: "manager",
            question_keys: ["ownership_q1", "ownership_q2", "ownership_q3", "ownership_q4", "ownership_q5"],
            blocks_final_score: true,
        },
        {
            key: "monthlyTargets",
            label: "Monthly Targets",
            weight: 0.15,
            type: "matrix_lookup",
            source: "formula",
            variable_x: "cases_completed",
            variable_y_section: "editorQuality",
            matrix: MONTHLY_TARGETS_MATRIX,
            blocks_final_score: false,
        },
        {
            key: "youtubeViews",
            label: "YouTube Views Performance",
            weight: 0.25,
            type: "yt_baseline_ratio",
            source: "youtube",
            yt_fallback_stars: 3,
            blocks_final_score: false,
            brackets: YT_BRACKETS,
        },
    ],
    guardrails: [],
    roundOff: false,
};

export const DEFAULT_HR_MANAGER_TEMPLATE: DefaultTemplate = {
    roleType: "hr_manager",
    version: 1,
    label: "HR Manager Monthly Rating v1",
    description:
        "HR Manager rating: System Compliance 30% · Hiring Quality 25% · HR Governance 20% · Retention & Stability 15% · Culture & Engagement 10%",
    sections: [
        {
            key: "systemCompliance",
            label: "System Compliance Index",
            weight: 0.30,
            type: "manager_questions_avg",
            source: "manager",
            question_keys: [
                "compliance_q1",
                "compliance_q2",
                "compliance_q3",
                "compliance_q4",
                "compliance_q5",
            ],
            question_labels: [
                "Attendance & leave tracking accuracy",
                "Payroll processing timeliness & correctness",
                "Document management & record keeping",
                "Policy implementation & follow-through",
                "HR software/tool adoption & usage",
            ],
            blocks_final_score: true,
            description: "Measures how well HR systems, processes, and compliance standards are maintained",
            rating_criteria: {
                intro: "This pillar evaluates the HR Manager's ability to maintain and enforce organizational systems and compliance standards.",
                levels: [
                    { stars: 5, bullets: ["Zero compliance gaps", "All records 100% accurate and up-to-date", "Proactively identifies and fixes system issues", "Fully automated and streamlined processes", "Audit-ready at all times"] },
                    { stars: 4, bullets: ["Minor compliance gaps quickly resolved", "Records mostly accurate with rare errors", "Systems well-maintained", "Good process documentation", "Responds promptly to compliance needs"] },
                    { stars: 3, bullets: ["Occasional compliance gaps", "Records generally accurate", "Systems functional but not optimized", "Basic process documentation exists", "Meets minimum compliance requirements"] },
                    { stars: 2, bullets: ["Frequent compliance gaps", "Records have noticeable errors", "Systems need attention", "Incomplete documentation", "Struggles to meet compliance deadlines"] },
                    { stars: 1, bullets: ["Severe compliance failures", "Records unreliable or missing", "Systems poorly maintained", "No documentation", "Repeated compliance violations"] },
                ],
            },
        },
        {
            key: "hiringQuality",
            label: "Hiring Quality Index",
            weight: 0.25,
            type: "manager_questions_avg",
            source: "manager",
            question_keys: [
                "hiring_q1",
                "hiring_q2",
                "hiring_q3",
                "hiring_q4",
                "hiring_q5",
            ],
            question_labels: [
                "Quality of candidates sourced & shortlisted",
                "Time-to-hire efficiency",
                "Onboarding process effectiveness",
                "New hire retention (within probation period)",
                "Hiring process communication & coordination",
            ],
            blocks_final_score: true,
            description: "Evaluates the quality and efficiency of the recruitment and onboarding process",
            rating_criteria: {
                intro: "This pillar measures recruitment effectiveness — from sourcing to onboarding and early retention.",
                levels: [
                    { stars: 5, bullets: ["Consistently sources top-tier candidates", "Positions filled well within target timelines", "Seamless onboarding with excellent new hire feedback", "100% probation retention", "Proactive talent pipeline building"] },
                    { stars: 4, bullets: ["Good quality candidates with occasional misses", "Mostly on-time hiring", "Smooth onboarding with minor gaps", "High probation retention", "Good coordination with hiring managers"] },
                    { stars: 3, bullets: ["Adequate candidate quality", "Hiring timelines sometimes exceeded", "Functional onboarding process", "Average probation retention", "Meets basic hiring needs"] },
                    { stars: 2, bullets: ["Below-average candidate quality", "Frequent hiring delays", "Onboarding gaps causing early confusion", "Noticeable probation dropoffs", "Poor coordination with teams"] },
                    { stars: 1, bullets: ["Poor candidate sourcing", "Severe hiring delays impacting operations", "No structured onboarding", "High early attrition", "Hiring process is chaotic"] },
                ],
            },
        },
        {
            key: "hrGovernance",
            label: "HR Governance",
            weight: 0.20,
            type: "manager_questions_avg",
            source: "manager",
            question_keys: [
                "governance_q1",
                "governance_q2",
                "governance_q3",
                "governance_q4",
                "governance_q5",
            ],
            question_labels: [
                "Policy creation, updates & communication",
                "Grievance handling & conflict resolution",
                "Disciplinary action fairness & consistency",
                "Legal & regulatory compliance awareness",
                "Confidentiality & data protection",
            ],
            blocks_final_score: true,
            description: "Assesses HR governance quality — policies, grievance handling, and regulatory compliance",
            rating_criteria: {
                intro: "This pillar evaluates the HR Manager's governance capabilities including policy management, conflict resolution, and legal compliance.",
                levels: [
                    { stars: 5, bullets: ["Policies are comprehensive, current, and well-communicated", "Grievances resolved swiftly and fairly", "Disciplinary actions consistent and well-documented", "Fully up-to-date on labor laws", "Exemplary data protection practices"] },
                    { stars: 4, bullets: ["Policies mostly current with minor gaps", "Good grievance handling with timely resolution", "Fair disciplinary process", "Good regulatory awareness", "Strong confidentiality practices"] },
                    { stars: 3, bullets: ["Basic policies in place", "Grievances addressed but sometimes delayed", "Adequate disciplinary process", "Basic legal compliance", "Acceptable data handling"] },
                    { stars: 2, bullets: ["Outdated or missing policies", "Slow grievance resolution", "Inconsistent disciplinary actions", "Gaps in regulatory knowledge", "Data protection concerns"] },
                    { stars: 1, bullets: ["No proper policies", "Grievances ignored or mishandled", "Unfair disciplinary practices", "Legal compliance failures", "Serious confidentiality breaches"] },
                ],
            },
        },
        {
            key: "retentionStability",
            label: "Retention & Stability",
            weight: 0.15,
            type: "manager_questions_avg",
            source: "manager",
            question_keys: [
                "retention_q1",
                "retention_q2",
                "retention_q3",
                "retention_q4",
                "retention_q5",
            ],
            question_labels: [
                "Overall employee retention rate",
                "Exit interview insights & action taken",
                "Employee satisfaction monitoring",
                "Career growth & development support",
                "Work environment & well-being initiatives",
            ],
            blocks_final_score: true,
            description: "Measures the HR Manager's effectiveness in retaining talent and maintaining workforce stability",
            rating_criteria: {
                intro: "This pillar evaluates how well the HR Manager retains employees and creates a stable work environment.",
                levels: [
                    { stars: 5, bullets: ["Exceptional retention rates", "Exit insights drive meaningful changes", "Regular satisfaction surveys with action plans", "Clear career paths for all roles", "Proactive well-being programs"] },
                    { stars: 4, bullets: ["Good retention with minor attrition", "Exit interviews conducted and reviewed", "Periodic satisfaction checks", "Some career development support", "Positive work environment"] },
                    { stars: 3, bullets: ["Average retention", "Exit interviews done but limited follow-up", "Basic satisfaction awareness", "Limited growth opportunities", "Acceptable work conditions"] },
                    { stars: 2, bullets: ["Below-average retention", "Exit interviews inconsistent", "No formal satisfaction tracking", "Minimal career support", "Work environment concerns"] },
                    { stars: 1, bullets: ["High attrition rates", "No exit process", "Employee dissatisfaction widespread", "No growth support", "Toxic or neglected work environment"] },
                ],
            },
        },
        {
            key: "cultureEngagement",
            label: "Culture & Engagement",
            weight: 0.10,
            type: "manager_questions_avg",
            source: "manager",
            question_keys: [
                "culture_q1",
                "culture_q2",
                "culture_q3",
                "culture_q4",
                "culture_q5",
            ],
            question_labels: [
                "Team building & engagement activities",
                "Cross-department collaboration facilitation",
                "Recognition & rewards program management",
                "Company values promotion & alignment",
                "Communication transparency & openness",
            ],
            blocks_final_score: true,
            description: "Evaluates the HR Manager's contribution to building a positive company culture and employee engagement",
            rating_criteria: {
                intro: "This pillar measures how effectively the HR Manager fosters company culture, engagement, and team spirit.",
                levels: [
                    { stars: 5, bullets: ["Regular impactful engagement activities", "Excellent cross-team collaboration", "Well-structured recognition program", "Strong culture ambassador", "Open and transparent communication"] },
                    { stars: 4, bullets: ["Good engagement initiatives", "Facilitates inter-team cooperation", "Recognition exists and is valued", "Actively promotes company values", "Good communication practices"] },
                    { stars: 3, bullets: ["Some engagement activities", "Basic cross-team interaction", "Informal recognition", "Awareness of company values", "Adequate communication"] },
                    { stars: 2, bullets: ["Rare engagement efforts", "Siloed departments", "Little to no recognition", "Values not actively promoted", "Communication gaps"] },
                    { stars: 1, bullets: ["No engagement activities", "No cross-team collaboration", "No recognition culture", "Company values ignored", "Poor communication"] },
                ],
            },
        },
    ],
    guardrails: [],
    roundOff: false,
};

/** CM monthly delivery % → stars (set each manager’s monthly case target on their user profile). */
const CM_DELIVERY_PCT_BRACKETS = [
    { min: 95, max: 100, stars: 5 },
    { min: 85, max: 94.999, stars: 4 },
    { min: 70, max: 84.999, stars: 3 },
    { min: 50, max: 69.999, stars: 2 },
    { min: 0, max: 49.999, stars: 1 },
];

export const DEFAULT_PRODUCTION_MANAGER_TEMPLATE: DefaultTemplate = {
    roleType: "production_manager",
    version: 1,
    label: "Production Manager / Channel Manager Monthly Rating v1",
    description:
        "CM/PM rating: Views 15% · Production Quality 15% · Monthly Targets 15% · Leadership 15% · Team Feedback 15% · Strategic Thinking 10% · Communication 15%",
    sections: [
        // ── Pillar 1: Views (15%) ──
        // Same logic as editor but cases are qualified by "Video QA1" subtask completion
        {
            key: "youtubeViews",
            label: "Views Performance",
            weight: 0.15,
            type: "yt_baseline_ratio",
            source: "youtube",
            yt_fallback_stars: 3,
            blocks_final_score: false,
            brackets: YT_BRACKETS,
            yt_manager_adjustment_key: "cm_yt_adjustment",
            description: "YouTube views performance of cases completed by your capsule (Video QA1 done). Same logic as editor views scoring.",
        },

        // ── Pillar 2: Production Quality (15%) ──
        // Avg of all writers' and editors' quality scores under this CM
        {
            key: "productionQuality",
            label: "Production Quality",
            weight: 0.15,
            type: "team_quality_avg",
            source: "clickup",
            variable: "cm_team_production_quality_avg",
            blocks_final_score: false,
            brackets: QUALITY_BRACKETS,
            description: "Average quality score across all writers and editors in your team for this month.",
            rating_criteria: {
                intro: "This pillar reflects the combined quality output of your team (writers + editors). Their individual quality scores are averaged to determine your production quality rating.",
                levels: [
                    { stars: 5, bullets: ["Team avg quality score 45–50", "Consistently excellent output across all team members"] },
                    { stars: 4, bullets: ["Team avg quality score 40–44", "High quality with minor gaps"] },
                    { stars: 3, bullets: ["Team avg quality score 35–39", "Adequate quality, room for improvement"] },
                    { stars: 2, bullets: ["Team avg quality score 30–34", "Below standard, needs attention"] },
                    { stars: 1, bullets: ["Team avg quality score below 30", "Significant quality issues"] },
                ],
            },
        },

        // ── Pillar 3: Monthly Targets (15%) ──
        // Delivery % = (quality-qualified completions ÷ per-manager target) × 100. Target is set per CM on the user profile.
        {
            key: "monthlyTargets",
            label: "Monthly Targets",
            weight: 0.15,
            type: "bracket_lookup",
            source: "formula",
            variable: "cm_delivery_pct",
            qualify_threshold: 32,
            cm_delivery_hero_multiplier: 1.3,
            cm_delivery_default_multiplier: 1,
            cm_delivery_hero_case_type_labels: ["hero"],
            /** Optional: { "Manager Display Name": 9 } — overrides profile target when names match (case-insensitive). */
            cm_delivery_target_by_manager_name: {},
            brackets: CM_DELIVERY_PCT_BRACKETS,
            blocks_final_score: true,
            description:
                "Delivery % = weighted units (Hero case type ×1.3, Normal/empty ×1) ÷ monthly target × 100. Target: User profile or optional name map in template. Case type uses ClickUp field synced to Case.caseType.",
            rating_criteria: {
                intro: "Stars are based on delivery % for the month (not raw case count alone). Hero cases count as 1.3 units; other qualifying cases as 1.",
                levels: [
                    { stars: 5, bullets: ["Delivery 95–100%"] },
                    { stars: 4, bullets: ["Delivery 85–94%"] },
                    { stars: 3, bullets: ["Delivery 70–84%"] },
                    { stars: 2, bullets: ["Delivery 50–69%"] },
                    { stars: 1, bullets: ["Delivery below 50%"] },
                ],
            },
        },

        // ── Pillar 4: Leadership & Team Management (15%) ──
        // Direct rating from CEO/HOD
        {
            key: "leadership",
            label: "Leadership & Team Management",
            weight: 0.15,
            type: "manager_questions_avg",
            source: "manager",
            question_keys: [
                "cm_leadership_q1",
                "cm_leadership_q2",
                "cm_leadership_q3",
                "cm_leadership_q4",
                "cm_leadership_q5",
            ],
            question_labels: [
                "Team motivation & morale management",
                "Task delegation & workload balance",
                "Conflict resolution & problem solving",
                "Mentoring & skill development of team",
                "Accountability & ownership of outcomes",
            ],
            blocks_final_score: true,
            description: "Evaluates leadership capabilities in managing and developing the production team.",
            rating_criteria: {
                intro: "This pillar evaluates how effectively the CM/PM leads, motivates, and develops their team.",
                levels: [
                    { stars: 5, bullets: ["Team consistently motivated and high-performing", "Perfect workload distribution", "Proactively resolves conflicts", "Active mentoring program in place", "Takes full ownership of team outcomes"] },
                    { stars: 4, bullets: ["Team generally motivated with minor dips", "Good task delegation with rare imbalances", "Handles conflicts effectively when they arise", "Regular skill development support", "Strong accountability"] },
                    { stars: 3, bullets: ["Average team morale", "Adequate delegation", "Resolves conflicts when escalated", "Basic mentoring provided", "Takes responsibility for most outcomes"] },
                    { stars: 2, bullets: ["Low team morale or frequent complaints", "Uneven workload distribution", "Slow to address conflicts", "Limited development support", "Deflects accountability"] },
                    { stars: 1, bullets: ["Team disengaged or demoralized", "Poor task delegation", "Ignores or worsens conflicts", "No mentoring or development", "Avoids accountability entirely"] },
                ],
            },
        },

        // ── Pillar 5: Team Feedback (15%) ──
        // 50% manager's rating + 50% team members' avg rating
        {
            key: "teamFeedback",
            label: "Team Feedback & Collaboration",
            weight: 0.15,
            type: "combined_team_manager_rating",
            source: "manager",
            manager_question_keys: [
                "cm_collab_mgr_q1",
                "cm_collab_mgr_q2",
                "cm_collab_mgr_q3",
                "cm_collab_mgr_q4",
                "cm_collab_mgr_q5",
            ],
            manager_question_labels: [
                "Cross-team collaboration effectiveness",
                "Openness to feedback & suggestions",
                "Communication clarity with team",
                "Support during challenging situations",
                "Fair treatment & inclusivity",
            ],
            team_question_keys: [
                "cm_collab_team_q1",
                "cm_collab_team_q2",
                "cm_collab_team_q3",
                "cm_collab_team_q4",
                "cm_collab_team_q5",
            ],
            team_question_labels: [
                "How well does your manager collaborate across teams?",
                "How open is your manager to feedback?",
                "How clear is communication from your manager?",
                "How supportive is your manager during challenges?",
                "How fair and inclusive is your manager?",
            ],
            team_question_options: [
                ["Poor", "Fair", "Excellent"],
                ["Rarely", "Sometimes", "Always"],
                ["Very unclear", "Mostly clear", "Very clear"],
                ["Not supportive", "Somewhat supportive", "Very supportive"],
                ["Not fair / inclusive", "Mixed", "Fair & inclusive"],
            ],
            blocks_final_score: true,
            description: "Combined rating: 50% from senior management assessment + 50% from team members' anonymous feedback.",
            manager_rating_criteria: {
                intro: "From a leadership perspective: rate how this CM/PM collaborates, listens, communicates with the team, and shows up in tough moments.",
                levels: [
                    { stars: 5, bullets: ["Drives strong cross-team alignment", "Actively seeks and acts on feedback", "Communication is consistently clear and timely", "Highly supportive under pressure", "Fair, inclusive, and consistent with the team"] },
                    { stars: 4, bullets: ["Good collaboration with occasional gaps", "Generally receptive to feedback", "Clear communication with minor misses", "Supportive in most situations", "Mostly fair and inclusive"] },
                    { stars: 3, bullets: ["Adequate cross-team coordination", "Accepts feedback when raised", "Communication is acceptable but uneven", "Supportive when asked", "Mixed perceptions of fairness"] },
                    { stars: 2, bullets: ["Weak cross-team collaboration", "Defensive or slow to accept feedback", "Unclear or inconsistent communication", "Limited support in challenges", "Fairness concerns raised"] },
                    { stars: 1, bullets: ["Collaboration breakdowns across teams", "Dismisses or rejects feedback", "Poor communication with the team", "Absent or counterproductive under pressure", "Team feels treated unfairly"] },
                ],
            },
            team_rating_criteria: {
                intro: "Your answers are anonymous. Use the same 1–5 scale: how strongly you agree that each statement reflects your manager this month.",
                levels: [
                    { stars: 5, bullets: ["I see excellent collaboration across teams", "My manager genuinely welcomes my input", "I always understand priorities and expectations", "I feel supported when work is hard", "I feel respected and included"] },
                    { stars: 4, bullets: ["Collaboration is strong most of the time", "My manager is open to feedback overall", "Communication is clear with rare gaps", "I usually feel backed by my manager", "I generally feel treated fairly"] },
                    { stars: 3, bullets: ["Collaboration is okay but inconsistent", "Feedback is heard sometimes", "Communication is hit-or-miss", "Support depends on the situation", "Fairness feels uneven"] },
                    { stars: 2, bullets: ["Collaboration is weak from my view", "Hard to give feedback safely", "I’m often unclear on direction", "I rarely feel supported", "I often feel overlooked or unfairly treated"] },
                    { stars: 1, bullets: ["Cross-team work feels blocked", "Feedback is ignored or punished", "Communication is confusing or absent", "I don’t feel supported at all", "I feel excluded or mistreated"] },
                ],
            },
            team_pillar_team_rules_enabled: true,
            team_pillar_zero_below_team_avg: 2,
            team_pillar_cap_below_team_avg: 3,
            team_pillar_cap_max_stars: 3.5,
        },

        // ── Pillar 6: Strategic Thinking & Planning (10%) ──
        // Direct rating from CEO/HOD
        {
            key: "strategicThinking",
            label: "Strategic Thinking & Planning",
            weight: 0.10,
            type: "manager_questions_avg",
            source: "manager",
            question_keys: [
                "cm_strategy_q1",
                "cm_strategy_q2",
                "cm_strategy_q3",
                "cm_strategy_q4",
                "cm_strategy_q5",
            ],
            question_labels: [
                "Content strategy & trend awareness",
                "Proactive planning & pipeline management",
                "Data-driven decision making",
                "Innovation & creative problem solving",
                "Long-term vision for team/channel growth",
            ],
            blocks_final_score: true,
            description: "Evaluates the CM/PM's ability to think strategically about content, growth, and team development.",
            rating_criteria: {
                intro: "This pillar measures strategic capability — planning, trend awareness, data usage, and long-term vision.",
                levels: [
                    { stars: 5, bullets: ["Consistently ahead of trends", "Robust pipeline with contingencies", "Decisions backed by data and analytics", "Regularly introduces innovative approaches", "Clear long-term growth roadmap"] },
                    { stars: 4, bullets: ["Good trend awareness", "Well-managed pipeline", "Uses data for most decisions", "Occasionally innovative", "Has a growth plan in mind"] },
                    { stars: 3, bullets: ["Aware of basic trends", "Adequate pipeline management", "Some data usage", "Standard approaches", "Basic planning ahead"] },
                    { stars: 2, bullets: ["Behind on trends", "Reactive pipeline management", "Minimal data usage", "No innovation", "Short-term focus only"] },
                    { stars: 1, bullets: ["Unaware of industry trends", "No pipeline planning", "Decisions are arbitrary", "Resists change", "No vision for growth"] },
                ],
            },
        },

        // ── Pillar 7: Communication & Reporting (15%) ──
        // Direct rating from CEO/HOD
        {
            key: "communication",
            label: "Communication & Reporting",
            weight: 0.15,
            type: "manager_questions_avg",
            source: "manager",
            question_keys: [
                "cm_comm_q1",
                "cm_comm_q2",
                "cm_comm_q3",
                "cm_comm_q4",
                "cm_comm_q5",
            ],
            question_labels: [
                "Timeliness & accuracy of reports",
                "Upward communication (escalations & updates)",
                "Downward communication (team briefings & clarity)",
                "Cross-functional communication",
                "Documentation & process adherence",
            ],
            blocks_final_score: true,
            description: "Evaluates communication effectiveness — reporting quality, escalation handling, and team communication.",
            rating_criteria: {
                intro: "This pillar evaluates the CM/PM's communication skills across all directions — upward, downward, and cross-functional.",
                levels: [
                    { stars: 5, bullets: ["Reports always on time and insightful", "Proactive escalations with solutions", "Team always well-informed", "Excellent cross-team communication", "Thorough documentation"] },
                    { stars: 4, bullets: ["Reports mostly on time and accurate", "Timely escalations", "Team generally informed", "Good cross-team communication", "Good documentation habits"] },
                    { stars: 3, bullets: ["Reports sometimes delayed", "Escalations happen but sometimes late", "Adequate team communication", "Basic cross-team interaction", "Minimal documentation"] },
                    { stars: 2, bullets: ["Reports frequently delayed or inaccurate", "Late or missing escalations", "Team often uninformed", "Poor cross-team communication", "Incomplete documentation"] },
                    { stars: 1, bullets: ["No regular reporting", "Fails to escalate critical issues", "Team left in the dark", "No cross-team communication", "No documentation"] },
                ],
            },
        },
    ],
    guardrails: [],
    roundOff: false,
};

/**
 * Research Manager — five pillars (P1 views, P2 pipeline vs targets, P3 Case Rating avg, P4–5 placeholders).
 * New installs seed this; change weights/sections in the Formula Template UI.
 */
export const DEFAULT_RESEARCHER_MANAGER_TEMPLATE: DefaultTemplate = {
    roleType: "researcher_manager",
    version: 1,
    label: "Research Manager Monthly Rating v1",
    description:
        "Views 20% · Pipeline (RTC/FOIA/pitched vs monthly targets) 25% · Case Quality 18% · Placeholders 18%+19%",
    sections: [
        {
            key: "youtubeViews",
            label: "Views performance",
            weight: 0.2,
            type: "yt_baseline_ratio",
            source: "youtube",
            yt_fallback_stars: 3,
            blocks_final_score: false,
            brackets: YT_BRACKETS,
            yt_manager_adjustment_key: "rm_yt_adjustment",
            description:
                "YouTube views vs channel baseline for every case under any production capsule whose video was published in the rating month (UTC). Uses last-30-day views when available. Not limited to your team capsule.",
        },
        {
            key: "pipelineStrength",
            label: "Pipeline strength",
            weight: 0.25,
            type: "rm_pipeline_targets_avg",
            source: "formula",
            rm_target_rtc: 15,
            rm_target_foia: 15,
            rm_target_foia_pitched: 10,
            blocks_final_score: false,
            description:
                "Each stream scored out of 5 as min(5, actual÷target×5): RTC vs rm_pipeline_rtc_count, FOIA vs rm_pipeline_foia_count, pitched vs rm_foia_pitched_count. Pillar = average of the three. Edit monthly targets on the template.",
        },
        {
            key: "caseQualityJudgement",
            label: "Case Quality & Judgement",
            weight: 0.18,
            type: "passthrough",
            source: "formula",
            variable: "rm_case_rating_avg_combined",
            passthrough_scale_min: 0,
            passthrough_scale_max: 50,
            passthrough_manager_adjustment_key: "rm_case_quality_adjustment",
            blocks_final_score: false,
            description:
                "Average Case Rating from ClickUp across RTC list, FOIA list, and \"{Month} FOIA Pitched Cases\" (all rated tasks). Mapped linearly from 0–50 to 1–5★ (no brackets). The Research Manager’s manager can apply ±0.5★ adjustment.",
        },
        {
            key: "pillar4Placeholder",
            label: "Pillar 4 (to define)",
            weight: 0.18,
            type: "manager_questions_avg",
            source: "manager",
            question_keys: ["rm_pillar4_q1"],
            question_labels: ["Placeholder — replace when pillar 4 is defined"],
            blocks_final_score: true,
            description: "Reserved until you specify this pillar.",
        },
        {
            key: "pillar5Placeholder",
            label: "Pillar 5 (to define)",
            weight: 0.19,
            type: "manager_questions_avg",
            source: "manager",
            question_keys: ["rm_pillar5_q1"],
            question_labels: ["Placeholder — replace when pillar 5 is defined"],
            blocks_final_score: true,
            description: "Reserved until you specify this pillar.",
        },
    ] as FormulaSection[],
    guardrails: [],
    roundOff: false,
};

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
    DEFAULT_WRITER_TEMPLATE,
    DEFAULT_EDITOR_TEMPLATE,
    DEFAULT_HR_MANAGER_TEMPLATE,
    DEFAULT_PRODUCTION_MANAGER_TEMPLATE,
    DEFAULT_RESEARCHER_MANAGER_TEMPLATE,
];
