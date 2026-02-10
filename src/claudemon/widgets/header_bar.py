"""Header bar widget showing title, plan type, and refresh status."""

from textual.app import ComposeResult
from textual.reactive import reactive
from textual.widget import Widget
from textual.widgets import Static


class HeaderBar(Widget):
    """Top header bar with app title, plan badge, and refresh indicator."""

    DEFAULT_CSS = """
    HeaderBar {
        width: 100%;
        height: 3;
        background: $surface;
        padding: 0 2;
    }

    HeaderBar > Static {
        width: 100%;
        height: 3;
        content-align: center middle;
    }
    """

    plan_type: reactive[str] = reactive("pro")
    last_refresh_ago: reactive[int] = reactive(0)
    is_loading: reactive[bool] = reactive(True)
    error_message: reactive[str] = reactive("")

    def compose(self) -> ComposeResult:
        yield Static(id="header-content")

    def _render_header(self) -> str:
        plan_badge = f"[bold cyan]{self.plan_type.upper()} Plan[/bold cyan]"

        if self.error_message:
            status = f"[bold red]! {self.error_message}[/bold red]"
        elif self.is_loading:
            status = "[dim]⟳ loading...[/dim]"
        elif self.last_refresh_ago == 0:
            status = "[green]⟳ just now[/green]"
        else:
            status = f"[dim]⟳ refreshed {self.last_refresh_ago}s ago[/dim]"

        return f"[bold]claudemon[/bold]          {plan_badge}       {status}"

    def watch_plan_type(self, value: str) -> None:
        self._update_display()

    def watch_last_refresh_ago(self, value: int) -> None:
        self._update_display()

    def watch_is_loading(self, value: bool) -> None:
        self._update_display()

    def watch_error_message(self, value: str) -> None:
        self._update_display()

    def _update_display(self) -> None:
        try:
            content = self.query_one("#header-content", Static)
            content.update(self._render_header())
        except Exception:
            pass

    def on_mount(self) -> None:
        self._update_display()
