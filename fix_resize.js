const fs = require('fs');
const p = 'd:/Arpit Sharma/Desktop/project 1/nb project/src/app/dashboard/reports/[managerId]/weekly/[week]/page.tsx';
let c = fs.readFileSync(p, 'utf8');

// 1. Replace the Th component with ResizableTh
const oldTh = `function Th({ children, w }: { children: React.ReactNode; w?: string }) {
    return (
        <th
            style={w ? { width: w, minWidth: w } : {}}
            className="px-3 py-[10px] text-left text-[11px] font-bold uppercase tracking-wide leading-tight text-white bg-indigo-500 border border-indigo-600 break-words"
        >
            {children}
        </th>
    );
}`;

const newTh = `function ResizableTh({
    children,
    colIndex,
    widths,
    setWidths,
}: {
    children: React.ReactNode;
    colIndex: number;
    widths: Record<number, number>;
    setWidths: React.Dispatch<React.SetStateAction<Record<number, number>>>;
}) {
    const thRef = React.useRef<HTMLTableCellElement>(null);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = thRef.current?.offsetWidth ?? 120;
        const onMove = (ev: MouseEvent) => {
            const newWidth = Math.max(60, startWidth + ev.clientX - startX);
            setWidths(prev => ({ ...prev, [colIndex]: newWidth }));
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Auto-fit: remove explicit width so browser sizes to content
        setWidths(prev => {
            const next = { ...prev };
            delete next[colIndex];
            return next;
        });
    };

    const w = widths[colIndex];
    return (
        <th
            ref={thRef}
            style={w ? { width: w, minWidth: w } : {}}
            className="relative px-3 py-[10px] text-left text-[11px] font-bold uppercase tracking-wide leading-tight text-white bg-indigo-500 border border-indigo-600 break-words select-none"
        >
            {children}
            {/* Resize handle */}
            <div
                className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize group/handle flex items-center justify-center z-10"
                onMouseDown={handleMouseDown}
                onDoubleClick={handleDoubleClick}
                title="Drag to resize · Double-click to auto-fit"
            >
                <div className="w-px h-4/5 bg-indigo-300/40 group-hover/handle:bg-white/70 transition-colors rounded-full" />
            </div>
        </th>
    );
}
// Alias for the action column (no resize handle needed)
function Th({ children }: { children: React.ReactNode }) {
    return (
        <th className="px-3 py-[10px] text-left text-[11px] font-bold uppercase tracking-wide leading-tight text-white bg-indigo-500 border border-indigo-600 break-words">
            {children}
        </th>
    );
}`;

c = c.replace(oldTh, newTh);

// 2. Add column width state after the viewOnly declaration
const stateMarker = '    const viewOnly      = sessionStatus === "authenticated" && !isOwner && !isAdmin;';
const stateAddition = `    const viewOnly      = sessionStatus === "authenticated" && !isOwner && !isAdmin;

    // Column resize state for each table
    const [wColWidths, setWColWidths] = useState<Record<number, number>>({});
    const [cColWidths, setCColWidths] = useState<Record<number, number>>({});
    const [oColWidths, setOColWidths] = useState<Record<number, number>>({});`;

c = c.replace(stateMarker, stateAddition);

// 3. Update writer table headers (11 columns, indices 0-10, last one is action col keep as Th)
const writerHeaders = `                            <Th>Month</Th>
                            <Th>Name of the Writer <span className="text-red-300">*</span></Th>
                            <Th>Case Name <span className="text-red-300">*</span></Th>
                            <Th>Hero Case? <span className="text-red-300">*</span></Th>
                            <Th>TAT — First Draft <span className="text-red-300">*</span></Th>
                            <Th>TAT — Revision <span className="text-red-400">*</span></Th>
                            <Th>Reason for TAT Exceeding <span className="text-red-400">*</span></Th>
                            <Th>Action Taken <span className="text-red-400">*</span></Th>
                            <Th>Quality Score <span className="text-red-300">*</span></Th>
                            <Th><span className="text-amber-200 italic text-[10px] font-medium">Remark (optional)</span></Th>
                            <Th>{" "}</Th>`;

const writerHeadersNew = `                            <ResizableTh colIndex={0} widths={wColWidths} setWidths={setWColWidths}>Month</ResizableTh>
                            <ResizableTh colIndex={1} widths={wColWidths} setWidths={setWColWidths}>Name of the Writer <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={2} widths={wColWidths} setWidths={setWColWidths}>Case Name <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={3} widths={wColWidths} setWidths={setWColWidths}>Hero Case? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={4} widths={wColWidths} setWidths={setWColWidths}>TAT — First Draft <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={5} widths={wColWidths} setWidths={setWColWidths}>TAT — Revision <span className="text-red-400">*</span></ResizableTh>
                            <ResizableTh colIndex={6} widths={wColWidths} setWidths={setWColWidths}>Reason for TAT Exceeding <span className="text-red-400">*</span></ResizableTh>
                            <ResizableTh colIndex={7} widths={wColWidths} setWidths={setWColWidths}>Action Taken <span className="text-red-400">*</span></ResizableTh>
                            <ResizableTh colIndex={8} widths={wColWidths} setWidths={setWColWidths}>Quality Score <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={9} widths={wColWidths} setWidths={setWColWidths}><span className="text-amber-200 italic text-[10px] font-medium">Remark (optional)</span></ResizableTh>
                            <Th>{" "}</Th>`;

c = c.replace(writerHeaders, writerHeadersNew);

// 4. Update editor table headers
const editorHeaders = `                            <Th>Month</Th>
                            <Th>Name of the Editor <span className="text-red-300">*</span></Th>
                            <Th>Case Name <span className="text-red-300">*</span></Th>
                            <Th>Hero Case? <span className="text-red-300">*</span></Th>
                            <Th>TAT for the First Draft <span className="text-red-300">*</span></Th>
                            <Th>TAT for Revision <span className="text-red-400">*</span></Th>
                            <Th>Reason for TAT Exceeding <span className="text-red-400">*</span></Th>
                            <Th>Action Taken <span className="text-red-400">*</span></Th>
                            <Th>Quality Score <span className="text-red-300">*</span></Th>
                            <Th><span className="text-amber-200 italic text-[10px] font-medium">Remark (optional)</span></Th>
                            <Th>{" "}</Th>`;

const editorHeadersNew = `                            <ResizableTh colIndex={0} widths={cColWidths} setWidths={setCColWidths}>Month</ResizableTh>
                            <ResizableTh colIndex={1} widths={cColWidths} setWidths={setCColWidths}>Name of the Editor <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={2} widths={cColWidths} setWidths={setCColWidths}>Case Name <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={3} widths={cColWidths} setWidths={setCColWidths}>Hero Case? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={4} widths={cColWidths} setWidths={setCColWidths}>TAT for the First Draft <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={5} widths={cColWidths} setWidths={setCColWidths}>TAT for Revision <span className="text-red-400">*</span></ResizableTh>
                            <ResizableTh colIndex={6} widths={cColWidths} setWidths={setCColWidths}>Reason for TAT Exceeding <span className="text-red-400">*</span></ResizableTh>
                            <ResizableTh colIndex={7} widths={cColWidths} setWidths={setCColWidths}>Action Taken <span className="text-red-400">*</span></ResizableTh>
                            <ResizableTh colIndex={8} widths={cColWidths} setWidths={setCColWidths}>Quality Score <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={9} widths={cColWidths} setWidths={setCColWidths}><span className="text-amber-200 italic text-[10px] font-medium">Remark (optional)</span></ResizableTh>
                            <Th>{" "}</Th>`;

c = c.replace(editorHeaders, editorHeadersNew);

// 5. Update overview table headers
const overviewHeaders = `                            <Th>Month</Th>
                            <Th>Win of the week? <span className="text-red-300">*</span></Th>
                            <Th>Roadblock of the week? <span className="text-red-300">*</span></Th>
                            <Th><span className="text-amber-200 italic text-[10px] font-medium">Remark (optional)</span></Th>
                            <Th>{" "}</Th>`;

const overviewHeadersNew = `                            <ResizableTh colIndex={0} widths={oColWidths} setWidths={setOColWidths}>Month</ResizableTh>
                            <ResizableTh colIndex={1} widths={oColWidths} setWidths={setOColWidths}>Win of the week? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={2} widths={oColWidths} setWidths={setOColWidths}>Roadblock of the week? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={3} widths={oColWidths} setWidths={setOColWidths}><span className="text-amber-200 italic text-[10px] font-medium">Remark (optional)</span></ResizableTh>
                            <Th>{" "}</Th>`;

c = c.replace(overviewHeaders, overviewHeadersNew);

// 6. Add React import alias (React.useRef needs React in scope)
// Check if React is already imported
if (!c.includes("import React") && !c.includes("import * as React")) {
    c = c.replace(
        'import { useParams, useRouter, useSearchParams } from "next/navigation";',
        'import React from "react";\nimport { useParams, useRouter, useSearchParams } from "next/navigation";'
    );
}

fs.writeFileSync(p, c, 'utf8');

// Verify
const hasResizableTh = c.includes('function ResizableTh');
const hasWColWidths = c.includes('wColWidths');
const writersUpdated = c.includes('colIndex={0} widths={wColWidths}');
console.log('ResizableTh added:', hasResizableTh);
console.log('Width state added:', hasWColWidths);
console.log('Writer headers updated:', writersUpdated);
