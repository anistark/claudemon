"""CLI entry point for claudemon."""

import sys


def main() -> None:
    args = sys.argv[1:]

    if args and args[0] == "setup":
        _run_setup(args[1:])
        return

    mode = "quota"
    if "--mode" in args:
        idx = args.index("--mode")
        if idx + 1 < len(args):
            mode = args[idx + 1]

    if "--help" in args or "-h" in args:
        _print_help()
        return

    if "--version" in args:
        from . import __version__

        print(f"claudemon {__version__}")
        return

    from .app import ClaudemonApp

    app = ClaudemonApp(mode=mode)
    app.run()


def _run_setup(args: list[str]) -> None:
    api_only = "--api" in args
    from .auth import interactive_setup

    interactive_setup(api_only=api_only)


def _print_help() -> None:
    print(
        """claudemon — Claude Usage Monitor TUI

Usage:
  claudemon              Launch the TUI dashboard
  claudemon setup        Interactive OAuth + API key setup
  claudemon setup --api  Configure Admin API key only
  claudemon --mode api   Launch in API monitoring mode

Options:
  --help, -h       Show this help message
  --version        Show version

Keybindings (in TUI):
  q    Quit
  r    Force refresh
  m    Toggle API mode
  ?    Show help"""
    )


if __name__ == "__main__":
    main()
