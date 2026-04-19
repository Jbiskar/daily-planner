#!/usr/bin/env node
// Granola local-cache sync — standalone, zero dependencies.
// Copy this ONE file to whatever machine has the Granola desktop app.
// Run with plain node 20+. No npm install needed.
//
// ─── Usage ────────────────────────────────────────────────────────────────
//   node granola-local-sync.mjs probe
//     → scans likely cache paths and prints what it finds. Start here.
//
//   node granola-local-sync.mjs sync [--since=30m] [--dry-run]
//     → reads the cache, filters by updated_at, posts each note.
//
// ─── Env vars ─────────────────────────────────────────────────────────────
//   GRANOLA_CACHE_PATH    — optional override
//   APP_URL               — your Daily Planner URL (e.g. https://daily-planner-...vercel.app)
//   DAILY_PLANNER_API_KEY — matches the server's key (from Vercel env)
//
// Set env vars inline on the command:
//   APP_URL=https://... DAILY_PLANNER_API_KEY=xyz node granola-local-sync.mjs sync

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// ─── Cache path resolution ────────────────────────────────────────────────

function candidateCacheDirs() {
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
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return [join(appData, "Granola"), join(appData, "granola")];
  }
  return [join(home, ".config", "Granola"), join(home, ".config", "granola")];
}

async function resolveCacheDir() {
  const override = process.env.GRANOLA_CACHE_PATH;
  if (override && existsSync(override)) return override;
  for (const c of candidateCacheDirs()) if (existsSync(c)) return c;
  return null;
}

// ─── Probe ─────────────────────────────────────────────────────────────────

async function walk(dir, depth = 0) {
  if (depth > 4) return [];
  const out = [];
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  for (const name of entries) {
    const full = join(dir, name);
    try {
      const s = await stat(full);
      if (s.isDirectory()) out.push(...(await walk(full, depth + 1)));
      else if (s.size > 0 && s.size < 100 * 1024 * 1024) out.push(full);
    } catch {
      /* skip */
    }
  }
  return out;
}

function describeShape(v, depth = 0) {
  if (depth > 3) return "…";
  if (Array.isArray(v)) return `Array[${v.length}] of ${describeShape(v[0], depth + 1)}`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).slice(0, 8);
    return `{ ${keys.join(", ")}${Object.keys(v).length > keys.length ? ", ..." : ""} }`;
  }
  return typeof v;
}

async function probe() {
  const dir = await resolveCacheDir();
  if (!dir) {
    console.error("No Granola cache directory found. Checked:");
    for (const c of candidateCacheDirs()) console.error(`  - ${c}`);
    console.error(
      "\nIf Granola is installed but elsewhere, set GRANOLA_CACHE_PATH and re-run."
    );
    process.exit(1);
  }
  console.log(`[probe] cache dir: ${dir}`);
  const files = (await walk(dir)).filter(
    (f) => /\.(json|db|sqlite|leveldb|log|ldb)$/i.test(f) || /cache|notes|meetings/i.test(f)
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
      console.log(`  ${f}  (${(s.size / 1024).toFixed(1)} KB, mtime=${s.mtime.toISOString()})`);
      if (f.endsWith(".json")) {
        const buf = await readFile(f, "utf8");
        console.log(`    peek: ${buf.slice(0, 400).replace(/\s+/g, " ")}...`);
        try {
          const parsed = JSON.parse(buf);
          console.log(`    shape: ${describeShape(parsed)}`);
        } catch {
          console.log(`    (not valid JSON)`);
        }
      }
    } catch {
      /* skip */
    }
  }
}

// ─── Sync ──────────────────────────────────────────────────────────────────

function parseSince(input) {
  const m = input.match(/^(\d+)([mhdw])$/i);
  if (m) {
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    const ms =
      u === "m" ? n * 60_000 :
      u === "h" ? n * 3_600_000 :
      u === "d" ? n * 86_400_000 :
                  n * 604_800_000;
    return new Date(Date.now() - ms);
  }
  const d = new Date(input);
  if (isNaN(d.getTime())) throw new Error(`Can't parse --since=${input}`);
  return d;
}

const asDate = (v) => {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
};
const asStr = (v) => (typeof v === "string" ? v : null);
const firstStr = (o, keys) => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
};

function collectNotes(data, acc = []) {
  if (!data) return acc;
  if (Array.isArray(data)) {
    const looksLikeNotes = data.every(
      (x) => x && typeof x === "object" && ("id" in x || "title" in x)
    );
    if (looksLikeNotes) acc.push(...data);
    else for (const v of data) collectNotes(v, acc);
    return acc;
  }
  if (typeof data === "object") {
    for (const v of Object.values(data)) collectNotes(v, acc);
  }
  return acc;
}

function normalize(raw) {
  const id = firstStr(raw, ["id", "note_id", "uuid", "documentId"]);
  if (!id) return null;
  const title = firstStr(raw, ["title", "meeting_title", "name", "displayTitle"]) ?? "(untitled)";
  const summary = firstStr(raw, [
    "summary_markdown", "summary", "ai_summary",
    "notes", "content", "body", "markdown",
  ]);
  const createdAt = asDate(raw.created_at) ?? asDate(raw.createdAt) ?? asDate(raw.created);
  const updatedAt = asDate(raw.updated_at) ?? asDate(raw.updatedAt) ?? asDate(raw.modified_at) ?? createdAt;
  const webUrl = firstStr(raw, ["web_url", "url", "share_url", "permalink"]);
  const attRaw = raw.attendees ?? raw.participants ?? [];
  const attendees = Array.isArray(attRaw)
    ? attRaw
        .map((a) => {
          if (!a || typeof a !== "object") return null;
          return {
            name: asStr(a.name) ?? asStr(a.displayName) ?? undefined,
            email:
              asStr(a.email) ??
              asStr(a.emailAddress) ??
              asStr(a.address) ??
              undefined,
          };
        })
        .filter(Boolean)
    : [];
  const cal = raw.calendar_event ?? raw.calendarEvent ?? null;
  const scheduledStart = cal
    ? asStr(cal.scheduled_start_time) ?? asStr(cal.scheduledStartTime) ?? asStr(cal.start)
    : null;
  return {
    id,
    title,
    summary_markdown: summary,
    created_at: createdAt ? createdAt.toISOString() : null,
    updated_at: updatedAt ? updatedAt.toISOString() : null,
    web_url: webUrl,
    attendees,
    calendar_event: scheduledStart ? { scheduled_start_time: scheduledStart } : null,
  };
}

async function loadAllJsonNotes(dir) {
  const files = (await walk(dir)).filter((f) => f.toLowerCase().endsWith(".json"));
  const collected = [];
  for (const f of files) {
    try {
      const buf = await readFile(f, "utf8");
      const parsed = JSON.parse(buf);
      const raws = collectNotes(parsed);
      for (const r of raws) {
        const n = normalize(r);
        if (n) collected.push(n);
      }
    } catch {
      /* skip */
    }
  }
  const byId = new Map();
  for (const n of collected) {
    const prev = byId.get(n.id);
    if (!prev) { byId.set(n.id, n); continue; }
    const a = n.updated_at ? Date.parse(n.updated_at) : 0;
    const b = prev.updated_at ? Date.parse(prev.updated_at) : 0;
    if (a > b) byId.set(n.id, n);
  }
  return Array.from(byId.values());
}

async function sync({ since, dryRun }) {
  const dir = await resolveCacheDir();
  if (!dir) throw new Error("No Granola cache directory found. Run `probe` first.");
  const appUrl = process.env.APP_URL;
  const apiKey = process.env.DAILY_PLANNER_API_KEY;
  if (!dryRun && (!appUrl || !apiKey)) {
    throw new Error("APP_URL and DAILY_PLANNER_API_KEY must be set (or pass --dry-run)");
  }
  const all = await loadAllJsonNotes(dir);
  console.log(`[sync] loaded ${all.length} raw entries from cache`);
  const meetings = all.filter((n) => {
    const t = (n.title ?? "").trim();
    if (!t || t === "(untitled)") return false;
    if (!n.attendees || n.attendees.length === 0) return false;
    return true;
  });
  console.log(`[sync] ${meetings.length} meetings after dropping untitled + no-attendees`);
  const filtered = meetings.filter(
    (n) => !n.updated_at || Date.parse(n.updated_at) >= since.getTime()
  );
  console.log(`[sync] ${filtered.length} after updated_at filter (>= ${since.toISOString()})`);
  let ok = 0, failed = 0;
  for (const n of filtered) {
    if (dryRun) {
      console.log(`  [dry] ${n.id}  ${n.updated_at}  "${n.title}"  attendees=${n.attendees.length}`);
      ok++;
      continue;
    }
    try {
      const res = await fetch(`${appUrl}/api/webhooks/granola`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
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
        }),
      });
      if (!res.ok) {
        failed++;
        console.warn(`  [fail] ${n.id} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      } else ok++;
    } catch (e) {
      failed++;
      console.warn(`  [err] ${n.id}: ${e.message}`);
    }
    await sleep(120);
  }
  console.log(`[sync] done. ok=${ok} failed=${failed}`);
}

// ─── CLI ───────────────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (!cmd || cmd === "probe") {
    await probe();
  } else if (cmd === "sync") {
    let sinceStr = "30m", dryRun = false;
    for (const a of rest) {
      if (a.startsWith("--since=")) sinceStr = a.split("=")[1];
      else if (a === "--dry-run") dryRun = true;
    }
    await sync({ since: parseSince(sinceStr), dryRun });
  } else {
    console.error(`Unknown command: ${cmd}`);
    console.error("Use 'probe' or 'sync [--since=30m] [--dry-run]'.");
    process.exit(1);
  }
} catch (e) {
  console.error(e);
  process.exit(1);
}
