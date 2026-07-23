"use client";
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import Link from "next/link";
import { Users, ChevronDown, ChevronRight, Search } from "lucide-react";
import { getUserRoleLabel } from "@/lib/user-role-options";
import { useUrlTab } from "@/lib/hooks/useUrlTab";

function Avatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const initials = name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  const colors = ["bg-violet-500","bg-emerald-500","bg-[#008CFF]","bg-amber-500","bg-pink-500","bg-teal-500"];
  const color  = colors[name.charCodeAt(0) % colors.length];
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

function OrgCard({ node, depth = 0 }: { node: any; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children?.length > 0;
  const dept = node.employeeProfile?.department || node.role || "";
  const desig = node.employeeProfile?.designation || getUserRoleLabel(node.role) || node.orgLevel?.replace(/_/g, " ") || "";

  return (
    <div className="flex flex-col items-center">
      {/* Card */}
      <div className="relative group">
        <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-4 w-[180px] text-center shadow-sm hover:shadow-md hover:border-[#008CFF]/30 transition-all">
          <div className="flex justify-center mb-2">
            <Avatar name={node.name} url={node.profilePictureUrl} size={44} />
          </div>
          <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">{node.name}</p>
          {desig && <p className="text-[10px] text-[#008CFF] font-medium mt-0.5 capitalize truncate">{desig}</p>}
          {dept  && <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{dept}</p>}
        </div>

        {/* Expand toggle */}
        {hasChildren && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-[#008CFF] text-white flex items-center justify-center shadow-md hover:bg-[#0077dd] transition-colors z-10"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Children connector */}
      {hasChildren && expanded && (
        <div className="flex flex-col items-center mt-6">
          {/* vertical line from parent */}
          <div className="w-px h-4 bg-slate-300 dark:bg-white/20" />
          {/* horizontal connector */}
          {node.children.length > 1 && (
            <div
              className="h-px bg-slate-300 dark:bg-white/20"
              style={{ width: `${node.children.length * 200 - 20}px` }}
            />
          )}
          {/* children row */}
          <div className="flex gap-5 mt-0">
            {node.children.map((child: any) => (
              <div key={child.id} className="flex flex-col items-center">
                <div className="w-px h-4 bg-slate-300 dark:bg-white/20" />
                <OrgCard node={child} depth={depth + 1} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrgChartPage() {
  const { data, isLoading } = useSWR("/api/hr/org", fetcher);
  const [search, setSearch] = useState("");
  const [view, setView] = useUrlTab<"tree" | "list">("view", "tree", ["tree", "list"] as const);

  const flat: any[] = data?.flat || [];
  const tree: any[] = data?.tree || [];

  const filtered = search
    ? flat.filter(u => u.name.toLowerCase().includes(search.toLowerCase()) ||
        (u.employeeProfile?.department || "").toLowerCase().includes(search.toLowerCase()))
    : flat;

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">

      {/* Header */}
      <div className="bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-[#008CFF]" />
            <div>
              <h1 className="text-[15px] font-bold text-slate-800 dark:text-white">Organization Chart</h1>
              <p className="text-[12px] text-slate-500 dark:text-slate-400">{flat.length} employees</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search employees…"
                className="pl-9 pr-4 h-9 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-700 dark:text-slate-300 placeholder-slate-400 w-56 focus:outline-none focus:border-[#008CFF]"
              />
            </div>
            <div className="flex items-center gap-0 bg-slate-100 dark:bg-white/5 rounded-lg p-0.5">
              {(["tree","list"] as const).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-bold capitalize transition-colors ${
                    view === v ? "bg-white dark:bg-[#001529] text-[#008CFF] shadow-sm" : "text-slate-500 dark:text-slate-400"
                  }`}>{v === "tree" ? "Tree View" : "List View"}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : view === "tree" ? (
          <div className="overflow-x-auto">
            <div className="flex gap-8 flex-wrap justify-center py-4">
              {(search ? [] : tree).map(root => (
                <OrgCard key={root.id} node={root} />
              ))}
              {search && filtered.map(u => (
                <Link key={u.id} href={`/dashboard/hr/people/${u.id}`}
                  className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-4 w-[180px] text-center hover:border-[#008CFF]/30 transition-all">
                  <div className="flex justify-center mb-2">
                    <Avatar name={u.name} url={u.profilePictureUrl} size={44} />
                  </div>
                  <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">{u.name}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{u.employeeProfile?.department || u.role}</p>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/[0.04]">
                  {["Employee","Department","Designation","Type","Manager"].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((u: any) => {
                  const mgr = flat.find(x => x.id === u.managerId);
                  return (
                    <tr key={u.id} className="border-b border-slate-50 dark:border-white/[0.03] hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                      <td className="px-5 py-3">
                        <Link href={`/dashboard/hr/people/${u.id}`} className="flex items-center gap-3 hover:text-[#008CFF] transition-colors">
                          <Avatar name={u.name} url={u.profilePictureUrl} size={32} />
                          <div>
                            <p className="text-[13px] font-medium text-slate-800 dark:text-white">{u.name}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">{u.email}</p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-[13px] text-slate-600 dark:text-slate-300">{u.employeeProfile?.department || "—"}</td>
                      <td className="px-5 py-3 text-[13px] text-slate-600 dark:text-slate-300 capitalize">{u.employeeProfile?.designation || getUserRoleLabel(u.role) || u.orgLevel?.replace(/_/g," ") || "—"}</td>
                      <td className="px-5 py-3 text-[13px] text-slate-600 dark:text-slate-300 capitalize">{u.employeeProfile?.employmentType || "—"}</td>
                      <td className="px-5 py-3 text-[13px] text-slate-600 dark:text-slate-300">{mgr?.name || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
