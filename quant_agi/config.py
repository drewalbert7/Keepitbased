"""
Quant AGI central configuration — load from env / .env (python-dotenv).
All paths relative to KEEPITBASED_ROOT or repo layout.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _repo_root() -> Path:
    return Path(__file__).resolve().parent


class Settings(BaseSettings):
    """Runtime settings — override via environment variables."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Repo & KeepItBased bridge ---
    keepitbased_root: Path = Field(default_factory=lambda: _repo_root().parent)
    """Path to main KeepItBased repo (parent of quant_agi/)."""

    data_cache_dir: Path = Field(default_factory=lambda: _repo_root() / "models" / "cache")
    sqlite_path: Path = Field(default_factory=lambda: _repo_root() / "models" / "quant_agi.sqlite3")

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

    llm_provider: Literal["openai", "anthropic", "grok", "none"] = Field(default="none")
    openai_api_key: Optional[str] = Field(default=None)
    openai_model: str = Field(default="gpt-4o-mini")
    anthropic_api_key: Optional[str] = Field(default=None)
    anthropic_model: str = Field(default="claude-3-5-haiku-20241022")
    grok_api_key: Optional[str] = Field(default=None)
    """xAI API key; `XAI_API_KEY` env is also read at call time if this is unset."""
    grok_base_url: str = Field(default="https://api.x.ai/v1")
    grok_model: str = Field(default="grok-3-latest")
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


settings = Settings()

# Ensure dirs exist early (no-op harmful)
for d in (settings.data_cache_dir, settings.sqlite_path.parent, settings.autoresearch_repo_path):
    Path(d).mkdir(parents=True, exist_ok=True)
