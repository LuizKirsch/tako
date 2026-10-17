// Adapter for Claude Code (https://docs.claude.com/en/docs/claude-code).
// Detection runs `claude --version`: if the binary starts, it is installed.

import { execa } from "execa";
import type { AgentAdapter } from "../../ports/agent.js";

export const claudeCode: AgentAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
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
