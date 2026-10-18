import { describe, expect, it } from "vitest";
import { configDir } from "../../src/infra/fs/config-dir.js";

describe("configDir", () => {
  it("uses TAKO_CONFIG_DIR when set", () => {
    expect(configDir({ TAKO_CONFIG_DIR: "/tmp/tako" }, "linux", "/home/luiz")).toBe("/tmp/tako");
  });

  it("uses %APPDATA% on Windows", () => {
    // String.raw keeps the backslashes of Windows paths readable.
    expect(configDir({ APPDATA: String.raw`C:\Users\Luiz\AppData\Roaming` }, "win32", String.raw`C:\Users\Luiz`)).toBe(
      String.raw`C:\Users\Luiz\AppData\Roaming\tako`,
    );
    expect(configDir({}, "win32", String.raw`C:\Users\Luiz`)).toBe(String.raw`C:\Users\Luiz\AppData\Roaming\tako`);
  });

  it("follows XDG on Linux and macOS, defaulting to ~/.config", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/home/luiz/.cfg" }, "linux", "/home/luiz")).toBe("/home/luiz/.cfg/tako");
    expect(configDir({}, "darwin", "/Users/luiz")).toBe("/Users/luiz/.config/tako");
  });
});
