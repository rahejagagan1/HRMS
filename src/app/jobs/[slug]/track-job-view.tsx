"use client";

// Fires a Meta Pixel ViewContent tagged with the role, so ad audiences
// like "viewed the Video Editor role but didn't apply" can be built in
// Events Manager. Rendered by the (server) job detail page, which can't
// call fbq itself.

import { useEffect } from "react";
import { fbqTrack } from "@/components/meta-pixel";

export default function TrackJobView({ jobId, jobTitle }: { jobId: number | string; jobTitle: string }) {
  useEffect(() => {
    fbqTrack("ViewContent", {
      content_name: jobTitle,
      content_ids: [String(jobId)],
      content_category: "job_opening",
    });
  }, [jobId, jobTitle]);
  return null;
}
