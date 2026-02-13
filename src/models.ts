/**
 * Data models for claudemon.
 */

export interface ModelQuota {
  modelName: string;
  usagePct: number;
}

export interface QuotaData {
  fiveHourUsagePct: number;
  fiveHourResetTime: Date | null;
  sevenDayUsagePct: number;
  sevenDayResetTime: Date | null;
  modelQuotas: ModelQuota[];
  planType: string;
}

export interface TokenData {
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ApiUsageData {
  tokenCounts: TokenData;
  costsUsd: number;
}

export function createQuotaData(partial?: Partial<QuotaData>): QuotaData {
  return {
    fiveHourUsagePct: 0,
    fiveHourResetTime: null,
    sevenDayUsagePct: 0,
    sevenDayResetTime: null,
    modelQuotas: [],
    planType: "pro",
    ...partial,
  };
}

export function createTokenData(partial?: Partial<TokenData>): TokenData {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    ...partial,
  };
}

export function tokenTotal(t: TokenData): number {
  return t.inputTokens + t.outputTokens + t.cacheRead + t.cacheWrite;
}

export function fiveHourRemainingSeconds(q: QuotaData): number {
  if (!q.fiveHourResetTime) return 0;
  const delta = q.fiveHourResetTime.getTime() - Date.now();
  return Math.max(0, Math.floor(delta / 1000));
}

export function sevenDayRemainingSeconds(q: QuotaData): number {
  if (!q.sevenDayResetTime) return 0;
  const delta = q.sevenDayResetTime.getTime() - Date.now();
  return Math.max(0, Math.floor(delta / 1000));
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  } else if (count >= 1_000) {
    return `${Math.round(count / 1_000)}K`;
  }
  return String(count);
}

export function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return "now";
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
