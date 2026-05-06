"""Thin GitPython façade — isolated sandbox repo under models/autoresearch_git."""

from __future__ import annotations

from pathlib import Path
from shutil import copy2
from typing import Iterable, Optional

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

    def commit_mirror_files(self, message: str, files: Iterable[Path]) -> str:
        r = self.repo()
        staged: list[str] = []
        for src in files:
            if not Path(src).is_file():
                continue
            dest = self.path / Path(src).name
            copy2(src, dest)
            staged.append(dest.name)

        if not staged:
            return str(r.head.commit.hexsha)

        r.index.add(staged)
        commit = r.index.commit(message[:8000])
        sha = str(commit.hexsha)
        _LOG.info("Committed experiment %s (files=%s)", sha[:8], ", ".join(staged))
        return sha
