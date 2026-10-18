// Loads the board and renders it. The loader comes from the composition root,
// so this file never touches infra.

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
  const app = render(<Text dimColor>Loading the board…</Text>);

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

function finish(app: Instance, node: ReactNode, code: number): number {
  app.rerender(node);
  app.unmount();
  return code;
}
