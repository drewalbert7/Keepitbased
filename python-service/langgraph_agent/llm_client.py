import os
import json
import logging
from typing import Any, Dict

import requests

logger = logging.getLogger(__name__)


class LlmClient:
    """Pluggable LLM adapter for LangGraph nodes."""

    def __init__(self):
        self.provider = os.getenv("LLM_PROVIDER", "").strip().lower()
        self.model = os.getenv("LLM_MODEL", "grok-4.20-reasoning")
        self.openai_api_key = os.getenv("OPENAI_API_KEY", "")
        self.openai_base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        self.grok_api_key = os.getenv("GROK_API_KEY", "") or os.getenv("XAI_API_KEY", "")
        self.grok_base_url = os.getenv("GROK_BASE_URL", "https://api.x.ai/v1")
        self.last_used_provider = "template"
        self.last_fallback_used = True

    def summarize_candidate(self, symbol: str, score: float, risk_flags: list[str]) -> Dict[str, Any]:
        if self.provider == "openai" and self.openai_api_key:
            try:
                result = self._openai_summarize(symbol, score, risk_flags)
                self.last_used_provider = "openai"
                self.last_fallback_used = False
                return result
            except Exception as exc:
                # Fail safely to deterministic template
                logger.warning("OpenAI summarize fallback: %s", exc)
        if self.provider == "grok" and self.grok_api_key:
            try:
                result = self._grok_summarize(symbol, score, risk_flags)
                self.last_used_provider = "grok"
                self.last_fallback_used = False
                return result
            except Exception as exc:
                # Fail safely to deterministic template
                logger.warning("Grok summarize fallback: %s", exc)

        self.last_used_provider = "template"
        self.last_fallback_used = True
        return {
            "whyNow": f"{symbol} ranks well on configured momentum/trend/liquidity signals.",
            "confidenceExplain": "Confidence reflects weighted technical and risk-adjusted factors."
        }

    def _openai_summarize(self, symbol: str, score: float, risk_flags: list[str]) -> Dict[str, Any]:
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a trading assistant. Return concise JSON with keys "
                        "'whyNow' and 'confidenceExplain'."
                    )
                },
                {
                    "role": "user",
                    "content": (
                        f"Symbol: {symbol}\n"
                        f"Score: {score}\n"
                        f"Risk flags: {', '.join(risk_flags) if risk_flags else 'none'}\n"
                        "Explain in plain language."
                    )
                }
            ],
            "temperature": 0.2,
            "response_format": {"type": "json_object"}
        }
        response = requests.post(
            f"{self.openai_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.openai_api_key}",
                "Content-Type": "application/json"
            },
            json=payload,
            timeout=15
        )
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        return json.loads(content)

    def _grok_summarize(self, symbol: str, score: float, risk_flags: list[str]) -> Dict[str, Any]:
        system_prompt = "Return compact JSON with keys whyNow and confidenceExplain."
        user_prompt = (
            f"Symbol: {symbol}\n"
            f"Score: {score}\n"
            f"Risk flags: {', '.join(risk_flags) if risk_flags else 'none'}\n"
            "Keep the explanation brief and factual."
        )
        payload = {
            "model": self.model,
            "input": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        headers = {
            "Authorization": f"Bearer {self.grok_api_key}",
            "Content-Type": "application/json",
        }
        content = ""
        primary_error = None
        try:
            response = requests.post(
                f"{self.grok_base_url}/responses",
                headers=headers,
                json=payload,
                timeout=15,
            )
            response.raise_for_status()
            data = response.json()
            content = self._extract_responses_text(data)
        except requests.HTTPError as exc:
            primary_error = exc
            status = exc.response.status_code if exc.response is not None else None
            if status not in (400, 404, 405):
                raise

        # Compatibility retry for providers exposing chat-completions semantics.
        if not content:
            chat_payload = {
                "model": self.model,
                "messages": [
                    {
                        "role": "system",
                        "content": system_prompt
                    },
                    {
                        "role": "user",
                        "content": user_prompt
                    }
                ]
            }
            response = requests.post(
                f"{self.grok_base_url}/chat/completions",
                headers=headers,
                json=chat_payload,
                timeout=15,
            )
            response.raise_for_status()
            data = response.json()
            content = self._extract_chat_text(data)

        if not content and primary_error is not None:
            raise primary_error
        if not content:
            raise ValueError("Grok response did not include output text")
        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict) and parsed.get("whyNow"):
                return parsed
        except Exception:
            pass

        # Accept non-JSON text by mapping it safely to schema keys.
        return {
            "whyNow": content.strip(),
            "confidenceExplain": "Generated by Grok response text with schema fallback mapping."
        }

    @staticmethod
    def _extract_responses_text(data: Dict[str, Any]) -> str:
        content = (
            data.get("output_text")
            or data.get("response", {}).get("output_text")
            or ""
        )
        if content:
            return str(content).strip()

        if isinstance(data.get("output"), list):
            text_chunks = []
            for item in data["output"]:
                if isinstance(item, dict) and isinstance(item.get("content"), list):
                    for part in item["content"]:
                        if isinstance(part, dict) and part.get("type") in {"output_text", "text"}:
                            text_chunks.append(part.get("text", ""))
            return "\n".join([c for c in text_chunks if c]).strip()
        return ""

    @staticmethod
    def _extract_chat_text(data: Dict[str, Any]) -> str:
        choices = data.get("choices")
        if isinstance(choices, list) and choices:
            message = choices[0].get("message", {})
            if isinstance(message, dict):
                content = message.get("content", "")
                return str(content).strip()
        return ""
