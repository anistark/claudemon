/**
 * Configuration management for claudemon.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseTOML } from "smol-toml";

export const CONFIG_DIR = join(homedir(), ".config", "claudemon");
export const CONFIG_FILE = join(CONFIG_DIR, "config.toml");

/**
 * Default configuration values.
 *
 * General:
 *   plan_type         - Claude subscription plan: "pro" or "max"
 *   refresh_interval  - Auto-refresh interval in seconds for the TUI dashboard
 *
 * OAuth (Anthropic PKCE flow):
 *   These are the public OAuth parameters used by Claude Code and other
 *   third-party tools to authenticate with Anthropic. The client_id is a
 *   public identifier for the OAuth application (not user-specific) — this
 *   is standard for PKCE flows which don't require a client secret.
 *
 *   oauth_client_id     - Public OAuth client ID for the Anthropic PKCE flow
 *   oauth_authorize_url - Authorization endpoint (user grants consent here)
 *   oauth_token_url     - Token exchange endpoint (code → access/refresh tokens)
 *   oauth_redirect_uri  - Redirect URI registered with the OAuth application
 *   oauth_scopes        - OAuth scopes requested during authorization
 *
 * API:
 *   oauth_usage_url   - Anthropic API endpoint for fetching quota/usage data
 *   oauth_beta_header - Required beta header for the usage API
 *
 * All values can be overridden in ~/.config/claudemon/config.toml
 */
const DEFAULT_CONFIG: Record<string, string | number | boolean> = {
  plan_type: "pro",
  refresh_interval: 5,
  oauth_client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  oauth_authorize_url: "https://claude.ai/oauth/authorize",
  oauth_token_url: "https://console.anthropic.com/v1/oauth/token",
  oauth_redirect_uri: "https://console.anthropic.com/oauth/code/callback",
  oauth_scopes: "org:create_api_key user:profile user:inference",
  oauth_usage_url: "https://api.anthropic.com/api/oauth/usage",
  oauth_beta_header: "oauth-2025-04-20",
};

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): Record<string, string | number | boolean> {
  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const config = parseTOML(raw) as Record<string, string | number | boolean>;
    return { ...DEFAULT_CONFIG, ...config };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(
  config: Record<string, string | number | boolean>,
): void {
  ensureConfigDir();
  const lines: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string") {
      lines.push(`${key} = "${value}"`);
    } else if (typeof value === "boolean") {
      lines.push(`${key} = ${value ? "true" : "false"}`);
    } else {
      lines.push(`${key} = ${value}`);
    }
  }
  writeFileSync(CONFIG_FILE, lines.join("\n") + "\n");
}

export function getConfigValue(
  key: string,
): string | number | boolean | undefined {
  const config = loadConfig();
  return config[key];
}

export function setConfigValue(
  key: string,
  value: string | number | boolean,
): void {
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
}
