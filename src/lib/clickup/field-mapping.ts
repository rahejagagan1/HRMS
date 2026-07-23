export const CUSTOM_FIELD_MAP: Record<string, { dbColumn: string; type: string; parseAs: string }> = {
    // ═══ RESEARCH PHASE ═══
    "3d03d407-ba57-40cd-9a0f-614d52f05f37": {
        dbColumn: "researcherUserId",
        type: "users",
        parseAs: "user_id",
    },
    "1d8ecf17-005f-4efc-a53b-058bc65b818a": {
        dbColumn: "caseRating",
        type: "drop_down",
        parseAs: "dropdown_name_as_decimal",
    },
    "02a1c83c-4586-420a-95cf-5f386a935700": {
        dbColumn: "caseType",
        type: "drop_down",
        parseAs: "dropdown_name",
    },

    // ═══ SCRIPTING PHASE ═══
    "e39e94a8-5144-4759-a007-91b1a2c78ea8": {
        dbColumn: "writerUserId",
        type: "users",
        parseAs: "user_id",
    },
    "7564d086-10d1-4db5-9190-6c9d34a79c1f": {
        dbColumn: "editorUserId",
        type: "users",
        parseAs: "user_id",
    },
    "7926c3b1-5402-4733-bf86-4510f5a46ee2": {
        dbColumn: "tthDocLink",
        type: "url",
        parseAs: "string",
    },
    "21dd1357-4728-4558-a4fe-ff017d8c1d32": {
        dbColumn: "title",
        type: "text",
        parseAs: "string",
    },
    "6500bdca-c516-4dbf-a81d-a4847b712e98": {
        dbColumn: "scriptFirstDraftLink",
        type: "url",
        parseAs: "string",
    },

    // ═══ SCRIPT QA PHASE ═══
    "c83a06c1-81e1-4093-ab09-e3cc07fdbc2d": {
        dbColumn: "scriptQaStartDate",
        type: "date",
        parseAs: "timestamp",
    },
    "e753ce7e-b2d1-45c2-97f2-d5184364ba71": {
        dbColumn: "writerQualityScore",
        type: "number",
        parseAs: "integer",
    },
    "0f17d44b-0efd-43ad-88d3-819354737541": {
        dbColumn: "writerDeliveryTime",
        type: "drop_down",
        parseAs: "dropdown_name",
    },
    "d5c974ce-af51-4465-b89e-b56d1bb8cfdc": {
        dbColumn: "writerEfficiencyScore",
        type: "drop_down",
        parseAs: "dropdown_name",
    },
    "2c65d0cc-00c6-4372-9951-a62e5a8ca370": {
        dbColumn: "finalWriterRating",
        type: "formula",
        parseAs: "decimal",
    },
    "f0e4d811-a85d-42f7-b9f4-61616f911206": {
        dbColumn: "scriptQualityRating",
        type: "drop_down",
        parseAs: "dropdown_name_as_decimal",
    },
    "1ed5adbe-516e-4d88-9248-ed95d361f1f2": {
        dbColumn: "scriptRatingReason",
        type: "text",
        parseAs: "string",
    },
    "17f34482-2cf0-4e0b-a2c9-5306825688d1": {
        dbColumn: "finalScriptLink",
        type: "url",
        parseAs: "string",
    },

    // ═══ VOICEOVER PHASE ═══
    "17264ff3-1c3a-41d0-a1b5-f663f587abd9": {
        dbColumn: "voDocLink",
        type: "url",
        parseAs: "string",
    },
    "5e79a182-7a23-4ac9-b1c4-cf091ce90423": {
        dbColumn: "voLink",
        type: "url",
        parseAs: "string",
    },

    // ═══ VIDEO EDITING PHASE ═══
    "ae337da3-96d3-496f-8312-8e633881a9d8": {
        dbColumn: "videoFirstDraftLink",
        type: "url",
        parseAs: "string",
    },
    "a1bad1d7-bff7-4648-876f-062aba1b007e": {
        dbColumn: "videoGcStartDate",
        type: "date",
        parseAs: "timestamp",
    },
    "b1937f6b-daa0-47ba-9b32-0f92dd74cb11": {
        dbColumn: "videoChangesCount",
        type: "number",
        parseAs: "integer",
    },
    // H1. Video Duration — whole-minute number on the task.
    "078391c1-a0f9-40bc-9f8c-e3073e5dbb23": {
        dbColumn: "videoDuration",
        type: "number",
        parseAs: "integer",
    },

    // ═══ VIDEO QA PHASE ═══
    "d9e2cd06-8d50-4fda-bffd-d55a84816118": {
        dbColumn: "qaVideoMeetingDate",
        type: "date",
        parseAs: "timestamp",
    },
    "417d2a71-6560-48ca-96d6-ceec88471cc0": {
        dbColumn: "editorQualityScore",
        type: "number",
        parseAs: "integer",
    },
    "b53368a4-8fb7-448b-898b-38a19d55b732": {
        dbColumn: "editorDeliveryTime",
        type: "drop_down",
        parseAs: "dropdown_name",
    },
    "f680455e-f11e-41ef-af65-d16ab0e2f419": {
        dbColumn: "editorEfficiencyScore",
        type: "drop_down",
        parseAs: "dropdown_name",
    },
    "7c027546-b422-482b-ad5b-eb9ebd3aa6cd": {
        dbColumn: "finalVideoRating",
        type: "formula",
        parseAs: "decimal",
    },

    // ═══ FINAL VIDEO PHASE ═══
    "d50cb737-e821-4cc3-805e-265861526fab": {
        dbColumn: "videoQualityRating",
        type: "drop_down",
        parseAs: "dropdown_name_as_decimal",
    },
    "9f304623-7df7-422f-a233-d8027ef2f80b": {
        dbColumn: "videoRatingReason",
        type: "text",
        parseAs: "string",
    },
    "e3981c1d-dd98-4816-9a00-7307582b79d3": {
        dbColumn: "channel",
        type: "drop_down",
        parseAs: "dropdown_name",
    },
    "40262e2b-8ea0-44f3-b823-318c0f0bd079": {
        dbColumn: "finalVideoLink",
        type: "url",
        parseAs: "string",
    },
    "a0731775-031b-4414-893c-e85b011fb9a3": {
        dbColumn: "uploadDate",
        type: "date",
        parseAs: "timestamp",
    },
    // X. Youtube video link — also handled by a name-match special-case in
    // sync-engine.ts; mapped here by UUID too so it's explicit + cross-checks clean.
    "7994db7e-6b67-40eb-bb7c-96f2c6892fa6": {
        dbColumn: "youtubeVideoUrl",
        type: "url",
        parseAs: "string",
    },

    // ═══ HELPER / FORMULA FIELDS ═══
    "8d9e395f-4b28-4bd7-9869-f6bc373b4504": {
        dbColumn: "helperEditorE",
        type: "number",
        parseAs: "integer",
    },
    "7c73491a-5215-495c-bf08-a24230461079": {
        dbColumn: "helperEditorT",
        type: "number",
        parseAs: "integer",
    },
    "112dece7-5ba0-4cea-8033-8fa63b715ee5": {
        dbColumn: "helperWriterE",
        type: "number",
        parseAs: "integer",
    },
    "1180c8f0-299d-4eac-8df0-446011ec2db4": {
        dbColumn: "helperWriterT",
        type: "number",
        parseAs: "integer",
    },

    // ═══ TAT (Turnaround Time) ═══
    "aa925898-0dad-454f-8c9f-7c1d0610d0cb": {
        dbColumn: "caseStartDate",
        type: "date",
        parseAs: "timestamp",
    },
    "8ca1db3a-5ef1-4bcf-acc6-88238f97ebbc": {
        dbColumn: "caseCompletionDate",
        type: "date",
        parseAs: "timestamp",
    },
    "b400df00-90c9-41f7-8a4b-f075a47f37ee": {
        dbColumn: "overallTat",
        type: "formula",
        parseAs: "decimal",
    },
    "3b0a3c86-2af2-4593-9dea-f144bb4f2915": {
        dbColumn: "tat",
        type: "formula",
        parseAs: "decimal",
    },
};

// User-type fields that need special resolution
export const USER_FIELDS = new Set(["researcherUserId", "writerUserId", "editorUserId"]);
