#!/usr/bin/env node
require("./node-version.cjs")();

const { existsSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");

// A checkout must use its source, even when an earlier build is still on disk.
const entry = existsSync(resolve(__dirname, "../src")) ? "../src/proofed.ts" : "../dist/proofed.js";

import(pathToFileURL(resolve(__dirname, entry)).href).catch((error) => {
  console.error(`proofed: ${error.message}`);
  process.exitCode = 3;
});
