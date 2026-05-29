# Short command layer for day-to-day Chrona work.
# Use `just --list` for the catalog and `bun run chrona help` for full groups.

default: help

# Show available just recipes
help:
    @just --list

# ── Grouped Commands ──────────────────────────────────────────

# Show or run dev commands: just dev [all|web|server]
dev target="":
    @if [ -z "{{target}}" ]; then bun run chrona dev; else bun run chrona dev {{target}}; fi

# Show or run server commands: just server [start|dev|bundle-check]
server target="":
    @if [ -z "{{target}}" ]; then bun run chrona server; else bun run chrona server {{target}}; fi

# Show or run build commands: just build [web|linux-x64|linux-arm64|darwin-x64|darwin-arm64|windows-x64]
build target="":
    @if [ -z "{{target}}" ]; then bun run chrona build; else bun run chrona build {{target}}; fi

# Show or run check commands: just check [all|type|lint|deadcode|exports|deps|pages|ui|boundaries]
check target="" *args:
    @if [ -z "{{target}}" ]; then bun run chrona check; else bun run chrona check {{target}} -- {{args}}; fi

# Show or run test commands: just test [all|unit|web|watch|api|bun|e2e|desktop|tablet|mobile|llm:record|llm:replay]
test target="" *args:
    @if [ -z "{{target}}" ]; then bun run chrona test; else bun run chrona test {{target}} -- {{args}}; fi

# Show or run database commands: just db [generate|push|migrate|seed|fixtures]
db target="" *args:
    @if [ -z "{{target}}" ]; then bun run chrona db; else bun run chrona db {{target}} -- {{args}}; fi

# Show or run binary build commands: just binary [current|linux-x64|linux-arm64|darwin-x64|darwin-arm64|windows-x64]
binary target="":
    @if [ -z "{{target}}" ]; then bun run chrona binary; else bun run chrona binary {{target}}; fi

# Show or run LLM fixture commands: just llm [record|replay]
llm target="":
    @if [ -z "{{target}}" ]; then bun run chrona llm; else bun run chrona llm {{target}}; fi

# Show or run demo commands: just demo [readme-gif]
demo target="":
    @if [ -z "{{target}}" ]; then bun run chrona demo; else bun run chrona demo {{target}}; fi

# Show or run plugin commands: just plugin [hermes]
plugin target="":
    @if [ -z "{{target}}" ]; then bun run chrona plugin; else bun run chrona plugin {{target}}; fi

# ── Common Aliases ────────────────────────────────────────────

# TypeScript type checking
typecheck:
    bun run chrona check type

# Vitest unit tests
unit *args:
    bun run chrona test unit -- {{args}}

# ESLint across the monorepo
lint:
    bun run chrona check lint

# UI foundation rules
ui:
    bun run chrona check ui

# Dependency-cruiser boundary check
boundaries:
    bun run chrona check boundaries

# Run API tests
api:
    bun run chrona test api

# Run Bun-only tests
bun-test:
    bun run chrona test bun

# Run Playwright E2E tests
e2e *args:
    bun run chrona test e2e -- {{args}}

# Full DB setup: generate client + seed
db-setup:
    bun run setup

# Build the portable binary for the current platform
binary-build:
    bun run chrona build

# ── Demo Artifacts ────────────────────────────────────────────

# Remove old demo artifacts and GIFs
clean-videos:
    rm -rf artifacts/demo/playwright/
    rm -f docs/assets/demo-plan.gif docs/assets/demo-assistant.gif

# Run Playwright recordings
_playwright:
    bunx playwright test --config=playwright.record.config.ts

# Convert recorded videos to GIFs
_convert-gifs:
    @sh scripts/demo/convert-record-gifs.sh

# Run demos in debug mode
demo-debug: clean-videos
    bunx playwright test --config=playwright.record.config.ts --debug

# ── Cleanup ──────────────────────────────────────────────────

# Clean generated artifacts
clean:
    rm -rf artifacts/demo/playwright/
    rm -rf dist/
    rm -rf coverage/
    rm -rf .tsbuildinfo
