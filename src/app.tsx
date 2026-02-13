/**
 * Main Ink application component for claudemon.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";

import { fetchQuota, AuthenticationError, QuotaFetchError } from "./api.js";
import { getOAuthToken, isAuthenticated } from "./auth.js";
import { loadConfig } from "./config.js";
import { type QuotaData } from "./models.js";
import { HeaderBar } from "./components/HeaderBar.js";
import { PieChart } from "./components/PieChart.js";
import { StatsPanel } from "./components/StatsPanel.js";

const WEEKLY_REFRESH_INTERVAL = 300; // 5 minutes in seconds

export function App(): React.ReactElement {
  const { exit } = useApp();
  const config = useRef(loadConfig());
  const refreshInterval = Number(config.current["refresh_interval"] ?? 5);

  const [quotaData, setQuotaData] = useState<QuotaData | null>(null);
  const [planType, setPlanType] = useState<string>(
    String(config.current["plan_type"] ?? "pro"),
  );
  const [lastRefreshAgo, setLastRefreshAgo] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const lastRefreshTime = useRef(0);
  const authenticated = useRef(isAuthenticated());

  const doRefresh = useCallback(async (weekly = false) => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const token = getOAuthToken();
      if (!token) return;

      const quota = await fetchQuota(token);
      setQuotaData(quota);
      setPlanType(quota.planType || String(config.current["plan_type"] ?? "pro"));
      lastRefreshTime.current = Date.now();
      setLastRefreshAgo(0);
      setIsLoading(false);
    } catch (e) {
      setIsLoading(false);
      if (e instanceof AuthenticationError) {
        setErrorMessage(e.message);
      } else if (e instanceof QuotaFetchError) {
        setErrorMessage(`Fetch error: ${e.message}`);
      } else {
        setErrorMessage(`Error: ${e}`);
      }
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    if (authenticated.current) {
      doRefresh();
    }
  }, [doRefresh]);

  // Session refresh interval
  useEffect(() => {
    if (!authenticated.current) return;
    const id = setInterval(() => doRefresh(), refreshInterval * 1000);
    return () => clearInterval(id);
  }, [doRefresh, refreshInterval]);

  // Weekly refresh interval
  useEffect(() => {
    if (!authenticated.current) return;
    const id = setInterval(
      () => doRefresh(true),
      WEEKLY_REFRESH_INTERVAL * 1000,
    );
    return () => clearInterval(id);
  }, [doRefresh]);

  // Tick refresh counter every second
  useEffect(() => {
    const id = setInterval(() => {
      if (lastRefreshTime.current > 0) {
        setLastRefreshAgo(
          Math.floor((Date.now() - lastRefreshTime.current) / 1000),
        );
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Keybindings
  useInput((input, key) => {
    if (input === "q") {
      exit();
    } else if (input === "r") {
      doRefresh();
    } else if (input === "?") {
      setShowHelp((prev) => !prev);
    }
  });

  if (!authenticated.current) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <HeaderBar
          planType={planType}
          lastRefreshAgo={0}
          isLoading={false}
          errorMessage=""
        />
        <Box paddingX={4} paddingY={2} justifyContent="center">
          <Text>
            <Text bold color="yellow">
              Not authenticated
            </Text>
            {"\n\n"}
            Run <Text bold>claudemon setup</Text> to authenticate{"\n"}
            and start monitoring your Claude quota.
          </Text>
        </Box>
      </Box>
    );
  }

  if (showHelp) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <HeaderBar
          planType={planType}
          lastRefreshAgo={lastRefreshAgo}
          isLoading={isLoading}
          errorMessage={errorMessage}
        />
        <Box paddingX={4} paddingY={2} flexDirection="column">
          <Text bold>Keybindings</Text>
          <Text>  q — Quit</Text>
          <Text>  r — Force refresh</Text>
          <Text>  ? — Toggle help</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <HeaderBar
        planType={planType}
        lastRefreshAgo={lastRefreshAgo}
        isLoading={isLoading}
        errorMessage={errorMessage}
      />
      <Box flexGrow={1}>
        {/* Charts area — 60% */}
        <Box flexDirection="column" width="60%">
          <PieChart
            usagePct={quotaData?.fiveHourUsagePct ?? 0}
            label="5-Hour Quota"
            resetTime={quotaData?.fiveHourResetTime ?? null}
          />
          <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
            <PieChart
              usagePct={quotaData?.sevenDayUsagePct ?? 0}
              label="Weekly Quota"
              resetTime={quotaData?.sevenDayResetTime ?? null}
            />
          </Box>
        </Box>
        {/* Stats area — 40% */}
        <Box
          width="40%"
          borderStyle="single"
          borderLeft
          borderRight={false}
          borderTop={false}
          borderBottom={false}
        >
          <StatsPanel quotaData={quotaData} />
        </Box>
      </Box>
      <Box paddingX={2}>
        <Text dimColor>q: Quit | r: Refresh | ?: Help</Text>
      </Box>
    </Box>
  );
}
