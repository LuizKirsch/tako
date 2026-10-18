// Loads the board and renders it. The loaders come from the composition root,
// so this file never touches infra.
//
// The board runs in the terminal's alternate screen, like vim or Claude Code:
// it takes the whole terminal and, on exit, the previous content comes back.
// Ink discards whatever is drawn there on exit, so messages meant to stay
// (no project added, GitHub errors) are printed on the normal screen instead.
//
// Switching projects reloads in place. Starting a task leaves the board,
// runs `start` on the normal screen (where the agent takes the terminal),
// and then opens the board again on the same project.

import { Box, render, Text, type Instance } from "ink";
import type { ReactNode } from "react";
import type { BoardResult } from "../../app/load-board.js";
import type { StartRequest } from "../../app/start-task.js";
import type { Card, Comment } from "../../domain/board.js";
import { GitHubError } from "../../ports/github.js";
import { Board } from "./Board.js";
import type { AgentChoice } from "./StartPicker.js";

export interface RunBoardOptions {
  load: (projectId?: string) => Promise<BoardResult>;
  loadComments: (card: Card) => Promise<Comment[]>;
  start: (request: StartRequest, agents: readonly AgentChoice[]) => Promise<void>;
  configPath: string; // shown when the config cannot be read
}

type Session =
  | { kind: "quit"; exitCode: number }
  | { kind: "start"; request: StartRequest; agents: readonly AgentChoice[]; projectId: string };

// Returns the process exit code.
export async function runBoard(options: RunBoardOptions): Promise<number> {
  let projectId: string | undefined;
  for (;;) {
    const session = await boardSession(options, projectId);
    if (session.kind === "quit") return session.exitCode;
    projectId = session.projectId;
    await options.start(session.request, session.agents);
  }
}

// One stay on the board, until the user quits or starts a task.
async function boardSession(options: RunBoardOptions, initialProjectId?: string): Promise<Session> {
  // Ignored by Ink when stdout is not a terminal (piped output, CI).
  const app = render(<Text dimColor>Loading the board…</Text>, { alternateScreen: true });
  let session: Session = { kind: "quit", exitCode: 0 };

  const open = async (projectId?: string): Promise<void> => {
    app.rerender(<Text dimColor>Loading the board…</Text>);
    let result: BoardResult;
    try {
      result = await options.load(projectId);
    } catch (error) {
      if (!(error instanceof GitHubError)) {
        app.unmount();
        throw error;
      }
      session = { kind: "quit", exitCode: finish(app, <Text color="red">{error.message}</Text>) };
      return;
    }

    if (result.status === "no_config") {
      session = { kind: "quit", exitCode: finish(app, <Text>No project added yet. Run `tako init` to add one.</Text>) };
      return;
    }
    if (result.status === "invalid_config") {
      const message = (
        <Box flexDirection="column">
          <Text color="red">{options.configPath} is invalid. Fix it, or delete it and run `tako init` again:</Text>
          {result.errors.map((e) => (
            <Text key={e.path}>
              {"  "}
              {e.path}: {e.message}
            </Text>
          ))}
        </Box>
      );
      session = { kind: "quit", exitCode: finish(app, message) };
      return;
    }

    const { project, projects, columns, drift, agents } = result;
    app.rerender(
      <Board
        // A new key resets the board (selected column and card) on switch.
        key={project.project.id}
        title={`${project.project.title} / ${project.columnField.name}`}
        columns={columns}
        drift={drift}
        loadComments={options.loadComments}
        agents={agents}
        defaultAgentId={project.agent.default}
        projects={projects}
        currentProjectId={project.project.id}
        onSwitchProject={(id) => void open(id)}
        onStart={(card, choice) => {
          const request = { card, ...choice, baseBranch: project.baseBranch };
          session = { kind: "start", request, agents, projectId: project.project.id };
          // Leave the alternate screen: the agent needs the real terminal.
          app.unmount();
        }}
      />,
    );
  };

  await open(initialProjectId);
  await app.waitUntilExit();
  return session;
}

// Leaves the alternate screen, then prints the message on the normal screen
// so it is still there after tako exits. Returns the exit code.
function finish(app: Instance, node: ReactNode): number {
  app.unmount();
  render(node).unmount();
  return 1;
}
