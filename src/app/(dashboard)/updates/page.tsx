"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Send } from "lucide-react";
import type { Project, UpdateHistory } from "@/types/database";

const statusColors: Record<string, string> = {
  draft: "bg-yellow-500/10 text-yellow-500",
  approved: "bg-blue-500/10 text-blue-500",
  sent: "bg-green-500/10 text-green-500",
  failed: "bg-red-500/10 text-red-500",
};

export default function UpdatesPage() {
  const [updates, setUpdates] = useState<UpdateHistory[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/updates").then((r) => r.json()),
    ])
      .then(([p, u]) => {
        setProjects(Array.isArray(p) ? p : []);
        setUpdates(Array.isArray(u) ? u : []);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleGenerate() {
    if (!selectedProject) return;
    setGenerating(true);

    try {
      const res = await fetch("/api/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: selectedProject }),
      });
      const data = await res.json();
      if (data.update) {
        setUpdates((prev) => [data.update, ...prev]);
      }
      setOpen(false);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Updates</h1>
          <p className="text-sm text-muted-foreground">
            AI-drafted stakeholder updates from your project events.
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Generate Update
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Generate Stakeholder Update</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Project</Label>
                <Select
                  value={selectedProject}
                  onValueChange={setSelectedProject}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects
                      .filter((p) => p.status === "active")
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleGenerate}
                disabled={!selectedProject || generating}
                className="w-full"
              >
                {generating ? (
                  "Generating..."
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Draft Update with Claude
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {updates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No updates yet. Generate one from a project with recent events.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {updates.map((update) => (
            <Card key={update.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">{update.title}</CardTitle>
                  <Badge
                    variant="secondary"
                    className={statusColors[update.status] ?? ""}
                  >
                    {update.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(update.created_at).toLocaleString()} &middot;{" "}
                  {update.event_ids.length} events summarized
                </p>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm">
                  {update.body}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
