// The tasks tako is following, saved next to the config (tasks.json) so they
// survive closing tako: reopening the board picks them up again.
//
// The file is tako's own bookkeeping, so a broken one is read as empty
// instead of blocking the board: at worst a card is moved by hand.

import type { RunningTask } from "../domain/task.js";
import type { Files } from "../ports/files.js";

export const TASKS_FILE = "tasks.json";

export async function loadTasks(files: Files): Promise<RunningTask[]> {
  try {
    const list: unknown = JSON.parse((await files.readText(TASKS_FILE)) ?? "[]");
    return Array.isArray(list) ? list.filter(isTask) : [];
  } catch {
    return [];
  }
}

export async function saveTasks(files: Files, tasks: RunningTask[]): Promise<void> {
  await files.writeText(TASKS_FILE, JSON.stringify(tasks, null, 2) + "\n");
}

function isTask(value: unknown): value is RunningTask {
  const t = value as Partial<RunningTask> | null;
  const required = ["itemId", "projectId", "agentId", "sessionId", "repo", "root", "worktree", "branch", "title"] as const;
  return required.every((k) => typeof t?.[k] === "string");
}
