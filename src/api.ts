/**
 * API client for Claude OAuth usage endpoint.
 */

import { type ModelQuota, type QuotaData, createQuotaData } from "./models.js";
import { loadConfig } from "./config.js";

export class QuotaFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaFetchError";
  }
}

export class AuthenticationError extends QuotaFetchError {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function fetchQuota(oauthToken: string): Promise<QuotaData> {
  const config = loadConfig();
  const usageUrl = config["oauth_usage_url"] as string;
  const betaHeader = config["oauth_beta_header"] as string;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${oauthToken}`,
    "anthropic-beta": betaHeader,
  };

  let resp: Response;
  try {
    resp = await fetch(usageUrl, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new QuotaFetchError(`Network error: ${e}`);
  }

  if (resp.status === 401) {
    throw new AuthenticationError(
      "OAuth token is invalid or expired. Run 'claudemon setup' to re-authenticate.",
    );
  }
  if (resp.status === 403) {
    throw new AuthenticationError(
      "Access denied. Your token may lack the required permissions.",
    );
  }
  if (resp.status !== 200) {
    const text = await resp.text();
    throw new QuotaFetchError(
      `API returned status ${resp.status}: ${text}`,
    );
  }

  const data = (await resp.json()) as Record<string, unknown>;
  return parseQuotaResponse(data);
}

/**
 * Quick health-check: verifies that an OAuth token exists and is accepted
 * by the API.  Returns `{ ok: true }` on success, or `{ ok: false, reason }`
 * on failure.
 */
export async function validateToken(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const { getValidOAuthToken } = await import("./auth.js");
  const token = await getValidOAuthToken();

  if (!token) {
    return {
      ok: false,
      reason: "No OAuth token found. Please run 'claudemon setup' first.",
    };
  }

  const config = loadConfig();
  const usageUrl = config["oauth_usage_url"] as string;
  const betaHeader = config["oauth_beta_header"] as string;

  try {
    const resp = await fetch(usageUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": betaHeader,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (resp.status === 401) {
      return {
        ok: false,
        reason: "OAuth token is invalid or expired. Please run 'claudemon setup --re' to re-authenticate.",
      };
    }
    if (resp.status === 403) {
      return {
        ok: false,
        reason: "Access denied. Your token may lack the required permissions. Run 'claudemon setup --re'.",
      };
    }
    if (resp.status !== 200) {
      const text = await resp.text();
      return {
        ok: false,
        reason: `API returned status ${resp.status}: ${text}`,
      };
    }

    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: `Network error while validating token: ${e}`,
    };
  }
}

function parseQuotaResponse(data: Record<string, unknown>): QuotaData {
  const quota = createQuotaData();

  // Parse 5-hour window
  const fiveHour = (data["five_hour"] ?? data["fiveHour"] ?? {}) as Record<
    string,
    unknown
  >;
  if (fiveHour) {
    quota.fiveHourUsagePct =
      (fiveHour["utilization"] as number) ??
      (fiveHour["usage_pct"] as number) ??
      0;
    const resetAt =
      (fiveHour["resets_at"] as string) ??
      (fiveHour["reset_at"] as string) ??
      (fiveHour["resetAt"] as string);
    if (resetAt) {
      quota.fiveHourResetTime = parseISOTime(resetAt);
    }
  }

  // Parse 7-day window
  const sevenDay = (data["seven_day"] ?? data["sevenDay"] ?? {}) as Record<
    string,
    unknown
  >;
  if (sevenDay) {
    quota.sevenDayUsagePct =
      (sevenDay["utilization"] as number) ??
      (sevenDay["usage_pct"] as number) ??
      0;
    const resetAt =
      (sevenDay["resets_at"] as string) ??
      (sevenDay["reset_at"] as string) ??
      (sevenDay["resetAt"] as string);
    if (resetAt) {
      quota.sevenDayResetTime = parseISOTime(resetAt);
    }
  }

  // Parse model-specific quotas
  const models = (data["models"] ?? data["model_quotas"] ?? []) as Array<
    Record<string, unknown>
  >;
  for (const m of models) {
    const name =
      (m["model"] as string) ?? (m["name"] as string) ?? "unknown";
    const usage =
      (m["utilization"] as number) ?? (m["usage_pct"] as number) ?? 0;
    quota.modelQuotas.push({ modelName: name, usagePct: usage } as ModelQuota);
  }

  // Plan type
  quota.planType =
    (data["plan_type"] as string) ?? (data["planType"] as string) ?? "pro";

  return quota;
}

function parseISOTime(timeStr: string): Date {
  return new Date(timeStr.replace("Z", "+00:00").endsWith("+00:00") ? timeStr : timeStr);
}
