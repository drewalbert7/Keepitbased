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
                        "'whyNow' and 'confidenceExplain'. "
                        "The Score is authoritative for cross-symbol ranking; do not contradict it."
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
        system_prompt = (
            "Return compact JSON with keys whyNow and confidenceExplain. "
            "The numeric Score is authoritative for ranking this symbol vs others in the same scan; "
            "do not contradict it or imply a different relative rank."
        )
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
        quant_context: Optional[Dict[str, Any]] = None,
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
                raw = self._grok_dip_insight_x_search(dip_facts, cap, quant_context)
                self.last_used_provider = "grok"
                self.last_fallback_used = False
                return self._normalize_dip_insight(raw, cap)
            except Exception as exc:
                logger.warning("Grok dip insight x_search fallback: %s", exc)

        # Legacy: Node-supplied snippets when x_search is off (or Grok missing)
        if self.provider == "grok" and self.grok_api_key and x_snippets:
            try:
                qc = json.dumps(quant_context or {}, ensure_ascii=False, default=str)
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
                    "You are a senior quant-education assistant (UltimateDipBuyer). Use ONLY the JSON facts and snippets. "
                    "Never contradict FACTS_JSON prices or % vs baseline. "
                    "Return ONE JSON object with keys: "
                    "verdict (Strong Buy | Buy | Hold | Pass), confidence (0-100 integer), reasoning (concise — timing, "
                    "invalidation, educational only), situationSummary (2-4 sentences), "
                    "xSentiment {label: bearish|neutral|bullish|unknown, drivers}, "
                    f"recommendedPositionPct (0..{cap}, same meaning as suggested tranche), suggestedTranchePct (same), "
                    "riskNotes (array of strings), fireSaleHypothesis (string or null)."
                )
                user = (
                    f"QUANT_CONTEXT_JSON:\n{qc}\n\nFACTS_JSON:\n{facts_json}\n\nSNIPPETS:\n{x_block}\n\nRespond with JSON only."
                )
                raw = self._grok_json_prompt(system, user, timeout=25)
                self.last_used_provider = "grok"
                self.last_fallback_used = False
                return self._normalize_dip_insight(raw, cap)
            except Exception as exc:
                logger.warning("Grok dip insight snippet fallback: %s", exc)

        self.last_used_provider = "template"
        self.last_fallback_used = True
        return self._dip_insight_template(dip_facts, cap)

    def _grok_dip_insight_x_search(
        self,
        dip_facts: Dict[str, Any],
        cap: float,
        quant_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Responses API + native x_search tool (see xAI docs — no separate X API subscription)."""
        sym = str(dip_facts.get("symbol", "")).strip().upper()
        facts_json = json.dumps(dip_facts, ensure_ascii=False)
        qc_json = json.dumps(quant_context or {}, ensure_ascii=False, default=str)
        now = datetime.now(timezone.utc)
        from_date = (now - timedelta(days=4)).strftime("%Y-%m-%d")
        to_date = now.strftime("%Y-%m-%d")

        system = (
            "You are an elite hedge-fund-style dip-buying analyst for EDUCATIONAL OUTPUT ONLY (not personalized advice). "
            "You have x_search for live X posts. "
            "FACTS_JSON and technicalSnapshot are authoritative — never contradict prices, vsBaselinePct, or ATR fields. "
            "ruleConfluenceScore (if present) is a deterministic app hint (0-100); acknowledge it but do not invent data.\n"
            "After x_search, reply with ONLY valid JSON (no markdown fence) having keys:\n"
            f"- verdict: one of Strong Buy | Buy | Hold | Pass (Pass = do not scale in now)\n"
            f"- confidence: integer 0-100 (your confidence in the educational verdict)\n"
            f"- reasoning: concise string — setup quality, timing vs baseline/ATR, macro/news risks, invalidation ideas (no guarantees)\n"
            f"- situationSummary: string, 2-5 sentences\n"
            f"- xSentiment: object label bearish|neutral|bullish|unknown, drivers citing themes from posts\n"
            f"- suggestedTranchePct AND recommendedPositionPct: same number, between 0 and {cap} (portfolio % hint)\n"
            f"- riskNotes: array of strings\n"
            f"- fireSaleHypothesis: string or null\n"
            f"- xPostLinks: array of {{\"url\": string, \"note\": string}} from citations when possible."
        )
        user = (
            f"QUANT_CONTEXT_JSON:\n{qc_json}\n\nFACTS_JSON:\n{facts_json}\n\n"
            f"Task: Search X for ${sym} and related dip/sentiment discussion ({from_date} to {to_date}). "
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
        raw_pct = out.get("recommendedPositionPct", out.get("suggestedTranchePct", 2))
        try:
            pct = float(raw_pct)
        except (TypeError, ValueError):
            pct = 2.0
        pct = max(0.0, min(pct, cap, 50.0))
        out["suggestedTranchePct"] = round(pct, 2)
        out["recommendedPositionPct"] = round(pct, 2)

        verdict_raw = str(out.get("verdict", "") or "").strip()
        vl = verdict_raw.lower().replace("_", " ")
        if vl.replace(" ", "") == "strongbuy":
            vl = "strong buy"
        if vl == "strong buy":
            out["verdict"] = "Strong Buy"
        elif vl == "buy":
            out["verdict"] = "Buy"
        elif vl == "hold":
            out["verdict"] = "Hold"
        elif vl == "pass":
            out["verdict"] = "Pass"
        else:
            out["verdict"] = "Buy"

        try:
            conf = int(round(float(out.get("confidence", 65))))
        except (TypeError, ValueError):
            conf = 65
        out["confidence"] = max(0, min(conf, 100))

        out["reasoning"] = str(out.get("reasoning", "") or "")[:4500]
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
            "verdict": "Hold",
            "confidence": 40,
            "reasoning": (
                "Automated template — configure GROK_API_KEY and LLM_PROVIDER=grok on the Python service "
                "for UltimateDipBuyer AI narrative and verdict."
            ),
            "situationSummary": (
                f"{sym} moved vs your baseline (approx. {vs}%); review liquidity and upcoming catalysts before sizing."
            ),
            "xSentiment": {"label": "unknown", "drivers": "LLM unavailable; X sentiment not scored."},
            "suggestedTranchePct": min(2.0, cap),
            "recommendedPositionPct": min(2.0, cap),
            "riskNotes": [
                "Verify the quote and baseline in the app before acting.",
                "Model output is educational only.",
            ],
            "fireSaleHypothesis": None,
        }

    def generate_daily_watchlist_digest(self, digest_bundle: Dict[str, Any]) -> Dict[str, Any]:
        """Grok JSON digest: macro, holdings, ingested headlines, optional x_search narrative, top 2 off-list picks."""
        self.last_x_search_citations = []
        self.last_fallback_used = True
        wl_ctx = digest_bundle.get("watchlistContext")
        if not isinstance(wl_ctx, dict):
            wl_ctx = digest_bundle if isinstance(digest_bundle, dict) else {}
        arts = digest_bundle.get("researchArtifacts") if isinstance(digest_bundle.get("researchArtifacts"), list) else []
        rd_meta = digest_bundle.get("researchDigestMeta") if isinstance(digest_bundle.get("researchDigestMeta"), dict) else {}

        wl_json = json.dumps(wl_ctx, default=str)[:20000]
        arts_trim = arts[:42] if isinstance(arts, list) else []
        arts_json = json.dumps(arts_trim, default=str)[:14000]
        meta_json = json.dumps(rd_meta, default=str)[:2000]

        system = (
            "You are a senior sell-side strategist writing a sober daily briefing for a retail client's watchlist. "
            "EDUCATIONAL ONLY — no personalized investment advice; no fabricated earnings or price targets.\n"
            "You may combine: (a) authoritative numbers from WATCHLIST_JSON, "
            "(b) RESEARCH_ARTIFACTS_JSON headline rows from our ingestion (titles/summaries/urls), "
            "(c) your general macro knowledge.\n\n"
            "Output VALID JSON ONLY (no markdown) with keys:\n"
            "- macroAnalysis: string (3-6 sentences) — Fed/liquidity, inflation/growth tilt, geopolitical headline risk, "
            "cross-asset cues relevant to equities.\n"
            "- marketOverview: string (2-4 sentences) — session-style tone for broad US equities and how it relates to "
            "these holdings.\n"
            "- holdingsAnalysis: string — professional paragraph tying each tracked symbol's price vs baseline, dip tiers, "
            "and sizing hints from JSON; flag concentration or gaps.\n"
            "- newsHighlights: array up to 6 objects {title (string), symbol (optional string), takeaway (<=220 chars)} — "
            "prioritize headlines from RESEARCH_ARTIFACTS that matter for symbols on their list; cite themes not fake quotes.\n"
            "- xSocialSummary: string (2-5 sentences) — current X/discourse themes around their tickers vs macro noise.\n"
            "- xPostLinks: array up to 6 of {url, note} optional if you cite specific posts/channels (use plausible x.com/twitter.com URLs).\n"
            "- topStockPicks: EXACTLY 2 objects NOT on watchlist symbols. Each:\n"
            "  { symbol (uppercase US 1-6 letters plausible liquid), rationale1to3Years (<=480 chars forward view), "
            " rationaleLongTerm (<=480 chars secular/compounding angle), riskNote (<=260 chars), "
            " keyCatalystOrTheme (<=180 chars optional) }. "
            "These are illustrative research ideas — not endorsed positions.\n"
            "- disclaimer: string (≤900 chars).\n\n"
            "Do not duplicate tickers from items[].symbol. No emoji.\n"
        )
        user = (
            "WATCHLIST_JSON:\n"
            + wl_json
            + "\n\nRESEARCH_ARTIFACTS_JSON (Polygon/news ingestion — vet externally):\n"
            + arts_json
            + "\n\nMETA_JSON:\n"
            + meta_json
        )

        use_x_search = (
            os.getenv("DAILY_DIGEST_USE_X_SEARCH", "true").strip().lower() in ("1", "true", "yes")
        )
        if self.provider == "grok" and self.grok_api_key and use_x_search:
            try:
                raw = self._grok_daily_digest_x_search(system, user, wl_ctx)
                self.last_fallback_used = False
                self.last_used_provider = "grok"
                return self._normalize_daily_digest(raw, wl_ctx)
            except Exception as exc:
                logger.warning("Grok daily digest x_search fallback: %s", exc)
        if self.provider == "grok" and self.grok_api_key:
            try:
                raw = self._grok_json_prompt(system, user, timeout=120)
                self.last_fallback_used = False
                self.last_used_provider = "grok"
                return self._normalize_daily_digest(raw, wl_ctx)
            except Exception as exc:
                logger.warning("Grok daily digest fallback: %s", exc)
        self.last_used_provider = "template"
        self.last_fallback_used = True
        return self._daily_digest_template(wl_ctx, arts_trim)

    def _grok_daily_digest_x_search(
        self, system: str, user: str, wl_ctx: Dict[str, Any]
    ) -> Dict[str, Any]:
        syms = []
        for it in (wl_ctx.get("items") or [])[:12]:
            s = str(it.get("symbol") or "").strip().upper()
            if s and re.match(r"^[A-Z]{1,10}$", s):
                syms.append(s)
        sym_query = ", ".join(sorted(set(syms))) if syms else "US equities breadth"
        now = datetime.now(timezone.utc)
        from_date = (now - timedelta(days=3)).strftime("%Y-%m-%d")
        to_date = now.strftime("%Y-%m-%d")
        user_x = (
            user
            + "\n\nTask: Call x_search for recent discussion on "
            + sym_query
            + f" versus broad macro ({from_date} to {to_date}). Then output ONLY the JSON object required in SYSTEM."
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
                {"role": "user", "content": user_x[:35000]},
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
            timeout=150,
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
            raise ValueError("Empty Grok daily digest x_search response text")
        parsed = self._parse_json_object_from_text(text)
        if not isinstance(parsed, dict):
            raise ValueError("Grok did not return a JSON object")

        x_links = parsed.get("xPostLinks")
        if not isinstance(x_links, list) or len(x_links) == 0:
            x_urls = [
                u
                for u in self.last_x_search_citations
                if "status/" in u or "/i/status/" in u or "x.com" in u.lower()
            ]
            parsed["xPostLinks"] = [
                {"url": u[:800], "note": "x_search citation"} for u in x_urls[:8]
            ]
        return parsed

    def _normalize_daily_digest(
        self, raw: Dict[str, Any], ctx: Dict[str, Any]
    ) -> Dict[str, Any]:
        existing = set()
        for it in ctx.get("items") or []:
            sym = str(it.get("symbol") or "").upper().strip()
            if sym:
                existing.add(sym)

        news_hi: List[Dict[str, str]] = []
        nh_raw = raw.get("newsHighlights") or raw.get("news_highlights") or []
        if isinstance(nh_raw, list):
            for nh in nh_raw[:8]:
                if not isinstance(nh, dict):
                    continue
                title = str(nh.get("title") or "").strip()
                takeaway = str(nh.get("takeaway") or nh.get("summary") or "").strip()
                smb = str(nh.get("symbol") or "").upper().strip() or ""
                if not title and not takeaway:
                    continue
                news_hi.append(
                    {
                        "title": title[:300],
                        "symbol": smb[:16],
                        "takeaway": takeaway[:240],
                    }
                )

        x_links_clean: List[Dict[str, str]] = []
        xl = raw.get("xPostLinks") or []
        if isinstance(xl, list):
            for z in xl[:10]:
                if isinstance(z, dict) and z.get("url"):
                    x_links_clean.append(
                        {"url": str(z.get("url", ""))[:800], "note": str(z.get("note", ""))[:400]}
                    )

        picks: List[Dict[str, Any]] = []
        tp_raw = raw.get("topStockPicks") or raw.get("top_stock_picks") or []
        if isinstance(tp_raw, list):
            for p in tp_raw:
                if not isinstance(p, dict):
                    continue
                smb = str(p.get("symbol") or "").strip().upper()
                if not smb or smb in existing or not re.match(r"^[A-Z]{1,6}$", smb):
                    continue
                picks.append(
                    {
                        "symbol": smb,
                        "rationale1to3Years": str(
                            p.get("rationale1to3Years")
                            or p.get("rationale_1_to_3_years")
                            or ""
                        )[:500],
                        "rationaleLongTerm": str(
                            p.get("rationaleLongTerm") or p.get("rationale_long_term") or ""
                        )[:500],
                        "riskNote": str(p.get("riskNote") or p.get("risk_note") or "")[:280],
                        "keyCatalystOrTheme": str(
                            p.get("keyCatalystOrTheme") or p.get("key_catalyst_or_theme") or ""
                        )[:190],
                    }
                )
                existing.add(smb)
                if len(picks) >= 2:
                    break

        suggestions: List[Dict[str, Any]] = []
        for pk in picks:
            thesis_parts = []
            if pk.get("rationale1to3Years"):
                thesis_parts.append(str(pk["rationale1to3Years"]))
            if pk.get("rationaleLongTerm"):
                thesis_parts.append(str(pk["rationaleLongTerm"]))
            combo = (" — ".join(thesis_parts))[:460]
            suggestions.append(
                {
                    "symbol": pk["symbol"],
                    "thesis": combo or "Educational illustration only.",
                    "riskNote": str(pk.get("riskNote") or "")[:280],
                    "timeHorizon": "long_term",
                }
            )

        raw_list = raw.get("suggestedAdditions") or raw.get("suggested_additions") or []
        if isinstance(raw_list, list):
            for item in raw_list:
                if len(suggestions) >= 5:
                    break
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

        disclaimer = (
            str(
                raw.get("disclaimer")
                or "Educational commentary only; verify facts, liquidity, and fit with your objectives independently."
            )[:920]
        )
        macro = str(raw.get("macroAnalysis") or raw.get("macro_analysis") or "")[:3600]

        out = {
            "macroAnalysis": macro,
            "marketOverview": str(raw.get("marketOverview") or raw.get("market_overview") or "")[:2600],
            "holdingsAnalysis": str(raw.get("holdingsAnalysis") or raw.get("holdings_analysis") or "")[:4400],
            "newsHighlights": news_hi,
            "xSocialSummary": str(raw.get("xSocialSummary") or raw.get("x_social_summary") or "")[:2200],
            "xPostLinks": x_links_clean,
            "topStockPicks": picks,
            "suggestedAdditions": suggestions[:5],
            "disclaimer": disclaimer,
        }

        if not str(out["marketOverview"] or "").strip() and macro:
            out["marketOverview"] = macro[:1200]

        return out

    def _daily_digest_template(self, ctx: Dict[str, Any], arts_trim: Optional[List[Any]] = None) -> Dict[str, Any]:
        items = ctx.get("items") or []
        syms = ", ".join(str(i.get("symbol")) for i in items[:12])
        arts_trim = arts_trim if isinstance(arts_trim, list) else []
        news_hi: List[Dict[str, str]] = []
        for j, a in enumerate(arts_trim[:6]):
            if not isinstance(a, dict):
                continue
            t = str(a.get("title") or a.get("Title") or "").strip()
            if not t:
                continue
            news_hi.append(
                {
                    "title": t[:280],
                    "symbol": str(a.get("symbol") or "").upper()[:10],
                    "takeaway": str(a.get("contentSummary") or a.get("content_summary") or "")[:220],
                }
            )

        macro = (
            "High-level liquidity and rate narratives drive sector rotation — monitor central-bank rhetoric, "
            "real yields, and credit conditions alongside broad index breadth."
        )
        holdings = (
            f"Tracked alerts: {len(items)} symbol(s) ({syms or 'n/a'}). Quotes and baselines in the briefing JSON "
            "are snapshots only — reconcile in-app before reallocating risk."
        )
        return {
            "macroAnalysis": macro,
            "marketOverview": (
                "US equities broadly trade relative to liquidity and mega-cap sentiment; reconcile any single-stock "
                "drawdown with index trend and headline risk."
            ),
            "holdingsAnalysis": holdings,
            "newsHighlights": news_hi,
            "xSocialSummary": (
                "X-driven narratives often front-run fundamentals; corroborate with filings, liquidity, and your own diligence."
            ),
            "xPostLinks": [],
            "topStockPicks": [],
            "suggestedAdditions": [],
            "disclaimer": (
                "LLM unavailable — template digest only. Set GROK_API_KEY, LLM_PROVIDER=grok on the Python service "
                "(and optionally DAILY_DIGEST_USE_X_SEARCH=true) for a full briefing."
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
            "- When discussing multiple candidates, preserve the exact order of topCandidates in SCAN_PACKET "
            "(already sorted best-first by server score); never reorder symbols by your own preference.\n"
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
