#!/usr/bin/env node

import { runCli } from "./cli.js";

const code = await runCli(process.argv.slice(2), {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
  isTTY: Boolean(process.stdout.isTTY),
  columns: process.stdout.columns || 120,
  env: process.env,
});

process.exitCode = code;
