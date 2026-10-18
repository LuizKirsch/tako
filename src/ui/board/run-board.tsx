// Loads the board and renders it. The loader comes from the composition root,
// so this file never touches infra.
//
// The board runs in the terminal's alternate screen, like vim or Claude Code:
// it takes the whole terminal and, on exit, the previous content comes back.
// Ink discards whatever is drawn there on exit, so messages meant to stay
// (missing config, GitHub errors) are printed on the normal screen instead.

import { Box, render, Text, type Instance } from "ink";
import type { ReactNode } from "react";
import type { BoardResult } from "../../app/load-board.js";
import type { Card, Comment } from "../../domain/board.js";
import { GitHubError } from "../../ports/github.js";
import { Board } from "./Board.js";

// Returns the process exit code.
export async function runBoard(
  load: () => Promise<BoardResult>,
  loadComments: (card: Card) => Promise<Comment[]>,
): Promise<number> {
  // Ignored by Ink when stdout is not a terminal (piped output, CI).
  const app = render(<Text dimColor>Loading the board…</Text>, { alternateScreen: true });

  let result: BoardResult;
  try {
    result = await load();
  } catch (error) {
    if (!(error instanceof GitHubError)) {
      app.unmount();
      throw error;
    }
    return finish(app, <Text color="red">{error.message}</Text>, 1);
  }

  if (result.status === "no_config") {
    return finish(app, <Text>This repository is not configured yet. Run `tako init`.</Text>, 1);
  }
  if (result.status === "invalid_config") {
    return finish(
      app,
      <Box flexDirection="column">
        <Text color="red">.tako.json is invalid. Fix it or run `tako init` again:</Text>
        {result.errors.map((e) => (
          <Text key={e.path}>
            {"  "}
            {e.path}: {e.message}
          </Text>
        ))}
      </Box>,
      1,
    );
  }

  const { config, columns, drift, agents } = result;
  app.rerender(
    <Board
      title={`${config.project.title} / ${config.columnField.name}`}
      columns={columns}
      drift={drift}
      loadComments={loadComments}
      agents={agents}
      defaultAgentId={config.agent.default}
    />,
  );
  await app.waitUntilExit();
  return 0;
}

// Leaves the alternate screen, then prints the message on the normal screen
// so it is still there after tako exits.
function finish(app: Instance, node: ReactNode, code: number): number {
  app.unmount();
  render(node).unmount();
  return code;
}
