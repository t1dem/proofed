#!/usr/bin/env node
require("./node-version.cjs")();

const { existsSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");

// A checkout runs the source; npm packages contain only JavaScript.
const source = resolve(__dirname, "../src/proofed.ts");
import(pathToFileURL(existsSync(source) ? source : resolve(__dirname, "../dist/proofed.js")).href).catch((error) => {
  console.error(`proofed: ${error.message}`);
  process.exitCode = 3;
});
