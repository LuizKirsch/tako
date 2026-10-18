# tako

A terminal tool that connects a GitHub Projects board to an AI coding agent.

The goal is a full relay: pick a card from the board, prepare the branch, open
the agent with the issue context, and deliver the work as a pull request.

> **Status: early.** Today tako configures a repository and shows its
> board. Starting a task (branch + agent) and delivering it (pull request) are
> not built yet.

## Requirements

- [Node.js](https://nodejs.org) 22 or newer
- [GitHub CLI](https://cli.github.com) (`gh`), logged in with the `project` scope
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed (the only supported agent so far)
- A GitHub Project (v2) with a single-select field for the columns, such as `Status`

tako never asks for, stores or logs a token. Every GitHub call goes through
`gh`, which handles authentication. If `gh` is logged out or lacks the
`project` scope, `tako init` offers to run the fix for you:

```sh
gh auth login --scopes project      # not logged in yet
gh auth refresh --scopes project    # logged in, missing the project scope
```

## Install

tako is not on npm yet. Install it from source:

```sh
git clone https://github.com/LuizKirsch/gh-relay.git
cd gh-relay
npm install
npm run build
npm link        # makes the `tako` command available everywhere
```

## Usage

Run every command from the **root of the repository** you want to work on:
tako reads and writes its files in the current directory.

### 1. Configure the repository

```sh
tako init
```

The wizard asks:

1. Which GitHub Project holds the tasks for this repository.
2. Which field defines the board columns (it suggests `Status`).
3. Which column plays each role:

   | Role | Meaning | Required |
   |---|---|---|
   | `ready` | Cards the AI is allowed to pick up | yes |
   | `in_progress` | Work in progress | yes |
   | `delivery` | Delivered, waiting for human review | yes |
   | `blocked` | Missing information | no |

4. The base branch for new branches and pull requests (default `main`).

Your columns can have any names. tako stores the column IDs, so renaming a
column later does not break the setup. Removing a mapped column does: the
board shows a warning and asks you to run `tako init` again.

`init` writes two files:

| File | Contents | Commit it? |
|---|---|---|
| `.tako.json` | Your project, field and column IDs | **No.** It identifies your project, so `init` adds it to `.gitignore` |
| `.tako/rules.md` | How you want the agent to work (scope, style, tests) | **Yes.** Edit it freely; it is created once and never overwritten |

Running `init` again asks before replacing the existing configuration.

### 2. Open the board

```sh
tako
```

The board opens on the `ready` column. Columns sit side by side and scroll
sideways when they do not fit the terminal.

| Key | Board | Card details |
|---|---|---|
| `←` `→` | Change column | Back to the board (`←`) |
| `↑` `↓` | Change card | Scroll the description |
| `Enter` | Open the card's details | Back to the board |
| `Esc` | Quit | Back to the board |
| `q` | Quit | Quit |

The details show the card's repository, column, state, labels, assignees,
link, description and comments. Comments load when the card is opened (up to
the latest 100).

Only the first 100 cards of a project are shown.

## Development

```sh
npm run dev -- init    # run from source (omit `-- init` to open the board)
npm run typecheck
npm test
npm run build
```

Typecheck, tests and build must all pass before a pull request. The
architecture and conventions are described in [CLAUDE.md](CLAUDE.md).

Test fixtures must never contain real project data (IDs, titles or issue
contents): write them by hand or anonymize them.

## License

[MIT](LICENSE)
