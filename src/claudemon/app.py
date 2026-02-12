"""Main Textual application for claudemon."""

import time

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal, Vertical
from textual.reactive import reactive
from textual.widgets import Footer, Static

from .api import AuthenticationError, QuotaFetchError, fetch_quota
from .auth import get_oauth_token, is_authenticated
from .config import load_config
from .models import QuotaData
from .widgets.header_bar import HeaderBar
from .widgets.pie_chart import PieChart
from .widgets.stats_panel import StatsPanel


class ClaudemonApp(App):
    """Claude Usage Monitor TUI."""

    TITLE = "claudemon"

    CSS = """
    Screen {
        layout: vertical;
    }

    #header {
        dock: top;
        height: 3;
    }

    #main-container {
        height: 1fr;
    }

    #charts-area {
        width: 60%;
        height: 100%;
    }

    #session-chart {
        height: 1fr;
        padding: 0;
        content-align: center middle;
    }

    #weekly-chart {
        height: 1fr;
        padding: 0;
        content-align: center middle;
        border-top: solid $primary;
    }

    #stats-area {
        width: 40%;
        height: 100%;
        border-left: solid $primary;
        padding: 1 2;
    }

    #setup-message {
        width: 100%;
        height: 100%;
        content-align: center middle;
        padding: 4;
    }

    Footer {
        dock: bottom;
    }
    """

    BINDINGS = [
        Binding("q", "quit", "Quit"),
        Binding("r", "refresh", "Refresh"),
        Binding("?", "help", "Help"),
    ]

    quota_data: reactive[QuotaData | None] = reactive(None)

    WEEKLY_REFRESH_INTERVAL = 300  # 5 minutes

    def __init__(self):
        super().__init__()
        self._last_refresh: float = 0
        self._last_weekly_refresh: float = 0
        self._config = load_config()
        self._refresh_interval = int(self._config.get("refresh_interval", 5))

    def compose(self) -> ComposeResult:
        yield HeaderBar(id="header")

        if not is_authenticated():
            yield Container(
                Static(
                    "[bold yellow]Not authenticated[/bold yellow]\n\n"
                    "Run [bold]claudemon setup[/bold] to authenticate\n"
                    "and start monitoring your Claude quota.",
                    id="setup-message",
                ),
            )
        else:
            with Horizontal(id="main-container"):
                with Vertical(id="charts-area"):
                    yield PieChart(id="session-chart")
                    yield PieChart(id="weekly-chart")
                with Container(id="stats-area"):
                    yield StatsPanel(id="stats-panel")

        yield Footer()

    def on_mount(self) -> None:
        header = self.query_one(HeaderBar)
        header.plan_type = self._config.get("plan_type", "pro")

        if is_authenticated():
            self._do_refresh()
            self._do_weekly_refresh()
            self.set_interval(self._refresh_interval, self._do_refresh)
            self.set_interval(self.WEEKLY_REFRESH_INTERVAL, self._do_weekly_refresh)
            self.set_interval(1, self._tick_refresh_counter)

    def _tick_refresh_counter(self) -> None:
        if self._last_refresh > 0:
            header = self.query_one(HeaderBar)
            header.last_refresh_ago = int(time.time() - self._last_refresh)

    def _do_refresh(self) -> None:
        self.run_worker(self._fetch_data(), exclusive=True, name="refresh")

    async def _fetch_data(self) -> None:
        header = self.query_one(HeaderBar)
        header.is_loading = True
        header.error_message = ""

        try:
            oauth_token = get_oauth_token()
            if oauth_token:
                quota = await fetch_quota(oauth_token)
                self.quota_data = quota
                header.plan_type = quota.plan_type or self._config.get(
                    "plan_type", "pro"
                )

                # Update session (5-hour) chart
                try:
                    session = self.query_one("#session-chart", PieChart)
                    session.usage_pct = quota.five_hour_usage_pct
                    session.label = "5-Hour Quota"
                    session.reset_time = quota.five_hour_reset_time
                except Exception:
                    pass

                # Update stats panel
                try:
                    stats = self.query_one("#stats-panel", StatsPanel)
                    stats.quota_data = quota
                except Exception:
                    pass

            self._last_refresh = time.time()
            header.is_loading = False

        except AuthenticationError as e:
            header.is_loading = False
            header.error_message = str(e)
        except QuotaFetchError as e:
            header.is_loading = False
            header.error_message = f"Fetch error: {e}"
        except Exception as e:
            header.is_loading = False
            header.error_message = f"Error: {e}"

    def _do_weekly_refresh(self) -> None:
        self.run_worker(self._fetch_weekly(), exclusive=True, name="weekly-refresh")

    async def _fetch_weekly(self) -> None:
        try:
            oauth_token = get_oauth_token()
            if oauth_token:
                quota = await fetch_quota(oauth_token)
                try:
                    weekly = self.query_one("#weekly-chart", PieChart)
                    weekly.usage_pct = quota.seven_day_usage_pct
                    weekly.label = "Weekly Quota"
                    weekly.reset_time = quota.seven_day_reset_time
                except Exception:
                    pass
                self._last_weekly_refresh = time.time()
        except Exception:
            pass

    def action_refresh(self) -> None:
        self._do_refresh()
        self._do_weekly_refresh()

    def action_help(self) -> None:
        self.notify(
            "q: Quit | r: Refresh | ?: Help",
            title="Keybindings",
            timeout=5,
        )
