#!/usr/bin/env tsx
/**
 * Backfill Granola notes.
 *
 * Usage:
 *   npx tsx scripts/backfill-granola.ts [--days=180] [--mode=backfill|live]
 *
 * Modes:
 *   backfill (default) — creates archive rows only, no action-item extraction.
 *   live               — full treatment: archive + task cards via Claude.
 *
 * Notes:
 * - Reads GRANOLA_API_KEY, APP_URL, DAILY_PLANNER_API_KEY from .env.local.
 * - Throttles to ~4 req/sec to stay under Granola's 5/s limit.
 * - Pass --dry-run to fetch from Granola without posting to the app.
 */

import "dotenv/config";
import { setTimeout as sleep } from "node:timers/promises";

interface Args {
  days: number;
  mode: "backfill" | "live";
  dryRun: boolean;
  appUrl: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let days = 180;
  let mode: "backfill" | "live" = "backfill";
  let dryRun = false;
  for (const a of args) {
    if (a.startsWith("--days=")) days = Number(a.split("=")[1]);
    else if (a === "--live" || a === "--mode=live") mode = "live";
    else if (a === "--dry-run") dryRun = true;
  }
  return {
    days,
    mode,
    dryRun,
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
  };
}

async function granolaGet<T = unknown>(path: string): Promise<T> {
  const key = process.env.GRANOLA_API_KEY;
  if (!key) throw new Error("GRANOLA_API_KEY missing");
  const res = await fetch(`https://public-api.granola.ai${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Granola ${path} ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

interface Summary {
  id: string;
  title?: string;
  created_at?: string;
}

interface ListResponse {
  notes: Summary[];
  cursor?: string | null;
  hasMore?: boolean;
}

async function main() {
  const args = parseArgs();
  const since = new Date(
    Date.now() - args.days * 86400 * 1000
  ).toISOString();

  console.log(
    `[backfill] mode=${args.mode} days=${args.days} since=${since} dryRun=${args.dryRun}`
  );

  const apiKey = process.env.DAILY_PLANNER_API_KEY ?? "";
  let cursor: string | null = null;
  let total = 0;
  let ok = 0;
  let failed = 0;

  do {
    const qs = new URLSearchParams({
      created_after: since,
      page_size: "30",
    });
    if (cursor) qs.set("cursor", cursor);
    const list = await granolaGet<ListResponse>(`/v1/notes?${qs}`);
    const notes = list.notes ?? [];

    for (const summary of notes) {
      total++;
      try {
        await sleep(260);
        const note = await granolaGet(`/v1/notes/${summary.id}`);
        if (args.dryRun) {
          console.log(`  [dry] ${summary.id} ${summary.title ?? ""}`);
          ok++;
          continue;
        }
        const res = await fetch(`${args.appUrl}/api/webhooks/granola`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({ note, mode: args.mode }),
        });
        if (!res.ok) {
          failed++;
          console.warn(
            `  [fail] ${summary.id} ${res.status}: ${await res.text()}`
          );
        } else {
          ok++;
          if (total % 10 === 0) console.log(`  [ok] ${total} done`);
        }
      } catch (e) {
        failed++;
        console.warn(
          `  [err] ${summary.id}: ${e instanceof Error ? e.message : "unknown"}`
        );
      }
    }

    cursor = list.cursor ?? null;
  } while (cursor);

  console.log(`[backfill] done. total=${total} ok=${ok} failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
