import { NextRequest, NextResponse } from "next/server";

const UNAUTHORIZED = NextResponse.json(
  { error: "Unauthorized" },
  { status: 401 }
);

/**
 * Validates the request has a valid API key via either:
 *   - Header: x-api-key: <key>
 *   - Header: Authorization: Bearer <key>
 *   - Query param: ?api_key=<key>
 *
 * Returns null if valid, or a 401 NextResponse if invalid.
 */
export function requireApiKey(req: NextRequest): NextResponse | null {
  const expected = process.env.DAILY_PLANNER_API_KEY;
  if (!expected) {
    // No key configured — allow all (dev mode)
    return null;
  }

  const fromHeader =
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  const fromQuery = new URL(req.url).searchParams.get("api_key");

  const provided = fromHeader ?? fromQuery;

  if (!provided || provided !== expected) {
    return UNAUTHORIZED;
  }

  return null;
}
