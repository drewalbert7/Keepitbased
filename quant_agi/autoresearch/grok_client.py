"""Minimal xAI Grok HTTP client (Responses + Chat Completions fallbacks)."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any, Dict, Optional


def extract_responses_text(data: Dict[str, Any]) -> str:
    content = data.get("output_text") or data.get("response", {}).get("output_text") or ""
    if content:
        return str(content).strip()

    if isinstance(data.get("output"), list):
        chunks: list[str] = []
        for item in data["output"]:
            if isinstance(item, dict) and isinstance(item.get("content"), list):
                for part in item["content"]:
                    if isinstance(part, dict) and part.get("type") in {"output_text", "text"}:
                        chunks.append(str(part.get("text", "") or ""))
        return "\n".join([c for c in chunks if c]).strip()
    return ""


def extract_chat_text(data: Dict[str, Any]) -> str:
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message", {})
        if isinstance(message, dict):
            return str(message.get("content", "") or "").strip()
    return ""


def _post_json(url: str, body: Dict[str, Any], headers: Dict[str, str], timeout_sec: float) -> Dict[str, Any]:
    encoded = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=encoded, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout_sec) as resp:  # noqa: S310 — fixed URLs
        raw = resp.read().decode("utf-8")
    return json.loads(raw)


def grok_json_object(
    *,
    api_key: str,
    base_url: str,
    model: str,
    system: str,
    user: str,
    timeout_sec: float,
) -> Optional[Dict[str, Any]]:
    """Ask Grok for a single JSON object; try /responses then /chat/completions."""
    bu = base_url.rstrip("/")
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    content = ""
    primary_exc: Optional[BaseException] = None
    try:
        data = _post_json(
            f"{bu}/responses",
            {"model": model, "input": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
            headers,
            timeout_sec,
        )
        content = extract_responses_text(data)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as ex:
        primary_exc = ex
        code = getattr(ex, "code", None)
        if isinstance(ex, urllib.error.HTTPError) and code not in (400, 404, 405):
            return None

    if not content:
        try:
            chat_body: Dict[str, Any] = {
                "model": model,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "temperature": 0.2,
            }
            chat_body["response_format"] = {"type": "json_object"}
            data = _post_json(f"{bu}/chat/completions", chat_body, headers, timeout_sec)
            content = extract_chat_text(data)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as ex:
            if primary_exc is None:
                primary_exc = ex
            return None

    if not content.strip():
        return None

    stripped = content.strip()
    if stripped.startswith("```"):
        lines = stripped.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()

    try:
        blob = json.loads(stripped)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", stripped)
        if not m:
            return None
        try:
            blob = json.loads(m.group(0))
        except json.JSONDecodeError:
            return None

    return blob if isinstance(blob, dict) else None


def effective_grok_api_key(configured: Optional[str]) -> str:
    return (configured or os.environ.get("XAI_API_KEY") or os.environ.get("GROK_API_KEY") or "").strip()


def grok_chat_text(
    *,
    api_key: str,
    base_url: str,
    model: str,
    messages: list[dict[str, str]],
    timeout_sec: float,
    temperature: float = 0.35,
) -> Optional[str]:
    """
    Plain conversational reply (chat completions). Used by coding-advisor UI.
    `messages` must be OpenAI-style: [{"role":"system"|"user"|"assistant","content":"..."}, ...]
    """
    bu = base_url.rstrip("/")
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": 4096,
    }
    try:
        data = _post_json(f"{bu}/chat/completions", body, headers, timeout_sec)
        text = extract_chat_text(data)
        return text.strip() if text else None
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
