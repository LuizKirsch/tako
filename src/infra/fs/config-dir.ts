// Where tako keeps its config, outside any repository:
//   TAKO_CONFIG_DIR, when set (handy for tests or a custom location)
//   Windows: %APPDATA%\tako
//   others:  $XDG_CONFIG_HOME/tako, or ~/.config/tako

import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export function configDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.TAKO_CONFIG_DIR) return env.TAKO_CONFIG_DIR;
  if (platform === "win32") return win32.join(env.APPDATA ?? win32.join(home, "AppData", "Roaming"), "tako");
  return posix.join(env.XDG_CONFIG_HOME ?? posix.join(home, ".config"), "tako");
}
