import type { ReactNode } from "react";

// ResponsiveGrid — auto-collapsing column grid keyed to Tailwind
// breakpoints (sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536).
//
// Pass an explicit column count per breakpoint:
//   <ResponsiveGrid cols={{ base: 1, lg: 2, xl: 3 }}>
//
// `base` is the default (mobile-first); each named breakpoint is the
// MINIMUM width at which the grid switches to that column count.
// At our 1280px laptop floor the `xl` value is what most users see.
//
// Tailwind needs literal class strings to JIT-compile, so we map column
// counts to a fixed lookup rather than building strings dynamically.
const COL_BASE: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  12: "grid-cols-12",
};
const COL_SM: Record<number, string> = {
  1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3",
  4: "sm:grid-cols-4", 5: "sm:grid-cols-5", 6: "sm:grid-cols-6",
  12: "sm:grid-cols-12",
};
const COL_MD: Record<number, string> = {
  1: "md:grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3",
  4: "md:grid-cols-4", 5: "md:grid-cols-5", 6: "md:grid-cols-6",
  12: "md:grid-cols-12",
};
const COL_LG: Record<number, string> = {
  1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3",
  4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6",
  12: "lg:grid-cols-12",
};
const COL_XL: Record<number, string> = {
  1: "xl:grid-cols-1", 2: "xl:grid-cols-2", 3: "xl:grid-cols-3",
  4: "xl:grid-cols-4", 5: "xl:grid-cols-5", 6: "xl:grid-cols-6",
  12: "xl:grid-cols-12",
};
const COL_2XL: Record<number, string> = {
  1: "2xl:grid-cols-1", 2: "2xl:grid-cols-2", 3: "2xl:grid-cols-3",
  4: "2xl:grid-cols-4", 5: "2xl:grid-cols-5", 6: "2xl:grid-cols-6",
  12: "2xl:grid-cols-12",
};

const GAP: Record<string, string> = {
  none: "gap-0",
  xs:   "gap-1",
  sm:   "gap-2",
  md:   "gap-4",
  lg:   "gap-6",
  xl:   "gap-8",
};

export type ResponsiveCols = {
  base?: number;
  sm?:   number;
  md?:   number;
  lg?:   number;
  xl?:   number;
  "2xl"?: number;
};

export default function ResponsiveGrid({
  children,
  cols  = { base: 1 },
  gap   = "md",
  className = "",
}: {
  children: ReactNode;
  cols?:    ResponsiveCols;
  gap?:     keyof typeof GAP;
  className?: string;
}) {
  const classes = [
    "grid",
    GAP[gap] ?? GAP.md,
    cols.base   ? COL_BASE[cols.base]    : COL_BASE[1],
    cols.sm     ? COL_SM[cols.sm]         : "",
    cols.md     ? COL_MD[cols.md]         : "",
    cols.lg     ? COL_LG[cols.lg]         : "",
    cols.xl     ? COL_XL[cols.xl]         : "",
    cols["2xl"] ? COL_2XL[cols["2xl"]]    : "",
    className,
  ].filter(Boolean).join(" ");

  return <div className={classes}>{children}</div>;
}
