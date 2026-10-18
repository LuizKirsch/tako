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

```sh
npm install -g @luizkirsch/tako
```

Until the first release is on npm, install it from source:

```sh
git clone https://github.com/LuizKirsch/gh-relay.git
cd gh-relay
npm install
npm run build
npm link        # makes the `tako` command available everywhere
```

## Usage

tako works from any folder: your projects are saved in your user config, not
in a repository.

### 1. Add a project

```sh
tako init
```

The wizard asks:

1. Which GitHub Project to add (the ones already added are marked).
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

Run `tako init` once per project. Adding a project that is already there asks
before replacing its setup; the other projects are kept.

The setup is saved in `config.json`, in your user config directory:

| System | Location |
|---|---|
| Windows | `%APPDATA%\tako\config.json` |
| macOS, Linux | `$XDG_CONFIG_HOME/tako/config.json`, or `~/.config/tako/config.json` |

Set `TAKO_CONFIG_DIR` to use another directory. The file holds your project
IDs, so keep it out of any repository.

### 2. Open the board

```sh
tako
```

tako opens the board of the last project you used, in full screen; when you
quit, the terminal is back as it was. The board opens on the `ready` column.
Columns sit side by side and scroll sideways when they do not fit the
terminal. Press `p` to switch to another project.

| Key | Board | Card details |
|---|---|---|
| `←` `→` | Change column | Back to the board (`←`) |
| `↑` `↓` | Change card | Scroll the description |
| `Enter` | Open the card's details | Back to the board |
| `s` | Start the selected card | Start this card |
| `p` | Switch project | |
| `Esc` | Quit | Back to the board |
| `q` | Quit | Quit |

The details show the card's repository, column, state, labels, assignees,
link, description and comments. Comments load when the card is opened (up to
the latest 100).

### 3. Start a task

Press `s` on a card in the `ready` column. tako asks which agent to use and
then which model, starting with the default agent from `tako init`. Choosing
**Default** lets the agent use its own default model. Cards in other columns,
and drafts (they have no repository yet), cannot be started.

tako then opens the agent inside the issue's repository:

1. **Finding the repository.** tako uses the folder it remembers for that
   repository, or the current folder when it is that repository. Otherwise it
   asks where the repository is cloned (it checks the folder's `origin`) and
   remembers the answer in your config, per repository.
2. **Rules.** The first time, it creates `.tako/rules.md` in the repository:
   how you want the agent to work. Edit it freely and commit it.
3. **The agent.** Claude Code opens with the chosen model and, as its first
   message, the issue (description and comments) and how to work: create the
   branch `tako/<number>-<title>` from your base branch, follow the rules,
   reference the issue in commits, and do not push or open a pull request.
4. **Back to the board.** When you close the agent, the board opens again.

> Not built yet: moving the card to the `in_progress` column, creating the
> branch in tako itself (the agent does it for now), and delivering the work
> as a pull request.

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
