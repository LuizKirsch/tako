// The agents that are actually installed on this machine, in registry order.
// Shared by init (to pick the default) and the board (to start a task).

import type { AgentAdapter } from "../ports/agent.js";

export async function installedAgents(agents: readonly AgentAdapter[]): Promise<AgentAdapter[]> {
  const checks = await Promise.all(agents.map(async (a) => ((await a.isInstalled()) ? a : undefined)));
  return checks.filter((a): a is AgentAdapter => a !== undefined);
}
