#!/usr/bin/env node
require("./node-version.cjs")();

const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");

import(pathToFileURL(resolve(__dirname, "../src/proofed.ts")).href).catch((error) => {
  console.error(`proofed: ${error.message}`);
  process.exitCode = 3;
});
