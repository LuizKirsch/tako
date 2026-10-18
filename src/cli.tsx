// Entry point and composition root.
//
// This is the only place where concrete implementations (infra) are wired
// into the use cases. Everything below receives its dependencies, which is
// what lets the use cases be tested with fakes.

import { join } from "node:path";
import { InitProject } from "./app/init-project.js";
import { loadBoard, loadComments } from "./app/load-board.js";
import { CONFIG_FILE } from "./domain/config.js";
import { AGENTS } from "./infra/agents/registry.js";
import { configDir } from "./infra/fs/config-dir.js";
import { NodeFiles } from "./infra/fs/node-files.js";
import { GhCliGitHub } from "./infra/github/gh-cli-github.js";
import { runBoard } from "./ui/board/run-board.js";
import { runInitWizard } from "./ui/init/run-init-wizard.js";

const USAGE = `Usage:
  tako init    add a GitHub Project to tako
  tako         open the board of the last project used`;

// The config lives outside any repository, so tako works from any folder.
const dir = configDir();
const configPath = join(dir, CONFIG_FILE);
const deps = { github: new GhCliGitHub(), files: new NodeFiles(dir), agents: AGENTS };

const [command] = process.argv.slice(2);

switch (command) {
  case "init": {
    process.exitCode = await runInitWizard(new InitProject(deps), configPath);
    break;
  }
  case undefined: {
    process.exitCode = await runBoard({
      load: (projectId) => loadBoard(deps, projectId),
      loadComments: (card) => loadComments(deps.github, card),
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
