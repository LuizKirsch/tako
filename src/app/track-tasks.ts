// Use case: follow the tasks running in the background, and deliver them.
//
//   syncTasks()   -> asks each agent how its sessions are doing. A finished
//                    session is delivered: its branch is pushed, a pull
//                    request is opened, the card moves to the delivery
//                    column, and the session and its worktree are cleaned
//                    up; then it is no longer followed. A session that
//                    disappeared (removed by the user) is dropped.
//   attachTask()  -> hands the terminal to a card's session, to answer it.
//   findPullRequest() / deliverCard()
//                 -> the card details: the pull request of a card's branch,
//                    and delivering it by hand when it was not delivered
//                    automatically (a failed or older task).
//
// The board calls syncTasks every few seconds.
//
// A failed delivery (no commits, push refused...) keeps the task with its
// error and is not retried while the session stays finished: it would fail
// the same way every few seconds. Once the agent works again (the user
// attached and asked for a fix), the error is cleared and the next finish
// delivers again. Every step is safe to run twice.
//
// A project workflow can move the card right after tako does (e.g.
// "Pull request linked to issue", which reacts to the new pull request), so
// the card is checked for a few seconds after the move and moved back.

import type { Card } from "../domain/board.js";
import { repoPath, type ProjectConfig } from "../domain/config.js";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { branchName, worktreeDir, type RunningTask, type TaskStatus } from "../domain/task.js";
import type { AgentAdapter, AgentSession } from "../ports/agent.js";
import type { Files } from "../ports/files.js";
import type { GitPort } from "../ports/git.js";
import type { CardMove, GitHubPort, PullRequestInfo } from "../ports/github.js";
import { loadConfig } from "./config-file.js";
import { loadTasks, saveTasks } from "./task-store.js";

export interface TrackDeps {
  files: Files; // rooted at the tako config directory
  github: GitHubPort;
  git: GitPort;
  agents: readonly AgentAdapter[];
  sleep?: (ms: number) => Promise<void>; // tests skip the waits
}

export interface SyncResult {
  states: Record<string, TaskStatus>; // by card (itemId), for the cards still followed
  delivered: Delivery[]; // opened now: the board must reload
}

export interface Delivery {
  url: string; // the pull request
  leftover?: string; // why the worktree could not be removed, if it could not
}

export async function syncTasks(deps: TrackDeps): Promise<SyncResult> {
  const tasks = await loadTasks(deps.files);
  const result: SyncResult = { states: {}, delivered: [] };
  if (tasks.length === 0) return result;

  const sessions = new Map<string, AgentSession[] | undefined>();
  for (const agentId of new Set(tasks.map((t) => t.agentId))) {
    const agent = deps.agents.find((a) => a.id === agentId);
    // An agent that cannot answer now keeps its tasks as they are.
    sessions.set(agentId, await agent?.sessions().catch(() => undefined));
  }
  const loaded = await loadConfig(deps.files);
  const projects = loaded.status === "ok" ? loaded.config.projects : [];

  const kept: RunningTask[] = [];
  let changed = false;
  for (let task of tasks) {
    const list = sessions.get(task.agentId);
    const session = list?.find((s) => s.id === task.sessionId);
    if (list && !session) {
      changed = true;
      continue;
    }
    const state = session?.state ?? "working";

    if (state !== "done" && task.error) {
      task = { ...task, error: undefined };
      changed = true;
    }
    if (state === "done" && !task.error) {
      changed = true;
      try {
        const project = projects.find((p) => p.project.id === task.projectId);
        result.delivered.push(await deliver(deps, task, project));
        continue;
      } catch (error) {
        task = { ...task, error: error instanceof Error ? error.message : String(error) };
      }
    }
    kept.push(task);
    result.states[task.itemId] = task.error ? { state, error: task.error } : { state };
  }

  if (changed) await saveTasks(deps.files, kept);
  return result;
}

// Push, pull request, then the card: in that order, so the card only moves
// once the work is on GitHub. Then the session and the worktree go away.
async function deliver(deps: TrackDeps, task: RunningTask, project: ProjectConfig | undefined): Promise<Delivery> {
  if (!project) throw new Error("Its project was removed from tako.");
  const base = project.baseBranch;

  const ahead = await deps.git.commitsAhead(task.root, base, task.branch);
  if (ahead === undefined) throw new Error(`The agent did not create the branch ${task.branch}.`);
  if (ahead === 0) throw new Error(`The branch ${task.branch} has no commits ahead of ${base}.`);

  await deps.git.push(task.root, task.branch);
  const closes = task.number === undefined ? "" : `Closes #${task.number}\n\n`;
  const url = await deps.github.openPullRequest({
    repo: task.repo,
    base,
    head: task.branch,
    title: task.title,
    body: `${closes}Opened by tako after an AI agent worked on this task. Review it before merging.\n`,
  });

  const delivery = project.roles.delivery;
  if (delivery) {
    await keepInColumn(deps, {
      projectId: task.projectId,
      itemId: task.itemId,
      fieldId: project.columnField.id,
      optionId: delivery.optionId,
    });
  }
  return { url, leftover: await cleanUp(deps, task) };
}

// GitHub runs project workflows about a second after the pull request opens
// (seen on a real board). ponytail: a fixed ~10 s window and a full
// listCards per check; read the single item if boards get big.
const RECHECKS = 5;
const RECHECK_EVERY_MS = 2000;

async function keepInColumn(deps: TrackDeps, move: CardMove): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => setTimeout(ms));
  await deps.github.moveCard(move);
  for (let i = 0; i < RECHECKS; i++) {
    await sleep(RECHECK_EVERY_MS);
    const card = (await deps.github.listCards(move.projectId, move.fieldId)).find((c) => c.itemId === move.itemId);
    // A card that is gone (archived, deleted) has nowhere to go back to.
    if (card && card.optionId !== move.optionId) await deps.github.moveCard(move);
  }
}

// Best effort: the work is already on GitHub. The session is stopped first,
// so nothing keeps the worktree folder open (Windows refuses to delete an
// open folder). git refuses to remove a worktree with uncommitted changes,
// and that is kept on purpose: the leftover is reported, never deleted.
async function cleanUp(deps: TrackDeps, task: RunningTask): Promise<string | undefined> {
  const agent = deps.agents.find((a) => a.id === task.agentId);
  if (agent && task.sessionId) await agent.stop(task.sessionId).catch(() => undefined);
  try {
    await deps.git.removeWorktree(task.root, task.worktree);
    return undefined;
  } catch (error) {
    return `${task.worktree} was kept: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function attachTask(deps: TrackDeps, itemId: string): Promise<void> {
  const task = (await loadTasks(deps.files)).find((t) => t.itemId === itemId);
  const agent = deps.agents.find((a) => a.id === task?.agentId);
  if (task && agent) await agent.attach(task.sessionId);
}

export async function findPullRequest(deps: TrackDeps, card: Card): Promise<PullRequestInfo | undefined> {
  return card.repo ? deps.github.findPullRequest(card.repo, branchName(card)) : undefined;
}

// Delivers a card's branch like a finished task, and stops following the
// card's task if there was one. Resolves with the pull request URL.
export async function deliverCard(deps: TrackDeps, card: Card, project: ProjectConfig): Promise<Delivery> {
  if (!card.repo) throw new Error("Drafts have no repository.");
  const loaded = await loadConfig(deps.files);
  const root = loaded.status === "ok" ? repoPath(loaded.config, card.repo) : undefined;
  if (!root) throw new Error(`tako does not know where ${card.repo} is cloned yet: start a task from it first.`);

  const tasks = await loadTasks(deps.files);
  const branch = branchName(card);
  // A followed task knows its session; otherwise there is none to stop.
  const task: RunningTask = tasks.find((t) => t.itemId === card.itemId) ?? {
    itemId: card.itemId,
    projectId: project.project.id,
    agentId: "",
    sessionId: "",
    repo: card.repo,
    root,
    worktree: join(root, worktreeDir(branch)),
    branch,
    number: card.number,
    title: card.title,
  };
  const delivered = await deliver(deps, task, project);
  const kept = tasks.filter((t) => t.itemId !== card.itemId);
  if (kept.length !== tasks.length) await saveTasks(deps.files, kept);
  return delivered;
}
