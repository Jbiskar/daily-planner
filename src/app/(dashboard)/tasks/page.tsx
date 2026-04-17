"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
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

  const moveToDay = (id: string, dayIndex: number) => {
    const event = events.find((e) => e.id === id);
    if (!event || event.source === "google_calendar") return;
    const target = addDays(weekStart, dayIndex);
    if (event.due_date) {
      const orig = new Date(event.due_date);
      if (!Number.isNaN(orig.getTime())) {
        target.setHours(
          orig.getHours(),
          orig.getMinutes(),
          orig.getSeconds(),
          0
        );
      } else {
        target.setHours(9, 0, 0, 0);
      }
    } else {
      target.setHours(9, 0, 0, 0);
    }
    const iso = target.toISOString();
    if (iso === event.due_date) return;
    applyUpdate({ ...event, due_date: iso });
    patch(id, { due_date: iso });
  };

  const moveToUnscheduled = (id: string) => {
    const event = events.find((e) => e.id === id);
    if (!event || event.source === "google_calendar") return;
    if (event.due_date === null) return;
    applyUpdate({ ...event, due_date: null });
    patch(id, { due_date: null });
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
          onDropTask={moveToUnscheduled}
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
              onDropTask={(id) => moveToDay(id, i)}
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
  onDropTask?: (id: string) => void;
  children: ReactNode;
}

function TaskColumn({
  title,
  subtitle,
  tone,
  onDropTask,
  children,
}: TaskColumnProps) {
  const [isOver, setIsOver] = useState(false);

  const handleDragOver = (e: DragEvent) => {
    if (!onDropTask) return;
    if (!e.dataTransfer.types.includes("text/plain")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!isOver) setIsOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setIsOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    if (!onDropTask) return;
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    setIsOver(false);
    if (id) onDropTask(id);
  };

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
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "min-h-[4rem] space-y-2 rounded-2xl p-1 transition-colors",
          isOver && "bg-indigo-50 ring-2 ring-indigo-300"
        )}
      >
        {children}
      </div>
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

  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", event.id);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={onOpen}
      className={cn(
        "group cursor-grab rounded-2xl border border-slate-200/70 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing",
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const label = value ? formatMonthDay(new Date(value)) : "Set date";
  const hasDate = !!value;

  const openPicker = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = inputRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        // fall through
      }
    }
    el.focus();
    el.click();
  };

  return (
    <button
      type="button"
      onClick={openPicker}
      className={cn(
        "relative inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        hasDate ? "bg-slate-100 text-slate-700" : UNSET_WORKSPACE_STYLE
      )}
    >
      <span>{label}</span>
      <input
        ref={inputRef}
        type="date"
        value={value ? toDateInputValue(value) : ""}
        onChange={(e) => onChange(e.target.value)}
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        tabIndex={-1}
        aria-hidden="true"
      />
    </button>
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
