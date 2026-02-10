# Claudemon - Development Commands
# https://github.com/casey/just

# Default recipe to display help
default:
    @just --list

# Format code with ruff
format:
    uv run ruff format src/claudemon/

# Lint code with ruff
lint:
    uv run ruff check src/claudemon/

# Fix linting issues automatically
fix:
    uv run ruff check --fix src/claudemon/

# Type check with ty
check:
    uv run ty check src/claudemon/

# Run all quality checks (format, lint, type check)
qa: format lint check

# Run tests
test:
    uv run python -m pytest

# Build distribution packages
build:
    uv build

# Clean build artifacts
clean:
    rm -rf dist/ build/ *.egg-info
    find . -type d -name __pycache__ -exec rm -rf {} +
    find . -type f -name "*.pyc" -delete

# Publish to PyPI (requires credentials in ~/.pypirc)
publish: clean build
    @echo "Publishing to PyPI..."
    uv publish --token "$(grep -A2 '\[pypi\]' ~/.pypirc | grep password | cut -d'=' -f2- | xargs)"
