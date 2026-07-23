"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import UserAvatar from "@/components/ui/user-avatar";
import {
    type TeamCapsuleCatalog,
    teamCapsuleSelectionKeyToName,
    teamCapsuleToSelectionKey,
} from "@/lib/team-capsule-catalog-ui";
import { USER_ROLE_OPTIONS, getUserRoleLabel } from "@/lib/user-role-options";
import { legacyDesignationKey, legacyFromDesignationKey } from "@/lib/permissions/designation-seed";

interface UserNode {
    id: number;
    name: string;
    email: string;
    role: string;
    orgLevel: string;
    managerId: number | null;
    profilePictureUrl: string | null;
    teamCapsule: string | null;
    isActive: boolean;
    /** Current designation (RBAC). Used to default the Designation picker. */
    designationId?: number | null;
    /** Monthly case target for Production Manager (delivery % denominator). */
    monthlyDeliveryTargetCases?: number | null;
}

const ORG_LABELS: Record<string, string> = {
    ceo: "CEO",
    special_access: "Special Access",
    hod: "HOD",
    manager: "Manager",
    hr_manager: "HR",
    lead: "Lead",
    sub_lead: "Sub Lead",
    member: "Member",
};

const ORG_COLORS: Record<string, string> = {
    ceo: "border-amber-500/40 bg-amber-500/5",
    special_access: "border-violet-500/40 bg-violet-500/5",
    hod: "border-blue-500/40 bg-blue-500/5",
    manager: "border-emerald-500/40 bg-emerald-500/5",
    hr_manager: "border-pink-500/40 bg-pink-500/5",
    lead: "border-blue-500/40 bg-blue-500/5",
    sub_lead: "border-purple-500/40 bg-purple-500/5",
    member: "border-slate-600/30 bg-white/[0.01]",
};

const ORG_BADGE_COLORS: Record<string, string> = {
    ceo: "bg-amber-500/15 text-amber-400 border-amber-500/25",
    special_access: "bg-violet-500/15 text-violet-400 border-violet-500/25",
    hod: "bg-blue-500/15 text-blue-400 border-blue-500/25",
    manager: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    hr_manager: "bg-pink-500/15 text-pink-400 border-pink-500/25",
    lead: "bg-blue-500/15 text-blue-400 border-blue-500/25",
    sub_lead: "bg-purple-500/15 text-purple-400 border-purple-500/25",
    member: "bg-slate-600/15 text-slate-500 border-slate-600/25",
};

const ORG_OPTIONS = [
    { value: "ceo", label: "CEO" },
    { value: "special_access", label: "Special Access" },
    { value: "hod", label: "HOD" },
    { value: "manager", label: "Manager" },
    { value: "hr_manager", label: "HR" },
    { value: "lead", label: "Lead" },
    { value: "sub_lead", label: "Sub Lead" },
    { value: "member", label: "Member (No Access)" },
];

type OrgUserUpdatePayload = {
    role?: string;
    orgLevel?: string;
    designationId?: number | null;
    managerId?: number | null;
    monthlyDeliveryTargetCases?: number | null;
    teamCapsule?: string | null;
};

export default function OrgTree({
    users,
    onUserUpdate,
}: {
    users: UserNode[];
    onUserUpdate: (userId: number, data: OrgUserUpdatePayload) => Promise<void>;
}) {
    const [editingUser, setEditingUser] = useState<UserNode | null>(null);
    const [editData, setEditData] = useState<{
        role: string;
        orgLevel: string;
        /** Single designation picker; role/orgLevel above are derived from it. */
        designationKey: string;
        managerId: number | null;
        monthlyDeliveryTargetCases: number | null;
        /** "" | "l:123" (production list) | "c:456" (whole capsule folder) */
        teamCapsuleKey: string;
    }>({ role: "", orgLevel: "", designationKey: "", managerId: null, monthlyDeliveryTargetCases: null, teamCapsuleKey: "" });
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [designations, setDesignations] = useState<{ id: number; key: string; label: string; businessUnit?: string | null }[]>([]);

    // Label to show on a node: the user's stored designation, else the one
    // derived from their legacy orgLevel/role, else the raw orgLevel.
    const designationLabelFor = (u: UserNode): string => {
        if (u.designationId != null) {
            const d = designations.find((x) => x.id === u.designationId);
            if (d) return d.label;
        }
        const key = legacyDesignationKey(u.orgLevel, u.role);
        return designations.find((x) => x.key === key)?.label ?? (ORG_LABELS[u.orgLevel] || u.orgLevel);
    };
    const [teamCapsuleCatalog, setTeamCapsuleCatalog] = useState<TeamCapsuleCatalog | null>(null);
    const [draggedUser, setDraggedUser] = useState<number | null>(null);
    const [dropTarget, setDropTarget] = useState<number | null>(null);
    const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set());
    const didDragRef = useRef(false);

    useEffect(() => {
        fetch("/api/capsules/catalog")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (d && typeof d === "object" && Array.isArray((d as TeamCapsuleCatalog).capsules)) {
                    setTeamCapsuleCatalog({
                        capsules: (d as TeamCapsuleCatalog).capsules,
                        productionLists: Array.isArray((d as TeamCapsuleCatalog).productionLists)
                            ? (d as TeamCapsuleCatalog).productionLists
                            : [],
                    });
                } else {
                    setTeamCapsuleCatalog({ capsules: [], productionLists: [] });
                }
            })
            .catch(() => setTeamCapsuleCatalog({ capsules: [], productionLists: [] }));
    }, []);

    // Designations for the single Designation picker (replaces Org Level + Role).
    useEffect(() => {
        fetch("/api/admin/rbac/designations")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (d?.designations) setDesignations(d.designations); })
            .catch(() => {});
    }, []);

    /** Sync list/capsule dropdown from stored user when opening editor or when catalog loads. */
    useEffect(() => {
        if (!editingUser || !teamCapsuleCatalog) return;
        const k = teamCapsuleToSelectionKey(editingUser.teamCapsule, teamCapsuleCatalog);
        setEditData((d) => ({ ...d, teamCapsuleKey: k }));
    }, [editingUser?.id, teamCapsuleCatalog]);

    // Pan & Zoom state
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [isPanning, setIsPanning] = useState(false);
    const panStart = useRef({ x: 0, y: 0 });
    const panOffset = useRef({ x: 0, y: 0 });
    const hasMoved = useRef(false);
    const canvasRef = useRef<HTMLDivElement>(null);

    // Build tree structure
    const topLevel = users.filter(u => !u.managerId || !users.find(m => m.id === u.managerId));
    // Split: hierarchy leaders vs unassigned users
    const hierarchyRoots = topLevel.filter(u => ["ceo", "special_access", "hod", "manager"].includes(u.orgLevel));
    const unassignedUsers = topLevel.filter(u => !["ceo", "special_access", "hod", "manager"].includes(u.orgLevel));
    const getChildren = useCallback((parentId: number) => users.filter(u => u.managerId === parentId), [users]);

    const openEdit = (user: UserNode) => {
        setSaveError(null);
        setEditingUser(user);
        // Prefer the user's truly-stored designation; fall back to deriving one
        // from the legacy orgLevel/role only when they have none yet.
        const storedKey = user.designationId != null
            ? designations.find((d) => d.id === user.designationId)?.key
            : undefined;
        setEditData({
            role: user.role,
            orgLevel: user.orgLevel,
            designationKey: storedKey ?? legacyDesignationKey(user.orgLevel, user.role),
            managerId: user.managerId,
            monthlyDeliveryTargetCases: user.monthlyDeliveryTargetCases ?? null,
            teamCapsuleKey: "",
        });
    };

    const toggleExpand = (userId: number, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedNodes(prev => {
            const next = new Set(prev);
            if (next.has(userId)) next.delete(userId);
            else next.add(userId);
            return next;
        });
    };

    const saveEdit = async () => {
        if (!editingUser) return;
        setSaving(true);
        setSaveError(null);
        const designationId = designations.find((d) => d.key === editData.designationKey)?.id ?? null;
        const payload: OrgUserUpdatePayload = {
            role: editData.role,
            orgLevel: editData.orgLevel,
            designationId,
            managerId: editData.managerId,
            teamCapsule: teamCapsuleSelectionKeyToName(editData.teamCapsuleKey, teamCapsuleCatalog),
        };
        if (editData.role === "production_manager" || editData.role === "researcher_manager") {
            payload.monthlyDeliveryTargetCases = editData.monthlyDeliveryTargetCases;
        }
        try {
            await onUserUpdate(editingUser.id, payload);
            setEditingUser(null);
        } catch (e: unknown) {
            setSaveError(e instanceof Error ? e.message : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const handleDragStart = (e: React.DragEvent, userId: number) => {
        didDragRef.current = true;
        setDraggedUser(userId);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", userId.toString());
    };

    const handleDragOver = (e: React.DragEvent, targetId: number) => {
        e.preventDefault();
        if (draggedUser !== targetId) {
            setDropTarget(targetId);
        }
    };

    const handleDragLeave = () => setDropTarget(null);

    const handleDrop = async (e: React.DragEvent, targetId: number) => {
        e.preventDefault();
        setDropTarget(null);
        if (draggedUser && draggedUser !== targetId) {
            await onUserUpdate(draggedUser, { managerId: targetId });
        }
        setDraggedUser(null);
    };

    // ── Pan handlers ────────────────────────────────────────
    const handleMouseDown = (e: React.MouseEvent) => {
        // Only pan on left click on the canvas background (not on cards)
        if (e.button !== 0) return;
        setIsPanning(true);
        hasMoved.current = false;
        panStart.current = { x: e.clientX, y: e.clientY };
        panOffset.current = { x: pan.x, y: pan.y };
    };

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isPanning) return;
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            hasMoved.current = true;
        }
        setPan({ x: panOffset.current.x + dx, y: panOffset.current.y + dy });
    }, [isPanning]);

    const handleMouseUp = useCallback(() => {
        setIsPanning(false);
        // Reset hasMoved after click event has fired (click fires after mouseup)
        setTimeout(() => { hasMoved.current = false; }, 10);
    }, []);

    useEffect(() => {
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [handleMouseMove, handleMouseUp]);

    // ── Zoom handler (Ctrl + Wheel) ─────────────────────────
    const handleWheel = useCallback((e: WheelEvent) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        setZoom(z => Math.min(2, Math.max(0.3, z + delta)));
    }, []);

    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return;
        el.addEventListener("wheel", handleWheel, { passive: false });
        return () => el.removeEventListener("wheel", handleWheel);
    }, [handleWheel]);

    const resetView = () => {
        setPan({ x: 0, y: 0 });
        setZoom(1);
    };

    const managers = users.filter(
        (u) =>
            ["ceo", "special_access", "hod", "manager", "hr_manager", "lead", "sub_lead"].includes(u.orgLevel) ||
            u.role === "production_manager" ||
            u.role === "researcher_manager"
    );

    const UserCard = ({ user, depth = 0 }: { user: UserNode; depth?: number }) => {
        const children = getChildren(user.id);
        const isDropping = dropTarget === user.id;
        const isDragging = draggedUser === user.id;

        return (
            <div className="flex flex-col items-center">
                {/* Card — click to edit, drag to reassign */}
                <div
                    draggable
                    onDragStart={(e) => handleDragStart(e, user.id)}
                    onDragEnd={() => {
                        setDraggedUser(null);
                        setDropTarget(null);
                        setTimeout(() => {
                            didDragRef.current = false;
                        }, 0);
                    }}
                    onDragOver={(e) => handleDragOver(e, user.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, user.id)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (!didDragRef.current) openEdit(user);
                        didDragRef.current = false;
                    }}
                    className={`
                        relative w-[180px] rounded-xl border-2 p-3 cursor-pointer select-none
                        transition-all duration-200 hover:scale-[1.03] hover:shadow-lg hover:shadow-black/20
                        ${ORG_COLORS[user.orgLevel] || ORG_COLORS.member}
                        ${isDropping ? "ring-2 ring-violet-500 scale-[1.05] bg-violet-500/10" : ""}
                        ${isDragging ? "opacity-40 scale-95" : ""}
                    `}
                >
                    <div className="flex flex-col items-center gap-2 pointer-events-none">
                        {/* Avatar */}
                        <UserAvatar
                            name={user.name}
                            src={user.profilePictureUrl}
                            rounded="full"
                            gradient={
                                user.orgLevel === "ceo" ? "from-amber-600 to-amber-400" :
                                user.orgLevel === "hod" ? "from-blue-600 to-blue-400" :
                                user.orgLevel === "manager" ? "from-emerald-600 to-emerald-400" :
                                "from-violet-600 to-violet-400"
                            }
                            className="ring-2 ring-white/10"
                        />
                        {/* Name */}
                        <div className="text-center">
                            <p className="text-white text-xs font-semibold leading-tight line-clamp-1">{user.name}</p>
                            <p className="text-slate-500 text-[9px] mt-0.5 line-clamp-1">{user.email}</p>
                        </div>
                        {/* Badges */}
                        <div className="flex flex-wrap gap-1 justify-center">
                            <span className={`text-[8px] px-1.5 py-0.5 rounded-md border font-semibold uppercase tracking-wide ${ORG_BADGE_COLORS[user.orgLevel] || ORG_BADGE_COLORS.member}`}>
                                {designationLabelFor(user)}
                            </span>
                        </div>
                    </div>
                    {/* Children count badge */}
                    {children.length > 0 && (
                        <div
                            onClick={(e) => toggleExpand(user.id, e)}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 bg-emerald-600 hover:bg-emerald-500 text-white text-[9px] font-bold w-5 h-5 rounded-full flex items-center justify-center ring-2 ring-[#12122a] cursor-pointer transition-all hover:scale-110"
                            title={expandedNodes.has(user.id) ? "Collapse team" : "Expand team"}
                        >
                            {expandedNodes.has(user.id) ? "−" : children.length}
                        </div>
                    )}
                </div>

                {/* Children */}
                {children.length > 0 && expandedNodes.has(user.id) && (
                    <div className="flex flex-col items-center mt-1 animate-in fade-in slide-in-from-top-2 duration-200">
                        {/* Vertical connector */}
                        <div className="w-0.5 h-6 bg-slate-400 dark:bg-white/20" />
                        {/* Horizontal connector + children */}
                        <div className="relative flex gap-4">
                            {/* Horizontal line */}
                            {children.length > 1 && (
                                <div className="absolute top-0 left-[90px] right-[90px] h-0.5 bg-slate-400 dark:bg-white/20" />
                            )}
                            {children.map((child) => (
                                <div key={child.id} className="flex flex-col items-center">
                                    <div className="w-0.5 h-4 bg-slate-400 dark:bg-white/20" />
                                    <UserCard user={child} depth={depth + 1} />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="relative">
            {/* Canvas controls */}
            <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
                <span className="text-[10px] text-slate-500 mr-1">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.min(2, z + 0.15))}
                    className="w-7 h-7 rounded-lg bg-white/10 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-sm hover:bg-white/20 transition-all flex items-center justify-center">+</button>
                <button onClick={() => setZoom(z => Math.max(0.3, z - 0.15))}
                    className="w-7 h-7 rounded-lg bg-white/10 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-sm hover:bg-white/20 transition-all flex items-center justify-center">−</button>
                <button onClick={resetView}
                    className="px-2 h-7 rounded-lg bg-white/10 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-[10px] hover:bg-white/20 transition-all">Reset</button>
            </div>

            {/* Interactive Canvas */}
            <div
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                className={`overflow-hidden relative ${isPanning ? "cursor-grabbing" : "cursor-grab"}`}
                style={{ height: "calc(100vh - 280px)", minHeight: "500px" }}
            >
                <div
                    className="absolute inset-0"
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: "center top",
                        transition: isPanning ? "none" : "transform 0.15s ease-out",
                    }}
                >
                    <div className="flex flex-wrap gap-8 justify-center min-w-fit p-8 pt-12">
                        {hierarchyRoots.map(user => (
                            <UserCard key={user.id} user={user} />
                        ))}

                        {/* Non Production Team group */}
                        {unassignedUsers.length > 0 && (
                            <div className="flex flex-col items-center">
                                <div
                                    className="relative w-[180px] rounded-xl border-2 border-dashed border-slate-500/30 bg-slate-800/20 p-3 cursor-pointer select-none transition-all duration-200 hover:border-slate-400/50"
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedNodes(prev => {
                                            const next = new Set(prev);
                                            if (next.has(-1)) next.delete(-1);
                                            else next.add(-1);
                                            return next;
                                        });
                                    }}
                                >
                                    <div className="flex flex-col items-center gap-2">
                                        <div className="w-10 h-10 rounded-full bg-slate-700/40 flex items-center justify-center text-slate-400 text-lg">👤</div>
                                        <div className="text-center">
                                            <p className="text-white text-xs font-semibold">Non Production Team</p>
                                            <p className="text-slate-500 text-[9px] mt-0.5">Unassigned users</p>
                                        </div>
                                        <span className="text-[8px] px-1.5 py-0.5 rounded-md border bg-slate-600/15 text-slate-400 border-slate-500/25 font-semibold uppercase tracking-wide">
                                            {unassignedUsers.length} Members
                                        </span>
                                    </div>
                                    <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 bg-slate-600 hover:bg-slate-500 text-white text-[9px] font-bold w-5 h-5 rounded-full flex items-center justify-center ring-2 ring-[#12122a] cursor-pointer transition-all hover:scale-110">
                                        {expandedNodes.has(-1) ? "−" : unassignedUsers.length}
                                    </div>
                                </div>
                                {expandedNodes.has(-1) && (
                                    <div className="flex flex-col items-center mt-1">
                                        <div className="w-0.5 h-6 bg-slate-400 dark:bg-white/20" />
                                        <div className="relative flex flex-wrap gap-4 justify-center">
                                            {unassignedUsers.length > 1 && (
                                                <div className="absolute top-0 left-[90px] right-[90px] h-0.5 bg-slate-400 dark:bg-white/20" />
                                            )}
                                            {unassignedUsers.map(user => (
                                                <div key={user.id} className="flex flex-col items-center">
                                                    <div className="w-0.5 h-4 bg-slate-400 dark:bg-white/20" />
                                                    <UserCard user={user} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Drag hint */}
            <div className="text-center text-[10px] text-slate-500 py-2 border-t border-slate-200 dark:border-white/5">
                💡 Click card to edit • Hold + drag to reassign under a manager • Click + drag canvas to pan • Ctrl + scroll to zoom
            </div>

            {/* Edit Modal */}
            {editingUser && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
                    onClick={(e) => { if (e.target === e.currentTarget) setEditingUser(null); }}>
                    <div className="bg-white dark:bg-[#12122a] border border-slate-200 dark:border-white/10 rounded-2xl p-6 w-[380px] shadow-2xl">
                        <div className="flex items-center gap-3 mb-5">
                            <UserAvatar
                                name={editingUser.name}
                                src={editingUser.profilePictureUrl}
                                size="lg"
                                rounded="full"
                                gradient="from-violet-500 to-fuchsia-500"
                                className="ring-2 ring-slate-200 dark:ring-white/10"
                            />
                            <div>
                                <h3 className="text-slate-900 dark:text-white font-semibold text-sm">{editingUser.name}</h3>
                                <p className="text-slate-500 text-xs">{editingUser.email}</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 font-medium">Designation</label>
                                <select value={editData.designationKey}
                                    onChange={(e) => {
                                        const key = e.target.value;
                                        const { orgLevel, role } = legacyFromDesignationKey(key);
                                        setEditData(d => ({ ...d, designationKey: key, orgLevel, role }));
                                    }}
                                    className="w-full px-3 py-2.5 bg-slate-50 dark:bg-[#1a1a35] border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500/40">
                                    {designations.length === 0 && (
                                        <option value={editData.designationKey}>{editData.designationKey || "—"}</option>
                                    )}
                                    {designations.map(dg => <option key={dg.key} value={dg.key}>{dg.label} · {dg.businessUnit ?? "NB Media"}</option>)}
                                </select>
                                <p className="mt-1.5 text-[10px] text-slate-400">Sets access tier + scorecard. Replaces the old Org&nbsp;Level + Role.</p>
                            </div>
                            <div>
                                <label className="block text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 font-medium">Reports To</label>
                                <select value={editData.managerId || ""}
                                    onChange={(e) => setEditData(d => ({ ...d, managerId: e.target.value ? parseInt(e.target.value) : null }))}
                                    className="w-full px-3 py-2.5 bg-slate-50 dark:bg-[#1a1a35] border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500/40">
                                    <option value="">No Manager (Top Level)</option>
                                    {managers.filter(m => m.id !== editingUser.id).map(m => (
                                        <option key={m.id} value={m.id}>{m.name} ({ORG_LABELS[m.orgLevel]})</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 font-medium">
                                    Team / production list
                                </label>
                                <select
                                    value={editData.teamCapsuleKey}
                                    onChange={(e) =>
                                        setEditData((d) => ({ ...d, teamCapsuleKey: e.target.value }))
                                    }
                                    className="w-full px-3 py-2.5 bg-slate-50 dark:bg-[#1a1a35] border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                                >
                                    <option value="">— Not set —</option>
                                    {teamCapsuleCatalog &&
                                        teamCapsuleCatalog.productionLists.length > 0 && (
                                            <optgroup label="Production lists (recommended)">
                                                {teamCapsuleCatalog.productionLists.map((pl) => {
                                                    const capLabel =
                                                        pl.capsule?.shortName ||
                                                        pl.capsule?.name ||
                                                        pl.name;
                                                    return (
                                                        <option key={`l-${pl.id}`} value={`l:${pl.id}`}>
                                                            {capLabel} — {pl.name}
                                                        </option>
                                                    );
                                                })}
                                            </optgroup>
                                        )}
                                    {teamCapsuleCatalog && teamCapsuleCatalog.capsules.length > 0 && (
                                        <optgroup label="Whole capsule (all lists in folder)">
                                            {teamCapsuleCatalog.capsules.map((c) => (
                                                <option key={`c-${c.id}`} value={`c:${c.id}`}>
                                                    All lists — {c.shortName || c.name}
                                                </option>
                                            ))}
                                        </optgroup>
                                    )}
                                </select>
                                {teamCapsuleCatalog &&
                                    editingUser.teamCapsule?.trim() &&
                                    teamCapsuleToSelectionKey(
                                        editingUser.teamCapsule,
                                        teamCapsuleCatalog,
                                    ) === "" && (
                                        <p className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                                            Stored "{editingUser.teamCapsule}" does not match any synced
                                            production list or capsule. Pick an option below or save to clear it.
                                        </p>
                                    )}
                            </div>
                            {(editData.role === "production_manager" || editData.role === "researcher_manager") && (
                                <div>
                                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 font-medium">
                                        Monthly delivery target
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        step={1}
                                        placeholder="e.g. 9"
                                        value={editData.monthlyDeliveryTargetCases ?? ""}
                                        onChange={(e) => {
                                            const raw = e.target.value;
                                            setEditData(d => ({
                                                ...d,
                                                monthlyDeliveryTargetCases: raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0),
                                            }));
                                        }}
                                        className="w-full px-3 py-2.5 bg-slate-50 dark:bg-[#1a1a35] border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                                    />
                                </div>
                            )}
                        </div>

                        {saveError && (
                            <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{saveError}</p>
                        )}

                        <div className="flex gap-3 mt-6">
                            <button onClick={() => setEditingUser(null)}
                                className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-sm rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                                Cancel
                            </button>
                            <button onClick={saveEdit} disabled={saving}
                                className="flex-1 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50">
                                {saving ? "Saving..." : "Save Changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
