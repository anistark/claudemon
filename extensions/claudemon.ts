/**
 * Pi extension for claudemon - Claude Usage Monitor.
 *
 * Registers:
 *   /claudemon        - Show quota usage inline (or launch TUI with --tui)
 *   claudemon tool    - LLM-callable tool to check Claude quota
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Token resolution (same logic as claudemon's auth.ts)
// ---------------------------------------------------------------------------

function readKeychainCredentials(): Record<string, unknown> | null {
  if (platform() !== "darwin") return null;
  try {
    const raw = execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { timeout: 5000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    if (!raw.trim()) return null;
    return JSON.parse(raw.trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readFileCredentials(): Record<string, unknown> | null {
  const credFile = join(homedir(), ".claude", ".credentials.json");
  if (!existsSync(credFile)) return null;
  try {
    return JSON.parse(readFileSync(credFile, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readClaudemonToken(): string | null {
  const tokenFile = join(homedir(), ".config", "claudemon", "token.json");
  if (!existsSync(tokenFile)) return null;
  try {
    const data = JSON.parse(readFileSync(tokenFile, "utf-8"));
    if (data.expires_at && data.expires_at < Date.now()) return null;
    return data.oauth_token ?? null;
  } catch {
    return null;
  }
}

function getOAuthToken(): string | null {
  // Prefer Claude Code's live credentials
  for (const reader of [readKeychainCredentials, readFileCredentials]) {
    const data = reader();
    if (data) {
      const oauth = data["claudeAiOauth"] as { accessToken?: string; expiresAt?: number } | undefined;
      if (oauth?.accessToken) {
        if (oauth.expiresAt && oauth.expiresAt < Date.now()) continue;
        return oauth.accessToken;
      }
    }
  }
  // Fallback to claudemon's own stored token
  return readClaudemonToken();
}

// ---------------------------------------------------------------------------
// Quota fetch (minimal inline version)
// ---------------------------------------------------------------------------

interface ModelQuota {
  modelName: string;
  usagePct: number;
}

interface QuotaData {
  fiveHourUsagePct: number;
  fiveHourResetTime: Date | null;
  sevenDayUsagePct: number;
  sevenDayResetTime: Date | null;
  modelQuotas: ModelQuota[];
  planType: string;
}

async function fetchQuota(token: string): Promise<QuotaData> {
  const resp = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (resp.status === 401 || resp.status === 403) {
    throw new Error("OAuth token expired. Run `claudemon setup` to re-authenticate.");
  }
  if (resp.status !== 200) {
    throw new Error(`API returned status ${resp.status}`);
  }

  const data = (await resp.json()) as Record<string, unknown>;
  return parseQuotaResponse(data);
}

function parseQuotaResponse(data: Record<string, unknown>): QuotaData {
  const fiveHour = (data["five_hour"] ?? data["fiveHour"] ?? {}) as Record<string, unknown>;
  const sevenDay = (data["seven_day"] ?? data["sevenDay"] ?? {}) as Record<string, unknown>;
  const models = (data["models"] ?? data["model_quotas"] ?? []) as Array<Record<string, unknown>>;

  const fiveHourReset = (fiveHour["resets_at"] ?? fiveHour["reset_at"] ?? fiveHour["resetAt"]) as string | undefined;
  const sevenDayReset = (sevenDay["resets_at"] ?? sevenDay["reset_at"] ?? sevenDay["resetAt"]) as string | undefined;

  return {
    fiveHourUsagePct: (fiveHour["utilization"] as number) ?? (fiveHour["usage_pct"] as number) ?? 0,
    fiveHourResetTime: fiveHourReset ? new Date(fiveHourReset) : null,
    sevenDayUsagePct: (sevenDay["utilization"] as number) ?? (sevenDay["usage_pct"] as number) ?? 0,
    sevenDayResetTime: sevenDayReset ? new Date(sevenDayReset) : null,
    modelQuotas: models.map((m) => ({
      modelName: (m["model"] as string) ?? (m["name"] as string) ?? "unknown",
      usagePct: (m["utilization"] as number) ?? (m["usage_pct"] as number) ?? 0,
    })),
    planType: (data["plan_type"] as string) ?? (data["planType"] as string) ?? "pro",
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return "now";
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function usageBar(pct: number, width = 20): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${pct.toFixed(1)}%`;
}

function formatQuota(q: QuotaData): string {
  const lines: string[] = [];
  lines.push(`📊 Claude Usage (${q.planType.toUpperCase()} plan)`);
  lines.push("");

  // 5-hour window
  const fiveHourReset = q.fiveHourResetTime
    ? formatCountdown(Math.max(0, (q.fiveHourResetTime.getTime() - Date.now()) / 1000))
    : "—";
  lines.push(`5-hour:  ${usageBar(q.fiveHourUsagePct)}  resets in ${fiveHourReset}`);

  // 7-day window
  const sevenDayReset = q.sevenDayResetTime
    ? formatCountdown(Math.max(0, (q.sevenDayResetTime.getTime() - Date.now()) / 1000))
    : "—";
  lines.push(`7-day:   ${usageBar(q.sevenDayUsagePct)}  resets in ${sevenDayReset}`);

  // Per-model breakdown
  if (q.modelQuotas.length > 0) {
    lines.push("");
    lines.push("Per model:");
    for (const m of q.modelQuotas) {
      lines.push(`  ${m.modelName.padEnd(30)} ${usageBar(m.usagePct)}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // /claudemon command — show quota inline or launch TUI
  pi.registerCommand("claudemon", {
    description: "Show Claude usage quota (--tui to launch dashboard)",
    handler: async (args, ctx) => {
      const trimmed = (args ?? "").trim();

      // --tui flag: launch the full TUI dashboard
      if (trimmed === "--tui" || trimmed === "-t") {
        const result = await pi.exec("npx", ["claudemon"], { timeout: 300000 });
        if (result.code !== 0 && result.stderr) {
          ctx.ui.notify(`claudemon exited with error: ${result.stderr.slice(0, 200)}`, "error");
        }
        return;
      }

      // Default: fetch and display inline
      const token = getOAuthToken();
      if (!token) {
        ctx.ui.notify(
          "Not authenticated. Run `claudemon setup` or `npx claudemon setup` first.",
          "error",
        );
        return;
      }

      try {
        ctx.ui.setStatus("claudemon", "Fetching quota…");
        const quota = await fetchQuota(token);
        ctx.ui.setStatus("claudemon", undefined);
        ctx.ui.notify(formatQuota(quota), "info");
      } catch (err) {
        ctx.ui.setStatus("claudemon", undefined);
        ctx.ui.notify(`Failed to fetch quota: ${err instanceof Error ? err.message : err}`, "error");
      }
    },
  });

  // LLM-callable tool
  pi.registerTool({
    name: "claudemon",
    label: "Claude Usage Monitor",
    description:
      "Check the user's Claude Pro/Max plan quota usage including 5-hour and 7-day windows and per-model breakdown. Use when the user asks about their Claude usage, quota, or remaining capacity.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal) {
      const token = getOAuthToken();
      if (!token) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Not authenticated. The user needs to run `claudemon setup` or `npx claudemon setup` to authenticate first.",
            },
          ],
          isError: true,
        };
      }

      try {
        const quota = await fetchQuota(token);
        return {
          content: [{ type: "text" as const, text: formatQuota(quota) }],
          details: {
            fiveHourUsagePct: quota.fiveHourUsagePct,
            sevenDayUsagePct: quota.sevenDayUsagePct,
            planType: quota.planType,
            modelQuotas: quota.modelQuotas,
          },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to fetch quota: ${err instanceof Error ? err.message : err}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
