# OpenCode Usage Meter

A [Hermes Agent](https://hermes-agent.nousresearch.com) Desktop status-bar plugin that shows your live [OpenCode](https://opencode.ai) Zen/Go usage windows (rolling, weekly, monthly) with reset times.

Inspired by [codex-usage-meter](https://github.com/BkashJEE/codex-usage-meter) — the Codex counterpart for the same status bar.

## Features

- Status-bar chip with the OpenCode brand mark and the current remaining percentage
- Popover with Rolling / Weekly / Monthly usage windows, each showing used %, remaining % and the reset time
- 45s in-memory cache, 20s request timeout — no background polling loops
- Reads the key from your local `~/.hermes/.env`; never stores or logs it

## Requirements

- Hermes Agent Desktop (the status bar is part of the Desktop app)
- An OpenCode API key (Go or Zen) in `~/.hermes/.env`:

```env
OPENCODE_GO_API_KEY=sk-...
# or
OPENCODE_ZEN_API_KEY=sk-...
```

## Install

The repo follows the same layout as the Codex meter — `backend/` (plugin.yaml + dashboard API) and `desktop/` (status-bar frontend). Install from a local checkout:

```bash
hermes plugins install file:///path/to/opencode-usage-meter --enable
```

This places the backend under `~/.hermes/plugins/opencode-usage-meter/` and the frontend under `~/.hermes/desktop-plugins/opencode-usage-meter/`.

Then restart Hermes Desktop. The frontend hot-reloads on file change; the backend route mounts at backend startup, so a restart is required once after installing.

## How it works

- The backend calls `https://opencode.ai/zen/go/v1/usage` with your key (a browser User-Agent is required — the endpoint is behind Cloudflare and blocks non-browser UAs with HTTP 403 / error 1010).
- Usage is account-wide: Zen and Go keys report the same numbers, so the popover shows a single set of windows labeled `GO`.
- Both parts fail closed: on any error the chip shows `—` and the popover reports `Data unavailable`; no fake numbers are ever rendered.

## Privacy

- Direct HTTPS call to `opencode.ai` only — no third-party analytics, no telemetry
- The API key is read from `~/.hermes/.env` at request time and is never written to logs
- No local attribution/session scanning (unlike the Codex meter)

## License

MIT
