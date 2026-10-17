import { defineConfig } from "tsup";

// Bundles src/cli.tsx into dist/cli.js, runnable as a global command.
export default defineConfig({
  entry: ["src/cli.tsx"],
  format: ["esm"],
  target: "node22",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
});