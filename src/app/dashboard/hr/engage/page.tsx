"use client";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import SelectField from "@/components/ui/SelectField";
import { ThumbsUp, MessageSquare, Send, BarChart2, Award, MoreHorizontal, X, ChevronDown, Pencil, Trash2, Link2, Check, SmilePlus } from "lucide-react";
import Link from "next/link";
import { isHRAdmin, isLeadershipOrHR } from "@/lib/access";
import ChannelViewsTargetsPanel from "@/components/hr/ChannelViewsTargetsPanel";
import { PageShell, PageHeader, PageContainer } from "@/components/layout";

function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  const initials = name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  const colors = ["bg-violet-500","bg-emerald-500","bg-[#008CFF]","bg-amber-500","bg-pink-500","bg-teal-500"];
  const color  = colors[name.charCodeAt(0) % colors.length];
  return url ? (
    <img src={url} alt={name} style={{ width: size, height: size }}
      className="rounded-full object-cover shrink-0" />
  ) : (
    <div style={{ width: size, height: size }}
      className={`${color} rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0`}>
      {initials}
    </div>
  );
}

/** Parse post body for `@Name` patterns and turn ones that match a
 *  real employee into clickable profile links. Returns the body as
 *  an array of React nodes that the renderer can drop straight into
 *  the <p> wrapper. Unknown @-handles stay as plain text so users
 *  typing @Someone-who-isn't-there don't get a broken link.
 *
 *  Match rule: case-insensitive, ignores spaces. So "@PiyushSudha"
 *  in the body matches employee "Piyush Sudha" in the DB. Composer
 *  always inserts mentions space-stripped (no whitespace inside the
 *  handle), so this is the canonical normalisation. */
function renderWithMentions(
  text: string,
  employees: Array<{ id: number; name: string }>,
): React.ReactNode[] {
  if (!text) return [text];
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  // Pre-index employees by their normalised name once, so each
  // match resolves in O(1).
  const byHandle = new Map<string, number>();
  for (const e of employees) byHandle.set(norm(e.name), e.id);

  const out: React.ReactNode[] = [];
  const re = /@([A-Za-z][A-Za-z0-9_]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const [full, handle] = match;
    const start = match.index;
    if (start > lastIndex) out.push(text.slice(lastIndex, start));
    const empId = byHandle.get(norm(handle));
    if (empId) {
      out.push(
        <Link
          key={`m-${start}`}
          href={`/dashboard/hr/people/${empId}`}
          className="text-[#008CFF] hover:text-[#0077dd] hover:underline font-medium"
        >
          {full}
        </Link>
      );
    } else {
      // Unknown handle — render as-is.
      out.push(full);
    }
    lastIndex = start + full.length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function PostCard({ post, sessionUser, employees }: { post: any; sessionUser: any; employees: Array<{ id: number; name: string }> }) {
  const sessionUserId = sessionUser?.dbId;
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  // Track the user's CURRENT reaction emoji (null = none) so the
  // React button can display it directly. Replaces the old single
  // boolean `localReacted` — multi-emoji reactions need the actual
  // emoji to render the button face.
  const myCurrentReaction = Array.isArray(post.reactions)
    ? (post.reactions.find((r: any) => r.userId === sessionUserId)?.emoji ?? null)
    : null;
  const [myReactionEmoji, setMyReactionEmoji] = useState<string | null>(myCurrentReaction);
  const [reactionCount, setReactionCount] = useState(post.reactions.length);
  // Emoji picker popover anchored above the React button.
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const reactionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reactionPickerRef  = useRef<HTMLDivElement | null>(null);
  const REACTION_EMOJIS = ["👍", "❤️", "🤣", "😮", "😢", "🙏", "👏", "🎉", "🎂", "🔥"];

  // Dots-menu state. Copy link is shown to everyone; Edit / Delete
  // to the author + leadership tier (CEO / HR team / developer). The
  // leadership-tier carve-out lets HR moderate posts that go up
  // without needing the original author. Excludes special_access +
  // role=admin per the same policy used for documents (see
  // canViewEmployeeDocuments in src/lib/access.ts).
  const isAuthor   = post.author.id === sessionUserId;
  const canModerate = isLeadershipOrHR(sessionUser);
  const canEdit    = isAuthor || canModerate;
  const canDelete  = isAuthor || canModerate;

  // Per-comment delete — comment owner OR developer OR
  // orgLevel="hr_manager" (covers HR Manager + HR tier).
  const canDeleteComment = (c: any) => {
    if (!c) return false;
    if (c.author?.id === sessionUserId) return true;
    if (sessionUser?.isDeveloper === true) return true;
    if (sessionUser?.orgLevel === "hr_manager") return true;
    return false;
  };
  const [openCommentMenu, setOpenCommentMenu] = useState<number | null>(null);
  const [deletingComment, setDeletingComment] = useState<number | null>(null);

  const deleteComment = async (commentId: number) => {
    if (!confirm("Delete this comment? This can't be undone.")) return;
    setDeletingComment(commentId);
    setOpenCommentMenu(null);
    try {
      const res = await fetch(`/api/hr/engage/posts/${post.id}/comments/${commentId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Delete failed (${res.status})`);
      }
      mutate((k: any) => typeof k === "string" && k.startsWith("/api/hr/engage/posts"));
    } catch (e: any) {
      alert(e?.message || "Couldn't delete the comment.");
    } finally {
      setDeletingComment(null);
    }
  };

  const formatCommentTime = (iso: string | Date | undefined): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const diffSec = (Date.now() - d.getTime()) / 1000;
    if (diffSec < 60)          return "just now";
    if (diffSec < 3600)        return `${Math.floor(diffSec / 60)}m`;
    if (diffSec < 86400)       return `${Math.floor(diffSec / 3600)}h`;
    if (diffSec < 86400 * 7)   return `${Math.floor(diffSec / 86400)}d`;
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };
  const [menuOpen, setMenuOpen]   = useState(false);
  const [editing,  setEditing]    = useState(false);
  const [draft,    setDraft]      = useState(post.content);
  const [saving,   setSaving]     = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);

  // Compute the dropdown's screen position from the trigger's bounding
  // box and render via a body-level portal. Going through a portal
  // sidesteps the card's overflow-hidden — the previous menu rendered
  // inside the card and was getting clipped, which is why "nothing
  // appeared" when clicking the dots.
  const openMenu = () => {
    if (!menuBtnRef.current) return;
    const r = menuBtnRef.current.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setMenuOpen(true);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const insideBtn   = menuBtnRef.current?.contains(e.target as Node);
      const insidePanel = menuPanelRef.current?.contains(e.target as Node);
      if (!insideBtn && !insidePanel) setMenuOpen(false);
    };
    const onScroll = () => setMenuOpen(false); // close on scroll — fixed pos drifts
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll",   onScroll, true);
    window.addEventListener("resize",   onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [menuOpen]);

  // Three-way pick: same emoji = remove, different = replace, none = add.
  const pickReaction = async (emoji: string) => {
    setReactionPickerOpen(false);
    const prior = myReactionEmoji;
    if (prior === emoji) {
      setMyReactionEmoji(null);
      setReactionCount((c: number) => Math.max(0, c - 1));
    } else if (prior) {
      setMyReactionEmoji(emoji);
    } else {
      setMyReactionEmoji(emoji);
      setReactionCount((c: number) => c + 1);
    }
    try {
      await fetch(`/api/hr/engage/posts/${post.id}/react`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }),
      });
    } catch { /* SWR revalidate corrects */ }
    mutate("/api/hr/engage/posts");
  };
  const onReactButtonClick = () => {
    if (myReactionEmoji) { pickReaction(myReactionEmoji); return; }
    setReactionPickerOpen(true);
  };
  useEffect(() => {
    if (!reactionPickerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setReactionPickerOpen(false); };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (reactionTriggerRef.current?.contains(t)) return;
      if (reactionPickerRef.current?.contains(t))  return;
      setReactionPickerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [reactionPickerOpen]);

  const submitComment = async () => {
    if (!commentText.trim()) return;
    await fetch(`/api/hr/engage/posts/${post.id}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: commentText }),
    });
    setCommentText("");
    mutate("/api/hr/engage/posts");
  };

  const saveEdit = async () => {
    if (!draft.trim() || draft === post.content) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/engage/posts/${post.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Could not save edit"); return; }
      setEditing(false);
      mutate("/api/hr/engage/posts");
    } finally { setSaving(false); }
  };

  const deletePost = async () => {
    if (!confirm("Delete this post? This can't be undone.")) return;
    const res = await fetch(`/api/hr/engage/posts/${post.id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Could not delete"); return; }
    mutate("/api/hr/engage/posts");
  };

  // Copy a sharable URL pointing at this post. There's no per-post
  // permalink page yet — the engage feed lives at /dashboard/hr/engage,
  // so we hash-fragment the post id (#post-N). The feed is single-page
  // so any future deep-link handler can scroll to the matching card.
  const copyLink = async () => {
    const url = `${window.location.origin}/dashboard/hr/engage#post-${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      // Fallback for browsers / contexts where the Clipboard API is
      // blocked (HTTP, sandboxed iframes). Show the URL so the user
      // can copy manually.
      window.prompt("Copy this link:", url);
    }
  };

  const isPraise = post.type === "praise";

  // Long-content truncation — collapse to ~280 chars or 4 lines and
  // show a "View more" toggle. Matches the reference layout where
  // birthday-style posts get clipped under a fold.
  const COLLAPSE_AT = 280;
  const tooLong    = post.content.length > COLLAPSE_AT || (post.content.match(/\n/g)?.length ?? 0) > 3;
  const [expanded, setExpanded] = useState(false);
  const visibleBody = !tooLong || expanded
    ? post.content
    : post.content.slice(0, COLLAPSE_AT).trimEnd() + "…";

  // Reactor list — compact inline "{latest} and +N others",
  // click +N opens an anchored popover (matches the home feed).
  const reactorNames: string[] = Array.isArray(post.reactions)
    ? post.reactions.map((r: any) => r.user?.name).filter(Boolean)
    : [];
  // Name + emoji pairs for the reactor popover (who reacted with what).
  const reactors: Array<{ name: string; emoji: string }> = Array.isArray(post.reactions)
    ? post.reactions
        .filter((r: any) => r.user?.name)
        .map((r: any) => ({ name: r.user.name as string, emoji: (r.emoji as string) || "👍" }))
    : [];
  // Distinct emojis used on this post, top 3 by count — feeds the
  // stacked-emoji chip in the summary.
  const emojiCounts = new Map<string, number>();
  if (Array.isArray(post.reactions)) {
    for (const r of post.reactions) {
      const e = (r?.emoji as string) || "👍";
      emojiCounts.set(e, (emojiCounts.get(e) ?? 0) + 1);
    }
  }
  const topEmojis: string[] = [...emojiCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([e]) => e)
    .slice(0, 3);
  const latestReactor = reactorNames.length > 0 ? reactorNames[reactorNames.length - 1] : null;
  const otherReactors = reactorNames.length > 1 ? reactorNames.length - 1 : 0;
  const [reactorsOpen, setReactorsOpen] = useState(false);
  const [reactorsAnchor, setReactorsAnchor] = useState<{ top: number; left: number } | null>(null);
  const reactorsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reactorsPanelRef   = useRef<HTMLDivElement | null>(null);
  const openReactorsPopover = () => {
    const btn = reactorsTriggerRef.current;
    if (!btn) { setReactorsOpen(true); return; }
    const rect = btn.getBoundingClientRect();
    const PANEL_W = 200;
    const PANEL_H_GUESS = Math.min(260, 12 + reactorNames.length * 30);
    const GAP = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const above = rect.top - GAP - PANEL_H_GUESS;
    const below = rect.bottom + GAP;
    const top = above >= 8 ? above : Math.min(below, vh - PANEL_H_GUESS - 8);
    let left = rect.right - PANEL_W;
    if (left < 8) left = 8;
    if (left + PANEL_W > vw - 8) left = vw - PANEL_W - 8;
    setReactorsAnchor({ top, left });
    setReactorsOpen(true);
  };
  useEffect(() => {
    if (!reactorsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setReactorsOpen(false); };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (reactorsTriggerRef.current?.contains(t)) return;
      if (reactorsPanelRef.current?.contains(t))   return;
      setReactorsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [reactorsOpen]);

  return (
    // overflow-visible (was overflow-hidden) so any absolute children
    // — including a dropdown if the portal route is unavailable —
    // aren't clipped at the card boundary. Image and praise header
    // already have their own internal overflow-hidden where needed.
    <div id={`post-${post.id}`} className="bg-white dark:bg-[#0d1b2a] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-visible scroll-mt-24">
      {isPraise && (
        <div className="rounded-t-xl bg-gradient-to-r from-amber-500/10 to-orange-500/5 border-b border-amber-200/50 dark:border-amber-500/20 px-5 py-2 flex items-center gap-2">
          <Award className="w-4 h-4 text-amber-500" />
          <span className="text-[12px] font-semibold text-amber-700 dark:text-amber-400">
            {post.author.name} praised {post.praiseTo?.name}
          </span>
        </div>
      )}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Avatar name={post.author.name} url={post.author.profilePictureUrl} size={38} />
            <div>
              <p className="text-[13px] font-semibold text-slate-800 dark:text-white">{post.author.name}
                <span className="text-slate-400 dark:text-slate-500 font-normal"> created a post</span>
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{timeAgo(post.createdAt)}</p>
            </div>
          </div>
          <button
            ref={menuBtnRef}
            onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
            aria-label="More options"
            aria-expanded={menuOpen}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && menuPos && typeof document !== "undefined" && createPortal(
            <div
              ref={menuPanelRef}
              style={{ position: "fixed", top: menuPos.top, right: menuPos.right, zIndex: 1000 }}
              className="min-w-[160px] rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d1b2a] shadow-lg overflow-hidden"
            >
              {canEdit && (
                <button
                  onClick={() => { setMenuOpen(false); setDraft(post.content); setEditing(true); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
              )}
              <button
                onClick={() => { setMenuOpen(false); copyLink(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
              >
                {linkCopied
                  ? (<><Check className="w-3.5 h-3.5 text-emerald-600" /> Link copied</>)
                  : (<><Link2 className="w-3.5 h-3.5" /> Copy link</>)}
              </button>
              {canDelete && (
                <button
                  onClick={() => { setMenuOpen(false); deletePost(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )}
            </div>,
            document.body,
          )}
        </div>

        {editing ? (
          <div className="mt-3 space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-[14px] text-slate-700 dark:text-slate-200 focus:outline-none focus:border-[#008CFF]"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setEditing(false); setDraft(post.content); }}
                disabled={saving}
                className="h-8 px-3 rounded-lg text-[12px] font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="h-8 px-4 rounded-lg bg-[#008CFF] hover:bg-[#0077dd] text-white text-[12px] font-semibold disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-3 text-[14px] text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{renderWithMentions(visibleBody, employees)}</p>
            {tooLong && (
              <button
                onClick={() => setExpanded((p) => !p)}
                className="mt-1 text-[12.5px] font-semibold text-[#008CFF] hover:text-[#0077dd]"
              >
                {expanded ? "View less" : "View more"}
              </button>
            )}
          </>
        )}

        {post.mediaUrl && (
          // Image fills the post card width and grows to its natural
          // height, capped so a single tall portrait can't dominate
          // the feed. Matches the Keka layout HR shared — work-
          // anniversary cards / posters render large and prominent
          // instead of tiny letterboxed thumbnails. `object-contain`
          // keeps the whole image visible (no crop). The subtle
          // background only shows on rare wider-than-card images.
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/[0.02]">
            <img
              src={post.mediaUrl}
              alt="post media"
              className="block w-full h-auto max-h-[640px] object-contain"
            />
          </div>
        )}
      </div>

      {/* Footer — Like / Comment on the left, reaction summary on the right.
          Single row replaces the previous two-row layout (separate count
          row + full-width action split) so the card matches the reference
          design HR shared. */}
      <div className="flex items-center justify-between px-2 sm:px-3 py-1.5 border-t border-slate-100 dark:border-white/[0.04]">
        <div className="flex items-center">
          <div className="relative">
            <button
              ref={reactionTriggerRef}
              type="button"
              onClick={onReactButtonClick}
              title={myReactionEmoji ? "Click to remove" : "React"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors ${
                myReactionEmoji ? "text-[#008CFF]" : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {myReactionEmoji ? (
                <span className="text-[16px] leading-none">{myReactionEmoji}</span>
              ) : (
                <SmilePlus className="w-4 h-4" />
              )}
              React
            </button>
            {reactionPickerOpen && (
              <div
                ref={reactionPickerRef}
                role="dialog"
                className="absolute bottom-full left-0 mb-1.5 z-50 flex items-center gap-0.5 px-1 py-1 rounded-full border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0d1b2a] shadow-[0_6px_18px_-4px_rgba(15,23,42,0.25)] animate-in fade-in zoom-in-95 duration-100"
              >
                {REACTION_EMOJIS.map((e) => {
                  const isMine = e === myReactionEmoji;
                  return (
                    <button
                      key={e}
                      type="button"
                      onClick={() => pickReaction(e)}
                      title={isMine ? "Click to remove" : "React"}
                      className={`h-7 w-7 flex items-center justify-center rounded-full text-[16px] transition-transform hover:scale-110 ${isMine ? "bg-[#e6f3ff] dark:bg-[#008CFF]/20" : "hover:bg-slate-50 dark:hover:bg-white/[0.04]"}`}
                    >
                      {e}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button onClick={() => setShowComments(p => !p)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors ${
              showComments ? "text-[#008CFF]" : "text-slate-500 dark:text-slate-400"
            }`}>
            <MessageSquare className="w-4 h-4" />
            <span>
              {post.comments.length === 0 && "Comment"}
              {post.comments.length === 1 && "1 Comment"}
              {post.comments.length > 1 && `${post.comments.length} Comments`}
            </span>
          </button>
        </div>
        <div className="flex items-center gap-1.5 pr-2 text-[12px] text-slate-500 dark:text-slate-400">
          {reactionCount > 0 && (
            // Compact reactor summary — stacked top emojis reflect
            // the distinct reactions used, latest name inline,
            // clickable +N opens the anchored reactor popover.
            <span className="inline-flex items-center gap-1">
              <span className="inline-flex items-center -space-x-1">
                {topEmojis.map((e, i) => (
                  <span
                    key={e}
                    className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-white dark:bg-[#0d1b2a] text-[12px] ring-1 ring-slate-200 dark:ring-white/[0.08] shadow-sm leading-none"
                    style={{ zIndex: topEmojis.length - i }}
                  >
                    {e}
                  </span>
                ))}
              </span>
              <span className="truncate max-w-[180px]" title={latestReactor || ""}>{latestReactor}</span>
              {otherReactors > 0 && (
                <button
                  ref={reactorsTriggerRef}
                  type="button"
                  onClick={openReactorsPopover}
                  className="font-semibold text-[#008CFF] hover:underline"
                >
                  and +{otherReactors} {otherReactors === 1 ? "other" : "others"}
                </button>
              )}
            </span>
          )}
          {/* Comment count moved onto the Comment button itself. */}
        </div>
      </div>

      {/* Comments section */}
      {showComments && (
        <div className="border-t border-slate-100 dark:border-white/[0.04] px-5 py-3 space-y-3.5 bg-white dark:bg-[#0d1b2a]">
          {post.comments.map((c: any) => {
            const showDelete = canDeleteComment(c);
            const isMenuOpen = openCommentMenu === c.id;
            const isDeleting = deletingComment === c.id;
            return (
              <div
                key={c.id}
                className={`group relative flex items-start gap-3 -mx-2 px-2 py-1.5 rounded-lg transition-all ${
                  isDeleting ? "opacity-50" : "hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                }`}
              >
                <div className="shrink-0 pt-0.5">
                  <Avatar name={c.author.name} url={c.author.profilePictureUrl} size={30} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12.5px] leading-relaxed break-words min-w-0 text-slate-800 dark:text-slate-200">
                      <span className="font-semibold text-slate-900 dark:text-white mr-1.5">{c.author.name}</span>
                      <span className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
                        {renderWithMentions(c.content, employees)}
                      </span>
                    </p>
                    {showDelete && (
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setOpenCommentMenu(isMenuOpen ? null : c.id)}
                          disabled={isDeleting}
                          aria-label="Comment options"
                          className={`h-6 w-6 inline-flex items-center justify-center rounded-full text-slate-400 transition-all ${
                            isMenuOpen
                              ? "bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-200 opacity-100"
                              : "opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-700"
                          }`}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                        {isMenuOpen && (
                          <>
                            <button
                              type="button"
                              aria-hidden="true"
                              tabIndex={-1}
                              onClick={() => setOpenCommentMenu(null)}
                              className="fixed inset-0 z-30 cursor-default"
                              style={{ background: "transparent" }}
                            />
                            <div className="absolute right-0 top-7 z-40 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0d1b2a] shadow-[0_8px_24px_-6px_rgba(15,23,42,0.18)] overflow-hidden py-1">
                              <button
                                type="button"
                                onClick={() => deleteComment(c.id)}
                                className="w-full px-3 py-1.5 text-left text-[12px] font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 inline-flex items-center gap-2 whitespace-nowrap"
                              >
                                <Trash2 className="h-3.5 w-3.5 shrink-0" />
                                <span>Delete comment</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10.5px] font-medium text-slate-400 dark:text-slate-500">
                    {formatCommentTime(c.createdAt)}
                  </div>
                </div>
              </div>
            );
          })}
          <div className={`flex items-center gap-3 ${post.comments.length > 0 ? "pt-1" : ""}`}>
            <div className="shrink-0">
              <Avatar name="You" size={30} />
            </div>
            <div className="flex-1 flex items-center gap-1 bg-slate-100 dark:bg-white/[0.04] border border-transparent rounded-full pl-4 pr-1 py-1 focus-within:bg-white dark:focus-within:bg-[#0d1b2a] focus-within:border-[#008CFF] focus-within:shadow-[0_0_0_3px_rgba(0,140,255,0.08)] transition-all">
              <input
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submitComment()}
                placeholder="Write a comment…"
                className="flex-1 bg-transparent text-[12.5px] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none py-1.5"
              />
              <button
                onClick={submitComment}
                disabled={!commentText.trim()}
                title="Send"
                className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full text-[#008CFF] hover:bg-[#008CFF]/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reactors popover — minimal anchored card. No header, no
          close button (click-outside / Esc handles it). */}
      {reactorsOpen && reactorsAnchor && typeof document !== "undefined" && createPortal(
        <div
          ref={reactorsPanelRef}
          role="dialog"
          aria-modal="false"
          style={{ position: "fixed", top: reactorsAnchor.top, left: reactorsAnchor.left, width: 200, zIndex: 10000 }}
          className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0d1b2a] shadow-[0_6px_18px_-4px_rgba(15,23,42,0.2)] animate-in fade-in duration-100"
        >
          <ul className="max-h-[220px] overflow-y-auto py-1.5">
            {reactors.map((r, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-1.5">
                <span className="text-[15px] leading-none shrink-0">{r.emoji}</span>
                <span className="truncate text-[12px] text-slate-700 dark:text-slate-200">{r.name}</span>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default function EngagePage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const sessionUserId = user?.dbId;

  const { data: posts = [], isLoading } = useSWR("/api/hr/engage/posts", fetcher);
  // Only active employees show up in the @mention picker — offboarded
  // people stay in the DB but shouldn't be addressable in new posts.
  const { data: employees = [] } = useSWR("/api/hr/employees?isActive=true", fetcher);

  const [feedTab, setFeedTab]   = useState<"post"|"poll"|"praise">("post");
  const [scopeTab, setScopeTab] = useState("Organization");
  const [content, setContent]   = useState("");
  const [praiseToId, setPraiseToId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Inline image upload. The image is converted to a data URL on the
  // client and stored in EngagePost.mediaUrl. We cap at 2 MB raw to
  // keep DB rows reasonable — the post card renders mediaUrl directly
  // in an <img>. The composer is gated to admin-tier so the byte
  // cost only ever lands on intentional admin posts, not on the
  // general workforce. content text serves as the caption.
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  // Surfaces a failed POST (403 Forbidden / 413 too-large / 500 / network)
  // under the composer. Previously submit() ignored the response, so a failed
  // post silently cleared the box with zero feedback — it just looked like
  // "I can't post anything."
  const [postError, setPostError] = useState<string | null>(null);
  // Wider HR-admin tier so role=admin + special_access also see the
  // composer, matching the rest of the dashboard's gate. Everyone
  // else (regular employees) sees the per-channel YouTube view
  // targets panel in the same slot below.
  const canCompose = isHRAdmin(user);

  const pickImage = (file: File | null) => {
    setMediaError(null);
    if (!file) { setMediaUrl(null); return; }
    if (!file.type.startsWith("image/")) {
      setMediaError("Only image files are allowed.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMediaError("Image too large — limit is 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") setMediaUrl(result);
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!content.trim() && !mediaUrl) return;
    setSubmitting(true);
    setPostError(null);
    try {
      const res = await fetch("/api/hr/engage/posts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          type: feedTab,
          praiseToId: praiseToId || undefined,
          mediaUrl: mediaUrl || undefined,
        }),
      });
      if (!res.ok) {
        // Keep the composer contents so the user can retry without retyping.
        const data = await res.json().catch(() => ({} as any));
        setPostError(
          res.status === 403 ? "You don't have permission to post here."
          : res.status === 413 ? "That image is too large — please use a smaller one."
          : data?.error || `Couldn't post (error ${res.status}). Please try again.`,
        );
        return;
      }
      // Success — clear the composer and refresh the feed.
      setContent(""); setPraiseToId(""); setMediaUrl(null);
      mutate("/api/hr/engage/posts");
    } catch {
      setPostError("Network error — please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="Engage"
        subtitle="Connect with your team — post updates, polls, and appreciation"
      />
      <PageContainer maxWidth="md" className="py-5 space-y-4">

        {/* Compose card — gated to admin tier (CEO / HR team /
            developer). Regular employees still see the feed but
            can't create new posts. Matches the moderation tier
            used for Edit / Delete on individual posts. */}
        <ChannelViewsTargetsPanel />
        {canCompose && (
        <div className="bg-white dark:bg-[#0d1b2a] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
          {/* Scope tabs */}
          <div className="flex items-center border-b border-slate-100 dark:border-white/[0.04] px-4">
            {["Organization", "NB Media"].map(t => (
              <button key={t} onClick={() => setScopeTab(t)}
                className={`px-4 py-3 text-[13px] font-semibold border-b-2 transition-colors -mb-px ${
                  scopeTab === t ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 dark:text-slate-400"
                }`}>{t}</button>
            ))}
          </div>

          <div className="p-4">
            {/* Post / Poll / Praise switcher */}
            <div className="flex items-center gap-2 mb-3">
              {[
                { key: "post",   label: "Post",   icon: Send },
                { key: "poll",   label: "Poll",   icon: BarChart2 },
                { key: "praise", label: "Praise", icon: Award },
              ].map(({ key, label, icon: Icon }) => (
                <button key={key} onClick={() => setFeedTab(key as any)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                    feedTab === key ? "bg-[#008CFF]/10 text-[#008CFF]" : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
                  }`}>
                  <Icon className="w-3.5 h-3.5" />{label}
                </button>
              ))}
            </div>

            {feedTab === "praise" && (
              <div className="mb-3">
                <SelectField
                  value={praiseToId}
                  onChange={setPraiseToId}
                  placeholder="Select someone to praise…"
                  options={employees.map((e: any) => ({ value: String(e.id), label: e.name }))}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-700 dark:text-slate-300"
                />
              </div>
            )}

            <div className="flex items-start gap-3">
              <Avatar name={user?.name || "You"} url={user?.profilePictureUrl} size={34} />
              <textarea
                value={content} onChange={e => setContent(e.target.value)}
                placeholder={
                  feedTab === "praise" ? "Write your appreciation message…" :
                  feedTab === "poll"   ? "What do you want to poll about?" :
                  "Write your post here and mention your peers"
                }
                rows={3}
                className="flex-1 resize-none bg-transparent text-[13px] text-slate-700 dark:text-slate-300 placeholder-slate-400 focus:outline-none"
              />
            </div>

            {/* Image attachment — optional. Preview + clear button when
                set; otherwise a small "+ Add image" button. The text
                box above doubles as the caption. */}
            {mediaUrl ? (
              <div className="mt-3 relative inline-block">
                <img src={mediaUrl} alt="Attached" className="max-h-64 rounded-lg border border-slate-200 dark:border-white/10" />
                <button
                  type="button"
                  onClick={() => { setMediaUrl(null); setMediaError(null); }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 hover:bg-black/80 text-white rounded-full flex items-center justify-center"
                  aria-label="Remove image"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <label className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] text-slate-500 hover:text-[#008CFF] hover:bg-slate-50 dark:hover:bg-white/[0.04] cursor-pointer transition-colors">
                <span aria-hidden>+</span> Add image
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
            {mediaError && (
              <p className="mt-1 text-[11.5px] text-red-600">{mediaError}</p>
            )}

            {postError && (
              <p className="mt-2 text-[12px] font-medium text-red-600">{postError}</p>
            )}
            {(content || mediaUrl) && (
              <div className="flex justify-end mt-2">
                <button onClick={submit} disabled={submitting}
                  className="h-8 px-5 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-50">
                  {submitting ? "Posting…" : feedTab === "praise" ? "Send Praise" : "Post"}
                </button>
              </div>
            )}
          </div>
        </div>
        )}

        {/* Feed */}
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-7 h-7 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <div className="bg-white dark:bg-[#0d1b2a] border border-slate-200 dark:border-white/[0.06] rounded-xl p-10 text-center">
            <p className="text-[14px] font-semibold text-slate-700 dark:text-slate-300">No posts yet</p>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">Be the first to post something!</p>
          </div>
        ) : (
          posts.map((post: any) => (
            <PostCard key={post.id} post={post} sessionUser={user} employees={employees} />
          ))
        )}
      </PageContainer>
    </PageShell>
  );
}
