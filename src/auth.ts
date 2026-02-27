/**
 * OAuth authentication and token management for claudemon.
 *
 * Reads Claude Code's OAuth credentials from:
 *   1. macOS Keychain ("Claude Code-credentials")
 *   2. ~/.claude/.credentials.json (Linux / older versions)
 *
 * Can also perform its own OAuth PKCE flow against Anthropic's endpoints.
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
import { webcrypto } from "node:crypto";

import { CONFIG_DIR, ensureConfigDir, loadConfig, saveConfig } from "./config.js";

const TOKEN_FILE = join(CONFIG_DIR, "token.json");
const CLAUDE_CREDENTIALS_FILE = join(homedir(), ".claude", ".credentials.json");

// OAuth config is read from config.toml (with sensible defaults)

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
      if (oauth?.accessToken) {
        // Skip expired credentials
        if (oauth.expiresAt && oauth.expiresAt < Date.now()) continue;
        return oauth;
      }
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
  // Prefer Claude Code's live credentials (skips expired ones)
  const creds = getClaudeCodeCredentials();
  if (creds?.accessToken) return creds.accessToken;

  // Fallback to claudemon's own stored token
  const tokenData = loadToken();
  if (!tokenData) return null;

  // Check expiry on stored token
  const expiresAt = tokenData["expires_at"] as number | undefined;
  if (expiresAt && expiresAt < Date.now()) return null;

  return (tokenData["oauth_token"] as string) ?? null;
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/**
 * Refresh an expired OAuth token using the stored refresh_token.
 * Posts to the token endpoint with grant_type=refresh_token.
 * On success, saves the new tokens and returns the new access token.
 */
async function refreshStoredToken(): Promise<string | null> {
  const tokenData = loadToken();
  if (!tokenData) return null;

  const refreshToken = tokenData["refresh_token"] as string | undefined;
  if (!refreshToken) return null;

  const config = loadConfig();
  const clientId = config["oauth_client_id"] as string;
  const tokenUrl = config["oauth_token_url"] as string;

  let resp: Response;
  try {
    resp = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return null;
  }

  if (!resp.ok) return null;

  const data = (await resp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const expiresAt = Date.now() + data.expires_in * 1000 - 5 * 60 * 1000;

  storeToken({
    oauth_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
  });

  return data.access_token;
}

/**
 * Get a valid OAuth token, automatically refreshing if expired.
 * Use this instead of getOAuthToken() in async contexts where
 * you want transparent token renewal.
 */
export async function getValidOAuthToken(): Promise<string | null> {
  // 1. Try sync path first (returns non-expired token if available)
  const token = getOAuthToken();
  if (token) return token;

  // 2. Token is expired or missing — try refreshing claudemon's own stored token
  const refreshed = await refreshStoredToken();
  if (refreshed) return refreshed;

  return null;
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
// PKCE OAuth flow
// ---------------------------------------------------------------------------

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const crypto = webcrypto as unknown as Crypto;
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64urlEncode(verifierBytes);

  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const challenge = base64urlEncode(new Uint8Array(hashBuffer));

  return { verifier, challenge };
}

async function oauthLogin(): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const config = loadConfig();
  const clientId = config["oauth_client_id"] as string;
  const authorizeUrl = config["oauth_authorize_url"] as string;
  const tokenUrl = config["oauth_token_url"] as string;
  const redirectUri = config["oauth_redirect_uri"] as string;
  const scopes = config["oauth_scopes"] as string;

  const { verifier, challenge } = await generatePKCE();

  const authParams = new URLSearchParams({
    code: "true",
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: scopes,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: verifier,
  });

  const authUrl = `${authorizeUrl}?${authParams.toString()}`;

  console.log("Opening Anthropic OAuth page in your browser...");
  console.log();
  openBrowser(authUrl);
  console.log(`If the browser didn't open, visit this URL:`);
  console.log(`  ${authUrl}`);
  console.log();
  console.log("After authorizing, you'll be redirected to a page with a code.");
  console.log("Copy the full authorization code (in the format: code#state).");
  console.log();

  const rl = createInterface({ input: stdin, output: stdout });
  const authCode = await rl.question("Paste the authorization code here: ");
  rl.close();

  if (!authCode.trim()) {
    throw new Error("No authorization code provided.");
  }

  const splits = authCode.trim().split("#");
  const code = splits[0];
  const state = splits[1];

  // Exchange code for tokens
  const tokenResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      state,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const expiresAt = Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000;

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt,
  };
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
  } else {
    console.log("No Claude Code credentials found.");
    console.log();
  }

  // OAuth PKCE flow
  try {
    const tokens = await oauthLogin();
    storeToken({
      oauth_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt,
    });
    console.log();
    console.log("Token saved.");

    console.log("Detecting plan type...");
    const detectedPlan = detectPlanType();
    config["plan_type"] = detectedPlan;
    console.log(`  Plan: ${detectedPlan.toUpperCase()}`);

    saveConfig(config);
    console.log();
    console.log("Setup complete! Run 'claudemon' to launch the dashboard.");
  } catch (err) {
    console.error();
    console.error(`OAuth login failed: ${err instanceof Error ? err.message : err}`);
    console.log("Run 'claudemon setup' to try again.");
  }
}
