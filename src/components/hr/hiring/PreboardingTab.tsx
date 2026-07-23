"use client";

// Preboarding tab — bridges Hiring → Onboarding. Lists every
// candidate currently parked in the "preboarding" pipeline stage
// (the offer has been accepted, they haven't joined yet) plus
// anyone who has at least one OfferLetter row, so HR has a single
// place to track "people about to start". Clicking "Proceed to
// Onboarding" hands the candidate off to /dashboard/hr/onboard
// with ?fromCandidate=<id> so the form prefills name/email/phone/
// role from the application.

import { useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import {
  ArrowRight, Mail, Phone, Briefcase, Calendar, UserPlus, Search,
  Users as UsersIcon, CheckCircle2,
} from "lucide-react";
import { useState } from "react";

interface Stage { id: number; key: string; label: string; kind: string }
interface Candidate {
  id: number; fullName: string; email: string; phone: string | null;
  roleTitle: string | null; jobOpeningId: number;
  currentStage: Stage | null; enteredStageAt: string | null;
  source: string | null; createdAt: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}
const AVATAR_TONES = [
  "bg-emerald-500", "bg-[#3b82f6]", "bg-violet-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-fuchsia-500", "bg-indigo-500",
];
function avatarTone(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}
function daysIn(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export default function PreboardingTab() {
  const { data, isLoading } = useSWR<{ candidates: Candidate[] }>(
    "/api/hr/hiring/candidates", fetcher,
  );
  const all = data?.candidates ?? [];
  const [q, setQ] = useState("");

  // Anyone in a stage with key "preboarding" — fall back to label
  // match so it still works on DBs where the key was edited.
  const preboarding = useMemo(() => {
    const matches = all.filter((c) => {
      const k = (c.currentStage?.key ?? "").toLowerCase();
      const l = (c.currentStage?.label ?? "").toLowerCase();
      return k === "preboarding" || l === "preboarding";
    });
    if (!q.trim()) return matches;
    const needle = q.toLowerCase();
    return matches.filter((c) =>
      (c.fullName ?? "").toLowerCase().includes(needle) ||
      (c.email    ?? "").toLowerCase().includes(needle) ||
      (c.roleTitle ?? "").toLowerCase().includes(needle),
    );
  }, [all, q]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[20px] font-bold text-slate-900 tracking-tight inline-flex items-center gap-2">
            <UserPlus size={18} className="text-emerald-600" /> Preboarding
          </h2>
          <p className="mt-1 text-[12.5px] text-slate-500">
            Candidates who've accepted the offer but haven't joined yet. Click <strong>Proceed to Onboarding</strong> to start the employee setup flow.
          </p>
        </div>
        <span className="inline-flex items-center justify-center h-9 px-3.5 rounded-full bg-emerald-50 text-emerald-700 text-[12px] font-bold tabular-nums ring-1 ring-emerald-200">
          {preboarding.length} {preboarding.length === 1 ? "candidate" : "candidates"}
        </span>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, email, or role"
          className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 bg-white text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
        />
      </div>

      {/* Cards */}
      {isLoading ? (
        <div className="py-16 text-center">
          <div className="inline-block h-7 w-7 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : preboarding.length === 0 ? (
        <EmptyState hasFilter={!!q.trim()} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {preboarding.map((c) => <PreboardCard key={c.id} c={c} />)}
        </div>
      )}
    </div>
  );
}

function PreboardCard({ c }: { c: Candidate }) {
  const days = daysIn(c.enteredStageAt);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-emerald-300 hover:shadow-[0_8px_24px_-6px_rgba(15,23,42,0.08)] transition-all">
      <div className="flex items-start gap-3">
        <span className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-white text-[13px] font-bold shrink-0 ${avatarTone(c.fullName)}`}>
          {initials(c.fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-slate-900 truncate">{c.fullName}</p>
          {c.roleTitle && (
            <p className="text-[11.5px] text-slate-500 inline-flex items-center gap-1 mt-0.5">
              <Briefcase size={11} /> {c.roleTitle}
            </p>
          )}
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wider ring-1 ring-emerald-200/60 shrink-0">
          <CheckCircle2 size={10} /> Preboarding
        </span>
      </div>

      <div className="mt-4 space-y-2 text-[12px] text-slate-600">
        <div className="inline-flex items-center gap-2 truncate w-full">
          <Mail size={12} className="text-slate-400 shrink-0" />
          <span className="truncate">{c.email}</span>
        </div>
        {c.phone && (
          <div className="inline-flex items-center gap-2">
            <Phone size={12} className="text-slate-400" />
            <span className="tabular-nums">{c.phone}</span>
          </div>
        )}
        {days != null && (
          <div className="inline-flex items-center gap-2">
            <Calendar size={12} className="text-slate-400" />
            <span>{days === 0 ? "Entered preboarding today" : `${days} day${days === 1 ? "" : "s"} in preboarding`}</span>
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-2">
        <Link
          href={`/dashboard/hr/hiring`}
          onClick={(e) => {
            // Open the candidate drawer instead of leaving the page.
            // We can't easily cross-component this from here, so just
            // give HR a quick deep-link to the candidates view filtered
            // to the preboarding stage. The drawer in CandidatesTab
            // can be opened from there.
            e.preventDefault();
          }}
          className="text-[11.5px] font-medium text-slate-500 hover:text-[#3b82f6]"
          title={`Applied ${new Date(c.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`}
        >
          Applied {new Date(c.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
        </Link>
        <Link
          href={`/dashboard/hr/onboard?fromCandidate=${c.id}`}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold shadow-sm transition-colors"
        >
          Proceed to Onboarding <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
      <UsersIcon size={32} className="mx-auto text-slate-300 mb-3" />
      <p className="text-[13.5px] font-semibold text-slate-700">
        {hasFilter ? "No candidates match this search" : "No candidates in preboarding yet"}
      </p>
      <p className="text-[12px] text-slate-500 mt-1 max-w-md mx-auto">
        {hasFilter
          ? "Try clearing the search."
          : "Move a candidate to the Preboarding stage from the Candidates tab once they've accepted the offer."}
      </p>
    </div>
  );
}
