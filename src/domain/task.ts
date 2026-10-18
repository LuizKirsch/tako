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

export interface TaskPromptInput {
  card: Card;
  comments: Comment[];
  baseBranch: string;
  rulesFile: string; // relative to the repository root
}

// The first message the agent receives: the workflow tako expects, then the
// issue itself. The workflow comes first so it is never lost after a long
// description.
export function buildTaskPrompt({ card, comments, baseBranch, rulesFile }: TaskPromptInput): string {
  const ref = `#${card.number ?? "?"}`;
  const lines = [
    `Work on GitHub issue ${ref} in ${card.repo ?? "this repository"}: ${card.title}`,
    ...(card.url ? [card.url] : []),
    "",
    "## How to work",
    `- Before changing anything, create the branch \`${branchName(card)}\` from \`${baseBranch}\` and switch to it (if it already exists, just switch to it). Make every change there.`,
    `- Follow the rules in \`${rulesFile}\`.`,
    `- Reference the issue in every commit message (${ref}).`,
    "- Do not push and do not open a pull request: tako handles the delivery.",
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
