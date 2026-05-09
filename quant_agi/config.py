"""
Quant AGI central configuration — load from env / .env (python-dotenv).
All paths relative to KEEPITBASED_ROOT or repo layout.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal, Optional

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _repo_root() -> Path:
    return Path(__file__).resolve().parent


def _quant_agi_dotenv_candidates() -> tuple[Path, ...]:
    """Load the same credential files used elsewhere in KeepItBased (later files override).

    Typical layout: Grok keys live in ``python-service/.env`` alongside ``LLM_PROVIDER`` / ``LLM_MODEL``.
    ``quant_agi/.env`` is last so you can override with ``QUANT_AGI_LLM_PROVIDER`` or Quant-only knobs.
    """
    repo = _repo_root().parent.resolve()
    candidates = (
        repo / ".env",
        repo / "backend" / ".env",
        repo / "python-service" / ".env",
        _repo_root() / ".env",
    )
    return tuple(p for p in candidates if p.is_file())


_cfg_dict: dict = {"env_file_encoding": "utf-8", "extra": "ignore"}
_env_files = _quant_agi_dotenv_candidates()
if _env_files:
    _cfg_dict["env_file"] = _env_files


class Settings(BaseSettings):
    """Runtime settings — override via environment variables."""

    model_config = SettingsConfigDict(**_cfg_dict)

    # --- Repo & KeepItBased bridge ---
    keepitbased_root: Path = Field(default_factory=lambda: _repo_root().parent)
    """Path to main KeepItBased repo (parent of quant_agi/)."""

    data_cache_dir: Path = Field(default_factory=lambda: _repo_root() / "models" / "cache")
    sqlite_path: Path = Field(default_factory=lambda: _repo_root() / "models" / "quant_agi.sqlite3")

    # --- Polygon / Massive-compatible market data (same as backend) ---
    market_data_api_url: str = Field(
        default="https://api.polygon.io",
        description="Polygon-compatible REST host; use https://api.massive.com for massive.com keys.",
    )
    polygon_api_key: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("POLYGON_API_KEY", "MASSIVE_API_KEY"),
    )
    quant_agi_synthetic_history_only: bool = Field(
        default=False,
        description="If true, never call Massive/Polygon (offline or golden tests).",
    )
    massive_calendar_days_lookback: int = Field(default=450, ge=30, le=800)
    massive_http_timeout_sec: float = Field(default=35.0, ge=5, le=120)

    @field_validator("market_data_api_url", mode="after")
    @staticmethod
    def _strip_market_base(url: str) -> str:
        return str(url).strip().rstrip("/")

    # --- Swarm (MiroFish-style simulation) ---
    swarm_default_agents: int = Field(default=5_000, ge=64, le=100_000)
    swarm_max_agents: int = Field(default=100_000)
    swarm_batch_size: int = Field(default=512)
    swarm_debate_rounds: int = Field(default=12)
    """Simulated rounds of social contagion per ticker run."""

    # --- Autoresearch (Karpathy-style loop) ---
    autoresearch_repo_path: Path = Field(default_factory=lambda: _repo_root() / "models" / "autoresearch_git")
    experiments_branch_prefix: str = "exp/autoresearch"
    nightly_max_iterations: int = Field(default=3)
    experiment_max_runtime_sec: int = Field(default=3_600)
    statistical_significance_alpha: float = Field(default=0.05)
    autoresearch_eval_agents: int = Field(default=896, ge=64, le=20_000)
    """Cap swarm scale inside synthetic evaluator so overnight loops stay bounded."""
    autoresearch_eval_rounds: int = Field(default=6, ge=2, le=24)

    llm_provider: Literal["openai", "anthropic", "grok", "none"] = Field(
        default="none",
        validation_alias=AliasChoices("QUANT_AGI_LLM_PROVIDER", "LLM_PROVIDER"),
        description="Prefer QUANT_AGI_LLM_PROVIDER in shared .env files to avoid clashes with Python service.",
    )
    openai_api_key: Optional[str] = Field(default=None)
    openai_model: str = Field(default="gpt-4o-mini")
    anthropic_api_key: Optional[str] = Field(default=None)
    anthropic_model: str = Field(default="claude-3-5-haiku-20241022")
    grok_api_key: Optional[str] = Field(default=None)
    """xAI API key; `XAI_API_KEY` env is also read at call time if this is unset."""
    grok_base_url: str = Field(default="https://api.x.ai/v1")
    grok_model: Optional[str] = Field(
        default=None,
        description="If unset, falls back to GROK_MODEL then LLM_MODEL (python-service naming).",
    )
    grok_request_timeout_sec: int = Field(default=90, ge=15, le=300)

    llm_monthly_budget_usd: float = Field(default=25.0)
    llm_call_max_tokens: int = Field(default=4_096)

    # --- Torch ---
    torch_device: str = Field(default="cpu")  # cuda if available override in Dockerfile

    # --- Webhook server (stub) ---
    webhook_host: str = Field(default="0.0.0.0")
    webhook_port: int = Field(default=8844)
    quant_agi_cors_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000",
        description="Comma-separated origins for FastAPI CORS (browser hits /diag/*). Leave empty '' to disable.",
    )

    keepitbased_python_service_url: str = Field(
        default="http://127.0.0.1:5001",
        validation_alias=AliasChoices(
            "KEEPITBASED_PYTHON_SERVICE_URL",
            "PYTHON_SERVICE_URL",
        ),
        description="yfinance Flask service (quotes, fundamentals) — same origin as charts agent.",
    )
    quant_agi_sec_filing_scan: bool = Field(
        default=False,
        description="If true, Serenity preset may scrape SEC EDGAR for keyword density (slow; cache per ticker).",
    )
    sec_data_user_agent: Optional[str] = Field(
        default=None,
        description="Required descriptive User-Agent host part for SEC data.sec.gov; include contact email.",
    )

    @field_validator("keepitbased_python_service_url", mode="after")
    @staticmethod
    def _strip_python_svc(url: str) -> str:
        return str(url).strip().rstrip("/")


settings = Settings()


def resolved_grok_model() -> str:
    """Match python-service: prefer explicit Quant override, then GROK_MODEL, then LLM_MODEL."""
    for cand in (settings.grok_model, os.getenv("GROK_MODEL"), os.getenv("LLM_MODEL")):
        if cand and str(cand).strip():
            return str(cand).strip()
    # Must match an ID your xAI team can access — same default as langgraph_agent/llm_client.py
    return "grok-4.20-reasoning"


# Ensure dirs exist early (no-op harmful)
for d in (settings.data_cache_dir, settings.sqlite_path.parent, settings.autoresearch_repo_path):
    Path(d).mkdir(parents=True, exist_ok=True)
