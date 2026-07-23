"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/swr";
import { Users, ChevronDown, ChevronRight, Search } from "lucide-react";
import FilterDropdown from "@/components/hr/FilterDropdown";
import { getUserRoleLabel } from "@/lib/user-role-options";
import {
  deriveEntity,
  deriveDepartment,
  deriveLocation,
  deriveRole,
  entityOptions,
  departmentOptions,
  locationOptions,
  roleOptions,
} from "@/lib/hr-taxonomy";

function Avatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const initials = name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const palette = ["bg-[#008CFF]", "bg-emerald-500", "bg-violet-500", "bg-amber-500", "bg-pink-500", "bg-teal-500"];
  const color = palette[name.charCodeAt(0) % palette.length];
  return url ? (
    <img src={url} alt={name} style={{ width: size, height: size }}
      className="rounded-full object-cover ring-2 ring-white dark:ring-[#001529] shrink-0" />
  ) : (
    <div style={{ width: size, height: size }}
      className={`${color} rounded-full flex items-center justify-center text-white text-[11px] font-bold ring-2 ring-white dark:ring-[#001529] shrink-0`}>
      {initials}
    </div>
  );
}

// ── Tree layout constants ────────────────────────────────────────────────────
const CARD_W    = 200;   // card pixel width
const COL_GAP   = 36;    // horizontal gap between sibling columns
const STEM      = 28;    // stem height from parent / to child
const LINE_CLS  = "bg-slate-300 dark:bg-white/15"; // connector color

function OrgCard({ node, depth = 0 }: { node: any; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children?.length > 0;
  const dept  = node.employeeProfile?.department  || node.role || "";
  const desig = node.employeeProfile?.designation || getUserRoleLabel(node.role) || node.orgLevel?.replace(/_/g, " ") || "";

  // Subtle accent on the card top-border that tints deeper levels.
  const accent =
    depth === 0 ? "before:bg-[#008CFF]"       :
    depth === 1 ? "before:bg-[#008CFF]/70"    :
    depth === 2 ? "before:bg-[#008CFF]/40"    :
                  "before:bg-[#008CFF]/25";

  return (
    <div className="flex flex-col items-center">
      {/* Card */}
      <div className="relative group">
        <Link
          href={`/dashboard/hr/people/${node.id}`}
          onMouseDown={(e) => e.stopPropagation()}
          className={`relative block bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06]
            rounded-xl px-3 py-3 shadow-sm hover:shadow-md hover:border-[#008CFF]/40 transition-all
            before:absolute before:top-0 before:left-0 before:right-0 before:h-[3px] before:rounded-t-xl ${accent}`}
          style={{ width: CARD_W }}
        >
          <div className="flex items-center gap-2.5">
            <Avatar name={node.name} url={node.profilePictureUrl} size={38} />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-slate-800 dark:text-white truncate leading-tight">
                {node.name}
              </p>
              {desig && (
                <p className="text-[10px] text-[#008CFF] font-medium mt-0.5 capitalize truncate leading-tight">
                  {desig}
                </p>
              )}
              {dept && (
                <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate leading-tight">
                  {dept}
                </p>
              )}
            </div>
          </div>
        </Link>

        {hasChildren && (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.preventDefault(); setExpanded((v) => !v); }}
            className="absolute -bottom-3 left-1/2 -translate-x-1/2 min-w-[28px] h-[22px] px-2 rounded-full bg-[#008CFF] text-white text-[10px] font-bold flex items-center justify-center gap-1 shadow-md hover:bg-[#0077dd] transition-colors z-10 ring-2 ring-white dark:ring-[#011627]"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded
              ? <ChevronDown  className="w-3 h-3" />
              : <><ChevronRight className="w-3 h-3" />{node.children.length}</>}
          </button>
        )}
      </div>

      {/* Children region: vertical stem \u2192 bus \u2192 per-child T-joint stems */}
      {hasChildren && expanded && (
        <div className="flex flex-col items-center">
          {/* parent stem */}
          <div className={`w-px ${LINE_CLS}`} style={{ height: STEM }} />

          {/* row of children with T-joint bus above each */}
          <div className="flex" style={{ gap: COL_GAP }}>
            {node.children.map((child: any, i: number) => {
              const first = i === 0;
              const last  = i === node.children.length - 1;
              const only  = node.children.length === 1;
              return (
                <div key={child.id} className="relative flex flex-col items-center" style={{ minWidth: CARD_W }}>
                  {/* Horizontal bus half-line (skipped for only-child) */}
                  {!only && (
                    <div
                      className={`absolute top-0 h-px ${LINE_CLS}`}
                      style={{
                        left:  first ? "50%" : 0,
                        right: last  ? "50%" : 0,
                      }}
                    />
                  )}
                  {/* child stem down from bus to card */}
                  <div className={`w-px ${LINE_CLS}`} style={{ height: STEM }} />
                  <OrgCard node={child} depth={depth + 1} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Recursively prune a tree so only branches containing a kept user remain ──
function pruneTree(node: any, keep: Set<number>): any | null {
  const keptChildren = (node.children || [])
    .map((c: any) => pruneTree(c, keep))
    .filter(Boolean);
  if (keep.has(node.id) || keptChildren.length > 0) {
    return { ...node, children: keptChildren };
  }
  return null;
}

// ── Main view ───────────────────────────────────────────────────────────────
export default function OrgTreeView() {
  const { data, isLoading, error } = useSWR("/api/hr/org", fetcher);
  const [search, setSearch] = useState("");

  // Filters (synced with Employee Directory — same 6 dimensions).
  const [bizUnit,    setBizUnit]    = useState<Set<string>>(new Set());
  const [dept,       setDept]       = useState<Set<string>>(new Set());
  const [location,   setLocation]   = useState<Set<string>>(new Set());
  const [costCenter, setCostCenter] = useState<Set<string>>(new Set());
  const [legal,      setLegal]      = useState<Set<string>>(new Set());
  const [role,       setRole]       = useState<Set<string>>(new Set());
  // Company tab — pre-scopes the entire tree to one brand. "All" shows
  // both NB Media and YT Labs employees in one combined tree.
  // Employees with a blank businessUnit are bucketed as "NB Media"
  // (parent brand fallback). Default tab is NB Media since it's the
  // existing org; YT Labs employees only appear once HR onboards them.
  type CompanyTab = "NB Media" | "YT Labs" | "all";
  const [companyTab, setCompanyTab] = useState<CompanyTab>("NB Media");

  // Pan (drag-to-move). No zoom, just a friendly cursor that tracks drag.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panBase  = useRef({ x: 0, y: 0 });

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY };
    panBase.current  = { ...pan };
  };
  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isPanning) return;
    setPan({
      x: panBase.current.x + (e.clientX - panStart.current.x),
      y: panBase.current.y + (e.clientY - panStart.current.y),
    });
  }, [isPanning]);
  const onMouseUp = useCallback(() => setIsPanning(false), []);
  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const rawFlat: any[] = data?.flat || [];
  const rawTree: any[] = data?.tree || [];

  // Company-scope first: filter the flat list (and re-build a tree from
  // it) so all downstream filters / option lists operate inside the
  // chosen brand. Empty businessUnit → "NB Media" (parent-brand
  // fallback); keeps legacy rows visible by default.
  const flat = useMemo(() => {
    if (companyTab === "all") return rawFlat;
    return rawFlat.filter((u: any) => {
      const bu = u.employeeProfile?.businessUnit || "NB Media";
      return bu === companyTab;
    });
  }, [rawFlat, companyTab]);

  // Re-derive the tree from the company-scoped flat list. Same group-by
  // -manager logic as /api/hr/org, but applied client-side so the YT
  // Labs view doesn't show NB Media managers as orphan roots.
  const tree = useMemo(() => {
    if (companyTab === "all") return rawTree;
    const ids = new Set(flat.map((u: any) => u.id));
    const map = new Map<number, any>();
    flat.forEach((u: any) => map.set(u.id, { ...u, children: [] }));
    const roots: any[] = [];
    flat.forEach((u: any) => {
      if (u.managerId && ids.has(u.managerId) && map.has(u.managerId)) {
        map.get(u.managerId).children.push(map.get(u.id));
      } else {
        roots.push(map.get(u.id));
      }
    });
    return roots;
  }, [flat, rawTree, companyTab]);

  // Build filter option sets (static taxonomy ∪ discovered data values).
  const { buOpts, deptOpts, locOpts, centerOpts, legalOpts, roleOpts } = useMemo(() => {
    const ents = entityOptions(flat);
    return {
      buOpts:     ents,
      legalOpts:  ents,
      centerOpts: ents,
      deptOpts:   departmentOptions(flat),
      locOpts:    locationOptions(flat),
      roleOpts:   roleOptions(flat),
    };
  }, [flat]);

  // Apply filters. Users with empty values are excluded when the filter has
  // any selection (Unassigned is no longer surfaced as an option).
  const keepIds = useMemo(() => {
    const matches = (selected: Set<string>, derived: string) =>
      selected.size === 0 || (!!derived && selected.has(derived));
    const s = new Set<number>();
    flat.forEach((u) => {
      const en = deriveEntity(u);
      const dp = deriveDepartment(u);
      const lc = deriveLocation(u);
      const rl = deriveRole(u);
      if (!matches(bizUnit,    en)) return;
      if (!matches(legal,      en)) return;
      if (!matches(costCenter, en)) return;
      if (!matches(dept,       dp)) return;
      if (!matches(location,   lc)) return;
      if (!matches(role,       rl)) return;
      s.add(u.id);
    });
    return s;
  }, [flat, bizUnit, legal, costCenter, dept, location, role]);

  const filtersActive = bizUnit.size || dept.size || location.size || costCenter.size || legal.size || role.size;

  const prunedTree = useMemo(() => {
    if (!filtersActive) return tree;
    return tree.map((root: any) => pruneTree(root, keepIds)).filter(Boolean);
  }, [tree, keepIds, filtersActive]);

  const filteredFlat = useMemo(() => {
    let rows = filtersActive ? flat.filter((u) => keepIds.has(u.id)) : flat;
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          (u.email || "").toLowerCase().includes(q) ||
          (u.employeeProfile?.department || "").toLowerCase().includes(q) ||
          (u.role || "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [flat, filtersActive, keepIds, search]);

  const visibleTree = useMemo(() => {
    if (search.trim()) return [];
    return prunedTree;
  }, [prunedTree, search]);

  const clearFilters = () => {
    setBizUnit(new Set());
    setDept(new Set());
    setLocation(new Set());
    setCostCenter(new Set());
    setLegal(new Set());
    setRole(new Set());
  };

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#008CFF]/10 flex items-center justify-center">
            <Users className="w-4 h-4 text-[#008CFF]" />
          </div>
          <div>
            <h2 className="text-[14px] font-bold text-slate-800 dark:text-white">Organization Tree</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{filteredFlat.length} of {flat.length} employees</p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employees…"
            className="pl-9 pr-4 h-9 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-700 dark:text-slate-300 placeholder-slate-400 w-60 focus:outline-none focus:border-[#008CFF] transition-colors"
          />
        </div>
      </div>

      {/* Company tab strip — splits the tree into NB Media / YT Labs
          before any other filter applies. "All" merges both. */}
      <div className="flex items-center gap-1.5 mb-3">
        {(["NB Media", "YT Labs", "all"] as const).map((opt) => {
          const active = companyTab === opt;
          const count = opt === "all"
            ? rawFlat.length
            : rawFlat.filter((u: any) => (u.employeeProfile?.businessUnit || "NB Media") === opt).length;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => setCompanyTab(opt)}
              className={`px-3.5 h-8 rounded-lg text-[12px] font-semibold transition-colors inline-flex items-center gap-2 ${
                active
                  ? "bg-[#008CFF] text-white shadow-sm"
                  : "bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10"
              }`}
            >
              <span>{opt === "all" ? "All" : opt}</span>
              <span className={`inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-bold !text-white ${
                active ? "bg-white/20" : "bg-[#008CFF]"
              }`} style={{ color: "#fff" }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <FilterDropdown label="Business Unit" options={buOpts}     selected={bizUnit}    onChange={setBizUnit}    />
        <FilterDropdown label="Department"    options={deptOpts}   selected={dept}       onChange={setDept}       width={280} />
        <FilterDropdown label="Location"      options={locOpts}    selected={location}   onChange={setLocation}   />
        <FilterDropdown label="Cost Center"   options={centerOpts} selected={costCenter} onChange={setCostCenter} />
        <FilterDropdown label="Legal Entity"  options={legalOpts}  selected={legal}      onChange={setLegal}      />
        <FilterDropdown label="Role"          options={roleOpts}   selected={role}       onChange={setRole}       width={220} />
        {filtersActive ? (
          <button
            type="button"
            onClick={clearFilters}
            className="h-9 px-3 text-[12px] font-medium text-slate-500 dark:text-slate-400 hover:text-[#008CFF] dark:hover:text-[#4a9cff] transition-colors"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <p className="text-[13px] text-red-500 text-center py-16">Couldn't load org tree</p>
      ) : search ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filteredFlat.map((u: any) => (
            <Link
              key={u.id}
              href={`/dashboard/hr/people/${u.id}`}
              className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-4 text-center hover:border-[#008CFF]/40 hover:shadow-md transition-all"
            >
              <div className="flex justify-center mb-2">
                <Avatar name={u.name} url={u.profilePictureUrl} size={44} />
              </div>
              <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">{u.name}</p>
              <p className="text-[10px] text-[#008CFF] font-medium mt-0.5 capitalize truncate">
                {u.employeeProfile?.designation || getUserRoleLabel(u.role) || u.orgLevel?.replace(/_/g, " ") || ""}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {u.employeeProfile?.department || u.role || ""}
              </p>
            </Link>
          ))}
          {filteredFlat.length === 0 && (
            <p className="col-span-full text-center text-[13px] text-slate-400 py-12">
              No matches for "{search}"
            </p>
          )}
        </div>
      ) : (
        // Pan-able tree canvas
        <div
          onMouseDown={onMouseDown}
          className={`relative select-none overflow-hidden rounded-xl border border-slate-200 dark:border-white/[0.06] bg-slate-50/50 dark:bg-white/[0.01] ${
            isPanning ? "cursor-grabbing" : "cursor-grab"
          }`}
          style={{ height: "calc(100vh - 340px)", minHeight: 460 }}
        >
          <div
            className="absolute inset-0 p-6"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px)`,
              transition: isPanning ? "none" : "transform 0.18s ease-out",
            }}
          >
            <div className="flex gap-8 flex-wrap justify-center py-4 min-w-fit">
              {visibleTree.map((root: any) => (
                <OrgCard key={root.id} node={root} />
              ))}
              {visibleTree.length === 0 && (
                <p className="text-[13px] text-slate-400 py-16">
                  {filtersActive ? "No employees match the current filters." : "No org hierarchy configured yet."}
                </p>
              )}
            </div>
          </div>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-slate-400 pointer-events-none">
            Click and drag to move the tree
          </div>
        </div>
      )}
    </div>
  );
}
