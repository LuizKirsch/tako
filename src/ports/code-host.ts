// Port: where a finished task is delivered as a pull request.
//
// Separate from the board on purpose: tasks may come from one tool (a kanban)
// while the code lives in another. Production uses GitHub through
// `gh api graphql` (infra/github).

export interface PullRequestInput {
  repo: string; // "owner/name"
  base: string;
  head: string; // branch already pushed
  title: string;
  body: string;
}

export interface PullRequestInfo {
  number: number;
  url: string;
  state: "open" | "merged" | "closed";
}

export interface CodeHost {
  // The newest pull request from branch `head`, in any state.
  findPullRequest(repo: string, head: string): Promise<PullRequestInfo | undefined>;
  // Opens a pull request, or returns the open one for the same branch.
  // Resolves with its URL.
  openPullRequest(input: PullRequestInput): Promise<string>;
}
