import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";

// Style constants
const HEADER_FILL: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1A1A2E" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
    bold: true,
    color: { argb: "FFFFFFFF" },
    size: 11,
};

const ALT_ROW_FILL: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF8F9FA" },
};

function styleHeaders(sheet: ExcelJS.Worksheet) {
    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = {
            bottom: { style: "thin", color: { argb: "FF333333" } },
        };
    });
    headerRow.height = 28;
}

function autoWidth(sheet: ExcelJS.Worksheet) {
    sheet.columns.forEach((col) => {
        let maxLen = 10;
        col.eachCell?.({ includeEmpty: true }, (cell) => {
            const raw = cell.value;
            let text = "";
            if (raw === null || raw === undefined) return;
            if (typeof raw === "object" && "text" in raw) {
                text = String((raw as any).text);
            } else if (raw instanceof Date) {
                text = raw.toLocaleDateString();
            } else {
                text = String(raw);
            }
            if (text.length > maxLen) maxLen = Math.min(text.length, 60);
        });
        col.width = maxLen + 4;
    });
}

function alternateRows(sheet: ExcelJS.Worksheet) {
    sheet.eachRow((row, idx) => {
        if (idx > 1 && idx % 2 === 0) {
            row.eachCell((cell) => {
                cell.fill = ALT_ROW_FILL;
            });
        }
    });
}

function bigIntToNum(val: bigint | null | undefined): number {
    if (val === null || val === undefined) return 0;
    return Number(val);
}

function decToNum(val: any): number | null {
    if (val === null || val === undefined) return null;
    return Number(val);
}

// ═══ Per-Person Export ═══
export async function generatePersonExcel(userId: number): Promise<Buffer> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            monthlyRatings: { orderBy: { month: "desc" }, take: 12 },
        },
    });

    if (!user) throw new Error("User not found");

    const cases = await prisma.case.findMany({
        where: {
            OR: [
                { writerUserId: userId },
                { editorUserId: userId },
                { researcherUserId: userId },
                { assigneeUserId: userId },
            ],
        },
        include: { youtubeStats: true, subtasks: true, productionList: { include: { capsule: true } } },
        orderBy: { dateCreated: "desc" },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "NB Dashboard";
    workbook.created = new Date();

    // Sheet 1: Profile
    const profileSheet = workbook.addWorksheet("Profile");
    profileSheet.columns = [
        { header: "Field", key: "field", width: 25 },
        { header: "Value", key: "value", width: 40 },
    ];
    profileSheet.addRow({ field: "Name", value: user.name });
    profileSheet.addRow({ field: "Email", value: user.email });
    profileSheet.addRow({ field: "Role", value: user.role });
    profileSheet.addRow({ field: "Capsule", value: user.teamCapsule || "N/A" });
    profileSheet.addRow({ field: "Total Cases", value: cases.length });
    if (user.monthlyRatings.length > 0) {
        profileSheet.addRow({
            field: "Latest Rating",
            value: decToNum(user.monthlyRatings[0].overallRating) || "N/A",
        });
        profileSheet.addRow({
            field: "Latest Rank",
            value: user.monthlyRatings[0].rankInRole || "N/A",
        });
    }
    styleHeaders(profileSheet);
    alternateRows(profileSheet);
    autoWidth(profileSheet);

    // Sheet 2: Cases
    const casesSheet = workbook.addWorksheet("Cases");
    casesSheet.columns = [
        { header: "Case Name", key: "name", width: 35 },
        { header: "Status", key: "status", width: 15 },
        { header: "Channel", key: "channel", width: 12 },
        { header: "Capsule", key: "capsule", width: 15 },
        { header: "Case Rating", key: "caseRating", width: 12 },
        { header: "Script Rating", key: "scriptRating", width: 14 },
        { header: "Video Rating", key: "videoRating", width: 14 },
        { header: "YT Views", key: "views", width: 12 },
        { header: "TAT (days)", key: "tat", width: 12 },
        { header: "Date Created", key: "dateCreated", width: 14 },
    ];
    for (const c of cases) {
        casesSheet.addRow({
            name: c.name,
            status: c.status,
            channel: c.channel || "",
            capsule: c.productionList?.capsule?.shortName || "",
            caseRating: decToNum(c.caseRating),
            scriptRating: decToNum(c.scriptQualityRating),
            videoRating: decToNum(c.videoQualityRating),
            views: bigIntToNum(c.youtubeStats?.viewCount),
            tat: decToNum(c.tat),
            dateCreated: c.dateCreated,
        });
    }
    styleHeaders(casesSheet);
    alternateRows(casesSheet);
    autoWidth(casesSheet);

    // Sheet 3: Monthly Ratings
    const ratingsSheet = workbook.addWorksheet("Monthly Ratings");
    ratingsSheet.columns = [
        { header: "Month", key: "month", width: 14 },
        { header: "Role", key: "role", width: 12 },
        { header: "Cases", key: "cases", width: 8 },
        { header: "Avg Quality", key: "quality", width: 12 },
        { header: "Avg Delivery", key: "delivery", width: 12 },
        { header: "Avg Efficiency", key: "efficiency", width: 14 },
        { header: "Total Views", key: "views", width: 12 },
        { header: "Overall Rating", key: "rating", width: 14 },
        { header: "Rank", key: "rank", width: 8 },
    ];
    for (const r of user.monthlyRatings) {
        ratingsSheet.addRow({
            month: r.month,
            role: r.roleType,
            cases: r.casesCompleted,
            quality: decToNum(r.avgQualityScore),
            delivery: decToNum(r.avgDeliveryScore),
            efficiency: decToNum(r.avgEfficiencyScore),
            views: bigIntToNum(r.totalViews),
            rating: decToNum(r.overallRating),
            rank: r.rankInRole,
        });
    }
    styleHeaders(ratingsSheet);
    alternateRows(ratingsSheet);
    autoWidth(ratingsSheet);

    // Sheet 4: Subtask History
    const subtaskSheet = workbook.addWorksheet("Subtask History");
    subtaskSheet.columns = [
        { header: "Case Name", key: "caseName", width: 30 },
        { header: "Subtask", key: "subtask", width: 25 },
        { header: "Status", key: "status", width: 12 },
        { header: "Start Date", key: "startDate", width: 14 },
        { header: "Due Date", key: "dueDate", width: 14 },
        { header: "Done Date", key: "doneDate", width: 14 },
    ];
    for (const c of cases) {
        for (const s of c.subtasks) {
            subtaskSheet.addRow({
                caseName: c.name,
                subtask: s.name,
                status: s.status,
                startDate: s.startDate,
                dueDate: s.dueDate,
                doneDate: s.dateDone,
            });
        }
    }
    styleHeaders(subtaskSheet);
    alternateRows(subtaskSheet);
    autoWidth(subtaskSheet);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

// ═══ Team Export ═══
export async function generateTeamExcel(capsuleId: number): Promise<Buffer> {
    const capsule = await prisma.capsule.findUnique({
        where: { id: capsuleId },
        include: {
            productionLists: {
                include: {
                    cases: {
                        include: {
                            writer: true,
                            editor: true,
                            youtubeStats: true,
                        },
                    },
                },
            },
        },
    });

    if (!capsule) throw new Error("Capsule not found");

    const allCases = capsule.productionLists.flatMap((l) => l.cases);
    const memberIds = new Set<number>();
    allCases.forEach((c) => {
        if (c.writerUserId) memberIds.add(c.writerUserId);
        if (c.editorUserId) memberIds.add(c.editorUserId);
        if (c.assigneeUserId) memberIds.add(c.assigneeUserId);
    });

    const members = await prisma.user.findMany({
        where: { id: { in: Array.from(memberIds) } },
        include: { monthlyRatings: { orderBy: { month: "desc" }, take: 1 } },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "NB Dashboard";

    // Sheet 1: Team Overview
    const overviewSheet = workbook.addWorksheet("Team Overview");
    overviewSheet.columns = [
        { header: "Name", key: "name", width: 25 },
        { header: "Role", key: "role", width: 12 },
        { header: "Cases", key: "cases", width: 8 },
        { header: "Rating", key: "rating", width: 10 },
        { header: "Rank", key: "rank", width: 8 },
    ];
    for (const m of members) {
        const memberCases = allCases.filter(
            (c) => c.writerUserId === m.id || c.editorUserId === m.id
        );
        overviewSheet.addRow({
            name: m.name,
            role: m.role,
            cases: memberCases.length,
            rating: m.monthlyRatings[0]
                ? decToNum(m.monthlyRatings[0].overallRating)
                : null,
            rank: m.monthlyRatings[0]?.rankInRole || null,
        });
    }
    styleHeaders(overviewSheet);
    alternateRows(overviewSheet);
    autoWidth(overviewSheet);

    // Sheet 2: All Cases
    const casesSheet = workbook.addWorksheet("All Cases");
    casesSheet.columns = [
        { header: "Case Name", key: "name", width: 35 },
        { header: "Status", key: "status", width: 15 },
        { header: "Channel", key: "channel", width: 12 },
        { header: "Writer", key: "writer", width: 20 },
        { header: "Editor", key: "editor", width: 20 },
        { header: "Script Rating", key: "scriptRating", width: 14 },
        { header: "Video Rating", key: "videoRating", width: 14 },
        { header: "YT Views", key: "views", width: 12 },
        { header: "TAT", key: "tat", width: 10 },
    ];
    for (const c of allCases) {
        casesSheet.addRow({
            name: c.name,
            status: c.status,
            channel: c.channel || "",
            writer: c.writer?.name || "",
            editor: c.editor?.name || "",
            scriptRating: decToNum(c.scriptQualityRating),
            videoRating: decToNum(c.videoQualityRating),
            views: bigIntToNum(c.youtubeStats?.viewCount),
            tat: decToNum(c.tat),
        });
    }
    styleHeaders(casesSheet);
    alternateRows(casesSheet);
    autoWidth(casesSheet);

    // Sheet 3: YouTube Performance
    const ytSheet = workbook.addWorksheet("YouTube Performance");
    ytSheet.columns = [
        { header: "Case Name", key: "name", width: 35 },
        { header: "Channel", key: "channel", width: 12 },
        { header: "Views", key: "views", width: 12 },
        { header: "Likes", key: "likes", width: 10 },
        { header: "Comments", key: "comments", width: 10 },
        { header: "Published", key: "published", width: 14 },
    ];
    for (const c of allCases.filter((c) => c.youtubeStats)) {
        ytSheet.addRow({
            name: c.name,
            channel: c.channel || "",
            views: bigIntToNum(c.youtubeStats?.viewCount),
            likes: bigIntToNum(c.youtubeStats?.likeCount),
            comments: bigIntToNum(c.youtubeStats?.commentCount),
            published: c.youtubeStats?.publishedAt,
        });
    }
    styleHeaders(ytSheet);
    alternateRows(ytSheet);
    autoWidth(ytSheet);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

// ═══ Company Export ═══
export async function generateCompanyExcel(): Promise<Buffer> {
    const allCases = await prisma.case.findMany({
        include: {
            writer: true,
            editor: true,
            youtubeStats: true,
            productionList: { include: { capsule: true } },
        },
        orderBy: { dateCreated: "desc" },
    });

    const allRatings = await prisma.monthlyRating.findMany({
        where: { user: { isActive: true } },
        include: { user: true },
        orderBy: [{ month: "desc" }, { overallRating: "desc" }],
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "NB Dashboard";

    // Sheet 1: KPIs
    const kpiSheet = workbook.addWorksheet("KPIs");
    kpiSheet.columns = [
        { header: "Metric", key: "metric", width: 30 },
        { header: "Value", key: "value", width: 20 },
    ];
    const totalViews = allCases.reduce(
        (sum, c) => sum + bigIntToNum(c.youtubeStats?.viewCount),
        0
    );
    kpiSheet.addRow({ metric: "Total Cases", value: allCases.length });
    kpiSheet.addRow({ metric: "Published Cases", value: allCases.filter((c) => c.youtubeStats).length });
    kpiSheet.addRow({ metric: "Total YouTube Views", value: totalViews });
    kpiSheet.addRow({
        metric: "Avg TAT (days)",
        value: (
            allCases.reduce((sum, c) => sum + (decToNum(c.tat) || 0), 0) /
            Math.max(allCases.filter((c) => c.tat).length, 1)
        ).toFixed(1),
    });
    styleHeaders(kpiSheet);
    alternateRows(kpiSheet);
    autoWidth(kpiSheet);

    // Sheet 2: All Cases
    const casesSheet = workbook.addWorksheet("All Cases");
    casesSheet.columns = [
        { header: "Case Name", key: "name", width: 35 },
        { header: "Status", key: "status", width: 15 },
        { header: "Channel", key: "channel", width: 12 },
        { header: "Capsule", key: "capsule", width: 15 },
        { header: "Writer", key: "writer", width: 20 },
        { header: "Editor", key: "editor", width: 20 },
        { header: "Script Rating", key: "scriptRating", width: 14 },
        { header: "Video Rating", key: "videoRating", width: 14 },
        { header: "YT Views", key: "views", width: 12 },
        { header: "TAT", key: "tat", width: 10 },
        { header: "Date Created", key: "dateCreated", width: 14 },
    ];
    for (const c of allCases) {
        casesSheet.addRow({
            name: c.name,
            status: c.status,
            channel: c.channel || "",
            capsule: c.productionList?.capsule?.shortName || "",
            writer: c.writer?.name || "",
            editor: c.editor?.name || "",
            scriptRating: decToNum(c.scriptQualityRating),
            videoRating: decToNum(c.videoQualityRating),
            views: bigIntToNum(c.youtubeStats?.viewCount),
            tat: decToNum(c.tat),
            dateCreated: c.dateCreated,
        });
    }
    styleHeaders(casesSheet);
    alternateRows(casesSheet);
    autoWidth(casesSheet);

    // Sheet 3: Channel Performance
    const channelSheet = workbook.addWorksheet("Channel Performance");
    channelSheet.columns = [
        { header: "Channel", key: "channel", width: 15 },
        { header: "Cases", key: "cases", width: 8 },
        { header: "Avg Views", key: "avgViews", width: 12 },
        { header: "Avg Rating", key: "avgRating", width: 12 },
        { header: "Total Views", key: "totalViews", width: 14 },
    ];
    const channels = ["M7", "M7CS", "Bodycam", "3D Documentry", "New Channel"];
    for (const ch of channels) {
        const chCases = allCases.filter((c) => c.channel === ch);
        const chViews = chCases.reduce(
            (sum, c) => sum + bigIntToNum(c.youtubeStats?.viewCount),
            0
        );
        channelSheet.addRow({
            channel: ch,
            cases: chCases.length,
            avgViews: chCases.length > 0 ? Math.round(chViews / chCases.length) : 0,
            avgRating: chCases.length > 0
                ? (
                    chCases.reduce((sum, c) => sum + (decToNum(c.videoQualityRating) || 0), 0) /
                    chCases.filter((c) => c.videoQualityRating).length || 1
                ).toFixed(2)
                : "N/A",
            totalViews: chViews,
        });
    }
    styleHeaders(channelSheet);
    alternateRows(channelSheet);
    autoWidth(channelSheet);

    // Sheet 4: Full Leaderboard
    const leaderSheet = workbook.addWorksheet("Full Leaderboard");
    leaderSheet.columns = [
        { header: "Name", key: "name", width: 25 },
        { header: "Role", key: "role", width: 12 },
        { header: "Month", key: "month", width: 14 },
        { header: "Cases", key: "cases", width: 8 },
        { header: "Rating", key: "rating", width: 10 },
        { header: "Rank", key: "rank", width: 8 },
        { header: "Total Views", key: "views", width: 14 },
    ];
    for (const r of allRatings) {
        leaderSheet.addRow({
            name: r.user.name,
            role: r.roleType,
            month: r.month,
            cases: r.casesCompleted,
            rating: decToNum(r.overallRating),
            rank: r.rankInRole,
            views: bigIntToNum(r.totalViews),
        });
    }
    styleHeaders(leaderSheet);
    alternateRows(leaderSheet);
    autoWidth(leaderSheet);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}
