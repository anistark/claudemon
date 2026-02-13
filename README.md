# claudemon

Claude Usage Monitor TUI - monitor your Claude Pro/Max plan quota in real-time.

[![npm version](https://img.shields.io/npm/v/claudemon)](https://www.npmjs.com/package/claudemon)
[![npm downloads](https://img.shields.io/npm/dm/claudemon)](https://www.npmjs.com/package/claudemon)
[![Open Source](https://img.shields.io/badge/open-source-brightgreen)](https://github.com/anistark/claudemon)
![maintenance-status](https://img.shields.io/badge/maintenance-actively--developed-brightgreen.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Install

```sh
# Run without installing
npx claudemon

# Or install globally
npm i -g claudemon
pnpm add -g claudemon
```

Requires Node.js 18+.

## Setup

```sh
claudemon setup
```

This detects your Claude Code OAuth credentials automatically. If you haven't logged in to Claude Code yet, it will guide you through the process.

## Commands

| Command | Description |
|---------|-------------|
| `claudemon` | Launch the TUI dashboard |
| `claudemon setup` | Interactive OAuth setup (skips if already authenticated) |
| `claudemon setup --re` | Force re-authentication, overwriting existing token |
| `claudemon --help`, `-h` | Show help message |
| `claudemon --version` | Show version |

## Keybindings (in TUI)

| Key | Action |
|-----|--------|
| `q` | Quit |
| `r` | Force refresh |
| `?` | Toggle help |

## Configuration

Config file: `~/.config/claudemon/config.toml`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `plan_type` | string | `"pro"` | Claude plan type (`pro` or `max`) |
| `refresh_interval` | number | `5` | Auto-refresh interval in seconds |

## Development

```sh
# Install dependencies
pnpm install

# Build and run with args
just run
just run setup
just run --help

# Build
just build

# Watch mode
just dev

# Type check
just lint
```
