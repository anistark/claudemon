"""Configuration management for claudemon."""

import tomllib
from pathlib import Path

CONFIG_DIR = Path.home() / ".config" / "claudemon"
CONFIG_FILE = CONFIG_DIR / "config.toml"

DEFAULT_CONFIG = {
    "plan_type": "pro",
    "refresh_interval": 5,
    "admin_api_key": "",
}


def ensure_config_dir() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)


def load_config() -> dict:
    if not CONFIG_FILE.exists():
        return dict(DEFAULT_CONFIG)
    with open(CONFIG_FILE, "rb") as f:
        config = tomllib.load(f)
    merged = dict(DEFAULT_CONFIG)
    merged.update(config)
    return merged


def save_config(config: dict) -> None:
    ensure_config_dir()
    lines = []
    for key, value in config.items():
        if isinstance(value, str):
            lines.append(f'{key} = "{value}"')
        elif isinstance(value, bool):
            lines.append(f"{key} = {'true' if value else 'false'}")
        elif isinstance(value, int):
            lines.append(f"{key} = {value}")
        else:
            lines.append(f'{key} = "{value}"')
    CONFIG_FILE.write_text("\n".join(lines) + "\n")


def get_config_value(key: str) -> str | int | None:
    config = load_config()
    return config.get(key)


def set_config_value(key: str, value: str | int) -> None:
    config = load_config()
    config[key] = value
    save_config(config)
