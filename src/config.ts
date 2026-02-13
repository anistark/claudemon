/**
 * Configuration management for claudemon.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseTOML } from "smol-toml";

export const CONFIG_DIR = join(homedir(), ".config", "claudemon");
export const CONFIG_FILE = join(CONFIG_DIR, "config.toml");

const DEFAULT_CONFIG: Record<string, string | number | boolean> = {
  plan_type: "pro",
  refresh_interval: 5,
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
