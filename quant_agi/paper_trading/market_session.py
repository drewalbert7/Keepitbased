"""US equity session timing for paper-bot entries and exits (America/New_York)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore

ET = ZoneInfo("America/New_York") if ZoneInfo else None


def _to_utc(dt: Optional[datetime]) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _et_minutes(utc_dt: Optional[datetime] = None) -> Optional[int]:
    if ET is None:
        return None
    local = _to_utc(utc_dt).astimezone(ET)
    if local.weekday() >= 5:
        return None
    return local.hour * 60 + local.minute


def is_regular_session(utc_dt: Optional[datetime] = None) -> bool:
    mins = _et_minutes(utc_dt)
    if mins is None:
        return False
    return 9 * 60 + 30 <= mins < 16 * 60


def is_entry_window(utc_dt: Optional[datetime] = None) -> bool:
    """Momentum-style entries: after open volatility, before late-day drift (10:00–15:30 ET)."""
    if not is_regular_session(utc_dt):
        return False
    mins = _et_minutes(utc_dt)
    if mins is None:
        return False
    return 10 * 60 <= mins < 15 * 60 + 30


def is_exit_window(utc_dt: Optional[datetime] = None) -> bool:
    """Exits allowed slightly wider (9:45–15:55 ET) during regular session."""
    if not is_regular_session(utc_dt):
        return False
    mins = _et_minutes(utc_dt)
    if mins is None:
        return False
    return 9 * 60 + 45 <= mins < 15 * 60 + 55


def parse_run_at_iso(iso: Optional[str]) -> Optional[datetime]:
    if not iso:
        return None
    try:
        text = str(iso).strip().replace("Z", "+00:00")
        return _to_utc(datetime.fromisoformat(text))
    except (TypeError, ValueError):
        return None
