// Entry point and composition root.
//
// This is the only place where concrete implementations (infra) are wired
// into the use cases. Everything below receives its dependencies, which is
// what lets the use cases be tested with fakes.

import { Box, render, Text } from "ink";
import { InitProject } from "./app/init-project.js";
import { AGENTS } from "./infra/agents/registry.js";
import { NodeRepoFiles } from "./infra/fs/node-repo-files.js";
import { GhCliGitHub } from "./infra/github/gh-cli-github.js";
import { runInitWizard } from "./ui/init/run-init-wizard.js";

const USAGE = `Usage:
  gh-relay init    configure gh-relay for this repository
  gh-relay         open the board (coming soon)`;

const [command] = process.argv.slice(2);

switch (command) {
  case "init": {
    const init = new InitProject({ github: new GhCliGitHub(), files: new NodeRepoFiles(), agents: AGENTS });
    process.exitCode = await runInitWizard(init);
    break;
  }
  case undefined:
    // Placeholder until the board issue lands.
    render(
      <Box flexDirection="column" padding={1}>
        <Text bold>gh-relay</Text>
        <Text dimColor>The board is not built yet. Run `gh-relay init` to configure this repository.</Text>
      </Box>,
    );
    break;
  case "-h":
  case "--help":
    console.log(USAGE);
    break;
  default:
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    process.exitCode = 1;
}
