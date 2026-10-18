// Files on the real filesystem, rooted at one directory.
// Paths are always relative to the root, so callers never build absolute paths.

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Files } from "../../ports/files.js";

export class NodeFiles implements Files {
  constructor(private readonly root: string = process.cwd()) {}

  async readText(path: string): Promise<string | undefined> {
    try {
      return await readFile(this.abs(path), "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async writeText(path: string, content: string): Promise<void> {
    const target = this.abs(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(this.abs(path));
      return true;
    } catch {
      return false;
    }
  }

  private abs(path: string): string {
    return resolve(this.root, path);
  }
}
