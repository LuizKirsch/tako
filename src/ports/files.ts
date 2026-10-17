// Port: reading and writing files in the user's repository.
//
// Kept generic on purpose: the config store and the rules file both go
// through it, and tests swap it for an in-memory map.

export interface RepoFiles {
  // Returns undefined when the file does not exist.
  readText(path: string): Promise<string | undefined>;
  // Creates parent directories when needed.
  writeText(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}
