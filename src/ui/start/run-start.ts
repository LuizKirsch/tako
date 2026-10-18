// Starting a task, after the board's picker: runs on the normal screen,
// between two board sessions. Finds (or asks for) the repository's folder,
// then starts the agent in the background and goes back to the board.
//
// All decisions live in the StartTask use case; this file only asks,
// shows progress and explains failures.

import * as p from "@clack/prompts";
import { homedir } from "node:os";
import type { StartRequest, StartTask } from "../../app/start-task.js";
import { RULES_FILE } from "../../templates/recommended-rules.js";
import type { AgentChoice } from "../board/StartPicker.js";

export async function runStart(start: StartTask, request: StartRequest, agents: readonly AgentChoice[]): Promise<void> {
  const { card } = request;
  // The board only starts cards that have a repository.
  const repo = card.repo!;
  p.intro(`tako · start #${card.number ?? "?"} ${card.title}`);

  try {
    const root = await start.findRepo(repo) ?? (await askForRepo(start, repo));
    if (!root) {
      p.cancel("Start cancelled. Back to the board.");
      return;
    }
    p.log.info(`Repository: ${root}`);

    if (await start.prepareRepo(root)) {
      p.log.info(`Created ${RULES_FILE} with suggested rules for the agent. Edit and commit it when you like.`);
    }

    try {
      p.log.info(`Moved to "${await start.moveToInProgress(request)}".`);
    } catch (error) {
      // The work can still happen; the card is moved by hand later.
      p.log.warn(`Could not move the card: ${error instanceof Error ? error.message : String(error)}`);
    }

    const agent = agents.find((a) => a.id === request.agentId);
    const model = agent?.models.find((m) => m.id === request.model)?.label ?? "default model";
    const worktree = await start.launch(request, root);
    p.log.info(`Worktree: ${worktree} (branch of its own; your checkout is not touched)`);
    p.outro(`${agent?.displayName ?? request.agentId} (${model}) is working in the background. Press a on the card to follow it.`);
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : String(error));
    // Keep the message on screen: the board takes the whole terminal again.
    await p.text({ message: "Press Enter to go back to the board" });
  }
}

// Asks until the folder is the right repository. Undefined when cancelled.
async function askForRepo(start: StartTask, repo: string): Promise<string | undefined> {
  p.log.warn(`tako does not know where ${repo} is on this computer yet.`);
  for (;;) {
    const answer = await p.text({
      message: `Folder where ${repo} is cloned`,
      placeholder: process.platform === "win32" ? "C:\\path\\to\\repo" : "~/path/to/repo",
      validate: (value) => (value?.trim() ? undefined : "Type a folder, or press Esc to cancel"),
    });
    if (p.isCancel(answer)) return undefined;

    const dir = expandHome(answer.trim());
    const result = await start.useRepoAt(repo, dir);
    if (result.ok) {
      p.log.success(`Remembered: ${repo} → ${result.root}`);
      return result.root;
    }
    p.log.error(
      result.reason === "not_a_repo"
        ? `${dir} is not a git repository.`
        : `That folder is ${result.found ?? "not a GitHub repository"}, not ${repo}.`,
    );
  }
}

// The shell expands "~", but a typed answer does not go through a shell.
function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") || path.startsWith("~\\") ? homedir() + path.slice(1) : path;
}
