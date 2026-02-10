"""OAuth authentication and token management for claudemon."""

import json

from .config import CONFIG_DIR, ensure_config_dir

TOKEN_FILE = CONFIG_DIR / "token.json"


def store_token(token_data: dict) -> None:
    ensure_config_dir()
    TOKEN_FILE.write_text(json.dumps(token_data, indent=2))
    TOKEN_FILE.chmod(0o600)


def load_token() -> dict | None:
    if not TOKEN_FILE.exists():
        return None
    try:
        return json.loads(TOKEN_FILE.read_text())
    except json.JSONDecodeError, OSError:
        return None


def get_oauth_token() -> str | None:
    token_data = load_token()
    if token_data is None:
        return None
    return token_data.get("oauth_token")


def get_admin_api_key() -> str | None:
    from .config import get_config_value

    key = get_config_value("admin_api_key")
    if key and isinstance(key, str) and key.strip():
        return key.strip()
    return None


def is_authenticated() -> bool:
    return get_oauth_token() is not None


def clear_token() -> None:
    if TOKEN_FILE.exists():
        TOKEN_FILE.unlink()


def interactive_setup(api_only: bool = False) -> None:
    """Walk user through authentication setup."""
    from .config import load_config, save_config

    config = load_config()

    if not api_only:
        print("=" * 50)
        print("  Claudemon Setup — OAuth Authentication")
        print("=" * 50)
        print()
        print("To monitor your Claude Pro/Max quota, claudemon")
        print("needs an OAuth token from your Claude account.")
        print()
        print("You can find your OAuth token by running:")
        print("  claude setup-token")
        print()
        print("Or extract it from your Claude Code config at:")
        print("  ~/.claude/credentials.json")
        print()

        token = input("Paste your OAuth token: ").strip()
        if token:
            store_token({"oauth_token": token})
            print("Token saved successfully.")
        else:
            print("No token provided, skipping.")

        print()
        plan = input("Plan type (pro/max) [pro]: ").strip().lower() or "pro"
        if plan in ("pro", "max"):
            config["plan_type"] = plan
        else:
            print(f"Unknown plan type '{plan}', defaulting to 'pro'.")
            config["plan_type"] = "pro"

    print()
    print("--- Admin API (optional) ---")
    print("For API usage monitoring, provide an Admin API key.")
    print("(starts with sk-ant-admin...)")
    print()
    api_key = input("Admin API key (leave blank to skip): ").strip()
    if api_key:
        config["admin_api_key"] = api_key
        print("Admin API key saved.")
    else:
        print("Skipped Admin API setup.")

    save_config(config)
    print()
    print("Setup complete! Run 'claudemon' to launch the dashboard.")
