"""Stats panel widget showing quota details, tokens, and costs."""

from textual.app import ComposeResult
from textual.reactive import reactive
from textual.widget import Widget
from textual.widgets import Static

from ..models import ApiUsageData, QuotaData, TokenData, format_countdown, format_tokens


class StatsPanel(Widget):
    """Panel displaying usage statistics."""

    DEFAULT_CSS = """
    StatsPanel {
        width: 100%;
        height: 100%;
        padding: 1 2;
    }

    StatsPanel > Static {
        width: 100%;
    }
    """

    quota_data: reactive[QuotaData | None] = reactive(None)
    token_data: reactive[TokenData | None] = reactive(None)
    api_usage: reactive[ApiUsageData | None] = reactive(None)
    show_api_mode: reactive[bool] = reactive(False)

    def compose(self) -> ComposeResult:
        yield Static(id="stats-content")

    def _render_stats(self) -> str:
        lines: list[str] = []

        if self.quota_data:
            q = self.quota_data

            # 5-hour window
            five_color = self._usage_color(q.five_hour_usage_pct)
            lines.append("[bold]5-Hour Window[/bold]")
            lines.append(
                f"  ├ Used:     [{five_color}]{q.five_hour_usage_pct:.0f}%[/{five_color}]"
            )
            lines.append(
                f"  ├ Resets:   {format_countdown(q.five_hour_remaining_seconds)}"
            )
            lines.append(
                f"  └ Messages: ~{self._estimate_messages(q.five_hour_usage_pct)}"
            )
            lines.append("")

            # 7-day window
            seven_color = self._usage_color(q.seven_day_usage_pct)
            lines.append("[bold]7-Day Window[/bold]")
            lines.append(
                f"  ├ Used:     [{seven_color}]{q.seven_day_usage_pct:.0f}%[/{seven_color}]"
            )
            lines.append(
                f"  └ Resets:   {format_countdown(q.seven_day_remaining_seconds)}"
            )
            lines.append("")

            # Model quotas
            if q.model_quotas:
                lines.append("[bold]Model Quotas[/bold]")
                for i, mq in enumerate(q.model_quotas):
                    prefix = "  └" if i == len(q.model_quotas) - 1 else "  ├"
                    color = self._usage_color(mq.usage_pct)
                    lines.append(
                        f"{prefix} {mq.model_name}: [{color}]{mq.usage_pct:.0f}%[/{color}]"
                    )
                lines.append("")

        if self.show_api_mode and self.api_usage:
            a = self.api_usage
            lines.append("[bold]API Usage[/bold]")
            lines.append(f"  ├ Input:    {format_tokens(a.token_counts.input_tokens)}")
            lines.append(f"  ├ Output:   {format_tokens(a.token_counts.output_tokens)}")
            lines.append(f"  ├ Cache R:  {format_tokens(a.token_counts.cache_read)}")
            lines.append(f"  ├ Cache W:  {format_tokens(a.token_counts.cache_write)}")
            lines.append(f"  ├ Total:    {format_tokens(a.token_counts.total)}")
            lines.append(f"  └ Cost:     ${a.costs_usd:.2f}")
            lines.append("")
        elif self.token_data:
            t = self.token_data
            lines.append("[bold]Tokens (this session)[/bold]")
            lines.append(f"  ├ Input:    {format_tokens(t.input_tokens)}")
            lines.append(f"  ├ Output:   {format_tokens(t.output_tokens)}")
            lines.append(f"  ├ Cache:    {format_tokens(t.cache_read + t.cache_write)}")
            lines.append(f"  └ Total:    {format_tokens(t.total)}")
            lines.append("")

        if not lines:
            lines.append("[dim]Waiting for data...[/dim]")

        return "\n".join(lines)

    @staticmethod
    def _usage_color(pct: float) -> str:
        if pct < 50:
            return "green"
        elif pct < 80:
            return "yellow"
        return "red"

    @staticmethod
    def _estimate_messages(usage_pct: float) -> str:
        # Rough estimate: Pro plan ~45 messages per 5h window
        total_est = 45
        used_est = int(total_est * usage_pct / 100)
        return f"{used_est} / ~{total_est}"

    def watch_quota_data(self, value: QuotaData | None) -> None:
        self._update_display()

    def watch_token_data(self, value: TokenData | None) -> None:
        self._update_display()

    def watch_api_usage(self, value: ApiUsageData | None) -> None:
        self._update_display()

    def watch_show_api_mode(self, value: bool) -> None:
        self._update_display()

    def _update_display(self) -> None:
        try:
            content = self.query_one("#stats-content", Static)
            content.update(self._render_stats())
        except Exception:
            pass

    def on_mount(self) -> None:
        self._update_display()
