import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveTarget, workflowInputs } from "./target.ts";

// The step as the demo store's workflow has it (t1dem/proofed-demo-store, .github/workflows/proofed.yml).
const DEMO = `jobs:
  proofed:
    steps:
      - uses: pnpm/action-setup@v4
        with:
          version: 10.20.0
      - uses: t1dem/proofed@main
        with:
          url: http://localhost:4173
          install: pnpm install --frozen-lockfile
          build: pnpm build
          serve: pnpm preview --port 4173
          cache: pnpm
          lt-username: \${{ secrets.LT_USERNAME }}
          # Settings from the Proofed dashboard.
          vars: \${{ toJSON(vars) }}
`;

test("the Proofed step's inputs are read; expressions and other steps are not", () => {
  assert.deepEqual(workflowInputs(DEMO), {
    url: "http://localhost:4173",
    install: "pnpm install --frozen-lockfile",
    build: "pnpm build",
    serve: "pnpm preview --port 4173",
    cache: "pnpm",
  });
});

test("a step named first, quoted values, comments and the fixer's action", () => {
  const yml = `    steps:
      - name: Proofed
        uses: "t1dem/proofed@v1"
        with:
          url: "http://localhost:3000" # the dev server
          working-directory: site
          build: |
            npm ci
            npm run build
          serve: 'npm run start'
      - name: After
        run: echo done
`;
  assert.deepEqual(workflowInputs(yml), { url: "http://localhost:3000", "working-directory": "site", serve: "npm run start" });
  assert.equal(workflowInputs("      - uses: t1dem/proofed/fix@main\n        with:\n          url: x\n"), undefined);
});

test("flags win over the environment, the config file and the workflow, each value on its own", () => {
  const cwd = mkdtempSync(join(tmpdir(), "proofed-target-"));
  try {
    mkdirSync(join(cwd, ".github/workflows"), { recursive: true });
    writeFileSync(join(cwd, ".github/workflows/proofed.yml"), DEMO);
    const fromWorkflow = resolveTarget({ flags: {}, env: {}, cwd });
    assert.deepEqual(fromWorkflow.url, { value: "http://localhost:4173", from: ".github/workflows/proofed.yml" });
    assert.equal(fromWorkflow.serve?.value, "pnpm preview --port 4173");
    assert.equal(fromWorkflow.build?.value, "pnpm build");

    mkdirSync(join(cwd, ".proofed"));
    writeFileSync(join(cwd, ".proofed/config.json"), JSON.stringify({ url: "http://localhost:5173", serve: "npm run dev" }));
    const fromConfig = resolveTarget({ flags: {}, env: { PROOFED_URL: "http://127.0.0.1:9000" }, cwd });
    assert.deepEqual(fromConfig.url, { value: "http://127.0.0.1:9000", from: "PROOFED_URL" });
    assert.deepEqual(fromConfig.serve, { value: "npm run dev", from: ".proofed/config.json" });
    // The workflow's build is for the workflow's serve, not for the config file's.
    assert.equal(fromConfig.build, undefined);

    const fromFlags = resolveTarget({ flags: { url: "http://localhost:1", build: "make" }, env: {}, cwd });
    assert.deepEqual(fromFlags.url, { value: "http://localhost:1", from: "--url" });
    assert.deepEqual(fromFlags.build, { value: "make", from: "--build" });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
