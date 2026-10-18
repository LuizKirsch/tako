// The user layer of rules, created once in a repository's .tako/rules.md the
// first time a task starts there, and never overwritten.
//
// It is a starting point the user owns and edits freely. The workflow
// contract (branch, commits, no push, no PR) is NOT here: tako injects it on
// every run, so editing this file can never break the flow. The repository's
// own instructions (CLAUDE.md, AGENTS.md...) win over this file.
//
// Kept as a TS string (not a .md asset) so tsup bundles it without extra config.

export const RULES_FILE = ".tako/rules.md"; // relative to the repository root

export const RECOMMENDED_RULES = `# Rules for the AI agent

These rules are sent to the agent with every task opened by tako.
Edit them freely: they describe how YOU want the work done.
The workflow itself (branch, commits, no push, no PR) is handled by tako and
does not need to be written here. The repository's own instructions for
agents (CLAUDE.md, AGENTS.md, .claude/...) and its commit convention win over
these rules.

## Scope
- Implement only what the issue asks. If something else looks wrong, mention it instead of fixing it.
- If the issue is missing information, say exactly what is missing and stop. Do not guess.

## Code
- Follow the existing style and structure of the project.
- Prefer small, focused changes over large refactors.
- Add or update tests for the behavior you change.

## Commits
- Small commits, each one with a clear message.

## Before finishing
- Run the project's tests and type checks, and report the result.
- Summarize what changed and anything left to the reviewer.
`;
