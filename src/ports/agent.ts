// Port: an AI coding agent tako can open (Claude Code, Codex CLI...).
//
// Only detection exists for now, because `init` needs to know which agents
// are installed. Launching with the task context (`buildLaunch`) arrives with
// the StartTask issue, after the Ink + agent spike settles how to spawn it.

export interface AgentAdapter {
  id: string; // stored in the config, e.g. "claude-code"
  displayName: string; // shown to the user, e.g. "Claude Code"
  isInstalled(): Promise<boolean>;
}
