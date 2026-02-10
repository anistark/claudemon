"""Data models for claudemon."""

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class ModelQuota:
    model_name: str
    usage_pct: float = 0.0


@dataclass
class QuotaData:
    five_hour_usage_pct: float = 0.0
    five_hour_reset_time: datetime | None = None
    seven_day_usage_pct: float = 0.0
    seven_day_reset_time: datetime | None = None
    model_quotas: list[ModelQuota] = field(default_factory=list)
    plan_type: str = "pro"

    @property
    def five_hour_remaining_seconds(self) -> int:
        if self.five_hour_reset_time is None:
            return 0
        delta = self.five_hour_reset_time - datetime.now(
            self.five_hour_reset_time.tzinfo
        )
        return max(0, int(delta.total_seconds()))

    @property
    def seven_day_remaining_seconds(self) -> int:
        if self.seven_day_reset_time is None:
            return 0
        delta = self.seven_day_reset_time - datetime.now(
            self.seven_day_reset_time.tzinfo
        )
        return max(0, int(delta.total_seconds()))


@dataclass
class TokenData:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read: int = 0
    cache_write: int = 0

    @property
    def total(self) -> int:
        return (
            self.input_tokens + self.output_tokens + self.cache_read + self.cache_write
        )


@dataclass
class ApiUsageData:
    token_counts: TokenData = field(default_factory=TokenData)
    costs_usd: float = 0.0


def format_tokens(count: int) -> str:
    if count >= 1_000_000:
        return f"{count / 1_000_000:.1f}M"
    elif count >= 1_000:
        return f"{count / 1_000:.0f}K"
    return str(count)


def format_countdown(total_seconds: int) -> str:
    if total_seconds <= 0:
        return "now"
    days = total_seconds // 86400
    hours = (total_seconds % 86400) // 3600
    minutes = (total_seconds % 3600) // 60
    if days > 0:
        return f"{days}d {hours}h"
    if hours > 0:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"
