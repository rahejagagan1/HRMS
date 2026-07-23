const fs = require('fs');
const p = 'd:/Arpit Sharma/Desktop/project 1/nb project/src/app/dashboard/reports/[managerId]/weekly/[week]/page.tsx';
let c = fs.readFileSync(p, 'utf8');

/* ── 1. Add ResearcherRow interface & update QuickOverviewRow ── */
c = c.replace(
`interface QuickOverviewRow {
    id: string;
    winOfWeek: string;
    roadblock: string;
    remark: string;
}`,
`interface QuickOverviewRow {
    id: string;
    weekDateRange: string;
    winOfWeek: string;
    roadblock: string;
    researcherOfWeek: string;
    totalFoiaPitched: string;
    totalFoiaReceived: string;
    totalFinalCases: string;
    reasonVariance: string;
    fiveStarCases: string;
    fiveStarRemarks: string;
    remark: string;
}

interface ResearcherRow {
    id: string;
    researcher: string;
    dailyTargetsMet: string;
    approvedCasesRTC: string;
    avgRating: string;
    foiaPitched: string;
    foiaReceived: string;
    overallRemarks: string;
}`
);

/* ── 2. Update mkOverview & add mkResearcher ── */
c = c.replace(
`const mkOverview = (id: string): QuickOverviewRow => ({ id, winOfWeek: "", roadblock: "", remark: "" });`,
`const mkOverview = (id: string): QuickOverviewRow => ({
    id, weekDateRange: "", winOfWeek: "", roadblock: "",
    researcherOfWeek: "", totalFoiaPitched: "", totalFoiaReceived: "",
    totalFinalCases: "", reasonVariance: "", fiveStarCases: "", fiveStarRemarks: "", remark: "",
});
const mkResearcher = (id: string, name = ""): ResearcherRow => ({
    id, researcher: name, dailyTargetsMet: "", approvedCasesRTC: "",
    avgRating: "", foiaPitched: "", foiaReceived: "", overallRemarks: "",
});`
);

/* ── 3. Update SectionKey & SECTIONS ── */
c = c.replace(
`type SectionKey = "a1" | "a2" | "b";
const SECTIONS: { key: SectionKey; label: string; sub: string }[] = [
    { key: "a1", label: "Section A1", sub: "Writers"  },
    { key: "a2", label: "Section A2", sub: "Editors"  },
    { key: "b",  label: "Section B",  sub: "Overview" },
];`,
`type SectionKey = "a1" | "a2" | "a3" | "b";
const SECTIONS: { key: SectionKey; label: string; sub: string }[] = [
    { key: "a1", label: "Section A1", sub: "Writers"     },
    { key: "a2", label: "Section A2", sub: "Editors"     },
    { key: "a3", label: "Section A",  sub: "Researchers" },
    { key: "b",  label: "Section B",  sub: "Overview"    },
];`
);

/* ── 4. Add researcherRows state after overviewRows state ── */
c = c.replace(
`    /* Quick Overview (B) */
    const [overviewRows, setOverviewRows] = useState<QuickOverviewRow[]>([mkOverview("o-1")]);
    const setO = (idx: number, f: keyof QuickOverviewRow, v: string) =>
        setOverviewRows((p) => p.map((r, i) => i === idx ? { ...r, [f]: v } : r));
    const addO    = () => setOverviewRows((p) => [...p, mkOverview(\`o-\${Date.now()}\`)]);
    const removeO = (idx: number) => setOverviewRows((p) => p.filter((_, i) => i !== idx));`,
`    /* Quick Overview (B) */
    const [overviewRows, setOverviewRows] = useState<QuickOverviewRow[]>([mkOverview("o-1")]);
    const setO = (idx: number, f: keyof QuickOverviewRow, v: string) =>
        setOverviewRows((p) => p.map((r, i) => i === idx ? { ...r, [f]: v } : r));
    const addO    = () => setOverviewRows((p) => [...p, mkOverview(\`o-\${Date.now()}\`)]);
    const removeO = (idx: number) => setOverviewRows((p) => p.filter((_, i) => i !== idx));

    /* Researchers (A3) */
    const [researcherRows, setResearcherRows] = useState<ResearcherRow[]>([mkResearcher("r-1")]);
    const setR = (idx: number, f: keyof ResearcherRow, v: string) =>
        setResearcherRows((p) => p.map((r, i) => i === idx ? { ...r, [f]: v } : r));
    const addR    = () => setResearcherRows((p) => [...p, mkResearcher(\`r-\${Date.now()}\`)]);
    const removeR = (idx: number) => setResearcherRows((p) => p.filter((_, i) => i !== idx));`
);

/* ── 5. Restore researcherRows on load ── */
c = c.replace(
`                    if (saved?.writerRows)   setWriterRows(saved.writerRows);
                    if (saved?.clickUpRows)  setClickUpRows(saved.clickUpRows);
                    if (saved?.overviewRows) setOverviewRows(saved.overviewRows);`,
`                    if (saved?.writerRows)      setWriterRows(saved.writerRows);
                    if (saved?.clickUpRows)     setClickUpRows(saved.clickUpRows);
                    if (saved?.overviewRows)    setOverviewRows(saved.overviewRows);
                    if (saved?.researcherRows)  setResearcherRows(saved.researcherRows);`
);

/* ── 6. Include researcherRows in POST body ── */
c = c.replace(
`                    writerRows:   wRows,
                    clickUpRows:  cRows,
                    overviewRows,`,
`                    writerRows:      wRows,
                    clickUpRows:     cRows,
                    overviewRows,
                    researcherRows,`
);

/* ── 7. Update sectionMap ── */
c = c.replace(
`    const sectionMap: Record<SectionKey, () => React.ReactNode> = {
        a1: renderA1,
        a2: renderA2,
        b:  renderB,
    };`,
`    const sectionMap: Record<SectionKey, () => React.ReactNode> = {
        a1: renderA1,
        a2: renderA2,
        a3: renderA3,
        b:  renderB,
    };`
);

/* ── 8. Update tab accent colors ── */
c = c.replace(
`                            const accent = s.key === "a1" ? "bg-amber-500"
                                         : s.key === "a2" ? "bg-sky-500"
                                         : "bg-violet-500";`,
`                            const accent = s.key === "a1" ? "bg-amber-500"
                                         : s.key === "a2" ? "bg-sky-500"
                                         : s.key === "a3" ? "bg-orange-500"
                                         : "bg-violet-500";`
);

/* ── 9. Replace Section B renderer with Image 2 format & add renderA3 ── */
const oldRenderB = `    /* ── Section B ── */
    const renderB = () => (
        <div>
            <div className="mb-3 rounded-t-lg bg-amber-500 px-4 py-2 flex items-center gap-3">
                <h2 className="text-base font-bold text-white">Section B: Quick Overview</h2>
                <span className="text-[11px] text-amber-100 font-medium">Fields marked <span className="text-white font-bold">*</span> are required</span>
            </div>
            <div className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 shadow-sm">
                <table className="border-collapse w-full" style={{ minWidth: 860 }}>
                    <colgroup>
                        <col style={{ minWidth: 160 }} />
                        <col style={{ minWidth: 100 }} />
                        <col style={{ minWidth: 260 }} />
                        <col style={{ minWidth: 260 }} />
                        <col style={{ minWidth: 200 }} />
                        <col style={{ minWidth: 40  }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <ResizableTh colIndex={0} widths={oColWidths} setWidths={setOColWidths}>Month</ResizableTh>
                            <ResizableTh colIndex={1} widths={oColWidths} setWidths={setOColWidths}>Win of the week? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={2} widths={oColWidths} setWidths={setOColWidths}>Roadblock of the week? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={3} widths={oColWidths} setWidths={setOColWidths}><span className="text-amber-200 italic text-[10px] font-medium">Remark (optional)</span></ResizableTh>
                            <Th>{" "}</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {overviewRows.map((row, idx) => (
                            <tr key={row.id} className="group hover:bg-violet-50/60 transition-colors">
                                <Td muted>
                                    <span className="font-medium text-slate-700 text-[13px] leading-tight block">
                                        {idx === 0 ? periodLabel : ""}
                                    </span>
                                </Td>
                                <Td><EditInput value={row.winOfWeek} onChange={(v) => setO(idx, "winOfWeek", v)} placeholder="Win of the week…" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.roadblock} onChange={(v) => setO(idx, "roadblock", v)} placeholder="Roadblock of the week…" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.remark} onChange={(v) => setO(idx, "remark", v)} placeholder="Optional remark…" disabled={isLocked || viewOnly} /></Td>
                                <td className="px-2 py-2 border border-slate-200 bg-white text-center align-middle">
                                    {overviewRows.length > 1 && !isLocked && !viewOnly && <RemoveBtn onClick={() => removeO(idx)} />}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {!isLocked && !viewOnly && (
                <button onClick={addO} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-700 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Add row
                </button>
            )}
        </div>
    );`;

const newRenderers = `    /* ── Section A3: Performance of Researchers ── */
    const renderA3 = () => (
        <div>
            <div className="mb-3 rounded-t-lg px-4 py-2 flex items-center gap-3" style={{ background: "linear-gradient(90deg, #e87722 0%, #c95f00 100%)" }}>
                <h2 className="text-base font-bold text-white">Section A: Performance of Researchers</h2>
                <span className="text-[11px] text-orange-100 font-medium">Fields marked <span className="text-white font-bold">*</span> are required</span>
            </div>
            <div className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 shadow-sm">
                <table className="border-collapse w-full" style={{ minWidth: 1100 }}>
                    <colgroup>
                        <col style={{ minWidth: 90  }} />
                        <col style={{ minWidth: 150 }} />
                        <col style={{ minWidth: 220 }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 200 }} />
                        <col style={{ minWidth: 40  }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <ResizableTh colIndex={0} widths={oColWidths} setWidths={setOColWidths}>Month</ResizableTh>
                            <ResizableTh colIndex={1} widths={oColWidths} setWidths={setOColWidths}>Researcher <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={2} widths={oColWidths} setWidths={setOColWidths}>Is the researcher completing his daily targets? If not so why? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={3} widths={oColWidths} setWidths={setOColWidths}>No. of Approved Cases (RTC) <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={4} widths={oColWidths} setWidths={setOColWidths}>Average rating of the cases <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={5} widths={oColWidths} setWidths={setOColWidths}>No. of FOIA pitched? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={6} widths={oColWidths} setWidths={setOColWidths}>No. of FOIA received <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={7} widths={oColWidths} setWidths={setOColWidths}>Overall Remarks</ResizableTh>
                            <Th>{" "}</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {researcherRows.map((row, idx) => (
                            <tr key={row.id} className="group hover:bg-orange-50/60 transition-colors">
                                <Td muted>
                                    <span className="font-medium text-slate-700 text-[13px] leading-tight block">
                                        {idx === 0 ? monthName : ""}
                                    </span>
                                </Td>
                                <Td highlight><EditInput value={row.researcher} onChange={(v) => setR(idx, "researcher", v)} placeholder="Researcher name" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.dailyTargetsMet} onChange={(v) => setR(idx, "dailyTargetsMet", v)} placeholder="Yes / No — reason if no" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.approvedCasesRTC} onChange={(v) => setR(idx, "approvedCasesRTC", v)} placeholder="N/A or number" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.avgRating} onChange={(v) => setR(idx, "avgRating", v)} placeholder="e.g. 4 / 5" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.foiaPitched} onChange={(v) => setR(idx, "foiaPitched", v)} placeholder="e.g. 10" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.foiaReceived} onChange={(v) => setR(idx, "foiaReceived", v)} placeholder="e.g. 2 + 1" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.overallRemarks} onChange={(v) => setR(idx, "overallRemarks", v)} placeholder="Overall remarks…" disabled={isLocked || viewOnly} /></Td>
                                <td className="px-2 py-2 border border-slate-200 bg-white text-center align-middle">
                                    {researcherRows.length > 1 && !isLocked && !viewOnly && <RemoveBtn onClick={() => removeR(idx)} />}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {!isLocked && !viewOnly && (
                <button onClick={addR} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-orange-600 hover:text-orange-700 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Add researcher row
                </button>
            )}
        </div>
    );

    /* ── Section B: Quick Overview ── */
    const renderB = () => (
        <div>
            <div className="mb-3 rounded-t-lg bg-violet-600 px-4 py-2 flex items-center gap-3">
                <h2 className="text-base font-bold text-white">Section B: Quick Overview</h2>
                <span className="text-[11px] text-violet-200 font-medium">Fields marked <span className="text-white font-bold">*</span> are required</span>
            </div>
            <div className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 shadow-sm">
                <table className="border-collapse w-full" style={{ minWidth: 1400 }}>
                    <colgroup>
                        <col style={{ minWidth: 90  }} />
                        <col style={{ minWidth: 160 }} />
                        <col style={{ minWidth: 200 }} />
                        <col style={{ minWidth: 220 }} />
                        <col style={{ minWidth: 140 }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 160 }} />
                        <col style={{ minWidth: 110 }} />
                        <col style={{ minWidth: 160 }} />
                        <col style={{ minWidth: 40  }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <ResizableTh colIndex={0} widths={oColWidths} setWidths={setOColWidths}>Month</ResizableTh>
                            <ResizableTh colIndex={1} widths={oColWidths} setWidths={setOColWidths}>Week <span className="text-violet-300 font-normal text-[10px]">(Date Range)</span></ResizableTh>
                            <ResizableTh colIndex={2} widths={oColWidths} setWidths={setOColWidths}>Win from the last week <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={3} widths={oColWidths} setWidths={setOColWidths}>Roadblock from the last week <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={4} widths={oColWidths} setWidths={setOColWidths}>Researcher of the week</ResizableTh>
                            <ResizableTh colIndex={5} widths={oColWidths} setWidths={setOColWidths}>Total FOIA pitched? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={6} widths={oColWidths} setWidths={setOColWidths}>Total FOIA received? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={7} widths={oColWidths} setWidths={setOColWidths}>Total final cases <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={8} widths={oColWidths} setWidths={setOColWidths}>Reason for variance or gap?</ResizableTh>
                            <ResizableTh colIndex={9} widths={oColWidths} setWidths={setOColWidths}>No. of 5 star cases</ResizableTh>
                            <ResizableTh colIndex={10} widths={oColWidths} setWidths={setOColWidths}>Remarks, if any 5 star existed?</ResizableTh>
                            <Th>{" "}</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {overviewRows.map((row, idx) => (
                            <tr key={row.id} className="group hover:bg-violet-50/60 transition-colors">
                                <Td muted>
                                    <span className="font-medium text-slate-700 text-[13px] leading-tight block">
                                        {idx === 0 ? monthName : ""}
                                    </span>
                                </Td>
                                <Td muted><EditInput value={row.weekDateRange} onChange={(v) => setO(idx, "weekDateRange", v)} placeholder="e.g. 01/03/2025 – 07/03/2025 (5 days)" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.winOfWeek} onChange={(v) => setO(idx, "winOfWeek", v)} placeholder="Win from last week…" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.roadblock} onChange={(v) => setO(idx, "roadblock", v)} placeholder="Roadblock…" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.researcherOfWeek} onChange={(v) => setO(idx, "researcherOfWeek", v)} placeholder="Name" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.totalFoiaPitched} onChange={(v) => setO(idx, "totalFoiaPitched", v)} placeholder="e.g. 15 (pitched) + 30" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.totalFoiaReceived} onChange={(v) => setO(idx, "totalFoiaReceived", v)} placeholder="e.g. 2 + 1" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.totalFinalCases} onChange={(v) => setO(idx, "totalFinalCases", v)} placeholder="e.g. 8 RTC + 28 FOIA" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.reasonVariance} onChange={(v) => setO(idx, "reasonVariance", v)} placeholder="Reason for variance…" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.fiveStarCases} onChange={(v) => setO(idx, "fiveStarCases", v)} placeholder="N/A or number" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.fiveStarRemarks} onChange={(v) => setO(idx, "fiveStarRemarks", v)} placeholder="Remarks…" disabled={isLocked || viewOnly} /></Td>
                                <td className="px-2 py-2 border border-slate-200 bg-white text-center align-middle">
                                    {overviewRows.length > 1 && !isLocked && !viewOnly && <RemoveBtn onClick={() => removeO(idx)} />}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {!isLocked && !viewOnly && (
                <button onClick={addO} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-700 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Add row
                </button>
            )}
        </div>
    );`;

c = c.replace(oldRenderB, newRenderers);

fs.writeFileSync(p, c, 'utf8');

const ok = c.includes('ResearcherRow') && c.includes('renderA3') && c.includes('researcherOfWeek') && c.includes('totalFoiaPitched');
console.log('All sections added:', ok);
console.log('Section A3 tab:', c.includes('"a3", label: "Section A"'));
console.log('Section B updated:', c.includes('totalFinalCases'));
