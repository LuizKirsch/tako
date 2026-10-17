// Runs the `gh` CLI. Isolated behind a function type so the GitHub adapter
// can be tested with canned outputs instead of a real `gh` and network.

import { execa } from "execa";
import { GitHubError } from "../../ports/github.js";

export interface GhResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type GhRunner = (args: string[]) => Promise<GhResult>;

// Runs gh attached to the user's terminal (for prompts and the browser flow)
// and resolves with its exit code.
export type InteractiveGhRunner = (args: string[]) => Promise<number>;

export const execaGhRunner: GhRunner = async (args) => {
  try {
    const result = await execa("gh", args);
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    // Spawn failure: the executable is not on PATH.
    if (isNotFound(error)) throw ghNotInstalled();
    // Non-zero exit: hand the output back; the adapter decides what it means.
    // `gh api` may exit non-zero and still print a JSON body with partial data.
    const failed = error as { exitCode?: number; stdout?: unknown; stderr?: unknown };
    return {
      exitCode: failed.exitCode ?? 1,
      stdout: String(failed.stdout ?? ""),
      stderr: String(failed.stderr ?? ""),
    };
  }
};

export const execaGhInteractive: InteractiveGhRunner = async (args) => {
  try {
    await execa("gh", args, { stdio: "inherit" });
    return 0;
  } catch (error) {
    if (isNotFound(error)) throw ghNotInstalled();
    return (error as { exitCode?: number }).exitCode ?? 1;
  }
};

function isNotFound(error: unknown): boolean {
  return (error as { code?: string }).code === "ENOENT";
}

function ghNotInstalled(): GitHubError {
  return new GitHubError(
    "gh_not_installed",
    "GitHub CLI (gh) was not found. Install it from https://cli.github.com and run `gh auth login`.",
  );
}
