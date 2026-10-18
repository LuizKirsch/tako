// Adapter for Claude Code (https://docs.claude.com/en/docs/claude-code).
// Detection runs `claude --version`: if the binary starts, it is installed.
// Launch runs `claude [--model <model>] <prompt>`, which `claude --help`
// (2.1.302) documents as an interactive session with a first prompt.

import { execa } from "execa";
import type { AgentAdapter, LaunchOptions } from "../../ports/agent.js";

export const claudeCode: AgentAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  // Aliases documented by `claude --help` (2.1.302) for `--model`; each one
  // points to the latest model of that family.
  models: [
    { id: "fable", label: "Fable" },
    { id: "opus", label: "Opus" },
    { id: "sonnet", label: "Sonnet" },
  ],
  async isInstalled() {
    try {
      await execa("claude", ["--version"]);
      return true;
    } catch {
      // Not on PATH (ENOENT) or failed to run: treat both as "not available".
      return false;
    }
  },
  async launch(options) {
    // The terminal belongs to Claude Code until the user closes it.
    // ponytail: the prompt goes as one argument. That is safe for the native
    // claude.exe, but an npm-installed claude.cmd on Windows passes through
    // cmd.exe, which mangles newlines; pass it through a file if that shows up.
    try {
      await execa("claude", claudeArgs(options), { cwd: options.cwd, stdio: "inherit" });
      return 0;
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") throw new Error("Claude Code (`claude`) was not found on PATH.");
      return (error as { exitCode?: number }).exitCode ?? 1;
    }
  },
};

export function claudeArgs({ model, prompt }: LaunchOptions): string[] {
  return [...(model ? ["--model", model] : []), prompt];
}
