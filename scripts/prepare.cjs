require("../bin/node-version.cjs")();

const { spawnSync } = require("node:child_process");
const { rmSync } = require("node:fs");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
rmSync(resolve(root, "dist"), { recursive: true, force: true });
const result = spawnSync(process.execPath, [resolve(require.resolve("typescript/package.json"), "../bin/tsc"), "-p", "tsconfig.install.json"], { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
