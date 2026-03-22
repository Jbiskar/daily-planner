import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

  let dbTest = "not tested";
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("projects").select("id").limit(1);
    dbTest = error ? `error: ${error.message}` : "connected";
  } catch (e) {
    dbTest = `exception: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json({
    supabase_url_value: url.slice(0, 30) + "...",
    supabase_url_length: url.length,
    db_connection: dbTest,
    env_status: {
      NEXT_PUBLIC_SUPABASE_URL: url ? "SET" : "MISSING",
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? "SET" : "MISSING",
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "SET" : "MISSING",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "SET" : "MISSING",
      DAILY_PLANNER_API_KEY: process.env.DAILY_PLANNER_API_KEY ? "SET" : "MISSING",
    },
  });
}
