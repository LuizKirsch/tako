// Starting a task: which repository a card belongs to, the branch to work
// on, and the first message the agent receives.
//
// This module is pure: no I/O, only text and rules.

import type { Card, Comment } from "./board.js";

// "owner/name" of a GitHub remote URL, lowercased so it can be compared with
// the repository of a card. Undefined for anything that is not GitHub.
//   https://github.com/owner/name(.git)   git@github.com:owner/name(.git)
//   ssh://git@github.com/owner/name(.git)
export function repoFromRemoteUrl(url: string): string | undefined {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}

export function sameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// Each task works in its own git worktree, inside the repository so it
// inherits Claude Code's folder trust (checked with a real run):
// <root>/.tako/worktrees/<number>-<title>. The user's checkout is never touched.
export const WORKTREES_DIR = ".tako/worktrees";

export function worktreeDir(branch: string): string {
  return `${WORKTREES_DIR}/${branch.replace(/^tako\//, "")}`;
}

// tako/<number>-<title in kebab case>, e.g. tako/3-fix-the-login-page.
// Accents are dropped and the slug is cut at 40 characters.
export function branchName(card: Card): string {
  const slug = card.title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `tako/${card.number ?? "draft"}${slug ? `-${slug}` : ""}`;
}

// What a background agent session is doing, as far as tako cares.
export type AgentState = "working" | "needs_input" | "done" | "failed";

// A task tako started and follows until it is delivered: which card, on
// which project, in which agent session, and where the work lands.
export interface RunningTask {
  itemId: string;
  projectId: string;
  agentId: string;
  sessionId: string;
  repo: string; // "owner/name"
  root: string; // where the repository is cloned
  worktree: string; // the task's own folder, removed once delivered
  branch: string; // checked out in the worktree
  number?: number;
  title: string;
  error?: string; // why the last delivery failed
}

// What the board shows on a followed card.
export interface TaskStatus {
  state: AgentState;
  error?: string;
}

export interface TaskPromptInput {
  card: Card;
  comments: Comment[];
  baseBranch: string;
  rulesFile: string; // absolute: it may exist only in the user's checkout
}

// Where repositories usually write instructions for AI agents and their
// commit convention. The agent is told to look there: tako cannot rely on
// every agent loading every other tool's files by itself.
export const REPO_CONVENTION_SOURCES = [
  "CLAUDE.md",
  "AGENTS.md",
  ".claude/",
  ".agents/",
  ".cursor/rules",
  ".github/copilot-instructions.md",
  "CONTRIBUTING.md",
  "commitlint config",
];

// The first message the agent receives: the workflow tako expects, then the
// issue itself. The workflow comes first so it is never lost after a long
// description. The repository's own conventions win over tako's defaults.
export function buildTaskPrompt({ card, comments, baseBranch, rulesFile }: TaskPromptInput): string {
  const ref = `#${card.number ?? "?"}`;
  const lines = [
    `Work on GitHub issue ${ref} in ${card.repo ?? "this repository"}: ${card.title}`,
    ...(card.url ? [card.url] : []),
    "",
    "## How to work",
    `- You are in a git worktree made by tako for this task, on the branch \`${branchName(card)}\` (from \`${baseBranch}\`). Make every change and commit here, and do not switch branches.`,
    `- Follow the repository's own instructions first (${REPO_CONVENTION_SOURCES.map((s) => `\`${s}\``).join(", ")}). They win over everything here.`,
    `- Then follow the rules in \`${rulesFile}\`, where they do not conflict with the repository's.`,
    `- You make the commits. Use the repository's commit convention: take it from those instructions, or from \`git log\` when none is written. Reference the issue (${ref}) the way the convention does; with no convention, end the message with (${ref}).`,
    "- Do not push and do not open a pull request: tako handles the delivery.",
    "- You run in the background. If you need anything from me, ask with your question tool and wait for the answer. Never end your turn with a question: tako reads the end of your turn as the task being done.",
    "- When the work is done, commit it and end your turn.",
    "",
    "## Issue description",
    card.body.trim() || "(no description)",
  ];

  if (comments.length > 0) {
    lines.push("", `## Comments (${comments.length})`);
    for (const comment of comments) {
      lines.push("", `### @${comment.author} · ${comment.createdAt.slice(0, 10)}`, comment.body.trim());
    }
  }
  return lines.join("\n") + "\n";
}
