"""Read-only OpenCode Zen/Go usage bridge for the Hermes Desktop plugin.

Queries the public OpenCode Zen usage endpoint (opencode.ai/zen/go/v1/usage)
with the API key stored in $HERMES_HOME/.env (OPENCODE_GO_API_KEY /
OPENCODE_ZEN_API_KEY), mirroring the codex-usage-meter plugin's auth and
caching pattern.
"""
from __future__ import annotations

import datetime as _dt
import hmac
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

try:
    from hermes_constants import get_hermes_home
except ImportError:  # pragma: no cover - source-tree tests
    def get_hermes_home() -> Path:
        configured = (os.environ.get("HERMES_HOME") or "").strip()
        return Path(configured) if configured else Path.home() / ".hermes"


_USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
_ENV_KEY_CANDIDATES = (
    "OPENCODE_GO_API_KEY",
    "OPENCODE_ZEN_API_KEY",
    "OPENCODE_API_KEY",
)
_CACHE_SECONDS = 45
_TIMEOUT_SECONDS = 20
_CACHE_LOCK = threading.RLock()
_CACHE: tuple[float, dict[str, Any]] | None = None


def _host_session_token() -> str:
    host_module = sys.modules.get("hermes_cli.web_server")
    token = getattr(host_module, "_SESSION_TOKEN", None) if host_module else None
    return str(token or os.environ.get("HERMES_DASHBOARD_SESSION_TOKEN") or "")


def _request_bearer(request: Request) -> str:
    authorization = request.headers.get("authorization", "")
    scheme, separator, token = authorization.partition(" ")
    return token.strip() if separator and scheme.lower() == "bearer" else ""


def _require_plugin_auth(request: Request) -> None:
    app_state = getattr(getattr(request, "app", None), "state", None)
    if getattr(app_state, "auth_required", False):
        request_state = getattr(request, "state", None)
        if getattr(request_state, "session", None) is not None or getattr(
            request_state, "token_authenticated", False
        ):
            return
        raise HTTPException(status_code=401, detail="Unauthorized")
    expected = _host_session_token()
    supplied = (request.headers.get("x-hermes-session-token", ""), _request_bearer(request))
    if expected and any(
        token and hmac.compare_digest(token.encode("utf-8"), expected.encode("utf-8"))
        for token in supplied
    ):
        return
    raise HTTPException(status_code=401, detail="Unauthorized")


router = APIRouter(dependencies=[Depends(_require_plugin_auth)])


def _api_key() -> str:
    """Return the OpenCode API key, preferring process env then $HERMES_HOME/.env."""
    for name in _ENV_KEY_CANDIDATES:
        value = (os.environ.get(name) or "").strip()
        if value:
            return value
    env_path = Path(get_hermes_home()) / ".env"
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            if key.strip() in _ENV_KEY_CANDIDATES:
                value = value.strip().strip('"').strip("'")
                if value:
                    return value
    raise RuntimeError("OpenCode API key was not found")


def _parse_iso_to_epoch(value: Any) -> int | None:
    if isinstance(value, (int, float)):
        return int(value)
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = _dt.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        return int(parsed.timestamp())
    except ValueError:
        return None


def _fetch_usage() -> dict[str, Any]:
    token = _api_key()
    # Cloudflare on opencode.ai blocks non-browser User-Agents (HTTP 403, code 1010).
    request = urllib.request.Request(
        _USAGE_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
            ),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
            body = response.read()
    except TimeoutError as exc:
        raise RuntimeError("Timed out waiting for OpenCode usage API") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("OpenCode usage API is unreachable") from exc
    try:
        payload = json.loads(body.decode("utf-8", "replace"))
    except json.JSONDecodeError as exc:
        raise RuntimeError("OpenCode returned an invalid usage payload") from exc
    usage = payload.get("usage") if isinstance(payload, dict) else None
    if not isinstance(usage, dict):
        raise RuntimeError("OpenCode returned no usage windows")
    return usage


def _window_label(name: str) -> str:
    return {
        "rolling": "Rolling limit",
        "weekly": "Weekly limit",
        "monthly": "Monthly limit",
    }.get(name, f"{name.capitalize()} limit")


def _normalize_usage(usage: dict[str, Any]) -> dict[str, Any]:
    windows: list[dict[str, Any]] = []
    for position, name in enumerate(("rolling", "weekly", "monthly")):
        window = usage.get(name)
        if not isinstance(window, dict):
            continue
        used = window.get("percent")
        if not isinstance(used, (int, float)):
            continue
        used = max(0.0, min(100.0, float(used)))
        windows.append(
            {
                "key": f"{name}-{position}",
                "label": _window_label(name),
                "usedPercent": used,
                "remainingPercent": round(100.0 - used, 1),
                "resetsAt": _parse_iso_to_epoch(window.get("resetsAt")),
            }
        )
    if not windows:
        raise RuntimeError("OpenCode returned no active usage windows")
    return {
        "status": "ok",
        "source": "opencode-go",
        "fetchedAt": int(time.time() * 1000),
        "windows": windows,
    }


def _current_usage() -> dict[str, Any]:
    global _CACHE
    with _CACHE_LOCK:
        now = time.monotonic()
        if _CACHE is not None and now - _CACHE[0] < _CACHE_SECONDS:
            return _CACHE[1]
        normalized = _normalize_usage(_fetch_usage())
        _CACHE = (now, normalized)
        return normalized


def _safe_error_message(exc: Exception) -> str:
    message = str(exc)
    safe_messages = (
        "OpenCode API key was not found",
        "OpenCode usage API is unreachable",
        "Timed out waiting for OpenCode usage API",
        "OpenCode returned an invalid usage payload",
        "OpenCode returned no usage windows",
    )
    for safe in safe_messages:
        if message.startswith(safe):
            return safe
    return "OpenCode usage is temporarily unavailable."


@router.get("/usage")
def usage() -> dict[str, Any]:
    try:
        return _current_usage()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=_safe_error_message(exc)) from None
