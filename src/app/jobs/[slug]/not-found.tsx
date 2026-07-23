import Link from "next/link";

// Shown when /jobs/[slug] calls notFound() — the opening doesn't exist, isn't
// published, or has closed. A common real case (expired job links shared on
// socials), so give candidates a clear, on-brand message and a way to the
// live roles instead of a generic 404.
export default function JobNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#e2e8f0] p-6 text-center text-slate-900 antialiased">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-500/10 text-2xl">🔍</div>
      <h2 className="text-xl font-semibold">This opening isn’t available</h2>
      <p className="max-w-md text-sm text-slate-500">
        It may have been filled or closed. Take a look at our other open roles instead.
      </p>
      <Link
        href="/jobs"
        className="mt-1 rounded-xl bg-[#008CFF] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0077dd]"
      >
        View all openings
      </Link>
    </div>
  );
}
