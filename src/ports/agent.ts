// Port: an AI coding agent tako can open (Claude Code, Codex CLI...).
//
// Each agent declares the models it accepts, so the start picker works the
// same for every agent. A task runs as a background session: tako starts it,
// goes back to the board, and checks on it until it is done.

export interface AgentModel {
  id: string; // passed to the agent as is, e.g. "opus"
  label: string;
}

import type { AgentState } from "../domain/task.js";

export type { AgentState };

export interface AgentSession {
  id: string;
  state: AgentState;
}

export interface AgentAdapter {
  id: string;
  displayName: string;
  // Models offered in the start picker. The picker also offers "Default": the
  // agent's own default model.
  models: readonly AgentModel[];
  isInstalled(): Promise<boolean>;
  // Starts a background session in `cwd` with `prompt` as the first message.
  // Resolves with the session id as soon as it is running.
  start(options: LaunchOptions): Promise<string>;
  // The agent's background sessions, to follow the ones tako started.
  sessions(): Promise<AgentSession[]>;
  // Hands the terminal to a session, so the user can answer it. Resolves when
  // the user leaves it; the session keeps running.
  attach(sessionId: string): Promise<void>;
  // Stops a session; its conversation is kept by the agent.
  stop(sessionId: string): Promise<void>;
}

export interface LaunchOptions {
  cwd: string;
  model: string | undefined; // undefined = the agent's default
  prompt: string;
  name: string; // shown in the agent's own session list
}
