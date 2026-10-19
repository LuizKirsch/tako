# tako

A terminal tool that connects a GitHub Projects board to an AI coding agent.

The goal is a full relay: pick a card from the board, prepare the branch, open
the agent with the issue context, and deliver the work as a pull request.

> **Status: alpha.** The whole relay works with Claude Code: board, start,
> background agent and pull request. Expect rough edges.

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

Or install it from source:

```sh
git clone https://github.com/LuizKirsch/tako.git
cd tako
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

Run `tako init` once per project, or add one from the board (`p`, then
**+ Add a project**). Adding a project that is already there asks
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
terminal. Press `p` to switch to another project or to add a new one: adding
asks the same questions as `tako init`, then opens the new project's board.

| Key | Board | Card details |
|---|---|---|
| `←` `→` | Change column | Back to the board (`←`) |
| `↑` `↓` | Change card | Scroll the description |
| `Enter` | Open the card's details | Back to the board |
| `s` | Start the selected card | Start this card |
| `c` | | Create the pull request |
| `a` | Open the card's agent session | |
| `p` | Switch or add a project | |
| `Esc` | Quit | Back to the board |
| `q` | Quit | Quit |

The details show the card's repository, column, state, labels, assignees,
link, pull request, description and comments (up to the latest 100, loaded
when the card is opened). The pull request is the one from tako's branch for
that issue (`tako/<number>-<title>`): open, merged or closed. When there is
none (a delivery that failed, or work done by hand), press `c` to deliver it
(see step 7 below).

### 3. Start a task

Press `s` on a card in the `ready` column. tako asks which agent to use and
then which model, starting with the default agent from `tako init`. Choosing
**Default** lets the agent use its own default model. **Opus + Haiku
helpers** runs Opus with a Haiku subagent it is told to hand mechanical work
to (searching, reading files, running tests), to spend fewer Opus tokens; how
much it saves depends on how much the task delegates. Cards in other columns,
and drafts (they have no repository yet), cannot be started.

tako then starts the agent in the background:

1. **Finding the repository.** tako uses the folder it remembers for that
   repository, or the current folder when it is that repository. Otherwise it
   asks where the repository is cloned (it checks the folder's `origin`) and
   remembers the answer in your config, per repository.
2. **Rules.** The first time, it creates `.tako/rules.md` in the repository:
   how you want the agent to work. Edit it freely and commit it.
3. **The card moves** to your `in_progress` column. If GitHub refuses, tako
   warns and starts the agent anyway.
4. **A worktree of its own.** tako creates the branch `tako/<number>-<title>`
   from the latest base branch and checks it out in a new worktree inside the
   repository, `.tako/worktrees/<number>-<title>` (hidden from `git status`
   through `.git/info/exclude`). Your own checkout is never touched, and
   several tasks of the same repository can run side by side.
5. **The agent.** A Claude Code background session starts in the worktree,
   with the chosen model. Its first message is the issue (description and
   comments) and how to work: follow the repository's own instructions
   (`CLAUDE.md`, `AGENTS.md`, `.claude/`...) and commit convention first, then
   `.tako/rules.md`; commit the work; ask through its question tool when it
   needs you; do not push or open a pull request. It runs in `auto`
   permission mode: Claude Code approves safe actions itself and stops to ask
   about risky ones.
6. **Back to the board** right away. The card shows what the agent is doing
   (`working`, `needs you`, `failed`). The board refreshes every 10 seconds
   (agents and GitHub), or right away with `r`. Press `a` on
   the card to open the session and answer it; leave it with `Ctrl+Z` and it
   keeps running.
7. **Delivery.** When the session finishes, tako pushes the branch, opens a
   pull request against your base branch (titled after the issue, with
   `Closes #<number>`) and moves the card to your `delivery` column. Then it
   stops the session and removes the worktree; the branch stays, it belongs
   to the pull request. A worktree with uncommitted changes is kept and
   reported. If the branch has no commits or the push fails, the card stays
   and shows `delivery failed` with the reason: press `a`, ask the agent to
   fix it, and tako delivers again when it finishes, or press `c` in the
   card's details.

tako remembers its tasks in `tasks.json`, next to `config.json`, so closing
tako loses nothing: the board catches up when it opens again.

Claude Code only starts in the background in a folder you trusted: if it
refuses, open `claude` once in the repository and accept the trust prompt.

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
