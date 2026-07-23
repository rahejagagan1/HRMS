"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { getStatusColor, getChannelColor, formatDate, formatNumber } from "@/lib/utils";
import SubtaskTimeline from "@/components/cases/subtask-timeline";
// Lazy: YoutubeStats renders recharts — keep it off the case-detail initial load.
const YoutubeStats = dynamic(() => import("@/components/cases/youtube-stats"), { ssr: false });

function extractVideoId(url: string): string | null {
    if (!url) return null;
    const patterns = [
        /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
        /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

export default function CaseDetailPage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`/api/cases/${id}`)
            .then((res) => res.json())
            .then(setData)
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [id]);

    if (loading) {
        return (
            <div className="space-y-6">
                <div className="h-16 rounded-2xl bg-slate-100 dark:bg-[#12122a] border border-slate-200 dark:border-white/5 animate-pulse" />
                <div className="grid grid-cols-2 gap-6">
                    <div className="h-96 rounded-2xl bg-slate-100 dark:bg-[#12122a] border border-slate-200 dark:border-white/5 animate-pulse" />
                    <div className="h-96 rounded-2xl bg-slate-100 dark:bg-[#12122a] border border-slate-200 dark:border-white/5 animate-pulse" />
                </div>
            </div>
        );
    }

    if (!data || data.error) {
        return (
            <div className="text-center py-20">
                <p className="text-slate-500">Case not found</p>
            </div>
        );
    }

    const docLinks = [
        { label: "TTH Doc", url: data.tthDocLink },
        { label: "Script Draft", url: data.scriptFirstDraftLink },
        { label: "Final Script", url: data.finalScriptLink },
        { label: "VO Doc", url: data.voDocLink },
        { label: "Voiceover", url: data.voLink },
        { label: "Video Draft", url: data.videoFirstDraftLink },
        { label: "Final Video", url: data.finalVideoLink },
        { label: "▶ YouTube Video", url: data.youtubeVideoUrl },
    ].filter((d) => d.url);

    const shownIds = new Set<number>();
    const addPerson = (role: string, user: any) => {
        if (!user || shownIds.has(user.id)) return null;
        shownIds.add(user.id);
        return { role, user };
    };

    // Editors and writers from custom field join tables (authoritative source)
    const allEditors: any[] = data.allEditors?.map((e: any) => e.user).filter(Boolean) ?? [];
    const allWriters: any[] = data.allWriters?.map((w: any) => w.user).filter(Boolean) ?? [];

    // Fall back to single editorUserId/writerUserId if join tables are empty (pre-sync data)
    const editors = allEditors.length > 0 ? allEditors : [data.editor].filter(Boolean);
    const writers = allWriters.length > 0 ? allWriters : [data.writer].filter(Boolean);

    const namedRoleIds = new Set([
        data.researcher?.id,
        ...editors.map((u: any) => u.id),
        ...writers.map((u: any) => u.id),
    ].filter(Boolean));

    const allAssignees = data.assignees?.length > 0
        ? data.assignees.map((a: any) => a.user).filter(Boolean)
        : data.assignee ? [data.assignee] : [];
    const cmAssignees = allAssignees.filter((u: any) => !namedRoleIds.has(u.id));

    const people = [
        addPerson("Researcher", data.researcher),
        ...writers.map((u: any) => addPerson("Writer", u)),
        ...editors.map((u: any) => addPerson("Editor", u)),
        ...cmAssignees.map((u: any) => addPerson("CM", u)),
    ].filter(Boolean);

    const ytUrl = data.youtubeVideoUrl || data.finalVideoLink;
    const videoId = ytUrl ? extractVideoId(ytUrl) : null;

    return (
        <div className="space-y-6">
            {/* Back button */}
            <button
                onClick={() => router.back()}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors group self-start"
            >
                <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
            </button>
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">{data.name}</h1>
                        <span className={`px-2.5 py-0.5 text-[11px] font-medium rounded-lg border ${getStatusColor(data.status)}`}>
                            {data.status}
                        </span>
                        {data.channel && (
                            <span className={`px-2 py-0.5 text-[11px] font-medium rounded-md border ${getChannelColor(data.channel)}`}>
                                {data.channel}
                            </span>
                        )}
                    </div>
                    <p className="text-sm text-slate-500">
                        {data.productionList?.capsule?.shortName || data.productionList?.capsule?.name || ""}
                        {data.title && ` • ${data.title}`}
                    </p>
                </div>
                {data.clickupUrl && (
                    <a
                        href={data.clickupUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-xs text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10 transition-colors"
                    >
                        Open in ClickUp ↗
                    </a>
                )}
            </div>

            {/* People */}
            {people.length > 0 && (
                <div className="flex flex-wrap gap-4">
                    {people.map((p) => (
                        <div key={`${p.role}-${p.user.id}`} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-100 dark:bg-[#12122a] border border-slate-200 dark:border-white/5">
                            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500/40 to-fuchsia-500/40 flex items-center justify-center text-white text-sm font-medium">
                                {p.user.name.charAt(0)}
                            </div>
                            <div>
                                <p className="text-xs text-slate-500">{p.role}</p>
                                <p className="text-sm text-slate-800 dark:text-white font-medium">{p.user.name}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column */}
                <div className="space-y-6">
                    {/* Custom Fields */}
                    <div className="rounded-2xl bg-slate-100 dark:bg-[#12122a] border border-slate-200 dark:border-white/5 p-5">
                        <h3 className="text-sm font-medium text-slate-800 dark:text-white mb-4">Case Details</h3>
                        <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                                <span className="text-slate-500">Case Rating</span>
                                <p className="text-slate-800 dark:text-white mt-0.5">{data.caseRating || "—"}</p>
                            </div>
                            <div>
                                <span className="text-slate-500">Case Type</span>
                                <p className="text-slate-800 dark:text-white mt-0.5">{data.caseType || "—"}</p>
                            </div>
                            <div>
                                <span className="text-slate-500">Script Quality</span>
                                <p className="text-slate-800 dark:text-white mt-0.5">{data.scriptQualityRating || "—"}</p>
                            </div>
                            <div>
                                <span className="text-slate-500">Video Quality</span>
                                <p className="text-slate-800 dark:text-white mt-0.5">{data.videoQualityRating || "—"}</p>
                            </div>
                            <div>
                                <span className="text-slate-500">Writer Quality Score</span>
                                <p className="text-slate-800 dark:text-white mt-0.5">{data.writerQualityScore || "—"}</p>
                            </div>
                            <div>
                                <span className="text-slate-500">Editor Quality Score</span>
                                <p className="text-slate-800 dark:text-white mt-0.5">{data.editorQualityScore || "—"}</p>
                            </div>
                            <div>
                                <span className="text-slate-500">TAT</span>
                                <p className="text-slate-800 dark:text-white mt-0.5">{data.tat ? `${Number(data.tat).toFixed(1)} days` : "—"}</p>
                            </div>
                            <div>
                                <span className="text-slate-500">Upload Date</span>
                                <p className="text-slate-800 dark:text-white mt-0.5">{formatDate(data.uploadDate)}</p>
                            </div>
                            <div>
                                <span className="text-slate-500">Script QA Start Date</span>
                                <p className="text-slate-800 dark:text-white mt-0.5">{data.scriptQaStartDate ? new Date(data.scriptQaStartDate).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</p>
                            </div>
                            <div>
                                <span className="text-slate-500">QA Video Meeting Date</span>
                                <p className="text-slate-800 dark:text-white mt-0.5">{data.qaVideoMeetingDate ? new Date(data.qaVideoMeetingDate).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</p>
                            </div>
                        </div>
                    </div>

                    {/* Document Links */}
                    {docLinks.length > 0 && (
                        <div className="rounded-2xl bg-slate-100 dark:bg-[#12122a] border border-slate-200 dark:border-white/5 p-5">
                            <h3 className="text-sm font-medium text-slate-800 dark:text-white mb-3">Documents</h3>
                            <div className="flex flex-wrap gap-2">
                                {docLinks.map((doc) => (
                                    <a
                                        key={doc.label}
                                        href={doc.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-3 py-2 bg-white dark:bg-white/5 hover:bg-violet-50 dark:hover:bg-violet-500/20 border border-slate-300 dark:border-white/10 hover:border-violet-500 dark:hover:border-violet-500/30 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-violet-600 dark:hover:text-violet-300 shadow-sm hover:shadow-md transition-all"
                                    >
                                        {doc.label} ↗
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Subtask Timeline */}
                    <div className="rounded-2xl bg-slate-100 dark:bg-[#12122a] border border-slate-200 dark:border-white/5 p-5">
                        <h3 className="text-sm font-medium text-slate-800 dark:text-white mb-4">Production Pipeline</h3>
                        <SubtaskTimeline subtasks={data.subtasks || []} />
                    </div>
                </div>

                {/* Right Column — YouTube */}
                <div className="space-y-6">
                    {videoId && data.youtubeStats ? (
                        <div className="rounded-2xl bg-slate-100 dark:bg-[#12122a] border border-slate-200 dark:border-white/5 p-5">
                            <h3 className="text-sm font-medium text-slate-800 dark:text-white mb-4">YouTube Performance</h3>
                            {data.youtubeStats?.videoTitle && (
                                <p className="text-xs text-slate-500 dark:text-slate-300 mb-3 line-clamp-2">{data.youtubeStats.videoTitle}</p>
                            )}
                            <YoutubeStats
                                videoId={videoId}
                                viewCount={data.youtubeStats.viewCount}
                                likeCount={data.youtubeStats.likeCount}
                                commentCount={data.youtubeStats.commentCount}
                                last30DaysViews={data.youtubeStats.last30DaysViews}
                                publishedAt={data.youtubeStats.publishedAt}
                                history={data.youtubeStats.history || []}
                            />
                        </div>
                    ) : (
                        <div className="rounded-2xl bg-slate-100 dark:bg-[#12122a] border border-slate-200 dark:border-white/5 p-12 text-center">
                            <svg className="w-12 h-12 text-slate-700 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <p className="text-sm text-slate-500">No YouTube data</p>
                            <p className="text-[11px] text-slate-600 mt-1">Video not yet published or link not set</p>
                        </div>
                    )}

                    {/* QA Notes */}
                    {(data.scriptRatingReason || data.videoRatingReason) && (
                        <div className="rounded-2xl bg-slate-100 dark:bg-[#12122a] border border-slate-200 dark:border-white/5 p-5">
                            <h3 className="text-sm font-medium text-slate-800 dark:text-white mb-3">QA Notes</h3>
                            {data.scriptRatingReason && (
                                <div className="mb-3">
                                    <p className="text-[11px] text-slate-500 mb-1">Script Rating Reason</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-300">{data.scriptRatingReason}</p>
                                </div>
                            )}
                            {data.videoRatingReason && (
                                <div>
                                    <p className="text-[11px] text-slate-500 mb-1">Video Rating Reason</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-300">{data.videoRatingReason}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
