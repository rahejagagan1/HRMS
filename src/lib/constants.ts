// Centralized constants — no more hardcoded values scattered across files

export const CHANNELS = ["M7", "M7CS", "Bodycam", "3D Documentry", "New Channel"] as const;
export type Channel = (typeof CHANNELS)[number];

export const STATUSES = [
    { value: "to do", label: "To Do" },
    { value: "in progress", label: "In Progress" },
    { value: "tth", label: "TTH" },
    { value: "tth completed", label: "TTH Complete" },
    { value: "scripting", label: "Scripting" },
    { value: "scripting visualization", label: "Scripting Visualization" },
    { value: "script qa", label: "Script QA" },
    { value: "script revision", label: "Script Revision" },
    { value: "script final check", label: "Script Final Check" },
    { value: "ready for editing/vo", label: "Ready for Editing/VO" },
    { value: "video editing", label: "Video Editing" },
    { value: "video qa1", label: "Video QA1" },
    { value: "video revision", label: "Video Revision" },
    { value: "video qa2", label: "Video QA2" },
    { value: "video final check", label: "Video Final Check" },
    { value: "ready for upload", label: "Ready for Upload" },
    { value: "published on yt", label: "Published on YT" },
] as const;
