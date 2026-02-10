"""Main Textual application for claudemon."""

import time

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal
from textual.reactive import reactive
from textual.widgets import Footer, Static

from .api import AuthenticationError, QuotaFetchError, fetch_api_usage, fetch_quota
from .auth import get_admin_api_key, get_oauth_token, is_authenticated
from .config import load_config
from .models import ApiUsageData, QuotaData, TokenData
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

    #chart-area {
        width: 60%;
        height: 100%;
        padding: 1;
        content-align: center middle;
    }

    #stats-area {
        width: 40%;
        height: 100%;
        border-left: solid $primary;
        padding: 1;
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
        Binding("m", "toggle_mode", "Mode"),
        Binding("?", "help", "Help"),
    ]

    quota_data: reactive[QuotaData | None] = reactive(None)
    token_data: reactive[TokenData | None] = reactive(None)
    api_usage: reactive[ApiUsageData | None] = reactive(None)
    api_mode: reactive[bool] = reactive(False)

    def __init__(self, mode: str = "quota"):
        super().__init__()
        self.api_mode = mode == "api"
        self._last_refresh: float = 0
        self._config = load_config()
        self._refresh_interval = int(self._config.get("refresh_interval", 5))

    def compose(self) -> ComposeResult:
        yield HeaderBar(id="header")

        if not is_authenticated() and not get_admin_api_key():
            yield Container(
                Static(
                    "[bold yellow]Not authenticated[/bold yellow]\n\n"
                    "Run [bold]claudemon setup[/bold] to configure your OAuth token\n"
                    "and start monitoring your Claude quota.\n\n"
                    "[dim]claudemon setup       — OAuth + optional Admin API\n"
                    "claudemon setup --api — Admin API key only[/dim]",
                    id="setup-message",
                ),
            )
        else:
            with Horizontal(id="main-container"):
                yield PieChart(id="pie-chart")
                with Container(id="stats-area"):
                    yield StatsPanel(id="stats-panel")

        yield Footer()

    def on_mount(self) -> None:
        header = self.query_one(HeaderBar)
        header.plan_type = self._config.get("plan_type", "pro")

        if is_authenticated() or get_admin_api_key():
            self._do_refresh()
            self.set_interval(self._refresh_interval, self._do_refresh)
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
            # Fetch OAuth quota data
            oauth_token = get_oauth_token()
            if oauth_token:
                quota = await fetch_quota(oauth_token)
                self.quota_data = quota
                header.plan_type = quota.plan_type or self._config.get(
                    "plan_type", "pro"
                )

                # Update pie chart
                try:
                    pie = self.query_one("#pie-chart", PieChart)
                    pie.usage_pct = quota.five_hour_usage_pct
                    pie.label = "5-Hour Quota"
                except Exception:
                    pass

                # Update stats panel
                try:
                    stats = self.query_one("#stats-panel", StatsPanel)
                    stats.quota_data = quota
                except Exception:
                    pass

            # Fetch Admin API data if configured
            admin_key = get_admin_api_key()
            if admin_key and self.api_mode:
                self.api_usage = await fetch_api_usage(admin_key)
                try:
                    stats = self.query_one("#stats-panel", StatsPanel)
                    stats.api_usage = self.api_usage
                    stats.show_api_mode = True
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

    def action_refresh(self) -> None:
        self._do_refresh()

    def action_toggle_mode(self) -> None:
        self.api_mode = not self.api_mode
        try:
            stats = self.query_one("#stats-panel", StatsPanel)
            stats.show_api_mode = self.api_mode
        except Exception:
            pass
        self._do_refresh()

    def action_help(self) -> None:
        self.notify(
            "q: Quit | r: Refresh | m: Toggle API mode | ?: Help",
            title="Keybindings",
            timeout=5,
        )
