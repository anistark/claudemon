/**
 * Pi extension for claudemon - Claude Usage Monitor.
 *
 * Registers:
 *   /claudemon        - Show quota usage inline (or launch TUI with --tui)
 *   claudemon tool    - LLM-callable tool to check Claude quota
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
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
// TUI Dashboard Component (replaces broken pi.exec approach)
// ---------------------------------------------------------------------------

function formatResetTime(reset: Date): string {
  const diffMs = reset.getTime() - Date.now();
  if (diffMs <= 0) return "now";
  const totalMinutes = Math.floor(diffMs / 60000);
  const totalHours = Math.floor(diffMs / 3600000);
  const totalDays = Math.floor(diffMs / 86400000);
  if (totalMinutes < 1) return "in <1 min";
  if (totalMinutes < 60) return `in ${totalMinutes}m`;
  if (totalHours < 24) {
    const remainingMin = totalMinutes % 60;
    return remainingMin === 0 ? `in ${totalHours}h` : `in ${totalHours}h ${remainingMin}m`;
  }
  const remainingHrs = totalHours % 24;
  return remainingHrs === 0 ? `in ${totalDays}d` : `in ${totalDays}d ${remainingHrs}h`;
}

function getColorFn(pct: number, theme: any): (s: string) => string {
  if (pct < 50) return (s: string) => theme.fg("success", s);
  if (pct < 80) return (s: string) => theme.fg("warning", s);
  return (s: string) => theme.fg("error", s);
}

function renderDonut(pct: number, label: string, resetTime: Date | null, theme: any): string[] {
  const clamped = Math.max(0, Math.min(100, pct));
  const colorFn = getColorFn(clamped, theme);

  const outerR = 6.5;
  const innerR = 5.0;
  const rows = Math.floor(outerR * 2) + 1;
  const cols = Math.floor(outerR * 4) + 1;
  const usedAngle = 2 * Math.PI * (clamped / 100);
  const centerY = outerR;
  const centerX = outerR * 2;

  const grid: { char: string; style: ((s: string) => string) | null }[][] = [];

  for (let row = 0; row < rows; row++) {
    const line: { char: string; style: ((s: string) => string) | null }[] = [];
    for (let col = 0; col < cols; col++) {
      const dy = row - centerY;
      const dx = (col - centerX) / 2.0;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (innerR <= dist && dist <= outerR) {
        let angle = Math.atan2(dx, -dy);
        if (angle < 0) angle += 2 * Math.PI;
        if (angle <= usedAngle) {
          line.push({ char: "█", style: colorFn });
        } else {
          line.push({ char: "░", style: (s: string) => theme.fg("dim", s) });
        }
      } else {
        line.push({ char: " ", style: null });
      }
    }
    grid.push(line);
  }

  // Place percentage in center
  const pctStr = `${Math.round(clamped)}%`;
  const centerRow = Math.floor(rows / 2);
  const startCol = Math.floor(centerX - pctStr.length / 2);
  for (let i = 0; i < pctStr.length; i++) {
    const colIdx = startCol + i;
    if (colIdx >= 0 && colIdx < cols) {
      grid[centerRow]![colIdx] = { char: pctStr[i]!, style: (s: string) => theme.bold(colorFn(s)) };
    }
  }

  // Place label below percentage
  const labelRow = centerRow + 1;
  const labelStart = Math.floor(centerX - label.length / 2);
  if (labelRow < rows) {
    for (let i = 0; i < label.length; i++) {
      const colIdx = labelStart + i;
      if (colIdx >= 0 && colIdx < cols) {
        grid[labelRow]![colIdx] = { char: label[i]!, style: (s: string) => theme.fg("muted", s) };
      }
    }
  }

  // Render grid to lines
  const lines: string[] = [];
  for (const row of grid) {
    let line = "";
    for (const cell of row) {
      line += cell.style ? cell.style(cell.char) : cell.char;
    }
    lines.push(line);
  }

  // Reset time line
  if (resetTime) {
    const resetStr = `Resets ${formatResetTime(resetTime)}`;
    const pad = Math.max(0, Math.floor((cols - resetStr.length) / 2));
    lines.push(" ".repeat(pad) + theme.fg("dim", resetStr));
  } else {
    lines.push("");
  }

  return lines;
}

function renderModelQuotas(quotaData: QuotaData, theme: any, width: number): string[] {
  if (quotaData.modelQuotas.length === 0) return [];

  const lines: string[] = [];
  lines.push(theme.bold("  Per-Model Breakdown"));
  lines.push("");

  for (let i = 0; i < quotaData.modelQuotas.length; i++) {
    const mq = quotaData.modelQuotas[i]!;
    const prefix = i === quotaData.modelQuotas.length - 1 ? "  └ " : "  ├ ";
    const colorFn = getColorFn(mq.usagePct, theme);
    const barWidth = 15;
    const filled = Math.round((mq.usagePct / 100) * barWidth);
    const empty = barWidth - filled;
    const bar = colorFn("█".repeat(filled)) + theme.fg("dim", "░".repeat(empty));
    const pctStr = colorFn(`${Math.round(mq.usagePct)}%`.padStart(4));
    const name = mq.modelName.length > 28 ? mq.modelName.slice(0, 25) + "..." : mq.modelName;
    lines.push(`${prefix}${name.padEnd(28)} ${bar} ${pctStr}`);
  }

  return lines;
}

class ClaudemonDashboard {
  private quotaData: QuotaData | null = null;
  private isLoading = true;
  private errorMessage = "";
  private lastRefreshAgo = 0;
  private lastRefreshTime = 0;
  private showHelp = false;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private autoRefreshInterval: ReturnType<typeof setInterval> | null = null;
  private tui: { requestRender: () => void };
  private theme: any;
  private onClose: () => void;
  private token: string;
  private cachedWidth = 0;
  private cachedLines: string[] = [];
  private version = 0;
  private cachedVersion = -1;

  constructor(
    tui: { requestRender: () => void },
    theme: any,
    token: string,
    onClose: () => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.token = token;
    this.onClose = onClose;

    // Initial fetch
    this.doRefresh();

    // Auto-refresh every 30 seconds
    this.autoRefreshInterval = setInterval(() => this.doRefresh(), 30000);

    // Tick the "last refreshed" counter every second
    this.tickInterval = setInterval(() => {
      if (this.lastRefreshTime > 0) {
        this.lastRefreshAgo = Math.floor((Date.now() - this.lastRefreshTime) / 1000);
        this.version++;
        this.tui.requestRender();
      }
    }, 1000);
  }

  private async doRefresh(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = "";
    this.version++;
    this.tui.requestRender();

    try {
      const quota = await fetchQuota(this.token);
      this.quotaData = quota;
      this.lastRefreshTime = Date.now();
      this.lastRefreshAgo = 0;
      this.isLoading = false;
    } catch (e) {
      this.isLoading = false;
      this.errorMessage = e instanceof Error ? e.message : String(e);
    }
    this.version++;
    this.tui.requestRender();
  }

  private dispose(): void {
    if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  handleInput(data: string): void {
    if (matchesKey(data, "q") || matchesKey(data, "escape")) {
      this.dispose();
      this.onClose();
    } else if (matchesKey(data, "r")) {
      this.doRefresh();
    } else if (data === "?") {
      this.showHelp = !this.showHelp;
      this.version++;
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    if (this.cachedVersion === this.version && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const theme = this.theme;
    const lines: string[] = [];

    // Top border
    lines.push(theme.fg("border", "─".repeat(width)));

    // Header
    const planType = this.quotaData?.planType ?? "pro";
    const title = theme.bold("✨ Claude Usage Monitor") + " " + theme.fg("accent", `[${planType.toUpperCase()}]`);
    let status: string;
    if (this.errorMessage) {
      status = theme.fg("error", `! ${this.errorMessage}`);
    } else if (this.isLoading) {
      status = theme.fg("dim", "⟳ loading...");
    } else if (this.lastRefreshAgo === 0) {
      status = theme.fg("success", "⟳ just now");
    } else {
      status = theme.fg("dim", `⟳ ${this.lastRefreshAgo}s ago`);
    }

    const titleWidth = visibleWidth(title);
    const statusWidth = visibleWidth(status);
    const gap = Math.max(1, width - titleWidth - statusWidth - 4);
    lines.push("  " + title + " ".repeat(gap) + status + "  ");
    lines.push(theme.fg("border", "─".repeat(width)));

    if (this.showHelp) {
      // Help screen
      lines.push("");
      lines.push(theme.bold("  Keybindings"));
      lines.push("");
      lines.push("  " + theme.fg("accent", "q / Esc") + "  — Close dashboard");
      lines.push("  " + theme.fg("accent", "r") + "       — Force refresh");
      lines.push("  " + theme.fg("accent", "?") + "       — Toggle help");
      lines.push("");
    } else if (!this.quotaData && this.isLoading) {
      // Loading state
      lines.push("");
      lines.push("  " + theme.fg("dim", "Loading quota data..."));
      lines.push("");
    } else if (!this.quotaData && this.errorMessage) {
      // Error state
      lines.push("");
      lines.push("  " + theme.fg("error", this.errorMessage));
      lines.push("");
    } else if (this.quotaData) {
      // Donut charts side by side
      const fiveHourLines = renderDonut(
        this.quotaData.fiveHourUsagePct,
        "5-Hour Quota",
        this.quotaData.fiveHourResetTime,
        theme,
      );
      const sevenDayLines = renderDonut(
        this.quotaData.sevenDayUsagePct,
        "Weekly Quota",
        this.quotaData.sevenDayResetTime,
        theme,
      );

      // Determine chart widths
      const chartWidth = Math.max(...fiveHourLines.map(l => visibleWidth(l)), ...sevenDayLines.map(l => visibleWidth(l)));
      const gapBetween = 6;
      const totalChartsWidth = chartWidth * 2 + gapBetween;
      const leftPad = Math.max(2, Math.floor((width - totalChartsWidth) / 2));

      const maxLines = Math.max(fiveHourLines.length, sevenDayLines.length);
      lines.push("");
      for (let i = 0; i < maxLines; i++) {
        const left = fiveHourLines[i] ?? "";
        const right = sevenDayLines[i] ?? "";
        const leftPadded = left + " ".repeat(Math.max(0, chartWidth - visibleWidth(left)));
        const row = " ".repeat(leftPad) + leftPadded + " ".repeat(gapBetween) + right;
        lines.push(truncateToWidth(row, width));
      }
      lines.push("");

      // Model quotas
      const modelLines = renderModelQuotas(this.quotaData, theme, width);
      if (modelLines.length > 0) {
        lines.push(theme.fg("border", "─".repeat(width)));
        for (const ml of modelLines) {
          lines.push(truncateToWidth(ml, width));
        }
        lines.push("");
      }
    }

    // Footer
    lines.push(theme.fg("border", "─".repeat(width)));
    const helpText = theme.fg("dim", "q: Close  r: Refresh  ?: Help");
    lines.push("  " + helpText);

    this.cachedLines = lines;
    this.cachedWidth = width;
    this.cachedVersion = this.version;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = 0;
    this.cachedVersion = -1;
  }
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // /claudemon command — show quota inline or launch TUI dashboard
  pi.registerCommand("claudemon", {
    description: "Show Claude usage quota (--tui to launch dashboard)",
    handler: async (args, ctx) => {
      const trimmed = (args ?? "").trim();

      // --tui flag: launch the native pi TUI dashboard
      if (trimmed === "--tui" || trimmed === "-t") {
        const token = getOAuthToken();
        if (!token) {
          ctx.ui.notify(
            "Not authenticated. Run `claudemon setup` or `npx claudemon setup` first.",
            "error",
          );
          return;
        }

        await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
          const dashboard = new ClaudemonDashboard(tui, theme, token, () => done());
          return {
            render: (w: number) => dashboard.render(w),
            invalidate: () => dashboard.invalidate(),
            handleInput: (data: string) => dashboard.handleInput(data),
          };
        });

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
