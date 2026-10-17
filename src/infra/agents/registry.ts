// Every agent gh-relay supports. A new agent = a new adapter added here.
import type { AgentAdapter } from "../../ports/agent.js";
import { claudeCode } from "./claude-code.js";

export const AGENTS: readonly AgentAdapter[] = [claudeCode];
