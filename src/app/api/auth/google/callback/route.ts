import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, saveTokens } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const cookieState = req.cookies.get("google_oauth_state")?.value;

  if (error) {
    return NextResponse.redirect(
      `${origin}/calendar?connect_error=${encodeURIComponent(error)}`
    );
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(`${origin}/calendar?connect_error=bad_state`);
  }

  try {
    const { tokens, email } = await exchangeCodeForTokens(code, origin);
    await saveTokens(email, tokens);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.redirect(
      `${origin}/calendar?connect_error=${encodeURIComponent(msg)}`
    );
  }

  const res = NextResponse.redirect(`${origin}/calendar?connected=1`);
  res.cookies.set("google_oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}
