// Loads the board and renders it. The loaders come from the composition root,
// so this file never touches infra.
//
// The board runs in the terminal's alternate screen, like vim or Claude Code:
// it takes the whole terminal and, on exit, the previous content comes back.
// Ink discards whatever is drawn there on exit, so messages meant to stay
// (no project added, GitHub errors) are printed on the normal screen instead.
//
// Switching projects reloads in place. Starting a task leaves the board,
// runs `start` on the normal screen (it may ask for the repository's folder),
// and opens the board again: the agent works in the background meanwhile.
// While the board is open it refreshes every few seconds, and on `r`: the
// background tasks are synced first (a finished one is delivered as a pull
// request, with its checks), then the board is reloaded from GitHub. A
// refresh runs whatever syncTasks does for every agent, so a new agent or
// check only needs to be added there. `a` leaves the board to open a card's
// agent session, to answer it.

import { Box, render, Text, type Instance } from "ink";
import type { ReactNode } from "react";
import type { BoardResult } from "../../app/load-board.js";
import type { StartRequest } from "../../app/start-task.js";
import type { Delivery, SyncResult } from "../../app/track-tasks.js";
import type { ProjectConfig } from "../../domain/config.js";
import type { TaskStatus } from "../../domain/task.js";
import type { PullRequestInfo } from "../../ports/github.js";
import type { Card, Comment } from "../../domain/board.js";
import { GitHubError } from "../../ports/github.js";
import { Board } from "./Board.js";
import type { AgentChoice } from "./StartPicker.js";

export interface RunBoardOptions {
  load: (projectId?: string) => Promise<BoardResult>;
  loadComments: (card: Card) => Promise<Comment[]>;
  start: (request: StartRequest, agents: readonly AgentChoice[]) => Promise<void>;
  sync: () => Promise<SyncResult>;
  attach: (itemId: string) => Promise<void>;
  addProject: () => Promise<void>; // asks the tako init questions
  findPullRequest: (card: Card) => Promise<PullRequestInfo | undefined>;
  deliver: (card: Card, project: ProjectConfig) => Promise<Delivery>;
  configPath: string; // shown when the config cannot be read
}

type Session =
  | { kind: "quit"; exitCode: number }
  | { kind: "start"; request: StartRequest; agents: readonly AgentChoice[]; projectId: string }
  | { kind: "attach"; itemId: string; projectId: string }
  | { kind: "add_project" };

const REFRESH_EVERY_MS = 10_000;

// Returns the process exit code.
export async function runBoard(options: RunBoardOptions): Promise<number> {
  let projectId: string | undefined;
  for (;;) {
    const session = await boardSession(options, projectId);
    if (session.kind === "quit") return session.exitCode;
    // After adding a project, the board opens the last one added (or the
    // same one, when nothing was added).
    projectId = session.kind === "add_project" ? undefined : session.projectId;
    // Ink unrefs stdin when it unmounts, and clack does not ref it back:
    // without this, the process exits while the first prompt waits for input.
    process.stdin.ref();
    if (session.kind === "start") {
      await options.start(session.request, session.agents);
    } else if (session.kind === "add_project") {
      await options.addProject();
    } else {
      console.log("Opening the agent. Leave it with Ctrl+Z to come back to the board; it keeps running.");
      await withStdinReleased(() => options.attach(session.itemId));
    }
  }
}

// Ink's unmount leaves stdin's handle reading (stream pause() does not stop
// it either), so this process keeps consuming keys meant for the child; on
// Windows the child gets none. ponytail: uses the internal `_handle` of
// node's net.Socket (checked on Node 24); restores the exact prior state.
async function withStdinReleased(run: () => Promise<void>): Promise<void> {
  const handle = (process.stdin as { _handle?: { reading?: boolean; readStop?: () => void; readStart?: () => void } })._handle;
  const wasReading = handle?.reading === true;
  if (wasReading) {
    handle.reading = false;
    handle.readStop?.();
  }
  try {
    await run();
  } finally {
    if (wasReading) {
      handle.reading = true;
      handle.readStart?.();
    }
  }
}

// One stay on the board, until the user quits or starts a task.
async function boardSession(options: RunBoardOptions, initialProjectId?: string): Promise<Session> {
  // Ignored by Ink when stdout is not a terminal (piped output, CI).
  const app = render(<Text dimColor>Loading the board…</Text>, { alternateScreen: true });
  let session: Session = { kind: "quit", exitCode: 0 };
  let draw: ((states: Record<string, TaskStatus>) => void) | undefined;
  let currentProjectId = initialProjectId;
  let busy = false;

  // A failed check (agent or GitHub unreachable) just waits for the next one.
  const sync = () => options.sync().catch((): SyncResult => ({ states: {}, delivered: [] }));

  // `quiet` reloads behind the current board, keeping the selection; when it
  // fails (GitHub unreachable for a moment), the current board stays.
  const open = async (projectId?: string, quiet = false): Promise<void> => {
    busy = true;
    try {
      await load(projectId, quiet);
    } finally {
      busy = false;
    }
  };

  const load = async (projectId: string | undefined, quiet: boolean): Promise<void> => {
    if (!quiet) {
      draw = undefined;
      app.rerender(<Text dimColor>Loading the board…</Text>);
    }
    let result: BoardResult;
    let states: Record<string, TaskStatus>;
    try {
      // Sync first: a task that finished meanwhile is already moved.
      states = (await sync()).states;
      result = await options.load(projectId);
    } catch (error) {
      if (quiet && draw) return;
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
    currentProjectId = project.project.id;
    draw = (states) =>
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
          tasks={states}
        pullRequests={{
          find: options.findPullRequest,
          create: async (card) => {
            const delivered = await options.deliver(card, project);
            // The card moved to delivery.
            void refresh();
            return delivered;
          },
        }}
          onSwitchProject={(id) => void open(id)}
          onRefresh={refresh}
        onAddProject={() => {
          session = { kind: "add_project" };
          app.unmount();
        }}
          onAttach={(card) => {
            session = { kind: "attach", itemId: card.itemId, projectId: project.project.id };
            app.unmount();
          }}
          onStart={(card, choice) => {
            const request = { card, ...choice, project };
            session = { kind: "start", request, agents, projectId: project.project.id };
            // Leave the alternate screen: starting may ask for the repository's folder.
            app.unmount();
          }}
        />,
      );
    draw(states);
  };

  // A refresh already running covers this one.
  const refresh = async (): Promise<void> => {
    if (!busy && draw) await open(currentProjectId, true);
  };
  const timer = setInterval(() => void refresh(), REFRESH_EVERY_MS);

  try {
    await open(initialProjectId);
    await app.waitUntilExit();
  } finally {
    clearInterval(timer);
  }
  return session;
}

// Leaves the alternate screen, then prints the message on the normal screen
// so it is still there after tako exits. Returns the exit code.
function finish(app: Instance, node: ReactNode): number {
  app.unmount();
  render(node).unmount();
  return 1;
}
