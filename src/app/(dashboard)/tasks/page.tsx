"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskSheet } from "@/components/task-sheet";
import { cn } from "@/lib/utils";
import type {
  Event,
  TaskPriority,
  TaskStatus,
  Workspace,
} from "@/types/database";

const workspaceColors: Record<Workspace, string> = {
  personal: "bg-purple-500/10 text-purple-500",
  atlan: "bg-blue-500/10 text-blue-500",
  landit: "bg-emerald-500/10 text-emerald-500",
  general: "bg-muted text-muted-foreground",
};

const priorityColors: Record<TaskPriority, string> = {
  high: "bg-red-500/10 text-red-500",
  medium: "bg-yellow-500/10 text-yellow-500",
  low: "bg-muted text-muted-foreground",
};

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
  const [tab, setTab] = useState<TaskStatus>("inbox");
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
        <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          New captures land in Inbox. Confirm to promote to Active.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TaskStatus)}>
        <TabsList>
          <TabsTrigger value="inbox">
            Inbox ({grouped.inbox.length})
          </TabsTrigger>
          <TabsTrigger value="active">
            Active ({grouped.active.length})
          </TabsTrigger>
          <TabsTrigger value="done">Done ({grouped.done.length})</TabsTrigger>
        </TabsList>

        {(["inbox", "active", "done"] as const).map((status) => (
          <TabsContent key={status} value={status} className="mt-4">
            {grouped[status].length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  {status === "inbox"
                    ? "Inbox is empty. Capture a voice note to get started."
                    : status === "active"
                    ? "No active tasks. Confirm items from the Inbox to promote them."
                    : "No completed tasks yet."}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {grouped[status].map((event) => (
                  <TaskCard
                    key={event.id}
                    event={event}
                    onOpen={() => openSheet(event)}
                    onConfirm={() => patchStatus(event.id, "active")}
                    onDismiss={() => patchStatus(event.id, "dismissed")}
                    onMarkDone={() => patchStatus(event.id, "done")}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <TaskSheet
        event={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onUpdated={applyUpdate}
      />
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
    <Card
      onClick={onOpen}
      className={cn(
        "cursor-pointer transition-colors hover:bg-accent/30",
        isDone && "opacity-60"
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <CardTitle
              className={cn(
                "text-sm",
                isDone && "line-through text-muted-foreground"
              )}
            >
              {event.title}
            </CardTitle>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {event.workspace && (
                <Badge
                  variant="secondary"
                  className={workspaceColors[event.workspace]}
                >
                  {event.workspace}
                </Badge>
              )}
              {event.priority && (
                <Badge
                  variant="secondary"
                  className={priorityColors[event.priority]}
                >
                  {event.priority}
                </Badge>
              )}
              {event.due_date && (
                <Badge
                  variant="secondary"
                  className={cn(
                    "font-normal",
                    isPastDue && "bg-red-500/15 text-red-500"
                  )}
                >
                  {formatDueDate(event.due_date)}
                </Badge>
              )}
            </div>
          </div>

          <div
            className="flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {event.task_status === "inbox" && (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Confirm"
                  onClick={onConfirm}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Dismiss"
                  onClick={onDismiss}
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            )}
            {event.task_status === "active" && (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Mark done"
                onClick={onMarkDone}
              >
                <Check className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      {event.body && !isDone && (
        <CardContent>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {event.body}
          </p>
        </CardContent>
      )}
    </Card>
  );
}
