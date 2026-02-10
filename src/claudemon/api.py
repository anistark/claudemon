"""API clients for Claude quota and admin usage endpoints."""

from datetime import datetime

import httpx

from .models import ApiUsageData, ModelQuota, QuotaData, TokenData

OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
ADMIN_MESSAGES_URL = "https://api.anthropic.com/v1/organizations/usage_report/messages"
ADMIN_COSTS_URL = "https://api.anthropic.com/v1/organizations/cost_report"


class QuotaFetchError(Exception):
    pass


class AuthenticationError(QuotaFetchError):
    pass


async def fetch_quota(oauth_token: str) -> QuotaData:
    """Fetch quota usage from the OAuth usage endpoint."""
    headers = {
        "Authorization": f"Bearer {oauth_token}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(OAUTH_USAGE_URL, headers=headers)
        except httpx.RequestError as e:
            raise QuotaFetchError(f"Network error: {e}") from e

        if resp.status_code == 401:
            raise AuthenticationError(
                "OAuth token is invalid or expired. Run 'claudemon setup' to re-authenticate."
            )
        if resp.status_code == 403:
            raise AuthenticationError(
                "Access denied. Your token may lack the required permissions."
            )
        if resp.status_code != 200:
            raise QuotaFetchError(
                f"API returned status {resp.status_code}: {resp.text}"
            )

        data = resp.json()

    return _parse_quota_response(data)


def _parse_quota_response(data: dict) -> QuotaData:
    """Parse the OAuth usage API response into QuotaData."""
    quota = QuotaData()

    # Parse 5-hour window
    five_hour = data.get("five_hour", data.get("fiveHour", {}))
    if five_hour:
        quota.five_hour_usage_pct = (
            five_hour.get("utilization", five_hour.get("usage_pct", 0.0)) * 100
        )
        reset_at = five_hour.get("reset_at", five_hour.get("resetAt"))
        if reset_at:
            quota.five_hour_reset_time = _parse_iso_time(reset_at)

    # Parse 7-day window
    seven_day = data.get("seven_day", data.get("sevenDay", {}))
    if seven_day:
        quota.seven_day_usage_pct = (
            seven_day.get("utilization", seven_day.get("usage_pct", 0.0)) * 100
        )
        reset_at = seven_day.get("reset_at", seven_day.get("resetAt"))
        if reset_at:
            quota.seven_day_reset_time = _parse_iso_time(reset_at)

    # Parse model-specific quotas
    models = data.get("models", data.get("model_quotas", []))
    for m in models:
        name = m.get("model", m.get("name", "unknown"))
        usage = m.get("utilization", m.get("usage_pct", 0.0)) * 100
        quota.model_quotas.append(ModelQuota(model_name=name, usage_pct=usage))

    # Plan type
    quota.plan_type = data.get("plan_type", data.get("planType", "pro"))

    return quota


def _parse_iso_time(time_str: str) -> datetime:
    """Parse an ISO 8601 timestamp."""
    time_str = time_str.replace("Z", "+00:00")
    return datetime.fromisoformat(time_str)


async def fetch_api_usage(admin_api_key: str) -> ApiUsageData:
    """Fetch usage from the Admin API endpoints."""
    headers = {
        "x-api-key": admin_api_key,
        "Content-Type": "application/json",
    }

    usage = ApiUsageData()

    async with httpx.AsyncClient(timeout=15.0) as client:
        # Fetch token usage
        try:
            resp = await client.get(ADMIN_MESSAGES_URL, headers=headers)
            if resp.status_code == 200:
                msg_data = resp.json()
                usage.token_counts = _parse_token_usage(msg_data)
            elif resp.status_code in (401, 403):
                raise AuthenticationError(
                    "Admin API key is invalid. Run 'claudemon setup --api' to reconfigure."
                )
        except httpx.RequestError as e:
            raise QuotaFetchError(f"Network error fetching token usage: {e}") from e

        # Fetch costs
        try:
            resp = await client.get(ADMIN_COSTS_URL, headers=headers)
            if resp.status_code == 200:
                cost_data = resp.json()
                usage.costs_usd = _parse_costs(cost_data)
        except httpx.RequestError:
            pass  # Costs are optional

    return usage


def _parse_token_usage(data: dict) -> TokenData:
    """Parse token usage from admin API response."""
    tokens = TokenData()
    items = data.get("data", data.get("messages", []))
    for item in items:
        tokens.input_tokens += item.get("input_tokens", 0)
        tokens.output_tokens += item.get("output_tokens", 0)
        tokens.cache_read += item.get(
            "cache_read_input_tokens", item.get("cache_read", 0)
        )
        tokens.cache_write += item.get(
            "cache_creation_input_tokens", item.get("cache_write", 0)
        )
    return tokens


def _parse_costs(data: dict) -> float:
    """Parse cost data from admin API response."""
    items = data.get("data", data.get("costs", []))
    total = 0.0
    for item in items:
        total += item.get("cost_usd", item.get("amount", 0.0))
    return total
