// Port: an AI coding agent tako can open (Claude Code, Codex CLI...).
//
// Each agent declares the models it accepts, so the start picker works the
// same for every agent. Launching with the task context (`buildLaunch`)
// arrives with the StartTask issue, after the Ink + agent spike settles how
// to spawn it.

export interface AgentModel {
  id: string; // passed to the agent as is, e.g. "opus"
  label: string; // shown to the user, e.g. "Opus"
}

export interface AgentAdapter {
  id: string; // stored in the config, e.g. "claude-code"
  displayName: string; // shown to the user, e.g. "Claude Code"
  // Choices offered when starting a task. Not choosing one keeps the
  // agent's own default model.
  models: readonly AgentModel[];
  isInstalled(): Promise<boolean>;
}
