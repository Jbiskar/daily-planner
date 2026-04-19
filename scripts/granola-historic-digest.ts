#!/usr/bin/env tsx
/**
 * Generate a 6-month historic digest from ingested Granola archive rows.
 *
 * Prereq: run `scripts/backfill-granola.ts` first so events table has granola
 * archive rows (task_status='dismissed', source='granola', source_id=note.id
 * without a '#').
 *
 * Usage:
 *   npx tsx scripts/granola-historic-digest.ts [--months=6]
 *
 * Output: stores a context_docs row under a project named
 * "Historic digest — last N months".
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

interface Args {
  months: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let months = 6;
  for (const a of args) {
    if (a.startsWith("--months=")) months = Number(a.split("=")[1]);
  }
  return { months };
}

interface ArchiveRow {
  id: string;
  title: string;
  body: string | null;
  occurred_at: string | null;
  workspace: string | null;
}

function monthBucket(iso: string | null): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`;
}

async function main() {
  const { months } = parseArgs();
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing Supabase URL or service role key");
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const anthropic = new Anthropic();

  const since = new Date(
    Date.now() - months * 30 * 86400 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("events")
    .select("id, title, body, occurred_at, workspace, source_id")
    .eq("source", "granola")
    .gte("occurred_at", since)
    .not("source_id", "like", "%#%")
    .order("occurred_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ArchiveRow[];
  if (rows.length === 0) {
    console.log("[digest] no archive rows found — run backfill first.");
    return;
  }

  const buckets = new Map<string, ArchiveRow[]>();
  for (const r of rows) {
    const key = monthBucket(r.occurred_at);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }

  console.log(`[digest] rows=${rows.length} buckets=${buckets.size}`);

  const monthlySummaries: Array<{ month: string; summary: string }> = [];
  const sortedBuckets = Array.from(buckets.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  for (const [month, items] of sortedBuckets) {
    const joined = items
      .map(
        (r: ArchiveRow) =>
          `### ${r.occurred_at?.slice(0, 10) ?? "?"} — ${r.title} (${r.workspace ?? "?"})\n${(r.body ?? "").slice(0, 1200)}`
      )
      .join("\n\n---\n\n")
      .slice(0, 120_000);

    console.log(`  [${month}] ${items.length} meetings`);
    const res = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system:
        "You read a month's worth of meeting summaries and produce a concise markdown digest. Identify: (1) key themes, (2) major decisions, (3) recurring stakeholders/projects, (4) dangling action items that appear never closed. Stay under 700 words.",
      messages: [
        { role: "user", content: `Month: ${month}\n\n${joined}` },
      ],
    });
    const text =
      res.content[0].type === "text" ? res.content[0].text : "";
    monthlySummaries.push({ month, summary: text });
  }

  const meta = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 3072,
    system:
      "You are writing a single consolidated digest from monthly digests. Surface: (1) cross-month themes Jake has been pushing, (2) relationships that have intensified or cooled, (3) open loops that deserve follow-up now, (4) observations about how Jake spends his time. Output markdown with H2 section headers. Keep under 1500 words.",
    messages: [
      {
        role: "user",
        content: monthlySummaries
          .map((m) => `## ${m.month}\n\n${m.summary}`)
          .join("\n\n---\n\n"),
      },
    ],
  });
  const metaText =
    meta.content[0].type === "text" ? meta.content[0].text : "";

  const projectName = `Historic digest — last ${months} months`;
  let projectId: string;
  const existing = await supabase
    .from("projects")
    .select("id")
    .eq("name", projectName)
    .maybeSingle();
  if (existing.data) {
    projectId = (existing.data as { id: string }).id;
  } else {
    const { data: p, error: pErr } = await supabase
      .from("projects")
      .insert({
        name: projectName,
        description: "Auto-generated rolling digest of Granola archives.",
        status: "active",
      })
      .select("id")
      .single();
    if (pErr || !p) throw new Error(`Project create failed: ${pErr?.message}`);
    projectId = (p as { id: string }).id;
  }

  const { error: docErr } = await supabase.from("context_docs").insert({
    project_id: projectId,
    title: `${projectName} — ${new Date().toISOString().slice(0, 10)}`,
    content: metaText,
    doc_type: "general",
    metadata: {
      months,
      rows_analyzed: rows.length,
      generated_at: new Date().toISOString(),
    },
  });
  if (docErr) throw new Error(`Doc insert failed: ${docErr.message}`);

  console.log(`[digest] done. stored under project ${projectId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
