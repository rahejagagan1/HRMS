const fs = require('fs');
const p = 'd:/Arpit Sharma/Desktop/project 1/nb project/src/app/dashboard/reports/[managerId]/monthly/[month]/page.tsx';
let c = fs.readFileSync(p, 'utf8');

// ── 1. Add interfaces at top (after existing interfaces) ──
const interfaceInsert = `
interface NishantResearcherRow {
    id: string;
    researcher: string;
    approvedCasesRTC: string;
    avgRating: string;
    approvedCasesFOIA: string;
    expectedTargetRTC: string;
    expectedFOIAPitched: string;
    actualFOIAPitched: string;
    foiaReceived: string;
    overallRemarks: string;
}

interface NishantOverview {
    totalCasesRTC: string;
    avgCaseRating: string;
    totalCasesFOIA: string;
    totalExpectedTargetRTC: string;
    totalExpectedFOIAPitched: string;
    totalFOIAPitched: string;
    totalFOIAReceived: string;
    monthlyDeadlineMet: string;
}

const mkNishantRow = (id: string, name = ""): NishantResearcherRow => ({
    id, researcher: name, approvedCasesRTC: "", avgRating: "",
    approvedCasesFOIA: "", expectedTargetRTC: "", expectedFOIAPitched: "",
    actualFOIAPitched: "", foiaReceived: "", overallRemarks: "",
});

const defaultNishantOverview = (): NishantOverview => ({
    totalCasesRTC: "", avgCaseRating: "", totalCasesFOIA: "",
    totalExpectedTargetRTC: "", totalExpectedFOIAPitched: "",
    totalFOIAPitched: "", totalFOIAReceived: "", monthlyDeadlineMet: "",
});
`;

// Insert before the component function
c = c.replace(
    'export default function MonthlyReportPage() {',
    interfaceInsert + 'export default function MonthlyReportPage() {'
);

// ── 2. Add Nishant state after existing state variables ──
c = c.replace(
    `    const [remark, setRemark] = useState("");`,
    `    const [remark, setRemark] = useState("");

    // ── Nishant Bhatia monthly researcher state ──
    const [nishantRows, setNishantRows] = useState<NishantResearcherRow[]>([mkNishantRow("nr-1")]);
    const [nishantOverview, setNishantOverview] = useState<NishantOverview>(defaultNishantOverview());
    const setNR = (idx: number, f: keyof NishantResearcherRow, v: string) =>
        setNishantRows(p => p.map((r, i) => i === idx ? { ...r, [f]: v } : r));
    const setNO = (f: keyof NishantOverview, v: string) =>
        setNishantOverview(p => ({ ...p, [f]: v }));
    const addNR    = () => setNishantRows(p => [...p, mkNishantRow(\`nr-\${Date.now()}\`)]);
    const removeNR = (idx: number) => setNishantRows(p => p.filter((_, i) => i !== idx));`
);

// ── 3. Add isNishant check after data fetch ──
c = c.replace(
    `    const editors = useMemo(() => {`,
    `    const manager = data?.manager;
    const isNishant = !isLoading && (manager?.name?.toLowerCase().includes("nishant") ?? false);

    const editors = useMemo(() => {`
);

// ── 4. Restore Nishant data on load ──
c = c.replace(
    `                    if (saved?.remark)             setRemark(saved.remark);`,
    `                    if (saved?.remark)             setRemark(saved.remark);
                    if (saved?.nishantResearcherRows) setNishantRows(saved.nishantResearcherRows);
                    if (saved?.nishantOverview)       setNishantOverview(saved.nishantOverview);`
);

// ── 5. Add nishant fields to POST body ──
c = c.replace(
    `                    keyLearning1: keyLearnings[0],
                    keyLearning2: keyLearnings[1],
                    keyLearning3: keyLearnings[2],`,
    `                    keyLearning1: keyLearnings[0],
                    keyLearning2: keyLearnings[1],
                    keyLearning3: keyLearnings[2],
                    nishantResearcherRows: isNishant ? nishantRows : undefined,
                    nishantOverview:       isNishant ? nishantOverview : undefined,`
);

// ── 6. Inject Nishant UI before the main return ──
const nishantUI = `
    /* ──────────────── Nishant Bhatia Monthly Report ──────────────── */
    if (isNishant) {
        const NCell = ({ children, bold, center, colored }: { children: React.ReactNode; bold?: boolean; center?: boolean; colored?: string }) => (
            <td className={\`px-3 py-2 border border-slate-300 text-[13px] align-middle \${bold ? "font-semibold" : ""} \${center ? "text-center" : ""} \${colored || "text-slate-800 bg-white"}\`}>
                {children}
            </td>
        );
        const NInput = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
            <input
                type="text"
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                disabled={isLocked || viewOnly}
                className="w-full bg-transparent text-[13px] text-slate-800 placeholder:text-slate-300 focus:outline-none"
            />
        );
        const NTh = ({ children, w }: { children: React.ReactNode; w?: number }) => (
            <th style={w ? { minWidth: w } : {}} className="px-3 py-2.5 text-left text-[12px] font-bold text-white bg-[#1a4a3a] border border-[#2a5a4a] whitespace-normal leading-tight">
                {children}
            </th>
        );

        return (
            <>
            <div className="max-w-5xl mx-auto pb-16 space-y-6 px-2">
                {/* Back */}
                <button onClick={() => router.back()} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 transition-colors group mt-2">
                    <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Back to Reports
                </button>

                {/* View-only banner */}
                {viewOnly && isSubmitted && (
                    <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-[13px] font-medium">
                        {isCeo ? "You are viewing this report as CEO — read-only mode." : "You are viewing this report in read-only mode."}
                    </div>
                )}

                {/* Title banner */}
                <div className="rounded-t-xl overflow-hidden shadow-md">
                    <div className="bg-[#0d2137] px-6 py-4 text-center">
                        <h1 className="text-lg font-bold text-white">Nishant's Monthly Report for the month of {monthName}</h1>
                    </div>
                    <div className="bg-[#e87722] px-6 py-3 text-center">
                        <p className="text-[12px] text-white font-medium leading-snug">
                            To be submitted after you have discussed it with Bhoomika and have distributed the cases across the capsules.
                            We expect it that you submit the report every last Friday of the month.
                        </p>
                    </div>
                </div>

                {/* Error / draft saved */}
                {!viewOnly && submitError && <p className="text-[12px] text-red-500 font-medium">{submitError}</p>}
                {!viewOnly && isDraftSaved && <p className="text-[12px] text-green-600 font-medium">✓ Draft saved</p>}

                {/* Main researcher table */}
                <div className="overflow-x-auto rounded-xl border border-slate-300 shadow-sm">
                    <table className="border-collapse w-full" style={{ minWidth: 1100 }}>
                        <thead>
                            <tr>
                                <NTh w={110}>Researcher</NTh>
                                <NTh w={120}>No. of Approved cases(RTC)</NTh>
                                <NTh w={120}>Average rating of the cases</NTh>
                                <NTh w={120}>No. of Approved cases(FOIA)</NTh>
                                <NTh w={130}>Expected Target of RTC</NTh>
                                <NTh w={140}>Expected Number of FOIA to be pitched?</NTh>
                                <NTh w={140}>Actual Number of FOIA pitched?</NTh>
                                <NTh w={110}>FOIA received?</NTh>
                                <NTh w={180}>Overall Remarks</NTh>
                                {!isLocked && !viewOnly && <th className="px-2 bg-[#1a4a3a] border border-[#2a5a4a]" />}
                            </tr>
                        </thead>
                        <tbody>
                            {nishantRows.map((row, idx) => (
                                <tr key={row.id} className="group hover:bg-emerald-50/40 transition-colors">
                                    <NCell colored="bg-slate-50 text-slate-700 font-medium"><NInput value={row.researcher} onChange={v => setNR(idx, "researcher", v)} placeholder="Name" /></NCell>
                                    <NCell center><NInput value={row.approvedCasesRTC} onChange={v => setNR(idx, "approvedCasesRTC", v)} placeholder="N/A" /></NCell>
                                    <NCell center><NInput value={row.avgRating} onChange={v => setNR(idx, "avgRating", v)} placeholder="N/A" /></NCell>
                                    <NCell center colored={\`bg-white \${row.approvedCasesFOIA && !isNaN(Number(row.approvedCasesFOIA)) && Number(row.approvedCasesFOIA) > 20 ? "text-red-600 font-semibold" : "text-slate-800"}\`}><NInput value={row.approvedCasesFOIA} onChange={v => setNR(idx, "approvedCasesFOIA", v)} placeholder="N/A" /></NCell>
                                    <NCell center><NInput value={row.expectedTargetRTC} onChange={v => setNR(idx, "expectedTargetRTC", v)} placeholder="" /></NCell>
                                    <NCell center><NInput value={row.expectedFOIAPitched} onChange={v => setNR(idx, "expectedFOIAPitched", v)} placeholder="" /></NCell>
                                    <NCell center><NInput value={row.actualFOIAPitched} onChange={v => setNR(idx, "actualFOIAPitched", v)} placeholder="" /></NCell>
                                    <NCell center><NInput value={row.foiaReceived} onChange={v => setNR(idx, "foiaReceived", v)} placeholder="" /></NCell>
                                    <NCell colored="bg-white text-amber-700"><NInput value={row.overallRemarks} onChange={v => setNR(idx, "overallRemarks", v)} placeholder="Remarks…" /></NCell>
                                    {!isLocked && !viewOnly && (
                                        <td className="px-2 py-2 border border-slate-200 bg-white text-center">
                                            {nishantRows.length > 1 && (
                                                <button onClick={() => removeNR(idx)} className="text-red-400 hover:text-red-600 transition-colors">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            ))}
                            {/* Totals row */}
                            <tr className="bg-slate-100 font-semibold">
                                <td className="px-3 py-2.5 border border-slate-300 text-[13px] text-slate-600 italic">Totals</td>
                                {["approvedCasesRTC","avgRating","approvedCasesFOIA","expectedTargetRTC","expectedFOIAPitched","actualFOIAPitched","foiaReceived"].map(f => {
                                    const nums = nishantRows.map(r => parseFloat((r as any)[f])).filter(n => !isNaN(n));
                                    const val = f === "avgRating"
                                        ? (nums.length ? (nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(2) : "—")
                                        : (nums.length ? nums.reduce((a,b)=>a+b,0) : "—");
                                    return <td key={f} className="px-3 py-2.5 border border-slate-300 text-[13px] text-center text-slate-800">{val}</td>;
                                })}
                                <td className="px-3 py-2.5 border border-slate-300" />
                                {!isLocked && !viewOnly && <td className="border border-slate-200 bg-white" />}
                            </tr>
                        </tbody>
                    </table>
                </div>

                {!isLocked && !viewOnly && (
                    <button onClick={addNR} className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                        </svg>
                        Add researcher row
                    </button>
                )}

                {/* Monthly Overview table */}
                <div className="overflow-x-auto rounded-xl border border-slate-300 shadow-sm">
                    <table className="border-collapse w-full" style={{ minWidth: 1100 }}>
                        <thead>
                            <tr>
                                {["Monthly Overview","Total no. of cases(RTC)","Average case rating","Total No. of cases(FOIA)","Total expected target(RTC)","Total expected FOIA to be pitched","Total number of FOIA pitched?","Total no. of FOIA received?","Monthly Deadline completed or not?"].map(h => (
                                    <th key={h} className="px-3 py-2.5 text-left text-[11px] font-bold text-white bg-[#1a4a3a] border border-[#2a5a4a] leading-tight">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="px-3 py-3 border border-slate-300 bg-slate-50 text-[12px] font-bold text-slate-600">Summary</td>
                                {(["totalCasesRTC","avgCaseRating","totalCasesFOIA","totalExpectedTargetRTC","totalExpectedFOIAPitched","totalFOIAPitched","totalFOIAReceived"] as (keyof NishantOverview)[]).map(f => (
                                    <td key={f} className="px-3 py-3 border border-slate-300 bg-white text-center">
                                        <input
                                            type="text"
                                            value={nishantOverview[f]}
                                            onChange={e => setNO(f, e.target.value)}
                                            disabled={isLocked || viewOnly}
                                            className="w-full bg-transparent text-[13px] text-slate-800 text-center placeholder:text-slate-300 focus:outline-none"
                                            placeholder="—"
                                        />
                                    </td>
                                ))}
                                <td className="px-3 py-3 border border-slate-300 bg-white text-center">
                                    <select
                                        value={nishantOverview.monthlyDeadlineMet}
                                        onChange={e => setNO("monthlyDeadlineMet", e.target.value)}
                                        disabled={isLocked || viewOnly}
                                        className="w-full bg-transparent text-[13px] font-semibold focus:outline-none cursor-pointer"
                                        style={{ color: nishantOverview.monthlyDeadlineMet === "YES" ? "#16a34a" : nishantOverview.monthlyDeadlineMet === "NO" ? "#dc2626" : "#64748b" }}
                                    >
                                        <option value="">—</option>
                                        <option value="YES">YES</option>
                                        <option value="NO">NO</option>
                                    </select>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                {/* Footer buttons */}
                <div className="flex items-center justify-end gap-3 pt-2">
                    {isLocked ? (
                        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 border border-green-200 text-green-700 text-[12px] font-semibold">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                            Submitted & Locked
                        </span>
                    ) : !viewOnly ? (
                        <>
                            <button onClick={handleSaveDraft} disabled={submitting || !statusLoaded}
                                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[13px] font-medium shadow-sm transition-colors disabled:opacity-50">
                                <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                                </svg>
                                Save as Draft
                            </button>
                            <button onClick={() => setShowConfirm(true)} disabled={submitting || !statusLoaded}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[13px] font-semibold shadow-sm transition-colors disabled:opacity-50">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                                {submitting ? "Submitting…" : "Send to CEO"}
                            </button>
                        </>
                    ) : null}
                </div>
            </div>

            {/* Confirmation modal */}
            {showConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowConfirm(false)} />
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
                        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-50 mx-auto">
                            <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <div className="text-center">
                            <h3 className="text-[15px] font-bold text-slate-900">Submit this report?</h3>
                            <p className="text-[13px] text-slate-500 mt-1.5 leading-relaxed">Once submitted, the report will be <span className="font-medium text-slate-700">locked</span> and cannot be edited.</p>
                            <p className="text-[13px] text-slate-500 mt-2">This report will be <span className="font-semibold text-slate-800">sent to the CEO</span> for review.</p>
                        </div>
                        <div className="flex gap-2.5 mt-1">
                            <button onClick={() => setShowConfirm(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[13px] font-semibold transition-colors">Cancel</button>
                            <button onClick={handleSubmit} className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-[13px] font-semibold transition-colors shadow-sm">Yes, Submit</button>
                        </div>
                    </div>
                </div>
            )}
            </>
        );
    }
    /* ──────────────────────────────────────────────────────────────── */

`;

c = c.replace('    return (\n        <>\n        <div className="max-w-4xl mx-auto space-y-8 pb-16">', nishantUI + '    return (\n        <>\n        <div className="max-w-4xl mx-auto space-y-8 pb-16">');

fs.writeFileSync(p, c, 'utf8');
console.log('Monthly page updated:', c.includes('NishantResearcherRow') && c.includes("isNishant"));
