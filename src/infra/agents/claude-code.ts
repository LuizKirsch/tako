// Adapter for Claude Code (https://docs.claude.com/en/docs/claude-code).
// Detection runs `claude --version`: if the binary starts, it is installed.

import { execa } from "execa";
import type { AgentAdapter } from "../../ports/agent.js";

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
};
