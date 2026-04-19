#!/usr/bin/env tsx
/**
 * Granola local-cache sync.
 *
 * Reads Granola's local cache (on whatever machine the Granola desktop app
 * runs on) and posts notes to your Daily Planner webhook.
 *
 * Run on the machine that has Granola installed (work laptop, home Mac, etc.).
 * Needs: node 20+, the .env.local values for APP_URL and DAILY_PLANNER_API_KEY,
 * and network access to the webhook URL.
 *
 * ─── Usage ────────────────────────────────────────────────────────────────
 *   npx tsx scripts/granola-local-sync.ts probe
 *     → scans likely cache paths and prints what it finds. Use this FIRST.
 *
 *   npx tsx scripts/granola-local-sync.ts sync [--since=30m] [--dry-run]
 *     → reads the cache, filters by updated_at, posts each note.
 *     → --since accepts: "30m", "2h", "1d", or ISO-8601 timestamp.
 *     → --dry-run logs what would be posted without hitting the webhook.
 *
 * ─── Env ──────────────────────────────────────────────────────────────────
 *   GRANOLA_CACHE_PATH    — optional override. Path to the cache file or dir.
 *   APP_URL               — your deployed app URL (or http://localhost:3000).
 *   DAILY_PLANNER_API_KEY — matches the server's key.
 *
 * ─── How it works ─────────────────────────────────────────────────────────
 * Granola's desktop app is Electron and stores notes locally. The exact
 * file layout changes across versions. This script probes common locations
 * and tries multiple JSON shapes. If it can't find notes automatically,
 * the probe output shows you what it saw — copy that back and we'll tune
 * the parser.
 */

import "dotenv/config";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// ─── Config ────────────────────────────────────────────────────────────────

function candidateCacheDirs(): string[] {
  const home = homedir();
  const p = platform();
  if (p === "darwin") {
    return [
      join(home, "Library", "Application Support", "Granola"),
      join(home, "Library", "Application Support", "granola"),
      join(home, "Library", "Application Support", "com.granola.granola"),
      join(home, "Library", "Caches", "Granola"),
    ];
  }
  if (p === "win32") {
    const appData =
      process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return [join(appData, "Granola"), join(appData, "granola")];
  }
  return [
    join(home, ".config", "Granola"),
    join(home, ".config", "granola"),
  ];
}

async function resolveCacheDir(): Promise<string | null> {
  const override = process.env.GRANOLA_CACHE_PATH;
  if (override && existsSync(override)) return override;
  for (const c of candidateCacheDirs()) {
    if (existsSync(c)) return c;
  }
  return null;
}

// ─── Probe ─────────────────────────────────────────────────────────────────

async function walk(dir: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  for (const name of entries) {
    const full = join(dir, name);
    try {
      const s = await stat(full);
      if (s.isDirectory()) {
        out.push(...(await walk(full, depth + 1)));
      } else if (s.size > 0 && s.size < 100 * 1024 * 1024) {
        out.push(full);
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

async function probe() {
  const dir = await resolveCacheDir();
  if (!dir) {
    console.error(
      "No Granola cache directory found. Set GRANOLA_CACHE_PATH to the folder containing Granola's local data."
    );
    console.error("Checked:");
    for (const c of candidateCacheDirs()) console.error(`  - ${c}`);
    process.exit(1);
  }
  console.log(`[probe] cache dir: ${dir}`);
  const files = (await walk(dir)).filter(
    (f) =>
      /\.(json|db|sqlite|leveldb|log|ldb)$/i.test(f) ||
      /cache|notes|meetings/i.test(f)
  );
  if (files.length === 0) {
    const all = await walk(dir);
    console.log("[probe] no obvious cache files. First 30 files seen:");
    for (const f of all.slice(0, 30)) console.log(`  ${f}`);
    return;
  }
  console.log(`[probe] ${files.length} candidate files:`);
  for (const f of files.slice(0, 60)) {
    try {
      const s = await stat(f);
      console.log(
        `  ${f}  (${(s.size / 1024).toFixed(1)} KB, mtime=${s.mtime.toISOString()})`
      );
      if (f.endsWith(".json")) {
        const buf = await readFile(f, "utf8");
        const first = buf.slice(0, 400).replace(/\s+/g, " ");
        console.log(`    peek: ${first}...`);
        try {
          const parsed = JSON.parse(buf);
          const shape = describeShape(parsed);
          console.log(`    shape: ${shape}`);
        } catch {
          console.log(`    (not valid JSON)`);
        }
      }
    } catch {
      /* skip */
    }
  }
}

function describeShape(v: unknown, depth = 0): string {
  if (depth > 3) return "…";
  if (Array.isArray(v)) {
    const sample = v[0];
    return `Array[${v.length}] of ${describeShape(sample, depth + 1)}`;
  }
  if (v && typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>).slice(0, 8);
    return `{ ${keys.join(", ")}${
      Object.keys(v as Record<string, unknown>).length > keys.length ? ", ..." : ""
    } }`;
  }
  return typeof v;
}

// ─── Sync ──────────────────────────────────────────────────────────────────

interface NormalizedNote {
  id: string;
  title: string;
  summary_markdown: string | null;
  created_at: string | null;
  updated_at: string | null;
  web_url: string | null;
  attendees: Array<{ name?: string; email?: string }>;
  calendar_event: { scheduled_start_time?: string } | null;
  _raw: Record<string, unknown>;
}

function parseSince(input: string): Date {
  const m = input.match(/^(\d+)([mhdw])$/i);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const ms =
      unit === "m"
        ? n * 60_000
        : unit === "h"
          ? n * 3_600_000
          : unit === "d"
            ? n * 86_400_000
            : n * 604_800_000;
    return new Date(Date.now() - ms);
  }
  const d = new Date(input);
  if (isNaN(d.getTime())) throw new Error(`Can't parse --since=${input}`);
  return d;
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function collectNotesFromAny(data: unknown, acc: unknown[] = []): unknown[] {
  if (!data) return acc;
  if (Array.isArray(data)) {
    // Heuristic: a list of notes usually has objects with an `id` and some
    // text field (title / summary / notes).
    const looksLikeNotes = data.every(
      (x) =>
        x &&
        typeof x === "object" &&
        ("id" in (x as Record<string, unknown>) ||
          "title" in (x as Record<string, unknown>))
    );
    if (looksLikeNotes) acc.push(...data);
    else for (const v of data) collectNotesFromAny(v, acc);
    return acc;
  }
  if (typeof data === "object") {
    for (const v of Object.values(data as Record<string, unknown>)) {
      collectNotesFromAny(v, acc);
    }
  }
  return acc;
}

function normalize(raw: Record<string, unknown>): NormalizedNote | null {
  const id =
    firstString(raw, ["id", "note_id", "uuid", "documentId"]) ?? null;
  if (!id) return null;

  const title =
    firstString(raw, [
      "title",
      "meeting_title",
      "name",
      "displayTitle",
    ]) ?? "(untitled)";

  const summary =
    firstString(raw, [
      "summary_markdown",
      "summary",
      "ai_summary",
      "notes",
      "content",
      "body",
      "markdown",
    ]) ?? null;

  const createdAt =
    asDate(raw.created_at) ??
    asDate(raw.createdAt) ??
    asDate(raw.created) ??
    null;
  const updatedAt =
    asDate(raw.updated_at) ??
    asDate(raw.updatedAt) ??
    asDate(raw.modified_at) ??
    createdAt;

  const webUrl =
    firstString(raw, ["web_url", "url", "share_url", "permalink"]) ?? null;

  const attRaw =
    (raw.attendees as unknown[] | undefined) ??
    (raw.participants as unknown[] | undefined) ??
    [];
  const attendees = Array.isArray(attRaw)
    ? attRaw
        .map((a): { name?: string; email?: string } | null => {
          if (!a || typeof a !== "object") return null;
          const o = a as Record<string, unknown>;
          return {
            name: asString(o.name) ?? asString(o.displayName) ?? undefined,
            email:
              asString(o.email) ??
              asString(o.emailAddress) ??
              asString(o.address) ??
              undefined,
          };
        })
        .filter((x): x is { name?: string; email?: string } => !!x)
    : [];

  const cal =
    (raw.calendar_event as Record<string, unknown> | undefined) ??
    (raw.calendarEvent as Record<string, unknown> | undefined) ??
    null;
  const scheduledStart = cal
    ? asString(cal.scheduled_start_time) ??
      asString(cal.scheduledStartTime) ??
      asString(cal.start) ??
      null
    : null;

  return {
    id,
    title,
    summary_markdown: summary,
    created_at: createdAt ? createdAt.toISOString() : null,
    updated_at: updatedAt ? updatedAt.toISOString() : null,
    web_url: webUrl,
    attendees,
    calendar_event: scheduledStart
      ? { scheduled_start_time: scheduledStart }
      : null,
    _raw: raw,
  };
}

async function loadAllJsonNotes(dir: string): Promise<NormalizedNote[]> {
  const files = (await walk(dir)).filter((f) => f.toLowerCase().endsWith(".json"));
  const collected: NormalizedNote[] = [];
  for (const f of files) {
    try {
      const buf = await readFile(f, "utf8");
      const parsed = JSON.parse(buf);
      const rawNotes = collectNotesFromAny(parsed);
      for (const raw of rawNotes) {
        if (!raw || typeof raw !== "object") continue;
        const n = normalize(raw as Record<string, unknown>);
        if (n) collected.push(n);
      }
    } catch {
      /* not JSON or unreadable */
    }
  }
  // Dedupe by id, keeping the most recently updated.
  const byId = new Map<string, NormalizedNote>();
  for (const n of collected) {
    const prev = byId.get(n.id);
    if (!prev) {
      byId.set(n.id, n);
      continue;
    }
    const a = n.updated_at ? Date.parse(n.updated_at) : 0;
    const b = prev.updated_at ? Date.parse(prev.updated_at) : 0;
    if (a > b) byId.set(n.id, n);
  }
  return Array.from(byId.values());
}

async function sync(opts: { since: Date; dryRun: boolean }) {
  const dir = await resolveCacheDir();
  if (!dir) throw new Error("No Granola cache directory found. Run `probe` first.");

  const appUrl = process.env.APP_URL;
  const apiKey = process.env.DAILY_PLANNER_API_KEY;
  if (!opts.dryRun && (!appUrl || !apiKey)) {
    throw new Error(
      "APP_URL and DAILY_PLANNER_API_KEY must be set (or pass --dry-run)"
    );
  }

  const all = await loadAllJsonNotes(dir);
  console.log(`[sync] loaded ${all.length} raw entries from cache`);

  const meetings = all.filter((n) => {
    const t = (n.title ?? "").trim();
    if (!t || t === "(untitled)") return false;
    if (!n.attendees || n.attendees.length === 0) return false;
    return true;
  });
  console.log(
    `[sync] ${meetings.length} meetings after dropping untitled + no-attendees`
  );

  const filtered = meetings.filter(
    (n) => !n.updated_at || Date.parse(n.updated_at) >= opts.since.getTime()
  );
  console.log(
    `[sync] ${filtered.length} after updated_at filter (>= ${opts.since.toISOString()})`
  );

  let ok = 0;
  let failed = 0;
  for (const n of filtered) {
    const payload = {
      note: {
        id: n.id,
        title: n.title,
        summary_markdown: n.summary_markdown,
        created_at: n.created_at,
        updated_at: n.updated_at,
        web_url: n.web_url,
        attendees: n.attendees,
        calendar_event: n.calendar_event,
      },
      mode: "live",
    };
    if (opts.dryRun) {
      console.log(
        `  [dry] ${n.id}  ${n.updated_at}  "${n.title}"  attendees=${n.attendees.length}`
      );
      ok++;
      continue;
    }
    try {
      const res = await fetch(`${appUrl}/api/webhooks/granola`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey ?? "",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        failed++;
        console.warn(
          `  [fail] ${n.id} ${res.status}: ${(await res.text()).slice(0, 200)}`
        );
      } else {
        ok++;
      }
    } catch (e) {
      failed++;
      console.warn(
        `  [err] ${n.id}: ${e instanceof Error ? e.message : "unknown"}`
      );
    }
    await sleep(120);
  }

  console.log(`[sync] done. ok=${ok} failed=${failed}`);
}

// ─── CLI ───────────────────────────────────────────────────────────────────

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "probe") {
    await probe();
    return;
  }
  if (cmd === "sync") {
    let sinceStr = "30m";
    let dryRun = false;
    for (const a of rest) {
      if (a.startsWith("--since=")) sinceStr = a.split("=")[1];
      else if (a === "--dry-run") dryRun = true;
    }
    await sync({ since: parseSince(sinceStr), dryRun });
    return;
  }
  console.error(`Unknown command: ${cmd}`);
  console.error("Run with 'probe' or 'sync [--since=30m] [--dry-run]'.");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
