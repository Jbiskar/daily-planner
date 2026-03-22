"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Event, EventCategory, EventSource } from "@/types/database";

const categoryColors: Record<EventCategory, string> = {
  meeting: "bg-blue-500/10 text-blue-500",
  task: "bg-green-500/10 text-green-500",
  decision: "bg-purple-500/10 text-purple-500",
  blocker: "bg-red-500/10 text-red-500",
  update: "bg-cyan-500/10 text-cyan-500",
  idea: "bg-yellow-500/10 text-yellow-500",
  followup: "bg-orange-500/10 text-orange-500",
  note: "bg-muted text-muted-foreground",
};

const sourceIcons: Record<EventSource, string> = {
  notion: "N",
  slack: "S",
  google_calendar: "G",
  granola: "Gr",
  voice_note: "V",
  manual: "M",
};

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetch("/api/events?limit=100")
      .then((r) => r.json())
      .then((data) => setEvents(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

  const filtered =
    filter === "all" ? events : events.filter((e) => e.source === filter);

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
        <h1 className="text-2xl font-bold tracking-tight">Events</h1>
        <p className="text-sm text-muted-foreground">
          All ingested events, classified by Claude.
        </p>
      </div>

      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="notion">Notion</TabsTrigger>
          <TabsTrigger value="slack">Slack</TabsTrigger>
          <TabsTrigger value="google_calendar">Calendar</TabsTrigger>
          <TabsTrigger value="granola">Granola</TabsTrigger>
          <TabsTrigger value="voice_note">Voice</TabsTrigger>
        </TabsList>

        <TabsContent value={filter} className="mt-4">
          {filtered.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No events yet. Send a webhook to{" "}
                <code className="text-xs">/api/webhooks/*</code> or record a
                voice note at <code className="text-xs">/api/voice</code>.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filtered.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EventCard({ event }: { event: Event }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-xs font-bold">
              {sourceIcons[event.source] ?? "?"}
            </div>
            <div>
              <CardTitle className="text-sm">{event.title}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {new Date(event.created_at).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {event.category && (
              <Badge
                variant="secondary"
                className={categoryColors[event.category] ?? ""}
              >
                {event.category}
              </Badge>
            )}
            {event.classification_confidence != null && (
              <span className="text-xs text-muted-foreground">
                {Math.round(event.classification_confidence * 100)}%
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      {event.body && (
        <CardContent>
          <p className="text-sm text-muted-foreground line-clamp-3">
            {event.body}
          </p>
        </CardContent>
      )}
    </Card>
  );
}
