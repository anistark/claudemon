"""API client for Claude OAuth usage endpoint."""

from datetime import datetime

import httpx

from .models import ModelQuota, QuotaData

OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
OAUTH_BETA_HEADER = "oauth-2025-04-20"


class QuotaFetchError(Exception):
    pass


class AuthenticationError(QuotaFetchError):
    pass


async def fetch_quota(oauth_token: str) -> QuotaData:
    """Fetch quota usage from the OAuth usage endpoint."""
    headers = {
        "Authorization": f"Bearer {oauth_token}",
        "anthropic-beta": OAUTH_BETA_HEADER,
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

    # Parse 5-hour window (API returns 0-100 values directly)
    five_hour = data.get("five_hour", data.get("fiveHour", {}))
    if five_hour:
        quota.five_hour_usage_pct = five_hour.get(
            "utilization", five_hour.get("usage_pct", 0.0)
        )
        reset_at = five_hour.get("resets_at", five_hour.get("reset_at", five_hour.get("resetAt")))
        if reset_at:
            quota.five_hour_reset_time = _parse_iso_time(reset_at)

    # Parse 7-day window
    seven_day = data.get("seven_day", data.get("sevenDay", {}))
    if seven_day:
        quota.seven_day_usage_pct = seven_day.get(
            "utilization", seven_day.get("usage_pct", 0.0)
        )
        reset_at = seven_day.get("resets_at", seven_day.get("reset_at", seven_day.get("resetAt")))
        if reset_at:
            quota.seven_day_reset_time = _parse_iso_time(reset_at)

    # Parse model-specific quotas
    models = data.get("models", data.get("model_quotas", []))
    for m in models:
        name = m.get("model", m.get("name", "unknown"))
        usage = m.get("utilization", m.get("usage_pct", 0.0))
        quota.model_quotas.append(ModelQuota(model_name=name, usage_pct=usage))

    # Plan type
    quota.plan_type = data.get("plan_type", data.get("planType", "pro"))

    return quota


def _parse_iso_time(time_str: str) -> datetime:
    """Parse an ISO 8601 timestamp."""
    time_str = time_str.replace("Z", "+00:00")
    return datetime.fromisoformat(time_str)
