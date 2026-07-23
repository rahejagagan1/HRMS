// Slug helper for JobOpening.publicSlug.
//
// On first publish we generate `slugify(title) + '-' + id` so the slug
// is stable, human-readable, and unique (the id tail guarantees no
// collision even when two jobs slugify to the same string).
//
// If HR renames the job later, the slug DOES NOT change — that would
// 404 every shared link out in the wild. Renames stay internal to the
// dashboard.

export function slugifyTitle(title: string): string {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")           // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")               // non-alphanum → dash
    .replace(/-+/g, "-")                       // collapse runs
    .replace(/^-+|-+$/g, "")                   // trim leading/trailing
    .slice(0, 60);                              // keep URLs short
}

export function buildJobSlug(title: string, id: number): string {
  const base = slugifyTitle(title) || "job";
  return `${base}-${id}`;
}
