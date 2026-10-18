// Entry point and composition root.
//
// This is the only place where concrete implementations (infra) are wired
// into the use cases. Everything below receives its dependencies, which is
// what lets the use cases be tested with fakes.

import { InitProject } from "./app/init-project.js";
import { loadBoard, loadComments } from "./app/load-board.js";
import { AGENTS } from "./infra/agents/registry.js";
import { NodeRepoFiles } from "./infra/fs/node-repo-files.js";
import { GhCliGitHub } from "./infra/github/gh-cli-github.js";
import { runBoard } from "./ui/board/run-board.js";
import { runInitWizard } from "./ui/init/run-init-wizard.js";

const USAGE = `Usage:
  tako init    configure tako for this repository
  tako         open the board`;

const [command] = process.argv.slice(2);

switch (command) {
  case "init": {
    const init = new InitProject({ github: new GhCliGitHub(), files: new NodeRepoFiles(), agents: AGENTS });
    process.exitCode = await runInitWizard(init);
    break;
  }
  case undefined: {
    const deps = { github: new GhCliGitHub(), files: new NodeRepoFiles(), agents: AGENTS };
    process.exitCode = await runBoard(
      () => loadBoard(deps),
      (card) => loadComments(deps.github, card),
    );
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
