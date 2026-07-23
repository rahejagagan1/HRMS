import type { ReactNode } from "react";

// PageHeader — the white title strip used at the top of most dashboard
// pages (Engage, Attendance, Leaves, etc.). Full-bleed by default so it
// reads as one band against the LayoutShell's content area; horizontal
// padding scales fluidly down to the 1280px laptop floor.
//
// `actions` slot renders to the right of the title (filters, "+ New",
// segmented controls — anything that should sit on the same baseline).
export default function PageHeader({
  title,
  subtitle,
  actions,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-4 sm:px-6 py-4 ${className}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[15px] font-bold text-slate-800 dark:text-white truncate">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </header>
  );
}
