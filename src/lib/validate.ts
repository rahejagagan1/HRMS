import { NextResponse } from "next/server";
import type { ZodSchema, ZodError } from "zod";

/**
 * Parse + validate a JSON request body against a Zod schema.
 *
 * Usage:
 *   const parsed = await parseBody(req, MyBodySchema);
 *   if (!parsed.ok) return parsed.error;
 *   const body = parsed.data; // fully typed + validated
 *
 * Returns either a typed `data` field on success or an `error`
 * NextResponse on failure — so the route stays one happy path.
 */
export async function parseBody<T>(
  req: Request,
  schema: ZodSchema<T>
): Promise<{ ok: true; data: T } | { ok: false; error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, error: validationError(result.error) };
  }
  return { ok: true, data: result.data };
}

/** Same but for query / search params. */
export function parseQuery<T>(
  req: Request,
  schema: ZodSchema<T>
): { ok: true; data: T } | { ok: false; error: NextResponse } {
  const url = new URL(req.url);
  const obj: Record<string, string | string[]> = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (k in obj) {
      obj[k] = ([] as string[]).concat(obj[k] as any, v);
    } else {
      obj[k] = v;
    }
  }
  const result = schema.safeParse(obj);
  if (!result.success) {
    return { ok: false, error: validationError(result.error) };
  }
  return { ok: true, data: result.data };
}

function validationError(zerr: ZodError): NextResponse {
  const issues = zerr.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
  return NextResponse.json(
    { error: "Validation failed", issues },
    { status: 400 }
  );
}
