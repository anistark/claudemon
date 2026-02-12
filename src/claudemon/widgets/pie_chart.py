"""Donut/ring chart widget showing quota usage."""

import math
from datetime import datetime

from rich.text import Text
from textual.app import ComposeResult
from textual.reactive import reactive
from textual.widget import Widget
from textual.widgets import Static


class PieChart(Widget):
    """A donut/ring chart showing quota usage percentage."""

    usage_pct: reactive[float] = reactive(0.0)
    label: reactive[str] = reactive("Usage")
    reset_time: reactive[datetime | None] = reactive(None)

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

    def _render_donut(self) -> Text:
        pct = max(0.0, min(100.0, self.usage_pct))
        color = self._get_color(pct)

        # Donut dimensions
        outer_r = 5.0
        inner_r = 3.0
        rows = int(outer_r * 2) + 1
        cols = int(outer_r * 4) + 1  # x2 for aspect ratio

        # Usage fills clockwise from top (12 o'clock = -π/2)
        used_angle = 2 * math.pi * (pct / 100.0)

        grid: list[list[tuple[str, str]]] = []  # (char, style)

        center_y = outer_r
        center_x = outer_r * 2  # adjusted for aspect ratio

        for row in range(rows):
            line: list[tuple[str, str]] = []
            for col in range(cols):
                # Map to unit coordinates (aspect ratio ~2:1 for terminal chars)
                dy = row - center_y
                dx = (col - center_x) / 2.0

                dist = math.sqrt(dx * dx + dy * dy)

                if inner_r <= dist <= outer_r:
                    # On the ring — determine angle from top (clockwise)
                    angle = math.atan2(dx, -dy)  # clockwise from top
                    if angle < 0:
                        angle += 2 * math.pi

                    if angle <= used_angle:
                        line.append(("█", color))
                    else:
                        line.append(("░", "bright_black"))
                else:
                    line.append((" ", ""))
            grid.append(line)

        # Place percentage text in center
        pct_str = f"{pct:.0f}%"
        center_row = rows // 2
        start_col = int(center_x - len(pct_str) / 2)
        for i, ch in enumerate(pct_str):
            col_idx = start_col + i
            if 0 <= col_idx < cols:
                grid[center_row][col_idx] = (ch, f"bold {color}")

        # Place label below percentage
        label_row = center_row + 1
        label_start = int(center_x - len(self.label) / 2)
        if label_row < rows:
            for i, ch in enumerate(self.label):
                col_idx = label_start + i
                if 0 <= col_idx < cols:
                    grid[label_row][col_idx] = (ch, "dim")

        # Build right-side info lines (placed next to middle rows of donut)
        right_lines: dict[int, list[tuple[str, str]]] = {}
        if self.reset_time:
            reset_str = self._format_reset_time(self.reset_time)
            right_lines[center_row - 1] = [("Resets", "dim")]
            right_lines[center_row] = [(reset_str, "dim bold")]

        # Build Rich Text
        text = Text()
        for row_idx, line in enumerate(grid):
            for char, style in line:
                if style:
                    text.append(char, style=style)
                else:
                    text.append(char)
            # Append right-side info
            if row_idx in right_lines:
                text.append("  ")
                for info_text, info_style in right_lines[row_idx]:
                    text.append(info_text, style=info_style)
            if row_idx < len(grid) - 1:
                text.append("\n")

        return text

    @staticmethod
    def _format_reset_time(reset: datetime) -> str:
        """Format reset time like Claude Code: '2:29am' or 'Feb 19 at 9:29pm'."""
        now = datetime.now(reset.tzinfo)
        local_reset = reset.astimezone()

        # If resets today, just show time
        if local_reset.date() == now.astimezone().date():
            return local_reset.strftime("%-I:%M%p").lower()

        # If resets tomorrow
        tomorrow = now.astimezone().date() + __import__("datetime").timedelta(days=1)
        if local_reset.date() == tomorrow:
            return "tomorrow at " + local_reset.strftime("%-I:%M%p").lower()

        # Otherwise show date + time
        return local_reset.strftime("%b %-d at %-I:%M%p").lower()

    def watch_usage_pct(self, value: float) -> None:
        self._update_display()

    def watch_label(self, value: str) -> None:
        self._update_display()

    def watch_reset_time(self, value: datetime | None) -> None:
        self._update_display()

    def _update_display(self) -> None:
        try:
            display = self.query_one("#chart-display", Static)
            display.update(self._render_donut())
        except Exception:
            pass

    def on_mount(self) -> None:
        self._update_display()
