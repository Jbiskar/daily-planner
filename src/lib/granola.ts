import { createServiceClient } from "@/lib/supabase/server";
import type { Workspace } from "@/types/database";

export const GRANOLA_BASE = "https://public-api.granola.ai";

export interface GranolaAttendee {
  name?: string | null;
  email?: string | null;
  role?: string | null;
}

export interface GranolaCalendarEvent {
  scheduled_start_time?: string | null;
  scheduled_end_time?: string | null;
  [k: string]: unknown;
}

export interface GranolaNote {
  id: string;
  title: string;
  summary_markdown?: string | null;
  transcript?: string | null;
  web_url?: string | null;
  created_at?: string;
  updated_at?: string;
  attendees?: GranolaAttendee[];
  calendar_event?: GranolaCalendarEvent | null;
  [k: string]: unknown;
}

export interface GranolaListResponse {
  notes: GranolaNote[];
  cursor?: string | null;
  hasMore?: boolean;
  [k: string]: unknown;
}

function requireKey(): string {
  const k = process.env.GRANOLA_API_KEY;
  if (!k) throw new Error("Missing GRANOLA_API_KEY");
  return k;
}

export async function granolaGet<T = unknown>(path: string): Promise<T> {
  const url = path.startsWith("http") ? path : `${GRANOLA_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${requireKey()}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Granola ${path} failed: ${res.status} ${res.statusText} ${body.slice(0, 300)}`
    );
  }
  return (await res.json()) as T;
}

export function jakeEmails(): string[] {
  const raw = process.env.JAKE_EMAILS ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isJake(email?: string | null): boolean {
  if (!email) return false;
  return jakeEmails().includes(email.trim().toLowerCase());
}

export function inferWorkspace(attendees: GranolaAttendee[] = []): Workspace {
  const domains = new Set<string>();
  for (const a of attendees) {
    const email = a.email?.trim().toLowerCase();
    if (!email) continue;
    if (isJake(email)) continue;
    const at = email.indexOf("@");
    if (at === -1) continue;
    domains.add(email.slice(at + 1));
  }
  const domainList = Array.from(domains);
  const has = (d: string) => domainList.some((x) => x === d);
  if (has("atlan.com")) return "atlan";
  if (has("justlandit.com")) return "landit";
  // Personal gmail / solo events (no other domains)
  if (domainList.length === 0) return "personal";
  for (const d of domainList) {
    if (d.endsWith("gmail.com") || d.endsWith("icloud.com")) continue;
    // Any corporate domain we don't recognize — consulting
    return "consulting";
  }
  return "personal";
}

interface StakeholderRow {
  id: string;
  email: string;
}

export async function upsertAttendees(
  attendees: GranolaAttendee[] = []
): Promise<{ ids: string[]; byEmail: Record<string, string> }> {
  const supabase = createServiceClient();
  const filtered = attendees.filter(
    (a) => a.email && !isJake(a.email) && a.email.includes("@")
  );
  if (filtered.length === 0) return { ids: [], byEmail: {} };

  const rows = filtered.map((a) => ({
    name: a.name && a.name.trim().length > 0 ? a.name : (a.email as string),
    email: (a.email as string).trim().toLowerCase(),
    role: a.role ?? null,
  }));

  const byEmail: Record<string, string> = {};
  const ids: string[] = [];

  for (const row of rows) {
    // Find existing by email.
    const existing = await supabase
      .from("stakeholders")
      .select("id, email")
      .eq("email", row.email)
      .maybeSingle();
    if (existing.data) {
      const s = existing.data as StakeholderRow;
      byEmail[row.email] = s.id;
      ids.push(s.id);
      continue;
    }
    const { data: inserted, error } = await supabase
      .from("stakeholders")
      .insert(row)
      .select("id, email")
      .single();
    if (error) {
      // Race: another concurrent insert created the row — fetch it.
      const retry = await supabase
        .from("stakeholders")
        .select("id, email")
        .eq("email", row.email)
        .maybeSingle();
      if (retry.data) {
        byEmail[row.email] = (retry.data as StakeholderRow).id;
        ids.push((retry.data as StakeholderRow).id);
        continue;
      }
      throw new Error(`Stakeholder upsert failed: ${error.message}`);
    }
    if (inserted) {
      byEmail[row.email] = (inserted as StakeholderRow).id;
      ids.push((inserted as StakeholderRow).id);
    }
  }

  return { ids, byEmail };
}

export function pacificCronHour(hourLocal: number): string {
  // Vercel Cron runs in UTC. User's "5 AM PST" is 13:00 UTC
  // (ignoring DST — adjust manually if desired).
  const utc = (hourLocal + 8) % 24;
  return `0 ${utc} * * *`;
}
