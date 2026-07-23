import React, { useRef, useEffect } from "react";

/** Measures the natural fit-width for a single column (by cellIndex) in a table. */
export function measureColumnWidth(
    table: HTMLTableElement,
    cellIndex: number,
    minWidth: number
): number {
    const cells = Array.from(table.rows)
        .map(row => row.cells[cellIndex])
        .filter(Boolean);

    let maxWidth = 0;

    const measureSpan = document.createElement('span');
    measureSpan.style.visibility = 'hidden';
    measureSpan.style.position = 'absolute';
    measureSpan.style.whiteSpace = 'nowrap';
    document.body.appendChild(measureSpan);

    cells.forEach(cell => {
        const input = cell.querySelector('input');
        const select = cell.querySelector('select');
        let text = '';

        if (input) {
            text = input.value || input.placeholder || '';
        } else if (select) {
            const selectedOption = select.options[select.selectedIndex];
            text = selectedOption ? selectedOption.text : '';
        } else {
            text = cell.textContent || '';
        }

        const cellStyle = window.getComputedStyle(cell);
        measureSpan.style.font = cellStyle.font || 'inherit';
        measureSpan.textContent = text || 'W';

        const paddingLeft = parseFloat(cellStyle.paddingLeft) || 0;
        const paddingRight = parseFloat(cellStyle.paddingRight) || 0;
        const borderLeft = parseFloat(cellStyle.borderLeftWidth) || 0;
        const borderRight = parseFloat(cellStyle.borderRightWidth) || 0;

        let extraBuffer = 8;
        if (select) extraBuffer = 30;
        else if (input) extraBuffer = 16;

        const cellWidth =
            measureSpan.getBoundingClientRect().width +
            paddingLeft + paddingRight +
            borderLeft + borderRight +
            extraBuffer;
        if (cellWidth > maxWidth) maxWidth = cellWidth;
    });

    document.body.removeChild(measureSpan);
    return Math.max(minWidth, Math.ceil(maxWidth));
}

/** Call this once after a table renders to auto-fit all columns by index. */
export function autoFitAllColumns(
    table: HTMLTableElement,
    colCount: number,
    minWidth: number,
    setWidths: React.Dispatch<React.SetStateAction<Record<number, number>>>
) {
    const newWidths: Record<number, number> = {};
    for (let i = 0; i < colCount; i++) {
        newWidths[i] = measureColumnWidth(table, i, minWidth);
    }
    setWidths(newWidths);
}

export function ResizableTh({
    children,
    colIndex,
    widths,
    setWidths,
    className = "",
    minWidth = 60,
    defaultWidth = 120,
    tableRef,
    colCount,
}: {
    children: React.ReactNode;
    colIndex: number;
    widths: Record<number, number>;
    setWidths: React.Dispatch<React.SetStateAction<Record<number, number>>>;
    className?: string;
    minWidth?: number;
    defaultWidth?: number;
    /** Pass tableRef + colCount on the FIRST column (colIndex===0) to trigger auto-fit on mount */
    tableRef?: React.RefObject<HTMLTableElement | null>;
    colCount?: number;
}) {
    const thRef = useRef<HTMLTableCellElement>(null);

    // Auto-fit all columns once on mount — only the first column drives this
    useEffect(() => {
        if (colIndex !== 0 || !tableRef || !colCount) return;

        const run = () => {
            const table = tableRef?.current;
            if (!table) return;
            autoFitAllColumns(table, colCount, minWidth, setWidths);
        };

        // Use two rAF frames to let React finish painting + data populate
        requestAnimationFrame(() => requestAnimationFrame(run));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startWidth = thRef.current?.offsetWidth ?? defaultWidth;

        const onMove = (ev: MouseEvent) => {
            const newWidth = Math.max(minWidth, startWidth + ev.clientX - startX);
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

        const th = thRef.current;
        if (!th) return;

        const table = th.closest('table') as HTMLTableElement | null;
        if (!table) return;

        const w = measureColumnWidth(table, th.cellIndex, minWidth);
        setWidths(prev => ({ ...prev, [colIndex]: w }));
    };

    const width = widths[colIndex];
    return (
        <th
            ref={thRef}
            style={width ? { width, minWidth: width, maxWidth: width } : {}}
            className={`relative break-words select-none ${className}`}
        >
            {children}
            {/* Resize handle */}
            <div
                className="absolute right-0 top-0 h-full w-2 cursor-col-resize group/handle flex items-center justify-center z-10"
                onMouseDown={handleMouseDown}
                onDoubleClick={handleDoubleClick}
                title="Drag to resize · Double-click to auto-fit"
            >
                <div className="w-px h-4/5 bg-slate-300/40 group-hover/handle:bg-white/70 transition-colors rounded-full" />
            </div>
        </th>
    );
}
