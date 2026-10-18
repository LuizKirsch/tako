// Port: an AI coding agent tako can open (Claude Code, Codex CLI...).
//
// Each agent declares the models it accepts, so the start picker works the
// same for every agent, and knows how to open itself on a task.

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
  // Opens an interactive session in `cwd`, attached to the user's terminal,
  // with `prompt` as the first message. Resolves with the agent's exit code
  // when the user closes it.
  launch(options: LaunchOptions): Promise<number>;
}

export interface LaunchOptions {
  cwd: string;
  model: string | undefined; // undefined = the agent's default
  prompt: string;
}
