"""Pie chart widget using term-piechart."""

from rich.text import Text
from textual.app import ComposeResult
from textual.reactive import reactive
from textual.widget import Widget
from textual.widgets import Static


class PieChart(Widget):
    """A pie/disk chart showing quota usage."""

    usage_pct: reactive[float] = reactive(0.0)
    label: reactive[str] = reactive("Usage")

    DEFAULT_CSS = """
    PieChart {
        width: 100%;
        height: 100%;
        content-align: center middle;
    }

    PieChart > Static {
        width: 100%;
        content-align: center middle;
    }
    """

    def compose(self) -> ComposeResult:
        yield Static(id="chart-display")

    def _get_color(self, pct: float) -> str:
        if pct < 50:
            return "green"
        elif pct < 80:
            return "yellow"
        return "red"

    def _render_chart(self) -> Text:
        pct = max(0.0, min(100.0, self.usage_pct))

        try:
            from term_piechart import Pie

            used_color = self._get_color(pct)
            chart = Pie(
                [
                    {"name": "Used", "value": pct, "color": used_color},
                    {"name": "Free", "value": 100 - pct, "color": "bright_black"},
                ],
                radius=8,
                autocolor=False,
                legend=True,
            )
            # term-piechart outputs ANSI escape codes; Rich Text.from_ansi handles them
            return Text.from_ansi(str(chart))
        except Exception:
            return Text.from_ansi(self._fallback_chart(pct))

    def _fallback_chart(self, pct: float) -> str:
        """ASCII fallback if term-piechart fails."""
        color = self._get_color(pct)
        color_code = {"green": "\033[32m", "yellow": "\033[33m", "red": "\033[31m"}.get(
            color, ""
        )
        reset = "\033[0m"

        filled = int(pct / 5)
        empty = 20 - filled

        bar = f"  [{color_code}{'█' * filled}{reset}{'░' * empty}] {pct:.0f}%"

        lines = [
            f"       {'█' * 10}       ",
            f"     {'█' * 14}     ",
            f"    {'█' * 16}    ",
            f"   {'█' * 18}   ",
            f"   {'█' * 18}   ",
            f"    {'█' * 16}    ",
            f"     {'█' * 14}     ",
            f"       {'█' * 10}       ",
        ]

        total_chars = sum(line.count("█") for line in lines)
        remaining = total_chars - int(total_chars * pct / 100)

        result_lines = []
        for line in lines:
            block_count = line.count("█")
            if remaining >= block_count:
                result_lines.append(line.replace("█", "░"))
                remaining -= block_count
            elif remaining > 0:
                new_line = line.replace("█", "░", remaining)
                remaining = 0
                result_lines.append(new_line)
            else:
                result_lines.append(line)

        chart_text = "\n".join(result_lines)
        legend = f"\n    ■ Used {pct:.0f}%   ■ Free {100 - pct:.0f}%"

        return f"\n{self.label}\n\n{chart_text}\n{bar}\n{legend}"

    def watch_usage_pct(self, value: float) -> None:
        self._update_display()

    def watch_label(self, value: str) -> None:
        self._update_display()

    def _update_display(self) -> None:
        try:
            display = self.query_one("#chart-display", Static)
            display.update(self._render_chart())
        except Exception:
            pass

    def on_mount(self) -> None:
        self._update_display()
