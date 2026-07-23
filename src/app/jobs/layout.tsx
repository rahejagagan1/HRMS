import MetaPixel from "@/components/meta-pixel";

// Public careers subtree (/jobs, /jobs/[slug], /jobs/apply). The Meta
// Pixel is mounted here rather than in the root layout so hiring-ad
// tracking covers candidates only — never the internal dashboard.
export default function JobsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MetaPixel />
      {children}
    </>
  );
}
