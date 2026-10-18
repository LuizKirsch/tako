// Port: reading and writing files under one root directory.
//
// Kept generic on purpose: the tako config (rooted at the config directory)
// and, later, files in a repository go through it, and tests swap it for an
// in-memory map.

export interface Files {
  // Returns undefined when the file does not exist.
  readText(path: string): Promise<string | undefined>;
  // Creates parent directories when needed.
  writeText(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}
