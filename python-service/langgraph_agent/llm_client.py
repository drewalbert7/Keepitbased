import os
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

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
        """URLs returned by the Responses API when using x_search (for audit + email links)."""
        self.last_x_search_citations: List[str] = []

    def summarize_candidate(
        self,
        symbol: str,
        score: float,
        risk_flags: list[str],
        *,
        news_context: Optional[str] = None,
    ) -> Dict[str, Any]:
        nc = (news_context or "").strip()[:1200]
        if self.provider == "openai" and self.openai_api_key:
            try:
                result = self._openai_summarize(symbol, score, risk_flags, news_context=nc)
                self.last_used_provider = "openai"
                self.last_fallback_used = False
                return result
            except Exception as exc:
                # Fail safely to deterministic template
                logger.warning("OpenAI summarize fallback: %s", exc)
        if self.provider == "grok" and self.grok_api_key:
            try:
                result = self._grok_summarize(symbol, score, risk_flags, news_context=nc)
                self.last_used_provider = "grok"
                self.last_fallback_used = False
                return result
            except Exception as exc:
                # Fail safely to deterministic template
                logger.warning("Grok summarize fallback: %s", exc)

        self.last_used_provider = "template"
        self.last_fallback_used = True
        why = f"{symbol} ranks well on configured momentum/trend/liquidity signals."
        conf = "Confidence reflects weighted technical and risk-adjusted factors."
        if nc:
            why += " Recent ingested wire headlines are listed for context only — verify material facts independently."
            conf += " Headline-derived flags may elevate event-risk weighting."
        return {"whyNow": why, "confidenceExplain": conf}

    def _openai_summarize(
        self,
        symbol: str,
        score: float,
        risk_flags: list[str],
        *,
        news_context: str = "",
    ) -> Dict[str, Any]:
        user_body = (
            f"Symbol: {symbol}\n"
            f"Score: {score}\n"
            f"Risk flags: {', '.join(risk_flags) if risk_flags else 'none'}\n"
        )
        if news_context:
            user_body += (
                "Recent ingested headline titles/snippets (verify independently; may be incomplete):\n"
                f"{news_context}\n"
            )
        user_body += "Explain in plain language."
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
                    "content": user_body,
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

    def _grok_summarize(
        self,
        symbol: str,
        score: float,
        risk_flags: list[str],
        *,
        news_context: str = "",
    ) -> Dict[str, Any]:
        system_prompt = "Return compact JSON with keys whyNow and confidenceExplain."
        user_prompt = (
            f"Symbol: {symbol}\n"
            f"Score: {score}\n"
            f"Risk flags: {', '.join(risk_flags) if risk_flags else 'none'}\n"
        )
        if news_context:
            user_prompt += (
                "Recent ingested headline titles/snippets (verify independently; may be incomplete):\n"
                f"{news_context}\n"
            )
        user_prompt += "Keep the explanation brief and factual."
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

    def generate_dip_insight(
        self,
        dip_facts: Dict[str, Any],
        x_snippets: list,
        max_allocation_pct: float,
    ) -> Dict[str, Any]:
        """
        Grok-backed dip briefing. Uses xAI **x_search** on the Responses API (no X/Twitter API key).
        Optional x_snippets from Node are ignored unless x_search is disabled.
        """
        self.last_x_search_citations = []
        cap = float(max_allocation_pct)
        if cap <= 0 or cap > 50:
            cap = 10.0

        use_x_search = (
            os.getenv("DIP_INSIGHT_USE_X_SEARCH", "true").strip().lower() in ("1", "true", "yes")
        )

        if self.provider == "grok" and self.grok_api_key and use_x_search:
            try:
                raw = self._grok_dip_insight_x_search(dip_facts, cap)
                self.last_used_provider = "grok"
                self.last_fallback_used = False
                return self._normalize_dip_insight(raw, cap)
            except Exception as exc:
                logger.warning("Grok dip insight x_search fallback: %s", exc)

        # Legacy: Node-supplied snippets when x_search is off (or Grok missing)
        if self.provider == "grok" and self.grok_api_key and x_snippets:
            try:
                facts_json = json.dumps(dip_facts, ensure_ascii=False)
                snip_lines = []
                for i, s in enumerate(x_snippets[:12]):
                    if isinstance(s, dict):
                        t = str(s.get("text", ""))[:400]
                        au = str(s.get("authorUsername", ""))
                        snip_lines.append(f"{i+1}. @{au}: {t}")
                    else:
                        snip_lines.append(f"{i+1}. {str(s)[:400]}")
                x_block = "\n".join(snip_lines) if snip_lines else "(No snippets.)"
                system = (
                    "You are a financial education assistant. Use ONLY the JSON facts and snippets provided. "
                    "Return a single JSON object with keys: situationSummary, xSentiment {label, drivers}, "
                    f"suggestedTranchePct (0..{cap}), riskNotes, fireSaleHypothesis."
                )
                user = f"FACTS_JSON:\n{facts_json}\n\nSNIPPETS:\n{x_block}\n\nRespond with JSON only."
                raw = self._grok_json_prompt(system, user, timeout=25)
                self.last_used_provider = "grok"
                self.last_fallback_used = False
                return self._normalize_dip_insight(raw, cap)
            except Exception as exc:
                logger.warning("Grok dip insight snippet fallback: %s", exc)

        self.last_used_provider = "template"
        self.last_fallback_used = True
        return self._dip_insight_template(dip_facts, cap)

    def _grok_dip_insight_x_search(self, dip_facts: Dict[str, Any], cap: float) -> Dict[str, Any]:
        """Responses API + native x_search tool (see xAI docs — no separate X API subscription)."""
        sym = str(dip_facts.get("symbol", "")).strip().upper()
        facts_json = json.dumps(dip_facts, ensure_ascii=False)
        now = datetime.now(timezone.utc)
        from_date = (now - timedelta(days=4)).strftime("%Y-%m-%d")
        to_date = now.strftime("%Y-%m-%d")

        system = (
            "You are a financial education assistant with access to x_search for live X posts. "
            "FACTS_JSON contains authoritative prices and % vs baseline — never contradict those numbers. "
            "Use x_search to find recent X discussion relevant to this dip (sentiment, headlines, fear, \"fire sale\" narratives). "
            "After searching, reply with ONLY valid JSON (no markdown code fence) having keys: "
            "situationSummary (string, 2-5 sentences), "
            "xSentiment (object: label bearish|neutral|bullish|unknown, drivers string citing themes from posts), "
            f"suggestedTranchePct (number between 0 and {cap}), "
            "riskNotes (array of strings), "
            "fireSaleHypothesis (string or null), "
            "xPostLinks (array of objects {{\"url\": string, \"note\": string}} — prefer URLs that appear in x_search citations for this symbol)."
        )
        user = (
            f"FACTS_JSON:\n{facts_json}\n\n"
            f"Task: Search X for ${sym} and related dip/sentiment discussion in the last few days. "
            f"Then output the JSON described above. Max tranche hint: {cap}% of portfolio."
        )

        payload = {
            "model": self.model,
            "tools": [
                {
                    "type": "x_search",
                    "from_date": from_date,
                    "to_date": to_date,
                }
            ],
            "input": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        headers = {
            "Authorization": f"Bearer {self.grok_api_key}",
            "Content-Type": "application/json",
        }
        response = requests.post(
            f"{self.grok_base_url}/responses",
            headers=headers,
            json=payload,
            timeout=90,
        )
        response.raise_for_status()
        data = response.json()

        citations = data.get("citations")
        if isinstance(citations, list):
            self.last_x_search_citations = [str(u) for u in citations if u]
        else:
            self.last_x_search_citations = []

        text = self._extract_responses_message_text(data) or self._extract_responses_text(data)
        if not text:
            raise ValueError("Empty Grok x_search response text")

        parsed = self._parse_json_object_from_text(text)
        if not isinstance(parsed, dict):
            raise ValueError("Grok did not return a JSON object")

        # Enrich links from API citations if model omitted
        x_links = parsed.get("xPostLinks")
        if not isinstance(x_links, list) or len(x_links) == 0:
            x_urls = [u for u in self.last_x_search_citations if "status/" in u or "/i/status/" in u]
            parsed["xPostLinks"] = [
                {"url": u, "note": "x_search citation"} for u in x_urls[:10]
            ]
        return parsed

    @staticmethod
    def _extract_responses_message_text(data: Dict[str, Any]) -> str:
        out = data.get("output") or []
        chunks = []
        for item in out:
            if not isinstance(item, dict):
                continue
            if item.get("type") != "message":
                continue
            for c in item.get("content") or []:
                if not isinstance(c, dict):
                    continue
                if c.get("type") in ("output_text", "text"):
                    chunks.append(str(c.get("text", "")))
        return "\n".join(chunks).strip()

    @staticmethod
    def _parse_json_object_from_text(text: str) -> Optional[Dict[str, Any]]:
        stripped = text.strip()
        if stripped.startswith("```"):
            lines = stripped.split("\n")
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            stripped = "\n".join(lines).strip()
        try:
            obj = json.loads(stripped)
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            pass
        m = re.search(r"\{[\s\S]*\}", stripped)
        if m:
            try:
                obj = json.loads(m.group(0))
                return obj if isinstance(obj, dict) else None
            except json.JSONDecodeError:
                pass
        return None

    def _grok_json_prompt(self, system: str, user: str, timeout: int = 20) -> Dict[str, Any]:
        payload = {
            "model": self.model,
            "input": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        headers = {
            "Authorization": f"Bearer {self.grok_api_key}",
            "Content-Type": "application/json",
        }
        content = ""
        try:
            response = requests.post(
                f"{self.grok_base_url}/responses",
                headers=headers,
                json=payload,
                timeout=timeout,
            )
            response.raise_for_status()
            data = response.json()
            content = self._extract_responses_text(data)
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status not in (400, 404, 405):
                raise
        if not content:
            chat_payload = {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.25,
                "response_format": {"type": "json_object"},
            }
            response = requests.post(
                f"{self.grok_base_url}/chat/completions",
                headers=headers,
                json=chat_payload,
                timeout=timeout,
            )
            response.raise_for_status()
            data = response.json()
            content = self._extract_chat_text(data)
        if not content:
            raise ValueError("Empty Grok response")
        stripped = content.strip()
        if stripped.startswith("```"):
            lines = stripped.split("\n")
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            stripped = "\n".join(lines).strip()
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            parsed = json.loads(content)
        if isinstance(parsed, dict):
            return parsed
        raise ValueError("Grok did not return a JSON object")

    def _normalize_dip_insight(self, raw: Dict[str, Any], cap: float) -> Dict[str, Any]:
        out = dict(raw)
        try:
            pct = float(out.get("suggestedTranchePct", 2))
        except (TypeError, ValueError):
            pct = 2.0
        pct = max(0.0, min(pct, cap, 50.0))
        out["suggestedTranchePct"] = round(pct, 2)
        if not isinstance(out.get("xSentiment"), dict):
            out["xSentiment"] = {"label": "unknown", "drivers": ""}
        if not isinstance(out.get("riskNotes"), list):
            out["riskNotes"] = []
        out["riskNotes"] = [str(x)[:300] for x in out["riskNotes"][:6]]
        out["situationSummary"] = str(out.get("situationSummary", ""))[:2000]
        links = out.get("xPostLinks")
        if isinstance(links, list):
            clean = []
            for item in links[:12]:
                if isinstance(item, dict) and item.get("url"):
                    clean.append(
                        {
                            "url": str(item.get("url", ""))[:800],
                            "note": str(item.get("note", ""))[:400],
                        }
                    )
            out["xPostLinks"] = clean
        return out

    def _dip_insight_template(self, dip_facts: Dict[str, Any], cap: float) -> Dict[str, Any]:
        sym = dip_facts.get("symbol", "—")
        vs = dip_facts.get("vsBaselinePct")
        return {
            "situationSummary": (
                f"{sym} moved vs your baseline (approx. {vs}%); review liquidity and upcoming catalysts before sizing."
            ),
            "xSentiment": {"label": "unknown", "drivers": "LLM unavailable; X sentiment not scored."},
            "suggestedTranchePct": min(2.0, cap),
            "riskNotes": [
                "Verify the quote and baseline in the app before acting.",
                "Model output is educational only.",
            ],
            "fireSaleHypothesis": None,
        }

    def generate_daily_watchlist_digest(self, watchlist_context: Dict[str, Any]) -> Dict[str, Any]:
        """Grok JSON digest: market overview, holdings commentary, suggested tickers not on list."""
        self.last_fallback_used = True
        wl_json = json.dumps(watchlist_context, default=str)[:24000]
        system = (
            "You are a disciplined equity research analyst. Given JSON snapshot of a user's tracked alerts "
            "(symbols, live prices vs baselines, dip sizing tiers), produce a morning-style briefing.\n"
            "Rules:\n"
            "- Output VALID JSON ONLY with keys: marketOverview (string, 2-5 sentences on macro/market tone "
            "relevant to these holdings), holdingsAnalysis (string, one paragraph on their positions vs baselines), "
            "suggestedAdditions (array), disclaimer (string).\n"
            "- suggestedAdditions: 3 to 5 objects. Each: symbol (uppercase US ticker 1-5 letters), thesis "
            "(<=420 chars), riskNote (<=260 chars), timeHorizon (swing | long_term | short_term).\n"
            "- Each suggested symbol must be a plausible liquid US equity NOT listed in the snapshot items[].symbol.\n"
            "- Professional tone; no emoji; cite generic sector/trend drivers not fabricated earnings numbers.\n"
            "- Educational only; not personalized investment advice.\n"
        )
        user = f"Watchlist snapshot JSON:\n{wl_json}"
        if self.provider == "grok" and self.grok_api_key:
            try:
                raw = self._grok_json_prompt(system, user, timeout=95)
                self.last_fallback_used = False
                self.last_used_provider = "grok"
                return self._normalize_daily_digest(raw, watchlist_context)
            except Exception as exc:
                logger.warning("Grok daily digest fallback: %s", exc)
        self.last_used_provider = "template"
        self.last_fallback_used = True
        return self._daily_digest_template(watchlist_context)

    def _normalize_daily_digest(
        self, raw: Dict[str, Any], ctx: Dict[str, Any]
    ) -> Dict[str, Any]:
        existing = set()
        for it in ctx.get("items") or []:
            sym = str(it.get("symbol") or "").upper().strip()
            if sym:
                existing.add(sym)
        suggestions: List[Dict[str, Any]] = []
        raw_list = raw.get("suggestedAdditions") or raw.get("suggested_additions") or []
        if not isinstance(raw_list, list):
            raw_list = []
        for item in raw_list:
            if not isinstance(item, dict):
                continue
            sym = str(item.get("symbol") or "").upper().strip()
            if not sym or sym in existing:
                continue
            if not re.match(r"^[A-Z]{1,6}$", sym):
                continue
            horizon = str(item.get("timeHorizon") or item.get("time_horizon") or "long_term").strip()
            if horizon not in ("swing", "long_term", "short_term"):
                horizon = "long_term"
            suggestions.append(
                {
                    "symbol": sym,
                    "thesis": str(item.get("thesis") or "")[:450],
                    "riskNote": str(item.get("riskNote") or item.get("risk_note") or "")[:280],
                    "timeHorizon": horizon[:32],
                }
            )
            existing.add(sym)
            if len(suggestions) >= 5:
                break
        return {
            "marketOverview": str(raw.get("marketOverview") or raw.get("market_overview") or "")[:2800],
            "holdingsAnalysis": str(
                raw.get("holdingsAnalysis") or raw.get("holdings_analysis") or ""
            )[:4000],
            "suggestedAdditions": suggestions,
            "disclaimer": str(
                raw.get("disclaimer")
                or "Educational commentary only; verify facts and suitability independently."
            )[:900],
        }

    def _daily_digest_template(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        items = ctx.get("items") or []
        syms = ", ".join(str(i.get("symbol")) for i in items[:12])
        return {
            "marketOverview": (
                "Market tone varies with rates, liquidity, and sector rotation; use indexes and breadth "
                "as context alongside your names."
            ),
            "holdingsAnalysis": (
                f"This snapshot includes {len(items)} tracked symbol(s): {syms or 'n/a'}. "
                "Confirm live quotes and baselines in the app before sizing."
            ),
            "suggestedAdditions": [],
            "disclaimer": (
                "LLM unavailable — placeholder digest only. Configure GROK_API_KEY on the Python service for full analysis."
            ),
        }

    @staticmethod
    def _extract_chat_text(data: Dict[str, Any]) -> str:
        choices = data.get("choices")
        if isinstance(choices, list) and choices:
            message = choices[0].get("message", {})
            if isinstance(message, dict):
                content = message.get("content", "")
                return str(content).strip()
        return ""

    def _markdown_chat(self, system: str, user: str, *, timeout: int = 60) -> str:
        """Single-turn markdown prose via chat completions (Grok or OpenAI)."""
        if self.provider == "openai" and self.openai_api_key:
            payload = {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.35,
            }
            response = requests.post(
                f"{self.openai_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=timeout,
            )
            response.raise_for_status()
            text = self._extract_chat_text(response.json())
            if text:
                return text
        if self.provider == "grok" and self.grok_api_key:
            headers = {
                "Authorization": f"Bearer {self.grok_api_key}",
                "Content-Type": "application/json",
            }
            chat_payload = {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.35,
            }
            response = requests.post(
                f"{self.grok_base_url}/chat/completions",
                headers=headers,
                json=chat_payload,
                timeout=timeout,
            )
            response.raise_for_status()
            text = self._extract_chat_text(response.json())
            if text:
                return text
        raise RuntimeError("No LLM provider configured for markdown chat")

    def answer_educational_qa(
        self,
        prompt: str,
        conversation_block: str,
        *,
        watchlist_digest: str,
        research_digest: str,
    ) -> str:
        """Dashboard Q&A: plain-language answer using only supplied context for market facts."""
        system = (
            "You are a financial education assistant for a watchlist and dip-alert app. "
            "Answer the user's question in clear Markdown.\n"
            "Rules:\n"
            "- Use ONLY the facts in CONTEXT blocks for prices, symbols, headlines, or portfolio hints. "
            "If context is missing something, say so — do not invent quotes or news.\n"
            "- No buy/sell commands; no guaranteed returns; remind the user to verify material facts.\n"
            "- Keep the answer focused; use short sections or bullets when helpful.\n"
        )
        user = (
            f"RECENT_CONVERSATION:\n{conversation_block}\n\n"
            f"WATCHLIST_AND_SIZING_CONTEXT:\n{watchlist_digest}\n\n"
            f"RECENT_HEADLINES_CONTEXT:\n{research_digest}\n\n"
            f"USER_QUESTION:\n{prompt}\n"
        )
        try:
            out = self._markdown_chat(system, user, timeout=65)
            self.last_used_provider = self.provider or "template"
            self.last_fallback_used = False
            return out.strip()
        except Exception as exc:
            logger.warning("answer_educational_qa fallback: %s", exc)
        self.last_used_provider = "template"
        self.last_fallback_used = True
        return (
            "**Educational note:** The live model is unavailable, so this is a generic pointer only.\n\n"
            "- For definitions (e.g. RSI), see reputable finance glossaries or your broker’s education center.\n"
            "- For moves on a specific symbol, check the app’s quotes and ingested headlines once Grok is configured on the Python service.\n"
        )

    def compose_scan_user_reply(
        self,
        prompt: str,
        conversation_block: str,
        packet: Dict[str, Any],
    ) -> str:
        """After opportunity scan: answer the user's actual question using only the JSON packet + thread."""
        system = (
            "You are a financial education assistant. The user ran a watchlist opportunity scan. "
            "Write a concise Markdown reply that answers their question in plain English.\n"
            "Rules:\n"
            "- Use ONLY numbers, symbols, scores, and flags present in SCAN_PACKET JSON. Do not invent data.\n"
            "- Summarize tradeoffs (momentum vs event risk, etc.) when relevant.\n"
            "- If SCAN_PACKET has zero candidates, explain possible reasons (filters, confidence floor) without blaming the user.\n"
            "- No buy/sell instructions; educational framing only.\n"
        )
        pack_json = json.dumps(packet, ensure_ascii=False, default=str)[:12000]
        user = (
            f"RECENT_CONVERSATION:\n{conversation_block}\n\n"
            f"SCAN_PACKET_JSON:\n{pack_json}\n\n"
            f"USER_MESSAGE:\n{prompt}\n"
        )
        try:
            out = self._markdown_chat(system, user, timeout=65)
            self.last_used_provider = self.provider or "template"
            self.last_fallback_used = False
            return out.strip()
        except Exception as exc:
            logger.warning("compose_scan_user_reply fallback: %s", exc)
        self.last_used_provider = "template"
        self.last_fallback_used = True
        cands = packet.get("topCandidates") or []
        if not cands:
            return (
                "The scan returned **no candidates** above your confidence floor. "
                "Try lowering the floor or widening the watchlist, then run **Scan & rank** again."
            )
        lines = [f"- **{c.get('symbol')}** — score `{c.get('score')}`, confidence `{c.get('confidence')}`" for c in cands[:5]]
        return "Here is a quick recap from the scan (template fallback; configure Grok for richer prose):\n\n" + "\n".join(lines)
