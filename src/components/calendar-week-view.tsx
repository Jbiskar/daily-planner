"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Event } from "@/types/database";
import type {
  CalendarEventSource,
  GoogleCalendarEvent,
} from "@/lib/google/calendar";

const SOURCE_STYLES: Record<CalendarEventSource, { block: string; chip: string; label: string }> = {
  google: {
    block:
      "border border-indigo-200 bg-indigo-100/90 text-indigo-900",
    chip: "bg-indigo-100 text-indigo-700",
    label: "LandIt",
  },
  atlan: {
    block: "border border-sky-200 bg-sky-100/90 text-sky-900",
    chip: "bg-sky-100 text-sky-700",
    label: "Atlan",
  },
  personal: {
    block:
      "border border-violet-200 bg-violet-100/90 text-violet-900",
    chip: "bg-violet-100 text-violet-700",
    label: "Personal",
  },
};

const HOUR_START = 7;
const HOUR_END = 21;
const HOURS_TOTAL = HOUR_END - HOUR_START;
const PX_PER_HOUR = 56;
const MIN_BLOCK_PX = 22;

interface Props {
  googleEvents: GoogleCalendarEvent[];
  tasks: Event[];
  onCreateTask: (when: Date) => void;
  onSelectTask?: (task: Event) => void;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function hourLabel(h: number): string {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
}

function fractionalHours(d: Date): number {
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

interface PositionedBlock {
  id: string;
  topPx: number;
  heightPx: number;
  laneIndex: number;
  laneCount: number;
  kind: CalendarEventSource | "task";
  title: string;
  subtitle: string | null;
  meta?: Record<string, unknown>;
}

interface RawBlock {
  id: string;
  startHours: number;
  endHours: number;
  kind: CalendarEventSource | "task";
  title: string;
  subtitle: string | null;
  original: GoogleCalendarEvent | Event;
}

function layoutDay(raw: RawBlock[]): PositionedBlock[] {
  const sorted = [...raw].sort(
    (a, b) => a.startHours - b.startHours || a.endHours - b.endHours
  );
  const lanes: number[] = [];
  const withLanes = sorted.map((b) => {
    let lane = lanes.findIndex((end) => end <= b.startHours);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(b.endHours);
    } else {
      lanes[lane] = b.endHours;
    }
    return { ...b, laneIndex: lane };
  });
  const laneCount = Math.max(1, lanes.length);
  return withLanes.map((b) => ({
    id: b.id,
    kind: b.kind,
    title: b.title,
    subtitle: b.subtitle,
    topPx: (b.startHours - HOUR_START) * PX_PER_HOUR,
    heightPx: Math.max(
      MIN_BLOCK_PX,
      (b.endHours - b.startHours) * PX_PER_HOUR - 2
    ),
    laneIndex: b.laneIndex,
    laneCount,
    meta: { original: b.original },
  }));
}

export function CalendarWeekView({
  googleEvents,
  tasks,
  onCreateTask,
  onSelectTask,
}: Props) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(today, i)),
    [today]
  );

  const [nowMinutes, setNowMinutes] = useState(() => {
    const n = new Date();
    return fractionalHours(n);
  });

  useEffect(() => {
    const t = setInterval(() => {
      setNowMinutes(fractionalHours(new Date()));
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const perDay = useMemo(() => {
    return days.map((day) => {
      const dayStart = day.getTime();
      const dayEnd = addDays(day, 1).getTime();

      const allDay: {
        id: string;
        title: string;
        kind: CalendarEventSource | "task";
      }[] = [];
      const timed: RawBlock[] = [];

      for (const e of googleEvents) {
        if (!e.start) continue;
        const s = new Date(e.start);
        const en = e.end ? new Date(e.end) : new Date(s.getTime() + 30 * 60_000);
        if (isNaN(s.getTime())) continue;
        if (en.getTime() <= dayStart || s.getTime() >= dayEnd) continue;

        if (e.allDay) {
          allDay.push({
            id: e.id,
            title: e.summary ?? "(no title)",
            kind: e.source,
          });
          continue;
        }

        const clampedStart = Math.max(dayStart, s.getTime());
        const clampedEnd = Math.min(dayEnd, en.getTime());
        const startHours = (clampedStart - dayStart) / 3_600_000;
        const endHours = (clampedEnd - dayStart) / 3_600_000;
        if (endHours <= HOUR_START || startHours >= HOUR_END) continue;

        timed.push({
          id: `${e.source}-${e.id}`,
          startHours: Math.max(HOUR_START, startHours),
          endHours: Math.min(HOUR_END, endHours),
          kind: e.source,
          title: e.summary ?? "(no title)",
          subtitle: `${formatTime(s)} – ${formatTime(en)}`,
          original: e,
        });
      }

      for (const t of tasks) {
        if (!t.due_date) continue;
        const d = new Date(t.due_date);
        if (isNaN(d.getTime()) || !sameDay(d, day)) continue;
        const fh = fractionalHours(d);
        if (fh < HOUR_START || fh >= HOUR_END) {
          allDay.push({
            id: t.id,
            title: t.title || "(untitled)",
            kind: "task",
          });
          continue;
        }
        timed.push({
          id: `t-${t.id}`,
          startHours: fh,
          endHours: Math.min(HOUR_END, fh + 0.5),
          kind: "task",
          title: t.title || "(untitled)",
          subtitle: formatTime(d),
          original: t,
        });
      }

      return { allDay, timed: layoutDay(timed) };
    });
  }, [days, googleEvents, tasks]);

  const gutterHeight = HOURS_TOTAL * PX_PER_HOUR;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] border-b bg-slate-50 text-xs font-medium text-slate-600">
        <div className="p-2" />
        {days.map((d) => {
          const isToday = sameDay(d, today);
          return (
            <div
              key={d.toISOString()}
              className={cn(
                "border-l px-2 py-2 text-center",
                isToday && "bg-indigo-50 text-indigo-700"
              )}
            >
              <div className="text-[10px] uppercase tracking-wide opacity-70">
                {d.toLocaleDateString(undefined, { weekday: "short" })}
              </div>
              <div className={cn("text-sm font-semibold", isToday && "text-indigo-700")}>
                {d.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] border-b bg-white text-xs">
        <div className="p-1 pl-2 pt-2 text-[10px] uppercase tracking-wide text-slate-400">
          all-day
        </div>
        {perDay.map((d, i) => (
          <div
            key={i}
            className="flex min-h-[32px] flex-wrap gap-1 border-l p-1"
          >
            {d.allDay.map((e) => (
              <span
                key={e.id}
                className={cn(
                  "inline-flex max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-medium",
                  e.kind === "task"
                    ? "bg-emerald-100 text-emerald-700"
                    : SOURCE_STYLES[e.kind].chip
                )}
                title={e.title}
              >
                {e.title}
              </span>
            ))}
          </div>
        ))}
      </div>

      <div
        className="relative grid grid-cols-[60px_repeat(7,minmax(0,1fr))] overflow-y-auto"
        style={{ maxHeight: "calc(100vh - 260px)" }}
      >
        <div
          className="relative border-r bg-slate-50 text-[10px] text-slate-400"
          style={{ height: gutterHeight }}
        >
          {Array.from({ length: HOURS_TOTAL }, (_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0 px-1 pt-0.5 text-right"
              style={{ top: i * PX_PER_HOUR }}
            >
              {hourLabel(HOUR_START + i)}
            </div>
          ))}
        </div>

        {days.map((day, dayIdx) => {
          const isToday = sameDay(day, today);
          const blocks = perDay[dayIdx].timed;
          return (
            <DayColumn
              key={day.toISOString()}
              day={day}
              isToday={isToday}
              blocks={blocks}
              nowMinutes={isToday ? nowMinutes : null}
              height={gutterHeight}
              onCreateTask={onCreateTask}
              onSelectTask={onSelectTask}
            />
          );
        })}
      </div>
    </div>
  );
}

interface DayColumnProps {
  day: Date;
  isToday: boolean;
  blocks: PositionedBlock[];
  nowMinutes: number | null;
  height: number;
  onCreateTask: (when: Date) => void;
  onSelectTask?: (task: Event) => void;
}

function DayColumn({
  day,
  isToday,
  blocks,
  nowMinutes,
  height,
  onCreateTask,
  onSelectTask,
}: DayColumnProps) {
  const colRef = useRef<HTMLDivElement | null>(null);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = colRef.current;
    if (!el) return;
    // Ignore clicks bubbling up from an event block.
    if ((e.target as HTMLElement).closest("[data-block]")) return;
    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const hoursFromStart = y / PX_PER_HOUR;
    const hour = HOUR_START + hoursFromStart;
    const whole = Math.floor(hour);
    const minutes = Math.round(((hour - whole) * 60) / 15) * 15;
    const when = new Date(day);
    when.setHours(whole, Math.min(59, minutes), 0, 0);
    onCreateTask(when);
  };

  return (
    <div
      ref={colRef}
      onClick={handleClick}
      className={cn(
        "relative cursor-copy border-l",
        isToday && "bg-indigo-50/30"
      )}
      style={{ height }}
    >
      {Array.from({ length: HOURS_TOTAL }, (_, i) => (
        <div
          key={i}
          className="absolute left-0 right-0 border-t border-slate-100"
          style={{ top: i * PX_PER_HOUR }}
        />
      ))}

      {nowMinutes !== null &&
        nowMinutes >= HOUR_START &&
        nowMinutes <= HOUR_END && (
          <div
            className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
            style={{ top: (nowMinutes - HOUR_START) * PX_PER_HOUR }}
          >
            <div className="h-2 w-2 -translate-x-1 rounded-full bg-rose-500" />
            <div className="h-px flex-1 bg-rose-500" />
          </div>
        )}

      {blocks.map((b) => {
        const laneWidth = 100 / b.laneCount;
        const left = `calc(${b.laneIndex * laneWidth}% + 2px)`;
        const width = `calc(${laneWidth}% - 4px)`;
        const original = b.meta?.original;
        const isTask = b.kind === "task";
        return (
          <div
            key={b.id}
            data-block
            onClick={(e) => {
              e.stopPropagation();
              if (isTask && onSelectTask && original) {
                onSelectTask(original as Event);
              }
            }}
            className={cn(
              "absolute overflow-hidden rounded-md px-2 py-1 text-[11px] shadow-sm",
              isTask
                ? "cursor-pointer border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                : SOURCE_STYLES[b.kind as CalendarEventSource].block
            )}
            style={{ top: b.topPx, height: b.heightPx, left, width }}
            title={b.title}
          >
            <div className="truncate font-semibold leading-tight">
              {b.title}
            </div>
            {b.subtitle && b.heightPx > 32 && (
              <div className="truncate text-[10px] opacity-75">
                {b.subtitle}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface QuickCreateProps {
  when: Date;
  onClose: () => void;
  onCreated: (event: Event) => void;
  onPushToGoogle?: (payload: { title: string; when: Date }) => Promise<void>;
}

export function QuickCreateTaskModal({
  when,
  onClose,
  onCreated,
  onPushToGoogle,
}: QuickCreateProps) {
  const [title, setTitle] = useState("");
  const [alsoPush, setAlsoPush] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const label = when.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const submit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          due_date: when.toISOString(),
        }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Failed (${res.status})`);
      }
      const created = (await res.json()) as Event;
      if (alsoPush && onPushToGoogle) {
        try {
          await onPushToGoogle({ title: title.trim(), when });
        } catch (e) {
          const m = e instanceof Error ? e.message : "push failed";
          setError(`Saved task but Google push failed: ${m}`);
          setSubmitting(false);
          onCreated(created);
          return;
        }
      }
      onCreated(created);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold">New task</h2>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
          <button
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="What do you want to do?"
          className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
        />

        {onPushToGoogle && (
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={alsoPush}
              onChange={(e) => setAlsoPush(e.target.checked)}
            />
            Also add to Google Calendar (30 min block)
          </label>
        )}

        {error && (
          <div className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!title.trim() || submitting}>
            {submitting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-4 w-4" />
            )}
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
