# gh-relay

CLI that picks a task from GitHub Projects, prepares the branch, opens an AI coding
agent with the issue context, and delivers the work as a pull request.
Full design: @docs/design.md

## Stack
- Node 22+, TypeScript (strict), ESM
- Ink (React for the terminal) for the UI
- execa to run gh, git and the agent
- tsup for the build; vitest + ink-testing-library for tests

## Commands
- `npm run dev`: run the CLI from source
- `npm run typecheck`, `npm test`, `npm run build`: all must pass before a PR

## Architecture rules
- Layers: `ui` → `app` (use cases) → `domain`; `app` also talks to `ports`.
  Dependencies only point down.
- `domain/` has no I/O: no execa, no fs, no network. Pure functions, unit tested.
- Anything external goes through an interface in `ports/`; implementations live in `infra/`.
- The UI never calls `infra/` directly.
- GitHub access only through `GitHubPort` (`gh api graphql`). Never ask for, store or log tokens.

## Conventions
- Code, comments, README and commit messages in English. Talk to me in Brazilian Portuguese.
- Conventional Commits referencing the issue, e.g. `feat(board): group cards by column (#9)`.
- New domain logic and use cases come with tests. GitHub responses are real JSON saved in `test/fixtures/`.
- No new dependency without explaining why in the PR description.
- Do not invent the behavior of GitHub, gh, Claude Code or libraries: check the docs or `--help`,
  and say so when unsure.

## Workflow
@.claude/rules/fluxo-issues.md
