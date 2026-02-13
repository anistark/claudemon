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
  const now = new Date();

  const resetLocal = reset;
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const resetDate = new Date(
    resetLocal.getFullYear(),
    resetLocal.getMonth(),
    resetLocal.getDate(),
  );

  const fmt = (d: Date): string => {
    let hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? "pm" : "am";
    hours = hours % 12 || 12;
    return `${hours}:${minutes.toString().padStart(2, "0")}${ampm}`;
  };

  // Same day
  if (nowDate.getTime() === resetDate.getTime()) {
    return fmt(resetLocal);
  }

  // Tomorrow
  const tomorrow = new Date(nowDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (tomorrow.getTime() === resetDate.getTime()) {
    return `tomorrow at ${fmt(resetLocal)}`;
  }

  // Other
  const months = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  return `${months[resetLocal.getMonth()]} ${resetLocal.getDate()} at ${fmt(resetLocal)}`;
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
  const outerR = 5.0;
  const innerR = 3.0;
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

  // Build right-side info
  const rightLines: Map<number, string> = new Map();
  if (resetTime) {
    rightLines.set(centerRow - 1, chalk.dim("Resets"));
    rightLines.set(centerRow, chalk.dim.bold(formatResetTime(resetTime)));
  }

  // Render to lines
  const lines: string[] = [];
  for (let rowIdx = 0; rowIdx < grid.length; rowIdx++) {
    const row = grid[rowIdx]!;
    let line = "";
    for (const cell of row) {
      line += cell.style ? cell.style(cell.char) : cell.char;
    }
    if (rightLines.has(rowIdx)) {
      line += "  " + rightLines.get(rowIdx)!;
    }
    lines.push(line);
  }

  return (
    <Box flexDirection="column" alignItems="center" paddingY={0}>
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}
