/**
 * Main Ink application component for claudemon.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";

import { fetchQuota, AuthenticationError, QuotaFetchError } from "./api.js";
import { getOAuthToken, isAuthenticated } from "./auth.js";
import { loadConfig } from "./config.js";
import { type QuotaData } from "./models.js";
import { HeaderBar } from "./components/HeaderBar.js";
import { PieChart } from "./components/PieChart.js";


const WEEKLY_REFRESH_INTERVAL = 300; // 5 minutes in seconds

interface AppProps {
  version?: string;
}

export function App({ version = "" }: AppProps): React.ReactElement {
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
  const { stdout } = useStdout();
  const [termRows, setTermRows] = useState(stdout.rows ?? 24);

  useEffect(() => {
    const onResize = () => setTermRows(stdout.rows ?? 24);
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
  }, [stdout]);

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
      <Box marginTop={1}><Box flexDirection="column" borderStyle="round" width="100%" height={termRows - 1}>
        <HeaderBar
          planType={planType}
          lastRefreshAgo={0}
          isLoading={false}
          errorMessage=""
        />
        <Box flexGrow={1} paddingX={4} paddingY={2} justifyContent="center" alignItems="center">
          <Text>
            <Text bold color="yellow">
              Not authenticated
            </Text>
            {"\n\n"}
            Run <Text bold>claudemon setup</Text> to authenticate{"\n"}
            and start monitoring your Claude quota.
          </Text>
        </Box>
        <Box width="100%" paddingX={2} justifyContent="space-between" borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
          <Text dimColor>q: Quit | r: Refresh | ?: Help</Text>
          {version && <Text dimColor>v{version}</Text>}
        </Box>
      </Box></Box>
    );
  }

  if (showHelp) {
    return (
      <Box marginTop={1}><Box flexDirection="column" borderStyle="round" width="100%" height={termRows - 1}>
        <HeaderBar
          planType={planType}
          lastRefreshAgo={lastRefreshAgo}
          isLoading={isLoading}
          errorMessage={errorMessage}
        />
        <Box flexGrow={1} paddingX={4} paddingY={2} flexDirection="column" justifyContent="center">
          <Text bold>Keybindings</Text>
          <Text>  q — Quit</Text>
          <Text>  r — Force refresh</Text>
          <Text>  ? — Toggle help</Text>
        </Box>
        <Box width="100%" paddingX={2} justifyContent="space-between" borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
          <Text dimColor>q: Quit | r: Refresh | ?: Help</Text>
          {version && <Text dimColor>v{version}</Text>}
        </Box>
      </Box></Box>
    );
  }

  return (
    <Box marginTop={1}><Box flexDirection="column" borderStyle="round" width="100%" height={termRows - 1}>
      <HeaderBar
        planType={planType}
        lastRefreshAgo={lastRefreshAgo}
        isLoading={isLoading}
        errorMessage={errorMessage}
      />
      <Box flexGrow={1} flexDirection="row" justifyContent="center" alignItems="center" paddingX={2} gap={4}>
        <PieChart
          usagePct={quotaData?.fiveHourUsagePct ?? 0}
          label="5-Hour Quota"
          resetTime={quotaData?.fiveHourResetTime ?? null}
        />
        <PieChart
          usagePct={quotaData?.sevenDayUsagePct ?? 0}
          label="Weekly Quota"
          resetTime={quotaData?.sevenDayResetTime ?? null}
        />
      </Box>
      <Box width="100%" paddingX={2} justifyContent="space-between" borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
        <Text dimColor>q: Quit | r: Refresh | ?: Help</Text>
        {version && <Text dimColor>v{version}</Text>}
      </Box>
    </Box></Box>
  );
}
