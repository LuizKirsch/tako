// Port: questions about local git repositories.
//
// Which repository a folder belongs to, the worktree each task works in, and
// the delivery of a finished task: checking its branch has work and pushing it.

export interface LocalRepo {
  root: string; // the repository's top folder, even when asked about a subfolder
  repo: string | undefined; // "owner/name" of the GitHub `origin` remote, lowercase
}

export interface GitPort {
  // Undefined when `dir` is not inside a git repository.
  inspect(dir: string): Promise<LocalRepo | undefined>;
  // Commits on `branch` that `base` does not have. Undefined when `branch`
  // does not exist.
  commitsAhead(root: string, base: string, branch: string): Promise<number | undefined>;
  // Pushes `branch` to `origin`, setting its upstream. Throws with git's message.
  push(root: string, branch: string): Promise<void>;
  // Checks `branch` out in a new worktree at `path`, creating the branch from
  // the freshest `base` when it does not exist yet. Reuses a worktree already
  // there on that branch. Throws with git's message.
  addWorktree(root: string, path: string, branch: string, base: string): Promise<void>;
  // Removes a worktree. Refuses (throws) when it has uncommitted changes.
  removeWorktree(root: string, path: string): Promise<void>;
}
