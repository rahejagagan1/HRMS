// Deploy-check endpoint. Returns ONLY a single boolean marker that
// proves whether commit 1811053 (rolesForUser CEO-exclusive fix) is
// in the running binary — used to diagnose stale-build issues
// after a VPS redeploy.
//
// Token-gated: caller must present a matching DEPLOY_CHECK_TOKEN
// either as ?token=... query param or via x-deploy-check-token
// header. Unmatched requests get a generic 404 to avoid leaking
// the endpoint's existence.
//
// Earlier version of this route also returned pid, uptime, sha,
// and the raw rolesForUser output; the boolean alone is enough to
// confirm the build, so the rest was dropped to limit the
// information footprint of an unauthenticated probe.
//
// Hit it like:
//   curl -H "x-deploy-check-token: $DEPLOY_CHECK_TOKEN" \
//     https://<vps>/api/__deploy-check

import { NextRequest, NextResponse } from "next/server";
import { rolesForUser } from "@/lib/email/toggles";
import { timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";

function tokensMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

const NOT_FOUND = NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(req: NextRequest) {
  const expected = (process.env.DEPLOY_CHECK_TOKEN ?? "").trim();
  if (!expected) return NOT_FOUND;
  const provided = (
    req.headers.get("x-deploy-check-token") ??
    new URL(req.url).searchParams.get("token") ??
    ""
  ).trim();
  if (!provided || !tokensMatch(provided, expected)) return NOT_FOUND;

  // Marker for the rolesForUser CEO-exclusive fix (commit 1811053).
  // Before fix: returns ["ceo", "admin"] for a user with
  // orgLevel=ceo, role=admin. After fix: returns ["ceo"] only.
  const r = rolesForUser({ orgLevel: "ceo", role: "admin" });
  const ceoExclusive = r.length === 1 && r[0] === "ceo";
  return NextResponse.json({ ceoExclusive });
}
