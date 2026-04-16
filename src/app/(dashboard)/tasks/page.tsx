"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskSheet } from "@/components/task-sheet";
import { cn } from "@/lib/utils";
import type {
  Event,
  TaskPriority,
  TaskStatus,
  Workspace,
} from "@/types/database";

const workspaceStyles: Record<Workspace, string> = {
  personal: "bg-violet-100 text-violet-700",
  atlan: "bg-sky-100 text-sky-700",
  landit: "bg-emerald-100 text-emerald-700",
  general: "bg-slate-100 text-slate-600",
};

const priorityStyles: Record<TaskPriority, string> = {
  high: "bg-rose-100 text-rose-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-emerald-100 text-emerald-700",
};

const priorityLabel: Record<TaskPriority, string> = {
  high: "High Priority",
  medium: "Medium Priority",
  low: "Low Priority",
};

const columns: Array<{
  status: TaskStatus;
  label: string;
  tone: string;
  empty: string;
}> = [
  {
    status: "inbox",
    label: "Inbox",
    tone: "bg-indigo-600",
    empty: "Inbox is empty. Capture a voice note to get started.",
  },
  {
    status: "active",
    label: "Active",
    tone: "bg-amber-500",
    empty: "No active tasks. Confirm items from Inbox to promote them.",
  },
  {
    status: "done",
    label: "Completed",
    tone: "bg-emerald-500",
    empty: "No completed tasks yet.",
  },
];

function formatDueDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function TasksPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Event | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    fetch("/api/events?limit=200")
      .then((r) => r.json())
      .then((data) => setEvents(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const by: Record<TaskStatus, Event[]> = {
      inbox: [],
      active: [],
      done: [],
      dismissed: [],
    };
    for (const e of events) {
      const status = e.task_status ?? "inbox";
      by[status]?.push(e);
    }
    return by;
  }, [events]);

  const openSheet = (event: Event) => {
    setSelected(event);
    setSheetOpen(true);
  };

  const applyUpdate = (updated: Event) => {
    setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  };

  const patchStatus = async (id: string, task_status: TaskStatus) => {
    const res = await fetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_status }),
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          New captures land in Inbox. Confirm to promote to Active.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {columns.map((col) => (
          <TaskColumn
            key={col.status}
            label={col.label}
            tone={col.tone}
            empty={col.empty}
            events={grouped[col.status]}
            onOpen={openSheet}
            onConfirm={(id) => patchStatus(id, "active")}
            onDismiss={(id) => patchStatus(id, "dismissed")}
            onMarkDone={(id) => patchStatus(id, "done")}
          />
        ))}
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
  label: string;
  tone: string;
  empty: string;
  events: Event[];
  onOpen: (e: Event) => void;
  onConfirm: (id: string) => void;
  onDismiss: (id: string) => void;
  onMarkDone: (id: string) => void;
}

function TaskColumn({
  label,
  tone,
  empty,
  events,
  onOpen,
  onConfirm,
  onDismiss,
  onMarkDone,
}: TaskColumnProps) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-2xl px-4 py-3 text-white shadow-sm",
          tone
        )}
      >
        <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-slate-900">
          {events.length}
        </span>
        <span className="font-medium">{label}</span>
      </div>

      {events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-10 text-center text-xs text-muted-foreground">
          {empty}
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <TaskCard
              key={event.id}
              event={event}
              onOpen={() => onOpen(event)}
              onConfirm={() => onConfirm(event.id)}
              onDismiss={() => onDismiss(event.id)}
              onMarkDone={() => onMarkDone(event.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TaskCardProps {
  event: Event;
  onOpen: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
  onMarkDone: () => void;
}

function TaskCard({
  event,
  onOpen,
  onConfirm,
  onDismiss,
  onMarkDone,
}: TaskCardProps) {
  const isDone = event.task_status === "done";
  const isPastDue =
    !!event.due_date && new Date(event.due_date).getTime() < Date.now() && !isDone;

  return (
    <div
      onClick={onOpen}
      className={cn(
        "group cursor-pointer rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
        isDone && "opacity-60"
      )}
    >
      {event.priority && (
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium",
            priorityStyles[event.priority]
          )}
        >
          {priorityLabel[event.priority]}
        </span>
      )}

      <h3
        className={cn(
          "mt-3 text-[15px] font-semibold leading-tight text-slate-900",
          isDone && "text-slate-400 line-through"
        )}
      >
        {event.title}
      </h3>

      {event.body && !isDone && (
        <p className="mt-2 text-sm leading-relaxed text-slate-500 line-clamp-2">
          {event.body}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {event.workspace && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                workspaceStyles[event.workspace]
              )}
            >
              {event.workspace}
            </span>
          )}
          {event.due_date && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                isPastDue
                  ? "bg-rose-100 text-rose-700"
                  : "bg-slate-100 text-slate-600"
              )}
            >
              {formatDueDate(event.due_date)}
            </span>
          )}
        </div>

        <div
          className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {event.task_status === "inbox" && (
            <>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Confirm"
                onClick={onConfirm}
                className="h-7 w-7 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Dismiss"
                onClick={onDismiss}
                className="h-7 w-7 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {event.task_status === "active" && (
            <Button
              size="icon"
              variant="ghost"
              aria-label="Mark done"
              onClick={onMarkDone}
              className="h-7 w-7 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
