// Entry point and composition root.
//
// This is the only place where concrete implementations (infra) are wired
// into the use cases. Everything below receives its dependencies, which is
// what lets the use cases be tested with fakes.

import { join } from "node:path";
import { InitProject } from "./app/init-project.js";
import { loadBoard, loadComments } from "./app/load-board.js";
import { StartTask } from "./app/start-task.js";
import { attachTask, deliverCard, findPullRequest, syncTasks } from "./app/track-tasks.js";
import { CONFIG_FILE } from "./domain/config.js";
import { AGENTS } from "./infra/agents/registry.js";
import { configDir } from "./infra/fs/config-dir.js";
import { NodeFiles } from "./infra/fs/node-files.js";
import { GitCli } from "./infra/git/git-cli.js";
import { GhCliGitHub } from "./infra/github/gh-cli-github.js";
import { runBoard } from "./ui/board/run-board.js";
import { runAddProject, runInitWizard } from "./ui/init/run-init-wizard.js";
import { runStart } from "./ui/start/run-start.js";

const USAGE = `Usage:
  tako init    add a GitHub Project to tako
  tako         open the board of the last project used`;

// The config lives outside any repository, so tako works from any folder.
const dir = configDir();
const configPath = join(dir, CONFIG_FILE);
const deps = { github: new GhCliGitHub(), files: new NodeFiles(dir), agents: AGENTS };
const git = new GitCli();

const [command] = process.argv.slice(2);

switch (command) {
  case "init": {
    process.exitCode = await runInitWizard(new InitProject(deps), configPath);
    break;
  }
  case undefined: {
    const start = new StartTask({
      ...deps,
      git,
      repoFiles: (root) => new NodeFiles(root),
      cwd: process.cwd(),
    });
    process.exitCode = await runBoard({
      start: (request, agents) => runStart(start, request, agents),
      load: (projectId) => loadBoard(deps, projectId),
      loadComments: (card) => loadComments(deps.github, card),
      addProject: () => runAddProject(new InitProject(deps), configPath),
      sync: () => syncTasks({ ...deps, git }),
      attach: (itemId) => attachTask({ ...deps, git }, itemId),
      findPullRequest: (card) => findPullRequest({ ...deps, git }, card),
      deliver: (card, project) => deliverCard({ ...deps, git }, card, project),
      configPath,
    });
    break;
  }
  case "-h":
  case "--help":
    console.log(USAGE);
    break;
  default:
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    process.exitCode = 1;
}
