"""Read-only OpenCode usage bridge for the Hermes Desktop plugin.

Queries the public OpenCode usage endpoint (opencode.ai/zen/go/v1/usage)
with the API key stored in $HERMES_HOME/.env (OPENCODE_GO_API_KEY /
OPENCODE_ZEN_API_KEY), mirroring the codex-usage-meter plugin's auth and
caching pattern.
"""
from __future__ import annotations

import datetime as _dt
import hmac
import json
import os
import re
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
# Key precedence: GO → ZEN → generic. The endpoint is account-wide, so
# Zen and Go keys return identical numbers (Zen usage can't be split out).
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


# ─── Iris: providers additionnels (OpenRouter / Exa / Kagi) ──────────────

_ENV_PATH = Path(get_hermes_home()) / ".env"


def _env_value(name: str) -> str:
    """Clé API : process env d'abord, puis $HERMES_HOME/.env (clé non commentée)."""
    value = (os.environ.get(name) or "").strip()
    if value:
        return value
    if _ENV_PATH.is_file():
        for line in _ENV_PATH.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, raw = line.partition("=")
            if key.strip() == name:
                return raw.strip().strip('"').strip("'")
    return ""


def _kagi_session_cookie() -> str:
    """Session Kagi : KAGI_SESSION_LINK (lien complet ?token=...) ou token brut."""
    raw = os.environ.get("KAGI_SESSION_LINK") or os.environ.get("KAGI_SESSION_TOKEN") or _env_value("KAGI_SESSION_LINK")
    if not raw:
        return ""
    raw = raw.strip()
    if "token=" in raw:
        try:
            from urllib.parse import urlparse, parse_qs
            return parse_qs(urlparse(raw).query).get("token", [""])[0]
        except Exception:
            return ""
    return raw


def _http_get(url: str, headers: dict[str, str], timeout: int = 15) -> Any:
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read()
    content_type = response.headers.get("content-type", "")
    if "json" in content_type:
        return json.loads(body.decode("utf-8", "replace"))
    return body.decode("utf-8", "replace")


def _fetch_openrouter() -> dict[str, Any] | None:
    key = _env_value("OPENROUTER_API_KEY")
    if not key:
        return None
    headers = {"Authorization": f"Bearer {key}"}
    key_data = _http_get("https://openrouter.ai/api/v1/key", headers, timeout=10).get("data", {})
    credits = _http_get("https://openrouter.ai/api/v1/credits", headers, timeout=10).get("data", {})
    total = float(credits.get("total_credits") or 0.0)
    used = float(credits.get("total_usage") or 0.0)
    return {
        "kind": "balance",
        "balance": round(total - used, 2),
        "totalCredits": round(total, 2),
        "dailyUsage": round(float(key_data.get("usage_daily") or 0.0), 2),
        "weeklyUsage": round(float(key_data.get("usage_weekly") or 0.0), 2),
        "monthlyUsage": round(float(key_data.get("usage_monthly") or 0.0), 2),
    }


def _fetch_exa() -> dict[str, Any] | None:
    service_key = _env_value("EXA_SERVICE_API_KEY")
    if not service_key:
        return None
    headers = {"x-api-key": service_key, "User-Agent": "Mozilla/5.0"}
    keys_payload = _http_get(
        "https://admin-api.exa.ai/team-management/api-keys", headers, timeout=15
    )
    api_keys = keys_payload.get("apiKeys") or (
        [keys_payload["apiKey"]] if keys_payload.get("apiKey") else []
    )
    if not api_keys:
        raise RuntimeError("Exa: no API key id found")
    key_id = api_keys[0].get("id", "")
    if not key_id:
        raise RuntimeError("Exa: no API key id found")
    now = _dt.datetime.now(_dt.timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).strftime("%Y-%m-%d")
    try:
        usage = _http_get(
            f"https://admin-api.exa.ai/team-management/api-keys/{key_id}/usage?start_date={start}",
            headers, timeout=15,
        )
    except urllib.error.HTTPError as exc:
        if exc.code != 400:
            raise
        usage = _http_get(
            f"https://admin-api.exa.ai/team-management/api-keys/{key_id}/usage",
            headers, timeout=15,
        )
    spent = float(usage.get("total_cost_usd") or 0.0)
    monthly_budget = 10.0  # allocation Exa d'Elektro (bonus de 10 $ expiré le 03/09)
    return {
        "kind": "budget",
        "spent": round(spent, 2),
        "budget": monthly_budget,
        "remaining": round(monthly_budget - spent, 2),
    }


def _fetch_kagi() -> dict[str, Any] | None:
    token = _kagi_session_cookie()
    if not token:
        return None
    html = _http_get(
        "https://kagi.com/api/billing",
        {"Cookie": f"kagi_session={token}", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"},
        timeout=15,
    )
    if isinstance(html, dict):
        raise RuntimeError("Kagi session expired")
    match = re.search(r"Balance.*?\$\s?(\d+[.,]\d{2})", html[:html.find("Balance") + 400] if "Balance" in html else html, re.DOTALL)
    balance = float(match.group(1).replace(",", ".")) if match else None
    if balance is None:
        raise RuntimeError("Kagi: balance not found in billing page")
    return {"kind": "balance", "balance": round(balance, 2)}


def _fetch_firecrawl() -> dict[str, Any] | None:
    key = _env_value("FIRECRAWL_API_KEY")
    if not key:
        return None
    data = _http_get(
        "https://api.firecrawl.dev/v2/team/credit-usage",
        {"Authorization": f"Bearer {key}"},
        timeout=10,
    ).get("data", {})
    remaining = float(data.get("remainingCredits") or 0.0)
    total = float(data.get("planCredits") or 0.0)
    return {
        "kind": "credits",
        "remaining": remaining,
        "total": total,
        "usedPercent": round(100.0 * (total - remaining) / total, 1) if total else None,
        "periodEnd": data.get("billingPeriodEnd"),
    }


def _fetch_tavily() -> dict[str, Any] | None:
    key = _env_value("TAVILY_API_KEY")
    if not key:
        return None
    payload = _http_get(
        "https://api.tavily.com/usage",
        {"Authorization": f"Bearer {key}"},
        timeout=10,
    )
    account = payload.get("account", {}) if isinstance(payload, dict) else {}
    used = float(account.get("plan_usage") or 0.0)
    limit_raw = account.get("plan_limit")
    limit = float(limit_raw) if limit_raw is not None else None
    return {
        "kind": "plan",
        "plan": account.get("current_plan"),
        "used": used,
        "limit": limit,
        "remaining": round(limit - used, 1) if limit is not None else None,
        "usedPercent": round(100.0 * used / limit, 1) if limit else None,
    }


_PROVIDER_FETCHERS = {
    "openrouter": _fetch_openrouter,
    "exa": _fetch_exa,
    "kagi": _fetch_kagi,
    "firecrawl": _fetch_firecrawl,
    "tavily": _fetch_tavily,
}

_OTHER_CACHE: dict[str, tuple[float, dict[str, Any] | None]] = {}
_OTHER_CACHE_LOCK = threading.RLock()
_OTHER_CACHE_SECONDS = 300  # soldes : pas besoin de fraîcheur à la seconde


def _provider_payload(name: str) -> dict[str, Any]:
    fetch = _PROVIDER_FETCHERS.get(name)
    if fetch is None:
        raise HTTPException(status_code=404, detail=f"Unknown provider {name}")
    with _OTHER_CACHE_LOCK:
        cached = _OTHER_CACHE.get(name)
        now = time.monotonic()
        if cached and now - cached[0] < _OTHER_CACHE_SECONDS:
            return cached[1] or {"status": "unavailable"}
    try:
        payload = fetch()
    except urllib.error.HTTPError as exc:
        payload = {"error": f"{name}: HTTP {exc.code}"}
    except Exception as exc:
        payload = {"error": str(exc)[:120]}
    with _OTHER_CACHE_LOCK:
        if payload is None:
            _OTHER_CACHE[name] = (now, None)
            return {"status": "not_configured"}
        if "error" in payload:
            _OTHER_CACHE[name] = (now, None)  # ne pas cacher une erreur
            return {"status": "error", "error": payload["error"]}
        result = {"status": "ok", **payload, "fetchedAt": int(time.time() * 1000)}
        _OTHER_CACHE[name] = (now, result)
        return result


@router.get("/providers")
def providers() -> dict[str, Any]:
    return {name: _provider_payload(name) for name in _PROVIDER_FETCHERS}
