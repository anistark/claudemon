/**
 * Donut/ring chart component showing quota usage.
 */

import React from "react";
import { Box, Text } from "ink";
import chalk from "chalk";

interface PieChartProps {
  usagePct: number;
  label: string;
  resetTime: Date | null;
}

function getColor(pct: number): (s: string) => string {
  if (pct < 50) return chalk.green;
  if (pct < 80) return chalk.yellow;
  return chalk.red;
}

function getBoldColor(pct: number): (s: string) => string {
  if (pct < 50) return chalk.bold.green;
  if (pct < 80) return chalk.bold.yellow;
  return chalk.bold.red;
}

function formatResetTime(reset: Date): string {
  const diffMs = reset.getTime() - Date.now();

  if (diffMs <= 0) return "now";

  const totalMinutes = Math.floor(diffMs / 60000);
  const totalHours = Math.floor(diffMs / 3600000);
  const totalDays = Math.floor(diffMs / 86400000);

  if (totalMinutes < 1) return "in less than a minute";
  if (totalMinutes < 60) {
    return `in ${totalMinutes} minute${totalMinutes !== 1 ? "s" : ""}`;
  }
  if (totalHours < 24) {
    const remainingMin = totalMinutes % 60;
    if (remainingMin === 0) return `in ${totalHours} hour${totalHours !== 1 ? "s" : ""}`;
    return `in ${totalHours} hour${totalHours !== 1 ? "s" : ""}, ${remainingMin} min`;
  }
  const remainingHrs = totalHours % 24;
  if (remainingHrs === 0) return `in ${totalDays} day${totalDays !== 1 ? "s" : ""}`;
  return `in ${totalDays} day${totalDays !== 1 ? "s" : ""}, ${remainingHrs} hour${remainingHrs !== 1 ? "s" : ""}`;
}

export function PieChart({
  usagePct,
  label,
  resetTime,
}: PieChartProps): React.ReactElement {
  const pct = Math.max(0, Math.min(100, usagePct));
  const color = getColor(pct);
  const boldColor = getBoldColor(pct);

  // Donut dimensions
  const outerR = 6.5;
  const innerR = 5.0;
  const rows = Math.floor(outerR * 2) + 1;
  const cols = Math.floor(outerR * 4) + 1;

  // Usage fills clockwise from top
  const usedAngle = 2 * Math.PI * (pct / 100);

  const centerY = outerR;
  const centerX = outerR * 2;

  // Build grid
  type Cell = { char: string; style: ((s: string) => string) | null };
  const grid: Cell[][] = [];

  for (let row = 0; row < rows; row++) {
    const line: Cell[] = [];
    for (let col = 0; col < cols; col++) {
      const dy = row - centerY;
      const dx = (col - centerX) / 2.0;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (innerR <= dist && dist <= outerR) {
        let angle = Math.atan2(dx, -dy);
        if (angle < 0) angle += 2 * Math.PI;

        if (angle <= usedAngle) {
          line.push({ char: "█", style: color });
        } else {
          line.push({ char: "░", style: chalk.gray });
        }
      } else {
        line.push({ char: " ", style: null });
      }
    }
    grid.push(line);
  }

  // Place percentage text in center
  const pctStr = `${Math.round(pct)}%`;
  const centerRow = Math.floor(rows / 2);
  const startCol = Math.floor(centerX - pctStr.length / 2);
  for (let i = 0; i < pctStr.length; i++) {
    const colIdx = startCol + i;
    if (colIdx >= 0 && colIdx < cols) {
      grid[centerRow]![colIdx] = { char: pctStr[i]!, style: boldColor };
    }
  }

  // Place label below percentage
  const labelRow = centerRow + 1;
  const labelStart = Math.floor(centerX - label.length / 2);
  if (labelRow < rows) {
    for (let i = 0; i < label.length; i++) {
      const colIdx = labelStart + i;
      if (colIdx >= 0 && colIdx < cols) {
        grid[labelRow]![colIdx] = { char: label[i]!, style: chalk.dim };
      }
    }
  }

  // Render to lines
  const lines: string[] = [];
  for (const row of grid) {
    let line = "";
    for (const cell of row) {
      line += cell.style ? cell.style(cell.char) : cell.char;
    }
    lines.push(line);
  }

  return (
    <Box flexDirection="column" alignItems="center" paddingY={0}>
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
      {resetTime && (
        <Text dimColor>Resets {formatResetTime(resetTime)}</Text>
      )}
    </Box>
  );
}
