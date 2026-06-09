"""Thin GitPython façade — isolated sandbox repo under models/autoresearch_git."""

from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from shutil import copy2
from typing import Any, Dict, Iterable, Optional

from git import Repo

from config import settings
from utils.logger import get_logger

_LOG = get_logger(__name__)


class GitExperimentManager:
    """Copy candidate files into sandbox, commit snapshots for audit trail."""

    def __init__(self, repo_path: Optional[Path] = None) -> None:
        self.path = Path(repo_path or settings.autoresearch_repo_path).resolve()
        self.path.mkdir(parents=True, exist_ok=True)

    def repo(self) -> Repo:
        if not (self.path / ".git").exists():
            r = Repo.init(self.path)
            readme = self.path / "README_AUTORESEARCH.md"
            readme.write_text(
                "# Quant AGI autoresearch sandbox\n"
                "This repo captures experiment commits only — not your main app history.\n",
                encoding="utf-8",
            )
            r.index.add([readme.name])
            r.index.commit("chore(autoresearch): bootstrap sandbox repo")
            _LOG.info("Initialized git sandbox at %s", self.path)
            return r
        return Repo(self.path)

    def create_branch(self, slug: str) -> str:
        r = self.repo()
        clean_slug = "".join(c if (c.isalnum() or c in "-_.") else "_" for c in slug)[:72]
        name = f"{settings.experiments_branch_prefix}-{clean_slug}"
        branches = [b.name for b in r.branches]
        curr = getattr(r.active_branch, "name", branches[0] if branches else "master")

        if name not in branches:
            if curr in branches:
                r.git.checkout(curr)
            r.git.checkout("-b", name)
            _LOG.info("Created sandbox branch %s", name)
        else:
            r.git.checkout(name)
            _LOG.info("Reuse sandbox branch %s", name)

        return name

    def commit_mirror_files(
        self,
        message: str,
        files: Iterable[Path],
        *,
        grok_artifacts: Optional[Dict[str, str]] = None,
        grok_dir_slug: str = "run",
    ) -> str:
        """Mirror snapshot files at repo root; optionally write Grok `generated_modules` under `grok_artifacts/<slug>/`."""
        r = self.repo()
        staged: list[str] = []

        for src in files:
            if not Path(src).is_file():
                continue
            dest = self.path / Path(src).name
            copy2(src, dest)
            staged.append(dest.name)

        extras = grok_artifacts or {}
        if extras:
            clean = "".join(c if (c.isalnum() or c in "-_.") else "_" for c in grok_dir_slug)[:80]
            art_root = self.path / "grok_artifacts" / clean
            art_root.mkdir(parents=True, exist_ok=True)
            for fname, body in extras.items():
                safe = Path(fname).name
                if not safe or safe != fname:
                    _LOG.warning("Skipping artifact name with path segments: %s", fname)
                    continue
                p = art_root / safe
                p.write_text(body, encoding="utf-8")
                staged.append(str(p.relative_to(self.path)))

        if not staged:
            return str(r.head.commit.hexsha)

        r.index.add(staged)
        commit = r.index.commit(message[:8000])
        sha = str(commit.hexsha)
        _LOG.info("Committed experiment %s (files=%s)", sha[:8], ", ".join(staged[:12]) + ("…" if len(staged) > 12 else ""))
        return sha

    def promote_commit(self, commit_sha: str, *, promoted_by: str = "operator") -> dict[str, Any]:
        """
        Human promote: copy files from an experiment commit onto ``promoted/staging``.
        Does not merge to production — audit trail only until CI + manual deploy.
        """
        sha = str(commit_sha or "").strip()
        if len(sha) < 7:
            return {"ok": False, "error": "Invalid commit sha"}

        show = subprocess.run(
            ["git", "-C", str(self.path), "show", "--name-only", "--pretty=format:", sha],
            capture_output=True,
            text=True,
            check=False,
        )
        if show.returncode != 0:
            return {"ok": False, "error": f"Commit {sha[:8]} not found in sandbox"}

        files = [ln.strip() for ln in show.stdout.splitlines() if ln.strip()]
        if not files:
            return {"ok": False, "error": "Commit has no files to promote"}

        r = self.repo()
        staging = "promoted/staging"
        branches = [b.name for b in r.branches]
        curr = getattr(r.active_branch, "name", branches[0] if branches else "master")

        if staging not in branches:
            base = curr if curr in branches else "master"
            r.git.checkout("-b", staging, base)
        else:
            r.git.checkout(staging)

        try:
            r.git.checkout(sha, "--", *files)
        except Exception as ex:  # noqa: BLE001
            if curr in branches:
                r.git.checkout(curr)
            return {"ok": False, "error": f"Could not checkout files: {ex}"}

        r.index.add(files)
        msg = f"promote(autoresearch): {sha[:12]} by {promoted_by}"[:8000]
        commit = r.index.commit(msg)
        promoted_sha = str(commit.hexsha)

        log_path = self.path / "PROMOTED_LOG.jsonl"
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "source_sha": sha,
            "promoted_sha": promoted_sha,
            "branch": staging,
            "files": files,
            "promoted_by": promoted_by,
        }
        with log_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")

        if curr in branches:
            r.git.checkout(curr)

        _LOG.info("Promoted %s -> %s on %s", sha[:8], promoted_sha[:8], staging)
        return {
            "ok": True,
            "source_sha": sha,
            "promoted_sha": promoted_sha,
            "branch": staging,
            "files": files,
        }
