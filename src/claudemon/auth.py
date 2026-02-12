"""OAuth authentication and token management for claudemon.

Reads Claude Code's OAuth credentials from:
  1. macOS Keychain ("Claude Code-credentials")
  2. ~/.claude/.credentials.json (Linux / older versions)

The credentials format (from Claude Code):
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "...",
    "subscriptionType": "default_claude_pro",
    "expiresAt": 1800000000000
  }
}
"""

import json
import platform
import subprocess
import webbrowser
from pathlib import Path

from .config import CONFIG_DIR, ensure_config_dir

TOKEN_FILE = CONFIG_DIR / "token.json"
CLAUDE_CREDENTIALS_FILE = Path.home() / ".claude" / ".credentials.json"


# ---------------------------------------------------------------------------
# Read Claude Code credentials (Keychain + file fallback)
# ---------------------------------------------------------------------------

def _read_keychain_credentials() -> dict | None:
    """Read credentials from macOS Keychain (Claude Code 2.x+)."""
    if platform.system() != "Darwin":
        return None
    try:
        raw = subprocess.run(
            ["/usr/bin/security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
            capture_output=True, text=True, timeout=5,
        )
        if raw.returncode != 0 or not raw.stdout.strip():
            return None
        return json.loads(raw.stdout.strip())
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
        return None


def _read_file_credentials() -> dict | None:
    """Read credentials from ~/.claude/.credentials.json (Linux / legacy)."""
    if not CLAUDE_CREDENTIALS_FILE.exists():
        return None
    try:
        return json.loads(CLAUDE_CREDENTIALS_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def _get_claude_code_credentials() -> dict | None:
    """Get Claude Code OAuth credentials, trying Keychain first then file."""
    for reader in (_read_keychain_credentials, _read_file_credentials):
        data = reader()
        if data and data.get("claudeAiOauth", {}).get("accessToken"):
            return data["claudeAiOauth"]
    return None


# ---------------------------------------------------------------------------
# Token storage (claudemon's own cache)
# ---------------------------------------------------------------------------

def store_token(token_data: dict) -> None:
    ensure_config_dir()
    TOKEN_FILE.write_text(json.dumps(token_data, indent=2))
    TOKEN_FILE.chmod(0o600)


def load_token() -> dict | None:
    if not TOKEN_FILE.exists():
        return None
    try:
        return json.loads(TOKEN_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def get_oauth_token() -> str | None:
    """Get a working OAuth token. Tries Claude Code credentials first,
    then falls back to claudemon's own stored token."""
    # Prefer Claude Code's live credentials (always fresh)
    creds = _get_claude_code_credentials()
    if creds:
        return creds.get("accessToken")

    # Fallback to manually stored token
    token_data = load_token()
    if token_data is None:
        return None
    return token_data.get("oauth_token")


def get_subscription_type() -> str | None:
    """Get subscription type from Claude Code credentials."""
    creds = _get_claude_code_credentials()
    if creds:
        return creds.get("subscriptionType")
    return None


def is_authenticated() -> bool:
    return get_oauth_token() is not None


def clear_token() -> None:
    if TOKEN_FILE.exists():
        TOKEN_FILE.unlink()


# ---------------------------------------------------------------------------
# Browser helper
# ---------------------------------------------------------------------------

def open_browser(url: str) -> bool:
    """Open URL in the default browser. Returns True if successful."""
    try:
        system = platform.system().lower()
        if system == "darwin":
            subprocess.Popen(
                ["open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            return True
        elif system == "linux":
            subprocess.Popen(
                ["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            return True
        elif system == "windows":
            subprocess.Popen(
                ["cmd", "/c", "start", url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        else:
            return webbrowser.open(url)
    except (OSError, FileNotFoundError):
        return webbrowser.open(url)


# ---------------------------------------------------------------------------
# Plan type detection
# ---------------------------------------------------------------------------

PLAN_NAMES = {
    "default_claude_pro": "pro",
    "default_claude_max_5x": "max",
    "default_claude_max_20x": "max",
}


def detect_plan_type() -> str:
    """Detect plan type from Claude Code credentials or usage API."""
    # First try from credentials metadata
    sub_type = get_subscription_type()
    if sub_type:
        plan = PLAN_NAMES.get(sub_type)
        if plan:
            return plan
        lower = sub_type.lower()
        if "max" in lower:
            return "max"
        if "pro" in lower:
            return "pro"

    # Fallback: try usage API
    token = get_oauth_token()
    if token:
        try:
            import httpx
            from .api import OAUTH_USAGE_URL, OAUTH_BETA_HEADER

            resp = httpx.get(
                OAUTH_USAGE_URL,
                headers={
                    "Authorization": f"Bearer {token}",
                    "anthropic-beta": OAUTH_BETA_HEADER,
                },
                timeout=10.0,
            )
            if resp.is_success:
                data = resp.json()
                return data.get("plan_type", data.get("planType", "pro"))
        except Exception:
            pass

    return "pro"


# ---------------------------------------------------------------------------
# Interactive setup
# ---------------------------------------------------------------------------

def interactive_setup() -> None:
    """Walk user through authentication setup."""
    from .config import load_config, save_config

    config = load_config()

    print("=" * 50)
    print("  Claudemon Setup — OAuth Authentication")
    print("=" * 50)
    print()

    # Check if Claude Code credentials already exist
    creds = _get_claude_code_credentials()
    if creds:
        print("Found existing Claude Code credentials.")
        token = creds.get("accessToken", "")
        print(f"  Token: {token[:12]}...{token[-4:]}" if len(token) > 16 else "  Token found")

        sub_type = creds.get("subscriptionType", "")
        plan = PLAN_NAMES.get(sub_type, sub_type)
        if plan:
            config["plan_type"] = plan if plan in ("pro", "max") else "pro"
            print(f"  Plan:  {plan.upper()}")

        save_config(config)
        print()
        print("Setup complete! Run 'claudemon' to launch the dashboard.")
        return

    # No Claude Code credentials — guide user through login
    print("Claudemon reads your Claude Code OAuth token to")
    print("monitor quota usage. You need to be logged in to")
    print("Claude Code first.")
    print()
    print("Run the following command to log in:")
    print("  claude /login")
    print()

    answer = input("Open Claude Code login in browser? [Y/n]: ").strip().lower()
    if answer in ("", "y", "yes"):
        # Open claude.ai login page
        open_browser("https://claude.ai/login")
        print()
        print("Complete the login in your browser, then run:")
        print("  claude /login")
        print()

    input("Press Enter after you've logged in to Claude Code...")
    print()

    # Re-check credentials
    creds = _get_claude_code_credentials()
    if creds:
        print("Credentials found!")
        sub_type = creds.get("subscriptionType", "")
        plan = PLAN_NAMES.get(sub_type, sub_type)
        if plan:
            config["plan_type"] = plan if plan in ("pro", "max") else "pro"
            print(f"  Plan: {plan.upper()}")
        save_config(config)
        print()
        print("Setup complete! Run 'claudemon' to launch the dashboard.")
    else:
        print("Could not find Claude Code credentials.")
        print("Make sure Claude Code is installed and you've run:")
        print("  claude /login")
        print()
        print("You can also paste your OAuth token manually.")
        token = input("OAuth token (or Enter to skip): ").strip()
        if token:
            store_token({"oauth_token": token})
            print("Token saved.")

            print("Detecting plan type...")
            plan = detect_plan_type()
            config["plan_type"] = plan
            print(f"  Plan: {plan.upper()}")

            save_config(config)
            print()
            print("Setup complete! Run 'claudemon' to launch the dashboard.")
        else:
            print("Setup incomplete. Run 'claudemon setup' again after logging in.")
