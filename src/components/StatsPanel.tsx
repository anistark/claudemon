/**
 * Stats panel component showing quota details.
 */

import React from "react";
import { Box, Text } from "ink";
import chalk from "chalk";

import {
  type QuotaData,
  fiveHourRemainingSeconds,
  sevenDayRemainingSeconds,
  formatCountdown,
} from "../models.js";

interface StatsPanelProps {
  quotaData: QuotaData | null;
}

function usageColor(pct: number): (s: string) => string {
  if (pct < 50) return chalk.green;
  if (pct < 80) return chalk.yellow;
  return chalk.red;
}

function estimateMessages(usagePct: number): string {
  const totalEst = 45;
  const usedEst = Math.round(totalEst * usagePct / 100);
  return `${usedEst} / ~${totalEst}`;
}

export function StatsPanel({
  quotaData,
}: StatsPanelProps): React.ReactElement {
  if (!quotaData) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text dimColor>Waiting for data...</Text>
      </Box>
    );
  }

  const q = quotaData;
  const lines: string[] = [];

  // 5-hour window
  const fiveColor = usageColor(q.fiveHourUsagePct);
  lines.push(chalk.bold("5-Hour Window"));
  lines.push(`  ├ Used:     ${fiveColor(`${Math.round(q.fiveHourUsagePct)}%`)}`);
  lines.push(`  ├ Resets:   ${formatCountdown(fiveHourRemainingSeconds(q))}`);
  lines.push(`  └ Messages: ~${estimateMessages(q.fiveHourUsagePct)}`);
  lines.push("");

  // 7-day window
  const sevenColor = usageColor(q.sevenDayUsagePct);
  lines.push(chalk.bold("7-Day Window"));
  lines.push(`  ├ Used:     ${sevenColor(`${Math.round(q.sevenDayUsagePct)}%`)}`);
  lines.push(`  └ Resets:   ${formatCountdown(sevenDayRemainingSeconds(q))}`);
  lines.push("");

  // Model quotas
  if (q.modelQuotas.length > 0) {
    lines.push(chalk.bold("Model Quotas"));
    for (let i = 0; i < q.modelQuotas.length; i++) {
      const mq = q.modelQuotas[i]!;
      const prefix = i === q.modelQuotas.length - 1 ? "  └" : "  ├";
      const mColor = usageColor(mq.usagePct);
      lines.push(`${prefix} ${mq.modelName}: ${mColor(`${Math.round(mq.usagePct)}%`)}`);
    }
    lines.push("");
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}
