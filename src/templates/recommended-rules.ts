// The user layer of rules, generated once by `init` into .tako/rules.md.
//
// It is a starting point the user owns and edits freely. The workflow
// contract (no push, no PR, commit with #N...) is NOT here: tako injects
// it on every run, so editing this file can never break the flow.
//
// Kept as a TS string (not a .md asset) so tsup bundles it without extra config.

export const RECOMMENDED_RULES = `# Rules for the AI agent

These rules are sent to the agent with every task opened by tako.
Edit them freely: they describe how YOU want the work done.
The workflow itself (branch, commits with the issue number, no push, no PR)
is handled by tako and does not need to be written here.

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
