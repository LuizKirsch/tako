// Port: questions about local git repositories.
//
// tako only reads here: which repository a folder belongs to. Branches are
// created by the agent for now (see domain/task.ts).

export interface LocalRepo {
  root: string; // the repository's top folder, even when asked about a subfolder
  repo: string | undefined; // "owner/name" of the GitHub `origin` remote, lowercase
}

export interface GitPort {
  // Undefined when `dir` is not inside a git repository.
  inspect(dir: string): Promise<LocalRepo | undefined>;
}
