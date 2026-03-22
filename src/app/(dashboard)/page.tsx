"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FolderKanban,
  Activity,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type { Project, Event } from "@/types/database";

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/events?limit=10").then((r) => r.json()),
    ])
      .then(([p, e]) => {
        setProjects(Array.isArray(p) ? p : []);
        setEvents(Array.isArray(e) ? e : []);
      })
      .finally(() => setLoading(false));
  }, []);

  const activeProjects = projects.filter((p) => p.status === "active");
  const blockers = events.filter((e) => e.category === "blocker");
  const todayEvents = events.filter((e) => {
    if (!e.created_at) return false;
    return new Date(e.created_at).toDateString() === new Date().toDateString();
  });

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
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Your project intelligence at a glance.
        </p>
      </div>

      {/* Stats row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Projects"
          value={activeProjects.length}
          icon={<FolderKanban className="h-4 w-4 text-primary" />}
        />
        <StatCard
          title="Events Today"
          value={todayEvents.length}
          icon={<Activity className="h-4 w-4 text-blue-500" />}
        />
        <StatCard
          title="Blockers"
          value={blockers.length}
          icon={<AlertTriangle className="h-4 w-4 text-orange-500" />}
        />
        <StatCard
          title="Total Events"
          value={events.length}
          icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
        />
      </div>

      {/* Recent events */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Events</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No events yet. Send a webhook or record a voice note to get
              started.
            </p>
          ) : (
            <div className="space-y-3">
              {events.slice(0, 8).map((event) => (
                <div
                  key={event.id}
                  className="flex items-start justify-between rounded-md border p-3"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {event.title}
                    </p>
                    {event.body && (
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {event.body}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {event.category && (
                      <Badge variant="secondary" className="text-xs">
                        {event.category}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                      {event.source}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between pt-6">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        {icon}
      </CardContent>
    </Card>
  );
}
