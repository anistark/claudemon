# Claudemon - Development Commands
# https://github.com/casey/just

# Default recipe to display help
default:
    @just --list

# Install dependencies
install:
    pnpm install

# Build TypeScript
build:
    pnpm run build

# Watch mode (rebuild on changes)
dev:
    pnpm run dev

# Type check without emitting
lint:
    pnpm run lint

# Run all quality checks
qa: lint build

# Run the TUI
start:
    node dist/index.js

# Build and run claudemon with optional args (e.g. `just run setup`)
run *ARGS: build
    node dist/index.js {{ARGS}}

# Run interactive setup
setup:
    node dist/index.js setup

# Clean build artifacts
clean:
    rm -rf dist/

# Publish to npm
publish: clean build
    pnpm publish
