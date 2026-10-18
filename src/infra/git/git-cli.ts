// GitPort with the git CLI: where a folder's repository starts, which GitHub
// repository its `origin` points to, the tasks' worktrees, and pushing a
// finished task's branch.

import { execa } from "execa";
import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { repoFromRemoteUrl, WORKTREES_DIR } from "../../domain/task.js";
import type { GitPort, LocalRepo } from "../../ports/git.js";

export class GitCli implements GitPort {
  async inspect(dir: string): Promise<LocalRepo | undefined> {
    const top = await git(dir, ["rev-parse", "--show-toplevel"]);
    // Not a git repository, a missing folder, or git not installed.
    if (top === undefined) return undefined;

    const origin = await git(dir, ["remote", "get-url", "origin"]);
    // git prints forward slashes on Windows too; resolve() gives native ones.
    return { root: resolve(top), repo: origin === undefined ? undefined : repoFromRemoteUrl(origin) };
  }

  async commitsAhead(root: string, base: string, branch: string): Promise<number | undefined> {
    if ((await git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) === undefined) return undefined;
    // The base may exist only as a remote branch in this clone.
    for (const from of [base, `origin/${base}`]) {
      const count = await git(root, ["rev-list", "--count", `${from}..refs/heads/${branch}`]);
      if (count !== undefined) return Number(count);
    }
    throw new Error(`Branch ${base} was not found in ${root}.`);
  }

  async push(root: string, branch: string): Promise<void> {
    await gitOrThrow(root, ["push", "-u", "origin", branch], "git push failed");
  }

  async addWorktree(root: string, path: string, branch: string, base: string): Promise<void> {
    // Started again: the worktree is still there, on its branch.
    if ((await git(path, ["rev-parse", "--abbrev-ref", "HEAD"])) === branch) return;
    await ignoreWorktrees(root);

    if ((await git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) !== undefined) {
      await gitOrThrow(root, ["worktree", "add", path, branch], "git worktree add failed");
      return;
    }
    // Start from what is on GitHub when it can be fetched, else the local base.
    await git(root, ["fetch", "origin", base]);
    const from = (await git(root, ["rev-parse", "--verify", "--quiet", `origin/${base}`])) !== undefined ? `origin/${base}` : base;
    await gitOrThrow(root, ["worktree", "add", "--no-track", "-b", branch, path, from], "git worktree add failed");
  }

  async removeWorktree(root: string, path: string): Promise<void> {
    // Work done before worktrees, or removed by hand: nothing to remove.
    if (!existsSync(path)) return;
    await gitOrThrow(root, ["worktree", "remove", path], "git worktree remove failed");
  }
}

async function gitOrThrow(dir: string, args: string[], what: string): Promise<void> {
  const result = await execa("git", ["-C", dir, ...args], { reject: false });
  if (result.exitCode !== 0) throw new Error(`${what}: ${result.stderr.trim() || `exit code ${result.exitCode}`}`);
}

// The worktrees live inside the repository: hide them from `git status`
// through .git/info/exclude, which is local and never committed.
async function ignoreWorktrees(root: string): Promise<void> {
  const exclude = await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"]);
  if (!exclude) return;
  const line = `/${WORKTREES_DIR}/`;
  const current = await readFile(exclude, "utf8").catch(() => "");
  if (current.split(/\r?\n/).includes(line)) return;
  await appendFile(exclude, `${current && !current.endsWith("\n") ? "\n" : ""}${line}\n`);
}

// stdout of a successful git command, undefined when it fails.
async function git(dir: string, args: string[]): Promise<string | undefined> {
  const result = await execa("git", ["-C", dir, ...args], { reject: false });
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}
