// Adapter for Claude Code (https://docs.claude.com/en/docs/claude-code).
// Detection runs `claude --version`: if the binary starts, it is installed.
//
// Tasks run as Claude Code background sessions. Checked against
// `claude --help` and a real run (2.1.303):
//   claude --bg --name <name> [--model m] <prompt>
//                           prints "backgrounded · <id> · <name>" and returns
//   claude agents --json --all
//                           lists sessions; background ones have
//                           state working | blocked | done | failed
//                           ("blocked" = waiting for the user)
//   claude attach <id>      opens a session in this terminal
//   claude stop <id>        stops it, keeping the conversation
// `--bg` refuses a folder Claude Code was never opened in ("Workspace not
// trusted"); that message reaches the user as is.

import { execa } from "execa";
import type { AgentAdapter, AgentSession, AgentState, LaunchOptions } from "../../ports/agent.js";

export const claudeCode: AgentAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  // Aliases documented by `claude --help` (2.1.302) for `--model`; each one
  // points to the latest model of that family.
  // "main+helper" runs the main model with a cheaper helper subagent.
  models: [
    { id: "fable", label: "Fable" },
    { id: "opus", label: "Opus" },
    { id: "opus+haiku", label: "Opus + Haiku helpers" },
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
  async start(options) {
    // ponytail: the prompt goes as one argument. That is safe for the native
    // claude.exe, but an npm-installed claude.cmd on Windows passes through
    // cmd.exe, which mangles newlines; pass it through a file if that shows up.
    const result = await execa("claude", startArgs(options), { cwd: options.cwd, all: true, reject: false });
    const output = String(result.all ?? "");
    const id = sessionIdFrom(output);
    if (!id) throw new Error(output.trim() || `Claude Code exited with code ${result.exitCode}.`);
    return id;
  },
  async sessions() {
    const { stdout } = await execa("claude", ["agents", "--json", "--all"]);
    return parseSessions(stdout);
  },
  async attach(sessionId) {
    await execa("claude", ["attach", sessionId], { stdio: "inherit", reject: false });
  },
  async stop(sessionId) {
    await execa("claude", ["stop", sessionId], { reject: false });
  },
};

// Nobody watches a background session, so it runs in auto mode: Claude Code
// approves safe actions itself and stops to ask about risky ones.
export function startArgs({ model, prompt, name }: LaunchOptions): string[] {
  const [main, helper] = model?.split("+") ?? [];
  return [
    "--bg",
    "--name",
    name,
    "--permission-mode",
    "auto",
    ...(main ? ["--model", main] : []),
    ...(helper ? helperArgs(helper) : []),
    prompt,
  ];
}

// A "helper" subagent on a cheaper model, defined for this session only with
// --agents, and a system prompt line asking the main model to delegate to it.
// Checked with a real run (2.1.303): the subagent ran on the helper model and
// was billed as such. ponytail: delegating is the main model's call, so the
// saving depends on the task.
function helperArgs(model: string): string[] {
  const helper = {
    description: "Cheap helper for mechanical work: searching the code, reading files, running commands or tests and summarizing their output, repetitive edits.",
    prompt: "You are a helper of the main agent. Do exactly what is asked and report back briefly, with the facts the main agent needs.",
    model,
  };
  return [
    "--agents",
    JSON.stringify({ helper }),
    "--append-system-prompt",
    "To save cost, delegate mechanical work (searching the code, reading many files, running commands or tests and summarizing their output, repetitive edits) to the `helper` subagent. Keep planning, decisions and the final review yourself.",
  ];
}

export function sessionIdFrom(output: string): string | undefined {
  return /backgrounded\s*·\s*([0-9a-f]+)/i.exec(output)?.[1];
}

const STATES: Record<string, AgentState> = {
  working: "working",
  blocked: "needs_input",
  done: "done",
  failed: "failed",
};

// Unknown states (a newer Claude Code) are read as "working": tako keeps
// waiting instead of moving the card too early.
export function parseSessions(json: string): AgentSession[] {
  const list: unknown = JSON.parse(json);
  if (!Array.isArray(list)) return [];
  return list
    .filter((s): s is { id: string; kind: string; state?: string } => typeof s?.id === "string" && s.kind === "background")
    .map((s) => ({ id: s.id, state: STATES[s.state ?? ""] ?? "working" }));
}
