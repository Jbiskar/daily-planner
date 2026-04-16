"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  Event,
  Workspace,
  TaskPriority,
  TaskStatus,
} from "@/types/database";

interface TaskSheetProps {
  event: Event | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (event: Event) => void;
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function TaskSheet({ event, open, onOpenChange, onUpdated }: TaskSheetProps) {
  const [title, setTitle] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | "">("");
  const [priority, setPriority] = useState<TaskPriority | "">("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!event) return;
    setTitle(event.title ?? "");
    setWorkspace(event.workspace ?? "");
    setPriority(event.priority ?? "");
    setDueDate(toLocalInputValue(event.due_date));
    setNotes(event.notes ?? "");
    setLinks(event.links ?? []);
    setError(null);
  }, [event]);

  if (!event) return null;

  const patch = async (extra: Partial<Record<string, unknown>> = {}) => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        title,
        workspace: workspace === "" ? null : workspace,
        priority: priority === "" ? null : priority,
        due_date: fromLocalInputValue(dueDate),
        notes: notes === "" ? null : notes,
        links,
        ...extra,
      };
      const res = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `PATCH failed: ${res.status}`);
      }
      const updated: Event = await res.json();
      onUpdated(updated);
      return updated;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const updated = await patch();
    if (updated) onOpenChange(false);
  };

  const handleConfirm = async () => {
    const updated = await patch({ task_status: "active" });
    if (updated) onOpenChange(false);
  };

  const handleDismiss = async () => {
    const updated = await patch({ task_status: "dismissed" });
    if (updated) onOpenChange(false);
  };

  const handleMarkDone = async () => {
    const updated = await patch({ task_status: "done" });
    if (updated) onOpenChange(false);
  };

  const handleReopen = async () => {
    const updated = await patch({ task_status: "active" });
    if (updated) onOpenChange(false);
  };

  const updateLink = (i: number, value: string) => {
    setLinks((prev) => prev.map((l, idx) => (idx === i ? value : l)));
  };
  const removeLink = (i: number) => {
    setLinks((prev) => prev.filter((_, idx) => idx !== i));
  };
  const addLink = () => {
    setLinks((prev) => [...prev, ""]);
  };

  const status = event.task_status;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Edit task</SheetTitle>
          <SheetDescription>
            Tweak any auto-filled fields, then confirm or save.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Workspace</Label>
              <Select
                value={workspace === "" ? "__unset__" : workspace}
                onValueChange={(v) =>
                  setWorkspace(v === "__unset__" ? "" : (v as Workspace))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unset" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset__">Unset</SelectItem>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="atlan">Atlan</SelectItem>
                  <SelectItem value="landit">Landit</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={priority === "" ? "__unset__" : priority}
                onValueChange={(v) =>
                  setPriority(v === "__unset__" ? "" : (v as TaskPriority))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unset" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset__">Unset</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-due">Due date</Label>
            <Input
              id="task-due"
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-notes">Notes</Label>
            <Textarea
              id="task-notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Links</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addLink}
              >
                <Plus className="mr-1 h-3 w-3" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {links.length === 0 && (
                <p className="text-xs text-muted-foreground">No links yet.</p>
              )}
              {links.map((link, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={link}
                    placeholder="https://…"
                    onChange={(e) => updateLink(i, e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLink(i)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <SheetFooter className="mt-6 gap-2">
          {status === "inbox" && (
            <>
              <Button
                variant="outline"
                onClick={handleDismiss}
                disabled={saving}
              >
                Dismiss
              </Button>
              <Button variant="outline" onClick={handleSave} disabled={saving}>
                Save
              </Button>
              <Button onClick={handleConfirm} disabled={saving}>
                Confirm
              </Button>
            </>
          )}
          {status === "active" && (
            <>
              <Button variant="outline" onClick={handleSave} disabled={saving}>
                Save
              </Button>
              <Button onClick={handleMarkDone} disabled={saving}>
                Mark Done
              </Button>
            </>
          )}
          {status === "done" && (
            <Button onClick={handleReopen} disabled={saving}>
              Reopen
            </Button>
          )}
          {status === "dismissed" && (
            <Button onClick={handleReopen} disabled={saving}>
              Reopen
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
