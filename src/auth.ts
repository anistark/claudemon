/**
 * OAuth authentication and token management for claudemon.
 *
 * Reads Claude Code's OAuth credentials from:
 *   1. macOS Keychain ("Claude Code-credentials")
 *   2. ~/.claude/.credentials.json (Linux / older versions)
 */

import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { CONFIG_DIR, ensureConfigDir, loadConfig, saveConfig } from "./config.js";

const TOKEN_FILE = join(CONFIG_DIR, "token.json");
const CLAUDE_CREDENTIALS_FILE = join(homedir(), ".claude", ".credentials.json");

// ---------------------------------------------------------------------------
// Read Claude Code credentials (Keychain + file fallback)
// ---------------------------------------------------------------------------

interface OAuthCredentials {
  accessToken?: string;
  refreshToken?: string;
  subscriptionType?: string;
  expiresAt?: number;
}

function readKeychainCredentials(): Record<string, unknown> | null {
  if (platform() !== "darwin") return null;
  try {
    const raw = execFileSync(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-s",
        "Claude Code-credentials",
        "-w",
      ],
      { timeout: 5000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    if (!raw.trim()) return null;
    return JSON.parse(raw.trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readFileCredentials(): Record<string, unknown> | null {
  if (!existsSync(CLAUDE_CREDENTIALS_FILE)) return null;
  try {
    const raw = readFileSync(CLAUDE_CREDENTIALS_FILE, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getClaudeCodeCredentials(): OAuthCredentials | null {
  for (const reader of [readKeychainCredentials, readFileCredentials]) {
    const data = reader();
    if (data) {
      const oauth = data["claudeAiOauth"] as OAuthCredentials | undefined;
      if (oauth?.accessToken) return oauth;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Token storage (claudemon's own cache)
// ---------------------------------------------------------------------------

export function storeToken(tokenData: Record<string, unknown>): void {
  ensureConfigDir();
  writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
  chmodSync(TOKEN_FILE, 0o600);
}

export function loadToken(): Record<string, unknown> | null {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export function getOAuthToken(): string | null {
  // Prefer Claude Code's live credentials (always fresh)
  const creds = getClaudeCodeCredentials();
  if (creds?.accessToken) return creds.accessToken;

  // Fallback to manually stored token
  const tokenData = loadToken();
  if (!tokenData) return null;
  return (tokenData["oauth_token"] as string) ?? null;
}

export function getSubscriptionType(): string | null {
  const creds = getClaudeCodeCredentials();
  return creds?.subscriptionType ?? null;
}

export function isAuthenticated(): boolean {
  return getOAuthToken() !== null;
}

export function clearToken(): void {
  if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
}

// ---------------------------------------------------------------------------
// Browser helper
// ---------------------------------------------------------------------------

export function openBrowser(url: string): boolean {
  try {
    const sys = platform().toLowerCase();
    if (sys === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
      return true;
    } else if (sys === "linux") {
      spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
      return true;
    } else if (sys === "win32") {
      spawn("cmd", ["/c", "start", url], {
        stdio: "ignore",
        detached: true,
      }).unref();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Plan type detection
// ---------------------------------------------------------------------------

const PLAN_NAMES: Record<string, string> = {
  default_claude_pro: "pro",
  default_claude_max_5x: "max",
  default_claude_max_20x: "max",
};

export function detectPlanType(): string {
  const subType = getSubscriptionType();
  if (subType) {
    const plan = PLAN_NAMES[subType];
    if (plan) return plan;
    const lower = subType.toLowerCase();
    if (lower.includes("max")) return "max";
    if (lower.includes("pro")) return "pro";
  }
  return "pro";
}

// ---------------------------------------------------------------------------
// Interactive setup
// ---------------------------------------------------------------------------

export async function interactiveSetup(forceReauth = false): Promise<void> {
  const config = loadConfig();

  console.log("=".repeat(50));
  console.log("  Claudemon Setup — OAuth Authentication");
  console.log("=".repeat(50));
  console.log();

  // Check if Claude Code credentials already exist
  const creds = getClaudeCodeCredentials();
  if (creds && !forceReauth) {
    console.log("Found existing Claude Code credentials.");
    const token = creds.accessToken ?? "";
    if (token.length > 16) {
      console.log(`  Token: ${token.slice(0, 12)}...${token.slice(-4)}`);
    } else {
      console.log("  Token found");
    }

    const subType = creds.subscriptionType ?? "";
    const plan = PLAN_NAMES[subType] ?? subType;
    if (plan) {
      config["plan_type"] = plan === "pro" || plan === "max" ? plan : "pro";
      console.log(`  Plan:  ${(plan as string).toUpperCase()}`);
    }

    saveConfig(config);
    console.log();
    console.log("Setup complete! Run 'claudemon' to launch the dashboard.");
    return;
  }

  if (forceReauth) {
    console.log("Re-authenticating (overwriting existing credentials)...");
    clearToken();
    console.log();
  }

  // No Claude Code credentials — guide user through login
  console.log("Claudemon reads your Claude Code OAuth token to");
  console.log("monitor quota usage. You need to be logged in to");
  console.log("Claude Code first.");
  console.log();
  console.log("Run the following command to log in:");
  console.log("  claude /login");
  console.log();

  const rl = createInterface({ input: stdin, output: stdout });

  const answer = await rl.question(
    "Open Claude Code login in browser? [Y/n]: ",
  );
  if (["", "y", "yes"].includes(answer.trim().toLowerCase())) {
    openBrowser("https://claude.ai/login");
    console.log();
    console.log("Complete the login in your browser, then run:");
    console.log("  claude /login");
    console.log();
  }

  await rl.question("Press Enter after you've logged in to Claude Code...");
  console.log();

  // Re-check credentials
  const newCreds = getClaudeCodeCredentials();
  if (newCreds) {
    console.log("Credentials found!");
    const subType = newCreds.subscriptionType ?? "";
    const plan = PLAN_NAMES[subType] ?? subType;
    if (plan) {
      config["plan_type"] = plan === "pro" || plan === "max" ? plan : "pro";
      console.log(`  Plan: ${(plan as string).toUpperCase()}`);
    }
    saveConfig(config);
    console.log();
    console.log("Setup complete! Run 'claudemon' to launch the dashboard.");
  } else {
    console.log("Could not find Claude Code credentials.");
    console.log("Make sure Claude Code is installed and you've run:");
    console.log("  claude /login");
    console.log();
    console.log("You can also paste your OAuth token manually.");
    const token = await rl.question("OAuth token (or Enter to skip): ");
    if (token.trim()) {
      storeToken({ oauth_token: token.trim() });
      console.log("Token saved.");

      console.log("Detecting plan type...");
      const detectedPlan = detectPlanType();
      config["plan_type"] = detectedPlan;
      console.log(`  Plan: ${detectedPlan.toUpperCase()}`);

      saveConfig(config);
      console.log();
      console.log("Setup complete! Run 'claudemon' to launch the dashboard.");
    } else {
      console.log(
        "Setup incomplete. Run 'claudemon setup' again after logging in.",
      );
    }
  }

  rl.close();
}
