// GitPort with the git CLI. Read-only: it only asks git where a folder's
// repository starts and which GitHub repository its `origin` points to.

import { execa } from "execa";
import { resolve } from "node:path";
import { repoFromRemoteUrl } from "../../domain/task.js";
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
}

// stdout of a successful git command, undefined when it fails.
async function git(dir: string, args: string[]): Promise<string | undefined> {
  const result = await execa("git", ["-C", dir, ...args], { reject: false });
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}
