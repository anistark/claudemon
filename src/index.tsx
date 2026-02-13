#!/usr/bin/env node

/**
 * CLI entry point for claudemon.
 */

import { createRequire } from "node:module";
import React from "react";
import { render } from "ink";

import { App } from "./app.js";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json");

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  if (args.includes("--version")) {
    console.log(`claudemon ${VERSION}`);
    return;
  }

  if (args[0] === "setup") {
    const forceReauth = args.includes("--re");
    runSetup(forceReauth);
    return;
  }

  // Launch TUI (full-screen alternate screen)
  process.stdout.write("\x1b[?1049h"); // enter alternate screen
  process.stdout.write("\x1b[2J\x1b[H"); // clear + home
  const instance = render(<App version={VERSION} />);
  instance.waitUntilExit().then(() => {
    process.stdout.write("\x1b[?1049l"); // restore main screen
  });
}

async function runSetup(forceReauth = false): Promise<void> {
  const { interactiveSetup } = await import("./auth.js");
  await interactiveSetup(forceReauth);
}

function printHelp(): void {
  console.log(`claudemon — Claude Usage Monitor TUI

Usage:
  claudemon              Launch the TUI dashboard
  claudemon setup        Interactive OAuth setup
  claudemon setup --re   Force re-authentication (overwrite existing token)

Options:
  --help, -h       Show this help message
  --version        Show version

Keybindings (in TUI):
  q    Quit
  r    Force refresh
  ?    Show help`);
}

main();
