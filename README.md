# claudemon

Claude Usage Monitor TUI - monitor your Claude Pro/Max plan quota in real-time.

[![PyPI - Version](https://img.shields.io/pypi/v/claudemon)](https://pypi.org/project/claudemon/)
[![PyPI Downloads](https://static.pepy.tech/badge/claudemon/month)](https://pypi.org/project/claudemon/)
![PyPI - Status](https://img.shields.io/pypi/status/claudemon)
[![Open Source](https://img.shields.io/badge/open-source-brightgreen)](https://github.com/anistark/claudemon)
![maintenance-status](https://img.shields.io/badge/maintenance-actively--developed-brightgreen.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Install

Requires Python 3.14+ and [uv](https://docs.astral.sh/uv/).

```sh
uv sync
```

## Setup

```sh
# Full setup: OAuth token + optional Admin API key
uv run claudemon setup

# Admin API key only
uv run claudemon setup --api
```

## Usage

```sh
# Launch the TUI dashboard
uv run claudemon

# Launch in API monitoring mode
uv run claudemon --mode api
```

### Keybindings

| Key | Action |
|-----|--------|
| `q` | Quit |
| `r` | Force refresh |
| `m` | Toggle API mode |
| `?` | Show help |
