"""CLI entry point for claudemon."""

import sys


def main() -> None:
    args = sys.argv[1:]

    if args and args[0] == "setup":
        _run_setup(args[1:])
        return

    if "--help" in args or "-h" in args:
        _print_help()
        return

    if "--version" in args:
        from . import __version__

        print(f"claudemon {__version__}")
        return

    from .app import ClaudemonApp

    app = ClaudemonApp()
    app.run()


def _run_setup(args: list[str]) -> None:
    from .auth import interactive_setup

    interactive_setup()


def _print_help() -> None:
    print(
        """claudemon — Claude Usage Monitor TUI

Usage:
  claudemon              Launch the TUI dashboard
  claudemon setup        Interactive OAuth setup

Options:
  --help, -h       Show this help message
  --version        Show version

Keybindings (in TUI):
  q    Quit
  r    Force refresh
  ?    Show help"""
    )


if __name__ == "__main__":
    main()
