import { NextResponse } from "next/server";
import { getStoredTokens } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const row = await getStoredTokens();
    if (!row) return NextResponse.json({ connected: false });
    return NextResponse.json({ connected: true, email: row.email });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json(
      { connected: false, error: msg },
      { status: 500 }
    );
  }
}
