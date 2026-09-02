import { redirect } from "next/navigation";

// /dashboard/hr is a SECTION root, not a page — it only had a layout.tsx, so
// hitting it directly (sidebar brand link, a trimmed URL, a stale bookmark)
// fell through to the root not-found and rendered a 404 inside the HR chrome.
// Send it to the HR home every employee can see; admins navigate on to
// /dashboard/hr/admin from there.
export default function HrIndexPage() {
  redirect("/dashboard/hr/home");
}
