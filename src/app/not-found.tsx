import Link from "next/link";

// Friendly catch-all 404. Covers any unmatched URL and any notFound() that
// doesn't have a closer not-found.tsx — instead of a bare browser 404.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#e2e8f0] p-6 text-center text-slate-900">
      <p className="text-5xl font-bold text-slate-300">404</p>
      <h2 className="text-xl font-semibold">Page not found</h2>
      <p className="max-w-md text-sm text-slate-500">
        The page you’re looking for doesn’t exist or may have moved.
      </p>
      <div className="mt-1 flex items-center gap-2">
        <Link
          href="/"
          className="rounded-xl bg-[#008CFF] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0077dd]"
        >
          Go home
        </Link>
        <Link
          href="/jobs"
          className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          View careers
        </Link>
      </div>
    </div>
  );
}
