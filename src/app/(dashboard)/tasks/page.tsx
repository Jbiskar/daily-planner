"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskSheet } from "@/components/task-sheet";
import { cn } from "@/lib/utils";
import type {
  Event,
  TaskStatus,
  Workspace,
} from "@/types/database";

const WORKSPACE_STYLES: Record<Workspace, string> = {
  atlan: "bg-sky-100 text-sky-700",
  landit: "bg-emerald-100 text-emerald-700",
  consulting: "bg-amber-100 text-amber-700",
  personal: "bg-violet-100 text-violet-700",
  general: "bg-slate-100 text-slate-600",
};

const UNSET_WORKSPACE_STYLE = "bg-slate-100 text-slate-500";

const WORKSPACE_OPTIONS: Array<{ value: Workspace; label: string }> = [
  { value: "atlan", label: "Atlan" },
  { value: "landit", label: "Landit" },
  { value: "consulting", label: "Consulting" },
  { value: "personal", label: "Personal" },
];

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const offset = (dow + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatMonthDay(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInputValue(value: string): string | null {
  if (!value) return null;
  const [y, m, day] = value.split("-").map(Number);
  if (!y || !m || !day) return null;
  const d = new Date(y, m - 1, day, 9, 0, 0, 0);
  return d.toISOString();
}

function truncateWords(s: string, n: number): string {
  const words = s.trim().split(/\s+/);
  if (words.length <= n) return s.trim();
  return words.slice(0, n).join(" ") + "…";
}

type Bucket = "unscheduled" | 0 | 1 | 2 | 3 | 4;

function bucketFor(
  event: Event,
  weekStart: Date,
  weekEnd: Date
): Bucket | null {
  const isCalendar = event.source === "google_calendar";
  const refIso = isCalendar ? event.occurred_at : event.due_date;

  if (!refIso) {
    return isCalendar ? null : "unscheduled";
  }

  const ref = new Date(refIso);
  if (Number.isNaN(ref.getTime())) {
    return isCalendar ? null : "unscheduled";
  }

  ref.setHours(0, 0, 0, 0);

  if (ref < weekStart) {
    return isCalendar ? null : 0;
  }
  if (ref > weekEnd) return null;

  const dow = ref.getDay();
  if (dow === 0) return 4;
  if (dow === 6) return 4;
  return ((dow + 6) % 7) as 0 | 1 | 2 | 3 | 4;
}

export default function TasksPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [showCalendar, setShowCalendar] = useState(false);
  const [selected, setSelected] = useState<Event | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    fetch("/api/events?limit=500")
      .then((r) => r.json())
      .then((data) => setEvents(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const weekDays = useMemo(
    () => Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const weekEnd = useMemo(() => addDays(weekStart, 4), [weekStart]);

  const buckets = useMemo(() => {
    const out: { unscheduled: Event[]; days: Event[][] } = {
      unscheduled: [],
      days: [[], [], [], [], []],
    };
    for (const e of events) {
      if (e.task_status === "dismissed") continue;
      if (e.source === "google_calendar" && !showCalendar) continue;
      const b = bucketFor(e, weekStart, weekEnd);
      if (b === null) continue;
      if (b === "unscheduled") out.unscheduled.push(e);
      else out.days[b].push(e);
    }
    const sortByTime = (arr: Event[]) =>
      arr.sort((a, b) => {
        const ta =
          a.source === "google_calendar"
            ? new Date(a.occurred_at ?? 0).getTime()
            : Infinity;
        const tb =
          b.source === "google_calendar"
            ? new Date(b.occurred_at ?? 0).getTime()
            : Infinity;
        return ta - tb;
      });
    out.days.forEach(sortByTime);
    return out;
  }, [events, weekStart, weekEnd, showCalendar]);

  const openSheet = (event: Event) => {
    setSelected(event);
    setSheetOpen(true);
  };

  const applyUpdate = (updated: Event) => {
    setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;
    const updated: Event = await res.json();
    applyUpdate(updated);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  const weekLabel = `${formatMonthDay(weekStart)} – ${formatMonthDay(weekEnd)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your week at a glance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-full border bg-white p-1 shadow-sm">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-full"
              aria-label="Previous week"
              onClick={() => setWeekStart((w) => addDays(w, -7))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <button
              onClick={() => setWeekStart(startOfWeek(new Date()))}
              className="px-3 text-sm font-medium text-slate-700 hover:text-slate-900"
            >
              {weekLabel}
            </button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-full"
              aria-label="Next week"
              onClick={() => setWeekStart((w) => addDays(w, 7))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button
            variant={showCalendar ? "default" : "outline"}
            size="sm"
            className="rounded-full"
            onClick={() => setShowCalendar((v) => !v)}
          >
            <CalendarDays className="mr-1.5 h-4 w-4" />
            Calendar
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-6">
        <TaskColumn
          title="Unscheduled"
          subtitle={`${buckets.unscheduled.length} open`}
          tone="bg-slate-900 text-white"
        >
          {buckets.unscheduled.length === 0 ? (
            <EmptyColumn text="Nothing here." />
          ) : (
            buckets.unscheduled.map((event) => (
              <TaskCard
                key={event.id}
                event={event}
                onOpen={() => openSheet(event)}
                onPatch={(body) => patch(event.id, body)}
              />
            ))
          )}
        </TaskColumn>

        {weekDays.map((day, i) => {
          const isToday = sameDay(day, today);
          return (
            <TaskColumn
              key={i}
              title={DAY_LABELS[i]}
              subtitle={formatMonthDay(day)}
              tone={
                isToday ? "bg-indigo-600 text-white" : "bg-white text-slate-700 border"
              }
            >
              {buckets.days[i].length === 0 ? (
                <EmptyColumn text="—" />
              ) : (
                buckets.days[i].map((event) => (
                  <TaskCard
                    key={event.id}
                    event={event}
                    onOpen={() => openSheet(event)}
                    onPatch={(body) => patch(event.id, body)}
                  />
                ))
              )}
            </TaskColumn>
          );
        })}
      </div>

      <TaskSheet
        event={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onUpdated={applyUpdate}
      />
    </div>
  );
}

interface TaskColumnProps {
  title: string;
  subtitle: string;
  tone: string;
  children: React.ReactNode;
}

function TaskColumn({ title, subtitle, tone, children }: TaskColumnProps) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div
        className={cn(
          "flex items-baseline justify-between rounded-2xl px-4 py-3 shadow-sm",
          tone
        )}
      >
        <span className="font-semibold">{title}</span>
        <span className="text-xs opacity-75">{subtitle}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function EmptyColumn({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 px-3 py-6 text-center text-xs text-slate-400">
      {text}
    </div>
  );
}

interface TaskCardProps {
  event: Event;
  onOpen: () => void;
  onPatch: (body: Record<string, unknown>) => void;
}

function TaskCard({ event, onOpen, onPatch }: TaskCardProps) {
  const isCalendar = event.source === "google_calendar";
  const isDone = event.task_status === "done";
  const hasLink = (event.links?.length ?? 0) > 0;

  const displayTitle = truncateWords(event.title || "(untitled)", 10);

  const handleDueDateChange = (value: string) => {
    onPatch({ due_date: fromDateInputValue(value) });
  };

  const handleWorkspaceChange = (value: string) => {
    onPatch({ workspace: value === "" ? null : value });
  };

  if (isCalendar) {
    const start = event.occurred_at ? new Date(event.occurred_at) : null;
    return (
      <div
        onClick={onOpen}
        className="group cursor-pointer rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 p-3 transition-colors hover:bg-indigo-50"
      >
        {start && (
          <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600">
            {formatTime(start)}
          </div>
        )}
        <h3 className="mt-1 text-sm font-semibold leading-snug text-slate-900">
          {displayTitle}
        </h3>
      </div>
    );
  }

  return (
    <div
      onClick={onOpen}
      className={cn(
        "group cursor-pointer rounded-2xl border border-slate-200/70 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
        isDone && "opacity-60"
      )}
    >
      <h3
        className={cn(
          "text-sm font-semibold leading-snug text-slate-900",
          isDone && "text-slate-400 line-through"
        )}
      >
        {displayTitle}
      </h3>

      <div
        className="mt-3 flex flex-wrap items-center gap-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <DueDatePill
          value={event.due_date}
          onChange={handleDueDateChange}
        />
        <WorkspacePill
          value={event.workspace}
          onChange={handleWorkspaceChange}
        />
        {hasLink && (
          <span
            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"
            title={`${event.links.length} link${event.links.length === 1 ? "" : "s"}`}
          >
            <Link2 className="h-3 w-3" />
          </span>
        )}
      </div>
    </div>
  );
}

function DueDatePill({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string) => void;
}) {
  const label = value ? formatMonthDay(new Date(value)) : "No date";
  const hasDate = !!value;
  return (
    <label
      className={cn(
        "relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        hasDate ? "bg-slate-100 text-slate-700" : UNSET_WORKSPACE_STYLE
      )}
    >
      <span>{label}</span>
      <input
        type="date"
        value={toDateInputValue(value)}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );
}

function WorkspacePill({
  value,
  onChange,
}: {
  value: Workspace | null;
  onChange: (v: string) => void;
}) {
  const style = value ? WORKSPACE_STYLES[value] : UNSET_WORKSPACE_STYLE;
  const label = value
    ? value.charAt(0).toUpperCase() + value.slice(1)
    : "Type";
  return (
    <label
      className={cn(
        "relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        style
      )}
    >
      <span>{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="">Unset</option>
        {WORKSPACE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
