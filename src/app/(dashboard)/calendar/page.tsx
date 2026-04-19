"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, Loader2, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskSheet } from "@/components/task-sheet";
import {
  CalendarWeekView,
  QuickCreateTaskModal,
} from "@/components/calendar-week-view";
import type { Event } from "@/types/database";
import type { GoogleCalendarEvent } from "@/lib/google/calendar";

interface StatusResponse {
  connected: boolean;
  email?: string;
  error?: string;
}

export default function CalendarPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quickCreate, setQuickCreate] = useState<Date | null>(null);
  const [selected, setSelected] = useState<Event | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const range = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start: start.toISOString(), end: end.toISOString() };
  }, []);

  const loadAll = useCallback(async () => {
    setError(null);
    const statusPromise = fetch("/api/calendar/status").then((r) => r.json());

    const tasksPromise = fetch("/api/events?limit=500")
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? (data as Event[]) : []));

    const eventsPromise = fetch(
      `/api/calendar/events?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`
    ).then(async (r) => {
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${r.status})`);
      }
      const body = (await r.json()) as { events: GoogleCalendarEvent[] };
      return body.events;
    });

    const [statusRes, tasksRes, eventsRes] = await Promise.all([
      statusPromise.catch(() => ({ connected: false }) as StatusResponse),
      tasksPromise.catch(() => [] as Event[]),
      eventsPromise.catch((e: Error) => {
        setError(e.message);
        return [] as GoogleCalendarEvent[];
      }),
    ]);

    setStatus(statusRes);
    setTasks(tasksRes);
    setGoogleEvents(eventsRes);
  }, [range.start, range.end]);

  useEffect(() => {
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  const handleCreateTask = (when: Date) => {
    setQuickCreate(when);
  };

  const handleTaskCreated = (event: Event) => {
    setTasks((prev) => [event, ...prev]);
  };

  const handleSelectTask = (task: Event) => {
    setSelected(task);
    setSheetOpen(true);
  };

  const handleTaskUpdated = (updated: Event) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const pushToGoogle = async ({
    title,
    when,
  }: {
    title: string;
    when: Date;
  }) => {
    const end = new Date(when.getTime() + 30 * 60_000);
    const res = await fetch("/api/calendar/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: title,
        start: when.toISOString(),
        end: end.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error ?? `HTTP ${res.status}`);
    }
    const body = (await res.json()) as { event: GoogleCalendarEvent };
    setGoogleEvents((prev) => [...prev, body.event]);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading calendar...
      </div>
    );
  }

  if (!status?.connected && googleEvents.length === 0) {
    return (
      <div className="mx-auto mt-10 max-w-lg rounded-2xl border bg-white p-8 text-center shadow-sm">
        <CalendarCheck className="mx-auto h-10 w-10 text-indigo-500" />
        <h1 className="mt-4 text-xl font-semibold">
          Connect your Google Calendar
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          See the next 7 days of events alongside your tasks. Click any empty
          slot to drop a todo onto your calendar.
        </p>
        <a
          href="/api/auth/google"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
        >
          Connect Google Calendar
        </a>
        {status?.error && (
          <div className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {status.error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-slate-500">
            Next 7 days — Google events + scheduled tasks. Click an empty slot
            to add a todo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status?.connected ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              Connected as {status.email}
            </span>
          ) : (
            <a
              href="/api/auth/google"
              className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
            >
              Connect Google Calendar
            </a>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <a
            href="/api/auth/google"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            title="Re-authorize (replaces tokens)"
          >
            <Unlink className="h-3.5 w-3.5" />
            Reconnect
          </a>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      <CalendarWeekView
        googleEvents={googleEvents}
        tasks={tasks}
        onCreateTask={handleCreateTask}
        onSelectTask={handleSelectTask}
      />

      {quickCreate && (
        <QuickCreateTaskModal
          when={quickCreate}
          onClose={() => setQuickCreate(null)}
          onCreated={handleTaskCreated}
          onPushToGoogle={pushToGoogle}
        />
      )}

      <TaskSheet
        event={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onUpdated={handleTaskUpdated}
      />
    </div>
  );
}
